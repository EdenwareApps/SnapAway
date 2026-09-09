/**
 * review-prompt.js
 * Lógica de elegibilidade e oferta do pedido de avaliação (review) da
 * Microsoft Store.
 *
 * O pedido de review só é feito quando o usuário demonstra engajamento real:
 *  - app instalado via Microsoft Store (identidade de pacote);
 *  - uso repetido do recurso central (hides concluídos via atalho/botão);
 *  - alguns dias desde o primeiro launch;
 *  - sinal adicional de engajamento (filtros configurados, retorno d7 ou Pro);
 *  - respeitando cooldowns persistentes (anti-nagging) salvos em config.
 *
 * O estado persistente fica no config (defaults.json):
 *  - hideUsageCount               : nº de hides concluídos;
 *  - reviewPromptLastOfferAt      : timestamp do último pedido exibido;
 *  - reviewPromptAskedEver        : já pediu de verdade (não pergunta de novo);
 *  - reviewPromptDismissedForever : usuário pediu para nunca mais perguntar.
 */

const config = require('../config/config.js');
const retention = require('./retention');

const DAY_MS = 86400000;

// Nº mínimo de hides concluídos antes de considerar o usuário engajado.
const MIN_HIDE_USAGE = 10;
// Dias mínimos desde o primeiro launch antes de oferecer o review.
const MIN_DAYS_SINCE_FIRST_LAUNCH = 3;
// Cooldown após um "agora não" (ou fechamento do modal sem ação).
const POSTPONE_COOLDOWN_MS = 45 * DAY_MS;

// Incrementa o contador de uso real do recurso central (hide concluído).
function recordHideUsage() {
  const count = Number(config.hideUsageCount || 0) + 1;
  config.hideUsageCount = count;
  return count;
}

// Verifica se o usuário está elegível para receber o pedido agora.
function isEligible(now = Date.now()) {
  try {
    if (config.reviewPromptAskedEver === true) return false;
    if (config.reviewPromptDismissedForever === true) return false;

    const firstLaunchAt = Number(config.firstLaunchAt || 0);
    if (!firstLaunchAt) return false;

    const daysSinceFirstLaunch = Math.floor((now - firstLaunchAt) / DAY_MS);
    if (daysSinceFirstLaunch < MIN_DAYS_SINCE_FIRST_LAUNCH) return false;

    if (Number(config.hideUsageCount || 0) < MIN_HIDE_USAGE) return false;

    // Sinal extra de engajamento: configurou filtros, retornou no dia 7 ou é Pro.
    const hasFilters = Array.isArray(config.filters) && config.filters.length >= 1;
    const reachedD7 = !!(config.retentionMarkers && config.retentionMarkers.d7);
    const isProUser = config.isPro === true;
    if (!hasFilters && !reachedD7 && !isProUser) return false;

    const lastOfferAt = Number(config.reviewPromptLastOfferAt || 0);
    if (lastOfferAt && (now - lastOfferAt) < POSTPONE_COOLDOWN_MS) return false;

    return true;
  } catch (error) {
    console.warn('[REVIEW] isEligible error:', error && error.message ? error.message : String(error));
    return false;
  }
}

// Marca que um pedido foi exibido agora (inicia o cooldown).
function markOffered() {
  config.reviewPromptLastOfferAt = Date.now();
}

// Usuário preferiu não avaliar agora (adiar).
function markPostponed() {
  config.reviewPromptLastOfferAt = Date.now();
  retention.trackRetentionEvent('retention.review_postponed', {
    source: 'user'
  });
}

// Usuário pediu para nunca mais ser perguntado.
function markDismissedForever() {
  config.reviewPromptDismissedForever = true;
  config.reviewPromptLastOfferAt = Date.now();
  retention.trackRetentionEvent('retention.review_dismissed_forever', {});
}

// Review efetivamente pedido/aberto (não pergunta mais nesta instalação).
function markAskedEver() {
  config.reviewPromptAskedEver = true;
  config.reviewPromptLastOfferAt = Date.now();
}

// Tenta oferecer o review. Só chama `opts.sendOffer` (ex.: enviar IPC ao
// renderer) quando tudo estiver elegível. Retorna true se a oferta ocorreu.
function maybeOfferReview(opts = {}) {
  const now = Date.now();
  if (opts.isStoreInstall !== true) return false;
  if (!isEligible(now)) return false;

  markOffered();
  retention.trackRetentionEvent('retention.review_offered', {
    source: opts.source || 'unknown',
    hideUsageCount: Number(config.hideUsageCount || 0),
    daysSinceFirstLaunch: Math.floor((now - Number(config.firstLaunchAt || 0)) / DAY_MS)
  });

  if (typeof opts.sendOffer === 'function') {
    try {
      opts.sendOffer();
    } catch (error) {
      console.warn('[REVIEW] sendOffer callback error:', error && error.message ? error.message : String(error));
    }
  }
  return true;
}

module.exports = {
  recordHideUsage,
  isEligible,
  maybeOfferReview,
  markOffered,
  markPostponed,
  markDismissedForever,
  markAskedEver,
  MIN_HIDE_USAGE,
  MIN_DAYS_SINCE_FIRST_LAUNCH
};
