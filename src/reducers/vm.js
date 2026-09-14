import VM from 'scratch-vm';
import storage from '../lib/storage';

const SET_VM = 'scratch-gui/vm/SET_VM';
const defaultVM = new VM();
defaultVM.attachStorage(storage);

// Expose the running VM for console debugging (same convention TurboWarp
// uses) - lets `window.vm.runtime`, `window.vm.runtime.renderer`, etc. be
// inspected directly instead of guessing blind.
if (typeof window !== 'undefined') {
    window.vm = defaultVM;
}
const initialState = defaultVM;

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_VM:
        return action.vm;
    default:
        return state;
    }
};
const setVM = function (vm) {
    return {
        type: SET_VM,
        vm: vm
    };
};

export {
    reducer as default,
    initialState as vmInitialState,
    setVM
};
