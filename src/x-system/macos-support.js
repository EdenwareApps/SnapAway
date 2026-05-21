const path = require('path');
const config = require('../config/config.js');

function makeUnsupported() {
    throw new Error('macOS support is not available in this Windows-specific build.');
}

async function list() {
    return [];
}

async function hideWindows() {
    // No-op on macOS in Windows build context
    return [];
}

async function showWindows() {
    // No-op on macOS in Windows build context
    return [];
}

function getProcessPIDsByName() {
    return Promise.resolve([]);
}

async function setProcessPriority() {
    return { success: false, message: 'setProcessPriority is not supported on macOS in this build' };
}

module.exports = {
    list,
    hideWindows,
    showWindows,
    getProcessPIDsByName,
    setProcessPriority
};