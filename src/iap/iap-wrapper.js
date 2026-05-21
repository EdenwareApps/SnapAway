const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const runtimeRequire = createRequire(__filename);

/**
 * iap-wrapper.js
 * Wrapper for IAP native addon loaded directly in the Electron main process.
 * Handles Windows.Services.Store API bridge and native addon resolution.
 */

const useChildProcess = false;
console.log('[IAP] useChildProcess:', useChildProcess, 'process.versions.electron:', process.versions.electron);

function getDirectNativePaths() {
  const paths = [
    path.join(__dirname, 'iap_addon.node'),
    path.join(process.cwd(), 'out', 'main', 'iap_addon.node'),
    path.join(__dirname, '..', 'iap_addon.node'),
    path.join(__dirname, 'build', 'Release', 'iap_addon.node'),
    path.join(__dirname, 'build', 'Debug', 'iap_addon.node'),
    path.join(process.cwd(), 'src', 'iap', 'build', 'Release', 'iap_addon.node'),
    path.join(process.cwd(), 'src', 'iap', 'build', 'Debug', 'iap_addon.node'),
    '../../../dist/iap_addon.node',
    path.join(process.cwd(), 'dist', 'iap_addon.node')
  ];
  if (process.resourcesPath) {
    paths.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'iap_addon.node'),
      path.join(process.resourcesPath, 'app.asar', 'dist', 'iap_addon.node'),
      path.join(process.resourcesPath, 'app', 'dist', 'iap_addon.node'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'iap_addon.node'),
      path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'iap_addon.node'),
      path.join(process.resourcesPath, 'app', 'out', 'main', 'iap_addon.node')
    );
  }
  return paths;
}

let IapAddon = null;
let IapAddonLoaded = false;
let IapAddonPath = null;
let IapAddonLoadError = null;

function loadNativeModuleDirect() {
  if (IapAddon) return IapAddon;

  const possiblePaths = getDirectNativePaths();

  for (const modulePath of possiblePaths) {
    const fullPath = path.resolve(__dirname, modulePath);
    console.log('[IAP] Trying native module path:', fullPath);

    if (fs.existsSync(fullPath)) {
      try {
        IapAddon = runtimeRequire(fullPath);
        IapAddonLoaded = true;
        IapAddonPath = fullPath;
        IapAddonLoadError = null;
        console.log('[IAP] Loaded native module from:', fullPath);
        return IapAddon;
      } catch (err) {
        IapAddonLoadError = err && err.message ? err.message : String(err);
        console.error('[IAP] Failed to load from', fullPath, ':', IapAddonLoadError);
        if (err && err.stack) {
          console.error('[IAP] Load stack:', err.stack);
        }
      }
    } else {
      console.log('[IAP] Path not found:', fullPath);
    }
  }

  console.warn('[IAP] Native module not found, using fallback stubs');
  return {
    checkOwnership: (productId) => ({ isOwned: false, productId }),
    getLicenseInfo: () => ({ isPro: false, expirationDate: '', features: [], appLimit: 2 }),
    requestPurchase: (productId) => ({ status: 'NotPurchased', productId }),
    getProducts: () => [],
    initStoreContext: () => ({ initialized: false, error: 'Native module unavailable' }),
    isNativeModuleAvailable: () => false,
    getNativeModuleDiagnostics: () => ({ loaded: false, path: null, error: IapAddonLoadError || 'Native module unavailable' })
  };
}

function getDirectNativeAddon() {
  return loadNativeModuleDirect();
}

async function resolveAddonCall(actionName, fn, ...args) {
  let result;
  try {
    result = fn(...args);
  } catch (error) {
    const err = error && error.message ? error : new Error(String(error));
    err.action = actionName;
    throw err;
  }

  const isPromise = result && typeof result.then === 'function';
  if (isPromise) {
    return await result;
  }

  if (Array.isArray(result)) {
    return result;
  }

  if (result && typeof result === 'object') {
    return {
      ...result,
      addonDiagnostics: {
        action: actionName,
        addonResultType: 'object',
        addonResultIsPromise: false,
        message: 'IAP addon returned synchronous object'
      }
    };
  }

  throw new Error(`IAP addon returned unexpected non-object result for ${actionName}: ${typeof result}`);
}

function isNativeModuleAvailable() {
  const addon = loadNativeModuleDirect();
  return !!addon && addon.isNativeModuleAvailable ? addon.isNativeModuleAvailable() : IapAddonLoaded;
}

function getNativeModuleDiagnostics() {
  const addon = loadNativeModuleDirect();
  if (addon && addon.getNativeModuleDiagnostics) {
    return addon.getNativeModuleDiagnostics();
  }
  return {
    loaded: IapAddonLoaded,
    path: IapAddonPath,
    error: IapAddonLoadError
  };
}

async function checkOwnership(productId) {
  const addon = getDirectNativeAddon();
  try {
    return await resolveAddonCall('checkOwnership', addon.checkOwnership.bind(addon), productId);
  } catch (error) {
    console.error('[IAP] checkOwnership error:', error);
    return { isOwned: false, productId, error: error && error.message ? error.message : String(error) };
  }
}

async function getLicenseInfo() {
  const addon = getDirectNativeAddon();
  try {
    return await resolveAddonCall('getLicenseInfo', addon.getLicenseInfo.bind(addon));
  } catch (error) {
    console.error('[IAP] getLicenseInfo error:', error);
    return { isPro: false, error: error && error.message ? error.message : String(error) };
  }
}

async function requestPurchase(productId, hwndLow = 0, hwndHigh = 0) {
  const addon = getDirectNativeAddon();
  try {
    return await resolveAddonCall('requestPurchase', addon.requestPurchase.bind(addon), productId, hwndLow, hwndHigh);
  } catch (error) {
    console.error('[IAP] requestPurchase error:', error);
    return {
      status: 'NetworkError',
      productId,
      error: error && error.message ? error.message : String(error),
      storeContextInitialized: false,
      storeContextError: 'Native module unavailable',
      associatedProductsLoaded: false,
      associatedProductsCount: 0,
      associatedProductFound: false,
      associatedProductIds: '',
      associatedProductsJson: '[]',
      appLicenseAvailable: false,
      licensedAddOnCount: 0,
      licensedProductIds: ''
    };
  }
}

async function getProducts() {
  const addon = getDirectNativeAddon();
  try {
    const result = await resolveAddonCall('getProducts', addon.getProducts.bind(addon));
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error('[IAP] getProducts error:', error);
    return [];
  }
}

async function initStoreContext() {
  const addon = getDirectNativeAddon();
  try {
    return await resolveAddonCall('initStoreContext', addon.initStoreContext.bind(addon));
  } catch (error) {
    console.error('[IAP] initStoreContext error:', error);
    return { initialized: false, error: error && error.message ? error.message : String(error) };
  }
}

module.exports = {
  checkOwnership,
  getLicenseInfo,
  requestPurchase,
  getProducts,
  initStoreContext,
  isNativeModuleAvailable,
  getNativeModuleDiagnostics
};
