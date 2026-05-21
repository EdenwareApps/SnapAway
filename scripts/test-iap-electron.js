const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const outMain = path.join(root, 'out', 'main');
const srcIap = path.join(root, 'src', 'iap');
const wrapperSource = path.join(srcIap, 'iap-wrapper.js');
const childSource = path.join(srcIap, 'iap-child.js');
const distAddon = path.join(root, 'dist', 'iap_addon.node');
const buildAddon = path.join(srcIap, 'build', 'Release', 'iap_addon.node');
const outAddon = path.join(outMain, 'iap_addon.node');
const wrapperPath = path.join(outMain, 'iap-wrapper.js');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    return false;
  }
  fs.copyFileSync(src, dest);
  console.log(`[TEST-IAP-ELECTRON] Copied ${src} -> ${dest}`);
  return true;
}

function prepareOutMain() {
  ensureDir(outMain);

  if (!copyIfExists(wrapperSource, wrapperPath)) {
    throw new Error(`Missing source wrapper: ${wrapperSource}`);
  }
  if (!copyIfExists(childSource, path.join(outMain, 'iap-child.js'))) {
    throw new Error(`Missing source child helper: ${childSource}`);
  }

  if (!fs.existsSync(outAddon)) {
    if (!copyIfExists(buildAddon, outAddon) && !copyIfExists(distAddon, outAddon)) {
      console.warn(`[TEST-IAP-ELECTRON] Warning: native addon not found at ${buildAddon} or ${distAddon}`);
    }
  } else {
    console.log(`[TEST-IAP-ELECTRON] Native addon already present at ${outAddon}`);
  }
}

function assertFileExists(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found: ${file}`);
  }
}

async function runTests() {
  prepareOutMain();
  assertFileExists(wrapperPath);

  console.log('[TEST-IAP-ELECTRON] Electron ready');
  const iap = require(wrapperPath);

  if (typeof iap.waitForIapChildReady === 'function') {
    console.log('[TEST-IAP-ELECTRON] Waiting for IAP child helper');
    const ready = await iap.waitForIapChildReady(10000);
    console.log('[TEST-IAP-ELECTRON] IAP child ready:', ready);
  }

  const status = iap.getNativeModuleDiagnostics ? iap.getNativeModuleDiagnostics() : null;
  console.log('[TEST-IAP-ELECTRON] IAP diagnostics:', status);

  const available = iap.isNativeModuleAvailable ? iap.isNativeModuleAvailable() : false;
  console.log('[TEST-IAP-ELECTRON] IAP available:', available);

  try {
    const products = await iap.getProducts();
    console.log('[TEST-IAP-ELECTRON] getProducts result:', products);
  } catch (error) {
    console.error('[TEST-IAP-ELECTRON] getProducts failed:', error);
    process.exit(1);
  }

  try {
    const licenseInfo = await iap.getLicenseInfo();
    console.log('[TEST-IAP-ELECTRON] getLicenseInfo result:', licenseInfo);
  } catch (error) {
    console.error('[TEST-IAP-ELECTRON] getLicenseInfo failed:', error);
    process.exit(1);
  }

  try {
    const ownership = await iap.checkOwnership('9NNLVZPCLLTZ');
    console.log('[TEST-IAP-ELECTRON] checkOwnership result:', ownership);
  } catch (error) {
    console.error('[TEST-IAP-ELECTRON] checkOwnership failed:', error);
    process.exit(1);
  }

  try {
    const purchaseResult = await iap.requestPurchase('9NNLVZPCLLTZ');
    console.log('[TEST-IAP-ELECTRON] requestPurchase result:', purchaseResult);

    const purchaseErrorText = purchaseResult && purchaseResult.error ? String(purchaseResult.error) : '';
    if (purchaseErrorText.toLowerCase().includes('ui thread')) {
      console.warn('[TEST-IAP-ELECTRON] requestPurchase requires UI thread in this context; treated as expected for smoke test.');
    }
  } catch (error) {
    const errorText = error && error.message ? error.message : String(error);
    if (errorText.toLowerCase().includes('ui thread')) {
      console.warn('[TEST-IAP-ELECTRON] requestPurchase requires UI thread in this context; treated as expected for smoke test.');
    } else {
      console.error('[TEST-IAP-ELECTRON] requestPurchase failed:', error);
      process.exit(1);
    }
  }

  console.log('[TEST-IAP-ELECTRON] Electron IAP smoke test passed');
  process.exit(0);
}

app.on('window-all-closed', () => {});
app.whenReady().then(runTests).catch((error) => {
  console.error('[TEST-IAP-ELECTRON] Fatal error:', error);
  process.exit(1);
});
