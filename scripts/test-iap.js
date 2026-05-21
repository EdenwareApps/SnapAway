const path = require('path');

const iapModulePath = path.join(__dirname, '..', 'src', 'iap', 'index.js');
const iap = require(iapModulePath);
const storeProductId = '9NNLVZPCLLTZ';

console.log('[TEST-IAP] IAP module path:', iapModulePath);

(async () => {
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
    const ownership = await iap.checkOwnership(storeProductId);
    console.log('[TEST-IAP] checkOwnership result:', ownership);
  } catch (error) {
    console.error('[TEST-IAP] checkOwnership failed:', error);
    process.exit(1);
  }

  console.log('[TEST-IAP] IAP smoke test passed');
  process.exit(0);
})();
