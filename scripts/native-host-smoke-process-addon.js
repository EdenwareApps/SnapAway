'use strict';
// Smoke test for process_addon (C N-API migration)
// Run with: npx electron scripts/native-host-smoke-process-addon.js

const path = require('path');
const addonPath = path.join(__dirname, '..', 'src', 'process', 'build', 'Release', 'process_addon.node');

console.log('process-addon smoke start');
let addon;
try {
    addon = require(addonPath);
} catch (e) {
    console.error('process-addon LOAD FAILED:', e.message);
    process.exit(1);
}

const keys = Object.keys(addon);
console.log('process-addon loaded keys:', keys);
if (!addon.ProcessManager) { console.error('MISSING ProcessManager'); process.exit(1); }

let pm;
try {
    pm = new addon.ProcessManager();
} catch (e) {
    console.error('ProcessManager constructor FAILED:', e.message);
    process.exit(1);
}

// enumWindows
let wins;
try {
    wins = pm.enumWindows();
    console.log('enumWindows returned', Array.isArray(wins) ? wins.length : typeof wins, 'windows');
    if (wins.length > 0) {
        const w = wins[0];
        console.log('first window sample:', { hwnd: w.hwnd, title: w.title && w.title.slice(0, 40), pid: w.processId });
    }
} catch (e) {
    console.error('enumWindows FAILED:', e.message);
    process.exit(1);
}

// isWindow with the first HWND we got
if (wins && wins.length > 0) {
    try {
        const w0 = wins[0];
        const r = pm.isWindow(w0.hwnd);
        console.log('isWindow(first):', r);
        const txt = pm.getWindowText(w0.hwnd);
        console.log('getWindowText(first):', txt && txt.slice(0, 40));
        const cls = pm.getClassName(w0.hwnd);
        console.log('getClassName(first):', cls && cls.slice(0, 40));
        const ids = pm.getWindowThreadProcessId(w0.hwnd);
        console.log('getWindowThreadProcessId(first):', ids);
    } catch (e) {
        console.error('method call FAILED:', e.message);
        process.exit(1);
    }
}

console.log('process-addon smoke ok');
process.exit(0);
