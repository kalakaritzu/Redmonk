/**
 * Redmonk "Advanced" runtime tweaks, in the spirit of TurboWarp's compiler/runtime
 * settings. These patch scratch-vm's engine classes directly (rather than forking
 * scratch-vm as its own repo) so they apply to the single VM instance the editor
 * already runs.
 *
 * Each tweak is a live-reversible monkeypatch:
 *  - framerate / infinite clones / unlimited lists override a static getter that
 *    scratch-vm's engine re-reads on every use, so toggling is instant.
 *  - fencing overrides an instance method (RenderedTarget.prototype.keepInFence),
 *    restorable to the original implementation.
 *
 * High-quality pen (below) is the one renderer-level (scratch-render) tweak
 * included so far - it forces the pen layer's texture resolution up
 * independent of the stage's native size, same idea as TurboWarp's version.
 * Frame interpolation and arbitrary custom stage sizes are NOT included:
 * interpolation means hooking the render draw loop itself to blend sprite
 * transforms between logic steps (not a single patchable method), and custom
 * stage sizes touch coordinate math across gui/render/vm together. Both are
 * real engine work, not a patch from application code, so left out rather
 * than faked.
 */

// scratch-vm/scratch-render's package.json "exports" maps only expose the
// package root (webpack/browser/node entry bundles), so these internals can't
// be reached via the "scratch-vm/..." specifier form - only via a real
// relative filesystem path straight into node_modules, which bypasses the
// exports map entirely.
import Runtime from '../../node_modules/scratch-vm/src/engine/runtime';
import RenderedTarget from '../../node_modules/scratch-vm/src/sprites/rendered-target';
import Scratch3DataBlocks from '../../node_modules/scratch-vm/src/blocks/scratch3_data';
import PenSkin from '../../node_modules/scratch-render/src/PenSkin';
import * as twgl from 'twgl.js';

const DEFAULTS = {
    // scratch-vm's own THREAD_STEP_INTERVAL default is actually 60 TPS - but
    // scratch-gui always calls vm.setCompatibilityMode(true) on startup
    // (lib/vm-manager-hoc.jsx), which makes the engine use the SEPARATE
    // THREAD_STEP_INTERVAL_COMPATIBILITY getter (30 TPS) instead. So the
    // framerate the editor actually runs at by default is 30, and both
    // getters need patching below or compatibility mode silently wins.
    framerate: 30,
    maxClones: 300, // matches Runtime.MAX_CLONES
    listItemLimit: 200000 // matches Scratch3DataBlocks.LIST_ITEM_LIMIT
};

let originalKeepInFence = RenderedTarget.prototype.keepInFence;

const restartStepping = vm => {
    const runtime = vm && vm.runtime;
    if (runtime && runtime._steppingInterval) {
        clearInterval(runtime._steppingInterval);
        runtime._steppingInterval = null;
        runtime.start();
    }
};

/**
 * @param {VM} vm - the running virtual machine
 * @param {number} fps - target frames/steps per second (30 is stock Scratch)
 */
const setFramerate = (vm, fps) => {
    const clamped = Math.max(1, Math.min(999, Math.round(fps) || DEFAULTS.framerate));
    // Patch both getters - scratch-gui runs in compatibility mode by default
    // (see the DEFAULTS comment above), so THREAD_STEP_INTERVAL_COMPATIBILITY
    // is the one actually read by Runtime.prototype.start(). Patching only
    // THREAD_STEP_INTERVAL would silently do nothing.
    Object.defineProperty(Runtime, 'THREAD_STEP_INTERVAL', {
        configurable: true,
        get () {
            return 1000 / clamped;
        }
    });
    Object.defineProperty(Runtime, 'THREAD_STEP_INTERVAL_COMPATIBILITY', {
        configurable: true,
        get () {
            return 1000 / clamped;
        }
    });
    restartStepping(vm);
    return clamped;
};

/**
 * @param {VM} vm
 * @param {boolean} enabled
 */
const setTurboMode = (vm, enabled) => {
    vm.setTurboMode(Boolean(enabled));
};

/**
 * @param {boolean} enabled
 */
