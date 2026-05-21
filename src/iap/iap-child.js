const path = require('path');
const fs = require('fs');

function sendMessage(message) {
  if (process.send) {
    process.send(message);
  }
}

function buildResult(id, result) {
  return { id, result };
}

function buildError(id, error) {
  return { id, error: String(error), stack: error && error.stack ? error.stack : null };
}

function loadIapModule() {
  let modulePath = path.join(__dirname, 'iap-wrapper.js');
  if (!fs.existsSync(modulePath) && process.resourcesPath) {
    const candidates = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'iap-wrapper.js'),
      path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'iap-wrapper.js'),
      path.join(process.resourcesPath, 'app', 'out', 'main', 'iap-wrapper.js'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'iap', 'iap-wrapper.js'),
      path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'iap', 'iap-wrapper.js'),
      path.join(process.resourcesPath, 'app', 'out', 'main', 'iap', 'iap-wrapper.js')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        modulePath = candidate;
        break;
      }
    }
  }
  console.log('[IAP-CHILD] loading IAP wrapper at:', modulePath);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`IAP helper module not found: ${modulePath}`);
  }
  return require(modulePath);
}

let iap = null;
try {
  iap = loadIapModule();
  sendMessage({ type: 'ready' });
} catch (error) {
  console.error('[IAP-CHILD] Failed to load IAP module:', error);
  sendMessage({ type: 'ready', error: String(error), stack: error.stack });
}

process.on('message', async (message) => {
  if (!message || typeof message !== 'object' || !message.id) {
    return;
  }

  const { id, action, args = [] } = message;

  if (!iap) {
    console.error('[IAP-CHILD] request received but IAP module unavailable', { action, args });
    return sendMessage(buildError(id, new Error('IAP module not available')));
  }

  console.log('[IAP-CHILD] request received', { id, action, args });
  try {
    let result;
    switch (action) {
      case 'checkOwnership':
        result = await iap.checkOwnership(...args);
        break;
      case 'getLicenseInfo':
        result = await iap.getLicenseInfo(...args);
        break;
      case 'requestPurchase':
        result = await iap.requestPurchase(...args);
        break;
      case 'getProducts':
        result = await iap.getProducts(...args);
        break;
      case 'initStoreContext':
        result = await iap.initStoreContext(...args);
        break;
      case 'getIapStatus':
        result = {
          available: typeof iap.isNativeModuleAvailable === 'function' ? iap.isNativeModuleAvailable() : true,
          diagnostics: typeof iap.getNativeModuleDiagnostics === 'function' ? iap.getNativeModuleDiagnostics() : null
        };
        break;
      default:
        throw new Error(`Unknown IAP action: ${action}`);
    }

    console.log('[IAP-CHILD] request completed', { id, action });
    sendMessage(buildResult(id, result));
  } catch (error) {
    console.error('[IAP-CHILD] Error handling action', action, error);
    sendMessage(buildError(id, error));
  }
});

process.on('uncaughtException', (error) => {
  console.error('[IAP-CHILD] uncaughtException:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[IAP-CHILD] unhandledRejection:', reason);
  process.exit(1);
});
