/**
 * retention.js
 * Analítica de retenção e funil do SnapAway.
 *
 * Os eventos de retenção são capturados via telemetry.captureProductEvent:
 *  - sempre gravam no log persistente (iap-telemetry.log em userData);
 *  - NÃO viram issue no Sentry por padrão (evita ruído);
 *  - são encaminhados ao Partner Center ("Eventos personalizados") quando o
 *    logger nativo da Store (Store Services SDK) estiver plugado via
 *    telemetry.setPartnerCenterCustomEventLogger().
 *
 * Eventos emitidos:
 *  - retention.launch            : toda inicialização do app
 *  - retention.first_launch      : primeira execução do dispositivo
 *  - retention.return.d{1,2,3,7,14,30} : retorno no dia N (uma vez por dispositivo)
 *  - retention.first_hide        : primeiro uso real do recurso central (hide)
 *  - retention.pro_modal_viewed  : modal Pro exibido (vindo do renderer)
 *  - retention.purchase_started  : diálogo de compra da Store aberto
 *  - retention.purchase_completed: compra concluída na Store
 *  - retention.purchase_failed   : falha/erro no fluxo de compra da Store
 */

const telemetry = require('./telemetry');

const RETENTION_DAY_MARKERS = [1, 2, 3, 7, 14, 30];
const DAY_MS = 86400000;

function trackRetentionEvent(eventName, details = {}, options = {}) {
  if (!telemetry || typeof telemetry.captureProductEvent !== 'function') {
    return;
  }
  telemetry.captureProductEvent(eventName, details, options);
}

// Marca o primeiro launch (instalação -> primeiro uso). Retorna true se este
// foi o primeiro launch detectado nesta execução.
function markFirstLaunchIfNeeded(config) {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const now = Date.now();
  if (!config.firstLaunchAt) {
    config.firstLaunchAt = now;
    trackRetentionEvent('retention.first_launch', {
      firstLaunchAt: now
    });
    return true;
  }
  return false;
}

// Dispara marcadores de retorno (d1/d2/d3/d7/d14/d30) uma única vez por
// dispositivo, com base em quantos dias se passaram desde o primeiro launch.
// Cada marcador é deduplicado via config.retentionMarkers.
function trackReturnOnLaunch(config) {
  if (!config || typeof config !== 'object') {
    return;
  }
  const first = Number(config.firstLaunchAt || 0);
  if (!first) {
    markFirstLaunchIfNeeded(config);
    return;
  }

  const now = Date.now();
  const elapsedDays = Math.floor((now - first) / DAY_MS);
  const fired = (config.retentionMarkers && typeof config.retentionMarkers === 'object')
    ? config.retentionMarkers
    : {};

  let changed = false;
  for (const day of RETENTION_DAY_MARKERS) {
    const key = 'd' + day;
    if (elapsedDays >= day && !fired[key]) {
      fired[key] = true;
      changed = true;
      trackRetentionEvent('retention.return.' + key, {
        day,
        daysSinceFirstLaunch: elapsedDays
      });
    }
  }

  if (changed) {
    config.retentionMarkers = fired;
  }
}

module.exports = {
  trackRetentionEvent,
  markFirstLaunchIfNeeded,
  trackReturnOnLaunch,
  RETENTION_DAY_MARKERS
};
