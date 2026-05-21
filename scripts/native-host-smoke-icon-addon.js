'use strict';
// Smoke test for icon_addon (C N-API migration)
// Run with: npx electron scripts/native-host-smoke-icon-addon.js

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const addonPath = path.join(__dirname, '..', 'src', 'icons', 'build', 'Release', 'icon_addon.node');

console.log('icon-addon smoke start');
let addon;
try {
    addon = require(addonPath);
} catch (e) {
    console.error('icon-addon LOAD FAILED:', e.message);
    process.exit(1);
}

const keys = Object.keys(addon);
console.log('icon-addon loaded keys:', keys);
if (!addon.IconExtractor) { console.error('MISSING IconExtractor'); process.exit(1); }

let extractor;
try {
    extractor = new addon.IconExtractor();
} catch (e) {
    console.error('IconExtractor constructor FAILED:', e.message);
    process.exit(1);
}

// initialize
const initOk = extractor.initialize();
console.log('initialize():', initOk);
if (!initOk) {
    console.warn('initialize failed (may be OK in headless env) – continuing');
}

// extractIcon – use notepad.exe as a known target
const execPath = 'C:\\Windows\\System32\\notepad.exe';
const outPath  = path.join(os.tmpdir(), 'snapaway-smoke-icon.png');

let extractOk = false;
try {
    extractOk = extractor.extractIcon(execPath, outPath);
    console.log('extractIcon(notepad.exe):', extractOk);
    if (extractOk && fs.existsSync(outPath)) {
        const stat = fs.statSync(outPath);
        console.log('output PNG size:', stat.size, 'bytes');
        fs.unlinkSync(outPath);
    }
} catch (e) {
    console.error('extractIcon FAILED:', e.message);
    process.exit(1);
}

// cleanup
extractor.cleanup();

console.log('icon-addon smoke ok');
process.exit(0);
