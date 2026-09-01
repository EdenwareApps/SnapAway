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

// Ambiente do Sentry: 'production' quando empacotado (NODE_ENV=production ou
// sem ELECTRON_IS_DEV), 'development' em execução de desenvolvimento.
function getTelemetryEnvironment() {
  return process.env.NODE_ENV || (process.env.ELECTRON_IS_DEV ? 'development' : 'production');
}

function isProductionEnvironment() {
  return getTelemetryEnvironment() === 'production';
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

// Eventos que representam falhas/diagnósticos e DEVEM virar issue no Sentry.
// (Eventos informativos como gpu.environment/startup.diagnostics ficam fora
// desta lista: vão apenas ao log persistente, evitando ruído de issues — o
// Sentry trataria captureMessage de nível info como um novo issue por boot.)
const SENTRY_ISSUE_EVENTS = new Set([
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
  const environment = getTelemetryEnvironment();
  const release = process.env.SENTRY_RELEASE || getRelease(app);

  // Enviar ao Sentry apenas em produção (app empacotado). Em desenvolvimento
  // não inicializamos o cliente: nada de JS nem minidumps nativos chega ao
  // Sentry, evitando ruído como o crash OOM de dev (Sentry ELECTRON-9).
  // O log persistente iap-telemetry.log continua ativo nos dois casos.
  if (dsn && isProductionEnvironment()) {
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
        // Título útil dos issues de telemetria: quando o evento tem a tag
        // eventName, garante que o título mostre o NOME do evento (ex.:
        // "app.render-process-gone") em vez do culprit genérico
        // "withTelemetryScope". O fingerprint já separa cada evento no seu
        // próprio issue; aqui só ajustamos o título. Só remove a "exceção"
        // sintética (stack do captureMessage), nunca erros reais.
        const evtName = event.tags && event.tags.eventName;
        if (evtName) {
          event.message = evtName;
          const values = event.exception && event.exception.values;
          if (values && values.length > 0 && !values[0].type && values[0].value === evtName) {
            delete event.exception;
          }
        }
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
  } else if (dsn) {
    console.warn('[TELEMETRY] Sentry disabled in development environment. Persistent telemetry log is still active.');
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

  // Ruído conhecido (ELECTRON-8): renderer que NÃO chega a subir (reason
  // 'launch-failed'). No overlay isso é ambiental (AV/GPU/recursos), não é bug
  // do app — suprimimos aqui para não virar issue no Sentry (continua no log
  // persistente). Trade-off: um launch-failed da janela PRINCIPAL também seria
  // suprimido, mas isso seria catastrófico e apareceria por outros sinais.
  const renderReason = details && details.reason;
  if (renderReason === 'launch-failed' &&
      (eventName === 'window.render-process-gone' || eventName === 'app.render-process-gone')) {
    return;
  }

  const shouldSend = options.sendToSentry === true || SENTRY_ISSUE_EVENTS.has(eventName);
  if (shouldSend && isSentryEnabled() && hasSentryClient()) {
    withTelemetryScope(scope => {
      if (scope && typeof scope.setExtras === 'function') {
        scope.setExtras(sanitizedDetails);
      }
      if (scope && typeof scope.setTag === 'function') {
        scope.setTag('eventName', eventName);
      }
      if (scope && typeof scope.setFingerprint === 'function') {
        // Agrupa cada tipo de evento no seu próprio issue (ex.:
        // "window.render-process-gone"), em vez de todos caírem num único
        // issue "withTelemetryScope" (ELECTRON-3) — o stack é idêntico p/ todos.
        scope.setFingerprint([eventName]);
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

let partnerCenterCustomEventLogger = null;

// Permite plugar um logger nativo de custom events da Microsoft Store (Store
// Services SDK: Microsoft.Services.Store.Engagement.StoreServicesCustomEventLogger).
// Quando presente, captureProductEvent também encaminha o evento ao Partner
// Center (“Eventos personalizados”). Sem o SDK, é um no-op silencioso.
function setPartnerCenterCustomEventLogger(logger) {
  partnerCenterCustomEventLogger = typeof logger === 'function' ? logger : null;
}

// Eventos de produto/analítica (retenção, funil). Sempre gravam no log
// persistente. Vão ao Sentry apenas se solicitado (sendToSentry=true) — por
// padrão eventos de retenção NÃO viram issue no Sentry, evitando ruído. Se um
// logger de custom events da Store estiver plugado, o evento também é
// encaminhado ao Partner Center.
function captureProductEvent(eventName, details = {}, options = {}) {
  const sanitizedDetails = sanitizeTelemetryDetails(details);
  writePersistentTelemetryLog(eventName, sanitizedDetails);

  if (options.sendToSentry === true && isSentryEnabled() && hasSentryClient()) {
    withTelemetryScope(scope => {
      if (scope && typeof scope.setExtras === 'function') {
        scope.setExtras(sanitizedDetails);
      }
      if (scope && typeof scope.setTag === 'function') {
        scope.setTag('eventName', eventName);
      }
      if (scope && typeof scope.setFingerprint === 'function') {
        // Mesmo agrupamento por nome de evento dos issue events.
        scope.setFingerprint([eventName]);
      }
      if (scope && typeof scope.setLevel === 'function') {
        scope.setLevel('info');
      }
      if (typeof Sentry.captureMessage === 'function') {
        Sentry.captureMessage(eventName);
      }
    });
  }

  if (typeof partnerCenterCustomEventLogger === 'function') {
    try {
      partnerCenterCustomEventLogger(eventName, sanitizedDetails);
    } catch (error) {
      console.warn('[TELEMETRY] Failed to log Partner Center custom event:', error && error.message ? error.message : error);
    }
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
  captureProductEvent,
  setPartnerCenterCustomEventLogger,
  captureTelemetryException,
  setTelemetryContext,
  captureGpuEnvironment,
  writePersistentTelemetryLog,
  getTelemetryPath
};
