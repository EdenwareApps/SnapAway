const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('../config/config.js');
const extractIcons = require('../icon-extractor/icon-extractor.js');

const platform = os.platform();
let platformModule;

if (platform === 'win32') {
    platformModule = require('./win32-support.js');
} else if (platform === 'linux') {
    platformModule = require('./linux-support.js');
} else if (platform === 'darwin') {
    platformModule = require('./macos-support.js');
} else {
    throw new Error('Plataforma não suportada');
}

const icons = {};
const events = new EventEmitter();

async function list(serializable = false, hideSystemWindows = false) {
    return platformModule.list(serializable, hideSystemWindows);
}

async function hideWindows() {
    return platformModule.hideWindows();
}

async function showWindows() {
    return platformModule.showWindows();
}

function updateConfig(newConfig) {
    Object.assign(config, newConfig);
    if (!Array.isArray(config.hiddenWindows)) {
        config.hiddenWindows = [];
    }
}

function getProcessPIDsByName(processName) {
    return platformModule.getProcessPIDsByName(processName);
}

async function setProcessPriority(above = false) {
    return platformModule.setProcessPriority(above);
}

module.exports = {
    list,
    hideWindows,
    showWindows,
    updateConfig,
    events,
    hiddenWindows: () => config.hiddenWindows,
    setProcessPriority,
    ...platformModule
};