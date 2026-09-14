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
 * Not included here: TurboWarp's frame interpolation and high-quality pen are
 * renderer-level features (scratch-render), and arbitrary custom stage sizes touch
 * layout across gui/render/vm together. Those need real engine work, not a patch
 * from application code, so they're left out rather than faked.
 */

// scratch-vm's package.json "exports" map only exposes the package root
// (webpack/browser/node entry bundles), so these internals can't be reached via
// the "scratch-vm/..." specifier form - only via a real relative filesystem path
// straight into node_modules, which bypasses the exports map entirely.
import Runtime from '../../node_modules/scratch-vm/src/engine/runtime';
import RenderedTarget from '../../node_modules/scratch-vm/src/sprites/rendered-target';
import Scratch3DataBlocks from '../../node_modules/scratch-vm/src/blocks/scratch3_data';

const DEFAULTS = {
    framerate: 30, // matches Runtime.THREAD_STEP_INTERVAL's built-in 1000 / 30
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
    Object.defineProperty(Runtime, 'THREAD_STEP_INTERVAL', {
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

export default {
    DEFAULTS,
    setFramerate,
    setTurboMode,
    setInfiniteClones,
    setRemoveFencing,
    setRemoveListLimit
};
