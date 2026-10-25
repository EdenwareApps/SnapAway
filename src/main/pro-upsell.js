/**
 * pro-upsell.js
 * Faixa de upsell do Pro exibida na tela principal ("Oculte ainda mais rápido
 * com o Pro").
 *
 * Regra de elegibilidade: a faixa aparece a partir do SEGUNDO uso real do
 * recurso central — cada ciclo de ocultar + restaurar janelas conta como um uso
 * (abrir o app não conta). Quem já é Pro nunca vê a faixa.
 *
 * Estado persistente no config (defaults.json):
 *  - proUpsellUsageCount : total de ciclos hide+restore concluídos.
 *  - proUpsellUsageDays  : dias (YYYY-MM-DD local) com uso — só diagnóstico.
 *
 * A dispensa (✕) vale apenas para a execução atual do app: a faixa volta a
 * aparecer no próximo lançamento. O antigo `proUpsellDismissedForever` do config
 * é ignorado de propósito (dispensa permanente perdia a faixa para sempre).
 *
 * As dependências (config/telemetria) são resolvidas de forma preguiçosa para
 * que o módulo possa ser carregado por testes em Node puro (sem Electron).
 */

// Nº mínimo de usos reais (hide + restore) para exibir a faixa.
// 2 = "a partir do segundo uso". Antes era 3 dias distintos, mas com a base
// atual (~2,9 dias ativos/mês) a maioria nunca alcançava o limiar.
const MIN_USAGE_COUNT = 2;
// Limite de dias guardados (evita crescimento indefinido do config).
const MAX_TRACKED_DAYS = 60;

// Chave do dia no fuso local do usuário (não UTC): o "dia de uso" exibido nos
// diagnósticos deve seguir o calendário que o usuário enxerga.
function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let realDeps = null;
function loadRealDeps() {
  if (realDeps) return realDeps;
  const deps = { config: null, track: () => {} };
  try {
    deps.config = require('../config/config.js');
  } catch (error) {
    console.warn('[PRO-UPSELL] config unavailable:', error && error.message ? error.message : String(error));
  }
  try {
    const retention = require('./retention');
    if (retention && typeof retention.trackRetentionEvent === 'function') {
      deps.track = (name, details) => retention.trackRetentionEvent(name, details);
    }
  } catch (error) {
    console.warn('[PRO-UPSELL] retention unavailable:', error && error.message ? error.message : String(error));
  }
  realDeps = deps;
  return deps;
}

function createProUpsell(options = {}) {
  const injectedConfig = options.config && typeof options.config === 'object' ? options.config : null;
  const injectedTrack = typeof options.track === 'function' ? options.track : null;
  const nowProvider = typeof options.now === 'function' ? options.now : () => new Date();

  const getConfig = () => injectedConfig || loadRealDeps().config || {};
  const track = (name, details) => {
    if (injectedTrack) {
      injectedTrack(name, details);
      return;
    }
    loadRealDeps().track(name, details);
  };

  // Dispensa só em memória: não escreve no config, então a faixa reaparece no
  // próximo lançamento (o usuário pode voltar a ser elegível sem "perder" o Pro).
  let dismissedThisRun = false;

  function getUsageDays() {
    const days = getConfig().proUpsellUsageDays;
    return Array.isArray(days) ? days.filter(day => typeof day === 'string' && day) : [];
  }

  // Total de usos reais registrados. Builds 1.2.x só guardavam os dias
  // distintos: nesse caso o número de dias é o melhor piso disponível e é
  // semeado no config para não "perder" o histórico do usuário.
  function getUsageCount() {
    const config = getConfig();
    const raw = config.proUpsellUsageCount;
    if (raw !== undefined && raw !== null) {
      const stored = Number(raw);
      if (Number.isFinite(stored) && stored >= 0) {
        return Math.floor(stored);
      }
    }
    const seeded = getUsageDays().length;
    if (seeded > 0) {
      try {
        config.proUpsellUsageCount = seeded;
      } catch (error) {
        console.warn('[PRO-UPSELL] usage count migration failed:', error && error.message ? error.message : String(error));
      }
    }
    return seeded;
  }

  // Registra um uso real (um ciclo de ocultar + restaurar).
  function recordUsage() {
    try {
      const config = getConfig();
      const usageCount = getUsageCount() + 1;
      // Atribui um novo número: o config é um Proxy que persiste no `set`.
      config.proUpsellUsageCount = usageCount;

      const key = todayKey(nowProvider());
      const days = getUsageDays();
      let usageDayAdded = false;
      if (!days.includes(key)) {
        config.proUpsellUsageDays = days.concat(key).slice(-MAX_TRACKED_DAYS);
        usageDayAdded = true;
      }

      const usageDayCount = getUsageDays().length;
      if (usageCount === MIN_USAGE_COUNT) {
        track('retention.pro_upsell_eligible', { usageCount, usageDayCount });
      }

      return { added: true, usageCount, usageDayAdded, usageDayCount };
    } catch (error) {
      console.warn('[PRO-UPSELL] recordUsage error:', error && error.message ? error.message : String(error));
      return { added: false, usageCount: getUsageCount(), usageDayAdded: false, usageDayCount: getUsageDays().length };
    }
  }

  function isEligible() {
    try {
      const config = getConfig();
      if (config.isPro === true) return false;
      if (dismissedThisRun) return false;
      return getUsageCount() >= MIN_USAGE_COUNT;
    } catch (error) {
      console.warn('[PRO-UPSELL] isEligible error:', error && error.message ? error.message : String(error));
      return false;
    }
  }

  function getState() {
    return {
      eligible: isEligible(),
      usageCount: getUsageCount(),
      usageDayCount: getUsageDays().length,
      minUsageCount: MIN_USAGE_COUNT,
      dismissed: dismissedThisRun
    };
  }

  function markClicked() {
    track('retention.pro_upsell_clicked', { usageCount: getUsageCount() });
  }

  function markDismissed() {
    dismissedThisRun = true;
    track('retention.pro_upsell_dismissed', { usageCount: getUsageCount() });
  }

  return { recordUsage, isEligible, getState, markClicked, markDismissed };
}

let singleton = null;
function getSingleton() {
  if (!singleton) {
    singleton = createProUpsell();
    // Migração: a versão anterior gravava dispensa permanente no config. A flag
    // agora é ignorada; zeramos o valor antigo para não confundir diagnósticos.
    try {
      const config = loadRealDeps().config;
      if (config && config.proUpsellDismissedForever === true) {
        config.proUpsellDismissedForever = false;
      }
    } catch (error) {
      console.warn('[PRO-UPSELL] legacy dismissal cleanup failed:', error && error.message ? error.message : String(error));
    }
  }
  return singleton;
}

module.exports = {
  createProUpsell,
  todayKey,
  recordUsage: () => getSingleton().recordUsage(),
  isEligible: () => getSingleton().isEligible(),
  getState: () => getSingleton().getState(),
  markClicked: () => getSingleton().markClicked(),
  markDismissed: () => getSingleton().markDismissed(),
  MIN_USAGE_COUNT,
  MAX_TRACKED_DAYS
};
