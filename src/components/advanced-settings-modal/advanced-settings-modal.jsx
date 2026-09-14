import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape, FormattedMessage} from 'react-intl';
import ReactModal from 'react-modal';
import VM from 'scratch-vm';

import Box from '../box/box.jsx';
import tweaks from '../../lib/tweaks.js';
import {loadTweaks, saveTweaks} from '../../lib/tweaks-persistence.js';

import styles from './advanced-settings-modal.css';

const messages = defineMessages({
    label: {
        id: 'gui.advancedSettings.label',
        defaultMessage: 'Advanced Settings',
        description: 'Advanced settings modal title - for accessibility'
    },
    intro: {
        id: 'gui.advancedSettings.intro',
        defaultMessage: 'Runtime tweaks in the spirit of TurboWarp. These affect how the project ' +
            'currently running behaves — they are not saved into the .sb3 file.',
        description: 'Intro text for the advanced settings modal'
    },
    framerateLabel: {
        id: 'gui.advancedSettings.framerate',
        defaultMessage: 'Framerate',
        description: 'Label for the framerate slider'
    },
    turboModeLabel: {
        id: 'gui.advancedSettings.turboMode',
        defaultMessage: 'Turbo Mode',
        description: 'Label for the turbo mode checkbox'
    },
    turboModeHint: {
        id: 'gui.advancedSettings.turboModeHint',
        defaultMessage: 'Skip screen redraws between steps to run scripts as fast as possible.',
        description: 'Explanation of turbo mode'
    },
    infiniteClonesLabel: {
        id: 'gui.advancedSettings.infiniteClones',
        defaultMessage: 'Infinite Clones',
        description: 'Label for the infinite clones checkbox'
    },
    infiniteClonesHint: {
        id: 'gui.advancedSettings.infiniteClonesHint',
        defaultMessage: 'Remove the 300-clone limit.',
        description: 'Explanation of infinite clones'
    },
    removeFencingLabel: {
        id: 'gui.advancedSettings.removeFencing',
        defaultMessage: 'Remove Fencing',
        description: 'Label for the remove fencing checkbox'
    },
    removeFencingHint: {
        id: 'gui.advancedSettings.removeFencingHint',
        defaultMessage: 'Let sprites move fully off-stage instead of being held at the edge.',
        description: 'Explanation of remove fencing'
    },
    removeListLimitLabel: {
        id: 'gui.advancedSettings.removeListLimit',
        defaultMessage: 'Remove List Limit',
        description: 'Label for the remove list limit checkbox'
    },
    removeListLimitHint: {
        id: 'gui.advancedSettings.removeListLimitHint',
        defaultMessage: 'Remove the 200,000-item cap on lists.',
        description: 'Explanation of remove list limit'
    },
    resetButton: {
        id: 'gui.advancedSettings.reset',
        defaultMessage: 'Reset to defaults',
        description: 'Button to reset all advanced settings to defaults'
    },
    closeButton: {
        id: 'gui.advancedSettings.buttonClose',
        defaultMessage: 'Close',
        description: 'Text for the button which closes the advanced settings modal'
    }
});

const DEFAULT_STATE = {
    framerate: tweaks.DEFAULTS.framerate,
    turboMode: false,
    infiniteClones: false,
    removeFencing: false,
    removeListLimit: false
};