const setInfiniteClones = enabled => {
    Object.defineProperty(Runtime, 'MAX_CLONES', {
        configurable: true,
        get () {
            return enabled ? Infinity : DEFAULTS.maxClones;
        }
    });
};

/**
 * @param {boolean} enabled
 */
const setRemoveFencing = enabled => {
    RenderedTarget.prototype.keepInFence = enabled ?
        function (newX, newY) {
            // No-op fence: let sprites travel off-stage freely.
            return {x: newX, y: newY};
        } :
        originalKeepInFence;
};

/**
 * @param {boolean} enabled
 */
const setRemoveListLimit = enabled => {
    Object.defineProperty(Scratch3DataBlocks, 'LIST_ITEM_LIMIT', {
        configurable: true,
        get () {
            return enabled ? Infinity : DEFAULTS.listItemLimit;
        }
    });
};

const PEN_QUALITY_MULTIPLIER = 2;

let highQualityPenEnabled = false;
let penSkinPatchInstalled = false;
let originalSetCanvasSize = null;

/**
 * Reads the pen layer's current framebuffer pixels back to the CPU, before
 * anything about its size changes.
 *
 * This has to happen strictly BEFORE calling the stock _setCanvasSize:
 * that method's own resize path does
 * `twgl.resizeFramebufferInfo(gl, this._framebuffer, attachments, width, height)`
 * when a framebuffer already exists - which mutates the SAME framebuffer
 * object (and its underlying WebGLFramebuffer) in place, reattaching a new,
 * blank texture at the new size, rather than creating a new one. Capturing
 * `this._framebuffer` as a reference before calling it and reading from that
 * reference afterward reads back the *new*, blank framebuffer, not the old
 * content - it's the same object. (TurboWarp's real fix sidesteps this by
 * never calling resizeFramebufferInfo at all - their _setCanvasSize always
 * creates a brand new framebuffer instead, per a comment in their source:
 * "resize framebuffer info doesn't work here, so always make a new
 * framebuffer". This does it the other way around: read out before the
 * mutation instead of avoiding the mutation.)
 *
 * Three approaches were tried for the actual pixel copy/scale before this
 * CPU-side one: a direct port of TurboWarp's shader-based _drawPenTexture
 * (fetched and read from https://github.com/TurboWarp/scratch-render rather
 * than re-derived) hit GL_INVALID_OPERATION right at the draw call with
 * every prior state-setting call reporting no error; gl.blitFramebuffer (a
 * WebGL2 built-in, no shader needed) turned out to be unavailable since this
 * renderer's context is WebGL1. Both were narrowed down via on-page logging,
 * since this environment has no devtools console access.
 *
 * @param {PenSkin} skin
 * @param {Array<number>} size - the skin's current [width, height]
 * @return {?{pixels: Uint8Array, width: number, height: number}} null if
 *   there was nothing to read (e.g. first-ever creation, no framebuffer yet)
 */
const readOldPenPixels = (skin, size) => {
    if (!skin._framebuffer) return null;
    const gl = skin._renderer.gl;
    const [width, height] = size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, skin._framebuffer.framebuffer);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {pixels, width, height};
};

/**
 * Scales previously-read-back pen pixels (see readOldPenPixels) onto a 2D
 * canvas (drawImage handles arbitrary resize without any WebGL shader or
 * attribute state - a far smaller surface for WebGL state bugs to hide in
 * than a GPU-side draw call), then uploads the result into the skin's
 * *current* texture with gl.texImage2D. Call after the resize has already
 * happened, so skin._texture is the new, correctly-sized destination.
 *
 * @param {PenSkin} skin
 * @param {{pixels: Uint8Array, width: number, height: number}} oldPixelData
 */
