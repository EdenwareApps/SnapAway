const path = require('path');
const { app } = require('electron');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const iapModulePath = path.join(__dirname, '..', 'src', 'iap', 'index.js');
const iap = require(iapModulePath);
const storeProductId = '9NNLVZPCLLTZ';

async function runIapTests() {
  console.log('[TEST-IAP] IAP module path:', iapModulePath);

  try {
    const products = await iap.getProducts();
    console.log('[TEST-IAP] getProducts result:', products);
  } catch (error) {
    console.error('[TEST-IAP] getProducts failed:', error);
    process.exit(1);
  }

  try {
    const licenseInfo = await iap.getLicenseInfo();
    console.log('[TEST-IAP] getLicenseInfo result:', licenseInfo);
  } catch (error) {
    console.error('[TEST-IAP] getLicenseInfo failed:', error);
    process.exit(1);
  }

  try {
    const owned = await iap.checkOwnership(storeProductId);
    console.log('[TEST-IAP] checkOwnership result:', owned);
  } catch (error) {
    console.error('[TEST-IAP] checkOwnership failed:', error);
    process.exit(1);
  }

  console.log('[TEST-IAP] IAP smoke test passed');
  process.exit(0);
}

app.whenReady().then(runIapTests).catch((error) => {
  console.error('[TEST-IAP] Electron app failed to initialize:', error);
  process.exit(1);
});

app.on('window-all-closed', () => {
  // no windows are created for this test
});
