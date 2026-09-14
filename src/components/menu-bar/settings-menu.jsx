import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import VM from 'scratch-vm';

import AdvancedSettingsModal from '../advanced-settings-modal/advanced-settings-modal.jsx';
import LanguageMenu from './language-menu.jsx';
import MenuBarMenu from './menu-bar-menu.jsx';
import ThemeMenu from './theme-menu.jsx';
import {MenuItem, MenuSection} from '../menu/menu.jsx';
import tweaks from '../../lib/tweaks.js';
import {loadTweaks} from '../../lib/tweaks-persistence.js';

import menuBarStyles from './menu-bar.css';
import styles from './settings-menu.css';

import dropdownCaret from './dropdown-caret.svg';
import settingsIcon from './icon--settings.svg';

const SettingsMenu = ({
    canChangeLanguage,
    canChangeTheme,
    isRtl,
    onRequestClose,
    onRequestOpen,
    settingsMenuOpen,
    vm
}) => {
    const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);

    // SettingsMenu is always mounted as soon as the editor loads (unlike
    // AdvancedSettingsModal, which only mounts once someone opens it) - so
    // this is what actually re-arms a user's saved tweaks (Framerate, Turbo
    // Mode, High Quality Pen, etc.) against a freshly loaded VM, rather than
    // leaving them silently inert in localStorage until the modal happens to
    // be opened.
    useEffect(() => {
        tweaks.applyAll(vm, loadTweaks());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            className={classNames(menuBarStyles.menuBarItem, menuBarStyles.hoverable, menuBarStyles.themeMenu, {
                [menuBarStyles.active]: settingsMenuOpen
            })}
            onMouseUp={onRequestOpen}
        >
            <img
                src={settingsIcon}
            />
            <span className={styles.dropdownLabel}>
                <FormattedMessage
                    defaultMessage="Settings"
                    description="Settings menu"
                    id="gui.menuBar.settings"
                />
            </span>
            <img src={dropdownCaret} />
            <MenuBarMenu
                className={menuBarStyles.menuBarMenu}
                open={settingsMenuOpen}
                place={isRtl ? 'left' : 'right'}
                onRequestClose={onRequestClose}
            >
                <MenuSection>
                    {canChangeLanguage && <LanguageMenu onRequestCloseSettings={onRequestClose} />}
                    {canChangeTheme && <ThemeMenu onRequestCloseSettings={onRequestClose} />}
                </MenuSection>
                <MenuSection>
                    <MenuItem onClick={() => setAdvancedSettingsOpen(true)}>
                        <div className={styles.option}>
                            <FormattedMessage
                                defaultMessage="Advanced Settings"
                                description="Menu item to open the advanced/tweaks settings modal"
                                id="gui.menuBar.advancedSettings"
                            />
                        </div>
                    </MenuItem>
                </MenuSection>
            </MenuBarMenu>
            {advancedSettingsOpen && (
                <AdvancedSettingsModal
                    isRtl={isRtl}
                    vm={vm}
                    onRequestClose={() => {
                        setAdvancedSettingsOpen(false);
                        onRequestClose();
                    }}
                />
            )}
        </div>
    );
};

SettingsMenu.propTypes = {
    canChangeLanguage: PropTypes.bool,
    canChangeTheme: PropTypes.bool,
    isRtl: PropTypes.bool,
    onRequestClose: PropTypes.func,
    onRequestOpen: PropTypes.func,
    settingsMenuOpen: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default SettingsMenu;
