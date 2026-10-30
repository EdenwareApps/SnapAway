const env = process.env;
const fs = require('fs');
const path = require('path');

// ── Fallback automático por crashes repetidos do processo GPU ──────────────
// Em algumas máquinas (drivers de vídeo instáveis / janelas transparentes +
// always-on-top), o processo GPU do Chromium cai repetidamente (Sentry
// ELECTRON-Y/S/8). O app não deve depender de variável manual para se
// proteger: após `GPU_CRASH_THRESHOLD` crashes registrados, desligamos a GPU
// (persistido em gpu-fallback.json no userData). A janela de recuperação
// re-tenta a aceleração depois de alguns dias (o driver pode ter sido
// atualizado).
const GPU_CRASH_THRESHOLD = 2;
const FALLBACK_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// `gpu-process-crashed` e `child-process-gone` (type 'GPU') descrevem o MESMO
// crash e podem chegar em qualquer ordem — contar os dois dobraria o número e
// desligaria a aceleração no primeiro crash. O dedupe vale SOMENTE para esse
// par: agrupamos os eventos que chegam dentro desta janela e só o primeiro de
// cada grupo conta. Um evento da MESMA fonte abre um grupo novo (é um crash
// novo). Uma janela longa de tempo cega (10 s) engolia crashes DISTINTOS em
// sequência de boot, e o Chromium matava o app inteiro
// (`IntentionallyCrashBrowserForUnusableGpuProcess`) antes de o fallback
// atingir o limiar.
// Alinhado com GPU_GONE_CACHE_MS (src/main/index.js), que casa os dois eventos.
const CRASH_PAIR_DEDUPE_MS = 5 * 1000;
let crashGroup = { at: 0, sources: new Set() };

// Crash do processo GPU dentro desta janela = crash de BOOT: a coleta de
// informações gráficas do Chromium roda na inicialização do processo GPU e é
// justamente onde falham drivers/DxDiag. Nesse caso não esperamos o segundo
// crash — já desligamos a GPU no próximo boot.
const BOOT_CRASH_WINDOW_MS = 20 * 1000;
const PROCESS_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

// Degraus do fallback. 1 = sem GPU. 2 = força também o backend SwiftShader e
// desliga D3D11: caminho alternativo para máquinas em que a enumeração de
// display via D3D/DxDiag derruba o processo GPU mesmo com a GPU desligada.
const MAX_FALLBACK_TIER = 2;

const gpuPolicyFlags = {
  disableGpu: env.SNAPAWAY_DISABLE_GPU === '1',
  disableGpuCompositing: env.SNAPAWAY_DISABLE_GPU_COMPOSITING === '1',
  softwareRendering: env.SNAPAWAY_SOFTWARE_RENDERING === '1',
  safeMode: env.SNAPAWAY_SAFE_MODE === '1',
  fallbackTier: 0
};

function getFallbackFilePath(app) {
  try {
    return path.join(app.getPath('userData'), 'gpu-fallback.json');
  } catch (_) {
    return null;
  }
}

function readFallbackState(app) {
  const filePath = getFallbackFilePath(app);
  if (!filePath || !fs.existsSync(filePath)) {
    return { disabled: false, crashCount: 0, disabledAt: 0, tier: 0, bootCrashes: 0 };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const disabled = !!raw.disabled;
    const tierRaw = Number(raw.tier);
    return {
      disabled,
      crashCount: Number(raw.crashCount) || 0,
      disabledAt: Number(raw.disabledAt) || 0,
      // Estado gravado por versões anteriores não tem `tier`: um fallback já
      // ativo equivale ao degrau 1.
      tier: disabled ? (Number.isFinite(tierRaw) && tierRaw > 0 ? Math.min(tierRaw, MAX_FALLBACK_TIER) : 1) : 0,
      bootCrashes: Number(raw.bootCrashes) || 0
    };
  } catch (_) {
    return { disabled: false, crashCount: 0, disabledAt: 0, tier: 0, bootCrashes: 0 };
  }
}

function writeFallbackState(app, state) {
  const filePath = getFallbackFilePath(app);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
  } catch (_) {
    // best-effort: falha ao persistir não deve quebrar o app
  }
}

// Aplica os switches do degrau de fallback. Tier 1 remove o processo GPU do
// caminho do D3D; tier 2 troca o backend para SwiftShader e desliga D3D11 —
// outra rota de inicialização, para máquinas em que a enumeração de display do
// D3D/DxDiag (`GetWmiPerferredMonitorSourceMode`) cai mesmo com `--disable-gpu`.
function applyFallbackTier(app, tier) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
  // `disableHardwareAcceleration()` sozinho ainda deixa o Chromium subir um
  // processo GPU (SwiftShader). Em máquinas com driver quebrado esse processo
  // segue caindo e o Chromium acaba abortando o browser inteiro ao atingir o
  // próprio limite de crashes (`IntentionallyCrashBrowserForUnusableGpuProcess`
  // — Sentry ELECTRON-K). O fallback precisa remover o processo GPU de vez.
  app.commandLine.appendSwitch('disable-gpu');
  if (tier >= 2) {
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('disable-d3d11');
  }
  gpuPolicyFlags.disableGpu = true;
  gpuPolicyFlags.disableGpuCompositing = true;
  gpuPolicyFlags.softwareRendering = true;
  gpuPolicyFlags.fallbackTier = Math.min(tier, MAX_FALLBACK_TIER);
}

