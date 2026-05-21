const Sentry = require('@sentry/electron/renderer');
const DEFAULT_SENTRY_DSN = 'https://83cbc4628350ac6bd5001184d1d23365@o4511378553307136.ingest.us.sentry.io/4511378556452864';

function applyRendererScope(mutator) {
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
    console.warn('[RENDERER-TELEMETRY] Failed to apply Sentry scope mutation:', error && error.message ? error.message : error);
  }
}

function sanitizeRendererPayload(value) {
  if (typeof value === 'string') {
    if (value.includes('C:') || value.includes('\\') || value.includes('/') || value.toLowerCase().includes('username')) {
      return '[redacted]';
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeRendererPayload);
  }

  if (value && typeof value === 'object') {
    return sanitizeRendererDetails(value);
  }

  return value;
}

function sanitizeRendererDetails(details) {
  if (!details || typeof details !== 'object') {
    return details;
  }

  const sanitized = {};
  for (const key of Object.keys(details)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('path') || lowerKey.includes('file') || lowerKey.includes('url') || lowerKey.includes('username') || lowerKey.includes('user')) {
      sanitized[key] = '[redacted]';
      continue;
    }
    sanitized[key] = sanitizeRendererPayload(details[key]);
  }
  return sanitized;
}

function beforeSend(event) {
  if (event.user) {
    event.user = undefined;
  }

  if (event.request) {
    event.request = undefined;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = [];
  }

  if (event.tags) {
    for (const key of Object.keys(event.tags)) {
      event.tags[key] = sanitizeRendererPayload(event.tags[key]);
    }
  }

  if (event.extra) {
    event.extra = sanitizeRendererDetails(event.extra);
  }

  return event;
}

function initRendererTelemetry() {
  const dsn = process.env.SENTRY_DSN || DEFAULT_SENTRY_DSN;
  const environment = process.env.NODE_ENV || (process.env.ELECTRON_IS_DEV ? 'development' : 'production');
  const release = process.env.SENTRY_RELEASE || `renderer@${process.versions.electron}`;

  Sentry.init({
    dsn,
    release,
    environment,
    debug: process.env.SENTRY_DEBUG === 'true',
    enableJavaScript: true,
    enableNative: false,
    attachStacktrace: true,
    autoSessionTracking: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb() {
      return null;
    },
    beforeSend
  });

  applyRendererScope(scope => {
    scope.setTag('process', 'renderer');
    scope.setContext('renderer', {
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      transparentWindow: true,
      customTitlebar: true
    });
  });
}

module.exports = {
  initRendererTelemetry
};