const uploadOldPenPixels = (skin, oldPixelData) => {
    const gl = skin._renderer.gl;
    const {pixels, width: oldWidth, height: oldHeight} = oldPixelData;
    const [newWidth, newHeight] = skin._size;

    const oldCanvas = document.createElement('canvas');
    oldCanvas.width = oldWidth;
    oldCanvas.height = oldHeight;
    const oldCtx = oldCanvas.getContext('2d');
    const imageData = oldCtx.createImageData(oldWidth, oldHeight);
    imageData.data.set(pixels);
    oldCtx.putImageData(imageData, 0, 0);

    const newCanvas = document.createElement('canvas');
    newCanvas.width = newWidth;
    newCanvas.height = newHeight;
    const newCtx = newCanvas.getContext('2d');
    newCtx.imageSmoothingEnabled = false; // match the pen texture's own NEAREST filtering
    newCtx.drawImage(oldCanvas, 0, 0, oldWidth, oldHeight, 0, 0, newWidth, newHeight);

    gl.bindTexture(gl.TEXTURE_2D, skin._texture);
    // No UNPACK_FLIP_Y_WEBGL here (tried it, made things upside-down): the
    // readPixels -> canvas -> texImage2D round trip apparently keeps the
    // pen texture's orientation as-is without needing a compensating flip.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, newCanvas);
    gl.bindTexture(gl.TEXTURE_2D, null);
};

/**
 * Installs a permanent (idempotent) override on PenSkin.prototype so the pen
 * layer's texture can be rendered at a higher resolution than the stage's
 * native size, without losing existing drawings when that resolution
 * changes (toggling the setting, or a real window resize). The pen's drawing
 * shader maps stage coordinates onto the texture via a u_stageSize uniform
 * derived from this._size (see PenSkin.js), so enlarging the texture while
 * keeping the logical quad the same size just makes strokes crisper - it
 * doesn't shift anything.
 *
 * This patches _setCanvasSize, NOT onNativeSizeChanged. PenSkin's constructor
 * does `this.onNativeSizeChanged = this.onNativeSizeChanged.bind(this)`,
 * which copies the method onto each instance - patching the prototype method
 * has no effect on any pen skin that already existed when the patch was
 * installed (it's shadowed by its own bound copy). _setCanvasSize is never
 * rebound like that, so patching it applies uniformly to every pen skin,
 * past and future, and also covers the constructor's own initial call.
 *
 * The multiplied size is clamped to the GPU's real MAX_TEXTURE_SIZE - an
 * already-large native size (large stage layout, fullscreen, high-DPI
 * displays) doubled can otherwise exceed what the GPU/driver supports,
 * which fails texture allocation and makes the pen layer stop rendering
 * entirely rather than just look wrong.
 */