// Aplica o fallback no startup. Retorna true se HW accel foi desligada.
function applyGpuFallback(app) {
  if (!app) return false;
  const state = readFallbackState(app);
  if (!state.disabled) return false;

  // Janela de recuperação expirou → limpa o flag e tenta HW accel de novo.
  if (state.disabledAt && Date.now() - state.disabledAt > FALLBACK_RECOVERY_MS) {
    console.warn('[GPU FALLBACK] Recovery window elapsed — retrying hardware acceleration.');
    writeFallbackState(app, { disabled: false, crashCount: 0, disabledAt: 0, tier: 0, bootCrashes: 0 });
    return false;
  }

  console.warn(`[GPU FALLBACK] Disabling GPU (repeated GPU crashes) — fallback tier ${state.tier}.`);
  applyFallbackTier(app, state.tier);
  return true;
}

// Chamado a cada crash real do processo GPU (de `gpu-process-crashed` OU de
// `child-process-gone` type 'GPU'). Retorna true quando o app deve reiniciar
// (acabou de cruzar o limiar ou de escalonar um degrau, e o fallback deve valer
// já na próxima sessão).
function recordGpuCrash(app, source = 'unknown') {
  if (!app) return false;
  const now = Date.now();

  // Agrupa os eventos do MESMO crash (ver CRASH_PAIR_DEDUPE_MS). O primeiro
  // evento de cada grupo conta; o segundo (mesmo crash, outra fonte) não.
  // `elapsed < 0` cobre ajuste de relógio para trás (NTP/manual).
  const elapsed = crashGroup.at ? now - crashGroup.at : Number.POSITIVE_INFINITY;
  const isNewGroup = !crashGroup.at ||
    elapsed < 0 ||
    elapsed >= CRASH_PAIR_DEDUPE_MS ||
    crashGroup.sources.has(source);
  if (isNewGroup) {
    crashGroup = { at: now, sources: new Set([source]) };
  } else {
    crashGroup.sources.add(source);
    return false;
  }

  const state = readFallbackState(app);
  const isBootCrash = (now - PROCESS_STARTED_AT) < BOOT_CRASH_WINDOW_MS;
  let shouldRelaunch = false;

  if (state.disabled) {
    // Já estamos no fallback: só escalona um degrau (uma vez por crash de boot)
    // e nunca reinicia de novo no mesmo degrau — evita loop
    // crash → relaunch → crash.
    if (isBootCrash && state.tier < MAX_FALLBACK_TIER) {
      state.tier += 1;
      state.bootCrashes += 1;
      shouldRelaunch = true;
      console.warn(`[GPU FALLBACK] GPU crash with fallback active — escalating to tier ${state.tier}.`);
    } else {
      if (isBootCrash) state.bootCrashes += 1;
      console.warn('[GPU FALLBACK] GPU crash with fallback active — no further escalation.');
    }
    writeFallbackState(app, state);
    return shouldRelaunch;
  }

  state.crashCount += 1;
  if (isBootCrash) state.bootCrashes += 1;

  // Crash de boot não espera o segundo crash: o Chromium derruba o app inteiro
  // no terceiro crash de GPU em ~60 s, antes de o limiar ser atingido.
  if (isBootCrash || state.crashCount >= GPU_CRASH_THRESHOLD) {
    state.disabled = true;
    state.tier = 1;
    state.disabledAt = now;
    shouldRelaunch = true;
    console.warn(`[GPU FALLBACK] Disabling GPU (crash #${state.crashCount}${isBootCrash ? ', boot crash' : ''}).`);
  }

  writeFallbackState(app, state);
  return shouldRelaunch;
}

// Sessão saudável: zera a série de crashes. Sem isso o `crashCount` persistido
// só cresce e um crash isolado meses depois cairia direto no fallback.
function noteHealthyRun(app) {
  if (!app) return false;
  const state = readFallbackState(app);
  if (!state.crashCount && !state.bootCrashes) return false;
  state.crashCount = 0;
  state.bootCrashes = 0;
  writeFallbackState(app, state);
  return true;
}

// Snapshot do estado do fallback para a telemetria (Sentry/log persistente).
function getGpuPolicySnapshot(app) {
  const state = app
    ? readFallbackState(app)
    : { disabled: false, crashCount: 0, disabledAt: 0, tier: 0, bootCrashes: 0 };
  return {
    active: state.disabled,
    tier: state.tier,
    crashCount: state.crashCount,
    bootCrashes: state.bootCrashes,
    disabledAt: state.disabledAt || null,
    bootCrashWindowMs: BOOT_CRASH_WINDOW_MS,
    flags: getGpuPolicyFlags()
  };
}

function applyGpuPolicy(app) {
  if (!app) {
    return gpuPolicyFlags;
  }

  if (gpuPolicyFlags.disableGpu) {
    console.warn('[GPU POLICY] Hardware acceleration is disabled by environment flag.');
    app.disableHardwareAcceleration();
  }

  if (gpuPolicyFlags.disableGpuCompositing) {
    console.warn('[GPU POLICY] GPU compositing is disabled by environment flag.');
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }

  if (gpuPolicyFlags.softwareRendering) {
    console.warn('[GPU POLICY] Software rendering is enabled by environment flag.');
    app.commandLine.appendSwitch('disable-gpu');
  }

  if (gpuPolicyFlags.safeMode) {
    console.warn('[GPU POLICY] Safe mode enabled by environment flag.');
  }

  // Fallback automático por crashes repetidos de GPU (persistido no userData).
  applyGpuFallback(app);

  return gpuPolicyFlags;
}

function getGpuPolicyFlags() {
  return Object.assign({}, gpuPolicyFlags);
}

module.exports = {
  applyGpuPolicy,
  applyGpuFallback,
  recordGpuCrash,
  noteHealthyRun,
  getGpuPolicyFlags,
  getGpuPolicySnapshot
};
