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
 *  - retention.pro_modal_viewed  : modal Pro exibido (vindo do renderer;
 *                                  `details.source` indica a origem)
 *  - retention.pro_upsell_eligible: usuário atingiu o 2º uso real (marco do funil)
 *  - retention.pro_upsell_modal_opened : faixa de upsell abriu o modal Pro
 *                                  (evento próprio: o Partner Center só recebe
 *                                  o nome do evento, não os details)
 *  - retention.pro_upsell_clicked: clique no CTA da faixa de upsell
 *  - retention.pro_upsell_dismissed : usuário dispensou a faixa (vale só na execução)
 *  - retention.purchase_started  : diálogo de compra da Store aberto
 *  - retention.purchase_completed: compra concluída na Store
 *  - retention.purchase_failed   : falha/erro no fluxo de compra da Store
 *  - retention.review_offered    : pedido de review decidido/exibido (usuário engajado)
 *  - retention.review_offered_ui : renderer confirmou a exibição do modal
 *  - retention.review_accepted   : usuário avaliou/abriu o review (nativo ou fallback)
 *  - retention.review_declined   : usuário fechou o diálogo nativo sem avaliar
 *  - retention.review_postponed  : usuário escolheu "agora não"
 *  - retention.review_dismissed_forever : usuário pediu para nunca mais perguntar
 *  - retention.review_failed     : falha ao abrir o pedido de review
 *
 * Eventos apenas locais (não vão ao Partner Center nem ao Sentry):
 *  - store.custom_event.diagnostic : veredito do Store Services SDK ao logar um
 *    custom event (logged/available/error/hresult). Gravado na primeira chamada
 *    de cada execução e a cada mudança de estado — é o que distingue "SDK
 *    quebrado no pacote" de "agregação atrasada" quando "Eventos
 *    personalizados" aparece vazio no Partner Center.
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