const installPenSkinPatch = () => {
    if (penSkinPatchInstalled) return;
    penSkinPatchInstalled = true;
    originalSetCanvasSize = PenSkin.prototype._setCanvasSize;
    PenSkin.prototype._setCanvasSize = function (canvasSize) {
        const gl = this._renderer.gl;
        const [width, height] = canvasSize;
        let targetWidth = width;
        let targetHeight = height;
        if (highQualityPenEnabled) {
            const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            targetWidth = Math.min(width * PEN_QUALITY_MULTIPLIER, maxTextureSize);
            targetHeight = Math.min(height * PEN_QUALITY_MULTIPLIER, maxTextureSize);
        }

        // Nothing would actually change - skip (mirrors TurboWarp's own
        // guard), rather than needlessly redrawing the buffer onto itself.
        if (this._size && this._size[0] === targetWidth && this._size[1] === targetHeight) {
            return;
        }

        const oldPixelData = this._size ? readOldPenPixels(this, this._size) : null;
        originalSetCanvasSize.call(this, [targetWidth, targetHeight]);

        // Fix up the orphaned-texture bug this resize likely just triggered
        // (see uploadOldPenPixels' comment): on every resize past the first,
        // twgl.resizeFramebufferInfo keeps resizing the framebuffer's
        // ORIGINAL attachment in place and ignores the brand-new texture
        // stock _setCanvasSize just created and assigned to this._texture,
        // leaving this._texture pointing at a texture nothing is actually
        // drawn into. getTexture()/getUniforms() read this._texture, so
        // realigning it with the framebuffer's real attachment here is what
        // makes compositing (and reads for preservation) see real content
        // again, not just what my own upload happens to touch.
        if (this._framebuffer && this._framebuffer.attachments[0] !== this._texture) {
            this._texture = this._framebuffer.attachments[0];
        }

        if (oldPixelData) {
            uploadOldPenPixels(this, oldPixelData);
            this._silhouetteDirty = true;
        }
    };

    // Pen line drawing (a "move + pen down" trail, as opposed to a stamp) has
    // its own separate bug once the texture is inflated: _enterDrawLineOnBuffer
    // sets `u_stageSize: this._size` - but this._size is the (possibly
    // doubled) texture resolution, while the line's own position/length/
    // thickness values are always expressed in real stage coordinates
    // (sprites live in the fixed -240..240 / -180..180 range regardless of
    // pen texture resolution). The line shader divides position by
    // u_stageSize to map into clip space, so feeding it the inflated
    // resolution instead of the true native size scales the whole line -
    // position AND thickness together - down by the same factor pen quality
    // is multiplied up by, which is exactly why a line drawn with High
    // Quality Pen on comes out thinner and pulled toward center relative to
    // where the sprite actually is. The viewport a few lines earlier in the
    // same original method is correctly left alone - that one *should* match
    // the real texture resolution, so the line still rasterizes crisply.
    //
    // This override is gated on highQualityPenEnabled, unlike the
    // _setCanvasSize patch above. installPenSkinPatch() runs unconditionally
    // on every page load (SettingsMenu applies persisted settings on mount
    // regardless of their value), so an earlier ungated version of this
    // override ran on *every* pen line segment even with the feature off -
    // an extra getNativeSize() + setUniforms call on a path that can fire
    // many times per second during any glide/move-with-pen-down script,
    // adding real overhead for a value that, with the feature off, isn't
    // even different from what the original code already sets. Gating it
    // means the original, zero-overhead code runs untouched when the
    // feature is off, exactly as if this patch were never installed.
    const originalEnterDrawLineOnBuffer = PenSkin.prototype._enterDrawLineOnBuffer;
    PenSkin.prototype._enterDrawLineOnBuffer = function () {
        originalEnterDrawLineOnBuffer.call(this);
        if (highQualityPenEnabled) {
            const nativeSize = this._renderer.getNativeSize();
            twgl.setUniforms(this._lineShader, {u_stageSize: nativeSize});
        }
    };
};

/**
 * @param {VM} vm
 * @param {boolean} enabled
 */
const setHighQualityPen = (vm, enabled) => {
    installPenSkinPatch();
    highQualityPenEnabled = Boolean(enabled);

    // Existing pen skin(s) only pick up a new resolution on their next
    // resize - re-apply now, using the renderer's own tracked native size
    // (never touched by this patch, so it's always the true logical size -
    // reading it back from the skin's own this._size here would compound
    // the multiplier on every toggle), so the checkbox takes effect
    // immediately instead of waiting for the next resize event.
    const renderer = vm && vm.runtime && vm.runtime.renderer;
    if (renderer && typeof renderer.getNativeSize === 'function') {
        const nativeSize = renderer.getNativeSize();
        (renderer._allSkins || []).forEach(skin => {
            if (skin instanceof PenSkin) {
                skin._setCanvasSize(nativeSize);
            }
        });
    }
};

/**
 * Applies every tweak's current value to a VM instance in one call. Used both
 * by the Advanced Settings modal (so changes take effect immediately) and by
 * SettingsMenu (so a project loaded from localStorage-persisted settings
 * actually has them re-armed on page load, without requiring the user to
 * open the modal first just to "wake up" their own saved settings).
 *
 * @param {VM} vm
 * @param {object} settings - shape matches AdvancedSettingsModal's DEFAULT_STATE
 */
const applyAll = (vm, settings) => {
    setFramerate(vm, settings.framerate);
    setTurboMode(vm, settings.turboMode);
    setInfiniteClones(settings.infiniteClones);
    setRemoveFencing(settings.removeFencing);
    setRemoveListLimit(settings.removeListLimit);
    setHighQualityPen(vm, settings.highQualityPen);
};

export default {
    DEFAULTS,
    setFramerate,
    setTurboMode,
    setInfiniteClones,
    setRemoveFencing,
    setRemoveListLimit,
    setHighQualityPen,
    applyAll
};
