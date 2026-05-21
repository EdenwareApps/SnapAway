'use strict';
// Smoke test for iap_addon (C N-API stub)
// Run with: npx electron scripts/native-host-smoke-iap-addon.js

const path = require('path');
const addonPath = path.join(__dirname, '..', 'src', 'iap', 'build', 'Release', 'iap_addon.node');

console.log('iap-addon smoke start');
let addon;
try {
    addon = require(addonPath);
} catch (e) {
    console.error('iap-addon LOAD FAILED:', e.message);
    process.exit(1);
}

const keys = Object.keys(addon);
console.log('iap-addon loaded keys:', keys);

const expected = ['checkOwnership','getLicenseInfo','requestPurchase','getProducts','initStoreContext'];
for (const fn of expected) {
    if (typeof addon[fn] !== 'function') {
        console.error('MISSING function:', fn);
        process.exit(1);
    }
}

// checkOwnership
const own = addon.checkOwnership('9NNLVZPCLLTZ');
console.log('checkOwnership:', own);
if (typeof own.isOwned !== 'boolean') { console.error('isOwned not boolean'); process.exit(1); }

// getLicenseInfo
const lic = addon.getLicenseInfo();
console.log('getLicenseInfo:', lic);
if (typeof lic.isPro !== 'boolean') { console.error('isPro not boolean'); process.exit(1); }

// getProducts
const prods = addon.getProducts();
console.log('getProducts:', prods, '(expected empty array)');
if (!Array.isArray(prods)) { console.error('getProducts not array'); process.exit(1); }

// initStoreContext
const ctx = addon.initStoreContext();
console.log('initStoreContext:', ctx);

console.log('iap-addon smoke ok');
process.exit(0);
