/**
 * Persists Redmonk's advanced runtime tweaks (see lib/tweaks.js) across reloads
 * using localStorage. Best-effort: if storage is unavailable (private browsing,
 * disabled storage, etc.) tweaks simply reset to defaults each load instead of
 * throwing.
 */

import tweaks from './tweaks.js';

const STORAGE_KEY = 'redmonk:advanced-settings';

// Shared shape/defaults for every tweak's persisted setting. Lives here
// (rather than duplicated in both AdvancedSettingsModal and SettingsMenu)
// so loadTweaks() always has a complete, consistent object to merge saved
// values into, regardless of which one calls it first.
const DEFAULT_TWEAKS = {
    framerate: tweaks.DEFAULTS.framerate,
    turboMode: false,
    infiniteClones: false,
    removeFencing: false,
    removeListLimit: false,
    highQualityPen: false
};

const loadTweaks = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return Object.assign({}, DEFAULT_TWEAKS, raw ? JSON.parse(raw) : {});
    } catch (e) {
        return Object.assign({}, DEFAULT_TWEAKS);
    }
};

const saveTweaks = settings => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        // Ignore - not critical if this fails.
    }
};

export {
    DEFAULT_TWEAKS,
    loadTweaks,
    saveTweaks
};
