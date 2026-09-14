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
 * Installs a permanent (idempotent) override on PenSkin.prototype so the pen
 * layer's texture can be rendered at a higher resolution than the stage's
 * native size. The pen's drawing shader maps stage coordinates onto the
 * texture via a u_stageSize uniform derived from this._size (see PenSkin.js),
 * so enlarging the texture while keeping the logical quad the same size just
 * makes strokes crisper - it doesn't shift anything.
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
        if (!highQualityPenEnabled) {
            return originalSetCanvasSize.call(this, canvasSize);
        }
        const gl = this._renderer.gl;
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const [width, height] = canvasSize;
        return originalSetCanvasSize.call(this, [
            Math.min(width * PEN_QUALITY_MULTIPLIER, maxTextureSize),
            Math.min(height * PEN_QUALITY_MULTIPLIER, maxTextureSize)
        ]);
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
