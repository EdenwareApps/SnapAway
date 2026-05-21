const Sentry = require('@sentry/electron/main');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT_SENTRY_DSN = 'https://83cbc4628350ac6bd5001184d1d23365@o4511378553307136.ingest.us.sentry.io/4511378556452864';

const TELEMETRY_LOG_FILE = 'iap-telemetry.log';
let telemetryApp = null;
let telemetryInitialized = false;

function hasSentryClient() {
  try {
    if (Sentry && typeof Sentry.getClient === 'function') {
      return !!Sentry.getClient();
    }
    if (Sentry && typeof Sentry.getCurrentHub === 'function') {
      const hub = Sentry.getCurrentHub();
      return !!(hub && typeof hub.getClient === 'function' && hub.getClient());
    }
  } catch (_) {
    return false;
  }
  return false;
}

function applyScope(mutator) {
  if (typeof mutator !== 'function') {
    return;
  }

  try {
    if (Sentry && typeof Sentry.configureScope === 'function') {
      Sentry.configureScope(mutator);
      return;
    }

    if (Sentry && typeof Sentry.getCurrentScope === 'function') {
      const scope = Sentry.getCurrentScope();
      if (scope) {
        mutator(scope);
      }
      return;
    }

    if (Sentry && typeof Sentry.getCurrentHub === 'function') {
      const hub = Sentry.getCurrentHub();
      if (hub && typeof hub.configureScope === 'function') {
        hub.configureScope(mutator);
      }
    }
  } catch (error) {
    console.warn('[TELEMETRY] Failed to apply Sentry scope mutation:', error && error.message ? error.message : error);
  }
}

function withTelemetryScope(callback) {
  if (typeof callback !== 'function') {
    return;
  }

  try {
    if (Sentry && typeof Sentry.withScope === 'function') {
      Sentry.withScope(callback);
      return;
    }

    if (Sentry && typeof Sentry.withIsolationScope === 'function') {
      Sentry.withIsolationScope(callback);
      return;
    }

    if (Sentry && typeof Sentry.getCurrentScope === 'function') {
      const scope = Sentry.getCurrentScope();
      callback(scope || {});
      return;
    }

    callback({});
  } catch (error) {
    console.warn('[TELEMETRY] Failed to run Sentry scoped callback:', error && error.message ? error.message : error);
  }
}

function getTelemetryPath() {
  if (!telemetryApp) {
    return path.join(process.cwd(), TELEMETRY_LOG_FILE);
  }

  try {
    return path.join(telemetryApp.getPath('userData'), TELEMETRY_LOG_FILE);
  } catch (error) {
    return path.join(process.cwd(), TELEMETRY_LOG_FILE);
  }
}

function writePersistentTelemetryLog(eventName, details = null) {
  try {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      event: eventName,
      details
    });
    fs.appendFileSync(getTelemetryPath(), `${line}${os.EOL}`, 'utf8');
  } catch (error) {
    console.error('[TELEMETRY] Failed to append telemetry log:', error && error.message ? error.message : error);
  }
}

function isSentryEnabled() {
  return !!(process.env.SENTRY_DSN || DEFAULT_SENTRY_DSN);
}

function getRelease(app) {
  const appVersion = app && typeof app.getVersion === 'function' ? app.getVersion() : process.env.SENTRY_RELEASE || 'unknown';
  const appName = app && typeof app.getName === 'function' ? app.getName() : 'snapaway';
  return `${appName}@${appVersion}`;
}

function sanitizeTelemetryValue(value) {
  if (typeof value === 'string') {
    if (value.includes('C:') || value.includes('\\') || value.includes('/')) {
      return '[redacted_path]';
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeTelemetryValue);
  }

  if (value && typeof value === 'object') {
    return sanitizeTelemetryDetails(value);
  }

  return value;
}

function sanitizeTelemetryDetails(details) {
  if (!details || typeof details !== 'object') {
    return details;
  }

  const sanitized = {};
  for (const key of Object.keys(details)) {
    const value = details[key];
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('path') || lowerKey.includes('file') || lowerKey.includes('url') || lowerKey.includes('username') || lowerKey.includes('user')) {
      sanitized[key] = '[redacted]';
      continue;
    }

    sanitized[key] = sanitizeTelemetryValue(value);
  }

  return sanitized;
}

const SENTRY_EVENT_WHITELIST = new Set([
  'startup.diagnostics',
  'gpu.environment',
  'app.render-process-gone',
  'window.render-process-gone',
  'app.child-process-gone',
  'app.gpu-process-crashed',
  'process.uncaughtException',
  'process.unhandledRejection'
]);

