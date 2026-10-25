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
// desligaria a aceleração no primeiro crash. Crashes dentro desta janela (na
// mesma sessão) contam como um só.
const GPU_CRASH_DEDUPE_MS = 10 * 1000;
let lastRecordedCrashAt = 0;

const gpuPolicyFlags = {
  disableGpu: env.SNAPAWAY_DISABLE_GPU === '1',
  disableGpuCompositing: env.SNAPAWAY_DISABLE_GPU_COMPOSITING === '1',
  softwareRendering: env.SNAPAWAY_SOFTWARE_RENDERING === '1',
  safeMode: env.SNAPAWAY_SAFE_MODE === '1'
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
    return { disabled: false, crashCount: 0, disabledAt: 0 };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      disabled: !!raw.disabled,
      crashCount: Number(raw.crashCount) || 0,
      disabledAt: Number(raw.disabledAt) || 0
    };
  } catch (_) {
    return { disabled: false, crashCount: 0, disabledAt: 0 };
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

// Aplica o fallback no startup. Retorna true se HW accel foi desligada.
function applyGpuFallback(app) {
  if (!app) return false;
  const state = readFallbackState(app);
  if (!state.disabled) return false;

  // Janela de recuperação expirou → limpa o flag e tenta HW accel de novo.
  if (state.disabledAt && Date.now() - state.disabledAt > FALLBACK_RECOVERY_MS) {
    console.warn('[GPU FALLBACK] Recovery window elapsed — retrying hardware acceleration.');
    writeFallbackState(app, { disabled: false, crashCount: 0, disabledAt: 0 });
    return false;
  }

  console.warn('[GPU FALLBACK] Disabling GPU (repeated GPU crashes).');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
  // `disableHardwareAcceleration()` sozinho ainda deixa o Chromium subir um
  // processo GPU (SwiftShader). Em máquinas com driver quebrado esse processo
  // segue caindo e o Chromium acaba abortando o browser inteiro ao atingir o
  // próprio limite de crashes (`IntentionallyCrashBrowserForUnusableGpuProcess`
  // — Sentry ELECTRON-K). O fallback precisa remover o processo GPU de vez.
  app.commandLine.appendSwitch('disable-gpu');
  gpuPolicyFlags.disableGpu = true;
  gpuPolicyFlags.disableGpuCompositing = true;
  gpuPolicyFlags.softwareRendering = true;
  return true;
}

// Chamado a cada crash real do processo GPU (de `gpu-process-crashed` OU de
// `child-process-gone` type 'GPU'). Retorna true quando o app deve reiniciar
// (acabou de cruzar o limiar e o fallback deve valer já na próxima sessão).
function recordGpuCrash(app) {
  if (!app) return false;
  const now = Date.now();
  if (lastRecordedCrashAt && now - lastRecordedCrashAt < GPU_CRASH_DEDUPE_MS) {
    return false;
  }
  lastRecordedCrashAt = now;

  const state = readFallbackState(app);
  state.crashCount = (state.crashCount || 0) + 1;
  let shouldRelaunch = false;

  if (!state.disabled && state.crashCount >= GPU_CRASH_THRESHOLD) {
    state.disabled = true;
    state.disabledAt = now;
    shouldRelaunch = true;
    console.warn(`[GPU FALLBACK] ${state.crashCount} GPU crashes recorded — GPU will be disabled.`);
  }

  writeFallbackState(app, state);
  return shouldRelaunch;
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
  getGpuPolicyFlags
};
