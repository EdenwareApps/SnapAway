'use strict';
// Smoke test for windows_addon (C N-API migration)
// Run with: npx electron scripts/native-host-smoke-windows-addon.js

const path = require('path');
const addonPath = path.join(__dirname, '..', 'src', 'windows', 'build', 'Release', 'windows_addon.node');

console.log('windows-addon smoke start');
let addon;
try {
    addon = require(addonPath);
} catch (e) {
    console.error('windows-addon LOAD FAILED:', e.message);
    process.exit(1);
}

const keys = Object.keys(addon);
console.log('windows-addon loaded keys:', keys);

const expected = ['findWindow','showWindow','hideWindow','getWindowText','isWindow',
                  'isWindowVisible','isHungAppWindow','getWindowThreadProcessId',
                  'getClassName','getWindowLongPtr','getWindow','enumWindows',
                  'openProcess','queryFullProcessImageName','closeHandle'];
for (const fn of expected) {
    if (typeof addon[fn] !== 'function') {
        console.error('MISSING function:', fn);
        process.exit(1);
    }
}

// enumWindows returns array of HWND strings
const wins = addon.enumWindows(null);
console.log('enumWindows returned', wins.length, 'windows');
if (wins.length > 0) {
    const hwnd = wins[0];
    console.log('first HWND:', hwnd);
    console.log('isWindow(first):', addon.isWindow(hwnd));
    console.log('getWindowText(first):', String(addon.getWindowText(hwnd)).slice(0, 40));
    console.log('getClassName(first):', String(addon.getClassName(hwnd)).slice(0, 40));
}

console.log('windows-addon smoke ok');
process.exit(0);