function initMainTelemetry(app, options = {}) {
  telemetryApp = app;
  const dsn = process.env.SENTRY_DSN || DEFAULT_SENTRY_DSN;
  const environment = process.env.NODE_ENV || (process.env.ELECTRON_IS_DEV ? 'development' : 'production');
  const release = process.env.SENTRY_RELEASE || getRelease(app);

  if (dsn) {
    Sentry.init({
      dsn,
      release,
      environment,
      debug: process.env.SENTRY_DEBUG === 'true',
      enableJavaScript: true,
      enableNative: true,
      attachStacktrace: true,
      autoSessionTracking: false,
      beforeSend(event) {
        return event;
      }
    });

    applyScope(scope => {
      scope.setTag('process', 'main');
      scope.setTag('installContext', options.isStoreInstall ? 'store' : 'standalone');
      scope.setContext('gpuPolicy', options.gpuPolicyFlags || {});
      scope.setContext('environment', {
        platform: process.platform,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node,
        release,
        isPackaged: app.isPackaged
      });
    });

    captureTelemetryEvent('telemetry.initialized', {
      startupMode: options.startupMode || 'normal',
      transparency: true,
      customTitlebar: true,
      floatingOverlay: true
    });
  } else {
    console.warn('[TELEMETRY] Sentry disabled because SENTRY_DSN is not configured. Persistent telemetry log is still active.');
  }

  telemetryInitialized = true;

  const captureStartupDiagnosticsWhenReady = () => {
    try {
      captureStartupDiagnostics(app, options);
    } catch (error) {
      captureTelemetryException(error, { source: 'captureStartupDiagnostics' });
    }
  };

  if (app.isReady && app.isReady()) {
    captureStartupDiagnosticsWhenReady();
    captureGpuEnvironment(app, options);
  } else if (app.whenReady) {
    app.whenReady().then(() => {
      captureStartupDiagnosticsWhenReady();
      return captureGpuEnvironment(app, options);
    }).catch(error => {
      captureTelemetryException(error, { source: 'captureStartupDiagnostics.whenReady' });
    });
  }

  return telemetryInitialized;
}

function captureTelemetryEvent(eventName, details = {}, options = {}) {
  const sanitizedDetails = sanitizeTelemetryDetails(details);
  writePersistentTelemetryLog(eventName, sanitizedDetails);

  const shouldSend = options.sendToSentry === true || SENTRY_EVENT_WHITELIST.has(eventName);
  if (shouldSend && isSentryEnabled() && hasSentryClient()) {
    withTelemetryScope(scope => {
      if (scope && typeof scope.setExtras === 'function') {
        scope.setExtras(sanitizedDetails);
      }
      if (scope && typeof scope.setTag === 'function') {
        scope.setTag('eventName', eventName);
      }
      if (scope && typeof scope.setLevel === 'function') {
        scope.setLevel('info');
      }
      if (typeof Sentry.captureMessage === 'function') {
        Sentry.captureMessage(eventName);
      }
    });
  }
}

function captureTelemetryException(error, details = {}) {
  const sanitizedDetails = sanitizeTelemetryDetails(details);
  writePersistentTelemetryLog('telemetry.exception', Object.assign({ message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : null }, sanitizedDetails));

  if (isSentryEnabled() && hasSentryClient()) {
    withTelemetryScope(scope => {
      if (scope && typeof scope.setExtras === 'function') {
        scope.setExtras(sanitizedDetails);
      }
      if (scope && typeof scope.setTag === 'function') {
        scope.setTag('errorSource', sanitizedDetails.source || 'main');
      }
      if (typeof Sentry.captureException === 'function') {
        Sentry.captureException(error);
      }
    });
  }
}

function setTelemetryContext(section, data) {
  if (!isSentryEnabled() || !hasSentryClient()) {
    return;
  }
  applyScope(scope => {
    if (scope && typeof scope.setContext === 'function') {
      scope.setContext(section, data);
    }
  });
}

async function captureGpuEnvironment(app, options = {}) {
  if (!app || typeof app.getGPUInfo !== 'function') {
    captureTelemetryEvent('gpu.environment.missing', { message: 'GPU API not available' });
    return;
  }

  try {
    const gpuFeatureStatus = app.getGPUFeatureStatus();
    const gpuInfo = await app.getGPUInfo('basic');
    const graphics = gpuInfo?.graphics || {};
    const adapter = graphics?.adapter || null;
    const driver = graphics?.driver || null;
    const vendor = graphics?.vendor || null;
    const deviceId = graphics?.deviceId || null;
    const vendorId = graphics?.vendorId || null;
    const driverVersion = graphics?.driverVersion || null;
    const angleBackend = graphics?.angleBackend || null;

    const payload = {
      gpuFeatureStatus,
      adapter,
      vendor,
      vendorId,
      deviceId,
      driver,
      driverVersion,
      angleBackend,
      transparentWindow: true,
      titlebar: 'custom',
      storeInstall: !!options.isStoreInstall,
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      windowsVersion: os.release(),
      osArch: os.arch()
    };

    captureTelemetryEvent('gpu.environment', payload);
    setTelemetryContext('gpu', payload);
  } catch (error) {
    captureTelemetryException(error, { source: 'gpuEnvironment' });
  }
}

function captureStartupDiagnostics(app, options = {}) {
  const gpuPolicy = options.gpuPolicyFlags || {};
  const displayInfo = options.screen || {};
  const diagnostics = {
    transparency: true,
    hardwareAccelerationDisabled: gpuPolicy.disableGpu === true,
    gpuCompositingDisabled: gpuPolicy.disableGpuCompositing === true,
    softwareRendering: gpuPolicy.softwareRendering === true,
    displayScaling: typeof displayInfo.getPrimaryDisplay === 'function' ? displayInfo.getPrimaryDisplay().scaleFactor : null,
    monitorCount: typeof displayInfo.getAllDisplays === 'function' ? displayInfo.getAllDisplays().length : null,
    windowsStore: options.isStoreInstall === true,
    isPackaged: app.isPackaged
  };

  captureTelemetryEvent('startup.diagnostics', diagnostics);
  setTelemetryContext('startup', diagnostics);
}

module.exports = {
  initMainTelemetry,
  captureTelemetryEvent,
  captureTelemetryException,
  setTelemetryContext,
  captureGpuEnvironment,
  writePersistentTelemetryLog,
  getTelemetryPath
};
