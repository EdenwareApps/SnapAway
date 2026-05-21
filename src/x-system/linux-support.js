const path = require('path');
const config = require('../config/config.js');

async function list() {
    return [];
}

async function hideWindows() {
    return [];
}

async function showWindows() {
    return [];
}

function getProcessPIDsByName() {
    return Promise.resolve([]);
}

async function setProcessPriority() {
    return { success: false, message: 'setProcessPriority is not supported on Linux in this build' };
}

module.exports = {
    list,
    hideWindows,
    showWindows,
    getProcessPIDsByName,
    setProcessPriority
};