class AdvancedSettingsModal extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleFramerateChange',
            'handleToggle',
            'handleReset'
        ]);
        this.state = Object.assign({}, DEFAULT_STATE, loadTweaks());
    }
    componentDidMount () {
        // Re-apply saved settings to this VM instance (e.g. after a page reload).
        this.applyAll(this.state);
    }
    applyAll (settings) {
        const vm = this.props.vm;
        tweaks.setFramerate(vm, settings.framerate);
        tweaks.setTurboMode(vm, settings.turboMode);
        tweaks.setInfiniteClones(settings.infiniteClones);
        tweaks.setRemoveFencing(settings.removeFencing);
        tweaks.setRemoveListLimit(settings.removeListLimit);
    }
    updateAndPersist (partial) {
        const nextState = Object.assign({}, this.state, partial);
        this.setState(partial);
        saveTweaks(nextState);
        return nextState;
    }
    handleFramerateChange (e) {
        const fps = tweaks.setFramerate(this.props.vm, Number(e.target.value));
        this.updateAndPersist({framerate: fps});
    }
    handleToggle (key, applyFn) {
        return e => {
            const enabled = e.target.checked;
            applyFn(enabled);
            this.updateAndPersist({[key]: enabled});
        };
    }
    handleReset () {
        this.applyAll(DEFAULT_STATE);
        this.setState(DEFAULT_STATE);
        saveTweaks(DEFAULT_STATE);
    }
    render () {
        return (<ReactModal
            isOpen
            className={styles.modalContent}
            contentLabel={this.props.intl.formatMessage(messages.label)}
            overlayClassName={styles.modalOverlay}
            onRequestClose={this.props.onRequestClose}
        >
            <div dir={this.props.isRtl ? 'rtl' : 'ltr'}>
                <Box className={styles.header}>
                    <FormattedMessage {...messages.label} />
                </Box>
                <Box className={styles.body}>
                    <p className={styles.intro}><FormattedMessage {...messages.intro} /></p>

                    <Box className={styles.row}>
                        <label className={styles.rowLabel} htmlFor="redmonk-framerate">
                            <FormattedMessage {...messages.framerateLabel} />
                        </label>
                        <Box className={styles.sliderGroup}>
                            <input
                                id="redmonk-framerate"
                                className={styles.slider}
                                type="range"
                                min="1"
                                max="120"
                                value={this.state.framerate}
                                onChange={this.handleFramerateChange}
                            />
                            <span className={styles.sliderValue}>{this.state.framerate} FPS</span>
                        </Box>
                    </Box>

                    <label className={styles.checkboxRow} htmlFor="redmonk-turbo">
                        <input
                            id="redmonk-turbo"
                            type="checkbox"
                            checked={this.state.turboMode}
                            onChange={this.handleToggle('turboMode', enabled => tweaks.setTurboMode(this.props.vm, enabled))}
                        />
                        <span className={styles.checkboxText}>
                            <span className={styles.checkboxLabel}><FormattedMessage {...messages.turboModeLabel} /></span>
                            <span className={styles.checkboxHint}><FormattedMessage {...messages.turboModeHint} /></span>
                        </span>
                    </label>

                    <label className={styles.checkboxRow} htmlFor="redmonk-clones">
                        <input
                            id="redmonk-clones"
                            type="checkbox"
                            checked={this.state.infiniteClones}
                            onChange={this.handleToggle('infiniteClones', tweaks.setInfiniteClones)}
                        />
                        <span className={styles.checkboxText}>
                            <span className={styles.checkboxLabel}><FormattedMessage {...messages.infiniteClonesLabel} /></span>
                            <span className={styles.checkboxHint}><FormattedMessage {...messages.infiniteClonesHint} /></span>
                        </span>
                    </label>

                    <label className={styles.checkboxRow} htmlFor="redmonk-fencing">
                        <input
                            id="redmonk-fencing"
                            type="checkbox"
                            checked={this.state.removeFencing}
                            onChange={this.handleToggle('removeFencing', tweaks.setRemoveFencing)}
                        />
                        <span className={styles.checkboxText}>
                            <span className={styles.checkboxLabel}><FormattedMessage {...messages.removeFencingLabel} /></span>
                            <span className={styles.checkboxHint}><FormattedMessage {...messages.removeFencingHint} /></span>
                        </span>
                    </label>

                    <label className={styles.checkboxRow} htmlFor="redmonk-list-limit">
                        <input
                            id="redmonk-list-limit"
                            type="checkbox"
                            checked={this.state.removeListLimit}
                            onChange={this.handleToggle('removeListLimit', tweaks.setRemoveListLimit)}
                        />
                        <span className={styles.checkboxText}>
                            <span className={styles.checkboxLabel}><FormattedMessage {...messages.removeListLimitLabel} /></span>
                            <span className={styles.checkboxHint}><FormattedMessage {...messages.removeListLimitHint} /></span>
                        </span>
                    </label>

                    <Box className={styles.buttonRow}>
                        <button
                            className={styles.resetButton}
                            onClick={this.handleReset}
                        >
                            <FormattedMessage {...messages.resetButton} />
                        </button>
                        <button
                            className={styles.closeButton}
                            onClick={this.props.onRequestClose}
                        >
                            <FormattedMessage {...messages.closeButton} />
                        </button>
                    </Box>
                </Box>
            </div>
        </ReactModal>);
    }
}

AdvancedSettingsModal.propTypes = {
    intl: intlShape.isRequired,
    isRtl: PropTypes.bool,
    onRequestClose: PropTypes.func.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(AdvancedSettingsModal);
