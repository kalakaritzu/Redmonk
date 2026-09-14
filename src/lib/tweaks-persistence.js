/**
 * Persists Redmonk's advanced runtime tweaks (see lib/tweaks.js) across reloads
 * using localStorage. Best-effort: if storage is unavailable (private browsing,
 * disabled storage, etc.) tweaks simply reset to defaults each load instead of
 * throwing.
 */

const STORAGE_KEY = 'redmonk:advanced-settings';

const loadTweaks = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
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
    loadTweaks,
    saveTweaks
};
