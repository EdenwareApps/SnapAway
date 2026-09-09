const { app, BrowserWindow, dialog, globalShortcut, ipcMain, session, shell, Menu, Tray, screen, protocol, nativeImage, nativeTheme, Notification } = require('electron');
// koffi is a production dependency (window enumeration uses it too).
// Wrapped in try/catch only for resilience in edge cases.
let koffi = null;
try {
    koffi = require('koffi');
} catch (_koffiErr) {
    koffi = null;
    console.warn('[MAIN] koffi not available, DPI awareness via native API disabled.');
}

console.log('[MAIN] Starting main process');
// Declare DPI awareness early (before app ready) to satisfy Windows App Cert Kit DPIAwarenessValidation
app.commandLine.appendSwitch('high-dpi-support', '1');

const gpuPolicy = require('./gpu-policy');
const telemetry = require('./telemetry');
const { createOverlayManager } = require('./overlay-manager')
const { installNavigationGuards } = require('./navigation-guard');
const gpuPolicyFlags = gpuPolicy.applyGpuPolicy(app);

if (process.platform === 'win32' && koffi) {
    try {
        const user32 = koffi.load('user32.dll');
        const shcore = koffi.load('shcore.dll');
        const SetProcessDpiAwarenessContext = user32.func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t)');
        const SetProcessDpiAwareness = shcore.func('int __stdcall SetProcessDpiAwareness(int)');

        const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
        const PER_MONITOR_DPI_AWARE = 2;

        const ctxResult = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        if (!ctxResult) {
            const awarenessResult = SetProcessDpiAwareness(PER_MONITOR_DPI_AWARE);
            if (awarenessResult !== 0) {
                console.warn('[MAIN] SetProcessDpiAwareness failed:', awarenessResult);
            }
        }

        console.log('[MAIN] DPI awareness configured (PerMonitorV2 if possible).');
    } catch (error) {
        console.warn('[MAIN] DPI awareness setup failed:', error);
    }
}

let setupTitlebar = () => { };
let attachTitlebarToWindow = () => { };
function initTitlebarSupport() {
    try {
        const titlebar = require("custom-electron-titlebar/main");
        setupTitlebar = titlebar.setupTitlebar || setupTitlebar;
        attachTitlebarToWindow = titlebar.attachTitlebarToWindow || attachTitlebarToWindow;
    } catch (error) {
        console.warn('[MAIN] custom-electron-titlebar not available or failed to load:', error && error.stack ? error.stack : error);
    }
}

let pendingAuthCheckResolver = null;

function requestAuthCheck() {
    console.log('[MAIN] requestAuthCheck called');
    return new Promise((resolve) => {
        pendingAuthCheckResolver = resolve;
        console.log('[MAIN] Pending auth check resolver set, sending auth-check event to renderer', !!window?.webContents);

        // Send custom auth-check event to renderer to avoid triggering auth-result-response behavior
        // Guard (fix Object-has-been-destroyed): durante o quit a janela pode já
        // ter sido destruída e `window` continua truthy.
        if (window && !window.isDestroyed() && window.webContents) {
            // Save current window state so we can restore it after auth even when
            // the auth flow was initiated via auth-check (renderer-driven)
            try {
                if (window.isVisible() && !window.isMinimized()) {
                    const currentSize = window.getSize();
                    const currentPosition = window.getPosition();
                    authWindowSize = { width: currentSize[0], height: currentSize[1] };
                    authWindowPosition = { x: currentPosition[0], y: currentPosition[1] };
                    console.log('[MAIN] Saved window state for auth-check:', authWindowSize, authWindowPosition);
                }
            } catch (e) {
                console.warn('[MAIN] Failed to save window state for auth-check:', e);
            }

            try {
                window.webContents.send('auth-check');
            } catch (e) {
                console.warn('[MAIN] Failed to send auth-check:', e);
            }
        }

        // Fallback timeout to avoid hanging
        setTimeout(() => {
            if (pendingAuthCheckResolver) {
                pendingAuthCheckResolver(false);
                pendingAuthCheckResolver = null;
            }
        }, 120000); // 2 minutes
    });
}

ipcMain.on('auth-check-response', (event, result) => {
    if (pendingAuthCheckResolver) {
        pendingAuthCheckResolver(!!result);
        pendingAuthCheckResolver = null;
    }
});

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const superagent = require('superagent');

if (process.platform === 'win32') {
    const nativeModulePath = __dirname;
    if (!process.env.PATH || !process.env.PATH.split(path.delimiter).includes(nativeModulePath)) {
        process.env.PATH = `${nativeModulePath}${path.delimiter}${process.env.PATH || ''}`;
        console.log('[MAIN] Added native module directory to PATH for Windows native addon loading:', nativeModulePath);
    }
}
console.log('[MAIN] before require system');
const system = require('../system/system.js');
console.log('[MAIN] after require system');
console.log('[MAIN] before require xsystem');
const xsystem = require('../x-system/win32-support.js');
console.log('[MAIN] after require xsystem');
console.log('[MAIN] before require config');
const config = require('../config/config.js');
console.log('[MAIN] after require config');
const defaults = require('../config/defaults.json');
const storeProducts = require('../config/store-products.json');
const defaultStoreIapProductId = storeProducts?.store?.products?.Pro?.id || '9NNLVZPCLLTZ';
const storeInstallContext = getStoreInstallContext();
telemetry.initMainTelemetry(app, {
  gpuPolicyFlags,
  isStoreInstall: storeInstallContext.isStoreInstall,
  startupMode: process.env.SNAPAWAY_SAFE_MODE === '1' ? 'safe' : 'normal',
  screen
});

process.on('uncaughtException', (error) => {
  console.error('[MAIN] uncaughtException:', error);
  appendIapTrace('process.uncaughtException', { message: error?.message || null, stack: error?.stack || null });
  if (telemetry && typeof telemetry.captureTelemetryException === 'function') {
    telemetry.captureTelemetryException(error, { source: 'uncaughtException' });
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] unhandledRejection:', reason);
  appendIapTrace('process.unhandledRejection', { reason: String(reason) });
  if (telemetry && typeof telemetry.captureTelemetryException === 'function') {
    telemetry.captureTelemetryException(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' });
  }
});

function getStoreInstallContext() {
    const packageFamilyName = process.env.APPX_PACKAGE_FAMILY_NAME
        || process.env.PACKAGE_FAMILY_NAME
        || process.env.APP_PACKAGE_FAMILY_NAME
        || '';
    const windowsStore = !!process.windowsStore;

    // Fallback: detect Store install by executable path containing \WindowsApps\
    // (process.windowsStore may not be set in all Electron versions for APPX packages)
    const execPath = process.execPath || '';
    const resourcesPath = process.resourcesPath || '';
    const isWindowsAppsPath = execPath.includes('\\WindowsApps\\') ||
        resourcesPath.includes('\\WindowsApps\\');

    const isStoreInstall = windowsStore || isWindowsAppsPath;

    return {
        isStoreInstall,
        windowsStore,
        isWindowsAppsPath,
        hasPackageIdentity: Boolean(packageFamilyName),
        packageFamilyName: packageFamilyName || null
    };
}

async function runWinRTStartupTask(action) {
    const taskId = 'SnapAway';
    const header = [
        'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
        '[Windows.ApplicationModel.StartupTask,Windows.ApplicationModel,ContentType=WindowsRuntime] | Out-Null',
        "$op = [Windows.ApplicationModel.StartupTask]::GetAsync('" + taskId + "')",
        '$gt = [System.WindowsRuntimeSystemExtensions]::AsTask($op)',
        '$gt.Wait()',
        '$t = $gt.Result'
    ].join('; ');
    let body;
    if (action === 'get') {
        body = [
            'if ($null -eq $t) { Write-Output "NotFound"; exit 0 }',
            'Write-Output $t.State.ToString()'
        ].join('; ');
    } else if (action === 'enable') {
        // RequestEnableAsync() pode retornar Disabled de forma transitória na
        // primeira chamada (principalmente em apps recém-instalados da Store).
        // Tentamos algumas vezes e sempre emitimos o estado final para que o
        // chamador nunca receba null/indefinido (fix 1.1.2).
        body = [
            'if ($null -eq $t) { Write-Output "NotFound"; exit 0 }',
            'if ($t.State -eq [Windows.ApplicationModel.StartupTaskState]::Disabled) {',
            '  for ($i = 0; $i -lt 3; $i++) {',
            '    try {',
            '      $eop = $t.RequestEnableAsync()',
            '      $et = [System.WindowsRuntimeSystemExtensions]::AsTask($eop)',
            '      $null = $et.Wait(3000)',
            '      if ($et.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {',
            '        $st = $et.Result',
            '        Write-Output $st.ToString()',
            '        if ($st -eq [Windows.ApplicationModel.StartupTaskState]::Enabled -or $st -eq [Windows.ApplicationModel.StartupTaskState]::EnabledByPolicy) { break }',
            '      } else {',
            '        Write-Output $t.State.ToString()',
            '        break',
            '      }',
            '    } catch {',
            '      Write-Output $t.State.ToString()',
            '      break',
            '    }',
            '  }',
            '} else {',
            '  Write-Output $t.State.ToString()',
            '}'
        ].join('; ');
    } else if (action === 'disable') {
        body = [
            'if ($null -eq $t) { Write-Output "NotFound"; exit 0 }',
            'try { $t.Disable() } catch { }',
            'Write-Output $t.State.ToString()'
        ].join('; ');
    } else { return null; }
    const script = header + '; ' + body;
    return new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                console.warn('[MAIN] WinRT StartupTask (' + action + ') failed:', err.message || err, '| stderr:', (stderr || '').trim().slice(0, 500));
                resolve(null);
                return;
            }
            // As tentativas podem emitir várias linhas de estado; o resultado
            // final é sempre a última linha não-vazia do stdout.
            const lines = String(stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const result = lines.length ? lines[lines.length - 1] : '';
            if (!result && stderr && stderr.trim()) {
                console.warn('[MAIN] WinRT StartupTask (' + action + ') returned empty stdout but stderr:', stderr.trim().slice(0, 500));
            }
            resolve(result || null);
        });
    });
}

async function syncStartupPreferenceOnBoot() {
    try {
        const storeCtx = getStoreInstallContext();
        if (storeCtx.isStoreInstall) {
            // Store/MSIX startup is user-controlled via StartupTask permissions.
            return;
        }

        const shouldEnable = !!config.startup;
        try {
            const enabled = isLoginItemEnabled();
            if (shouldEnable && !enabled) {
                setLoginItemEnabled(true);
                console.log('[MAIN] Boot sync: enabled startup for EXE install');
            } else if (!shouldEnable && enabled) {
                setLoginItemEnabled(false);
                console.log('[MAIN] Boot sync: disabled startup for EXE install');
            }
        } catch (e) {
            console.warn('[MAIN] Boot sync startup failed:', e.message);
        }
    } catch (error) {
        console.warn('[MAIN] Boot sync for startup preference failed:', error && error.message ? error.message : error);
    }
}

const IAP_TRACE_FILE_NAME = 'iap-trace.log';
const IAP_TRACE_MAX_LINES = 200;

function getIapTracePath() {
    try {
        return path.join(app.getPath('userData'), IAP_TRACE_FILE_NAME);
    } catch (_) {
        return path.join(process.cwd(), IAP_TRACE_FILE_NAME);
    }
}

function serializeError(error) {
    if (!error) return null;
    return {
        name: error.name || 'Error',
        message: error.message || String(error),
        stack: error.stack || null,
        code: error.code || null
    };
}

function appendIapTrace(eventName, details = null) {
    if (telemetry && typeof telemetry.writePersistentTelemetryLog === 'function') {
        telemetry.writePersistentTelemetryLog(eventName, details);
        return;
    }

    try {
        const line = JSON.stringify({
            timestamp: new Date().toISOString(),
            pid: process.pid,
            event: eventName,
            details
        });
        fs.appendFileSync(getIapTracePath(), `${line}${os.EOL}`, 'utf8');
    } catch (error) {
        console.error('[IAP-TRACE] Failed to append trace:', error && error.message ? error.message : error);
    }
}

function readIapTraceTail(maxLines = IAP_TRACE_MAX_LINES) {
    try {
        const tracePath = getIapTracePath();
        if (!fs.existsSync(tracePath)) {
            return [];
        }
        const lines = fs.readFileSync(tracePath, 'utf8').split(/\r?\n/).filter(Boolean);
        return lines.slice(-Math.max(1, maxLines));
    } catch (error) {
        return [`[IAP-TRACE] Failed to read trace: ${error && error.message ? error.message : String(error)}`];
    }
}

function getHelperCandidates() {
    const candidates = [];
    if (process.resourcesPath) {
        // extraResources preserva o caminho relativo: o electron-builder coloca o
        // helper em resources\src\helper\SnapAwayHelper.exe (ver
        // scripts/sign-win-unpacked.ps1). O primeiro cobre um layout plano; o
        // segundo cobre o layout real do pacote. Sem isso, o app empacotado
        // nunca encontra o helper (HELPER_NOT_FOUND, sem UAC, sem ocultar).
        candidates.push(path.join(process.resourcesPath, 'SnapAwayHelper.exe'));
        candidates.push(path.join(process.resourcesPath, 'src', 'helper', 'SnapAwayHelper.exe'));
    }
    candidates.push(path.join(process.cwd(), 'dist', 'SnapAwayHelper.exe'));
    candidates.push(path.join(process.cwd(), 'SnapAwayHelper.exe'));
    // Dev: the helper is built into src/helper/ by build-helper.ps1
    candidates.push(path.join(process.cwd(), 'src', 'helper', 'SnapAwayHelper.exe'));
    return candidates;
}

function resolveHelperPath() {
    return getHelperCandidates().find(p => fs.existsSync(p)) || null;
}

async function askForElevation(actionTitle, details) {
    const message = `${actionTitle} requer privilégios de administrador para o alvo selecionado.`;
    const detail = `${details}\n\nDeseja pedir elevação agora?`;
    const response = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['Cancelar', 'Sim, pedir admin'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: 'Privilégios necessários',
        message,
        detail
    });
    return response.response === 1;
}

// The native helper (SnapAwayHelper.exe) parses HWNDs with strtoull(..., 10),
// i.e. base 10. The overlay tracker produces hex strings ("0x20662"), while the
// renderer uses decimal strings. Normalize to decimal so the helper can resolve
// the window regardless of source.
function hwndToDecimalString(hwndStr) {
    if (!hwndStr) return hwndStr
    const s = String(hwndStr).trim()
    if (!s) return s
    // O enumWindows (addon nativo) produz hex SEM prefixo e com preenchimento
    // (ex.: "000000000004102A" — 16 dígitos). O overlay produz "0x20662".
    // Já o renderer usa decimal. Regra: trata como hex se tiver prefixo 0x,
    // letras a-f, ou for um ponteiro de 16 dígitos; senão assume decimal.
    const hasPrefix = /^0x/i.test(s)
    // Com prefixo 0x: é hex. Sem prefixo: hex se tiver letras a-f, ou for um
    // ponteiro de 16 dígitos (enumWindows). Decimal (renderer) não passa.
    const hexLike = hasPrefix || (
        /^[0-9a-fA-F]+$/.test(s) &&
        (/[a-fA-F]/.test(s) || s.length === 16)
    )
    if (hexLike) {
        try {
            return BigInt(hasPrefix ? s : '0x' + s).toString(10)
        } catch (_) {
            return s
        }
    }
    return s
}

// --- Helper elevado persistente (fix 1.1.2) ---
// Subir o SnapAwayHelper.exe elevado UMA vez por sessão e reutilizá-lo para
// todas as ações elevadas evita um prompt de UAC a cada F6. Comunicação por
// arquivos: request-<uuid>.json → result-<uuid>.json num diretório temporário.
let elevatedHelperServer = {
    dir: null,
    ready: false,
    starting: false,
    pid: null
};

// Consentimento do usuário para elevação no hide em lote (por sessão).
// REMOVIDO em 1.1.2: o diálogo extra foi descartado — o prompt de UAC é a
// confirmação (o usuário pediu para ir direto à elevação).

function getElevatedHelperDir() {
    if (!elevatedHelperServer.dir) {
        elevatedHelperServer.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapaway-elev-'));
    }
    return elevatedHelperServer.dir;
}

async function waitForFile(filePath, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            if (fs.existsSync(filePath)) return true;
        } catch (_) { }
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

async function ensureElevatedHelperServer() {
    if (elevatedHelperServer.ready) {
        // O servidor pode ter saído por idle/crash — confirma que ainda vive.
        try {
            if (fs.existsSync(path.join(elevatedHelperServer.dir, 'ready'))) {
                return true;
            }
        } catch (_) { }
        elevatedHelperServer.ready = false;
    }
    if (elevatedHelperServer.starting) {
        while (elevatedHelperServer.starting && !elevatedHelperServer.ready) {
            await new Promise(r => setTimeout(r, 100));
        }
        return elevatedHelperServer.ready;
    }

    const helperPath = resolveHelperPath();
    if (!helperPath) return false;

    elevatedHelperServer.starting = true;
    try {
        const dir = getElevatedHelperDir();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { }
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { }

        try {
            await xsystem.runAsAdmin(helperPath, ['--server', dir], dir);
        } catch (error) {
            console.warn('[MAIN] Failed to spawn elevated helper server:', error.message);
            return false;
        }

        const ready = await waitForFile(path.join(dir, 'ready'), 15000);
        if (ready) {
            try {
                const pidRaw = fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim();
                elevatedHelperServer.pid = Number(pidRaw) || null;
            } catch (_) { }
            elevatedHelperServer.ready = true;
            console.log('[MAIN] Elevated helper server ready (pid=' + elevatedHelperServer.pid + ')');
        } else {
            console.warn('[MAIN] Elevated helper server did not become ready; falling back to one-shot elevation');
        }
    } finally {
        elevatedHelperServer.starting = false;
    }
    return elevatedHelperServer.ready;
}

async function runElevatedActionViaServer(action, params) {
    const dir = elevatedHelperServer.dir;
    const uuid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const requestFile = path.join(dir, `request-${uuid}.json`);
    const resultFile = path.join(dir, `result-${uuid}.json`);

    try {
        fs.writeFileSync(requestFile, JSON.stringify({ action, ...params }), 'utf8');
    } catch (error) {
        console.warn('[MAIN] Failed to write elevated request:', error.message);
        return { success: false, error: 'HELPER_WRITE_FAILED', message: error.message };
    }

    const found = await waitForFile(resultFile, 30000);
    if (!found) {
        return { success: false, error: 'HELPER_TIMEOUT', message: 'Timeout aguardar helper elevado (servidor)' };
    }
    try {
        const raw = fs.readFileSync(resultFile, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : { success: false, error: 'HELPER_INVALID_RESPONSE' };
    } catch (e) {
        return { success: false, error: 'HELPER_ERROR', message: e.message };
    } finally {
        try { fs.unlinkSync(requestFile); } catch (_) { }
        try { fs.unlinkSync(resultFile); } catch (_) { }
    }
}

function stopElevatedHelperServer() {
    const server = elevatedHelperServer;
    if (!server.ready || !server.dir) return;
    try {
        const uuid = `quit-${Date.now()}`;
        fs.writeFileSync(path.join(server.dir, `request-${uuid}.json`), JSON.stringify({ action: 'quit' }), 'utf8');
    } catch (_) { }
    server.ready = false;
    server.pid = null;
}

async function runElevatedAction(action, params = {}) {
    // Normaliza HWNDs para decimal (só relevante para ações de janela).
    const safeParams = { ...params };
    if (safeParams.hwnd) {
        safeParams.hwnd = hwndToDecimalString(safeParams.hwnd);
    }
    if (safeParams.hwnds) {
        safeParams.hwnds = String(safeParams.hwnds).split(',').map(h => hwndToDecimalString(h)).join(',');
    }

    // Prefere o servidor elevado persistente (evita UAC repetido).
    if (await ensureElevatedHelperServer()) {
        const result = await runElevatedActionViaServer(action, safeParams);
        if (result && result.error !== 'HELPER_TIMEOUT') {
            return result;
        }
        console.warn('[MAIN] Elevated helper server path failed, falling back to one-shot elevation');
    }

    return runElevatedActionOneShot(action, safeParams);
}

// Caminho antigo (uma invocação elevada por ação). Mantido como fallback.
async function runElevatedActionOneShot(action, params = {}) {
    const helperPath = resolveHelperPath();
    if (!helperPath) {
        return {
            success: false,
            error: 'HELPER_NOT_FOUND',
            message: 'SnapAwayHelper.exe não encontrado nesta instalação.'
        };
    }

    // Normalize hwnd to decimal for the helper (only relevant for window actions).
    const safeParams = { ...params };
    if (safeParams.hwnd) {
        safeParams.hwnd = hwndToDecimalString(safeParams.hwnd);
    }
    if (safeParams.hwnds) {
        safeParams.hwnds = String(safeParams.hwnds).split(',').map(h => hwndToDecimalString(h)).join(',');
    }

    const payload = Buffer.from(JSON.stringify({ action, ...safeParams }), 'utf8').toString('base64');
    const resultFile = path.join(os.tmpdir(), `snapaway-helper-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const args = ['--payloadBase64', payload, '--resultFile', resultFile];

    try {
        await xsystem.runAsAdmin(helperPath, args, path.dirname(helperPath));
    } catch (error) {
        return {
            success: false,
            error: 'HELPER_ELEVATION_FAILED',
            message: error.message
        };
    }

    return await new Promise((resolve) => {
        const startTime = Date.now();
        const maxWait = 120000;
        const interval = setInterval(() => {
            if (fs.existsSync(resultFile)) {
                clearInterval(interval);
                clearTimeout(timeout);
                try {
                    const raw = fs.readFileSync(resultFile, 'utf8');
                    const parsed = JSON.parse(raw);
                    resolve(parsed && typeof parsed === 'object' ? parsed : { success: false, error: 'HELPER_INVALID_RESPONSE' });
                } catch (e) {
                    resolve({ success: false, error: 'HELPER_ERROR', message: e.message });
                } finally {
                    try { fs.unlinkSync(resultFile); } catch (_) { }
                }
            } else if (Date.now() - startTime > maxWait) {
                clearInterval(interval);
                resolve({ success: false, error: 'HELPER_TIMEOUT', message: 'Timeout aguardar helper elevado' });
            }
        }, 250);

        const timeout = setTimeout(() => {
            clearInterval(interval);
            resolve({ success: false, error: 'HELPER_TIMEOUT', message: 'Timeout aguardar helper elevado' });
        }, maxWait);
    });
}

// Oculta em lote janelas de processos elevados usando o helper elevado. Pergunta
// ao usuário uma única vez por lote (o prompt de UAC é o mecanismo real de
// confirmação da elevação) e faz o bookkeeping de cada janela oculta (fix 1.1.2).
async function handleElevatedBatchHide(hwnds) {
    if (!Array.isArray(hwnds) || hwnds.length === 0) return;
    try {
        // Vai DIRETO ao UAC — o próprio prompt de elevação é a confirmação.
        // Sem diálogo de confirmação do app (fix 1.1.2).
        const decimalHwnds = hwnds.map(h => hwndToDecimalString(h)).join(',');
        const elevatedResult = await runElevatedAction('hide-window', { hwnds: decimalHwnds });
        const failed = (elevatedResult && Array.isArray(elevatedResult.failed))
            ? new Set(elevatedResult.failed.map(f => String(f)))
            : new Set();
        // Só as janelas efetivamente ocultadas recebem o bookkeeping; as que
        // falharam permanecem visíveis e não são marcadas como ocultas.
        const succeeded = hwnds.filter(h => {
            const dec = String(hwndToDecimalString(h));
            return !failed.has(dec) && !failed.has(String(h));
        });
        for (const hwndStr of succeeded) {
            await system.markElevatedHidden(hwndStr);
        }
        if (succeeded.length > 0) {
            console.log('[MAIN] Elevated batch hide succeeded for', succeeded.length, 'of', hwnds.length, 'window(s)');
        }
        if (failed.size > 0) {
            console.warn('[MAIN] Elevated batch hide failed for', failed.size, 'window(s):', Array.from(failed).join(','));
        }
    } catch (error) {
        console.error('[MAIN] Error during elevated batch hide:', error);
    }
}

// Restaura em lote janelas de processos elevados via helper elevado e finaliza
// o bookkeeping (remove do tracking e desmuta) com showSpecificWindow (fix 1.1.2).
async function handleElevatedBatchShow(hwnds) {
    if (!Array.isArray(hwnds) || hwnds.length === 0) return;
    try {
        const decimalHwnds = hwnds.map(h => hwndToDecimalString(h)).join(',');
        const elevatedResult = await runElevatedAction('show-window', { hwnds: decimalHwnds });
        const failed = (elevatedResult && Array.isArray(elevatedResult.failed))
            ? new Set(elevatedResult.failed.map(f => String(f)))
            : new Set();
        // Só finaliza o bookkeeping das janelas efetivamente restauradas; as
        // que falharam permanecem rastreadas para uma nova tentativa.
        const succeeded = hwnds.filter(h => {
            const dec = String(hwndToDecimalString(h));
            return !failed.has(dec) && !failed.has(String(h));
        });
        for (const hwndStr of succeeded) {
            await system.showSpecificWindow(hwndStr);
        }
        if (succeeded.length > 0) {
            console.log('[MAIN] Elevated batch show succeeded for', succeeded.length, 'of', hwnds.length, 'window(s)');
        }
        if (failed.size > 0) {
            console.warn('[MAIN] Elevated batch show failed for', failed.size, 'window(s):', Array.from(failed).join(','));
        }
    } catch (error) {
        console.error('[MAIN] Error during elevated batch show:', error);
    }
}

function normalizeFloatingButtonMode(value) {
    if (typeof value === 'boolean') return value ? 'always' : 'never';
    if (typeof value !== 'string') return 'always';

    const normalized = value.toLowerCase();
    if (['never', 'no', 'off', 'false'].includes(normalized)) return 'never';
    if (['visible', 'visible-only', 'only-visible', 'show', 'show-only'].includes(normalized)) return 'visible';
    if (['learning', 'aprendizado', 'adaptive', 'adaptative', 'training'].includes(normalized)) return 'learning';
    if (['always', 'yes', 'on', 'true'].includes(normalized)) return 'always';
    return 'always';
}

function getFloatingButtonMode() {
    return normalizeFloatingButtonMode(config.showEmergencyButton);
}

async function setStartupWithElevation(enable) {
    return await runElevatedAction('set-autostart', {
        enable: enable ? 'true' : 'false',
        exePath: process.execPath,
        args: '--autostart',
        name: 'SnapAway'
    });
}

function getAutostartArgs(enable) {
    return {
        enable: enable ? 'true' : 'false',
        exePath: process.execPath,
        args: '--autostart',
        name: 'SnapAway'
    };
}

function shouldShowFloatingButton() {
    const mode = getFloatingButtonMode();
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    if (mode === 'learning') return true;
    // 'visible' mode: only show the floating button when the current state is not "hide"
    return global.currentState !== 'hide';
}

function canAutoFloatOnBlur() {
    if (autoFloatPaused) return false;
    if (!shouldShowFloatingButton()) return false;
    if (!config.filters || config.filters.length === 0) return false;
    if (global.currentState === 'hide') return false;
    if (!global.window || global.window.isDestroyed()) return false;
    if (!global.window.isVisible() || global.window.isMinimized()) return false;
    if (global.window.isFocused()) return false;

    // Use effective mode derived from both state and geometry to avoid stale uiMode mismatches.
    let looksMainGeometry = false;
    try {
        const bounds = global.window.getBounds();
        looksMainGeometry = bounds.width >= 220 && bounds.height >= 220;
    } catch (_) {
        looksMainGeometry = false;
    }

    const isEffectivelyMainMode = global.uiMode === 'main' || looksMainGeometry;
    if (!isEffectivelyMainMode) return false;

    return true;
}

function scheduleAutoFloatBlur() {
    if (autoFloatBlurTimer) {
        clearTimeout(autoFloatBlurTimer);
    }
    autoFloatBlurTimer = setTimeout(() => {
        autoFloatBlurTimer = null;
        if (canAutoFloatOnBlur()) {
            console.log('[MAIN] Auto float-mode triggered after 5s blur delay');
            toggleUIMode('float', 'auto-blur');
        } else {
            console.log('[MAIN] Auto-float conditions not met after blur delay');
        }
    }, 5000);
}

function refreshAutoFloatBlurTimer(reason = '') {
    if (canAutoFloatOnBlur()) {
        console.log(`[MAIN] Refreshing auto-float blur timer (${reason})`);
        scheduleAutoFloatBlur();
        return;
    }

    if (autoFloatBlurTimer) {
        console.log(`[MAIN] Clearing auto-float blur timer (${reason})`);
        clearTimeout(autoFloatBlurTimer);
        autoFloatBlurTimer = null;
    }
}

function shouldRestoreFloatModeAfterHide() {
    return uiModeBeforeHide === 'float';
}

const licenseManager = require('../license/license.js');
const iconProcessor = require('../cloak/icon-processor.js');
const iapModule = require('../iap/index.js');
const retention = require('./retention');
const reviewPrompt = require('./review-prompt');
const premiumProvider = require('./premium/provider');
const lang = require('../language/language.js');
let lastKnownStorePro = false;

// Seam Partner Center (Store Services SDK): se o addon nativo expuser
// logCustomEvent (Microsoft.Services.Store.Engagement.StoreServicesCustomEventLogger),
// os eventos de produto também aparecem em "Eventos personalizados" no Partner
// Center. Sem o SDK, é um no-op silencioso (apenas log persistente).
if (telemetry && typeof telemetry.setPartnerCenterCustomEventLogger === 'function') {
    const logCustomEvent = iapModule && typeof iapModule.logCustomEvent === 'function'
        ? iapModule.logCustomEvent.bind(iapModule)
        : null;
    if (logCustomEvent) {
        telemetry.setPartnerCenterCustomEventLogger((eventName) => {
            try {
                Promise.resolve(logCustomEvent(eventName)).catch(() => {});
            } catch (_) { /* ignore */ }
        });
        console.log('[MAIN] Partner Center custom event logger enabled (Store Services SDK).');
    } else {
        console.log('[MAIN] Partner Center custom events: Store Services SDK not linked (log persistente ativo).');
    }
}

function getPremiumCapabilitiesSnapshot(extraContext = {}) {
    const storeContext = extraContext.storeContext || getStoreInstallContext();
    const iapAvailable = extraContext.iapAvailable === undefined
        ? (iapModule.isNativeModuleAvailable ? iapModule.isNativeModuleAvailable() : false)
        : !!extraContext.iapAvailable;

    return premiumProvider.getCapabilities({
        iapAvailable,
        isStoreInstall: storeContext.isStoreInstall,
        storeContext,
        ...extraContext
    });
}

async function runIapDevStartupTest() {
    const storeProductId = '9NNLVZPCLLTZ';
    console.log('[IAP-DEV-TEST] Starting IAP dev startup test');

    let available = false;
    let diagnostics = null;
    let products = null;
    let licenseInfo = null;
    let ownership = null;
    let success = true;

    try {
        if (typeof iapModule.waitForIapChildReady === 'function') {
            console.log('[IAP-DEV-TEST] Waiting for IAP helper child to initialize');
            available = await iapModule.waitForIapChildReady(15000);
            console.log('[IAP-DEV-TEST] IAP helper child ready:', available);
        }
    } catch (error) {
        console.error('[IAP-DEV-TEST] waitForIapChildReady failed:', error);
        success = false;
    }

    try {
        if (typeof iapModule.initStoreContext === 'function') {
            console.log('[IAP-DEV-TEST] Initializing Store context');
            await iapModule.initStoreContext();
            console.log('[IAP-DEV-TEST] Store context initialized');
        }
    } catch (error) {
        console.error('[IAP-DEV-TEST] initStoreContext failed:', error);
        // Don't mark as failure - Store context is optional for diagnostics
    }

    try {
        diagnostics = iapModule.getNativeModuleDiagnostics ? iapModule.getNativeModuleDiagnostics() : null;
        available = available || (diagnostics && diagnostics.loaded === true);
        console.log('[IAP-DEV-TEST] Diagnostics:', diagnostics);
    } catch (error) {
        console.error('[IAP-DEV-TEST] getNativeModuleDiagnostics failed:', error);
        success = false;
    }

    try {
        products = await iapModule.getProducts();
        console.log('[IAP-DEV-TEST] getProducts result:', products);
    } catch (error) {
        console.error('[IAP-DEV-TEST] getProducts failed:', error);
        success = false;
    }

    try {
        licenseInfo = await iapModule.getLicenseInfo();
        console.log('[IAP-DEV-TEST] getLicenseInfo result:', licenseInfo);
    } catch (error) {
        console.error('[IAP-DEV-TEST] getLicenseInfo failed:', error);
        success = false;
    }

    try {
        ownership = await iapModule.checkOwnership(storeProductId);
        console.log('[IAP-DEV-TEST] checkOwnership result:', ownership);
    } catch (error) {
        console.error('[IAP-DEV-TEST] checkOwnership failed:', error);
        success = false;
    }

    console.log('[IAP-DEV-TEST] Final result:', {
        available,
        diagnostics,
        products,
        licenseInfo,
        ownership,
        success
    });

    process.exit(success ? 0 : 1);
}

// Detect and set language for Electron and config
function detectAndSetLanguage() {
    const availableLangs = lang.availableLangs;

    // Resolve system locale via Electron APIs (works on Windows/MSIX where LANG env var is absent)
    let systemLocale = null;
    try {
        const raw = app.getSystemLocale ? app.getSystemLocale() : '';
        if (raw) systemLocale = raw.split('-')[0].toLowerCase();
    } catch (_) { }

    let appLocale = null;
    try {
        const raw = app.getLocale ? app.getLocale() : '';
        if (raw) appLocale = raw.split('-')[0].toLowerCase();
    } catch (_) { }

    // Validate saved config language; discard if no longer available
    const savedLanguage = config.language && availableLangs.includes(config.language) ? config.language : null;

    // Preference order: valid saved config > system locale > app locale > 'en'
    const candidates = [savedLanguage, systemLocale, appLocale, 'en'];
    const selectedLanguage = candidates.find(l => l && availableLangs.includes(l)) || 'en';

    config.language = selectedLanguage;
    console.log(`[MAIN] Language detected: ${selectedLanguage} (saved=${savedLanguage}, system=${systemLocale}, app=${appLocale})`);

    app.commandLine.appendSwitch('lang', selectedLanguage);
    app.commandLine.appendSwitch('disable-features', 'TranslateUI');
}

// detectAndSetLanguage is now triggered after app.whenReady(),
// because app.getSystemLocale() requires the app to be ready.
const manifest = require('../../package.json');
const crypto = require('crypto');

let tray = null;

// Initialize license system
async function initializeLicense() {
    try {
        const licenseInfo = licenseManager.getLicenseInfo();
        config.isPro = licenseInfo.isPro;
        config.ProFeatures = licenseInfo.features;
        config.freeAppLimit = licenseInfo.appLimit;

        if (licenseInfo.isPro) {
            console.log('[MAIN] Pro license active');
        } else {
            console.log('[MAIN] Free version active, limit:', licenseInfo.appLimit, 'apps');
        }
    } catch (error) {
        console.error('[MAIN] Error initializing license:', error);
        config.isPro = false;
        config.ProFeatures = licenseManager.getProFeatures();
        config.freeAppLimit = 2;
    }
}

async function refreshStoreProEntitlement(reason = 'unknown', timeoutMs = 5000) {
    // Note: do NOT guard on isStoreInstall here — the IAP native module can
    // function even when installed via EXE (Windows links purchases to the
    // Microsoft Account, not to the install method).
    try {
        if (typeof iapModule.waitForIapChildReady === 'function') {
            await iapModule.waitForIapChildReady(timeoutMs);
        }

        // Initialize Store context to ensure it's fully ready for license queries
        // This must happen before getLicenseInfo() to properly detect existing licenses
        if (typeof iapModule.initStoreContext === 'function') {
            try {
                await iapModule.initStoreContext();
            } catch (initErr) {
                console.warn(`[MAIN] Store context initialization failed (${reason}):`, initErr && initErr.message ? initErr.message : String(initErr));
                // Continue - getLicenseInfo might still work with fallback
            }
        }

        const storeLicenseInfo = await iapModule.getLicenseInfo();
        const isStorePro = !!(storeLicenseInfo && storeLicenseInfo.isPro === true);
        lastKnownStorePro = isStorePro;
        // Keep the license manager in sync so feature/limit checks honor the Store purchase.
        licenseManager.setStorePro(isStorePro);

        if (isStorePro) {
            config.isPro = true;
            config.ProFeatures = (Array.isArray(storeLicenseInfo.features) && storeLicenseInfo.features.length > 0)
                ? storeLicenseInfo.features
                : licenseManager.getProFeatures();
            config.freeAppLimit = Infinity;
            console.log(`[MAIN] Store Pro entitlement active (${reason})`);
        } else {
            console.log(`[MAIN] Store Pro entitlement not active (${reason})`);
        }

        return {
            checked: true,
            isStoreInstall: true,
            isPro: isStorePro,
            licenseInfo: storeLicenseInfo
        };
    } catch (error) {
        console.warn(`[MAIN] Store entitlement refresh failed (${reason}):`, error && error.message ? error.message : error);
        return {
            checked: true,
            isStoreInstall: true,
            isPro: lastKnownStorePro,
            error: error && error.message ? error.message : String(error)
        };
    }
}

// Security: Never trust config.isPro - always re-validate
function enforceProCheck() {
    try {
        // Re-validate license on every critical operation
        const licenseInfo = licenseManager.getLicenseInfo();
        const wasPro = config.isPro;
        const effectiveStorePro = lastKnownStorePro;
        // Keep the license manager in sync so feature/limit checks honor the Store purchase.
        licenseManager.setStorePro(effectiveStorePro);
        config.isPro = licenseInfo.isPro || effectiveStorePro;

        // If Pro status changed, update immediately
        if (config.isPro !== wasPro) {
            if (licenseInfo.isPro) {
                config.ProFeatures = licenseInfo.features;
                config.freeAppLimit = licenseInfo.appLimit;
            } else if (effectiveStorePro) {
                config.ProFeatures = config.ProFeatures || licenseManager.getProFeatures();
                config.freeAppLimit = Infinity;
            } else {
                config.ProFeatures = licenseInfo.features;
                config.freeAppLimit = licenseInfo.appLimit;
            }
            // If Pro was revoked, revoke Pro-only settings so UI reflects state
            if (!config.isPro) {
                if (config.runHighPriority) {
                    config.runHighPriority = false;
                    console.log('[MAIN] Revoking runHighPriority due to Pro removal');
                }
                if (config.muteWindows) {
                    config.muteWindows = false;
                    console.log('[MAIN] Revoking muteWindows due to Pro removal');
                }
                if (config.password) {
                    config.password = null;
                    console.log('[MAIN] Clearing password due to Pro removal');
                }
                if (config.hideTrayWhenHidden) {
                    config.hideTrayWhenHidden = false;
                    console.log('[MAIN] Revoking hideTrayWhenHidden due to Pro removal');
                }
            }
            updateConfig(config);
            console.log('[MAIN] Pro status changed:', config.isPro);
        }

        return config.isPro;
    } catch (error) {
        console.error('[MAIN] Error enforcing Pro check:', error);
        config.isPro = false;
        return false;
    }
}

global.config = config;
config.showEmergencyButton = normalizeFloatingButtonMode(config.showEmergencyButton);
global.window = null;
global.currentState = config.lastState || 'show'; // Restaurar estado salvo ou usar 'show' como padrão
global.uiMode = 'main'; // Estado da UI: 'main' ou 'float'
let previousWindowState = 'show';
let uiModeBeforeHide = null;
let autoFloatBlurTimer = null;
let autoFloatPaused = false;
let mainWindowSize = { width: 640, height: 550 }; // Tamanho padrão da janela principal
let mainWindowPosition = { x: 100, y: 100 }; // Posição padrão da janela principal // Rastreia o estado anterior da janela
let lastNormalWindowBounds = null; // Guarda o tamanho/posição antes da maximização para restaurar corretamente
let authWindowSize = null; // Tamanho da janela antes da autenticação
let authWindowPosition = null; // Posição da janela antes da autenticação
let titlebarOverlayManager = null

// Helper para atualizar tamanho/posição principais com validações básicas
function setMainWindowBounds(size = {}, position = {}, { applyToWindow = true, save = true } = {}) {
    try {
        const work = screen.getPrimaryDisplay().workAreaSize;

        // Use requested values when provided, fallback to current saved values
        const requestedWidth = (typeof size.width === 'number') ? size.width : mainWindowSize.width;
        const requestedHeight = (typeof size.height === 'number') ? size.height : mainWindowSize.height;

        // Abort if requested size is too small
        if (requestedWidth < 200 || requestedHeight < 200) {
            console.warn('[MAIN] Aborting setMainWindowBounds - requested size too small', { requestedWidth, requestedHeight });
            return;
        }

        // Clamp requested size to work area limits
        const width = Math.min(requestedWidth, work.width);
        const height = Math.min(requestedHeight, work.height);

        // Use candidate position (explicit if provided, fallback to current)
        const xCandidate = (typeof position.x === 'number') ? position.x : mainWindowPosition.x;
        const yCandidate = (typeof position.y === 'number') ? position.y : mainWindowPosition.y;

        // Clamp position so the window always fits within the work area. The
        // window's outer size can be a few px larger than the nominal size
        // (e.g. 551 vs 550) due to the frame, so instead of aborting (which left
        // the window unable to restore), nudge the position up/left to fit.
        const x = Math.max(0, Math.min(xCandidate, work.width - width));
        const y = Math.max(0, Math.min(yCandidate, work.height - height));

        mainWindowSize = { width, height };
        mainWindowPosition = { x, y };

        if (save) {
            try {
                config.mainWindowSize = mainWindowSize;
                config.mainWindowPosition = mainWindowPosition;
            } catch (err) {
                console.warn('[MAIN] Failed to save main window bounds to config:', err && err.message ? err.message : err);
            }
        }

        if (applyToWindow && window) {
            try {
                window.setBounds({ x, y, width, height });
                if (window.webContents) window.webContents.send('resize-window', x, y, width, height);
            } catch (err) {
                console.warn('[MAIN] Failed to apply bounds to native window:', err && err.message ? err.message : err);
            }
        }
    } catch (error) {
        console.warn('[MAIN] setMainWindowBounds error:', error && error.message ? error.message : error);
    }
}
let isRestoring = false; // Flag to prevent resize listener from interfering during restore
let lastMaximizedState = false; // Track last maximized state to avoid unnecessary notifications

// edge margins used for positioning the window
const FLOAT_MARGIN = 8;  // small gap for the floating button
const AUTH_MARGIN = 18;  // larger gap when showing auth dialog (avoid taskbar)
console.log('[MAIN] Initial previous window state:', previousWindowState);
console.log('[MAIN] Restoring last state:', global.currentState);

// Determine the correct working directory for both development and production
let cwd;
if (app.isPackaged) {
    // In production (packaged app), use the resources path
    cwd = path.join(process.resourcesPath, 'app.asar');
} else {
    // In development, go up two levels from src/main to project root
    cwd = path.resolve(__dirname, '../..');
}

function getDefaultIconPath() {
    const candidates = [];

    if (cwd) {
        candidates.push(path.join(cwd, 'snapaway.ico'));
        candidates.push(path.join(cwd, 'src', 'renderer', 'assets', 'images', 'default-icon.png'));
    }

    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'snapaway.ico'));
        candidates.push(path.join(process.resourcesPath, 'app.asar', 'snapaway.ico'));
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'snapaway.ico'));
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'renderer', 'assets', 'default-icon.png'));
    }

    candidates.push(path.join(path.dirname(process.execPath), 'snapaway.ico'));
    candidates.push(path.resolve(__dirname, '..', '..', 'snapaway.ico'));
    candidates.push(path.resolve(__dirname, '..', 'renderer', 'assets', 'images', 'default-icon.png'));

    for (const iconPath of candidates) {
        try {
            if (iconPath && fs.existsSync(iconPath)) {
                return iconPath;
            }
        } catch (_) {
            // continue checking next candidate
        }
    }

    return null;
}

// Converte um caminho de ícone numa NativeImage. `nativeImage.createFromPath`
// lida com arquivos dentro do app.asar — ao contrário do campo `icon`/`setIcon`
// do BrowserWindow, que recebem o path cru e falham com "Failed to load image
// from path" (fix ELECTRON-12). Devolve undefined se não conseguir carregar.
function toNativeIcon(iconPath) {
    if (!iconPath) return undefined;
    try {
        const img = nativeImage.createFromPath(iconPath);
        return img && !img.isEmpty() ? img : undefined;
    } catch (_) {
        return undefined;
    }
}

function getTrayIconPath() {
    const useWhite = (typeof nativeTheme !== 'undefined' && nativeTheme.shouldUseDarkColors) || false;
    const iconFile = useWhite ? 'tray-white.ico' : 'tray-black.ico';
    const fallbackFile = useWhite ? 'tray-black.ico' : 'tray-white.ico';

    // Primary candidates (correct icon for current theme) — checked first
    const primaryCandidates = [];
    // Fallback candidates (opposite icon) — checked only if primary is not found anywhere
    const fallbackCandidates = [];

    if (process.resourcesPath) {
        primaryCandidates.push(path.join(process.resourcesPath, 'app.asar', 'src', 'renderer', 'assets', 'images', iconFile));
        primaryCandidates.push(path.join(process.resourcesPath, 'app.asar', 'out', 'renderer', iconFile));
        primaryCandidates.push(path.join(process.resourcesPath, 'app.asar', 'out', 'renderer', 'assets', 'images', iconFile));

        fallbackCandidates.push(path.join(process.resourcesPath, 'app.asar', 'src', 'renderer', 'assets', 'images', fallbackFile));
        fallbackCandidates.push(path.join(process.resourcesPath, 'app.asar', 'out', 'renderer', fallbackFile));
        fallbackCandidates.push(path.join(process.resourcesPath, 'app.asar', 'out', 'renderer', 'assets', 'images', fallbackFile));
    }

    const baseAssetPaths = [
        path.join(cwd || __dirname, 'src', 'renderer', 'assets', 'images'),
        path.join(__dirname, '..', 'renderer', 'assets', 'images')
    ];

    for (const basePath of baseAssetPaths) {
        primaryCandidates.push(path.join(basePath, iconFile));
        fallbackCandidates.push(path.join(basePath, fallbackFile));
    }

    primaryCandidates.push(path.join(cwd || __dirname, 'out', 'renderer', iconFile));
    fallbackCandidates.push(path.join(cwd || __dirname, 'out', 'renderer', fallbackFile));

    // Always check ALL primary paths before falling back to the wrong-color icon
    for (const candidate of primaryCandidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    for (const candidate of fallbackCandidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getTrayImage(iconPath) {
    if (!iconPath) return null;

    try {
        let image = nativeImage.createFromPath(iconPath);
        if (image && !image.isEmpty() && screen && screen.getPrimaryDisplay) {
            const scaleFactor = Math.max(1, Math.round(screen.getPrimaryDisplay().scaleFactor || 1));
            const size = Math.max(16, Math.round(16 * scaleFactor));
            image = image.resize({ width: size, height: size });
        }
        return image;
    } catch (err) {
        console.error('[MAIN] Failed to load tray image:', iconPath, err && err.message ? err.message : err);
        return null;
    }
}

console.log('[MAIN] Working directory:', cwd);
process.on('uncaughtException', error => {
    console.error('[MAIN] uncaughtException:', error && error.stack ? error.stack : error);
    appendIapTrace('process.uncaughtException', { error: serializeError(error) });
});
process.on('unhandledRejection', reason => {
    console.error('[MAIN] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
    appendIapTrace('process.unhandledRejection', {
        reason: reason && reason.stack ? reason.stack : String(reason)
    });
});
process.on('exit', code => {
    appendIapTrace('process.exit', { code });
});
process.on('beforeExit', code => {
    appendIapTrace('process.beforeExit', { code });
});
process.on('SIGTERM', () => {
    appendIapTrace('process.sigterm', null);
});

const locked = app.requestSingleInstanceLock();
if (!locked) {
    console.log('Another instance is already running');
    app.quit();
    process.exit(0);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[MAIN] Second instance detected - current state:', global.currentState, 'UI mode:', global.uiMode);

    // Guard (fix ELECTRON-E): se a janela principal já foi destruída (ex.: o
    // app está encerrando enquanto uma nova instância é iniciada), não tente
    // operar sobre ela — chamadas a window.* lançariam "Object has been destroyed".
    if (global.window && global.window.isDestroyed()) {
        console.warn('[MAIN] second-instance: main window destroyed, skipping UI actions');
        global.window = null;
        return;
    }

    if (global.currentState === 'show') {
        console.log('[MAIN] In show-state, displaying main-mode');
        if (global.uiMode === 'float') {
            toggleUIMode('main', 'second-instance');
        }
        if (window && !window.isDestroyed()) {
            if (window.isMinimized()) {
                window.restore();
            }
            window.focus();
        }
    } else {
        if (config.password) {
            console.log('[MAIN] In hide-state with password, displaying auth-mode');
            showAuthPrompt('auth-request');
        } else {
            console.log('[MAIN] In hide-state without password, displaying main-mode still in hide-state');
            if (global.uiMode === 'float') {
                toggleUIMode('main', 'second-instance');
            }
            if (window && !window.isDestroyed()) {
                if (window.isMinimized()) {
                    window.restore();
                }
                window.focus();
            }
        }
    }
});

initTitlebarSupport();

// Login item management via Electron's built-in API
// No auto-launch package needed - HKCU registry does not require elevation
function setLoginItemEnabled(enable) {
    app.setLoginItemSettings({
        openAtLogin: enable,
        path: process.execPath,
        args: ['--autostart']
    });
}

function isLoginItemEnabled() {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
}

async function runHelperAction(action, params = {}) {
    const helperPath = resolveHelperPath();
    if (!helperPath) {
        return {
            success: false,
            error: 'HELPER_NOT_FOUND',
            message: 'SnapAwayHelper.exe não encontrado nesta instalação.'
        };
    }

    const payload = Buffer.from(JSON.stringify({ action, ...params }), 'utf8').toString('base64');
    const resultFile = path.join(os.tmpdir(), `snapaway-helper-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const args = ['--payloadBase64', payload, '--resultFile', resultFile];

    try {
        // Run helper WITHOUT elevation (HKCU does not need admin)
        const child = spawn(helperPath, args, {
            cwd: path.dirname(helperPath),
            stdio: 'ignore',
            windowsHide: true
        });

        const result = await new Promise((resolve) => {
            const startTime = Date.now();
            const maxWait = 30000;
            const interval = setInterval(() => {
                if (fs.existsSync(resultFile)) {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    try {
                        const raw = fs.readFileSync(resultFile, 'utf8');
                        const parsed = JSON.parse(raw);
                        resolve(parsed && typeof parsed === 'object' ? parsed : { success: false, error: 'HELPER_INVALID_RESPONSE' });
                    } catch (e) {
                        resolve({ success: false, error: 'HELPER_ERROR', message: e.message });
                    } finally {
                        try { fs.unlinkSync(resultFile); } catch (_) { }
                    }
                } else if (Date.now() - startTime > maxWait) {
                    clearInterval(interval);
                    resolve({ success: false, error: 'HELPER_TIMEOUT', message: 'Timeout aguardar helper' });
                }
            }, 200);

            const timeout = setTimeout(() => {
                clearInterval(interval);
                resolve({ success: false, error: 'HELPER_TIMEOUT', message: 'Timeout aguardar helper' });
            }, maxWait);
        });

        return result;
    } catch (error) {
        return {
            success: false,
            error: 'HELPER_SPAWN_FAILED',
            message: error.message
        };
    }
}

function hashPin(pin) {
    if (!/^\d{4}$/.test(pin)) {
        throw new Error('PIN must be a 4-digit number');
    }
    return crypto.createHash('sha256').update(pin).digest('hex');
}

function createTray() {
    // If a tray already exists (e.g. recreating after hide), destroy it first
    if (tray) {
        try {
            tray.destroy();
        } catch (destroyErr) {
            console.warn('[MAIN] Error destroying previous tray:', destroyErr && destroyErr.message ? destroyErr.message : destroyErr);
        }
        tray = null;
    }

    let iconPath = getTrayIconPath() || getDefaultIconPath();
    let trayIcon = getTrayImage(iconPath);

    if (!trayIcon || trayIcon.isEmpty()) {
        trayIcon = getTrayImage(getDefaultIconPath());
    }

    if (!trayIcon || trayIcon.isEmpty()) {
        trayIcon = getTrayImage(path.join(cwd || __dirname, 'src', 'renderer', 'assets', 'images', 'default-icon.png'));
    }

    if (!trayIcon || trayIcon.isEmpty()) {
        trayIcon = nativeImage.createFromPath(process.execPath);
    }

    if (!trayIcon || trayIcon.isEmpty()) {
        trayIcon = nativeImage.createEmpty();
    }

    try {
        tray = new Tray(trayIcon);
    } catch (error) {
        console.error('[MAIN] Failed to create tray icon:', error && error.stack ? error.stack : error);
        tray = null;
    }

    const click = () => {
        console.log('[MAIN] Tray icon clicked - current state:', global.currentState, 'UI mode:', global.uiMode);

        if (global.currentState === 'show') {
            // In show-state: display main-mode
            console.log('[MAIN] In show-state, displaying main-mode');
            if (global.uiMode === 'float') {
                toggleUIMode('main', 'tray-open');
            }
            if (window && !window.isDestroyed()) {
                if (window.isMinimized()) {
                    window.restore();
                }
                // Always show the window if it's not visible
                if (!window.isVisible()) {
                    console.log('[MAIN] Window is not visible, calling window.show()');
                    window.show();
                }
                window.focus();
            }
        } else {
            // In hide-state: check if password is set
            if (config.password) {
                // Has password: display auth-mode
                console.log('[MAIN] In hide-state with password, displaying auth-mode');
                showAuthPrompt('auth-request');
            } else {
                // No password: display main-mode still in hide-state
                console.log('[MAIN] In hide-state without password, displaying main-mode still in hide-state');
                if (global.uiMode === 'float') {
                    toggleUIMode('main', 'tray-open');
                }
                if (window && !window.isDestroyed()) {
                    if (window.isMinimized()) {
                        window.restore();
                    }
                    // Always show the window if it's not visible
                    if (!window.isVisible()) {
                        console.log('[MAIN] Window is not visible, calling window.show()');
                        window.show();
                    }
                    window.focus();
                }
            }
        }
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: lang.OPEN,
            click: () => {
                // Reuse the standard tray click behaviour to correctly restore main-mode
                click();

                // Send go-home command to renderer once window is visible
                // Guard (fix ELECTRON-H): evita tocar numa janela já destruída.
                if (window && !window.isDestroyed() && window.webContents) {
                    try {
                        window.webContents.send('go-home');
                    } catch (err) {
                        console.warn('[MAIN] Failed to send go-home event:', err);
                    }
                }
            }
        },
        {
            label: lang.OPTIONS,
            click: () => {
                // Reuse the standard tray click behaviour to correctly restore main-mode
                click();

                // Send go-options command to renderer once window is visible
                // Guard (fix ELECTRON-H): evita tocar numa janela já destruída.
                if (window && !window.isDestroyed() && window.webContents) {
                    try {
                        window.webContents.send('go-options');
                    } catch (err) {
                        console.warn('[MAIN] Failed to send go-options event:', err);
                    }
                }
            }
        },
        {
            label: lang.EXIT,
            click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]);

    tray.on('double-click', click);
    const trayTooltip = (config && config.cloakEnabled && config.cloakName) ? config.cloakName : 'SnapAway';
    tray.setToolTip(trayTooltip);
    tray.setContextMenu(contextMenu);
}

// Hide the tray icon (used by the "Hide tray icon when hidden" option)
function destroyTray() {
    if (tray) {
        try {
            tray.destroy();
        } catch (error) {
            console.warn('[MAIN] Error destroying tray icon:', error && error.message ? error.message : error);
        }
        tray = null;
        console.log('[MAIN] Tray icon destroyed (hideTrayWhenHidden)');
    }
}

// Recreate the tray icon if it should be visible
function ensureTray() {
    if (!tray && !(global.currentState === 'hide' && config.hideTrayWhenHidden)) {
        createTray();
        // Re-apply cloaking (custom tray icon/tooltip) after recreation
        if (config.cloakEnabled) {
            applyCloaking();
        }
    }
}

// Sync tray visibility based on hide-state and the hideTrayWhenHidden setting
function syncTrayVisibility() {
    if (global.currentState === 'hide' && config.hideTrayWhenHidden) {
        destroyTray();
    } else {
        ensureTray();
    }
}

// Function to get license manager
function requireLicense() {
    return licenseManager;
}

// Function to apply cloaking
function applyCloaking() {
    try {
        // Check if user has Pro license for cloaking feature
        const licenseManager = requireLicense();
        const effectivePro = config.isPro || licenseManager.isPro();
        if (!effectivePro) {
            // Force disable cloaking for non-Pro users
            config.cloakEnabled = false;
            config.cloakName = '';
            config.cloakIconPath = null;
            // Explicitly persist removal
            try {
                if (config && typeof config.instance !== 'undefined' && typeof config.toObject === 'function') {
                    config.instance.saveData(config.toObject());
                    console.log('[MAIN] Config saved explicitly after clearing cloak due to license');
                    // Notify renderer of updated config so UI state stays in sync
                    try {
                        if (window && window.webContents) {
                            window.webContents.send('config-change', config.toObject());
                            console.log('[MAIN] Sent config-change to renderer after clearing cloak due to license');
                        }
                    } catch (notifyErr) {
                        console.warn('[MAIN] Failed to send config-change after clearing cloak (license):', notifyErr && notifyErr.message ? notifyErr.message : notifyErr);
                    }
                }
            } catch (saveErr) {
                console.warn('[MAIN] Explicit config save failed (clear cloak):', saveErr && saveErr.message ? saveErr.message : saveErr);
            }
        }

        if (!config.cloakEnabled) {
            // Revert to tray monochrome icon, fallback to default icon
            const trayIcon = getTrayIconPath();
            const defaultIcon = getDefaultIconPath();
            const defaultName = 'SnapAway';

            try {
                if (tray) {
                    if (trayIcon && fs.existsSync(trayIcon)) {
                        const trayImage = getTrayImage(trayIcon);
                        if (trayImage && !trayImage.isEmpty()) {
                            tray.setImage(trayImage);
                        }
                    } else if (defaultIcon && fs.existsSync(defaultIcon)) {
                        tray.setImage(defaultIcon);
                    }
                    tray.setToolTip(defaultName);
                }
            } catch (error) {
                console.error('[MAIN] Error setting tray icon:', error);
            }

            try {
                if (window) {
                    if (defaultIcon && fs.existsSync(defaultIcon)) {
                        window.setIcon(defaultIcon);
                    }
                    window.setTitle(defaultName);
                }
            } catch (error) {
                console.error('[MAIN] Error setting window icon/title:', error);
            }

            // Notify renderer to restore default titlebar icon and title
            try {
                if (window && window.webContents) {
                    window.webContents.send('update-cloak-icon', null);
                    window.webContents.send('update-cloak-title', defaultName);
                }
            } catch (error) {
                console.error('[MAIN] Error sending update-cloak-icon/title:', error);
            }

            // Note: AutoLaunch name/icon cannot be changed dynamically
            // The AutoLaunch instance is created with fixed values at startup
            return;
        }

        // Apply cloaking - use custom name if provided, otherwise keep default
        const displayName = (config.cloakName && typeof config.cloakName === 'string' && config.cloakName.trim())
            ? config.cloakName.trim()
            : 'SnapAway';

        // If no icon path, just apply name and return
        if (!config.cloakIconPath || typeof config.cloakIconPath !== 'string') {
            try {
                if (tray) {
                    tray.setToolTip(displayName);
                }
            } catch (error) {
                console.error('[MAIN] Error setting tray tooltip:', error);
            }

            try {
                if (window) {
                    window.setTitle(displayName);
                }
            } catch (error) {
                console.error('[MAIN] Error setting window title:', error);
            }

            // Note: AutoLaunch name/icon cannot be changed dynamically
            // The AutoLaunch instance is created with fixed values at startup
            return;
        }

        // Validate config.paths exists
        if (!config.paths || !config.paths.data) {
            console.error('[MAIN] Config paths.data not available');
            return;
        }

        // Apply cloaking
        let cloakIconPath = path.isAbsolute(config.cloakIconPath)
            ? config.cloakIconPath
            : path.join(config.paths.data, config.cloakIconPath);

        // If icon not present in configured data path, try realistic fallbacks
        if (!fs.existsSync(cloakIconPath)) {
            console.warn('[MAIN] Cloak icon not found at configured path:', cloakIconPath);

            const fallbackCandidates = [];
            try {
                // Packaged app root: <resources>/app
                const appRoot = path.join(process.resourcesPath || '', 'app');
                if (config.cloakIconPath) {
                    fallbackCandidates.push(path.join(appRoot, config.cloakIconPath));
                    fallbackCandidates.push(path.join(appRoot, 'assets', path.basename(config.cloakIconPath)));
                }
            } catch (e) {
                // ignore
            }

            // Dev-time fallbacks relative to source tree
            if (config.cloakIconPath) {
                fallbackCandidates.push(path.join(__dirname, '..', '..', config.cloakIconPath));
                fallbackCandidates.push(path.join(__dirname, '..', '..', 'assets', path.basename(config.cloakIconPath)));
            }

            let found = null;
            for (const cand of fallbackCandidates) {
                try {
                    if (cand && fs.existsSync(cand)) {
                        found = cand;
                        console.log('[MAIN] Found cloak icon fallback at:', cand);
                        break;
                    }
                } catch (err) {
                    // continue
                }
            }

            if (found) {
                cloakIconPath = found;
            } else {
                console.error('[MAIN] Cloak icon not found in any fallback locations. Searched:', [cloakIconPath].concat(fallbackCandidates));
                return;
            }
        }

        // Additional validation: check if file is actually readable
        try {
            fs.accessSync(cloakIconPath, fs.constants.R_OK);
            console.log('[MAIN] Cloak icon file is readable:', cloakIconPath);
        } catch (accessError) {
            console.error('[MAIN] Cloak icon file is not readable:', cloakIconPath, accessError.message);
            return;
        }

        // Get file stats to ensure it's a valid file
        try {
            const stats = fs.statSync(cloakIconPath);
            if (!stats.isFile()) {
                console.error('[MAIN] Cloak icon path is not a file:', cloakIconPath);
                return;
            }
            if (stats.size === 0) {
                console.error('[MAIN] Cloak icon file is empty:', cloakIconPath);
                return;
            }
            console.log('[MAIN] Cloak icon file validated - size:', stats.size, 'bytes');
        } catch (statsError) {
            console.error('[MAIN] Error getting cloak icon file stats:', statsError.message);
            return;
        }

        // Use appropriate icon based on platform
        // On Windows, Electron accepts PNG as icon, so we can use PNG directly
        let iconToUse = cloakIconPath;

        // On Windows, prefer PNG over ICO for better compatibility with Electron
        if (process.platform === 'win32' && iconToUse.endsWith('.ico')) {
            const pngPath = iconToUse.replace(/\.ico$/, '.png');
            if (fs.existsSync(pngPath)) {
                console.log('[MAIN] Using PNG icon instead of ICO for better Windows compatibility');
                iconToUse = pngPath;
            }
        }

        try {
            if (tray) {
                // Use tray-specific icon if available
                const trayIconPath = cloakIconPath.replace(/\.(ico|png)$/, '-tray.png');
                let finalTrayIcon = fs.existsSync(trayIconPath) ? trayIconPath : iconToUse;
                if (!fs.existsSync(finalTrayIcon)) {
                    finalTrayIcon = getTrayIconPath() || iconToUse;
                }

                const trayImage = getTrayImage(finalTrayIcon);
                if (trayImage && !trayImage.isEmpty()) {
                    tray.setImage(trayImage);
                } else if (iconToUse && fs.existsSync(iconToUse)) {
                    tray.setImage(iconToUse);
                }

                tray.setToolTip(displayName);
            }
        } catch (error) {
            console.error('[MAIN] Error setting tray icon/tooltip:', error);
        }

        try {
            if (window) {
                // Validate and set window icon with better error handling
                if (fs.existsSync(iconToUse)) {
                    console.log('[MAIN] Setting window icon to:', iconToUse);
                    try {
                        window.setIcon(iconToUse);
                        console.log('[MAIN] Window icon set successfully');
                    } catch (iconError) {
                        console.warn('[MAIN] Failed to set window icon, continuing without it:', iconError.message);
                    }
                } else {
                    console.warn('[MAIN] Window icon file does not exist:', iconToUse);
                }

                // Always try to set the title
                window.setTitle(displayName);
                console.log('[MAIN] Window title set to:', displayName);
            }
        } catch (error) {
            console.error('[MAIN] Error setting window icon/title:', error);
            console.error('[MAIN] Icon path was:', iconToUse);
            console.error('[MAIN] File exists check:', fs.existsSync(iconToUse));

            // Fallback: try to set just the title if everything else fails
            try {
                if (window) {
                    window.setTitle(displayName);
                    console.log('[MAIN] Fallback: Window title set successfully');
                }
            } catch (titleError) {
                console.error('[MAIN] Critical error: Could not set window title:', titleError);
            }
        }

        // Quick visual fallback: set an overlay icon on Windows taskbar button
        try {
            if (process.platform === 'win32' && window && fs.existsSync(iconToUse)) {
                try {
                    const overlay = nativeImage.createFromPath(iconToUse);
                    if (!overlay.isEmpty && typeof window.setOverlayIcon === 'function') {
                        window.setOverlayIcon(overlay, displayName);
                        console.log('[MAIN] Overlay icon set for taskbar');
                    }
                } catch (ovErr) {
                    console.warn('[MAIN] Could not set overlay icon:', ovErr.message || ovErr);
                }
            }
        } catch (err) {
            console.warn('[MAIN] Overlay icon step failed:', err && err.message ? err.message : err);
        }

        // Notify renderer to update titlebar icon and title
        try {
            if (window && window.webContents) {
                const titlebarIconPath = cloakIconPath.replace(/\.(ico|png)$/, '-titlebar.png');
                let finalTitlebarIcon = null;

                // Try to find the best icon for titlebar
                if (fs.existsSync(titlebarIconPath)) {
                    finalTitlebarIcon = titlebarIconPath;
                } else if (fs.existsSync(iconToUse)) {
                    finalTitlebarIcon = iconToUse;
                }

                if (finalTitlebarIcon) {
                    console.log('[MAIN] Sending update-cloak-icon:', finalTitlebarIcon);
                    window.webContents.send('update-cloak-icon', finalTitlebarIcon);
                } else {
                    console.error('[MAIN] No valid icon found to send to titlebar');
                }

                // Also send the display name to update titlebar title
                console.log('[MAIN] Sending update-cloak-title:', displayName);
                window.webContents.send('update-cloak-title', displayName);
            } else {
                console.error('[MAIN] Window or webContents not available for sending update-cloak-icon');
            }
        } catch (error) {
            console.error('[MAIN] Error sending update-cloak-icon/title:', error);
        }

        // Create or update a Desktop shortcut on Windows with the cloak name/icon
        try {
            if (process.platform === 'win32') {
                try {
                    const desktopPath = app.getPath('desktop');
                    const shortcutPath = path.join(desktopPath, `${displayName}.lnk`);

                    // Prefer an ICO if available for the shortcut; otherwise omit icon (Windows will use exe icon)
                    let shortcutIcon = null;
                    if (fs.existsSync(iconToUse) && iconToUse.toLowerCase().endsWith('.ico')) {
                        shortcutIcon = iconToUse;
                    } else {
                        const altIco = cloakIconPath.replace(/\.(png|ico)$/i, '.ico');
                        if (fs.existsSync(altIco)) shortcutIcon = altIco;
                    }

                    const shortcutOptions = {
                        target: process.execPath,
                        args: '',
                        description: displayName,
                        workingDirectory: path.dirname(process.execPath)
                    };
                    if (shortcutIcon) shortcutOptions.icon = shortcutIcon;

                    const result = shell.writeShortcutLink(shortcutPath, shortcutOptions);
                    console.log('[MAIN] Desktop shortcut create/update attempted:', shortcutPath, 'result:', result);
                } catch (scErr) {
                    console.warn('[MAIN] Could not create/update desktop shortcut:', scErr && scErr.message ? scErr.message : scErr);
                }
            }
        } catch (err) {
            console.warn('[MAIN] Desktop shortcut step failed:', err && err.message ? err.message : err);
        }

        // Note: AutoLaunch name/icon cannot be changed dynamically
        // The AutoLaunch instance is created with fixed values at startup
        // To change AutoLaunch name/icon, the app would need to be restarted
        // or a new AutoLaunch instance would need to be created
    } catch (error) {
        console.error('[MAIN] Error in applyCloaking:', error);
    }
}

function getWindowHwndString(targetWindow) {
    try {
        if (!targetWindow || targetWindow.isDestroyed()) return ''
        const handleBuffer = targetWindow.getNativeWindowHandle()
        if (!handleBuffer || handleBuffer.length === 0) return ''

        let value = 0n
        for (let i = handleBuffer.length - 1; i >= 0; i -= 1) {
            value = (value << 8n) + BigInt(handleBuffer[i])
        }
        return value.toString()
    } catch (_) {
        return ''
    }
}

function isSnapAwayWindowHwnd(hwndStr) {
    if (!hwndStr) return false
    try {
        const normalize = (value) => {
            if (!value) return ''
            const raw = String(value).trim().toLowerCase()
            if (!raw) return ''
            if (raw.startsWith('0x')) {
                try {
                    return BigInt(raw).toString(10)
                } catch (_) {
                    return raw
                }
            }
            return raw
        }

        const target = normalize(hwndStr)
        return BrowserWindow.getAllWindows().some(win => normalize(getWindowHwndString(win)) === target)
    } catch (_) {
        return false
    }
}

async function handleOverlayClick(hwndStr) {
    if (!hwndStr) return

    const registered = system.registerWindow(hwndStr)
    if (!registered) {
        console.log('[OVERLAY] ignored click for invalid window:', hwndStr)
        return
    }

    // Add to persisted config.filters so it appears in the filters list
    let addedExecutable = null
    try {
        const filter = system.buildManagedFilterFromHwnd(hwndStr)
        if (filter && filter.title) {
            addedExecutable = filter.executable || null
            const titleFilter = {
                type: 'title',
                value: filter.title,
                hwnd: filter.hwnd,
                title: filter.title,
                className: filter.className,
                process: filter.process,
                executable: addedExecutable,
                icon: system.getIconUrlForExecutable(addedExecutable) || null,
                insensitive: false
            }
            const exists = Array.isArray(config.filters) && config.filters.some(f =>
                f.type === 'title' && f.value === filter.title
            )
            if (!exists) {
                if (!Array.isArray(config.filters)) config.filters = []
                config.filters.push(titleFilter)
                await updateConfig(config)
                console.log('[OVERLAY] added to filters:', filter.title, '| icon:', titleFilter.icon)

                // If the icon was not cached yet, resolve it on demand and update
                // the filter once available (works even after the window is hidden).
                if (!titleFilter.icon && addedExecutable) {
                    system.resolveIconForExecutable(addedExecutable).then(iconUrl => {
                        if (!iconUrl) return
                        const idx = Array.isArray(config.filters) ? config.filters.findIndex(f =>
                            f.executable === addedExecutable && f.value === filter.title
                        ) : -1
                        if (idx !== -1 && !config.filters[idx].icon) {
                            config.filters[idx].icon = iconUrl
                            updateConfig(config)
                            console.log('[OVERLAY] filter icon resolved:', filter.title, '|', iconUrl)
                        }
                    })
                }
            }
        }
    } catch (error) {
        console.warn('[OVERLAY] failed to add filter for clicked window:', error && error.message ? error.message : error)
    }

    // Hide the clicked window immediately. If it belongs to an elevated process
    // (hiding requires elevation), go straight to the elevated helper — the UAC
    // prompt itself is the confirmation, so no extra "ask admin?" dialog that
    // just slows down the hide gesture.
    try {
        const hideResult = await system.enableHideState(hwndStr)
        if (hideResult && hideResult.requiresElevation) {
            console.log('[OVERLAY] target window requires elevation to hide, elevating');
            const elevatedResult = await runElevatedAction('hide-window', { hwnd: hwndStr });
            if (!elevatedResult || !elevatedResult.success) {
                console.warn('[OVERLAY] elevated hide failed:', elevatedResult && elevatedResult.message ? elevatedResult.message : 'unknown');
            }
        }
    } catch (error) {
        console.warn('[OVERLAY] failed to hide clicked window immediately:', error && error.message ? error.message : error)
    }

    if (global.currentState !== 'hide') {
        toggleShowHide('hide', 'titlebar-overlay', true)
        if (global.uiMode === 'main') {
            toggleUIMode('float', 'titlebar-overlay')
        }
        return
    }

    try {
        await system.enableHideStateForSelected()
    } catch (error) {
        console.warn('[OVERLAY] failed to apply hide-state for selected windows:', error && error.message ? error.message : error)
    }
}

function startTitlebarOverlay() {
    if (process.platform !== 'win32') return
    if (config.showTitlebarOverlay === false) {
        console.log('[OVERLAY] disabled by config')
        return
    }
    // If a manager already exists (possibly stale after a stop that didn't
    // complete), tear it down and recreate from scratch so re-enabling always
    // produces a fully working overlay.
    if (titlebarOverlayManager) {
        console.log('[OVERLAY] manager already exists — recreating')
        stopTitlebarOverlay()
    }

    console.log('[OVERLAY] starting titlebar overlay manager')

    titlebarOverlayManager = createOverlayManager({
        ipcMain,
        isOwnWindow: isSnapAwayWindowHwnd,
        isWindowManaged: hwndStr => {
            try {
                return system.isWindowManaged(hwndStr)
            } catch (_) {
                return false
            }
        },
        // Never show the overlay icon while the app is in the "hide" state
        // (windows hidden). It only makes sense to offer hiding when things
        // are visible.
        shouldShowOverlay: () => global.currentState !== 'hide',
        onClick: handleOverlayClick
    })

    try {
        titlebarOverlayManager.start()
        console.log('[OVERLAY] titlebar overlay manager started')
    } catch (error) {
        console.warn('[OVERLAY] failed to start titlebar overlay:', error && error.message ? error.message : error)
        titlebarOverlayManager = null
    }
}

function stopTitlebarOverlay() {
    if (!titlebarOverlayManager) return
    try {
        titlebarOverlayManager.stop()
    } catch (error) {
        console.warn('[OVERLAY] failed to stop titlebar overlay:', error && error.message ? error.message : error)
    }
    titlebarOverlayManager = null
}

function createWindow() {
    console.log('[MAIN] createWindow() called');
    try {
        if (window) {
            window?.show()
            window?.focus()
            return window;
        }
    } catch (error) {
        console.error(error);
    }

    // Use correct preload path for both development and production
    let preload;
    if (app.isPackaged) {
        // Em produção (empacotado)
        preload = path.join(process.resourcesPath, 'app.asar', 'out', 'preload', 'index.js');
    } else {
        // Em desenvolvimento
        preload = path.join(__dirname, '../../out/preload/index.js');
    }

    console.log('[MAIN] Preload script path:', preload);
    console.log('[MAIN] __dirname:', __dirname);
    console.log('[MAIN] app.isPackaged:', app.isPackaged);
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    // Usar tamanho e posição salvos no config, ou valores padrão
    let savedSize = config.mainWindowSize || { width: 640, height: 550 };
    let savedPosition = config.mainWindowPosition || { x: width - 640 - 18, y: height - 550 };

    // Se o tamanho salvo é muito grande (provavelmente estava maximizado), usar tamanho padrão
    const workArea = screen.getPrimaryDisplay().workArea;
    const tolerance = 50; // TolerÃ¢ncia para considerar que estava maximizado
    if (savedSize.width >= workArea.width - tolerance || savedSize.height >= workArea.height - tolerance) {
        console.log('[MAIN] Saved size appears to be maximized, using default size instead');
        savedSize = { width: 640, height: 550 };
        savedPosition = { x: width - 640 - 18, y: height - 550 };
        // Atualizar config com tamanho padrão
        config.mainWindowSize = savedSize;
        config.mainWindowPosition = savedPosition;
        // Use helper to set main window bounds without applying to native window (we're still creating it)
        setMainWindowBounds(savedSize, savedPosition, { applyToWindow: false, save: false });
    }

    // Garantir que a janela não fique fora da tela, mas mantenha a margem de 18px do canto direito
    const maxX = width - savedSize.width - 18; // Manter margem de 18px do canto direito
    const maxY = height - savedSize.height;
    const x = Math.max(0, Math.min(savedPosition.x, maxX));
    const y = Math.max(0, Math.min(savedPosition.y, maxY));

    // Use helper to validate/clamp and set saved main window bounds
    setMainWindowBounds({ width: savedSize.width, height: savedSize.height }, savedPosition, { applyToWindow: false, save: false });

    const windowIcon = getDefaultIconPath() || path.join(__dirname, '..', 'renderer', 'assets', 'images', 'default-icon.png');

    // Fix ELECTRON-12: o campo `icon` recebe o path cru e não lê dentro do
    // app.asar — converte para NativeImage (aware-de-asar) antes de passar.
    const windowIconImage = toNativeIcon(windowIcon);

    global.window = new BrowserWindow({
        icon: windowIconImage,
        width: mainWindowSize.width,
        height: mainWindowSize.height,
        minWidth: 20,
        minHeight: 20,
        x: mainWindowPosition.x,
        y: mainWindowPosition.y,
        show: global.currentState !== 'hide',
        titleBarStyle: 'hidden',
        transparent: true,
        backgroundColor: '#01000000',
        hasShadow: false,
        webPreferences: {
            preload,
            devTools: true,
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            nativeWindowOpen: true
        }
    });
    attachTitlebarToWindow(window);

    // Redirect renderer console logs to main process console
    window.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        const levelName = levels[level] || 'UNKNOWN';

        // Format the message with renderer prefix
        const formattedMessage = `[RENDERER-${levelName}] ${message}`;

        // Log to main process console based on level
        switch (level) {
            case 0: // DEBUG
                console.debug(formattedMessage);
                break;
            case 1: // INFO
                console.info(formattedMessage);
                break;
            case 2: // WARN
                console.warn(formattedMessage);
                break;
            case 3: // ERROR
                console.error(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
        }
    });

    window.webContents.on('render-process-gone', (event, details) => {
        console.error('[MAIN] render-process-gone:', details);
        appendIapTrace('window.render-process-gone', details || null);
        if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
            telemetry.captureTelemetryEvent('window.render-process-gone', details || null);
        }
    });

    window.on('unresponsive', () => {
        appendIapTrace('window.unresponsive');
    });

    window.on('responsive', () => {
        appendIapTrace('window.responsive');
    });

    window.on('close', (event) => {
        appendIapTrace('window.close', { appIsQuiting: !!app.isQuiting, uiMode: global.uiMode, currentState: global.currentState });
        if (!app.isQuiting) {
            event.preventDefault();

            // Persist the current hide/show state so startup reflects actual last state
            config.lastState = global.currentState;

            // Sempre trocar para float-mode quando a janela for fechada no modo principal
            if (global.uiMode === 'main') {
                console.log('[MAIN] Window closed in main mode, switching to float mode');
                toggleUIMode('float', 'close');
            } else {
                // Se não está em main-mode, apenas esconde a janela
                window.hide();
            }
        }
    });

    // Limpa a referência global assim que a janela é de fato destruída.
    // Sem isso, `window` continua apontando para um objeto destruído (truthy),
    // e os guards `if (window)` passam, mas qualquer chamada lança
    // "TypeError: Object has been destroyed" (fix ELECTRON-D/ELECTRON-E).
    window.on('closed', () => {
        console.log('[MAIN] Window closed (destroyed), clearing global window reference');
        global.window = null;
    });

    // Controla a visibilidade do floating button baseado no estado da janela principal
    // Listener para quando a janela é minimizada no modo principal
    window.on('blur', () => {
        console.log('[MAIN] Window lost focus, scheduling auto-float in 5 seconds');
        scheduleAutoFloatBlur();
    });

    window.on('focus', () => {
        if (autoFloatBlurTimer) {
            console.log('[MAIN] Window focus returned before delay expired, canceling auto-float');
            clearTimeout(autoFloatBlurTimer);
            autoFloatBlurTimer = null;
        }
    });

    window.on('minimize', () => {
        appendIapTrace('window.minimize', { uiMode: global.uiMode, currentState: global.currentState });
        if (autoFloatBlurTimer) {
            clearTimeout(autoFloatBlurTimer);
            autoFloatBlurTimer = null;
        }
        console.log('[MAIN] Minimize event triggered');
        console.log('[MAIN] Current UI mode:', global.uiMode);
        console.log('[MAIN] Current show/hide state:', global.currentState);
        console.log('[MAIN] Config showEmergencyButton:', config.showEmergencyButton);
        console.log('[MAIN] Window state at minimize event:');
        console.log('  - isMinimized():', window.isMinimized());
        console.log('  - isVisible():', window.isVisible());

        // Se está no modo principal, sempre ir para float-mode ao minimizar
        if (global.uiMode === 'main') {
            console.log('[MAIN] Window minimized in main mode, switching to floating mode');
            toggleUIMode('float', 'minimize');
        } else {
            console.log('[MAIN] Window minimized but not in main mode, ignoring');
        }
    });

    window.on('hide', () => {
        appendIapTrace('window.hide', { uiMode: global.uiMode, currentState: global.currentState });
        if (autoFloatBlurTimer) {
            clearTimeout(autoFloatBlurTimer);
            autoFloatBlurTimer = null;
        }
        console.log('[MAIN] Hide event triggered');
        console.log('[MAIN] Window state at hide event:');
        console.log('  - isMinimized():', window.isMinimized());
        console.log('  - isVisible():', window.isVisible());

        // Rastreia o estado anterior quando a janela é ocultada
        let newPreviousState;
        if (window.isMinimized()) {
            newPreviousState = 'minimized';
        } else if (window.isVisible()) {
            newPreviousState = 'visible';
        } else {
            newPreviousState = 'hidden';
        }

        console.log('[MAIN] New previous state calculated:', newPreviousState);

        if (previousWindowState !== newPreviousState) {
            console.log(`[MAIN] Previous window state changed: ${previousWindowState} â†’ ${newPreviousState}`);
            previousWindowState = newPreviousState;
        } else {
            console.log('[MAIN] Previous window state unchanged');
        }

        // Envia o estado anterior para todas as janelas
        if (window && window.webContents) window.webContents.send('previous-window-state-changed', previousWindowState);
    });

    // Salvar tamanho e posição da janela quando redimensionada no modo principal
    window.on('resize', () => {
        if (global.uiMode === 'main' && window.isVisible() && !window.isMinimized()) {
            // Check if maximized with a small delay to ensure state is updated
            setTimeout(() => {
                if (!window.isMaximized() && !isRestoring) {
                    const currentSize = window.getSize();
                    const currentPosition = window.getPosition();

                    // SÃ³ salvar se a janela for grande o suficiente (não é floating button)
                    // E não estiver maximizada
                    if (currentSize[0] >= 300 || currentSize[1] >= 300) {
                        // Atualizar variáveis globais
                        // Use helper to clamp and persist new main window size/position
                        setMainWindowBounds({ width: currentSize[0], height: currentSize[1] }, { x: currentPosition[0], y: currentPosition[1] }, { applyToWindow: false, save: true });
                        console.log('[MAIN] Saved main window size and position:', mainWindowSize, mainWindowPosition);
                    } else {
                        console.log('[MAIN] Window too small, not saving as main window size:', currentSize);
                    }
                } else {
                    console.log('[MAIN] Not saving size - window is maximized or restoring');
                }
            }, 50);
        }
    });

    // Snap to bottom edge (taskbar) support
    let snapToBottomTimer = null;
    let isSnappingToBottom = false;

    // Save size and position when window is moved in main mode
    window.on('move', () => {
        if (global.uiMode === 'main' && window.isVisible() && !window.isMinimized()) {
            const currentPosition = window.getPosition();

            // Use helper to clamp and persist the new position (keep existing size)
            setMainWindowBounds(mainWindowSize, { x: currentPosition[0], y: currentPosition[1] }, { applyToWindow: false, save: true });
            console.log('[MAIN] Saved main window position:', mainWindowPosition);

            // Debounced snap-to-bottom behavior (<= 10px)
            if (snapToBottomTimer) {
                clearTimeout(snapToBottomTimer);
            }

            snapToBottomTimer = setTimeout(() => {
                if (!window || isSnappingToBottom || global.uiMode !== 'main' || window.isMinimized()) {
                    return;
                }

                try {
                    const currentPos = window.getPosition();
                    const currentSize = window.getSize();
                    const displayWork = screen.getPrimaryDisplay().workArea;
                    const bottomDistance = (displayWork.y + displayWork.height) - (currentPos[1] + currentSize[1]);

                    if (bottomDistance >= 0 && bottomDistance <= 10) {
                        const snappedY = displayWork.y + displayWork.height - currentSize[1];
                        if (Math.abs(currentPos[1] - snappedY) > 0) {
                            isSnappingToBottom = true;
                            console.log('[MAIN] Snapping window to bottom edge (taskbar) at Y=', snappedY, '(from', currentPos[1], ')');

                            // Apply snapped bounds and persist
                            window.setBounds({ x: currentPos[0], y: snappedY, width: currentSize[0], height: currentSize[1] });
                            setMainWindowBounds({ width: currentSize[0], height: currentSize[1] }, { x: currentPos[0], y: snappedY }, { applyToWindow: false, save: true });

                            // Ensure flag is reset after bounding settles
                            setTimeout(() => {
                                isSnappingToBottom = false;
                            }, 60);
                        }
                    }
                } catch (error) {
                    console.warn('[MAIN] Error snapping to bottom edge:', error && error.message ? error.message : error);
                    isSnappingToBottom = false;
                }
            }, 100);
        }

        // Enviar evento para o renderer atualizar border radius
        if (window && window.webContents) {
            window.webContents.send('window-move');
        }
    });

    // Notificar renderer sobre mudanÃ§as no estado de maximização
    window.on('maximize', () => {
        console.log('[MAXIMIZE-EVENT] ===== EVENTO MAXIMIZE =====');
        const isCurrentlyMaximized = true; // Always true when maximize event fires
        console.log('[MAXIMIZE-EVENT] Enviando estado maximizado:', isCurrentlyMaximized);
        if (window && window.webContents) {
            console.log('[MAXIMIZE-EVENT] Enviando evento window-maximized-changed com valor:', isCurrentlyMaximized);
            window.webContents.send('window-maximized-changed', isCurrentlyMaximized);
            lastMaximizedState = isCurrentlyMaximized;
        }
        console.log('[MAXIMIZE-EVENT] =========================');
    });

    window.on('unmaximize', () => {
        console.log('[UNMAXIMIZE-EVENT] ===== EVENTO UNMAXIMIZE =====');
        const isCurrentlyMaximized = false; // Always false when unmaximize event fires
        console.log('[UNMAXIMIZE-EVENT] Enviando estado não maximizado:', isCurrentlyMaximized);
        if (window && window.webContents) {
            console.log('[UNMAXIMIZE-EVENT] Enviando evento window-maximized-changed com valor:', isCurrentlyMaximized);
            window.webContents.send('window-maximized-changed', isCurrentlyMaximized);
            lastMaximizedState = isCurrentlyMaximized;
        }
        console.log('[UNMAXIMIZE-EVENT] ===========================');
    });

    // Também escutar mudanÃ§as de resize para detectar maximização por arrastar
    window.on('resize', () => {
        // Skip resize detection if we're in the middle of restoring
        if (isRestoring) {
            console.log('[RESIZE-EVENT] Ignorado - restore em andamento');
            return;
        }

        console.log('[RESIZE-EVENT] ===== EVENTO DE REDIMENSIONAMENTO =====');
        console.log('[RESIZE-EVENT] Janela foi redimensionada');

        // Pequeno delay para garantir que o resize terminou
        setTimeout(() => {
            console.log('[RESIZE-EVENT] Verificando estado apÃ³s delay de 100ms');
            if (global.uiMode === 'main') {
                // Use window.isMaximized() directly instead of isWindowMaximized() to avoid false positives
                const isCurrentlyMaximized = window.isMaximized();
                console.log('[RESIZE-EVENT] Estado apÃ³s resize:', isCurrentlyMaximized);
                console.log('[RESIZE-EVENT] Estado anterior:', lastMaximizedState);

                // SÃ³ notifica se o estado mudou
                // (evita notificaÃ§Ãµes desnecessárias durante redimensionamento normal)
                if (isCurrentlyMaximized !== lastMaximizedState && window && window.webContents) {
                    console.log('[RESIZE-EVENT] Estado mudou, enviando notificação:', isCurrentlyMaximized);
                    window.webContents.send('window-maximized-changed', isCurrentlyMaximized);
                    lastMaximizedState = isCurrentlyMaximized;
                } else {
                    console.log('[RESIZE-EVENT] Estado não mudou, não enviando notificação');
                }
            } else {
                console.log('[RESIZE-EVENT] Ignorado - não está em modo main');
            }
            console.log('[RESIZE-EVENT] ======================================');
        }, 100);
    });

    createTray();

    // If "hide tray icon when hidden" is enabled and the app was hidden at startup,
    // remove the tray icon right away.
    syncTrayVisibility();

    // Re-apply tray icon when Windows theme changes (fixes race condition at boot
    // where nativeTheme.shouldUseDarkColors is unstable during first few ms)
    nativeTheme.on('updated', () => {
        try {
            if (tray) {
                const iconPath = getTrayIconPath();
                if (iconPath) {
                    const trayImage = getTrayImage(iconPath);
                    if (trayImage && !trayImage.isEmpty()) {
                        tray.setImage(trayImage);
                        console.log('[MAIN] Tray icon updated for theme change:', iconPath);
                    }
                }
            }
        } catch (err) {
            console.warn('[MAIN] Failed to update tray icon on theme change:', err && err.message ? err.message : err);
        }
    });

    // Apply cloaking on startup (after tray is created)
    setTimeout(() => {
        applyCloaking();
    }, 100);

    // Limpar janelas Ã³rfãs na inicialização
    system.cleanupOrphanedHiddenWindows();

    // Definir modo UI baseado no estado restaurado
    if (global.currentState === 'hide') {
        global.uiMode = 'float';
        console.log('[MAIN] Setting UI mode to float based on restored state');
    } else {
        global.uiMode = 'main';
        console.log('[MAIN] Setting UI mode to main based on restored state');
    }

    // Inicializar sistema de áudio
    system.initializeAudio().catch(error => {
        console.error('[MAIN] Error initializing audio system:', error);
    });

    // Initialize icon extractor
    system.initializeIconExtractor().catch(error => {
        console.error('[MAIN] Error initializing icon extractor:', error);
    });

    const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;
    const rendererProdPath = path.join(cwd, 'out', 'renderer', 'index.html');

    // Guarda de navegação (hardening): o renderer só pode carregar conteúdo
    // do próprio app (file:/data:/devtools: ou, em dev, a origem do dev
    // server). Qualquer navegação externa é bloqueada — impede que um PDF
    // (PDFium do Chromium) ou página externa entre num renderer. Novas
    // janelas são negadas; links http(s) abrem no navegador padrão (mesmo
    // comportamento do launchUrl).
    installNavigationGuards(window, {
      openExternalHttp: true,
      isAllowed(url) {
        try {
          const parsed = new URL(url);
          if (parsed.protocol === 'file:' || parsed.protocol === 'data:' || parsed.protocol === 'devtools:') {
            return true;
          }
          if (rendererDevUrl) {
            return parsed.origin === new URL(rendererDevUrl).origin;
          }
          return false;
        } catch (_navErr) {
          return false;
        }
      }
    });

    if (rendererDevUrl) {
        console.log('[MAIN] Loading renderer from dev server:', rendererDevUrl);
        window.loadURL(rendererDevUrl);
    } else {
        if (!fs.existsSync(rendererProdPath)) {
            throw new Error(`[MAIN] Renderer build output not found: ${rendererProdPath}. Run \"npm run build\" first.`);
        }
        console.log('[MAIN] Loading renderer from file:', rendererProdPath);
        window.loadFile(rendererProdPath);
    }

    window.once('ready-to-show', () => {
        if (global.currentState !== 'hide') {
            console.log('[MAIN] Window ready to show, showing window');
            window.show();
        } else {
            console.log('[MAIN] Window ready to show, keeping hidden because state is hide');
        }
    });

    console.log('[MAIN] Renderer loaded successfully');
    window.setMenu(null);
    const defaultWindowIcon = getDefaultIconPath();
    if (defaultWindowIcon) {
        const defaultWindowIconImage = toNativeIcon(defaultWindowIcon);
        if (defaultWindowIconImage) {
            window.setIcon(defaultWindowIconImage);
        }
    }
    window.setBackgroundColor('#00000000');

    // Aplicar o estado restaurado na inicialização
    console.log('[MAIN] Applying restored state on startup:', global.currentState);

    if (global.currentState === 'hide') {
        // Se o estado era 'hide', aplicar imediatamente
        system.hideWindows().then(() => {
            console.log('[MAIN] Hidden windows restored on startup');
            // Update notification badge after restoring hidden windows
            updateNotificationBadge();
        }).catch(error => {
            console.error('[MAIN] Error restoring hidden windows on startup:', error);
        });

        // Aplicar modo UI float se o estado era 'hide'
        if (global.uiMode === 'float') {
            const margin = FLOAT_MARGIN, { width, height } = screen.getPrimaryDisplay().workAreaSize;
            const buttonSize = { width: 36, height: 36 };
            const x = width - buttonSize.width - margin;
            const y = height - buttonSize.height - margin;

            // Configurar para modo floating
            window.setAlwaysOnTop(true, 'screen-saver');
            window.setSkipTaskbar(true);

            // Redimensionar para floating button
            window.setResizable(false);
            const floatHeight = buttonSize.height + FLOAT_MARGIN;
            const floatY = height - floatHeight;
            window.webContents.send('resize-window', x, floatY, buttonSize.width, floatHeight);
            window.webContents.send('toggle-titlebar', false);

            // Force resize in main process para colar no taskbar
            window.setBounds({
                x: x,
                y: floatY,
                width: buttonSize.width,
                height: floatHeight
            });
            console.log('[MAIN] Window bounds set to:', buttonSize.width, 'x', buttonSize.height, 'at', x, ',', y);

            console.log('[MAIN] Applied floating mode on startup');
        }
    }

    // Ensure renderer also knows the current state by emitting a state change event
    // (useful if the renderer mounted before we sent any state updates)
    if (window && window.webContents) {
        window.webContents.send('state-changed', global.currentState);
    }

    // Always show the window on startup, regardless of password or hidden windows
    // The password will be validated when user tries to show windows
    window.show();

    // Ensure window is not maximized on startup
    if (window.isMaximized()) {
        console.log('[MAIN] Window was maximized on startup, restoring to normal size');
        window.restore();
        // Set to saved size and position after restore
        setTimeout(() => {
            if (window && !window.isMaximized()) {
                window.setSize(mainWindowSize.width, mainWindowSize.height);
                window.setPosition(mainWindowPosition.x, mainWindowPosition.y);
            }
        }, 50);
    }

    // O floating button será ocultado automaticamente pelo evento 'show' da janela

    // Apply cloaking on startup
    applyCloaking();

    return window;
}

async function updateConfig(newConfig) {
    const previousLanguage = config.language;
    const previousRevealHintDismissedForever = !!config.revealHintDismissedForever;
    const previousHideTrayWhenHidden = config.hideTrayWhenHidden;
    const languageChanged = newConfig?.language && newConfig.language !== previousLanguage;
    if (newConfig && Object.prototype.hasOwnProperty.call(newConfig, 'showEmergencyButton')) {
        newConfig.showEmergencyButton = normalizeFloatingButtonMode(newConfig.showEmergencyButton);
    }
    newConfig && Object.assign(config, newConfig);

    // Apply the "hide tray icon when hidden" toggle immediately (even if already hidden)
    if (newConfig && Object.prototype.hasOwnProperty.call(newConfig, 'hideTrayWhenHidden') && newConfig.hideTrayWhenHidden !== previousHideTrayWhenHidden) {
        syncTrayVisibility();
    }

    // Hard Pro gate: never allow "hide tray icon when hidden" without a Pro license
    if (config.hideTrayWhenHidden && !licenseManager.isFeatureAvailable('hideTrayWhenHidden')) {
        config.hideTrayWhenHidden = false;
        syncTrayVisibility();
    }

    if (!previousRevealHintDismissedForever && !!config.revealHintDismissedForever) {
        captureOnboardingTelemetry('onboarding.reveal-hint.dismissed', {
            source: 'settings',
            floatingButtonMode: getFloatingButtonMode()
        });
    }
    system.updateConfig(config);

    globalShortcut.unregisterAll();
    try {
        globalShortcut.register(config.hideKey, () => {
            console.log('[MAIN] Hide key pressed - calling shortcutAction');
            shortcutAction('hide', 'shortcut');
        });
        globalShortcut.register(config.showKey, () => {
            console.log('[MAIN] Show key pressed - calling shortcutAction');
            shortcutAction('show', 'shortcut');
        });
    } catch (error) {
        console.error(error);
    }

    // Handle titlebar overlay toggle
    if (newConfig && Object.prototype.hasOwnProperty.call(newConfig, 'showTitlebarOverlay')) {
        console.log('[OVERLAY] config change → showTitlebarOverlay =', config.showTitlebarOverlay, '| manager =', !!titlebarOverlayManager);
        if (config.showTitlebarOverlay === false && titlebarOverlayManager) {
            stopTitlebarOverlay();
            console.log('[OVERLAY] stopped by config change');
        } else if (config.showTitlebarOverlay !== false && !titlebarOverlayManager) {
            console.log('[OVERLAY] re-enabling overlay via config change');
            startTitlebarOverlay();
            console.log('[OVERLAY] started by config change (manager now:', !!titlebarOverlayManager + ')');
        }
    }

    (async () => {
        const storeCtx = getStoreInstallContext();
        if (storeCtx.isStoreInstall) {
            // MSIX startup is managed only by set-startup/get-startup-state IPCs.
            return;
        }
        const shouldEnable = config.startup;
        try {
            const enabled = isLoginItemEnabled();
            if (shouldEnable && !enabled) {
                setLoginItemEnabled(true);
            } else if (!shouldEnable && enabled) {
                setLoginItemEnabled(false);
            }
        } catch (e) {
            console.warn('[MAIN] Config change startup sync failed:', e.message);
        }
    })();

    if (languageChanged) {
        await lang.setUserLanguage(newConfig.language);
        if (window && !window.isDestroyed() && window.webContents) window.webContents.send('language-change', lang.toObject());
        // Language change notification removed - no longer needed with unified window
    }

    // Não precisamos mais controlar floating window separadamente
    console.log('[MAIN] Config updated - unified window approach');

    if (config.runHighPriority) {
        system.setProcessSchedulingPriority(true);
    } else {
        system.setProcessSchedulingPriority(false);
    }

    const data = config.toObject();
    if (window && !window.isDestroyed() && window.webContents) window.webContents.send('config-change', data);
    // Config change notification removed - no longer needed with unified window

    // Apply cloaking if config changed
    applyCloaking();
}

// Authentication prompt is now handled through the main window
const showAuthPrompt = (msg) => {
    if (window && !window.isDestroyed() && window.webContents) {
        // Save current window state before showing auth prompt
        if (window.isVisible() && !window.isMinimized()) {
            const currentSize = window.getSize();
            const currentPosition = window.getPosition();
            authWindowSize = { width: currentSize[0], height: currentSize[1] };
            authWindowPosition = { x: currentPosition[0], y: currentPosition[1] };
            console.log('[MAIN] Saved window state for auth:', authWindowSize, authWindowPosition);
        }

        // Resize window to 160x190 and position at bottom-right corner
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const authSize = { width: 160, height: 190 };
        const authPosition = {
            x: width - authSize.width - AUTH_MARGIN,
            y: height - authSize.height
        };

        if (window) window.setResizable(false);
        if (window && window.webContents) {
            window.webContents.send('resize-window', authPosition.x, authPosition.y, authSize.width, authSize.height);
        }
        // also adjust actual bounds so renderer sees the new size immediately
        if (window) {
            window.setBounds({
                x: authPosition.x,
                y: authPosition.y,
                width: authSize.width,
                height: authSize.height
            });
            console.log('[MAIN] Bounds explicitly set for auth to:', authSize.width, 'x', authSize.height, 'at', authPosition.x, ',', authPosition.y);
        }
        console.log('[MAIN] Resized window for auth to:', authSize.width, 'x', authSize.height, 'at position:', authPosition.x, ',', authPosition.y);

        // Hide titlebar during authentication
        if (window && window.webContents) window.webContents.send('toggle-titlebar', false);
        if (!window.isVisible()) window.show();

        // Garantir foco e sempre no topo durante autenticação
        window.setAlwaysOnTop(true, 'screen-saver');
        window.focus();

        window.webContents.send(msg);
    }
}

// Function to restore window to previous state after authentication
const restoreWindowAfterAuth = () => {
    if (window && !window.isDestroyed() && authWindowSize && authWindowPosition) {
        console.log('[MAIN] Restoring window after auth to:', authWindowSize.width, 'x', authWindowSize.height, 'at position:', authWindowPosition.x, ',', authWindowPosition.y);

        // Use helper to validate, apply and persist restored bounds
        setMainWindowBounds(authWindowSize, authWindowPosition, { applyToWindow: true, save: true });
        console.log('[MAIN] Restored main window bounds after auth (via helper):', mainWindowSize, mainWindowPosition);

        // Restore titlebar and alwaysOnTop based on current UI mode
        if (window && window.webContents) {
            const shouldShowTitlebar = global.uiMode === 'main';
            window.webContents.send('toggle-titlebar', shouldShowTitlebar);
        }

        // Restore alwaysOnTop based on current UI mode
        if (window) {
            if (global.uiMode === 'main') {
                window.setAlwaysOnTop(false);
            } else if (global.uiMode === 'float') {
                window.setAlwaysOnTop(true, 'screen-saver');
            }
        }

        // Clear saved auth window state
        authWindowSize = null;
        authWindowPosition = null;
    }
}

// Function to update notification badge
const updateNotificationBadge = () => {
    const count = system.getHiddenWindowsCount();
    if (window && !window.isDestroyed() && window.webContents) {
        window.webContents.send('update-notification-badge', count);
    }
};

// Resize window to authentication dimensions without triggering a full prompt
const resizeForAuth = () => {
    if (window && !window.isDestroyed() && window.webContents) {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const authSize = { width: 160, height: 190 };
        const authPosition = {
            x: width - authSize.width - AUTH_MARGIN,
            y: height - authSize.height
        };

        if (window) window.setResizable(true);
        if (window && window.webContents) {
            window.webContents.send('resize-window', authPosition.x, authPosition.y, authSize.width, authSize.height);
        }
        // ensure the bounds are updated as well so the renderer's measurements match
        if (window) {
            window.setBounds({
                x: authPosition.x,
                y: authPosition.y,
                width: authSize.width,
                height: authSize.height
            });
            console.log('[MAIN] Bounds explicitly set for auth (force resize) to:', authSize.width, 'x', authSize.height, 'at position:', authPosition.x, ',', authPosition.y);
        }
        console.log('[MAIN] Resized window for auth to:', authSize.width, 'x', authSize.height, 'at position:', authPosition.x, ',', authPosition.y);
    }
};

// allow renderer to force an auth resize if needed
ipcMain.on('force-auth-resize', () => {
    console.log('[MAIN] Received force-auth-resize request');
    resizeForAuth();
});

// Allow renderer to temporarily pause/resume global shortcuts while recording
ipcMain.handle('pause-global-shortcuts', async () => {
    try {
        console.log('[MAIN] Pausing global shortcuts (unregisterAll)');
        globalShortcut.unregisterAll();
        return { success: true };
    } catch (err) {
        console.error('[MAIN] Error pausing global shortcuts:', err);
        return { success: false, error: String(err) };
    }
});

ipcMain.handle('resume-global-shortcuts', async () => {
    try {
        console.log('[MAIN] Resuming global shortcuts (registering hide/show keys)');
        try { globalShortcut.unregisterAll(); } catch (e) { }
        try {
            if (config && config.hideKey) globalShortcut.register(config.hideKey, () => shortcutAction('hide', 'shortcut'));
        } catch (err) {
            console.warn('[MAIN] Could not register hideKey on resume:', err && err.message ? err.message : err);
        }
        try {
            if (config && config.showKey) globalShortcut.register(config.showKey, () => shortcutAction('show', 'shortcut'));
        } catch (err) {
            console.warn('[MAIN] Could not register showKey on resume:', err && err.message ? err.message : err);
        }
        return { success: true };
    } catch (err) {
        console.error('[MAIN] Error resuming global shortcuts:', err);
        return { success: false, error: String(err) };
    }
});

ipcMain.on('request-auto-float-mode-on-blur', () => {
    console.log('[MAIN] request-auto-float-mode-on-blur received');
    scheduleAutoFloatBlur();
});

ipcMain.on('pause-auto-float', () => {
    autoFloatPaused = true;
    if (autoFloatBlurTimer) {
        clearTimeout(autoFloatBlurTimer);
        autoFloatBlurTimer = null;
    }
    console.log('[MAIN] Auto-float paused (purchase in progress)');
});

ipcMain.on('resume-auto-float', () => {
    autoFloatPaused = false;
    console.log('[MAIN] Auto-float resumed');
});

ipcMain.on('window-mousemove', () => {
    if (!autoFloatBlurTimer) return;
    if (global.window && global.window.isFocused()) {
        return;
    }
    scheduleAutoFloatBlur();
});

const MAX_REVEAL_HINT_SHOW_COUNT = 3;

function getRevealHintNotificationTitle() {
    return lang.REVEAL_HINT_NOTIFICATION_TITLE || 'Feito!';
}

function getRevealHintNotificationBody() {
    const base = lang.REVEAL_HINT_NOTIFICATION_BODY || 'Press Ctrl+F6 to restore. Disable hints in Options.';
    // As traduções citam o atalho padrão "Ctrl+F6", mas as teclas são
    // customizáveis — usa o atalho REAL de mostrar configurado pelo usuário.
    const showKey = config && config.showKey ? String(config.showKey) : 'Ctrl+F6';
    if (showKey !== 'Ctrl+F6' && base.indexOf('Ctrl+F6') !== -1) {
        return base.split('Ctrl+F6').join(showKey);
    }
    return base;
}

function getRevealHintNotificationDisableAction() {
    return lang.REVEAL_HINT_NOTIFICATION_DISABLE_HINTS || 'Disable hints';
}

let activeRevealHintNotification = null;

function getRevealHintNotificationCloseAction() {
    return lang.REVEAL_HINT_NOTIFICATION_CLOSE || 'Close';
}

function dismissRevealHintNotification() {
    if (activeRevealHintNotification) {
        try {
            activeRevealHintNotification.close();
        } catch (error) {
            console.warn('[MAIN] Failed to close active reveal hint notification:', error);
        }
        activeRevealHintNotification = null;
    }
}

function markRevealHintsLearned(source = 'shortcut') {
    if (config.revealHintDismissedForever) {
        return;
    }
    dismissRevealHintNotification();
    config.revealHintDismissedForever = true;
    updateConfig(config);
    captureOnboardingTelemetry('onboarding.reveal-hint.learned', {
        source
    });
}

function getRevealHintState() {
    const shownCount = Number(config.revealHintShownCount || 0);
    return {
        shownCount,
        dismissed: !!config.revealHintDismissedForever,
        enabled: !config.revealHintDismissedForever && shownCount < MAX_REVEAL_HINT_SHOW_COUNT
    };
}

function getRevealMethodForShowSource(source = '') {
    if (source === 'shortcut') return 'keyboard';
    if (source && source.startsWith('floating-button')) return 'hotspot';
    return 'hotspot';
}

function captureOnboardingTelemetry(eventName, details = {}) {
    const storeInstall = getStoreInstallContext().isStoreInstall;
    const payload = Object.assign({
        platform: process.platform,
        storeInstall,
        floatingButtonMode: getFloatingButtonMode(),
        onboardingState: {
            revealHintShownCount: Number(config.revealHintShownCount || 0),
            revealHintDismissedForever: !!config.revealHintDismissedForever
        }
    }, details);
    telemetry.captureTelemetryEvent(eventName, payload);
}

// Eventos de analítica enviados pelo renderer (ex.: retention.pro_modal_viewed).
ipcMain.on('track-event', (event, payload) => {
    try {
        const name = payload && payload.name ? String(payload.name) : '';
        if (!name) return;
        retention.trackRetentionEvent(name, (payload && payload.details) || {});
    } catch (error) {
        console.warn('[MAIN] track-event handler failed:', error && error.message ? error.message : error);
    }
});

function disableRevealHintsFromNotification() {
    if (config.revealHintDismissedForever) return;
    config.revealHintDismissedForever = true;
    updateConfig(config);
    captureOnboardingTelemetry('onboarding.reveal-hint.dismissed', {
        source: 'notification'
    });
}

function showRevealHintNotification() {
    try {
        if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
            console.warn('[MAIN] Reveal hint notification skipped because native notifications are not supported');
            return;
        }

        const options = {
            title: getRevealHintNotificationTitle(),
            body: getRevealHintNotificationBody(),
            silent: true
        };

        if (process.platform === 'win32') {
            options.actions = [{ type: 'button', text: getRevealHintNotificationDisableAction() }];
            options.closeButtonText = getRevealHintNotificationCloseAction();
        }

        const notification = new Notification(options);
        activeRevealHintNotification = notification;

        if (process.platform === 'win32') {
            notification.on('action', () => {
                disableRevealHintsFromNotification();
            });
        }

        notification.once('close', () => {
            if (activeRevealHintNotification === notification) {
                activeRevealHintNotification = null;
            }
        });

        notification.show();
    } catch (error) {
        console.warn('[MAIN] Unable to show reveal hint notification:', error);
    }
}

function maybeShowRevealHint(source = '') {
    const revealState = getRevealHintState();
    if (!revealState.enabled) {
        return;
    }

    if (window && window.webContents) {
        window.webContents.send('show-reveal-hint');
    }
    showRevealHintNotification();
    captureOnboardingTelemetry('onboarding.reveal-hint.shown', {
        source,
        hideMode: source
    });
}

function captureHideCompleted(source = '') {
    if (!['shortcut', 'floating-button'].includes(source)) {
        return;
    }

    // Contador de uso real do recurso central (base para oferta de review).
    if (reviewPrompt && typeof reviewPrompt.recordHideUsage === 'function') {
        reviewPrompt.recordHideUsage();
    }

    const previousCount = Number(config.revealHintShownCount || 0);
    const nextCount = previousCount + 1;
    config.revealHintShownCount = nextCount;
    captureOnboardingTelemetry('onboarding.hide.completed', {
        source,
        hideMode: source
    });

    // Primeiro uso real do recurso central (marco de ativação/retenção).
    if (previousCount === 0) {
        retention.trackRetentionEvent('retention.first_hide', {
            source,
            hideMode: source,
            storeInstall: getStoreInstallContext().isStoreInstall
        });
    }

    maybeShowRevealHint(source);
}

// ---------------------------------------------------------------------------
// Pedido de review (avaliação na Microsoft Store)
//
// Só oferta quando o usuário demonstra engajamento real (ver review-prompt.js).
// ---------------------------------------------------------------------------
function buildStoreReviewDeepLink(storeContext) {
    // Deep link oficial para avaliação: ms-windows-store://review/?PFN=<PFN>.
    // Sem PFN disponível, abre a página do produto (o usuário chega às avaliações).
    if (storeContext && storeContext.packageFamilyName) {
        return `ms-windows-store://review/?PFN=${encodeURIComponent(storeContext.packageFamilyName)}`;
    }
    return `ms-windows-store://pdp/?ProductId=${defaultStoreIapProductId}`;
}

async function openStoreReviewFallback(storeContext) {
    try {
        await shell.openExternal(buildStoreReviewDeepLink(storeContext));
        return true;
    } catch (error) {
        console.warn('[REVIEW] openStoreReviewFallback error:', error && error.message ? error.message : String(error));
        return false;
    }
}

function sendReviewPromptToRenderer() {
    try {
        if (window && !window.isDestroyed() && window.webContents) {
            window.webContents.send('show-review-prompt', { source: 'post-show' });
        }
    } catch (error) {
        console.warn('[REVIEW] sendReviewPromptToRenderer error:', error && error.message ? error.message : String(error));
    }
}

// Avalia se o usuário pode receber o pedido de review agora e, se sim, avisa o
// renderer exibir o modal.
function maybeOfferReviewPrompt(source = '') {
    try {
        const storeContext = getStoreInstallContext();
        reviewPrompt.maybeOfferReview({
            source,
            isStoreInstall: storeContext.isStoreInstall,
            sendOffer: sendReviewPromptToRenderer
        });
    } catch (error) {
        console.warn('[REVIEW] maybeOfferReviewPrompt error:', error && error.message ? error.message : String(error));
    }
}

// Agenda a oferta alguns segundos após um "show" bem-sucedido (janela visível),
// para não interromper a restauração das janelas. Ignora o modo float (janela
// pequena/flutuante) e estados em que o app não está visível.
function schedulePostShowReviewPrompt() {
    try {
        if (global.uiMode === 'float') return;
        setTimeout(() => {
            if (global.currentState !== 'show') return;
            if (global.uiMode === 'float') return;
            if (!window || window.isDestroyed()) return;
            if (!window.isVisible() || window.isMinimized()) return;
            maybeOfferReviewPrompt('post-show');
        }, 4000);
    } catch (error) {
        console.warn('[REVIEW] schedulePostShowReviewPrompt error:', error && error.message ? error.message : String(error));
    }
}

// Função para alternar entre show/hide (funcionalidade principal do app)
const toggleShowHide = (state, source = '', force = false) => {
    if (config.hideKey === config.showKey) {
        state = global.currentState === 'show' ? 'hide' : 'show';
    }
    const shouldAuth = state === 'show' && global.currentState !== 'show' && config.password && force !== true
    console.log('[MAIN] toggleShowHide - shouldAuth:', state, global.currentState, shouldAuth)

    if (state === 'hide') {
        uiModeBeforeHide = global.uiMode;
        console.log('[MAIN] Saved UI mode before hide (toggleShowHide):', uiModeBeforeHide);
    }

    if (shouldAuth) {
        console.log('[MAIN] Authentication required, showing auth prompt');
        showAuthPrompt('auth-request');
        return
    }

    const changed = state !== global.currentState;
    global.currentState = state;

    // Salvar o estado na configuração para garantir que o app inicie no mesmo modo
    // mesmo se for fechado/aberto novamente.
    config.lastState = state;

    // If "hide tray icon when hidden" is enabled, remove/recreate the tray icon
    // based on the new hide/show state.
    syncTrayVisibility();

    const notifyStateChanged = () => {
        // Guard (fix Object-has-been-destroyed, ELECTRON-M): durante o quit a
        // janela pode já ter sido destruída e `window` continua truthy.
        if (window && !window.isDestroyed() && window.webContents) {
            window.webContents.send('state-changed', global.currentState);
        }
    };

    // When switching to "show", delay applying the show-state class until we
    // have successfully restored the hidden windows. This prevents the UI from
    // briefly showing "Protegendo agora" while the state is already marked as show.
    const shouldDelayShowState = state === 'show' && changed;

    // Notify immediately unless we're waiting for windows to be restored
    if (!shouldDelayShowState) {
        notifyStateChanged();
    }

    // Ensure windows are actually hidden/shown when state changes
    if (state === 'hide') {
        system.hideWindows().then(async (hideResult) => {
            console.log('[MAIN] Hidden filtered windows (hide-state)');
            const elevated = hideResult && Array.isArray(hideResult.elevated) ? hideResult.elevated : [];
            if (elevated.length > 0) {
                console.log('[MAIN] Batch hide found', elevated.length, 'elevated window(s) to retry via helper');
                await handleElevatedBatchHide(elevated);
            }
            captureHideCompleted(source);
            updateNotificationBadge();
        }).catch(error => {
            console.error('[MAIN] Error hiding windows on hide-state:', error);
        });
    } else if (state === 'show') {
        system.showWindows().then(async (showResult) => {
            const hadHidden = showResult && typeof showResult === 'object' ? !!showResult.hadHidden : !!showResult;
            const stillHidden = showResult && Array.isArray(showResult.stillHidden) ? showResult.stillHidden : [];
            console.log('[MAIN] Restored hidden windows (show-state), hadHidden:', hadHidden, 'stillHidden:', stillHidden.length);
            updateNotificationBadge();
            notifyStateChanged();

            // Janelas elevadas não puderam ser restauradas por este processo —
            // tentamos via helper elevado (fix 1.1.2).
            if (stillHidden.length > 0) {
                await handleElevatedBatchShow(stillHidden);
            }

            if (hadHidden) {
                const revealMethod = getRevealMethodForShowSource(source);
                captureOnboardingTelemetry('onboarding.reveal.success', {
                    source,
                    revealMethod
                });
                captureOnboardingTelemetry(`onboarding.reveal.method.${revealMethod}`, {
                    source
                });
            }

            if (!hadHidden && global.uiMode === 'float') {
                if (shouldRestoreFloatModeAfterHide()) {
                    console.log('[MAIN] No hidden windows were restored; preserving float mode (was float before hide)');
                } else {
                    console.log('[MAIN] No hidden windows were restored; switching to main mode');
                    toggleUIMode('main', 'show-state-no-hidden-windows');
                }
            }
        }).catch(error => {
            console.error('[MAIN] Error showing windows on show-state:', error);
            // If we failed to show windows, keep the renderer in hide-state
            // to avoid a mismatch between UI and actual protection status.
            // Guard (fix Object-has-been-destroyed): janela pode estar destruída.
            if (window && !window.isDestroyed() && window.webContents) {
                window.webContents.send('state-changed', 'hide');
            }
        });
    }

    // Update notification badge after hiding/showing windows
    updateNotificationBadge();

    console.log(`[MAIN] Show/Hide state changed to: ${global.currentState} (changed=${changed})`);

    // Pós-sessão: após restaurar (show), avalia a oferta de review (engajado).
    if (state === 'show' && changed && global.currentState === 'show') {
        schedulePostShowReviewPrompt();
    }

    if (!changed) {
        console.log('[MAIN] toggleShowHide called but state was already', state);
    }
}

// Função para alternar entre main/float mode (UI) - agora simplificada
const toggleUIMode = (mode, source = '') => {
    console.log(`[MAIN] Toggle UI mode from ${global.uiMode} to ${mode} (source: ${source})`);

    // Guard (fix ELECTRON-D/ELECTRON-E): se a janela principal foi destruída
    // (ex.: app encerrando enquanto chega second-instance/minimize), qualquer
    // chamada a window.* lança "TypeError: Object has been destroyed".
    // isDestroyed() é seguro de chamar mesmo em janela já destruída.
    if (global.window && global.window.isDestroyed()) {
        console.warn('[MAIN] toggleUIMode: window destroyed, skipping UI toggle (source: ' + source + ')');
        global.window = null;
        return;
    }

    const forceModeAction = (
        (mode === 'main' && (source === 'floating-button-restore' || source === 'auth-success' || source.startsWith('auth') || source === 'force-float-mode')) ||
        (mode === 'float' && (source === 'auth-success' || source === 'floating-button-restore' || source.startsWith('auth') || source === 'force-float-mode'))
    );

    if (mode === global.uiMode && !forceModeAction) {
        console.log('[MAIN] UI mode already in desired state, skipping');
        return;
    }

    if (mode === global.uiMode && forceModeAction) {
        console.log('[MAIN] UI mode already in desired state, forcing mode behavior due source:', source);
    }

    // choose float margin when switching to float, otherwise auth margin
    const margin = (mode === 'float' ? FLOAT_MARGIN : AUTH_MARGIN);
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const buttonSize = { width: 36, height: 36 };
    const x = width - buttonSize.width - margin;
    const y = height - buttonSize.height - margin;

    if (mode === 'main') {
        // Mudando para modo principal
        console.log('[MAIN] Switching to main UI mode');

        // Restaura tamanho mÃ­nimo padrão para modo principal
        if (window) window.setMinimumSize(20, 20);

        // Configura para modo principal (não transparente, com titlebar, não sempre no topo)
        if (window && window.webContents) window.webContents.send('toggle-titlebar', true);
        if (window) window.setAlwaysOnTop(false);
        if (window) window.setSkipTaskbar(false);

        if (previousWindowState === 'minimized') {
            // Mostra a janela minimizada sem efeito visual
            const currentSize = window.getSize();
            if (window) window.setResizable(true);
            if (window) window.setSize(10, 10);
            if (window) window.show();
            if (window) window.minimize();
            if (window) window.setSize(currentSize[0], currentSize[1]);
            console.log('[MAIN] Showing window minimized (no visual effect)');
        } else if (previousWindowState === 'hidden') {
            // Mantém a janela oculta
            console.log('[MAIN] Keeping window hidden');
        } else {
            // Estado 'visible' ou padrão - restaura se minimizada, mostra se oculta
            console.log('[MAIN] Showing/restoring window');
            if (window && window.isMinimized()) {
                if (window) window.restore();
            } else if (window) {
                if (window) window.show();
            }

            // Restaura o tamanho e posição da janela principal
            console.log('[MAIN] Restoring main window size:', mainWindowSize);
            console.log('[MAIN] Restoring main window position:', mainWindowPosition);

            // Garantir que o redimensionamento seja feito corretamente
            if (window && window.webContents) {
                // Pequeno delay para garantir que a janela esteja pronta
                setTimeout(() => {
                    // Re-check: a janela pode ter sido fechada/destruída durante o delay.
                    if (!window || window.isDestroyed()) {
                        console.warn('[MAIN] Main-mode resize skipped - window destroyed during 50ms delay');
                        if (window) global.window = null;
                        return;
                    }
                    window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
                    // also set bounds so the native window resizes immediately
                    window.setBounds({
                        x: mainWindowPosition.x,
                        y: mainWindowPosition.y,
                        width: mainWindowSize.width,
                        height: mainWindowSize.height
                    });
                    console.log('[MAIN] Bounds explicitly set when toggling to main mode:', mainWindowSize.width, 'x', mainWindowSize.height, 'at', mainWindowPosition.x, ',', mainWindowPosition.y);
                }, 50);
            }
        }

        global.uiMode = 'main';
        refreshAutoFloatBlurTimer('toggle-to-main');

    } else if (mode === 'float') {
        // Mudando para modo floating
        console.log('[MAIN] Switching to floating UI mode');

        // Salva o tamanho e posição atuais da janela principal antes de redimensionar
        if (window && window.isVisible() && !window.isMinimized()) {
            const currentSize = window.getSize();
            const currentPosition = window.getPosition();
            // Persist size/position using helper which clamps values to the work area
            setMainWindowBounds({ width: currentSize[0], height: currentSize[1] }, { x: currentPosition[0], y: currentPosition[1] }, { applyToWindow: false, save: true });
            console.log('[MAIN] Saved main window size:', mainWindowSize);
            console.log('[MAIN] Saved main window position:', mainWindowPosition);
        }

        // Se a janela está minimizada, restaure antes de redimensionar
        if (window && window.isMinimized()) {
            console.log('[MAIN] Window is minimized, calling window.restore()');
            if (window) window.restore();
            console.log('[MAIN] Window restored, isMinimized():', window.isMinimized());
        }

        // Configura para modo floating (transparente, sem titlebar, sempre no topo)
        if (window && window.webContents) window.webContents.send('toggle-titlebar', false);

        if (window) window.show();
        if (window) window.setResizable(false);

        // Float mode uses augmented height to reach taskbar with FLOAT_MARGIN
        const floatHeight = buttonSize.height + FLOAT_MARGIN;
        const floatY = height - floatHeight;

        setTimeout(() => {
            // Re-check window freshness inside the timeout: it may have been
            // closed/destroyed while we waited (fix ELECTRON-D).
            if (!window || window.isDestroyed()) {
                console.warn('[MAIN] Floating mode setup skipped - window destroyed during 100ms delay');
                if (window) global.window = null;
                return;
            }

            // Temporariamente impede resize no modo floating
            window.setMinimumSize(buttonSize.width, floatHeight);

            // Envia evento para o renderer redimensionar e posicionar a janela
            window.webContents.send('resize-window', x, floatY, buttonSize.width, floatHeight);

            // Force resize in main process to override Windows minimum size limitation
            window.setBounds({
                x: x,
                y: floatY,
                width: buttonSize.width,
                height: floatHeight
            });
            console.log('[MAIN] Window bounds set to:', buttonSize.width, 'x', floatHeight, 'at', x, ',', floatY);

            window.setAlwaysOnTop(true, 'screen-saver');
            window.setSkipTaskbar(true);

            console.log('[MAIN] Floating mode setup completed');
        }, 100);

        global.uiMode = 'float';
        refreshAutoFloatBlurTimer('toggle-to-float');

        // Se veio de uma minimização, não precisamos rastrear o estado anterior
        if (source !== 'minimize') {
            // Rastreia o estado anterior apenas se não veio de minimização
            if (window && window.isMinimized()) {
                previousWindowState = 'minimized';
            } else if (window && window.isVisible()) {
                previousWindowState = 'visible';
            } else {
                previousWindowState = 'hidden';
            }
            console.log('[MAIN] Previous window state set to:', previousWindowState);
        } else {
            console.log('[MAIN] Skipping previous window state tracking (source = minimize)');
        }
    }
}

function handleHideWithoutFilters(source = '') {
    console.log(`[MAIN] Hide requested with no filters (source: ${source}) -> forcing main mode`);

    if (window && window.webContents) {
        window.webContents.send('shake-filters');
    }

    if (global.uiMode === 'float') {
        toggleUIMode('main', `${source}-no-filters`);
    }

    // If the window is hidden/minimized, bring it back to main mode so user can add filters.
    if (window) {
        if (window.isMinimized()) {
            window.restore();
        }
        if (!window.isVisible()) {
            window.show();
        }
        window.focus();
        return;
    }

    // Safety fallback: if window was closed/destroyed, recreate it.
    createWindow();
}

// Função principal que combina as duas funcionalidades
const shortcutAction = (state, source = '', force = false) => {
    // Se o usuário apertar Hide (F6) e não tiver filtros, não esconda.
    // Força retorno ao main-mode para permitir adicionar filtros.
    if (state === 'hide' && (!config.filters || config.filters.length === 0)) {
        handleHideWithoutFilters(source || 'shortcut');
        return;
    }

    // Verifica se a autenticação será necessária
    const shouldAuth = state === 'show' && global.currentState !== 'show' && config.password && force !== true;

    // NOTA (fix 1.1.2): Não chamar markRevealHintsLearned() aqui. Antes, usar o
    // atalho de "show" (Ctrl+F6) marcava revealHintDismissedForever=true, o que
    // desmarcava o checkbox "Mostrar dicas de revelação" sem o usuário pedir.
    // As dicas agora são dispensadas apenas por ação explícita do usuário
    // (desmarcar o checkbox ou clicar em "Desativar dicas" na notificação).

    // Primeiro, executa a funcionalidade show/hide
    toggleShowHide(state, source, force);

    // Se a autenticação foi necessária, não muda o modo UI agora
    // O modo UI será mudado após a autenticação ser bem-sucedida
    if (shouldAuth) {
        console.log('[MAIN] Authentication required, skipping UI mode change for now');
        return;
    }

    // Se estamos mudando para 'hide', também muda para float mode
    // Agora permite atalho de teclado para ativar float mode
    if (state === 'hide' && global.uiMode === 'main') {
        toggleUIMode('float', source);
    }
    // Se estamos mudando para 'show', decide se deve restaurar ao modo anterior
    // mantendo float se estava em float antes de ocultar
    else if (state === 'show' && global.uiMode === 'float' && source !== 'shortcut') {
        if (shouldRestoreFloatModeAfterHide()) {
            console.log('[MAIN] Restoring show-state to float mode because UI was float before hide');
        } else {
            console.log('[MAIN] Restoring show-state to main mode because UI was main before hide');
            toggleUIMode('main', source);
        }
        uiModeBeforeHide = null;
    } else if (state === 'show') {
        uiModeBeforeHide = null;
    }
}

const getAuthInput = () => {
    const promise = new Promise((resolve) => {
        const cleanup = () => {
            ipcMain.removeListener('auth-input-response', onAuthInput);
            ipcMain.removeListener('auth-canceled', onAuthCanceled);
        };

        const onAuthInput = (event, input) => {
            cleanup();
            resolve(input);
        };

        const onAuthCanceled = () => {
            cleanup();
            resolve(false);
        };

        ipcMain.once('auth-input-response', onAuthInput);
        ipcMain.once('auth-canceled', onAuthCanceled);
    });
    showAuthPrompt('auth-input');
    return promise;
}

ipcMain.handle('icon-failure', (event, process, src) => system.iconFailure(process, src));
ipcMain.handle('hash-pin', (event, pin) => hashPin(pin));
ipcMain.handle('get-language', () => lang.toObject());
ipcMain.handle('get-languages', () => lang.availableLanguages());
ipcMain.handle('get-processes', async (event, includeHidden = false) => {
    // By default, use config.hideSystemWindows; allow callers to override when needed
    const skipHiddenWindows = includeHidden ? false : config.hideSystemWindows;
    return system.list(true, skipHiddenWindows);
});
ipcMain.handle('kill-process', async (event, processName) => {
    try {
        console.log('[MAIN] Killing process:', processName);
        const result = await system.killProcess(processName);
        if (result && result.requiresElevation) {
            const confirmed = await askForElevation('Encerrar processo', `Processo: ${processName}`);
            if (!confirmed) {
                return { success: false, code: 'USER_CANCELLED', message: 'Operação cancelada pelo usuário.' };
            }
            return await runElevatedAction('kill-process', { processName });
        }
        return result;
    } catch (error) {
        console.error('[MAIN] Error killing process:', error);
        return { success: false, message: error.message };
    }
});
ipcMain.handle('get-config', () => config.toObject());
ipcMain.handle('get-state', () => global.currentState);

// IAP Handlers - Microsoft Store in-app purchases
ipcMain.handle('check-pro', async (event) => {
    try {
        const storeProductId = defaultStoreIapProductId;
        const isPro = await iapModule.checkOwnership(storeProductId);
        return isPro;
    } catch (error) {
        console.error('[IAP-IPC] Error checking Pro:', error);
        return enforceProCheck();
    }
});

ipcMain.handle('get-license-info', async (event) => {
    try {
        // Initialize Store context to ensure license query works properly
        if (typeof iapModule.initStoreContext === 'function') {
            try {
                await iapModule.initStoreContext();
            } catch (initErr) {
                console.warn('[IAP-IPC] Store context initialization failed in get-license-info:', initErr && initErr.message ? initErr.message : String(initErr));
            }
        }
        const licenseInfo = await iapModule.getLicenseInfo();
        config.isPro = licenseInfo.isPro;
        config.ProFeatures = licenseInfo.features || [];
        config.freeAppLimit = licenseInfo.appLimit || 2;
        return {
            ...licenseInfo,
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: !!licenseInfo.isPro })
        };
    } catch (error) {
        console.error('[IAP-IPC] Error getting license info:', error);
        const fallbackLicenseInfo = licenseManager.getLicenseInfo();
        return {
            ...fallbackLicenseInfo,
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: !!fallbackLicenseInfo?.isPro })
        };
    }
});

ipcMain.handle('request-purchase', async (event, productId) => {
    try {
        const storeContext = getStoreInstallContext();
        const storeProductId = productId || defaultStoreIapProductId;
        if (!storeProductId) {
            throw new Error('Product ID required');
        }

        // Extract the Electron window HWND so the native addon can pass it to
        // IInitializeWithWindow::Initialize(), which is required for the Windows
        // Store purchase dialog to display when using GetForUser() fallback.
        let hwndLow = 0, hwndHigh = 0;
        try {
            if (window && !window.isDestroyed()) {
                const buf = window.getNativeWindowHandle();
                hwndLow = buf.readUInt32LE(0);
                hwndHigh = buf.length >= 8 ? buf.readUInt32LE(4) : 0;
                appendIapTrace('ipc.request-purchase.hwnd', { hwndLow, hwndHigh });
            }
        } catch (hwndErr) {
            console.warn('[IAP-IPC] Failed to get window HWND:', hwndErr && hwndErr.message ? hwndErr.message : String(hwndErr));
        }

        // Pre-check: if user already owns the product, skip the purchase dialog entirely
        let preCheckLicense = null;
        try {
            // Ensure IAP module is fully initialized before checking license (same as in refreshStoreProEntitlement)
            if (typeof iapModule.waitForIapChildReady === 'function') {
                await iapModule.waitForIapChildReady(5000);
            }
            // Initialize Store context to ensure license query works properly
            if (typeof iapModule.initStoreContext === 'function') {
                try {
                    await iapModule.initStoreContext();
                } catch (initErr) {
                    console.warn('[IAP-IPC] Store context initialization failed in pre-check:', initErr && initErr.message ? initErr.message : String(initErr));
                }
            }
            preCheckLicense = await iapModule.getLicenseInfo();
            appendIapTrace('ipc.request-purchase.pre-check', {
                isPro: preCheckLicense.isPro,
                features: Array.isArray(preCheckLicense.features) ? preCheckLicense.features : []
            });
        } catch (preCheckErr) {
            console.warn('[IAP-IPC] Pre-purchase license check failed:', preCheckErr && preCheckErr.message ? preCheckErr.message : String(preCheckErr));
        }

        if (preCheckLicense && preCheckLicense.isPro) {
            console.log('[IAP-IPC] User already owns the product, skipping purchase dialog');
            appendIapTrace('ipc.request-purchase.already-owned-pre-check', { isPro: true });
            config.isPro = true;
            config.ProFeatures = preCheckLicense.features || [];
            if (window) window.webContents.send('state', { isPro: true });
            return {
                status: 'AlreadyPurchased',
                productId: storeProductId,
                source: 'pre-check-license'
            };
        }

        appendIapTrace('ipc.request-purchase.start', {
            productId: storeProductId,
            isPackaged: app.isPackaged,
            isStoreInstall: storeContext.isStoreInstall,
            windowsStore: storeContext.windowsStore,
            packageFamilyName: storeContext.packageFamilyName,
            execPath: process.execPath,
            resourcesPath: process.resourcesPath,
            cwd: process.cwd()
        });

        retention.trackRetentionEvent('retention.purchase_started', {
            productId: storeProductId,
            storeInstall: storeContext.isStoreInstall
        });

        const purchaseResult = await iapModule.requestPurchase(storeProductId, hwndLow, hwndHigh);
        console.log('[IAP-IPC] requestPurchase result:', purchaseResult);
        appendIapTrace('ipc.request-purchase.result', {
            productId: storeProductId,
            result: purchaseResult
        });

        // Post-check: if the native result says the user has a valid license despite
        // returning NotPurchased (user dismissed the dialog they don't need because
        // they already own the product), treat it as AlreadyPurchased.
        if (
            purchaseResult.appLicenseAvailable === true &&
            (purchaseResult.status === 'NotPurchased' || purchaseResult.status === 'Error')
        ) {
            console.log('[IAP-IPC] appLicenseAvailable=true but status=%s — overriding to AlreadyPurchased', purchaseResult.status);
            appendIapTrace('ipc.request-purchase.license-already-owned-override', {
                originalStatus: purchaseResult.status,
                appLicenseAvailable: purchaseResult.appLicenseAvailable,
                licensedProductIds: purchaseResult.licensedProductIds
            });
            purchaseResult.status = 'AlreadyPurchased';
        }

        // If purchase successful or already owned, re-validate license and restore window
        if (purchaseResult.status === 'Purchased' || purchaseResult.status === 'AlreadyPurchased') {
            if (purchaseResult.status === 'Purchased') {
                retention.trackRetentionEvent('retention.purchase_completed', {
                    productId: storeProductId,
                    storeInstall: storeContext.isStoreInstall
                });
            }
            const licenseInfo = await iapModule.getLicenseInfo();
            config.isPro = licenseInfo.isPro;
            config.ProFeatures = licenseInfo.features || [];
            appendIapTrace('ipc.request-purchase.license-refresh', {
                isPro: licenseInfo.isPro,
                featureCount: Array.isArray(licenseInfo.features) ? licenseInfo.features.length : 0
            });

            // Restore window to main mode so the success message is visible
            if (global.uiMode !== 'main') {
                console.log('[IAP-IPC] Purchase succeeded while in float mode, restoring main-mode');
                toggleUIMode('main', 'purchase-success');
            } else if (window && !window.isVisible()) {
                window.show();
                window.focus();
            } else if (window && !window.isFocused()) {
                window.focus();
            }

            // Notify renderer of config change
            if (window) {
                window.webContents.send('state', { isPro: config.isPro });
            }
        }

        return purchaseResult;
    } catch (error) {
        console.error('[IAP-IPC] Error requesting purchase:', error);
        retention.trackRetentionEvent('retention.purchase_failed', {
            productId: productId || defaultStoreIapProductId,
            error: error && error.message ? error.message : String(error)
        });
        appendIapTrace('ipc.request-purchase.error', {
            productId: productId || defaultStoreIapProductId,
            error: serializeError(error)
        });
        return { status: 'NetworkError', error: error.message };
    }
});

ipcMain.handle('review-now', async (event) => {
    const storeContext = getStoreInstallContext();
    try {
        if (!storeContext.isStoreInstall) {
            return { status: 'Unavailable', mechanism: 'none', extendedError: '0x0' };
        }

        // HWND da janela principal para o addon nativo (IInitializeWithWindow).
        let hwndLow = 0, hwndHigh = 0;
        try {
            if (window && !window.isDestroyed()) {
                const buf = window.getNativeWindowHandle();
                hwndLow = buf.readUInt32LE(0);
                hwndHigh = buf.length >= 8 ? buf.readUInt32LE(4) : 0;
            }
        } catch (hwndErr) {
            console.warn('[REVIEW] Failed to get window HWND:', hwndErr && hwndErr.message ? hwndErr.message : String(hwndErr));
        }

        // 1) Tenta o diálogo nativo de avaliação da Microsoft Store.
        let result;
        try {
            result = await iapModule.requestRateAndReview(hwndLow, hwndHigh);
        } catch (nativeErr) {
            result = {
                status: 'Error',
                error: nativeErr && nativeErr.message ? nativeErr.message : String(nativeErr),
                extendedError: '0x0',
                extendedErrorCode: 0
            };
        }
        console.log('[REVIEW] requestRateAndReview result:', result);

        let finalStatus = result && result.status ? result.status : 'Error';
        let mechanism = 'native';
        const failureLike = ['NetworkError', 'Error', 'Unavailable'].includes(finalStatus);

        // 2) Fallback: falha de rede/erro → abre a página de review da Store.
        if (failureLike) {
            const opened = await openStoreReviewFallback(storeContext);
            if (opened) {
                finalStatus = 'FallbackOpened';
                mechanism = 'fallback';
            }
        }

        if (finalStatus === 'Succeeded' || finalStatus === 'FallbackOpened') {
            // Review de fato pedido/aberto — não perguntar mais nesta instalação.
            reviewPrompt.markAskedEver();
            retention.trackRetentionEvent('retention.review_accepted', {
                status: finalStatus,
                mechanism,
                wasUpdated: !!(result && result.wasUpdated)
            });
        } else if (finalStatus === 'Canceled') {
            // Usuário viu (ou a Store não exibiu) e fechou — adia o próximo pedido.
            reviewPrompt.markOffered();
            retention.trackRetentionEvent('retention.review_declined', {
                status: finalStatus,
                mechanism
            });
        } else {
            // Falhou (ex.: offline) — mantém o cooldown já iniciado no pedido.
            retention.trackRetentionEvent('retention.review_failed', {
                status: finalStatus,
                mechanism,
                error: (result && result.error) || ''
            });
        }

        return {
            status: finalStatus,
            mechanism,
            extendedError: (result && result.extendedError) || '0x0'
        };
    } catch (error) {
        console.error('[REVIEW] review-now error:', error);
        return { status: 'Error', mechanism: 'none', error: error && error.message ? error.message : String(error) };
    }
});

ipcMain.on('review-decision', (event, decision) => {
    try {
        if (decision === 'never') {
            reviewPrompt.markDismissedForever();
        } else if (decision === 'later') {
            reviewPrompt.markPostponed();
        }
    } catch (error) {
        console.warn('[REVIEW] review-decision error:', error && error.message ? error.message : String(error));
    }
});

ipcMain.handle('get-iap-products', async (event) => {
    try {
        appendIapTrace('ipc.get-iap-products.start');
        const products = await iapModule.getProducts();
        appendIapTrace('ipc.get-iap-products.result', {
            count: Array.isArray(products) ? products.length : 0,
            ids: Array.isArray(products) ? products.map(p => p && p.id).filter(Boolean) : []
        });
        return products;
    } catch (error) {
        console.error('[IAP-IPC] Error getting products:', error);
        appendIapTrace('ipc.get-iap-products.error', { error: serializeError(error) });
        return [];
    }
});

ipcMain.handle('init-store-context', async () => {
    try {
        appendIapTrace('ipc.init-store-context.start');
        const initResult = await iapModule.initStoreContext();
        console.log('[IAP-IPC] initStoreContext result:', initResult);
        appendIapTrace('ipc.init-store-context.result', { result: initResult });
        return initResult;
    } catch (error) {
        console.error('[IAP-IPC] Error initializing Store context:', error);
        appendIapTrace('ipc.init-store-context.error', { error: serializeError(error) });
        return { initialized: false, error: error.message || String(error) };
    }
});

ipcMain.handle('get-iap-status', async () => {
    try {
        const storeContext = getStoreInstallContext();
        if (typeof iapModule.waitForIapChildReady === 'function') {
            await iapModule.waitForIapChildReady(5000);
        }
        const diagnostics = iapModule.getNativeModuleDiagnostics ? iapModule.getNativeModuleDiagnostics() : null;
        const available = iapModule.isNativeModuleAvailable ? iapModule.isNativeModuleAvailable() : false;
        const premiumCapabilities = getPremiumCapabilitiesSnapshot({ iapAvailable: available, storeContext });
        return {
            available,
            diagnostics,
            isStoreInstall: storeContext.isStoreInstall,
            storeContext,
            premiumCapabilities
        };
    } catch (error) {
        console.error('[IAP-IPC] Error getting IAP status:', error);
        const fallbackStoreContext = getStoreInstallContext();
        return {
            available: false,
            diagnostics: { loaded: false, path: null, error: error.message },
            isStoreInstall: false,
            storeContext: fallbackStoreContext,
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ iapAvailable: false, storeContext: fallbackStoreContext })
        };
    }
});

ipcMain.handle('generate-iap-diagnostic-report', async () => {
    try {
        const isPackaged = app.isPackaged;
        if (typeof iapModule.waitForIapChildReady === 'function') {
            await iapModule.waitForIapChildReady(5000);
        }

        const iapStatus = {
            available: iapModule.isNativeModuleAvailable ? iapModule.isNativeModuleAvailable() : false,
            diagnostics: iapModule.getNativeModuleDiagnostics ? iapModule.getNativeModuleDiagnostics() : null,
        };
        const iapTracePath = getIapTracePath();
        const iapTraceTail = readIapTraceTail();

        const reportLines = [
            'SnapAway IAP Diagnostic Report',
            `Generated: ${new Date().toISOString()}`,
            `App version: ${app.getVersion()}`,
            `Packaged: ${isPackaged}`,
            `App executable: ${process.execPath}`,
            `Resources path: ${process.resourcesPath}`,
            `Current working directory: ${process.cwd()}`,
            '',
            'IAP Status:',
            `  available: ${iapStatus.available}`,
            'IAP Diagnostics:',
            `  loaded: ${iapStatus.diagnostics?.loaded ?? 'unknown'}`,
            `  path: ${iapStatus.diagnostics?.path ?? 'unknown'}`,
            `  error: ${iapStatus.diagnostics?.error ?? 'none'}`,
            '',
            'IAP Trace File:',
            `  path: ${iapTracePath}`,
            `  linesIncluded: ${iapTraceTail.length}`,
            '',
            'IAP Trace Tail (most recent events):',
            ...(iapTraceTail.length > 0 ? iapTraceTail : ['(no trace entries)']),
            '',
            'Raw diagnostics JSON:',
            JSON.stringify(iapStatus.diagnostics, null, 2),
        ];

        const defaultFileName = `SnapAway-IAP-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        const { canceled, filePath } = await dialog.showSaveDialog(window, {
            title: 'Salvar relatório IAP',
            defaultPath: path.join(os.homedir(), defaultFileName),
            buttonLabel: 'Salvar relatório',
            filters: [{ name: 'Text Document', extensions: ['txt'] }],
        });

        if (canceled || !filePath) {
            return { canceled: true };
        }

        fs.writeFileSync(filePath, reportLines.join(os.EOL), 'utf8');
        return { success: true, path: filePath };
    } catch (error) {
        console.error('[IAP-IPC] Error generating IAP diagnostic report:', error);
        return { success: false, error: error?.message || String(error) };
    }
});

// Função para detectar se a janela está maximizada considerando fatores de zoom
function isWindowMaximized() {
    if (!window) return false;

    try {
        const windowBounds = window.getBounds();
        const workArea = screen.getPrimaryDisplay().workArea;
        const isMaximizedByElectron = window.isMaximized();

        // Margem de tolerÃ¢ncia para considerar "maximizado" (10 pixels - aumentado para ser mais permissivo)
        const tolerance = 10;

        console.log('[MAXIMIZE-DETECT] ===== VERIFICAÃ‡ÃƒO DE MAXIMIZAÃ‡ÃƒO =====');
        console.log('[MAXIMIZE-DETECT] Medidas atuais da janela:', {
            x: windowBounds.x,
            y: windowBounds.y,
            width: windowBounds.width,
            height: windowBounds.height
        });
        console.log('[MAXIMIZE-DETECT] Medidas esperadas (workArea):', {
            x: workArea.x,
            y: workArea.y,
            width: workArea.width,
            height: workArea.height
        });
        console.log('[MAXIMIZE-DETECT] TolerÃ¢ncia usada:', tolerance, 'pixels');

        // Verifica se a janela cobre praticamente toda a área de trabalho
        const diffX = Math.abs(windowBounds.x - workArea.x);
        const diffY = Math.abs(windowBounds.y - workArea.y);
        const diffRight = Math.abs((windowBounds.x + windowBounds.width) - (workArea.x + workArea.width));
        const diffBottom = Math.abs((windowBounds.y + windowBounds.height) - (workArea.y + workArea.height));

        console.log('[MAXIMIZE-DETECT] DiferenÃ§as calculadas:', {
            left: diffX,
            top: diffY,
            right: diffRight,
            bottom: diffBottom
        });

        // Verificação mais permissiva: pelo menos 3 lados devem estar alinhados
        const alignedSides = (diffX <= tolerance ? 1 : 0) +
            (diffY <= tolerance ? 1 : 0) +
            (diffRight <= tolerance ? 1 : 0) +
            (diffBottom <= tolerance ? 1 : 0);

        console.log('[MAXIMIZE-DETECT] Lados alinhados:', alignedSides, '/ 4');

        const isMaximizedBySize = alignedSides >= 3; // Pelo menos 3 lados alinhados

        console.log('[MAXIMIZE-DETECT] isMaximizedBySize:', isMaximizedBySize);
        console.log('[MAXIMIZE-DETECT] isMaximizedByElectron:', isMaximizedByElectron);

        const finalResult = isMaximizedBySize || isMaximizedByElectron;
        console.log('[MAXIMIZE-DETECT] Resultado FINAL:', finalResult);
        console.log('[MAXIMIZE-DETECT] ======================================');

        return finalResult;
    } catch (error) {
        console.warn('[MAIN] Error detecting maximized state:', error);
        return window ? window.isMaximized() : false;
    }
}

ipcMain.handle('get-current-state', () => ({
    state: global.currentState,
    maximized: isWindowMaximized()
}));
ipcMain.handle('launch-url', (event, url) => shell.openExternal(url));
ipcMain.on('update-config', (event, newConfig) => updateConfig(newConfig));
ipcMain.handle('hide-specific-window', async (event, hwnd) => {
    try {
        console.log('[MAIN] Hiding specific window with HWND:', hwnd);
        const result = await system.hideSpecificWindow(hwnd);
        if (result && result.requiresElevation) {
            // Go straight to the elevated helper — the UAC prompt is the
            // confirmation; an extra "ask admin?" dialog only slows down hiding.
            const elevatedResult = await runElevatedAction('hide-window', { hwnd });
            if (!elevatedResult || !elevatedResult.success) {
                return elevatedResult || { success: false, code: 'HELPER_FAILED', message: 'Helper elevado não conseguiu ocultar a janela.' };
            }
        }
        // Update notification badge after hiding specific window
        updateNotificationBadge();
        return result && typeof result === 'object' ? result : { success: !!result };
    } catch (error) {
        console.error('[MAIN] Error hiding specific window:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('show-specific-window', async (event, hwnd) => {
    try {
        console.log('[MAIN] Showing specific window with HWND:', hwnd);
        const result = await system.showSpecificWindow(hwnd);
        // Update notification badge after showing specific window
        updateNotificationBadge();
        return result;
    } catch (error) {
        console.error('[MAIN] Error showing specific window:', error);
        return false;
    }
});

ipcMain.handle('set-mask-char', async (event, charOrHTMLEntity) => {
    try {
        console.log('[MAIN] Setting mask character to:', charOrHTMLEntity);
        config.maskChar = charOrHTMLEntity;
        updateConfig(config);
        return true;
    } catch (error) {
        console.error('[MAIN] Error setting mask character:', error);
        return false;
    }
});

ipcMain.handle('update-notification-badge', async (event, count) => {
    try {
        console.log('[MAIN] Updating notification badge count to:', count);
        if (window && window.webContents) {
            window.webContents.send('update-notification-badge', count);
        }
        return true;
    } catch (error) {
        console.error('[MAIN] Error updating notification badge:', error);
        return false;
    }
});

// License system handlers
ipcMain.handle('get-pro-status', async () => {
    try {
        // Sync Store entitlement before composing status (Store install only)
        await refreshStoreProEntitlement('get-pro-status', 3000);

        // Security: Always re-validate before returning status
        enforceProCheck();

        const storeContext = getStoreInstallContext();
        const licenseInfo = licenseManager.getLicenseInfo();
        const isPro = config.isPro;
        const isStorePro = lastKnownStorePro;
        const isLicenseKeyPro = !!licenseInfo.isPro;
        const proSource = isStorePro ? 'store' : (isLicenseKeyPro ? 'license-key' : 'free');
        const features = isPro
            ? (config.ProFeatures || licenseManager.getProFeatures())
            : licenseInfo.features;
        const freeAppLimit = isPro ? Infinity : licenseInfo.appLimit;
        const currentCount = config.filters.length;
        const premiumCapabilities = getPremiumCapabilitiesSnapshot({ storeContext, isPro });

        return {
            isPro,
            features,
            freeAppLimit,
            canAddApp: isPro ? true : licenseManager.canAddApp(currentCount),
            remainingApps: isPro ? Infinity : licenseManager.getRemainingFreeApps(currentCount),
            isAtLimit: isPro ? false : licenseManager.isAtFreeLimit(currentCount),
            machineId: licenseInfo.machineId,
            proSource,
            isStoreInstall: storeContext.isStoreInstall,
            isStorePro,
            isLicenseKeyPro,
            premiumCapabilities
        };
    } catch (error) {
        console.error('[MAIN] Error getting Pro status:', error);
        enforceProCheck(); // Re-validate even on error
        const fallbackStoreContext = getStoreInstallContext();
        return {
            isPro: false,
            features: licenseManager.getProFeatures(),
            freeAppLimit: 2,
            canAddApp: config.filters.length < 2,
            remainingApps: Math.max(0, 2 - config.filters.length),
            isAtLimit: config.filters.length >= 2,
            machineId: licenseManager.getMachineId(),
            proSource: 'free',
            isStoreInstall: false,
            isStorePro: false,
            isLicenseKeyPro: false,
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ iapAvailable: false, storeContext: fallbackStoreContext, isPro: false })
        };
    }
});

ipcMain.handle('activate-license', async (event, licenseKey) => {
    try {
        console.log('[MAIN] Attempting to activate license');
        const result = await licenseManager.activateLicense(licenseKey);

        if (result.success) {
            config.isPro = true;
            config.ProFeatures = result.features;
            config.freeAppLimit = Infinity;
            updateConfig(config);
            console.log('[MAIN] License activated successfully');
        }

        return {
            ...result,
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: !!config.isPro })
        };
    } catch (error) {
        console.error('[MAIN] Error activating license:', error);
        return {
            success: false,
            message: 'License activation failed',
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: false })
        };
    }
});

ipcMain.handle('deactivate-license', async () => {
    try {
        console.log('[MAIN] Deactivating license');

        await refreshStoreProEntitlement('deactivate-license', 3000);
        enforceProCheck();

        const licenseInfo = licenseManager.getLicenseInfo();
        const source = lastKnownStorePro ? 'store' : (licenseInfo && licenseInfo.isPro ? 'license-key' : 'free');

        if (source === 'store') {
            return {
                success: false,
                message: 'Store-managed Pro cannot be deactivated here',
                reason: 'store-managed',
                premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: true })
            };
        }

        const result = await licenseManager.deactivateLicense();

        // Ensure the app returns to free mode immediately
        config.isPro = false;
        config.ProFeatures = licenseManager.getProFeatures();
        config.freeAppLimit = licenseManager.freeAppLimit;
        // Revoke Pro-only settings on deactivation so UI updates immediately
        if (config.runHighPriority) {
            config.runHighPriority = false;
            console.log('[MAIN] Revoking runHighPriority due to explicit deactivation');
        }
        if (config.muteWindows) {
            config.muteWindows = false;
            console.log('[MAIN] Revoking muteWindows due to explicit deactivation');
        }
        if (config.password) {
            config.password = null;
            console.log('[MAIN] Clearing password due to explicit deactivation');
        }
        if (config.hideTrayWhenHidden) {
            config.hideTrayWhenHidden = false;
            console.log('[MAIN] Revoking hideTrayWhenHidden due to explicit deactivation');
        }
        updateConfig(config);

        return {
            ...result,
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: false })
        };
    } catch (error) {
        console.error('[MAIN] Error deactivating license:', error);
        return {
            success: false,
            message: 'License deactivation failed',
            premiumCapabilities: getPremiumCapabilitiesSnapshot({ isPro: !!config.isPro })
        };
    }
});

ipcMain.handle('get-premium-capabilities', async () => {
    try {
        return getPremiumCapabilitiesSnapshot({ isPro: !!config.isPro });
    } catch (error) {
        return getPremiumCapabilitiesSnapshot({ isPro: false, error: error && error.message ? error.message : String(error) });
    }
});

ipcMain.handle('check-app-limit', async (event, currentCount) => {
    try {
        // Security: Always re-validate before checking limit
        enforceProCheck();

        return {
            canAdd: licenseManager.canAddApp(currentCount),
            limit: licenseManager.getAppLimit(),
            current: currentCount
        };
    } catch (error) {
        console.error('[MAIN] Error checking app limit:', error);
        enforceProCheck(); // Re-validate even on error
        return {
            canAdd: currentCount < 2,
            limit: 2,
            current: currentCount
        };
    }
});

ipcMain.handle('open-payment-page', async () => {
    try {
        // Use PayPal simple link with email instead of PayPal.me (PayPal.me requires business account)
        // /hub/go/snapaway → redirect do servidor para o simple PayPal link do app
        const paymentUrl = 'https://edenware.app/hub/go/snapaway';
        await shell.openExternal(paymentUrl);
        return { success: true };
    } catch (error) {
        console.error('[MAIN] Error opening payment page:', error);
        return { success: false, message: 'Failed to open payment page' };
    }
});

ipcMain.handle('is-packaged', () => {
    return app.isPackaged;
});

ipcMain.handle('get-version', () => {
    return app.getVersion();
});

// Window control handlers
ipcMain.handle('minimize-window', async () => {
    if (window) {
        window.minimize();
        return { success: true };
    }
    return { success: false, message: 'Window not available' };
});

ipcMain.handle('maximize-window', async () => {
    if (window) {
        if (window.isMaximized()) {
            window.restore();
        } else {
            window.maximize();
        }
        return { success: true };
    }
    return { success: false, message: 'Window not available' };
});

ipcMain.handle('close-window', async () => {
    if (window) {
        window.close();
        return { success: true };
    }
    return { success: false, message: 'Window not available' };
});

// Pro feature handlers
ipcMain.handle('set-password', async (event, password) => {
    try {
        if (!licenseManager.isFeatureAvailable('passwordProtection')) {
            return { success: false, message: 'Password protection requires Pro license' };
        }

        // Existing password logic
        if (password) {
            config.password = hashPin(password);
        } else {
            config.password = null;
        }
        updateConfig(config);
        return { success: true };
    } catch (error) {
        console.error('[MAIN] Error setting password:', error);
        return { success: false, message: 'Failed to set password' };
    }
});

ipcMain.handle('reset-config', async () => {
    try {
        // If password protection is enabled, require authentication before reset
        if (config.password) {
            const authSuccess = await requestAuthCheck();
            if (!authSuccess) {
                return { success: false, message: 'Authentication failed or cancelled' };
            }
            // If auth was requested via auth-check (e.g. restore/reset flows),
            // restore the window bounds and UI back from auth size.
            try {
                restoreWindowAfterAuth();
            } catch (err) {
                console.warn('[MAIN] restoreWindowAfterAuth failed after auth-check:', err);
            }
        }

        const currentState = config.toObject();
        const preservedLicense = {
            isPro: config.isPro,
            ProLicense: config.ProLicense,
            licenseExpiry: config.licenseExpiry,
            ProFeatures: config.ProFeatures,
            freeAppLimit: config.freeAppLimit,
            password: config.password
        };

        // Apply defaults first
        Object.keys(defaults).forEach(key => {
            config[key] = defaults[key];
        });

        // Keep runtime license state and limits intact
        Object.keys(preservedLicense).forEach(key => {
            if (preservedLicense[key] !== undefined) {
                config[key] = preservedLicense[key];
            }
        });

        // Re-detect language after resetting config. Reset to system/app default (do not preserve previous manual language).
        const systemLocale = (app.getSystemLocale && app.getSystemLocale()) ? app.getSystemLocale().split('-')[0] : null;
        const appLocale = (app.getLocale && app.getLocale()) ? app.getLocale().split('-')[0] : null;
        const previousLanguage = currentState.language;
        config.language = systemLocale || appLocale || defaults.language || 'en';

        console.warn('[MAIN] LANGUAGE AFTER RESET:', config.language, 'system=', systemLocale, 'app=', appLocale);

        try {
            await lang.setUserLanguage(config.language);
            if (window && window.webContents && config.language !== previousLanguage) {
                window.webContents.send('language-change', lang.toObject());
            }
        } catch (error) {
            console.warn('[MAIN] Could not set user language after reset:', error);
        }

        enforceProCheck();
        updateConfig(config);

        return { success: true };
    } catch (error) {
        console.error('[MAIN] Error resetting config:', error);
        return { success: false, message: 'Failed to reset config' };
    }
});

ipcMain.handle('mute-application-audio', async (event, processIds, mute) => {
    try {
        if (!licenseManager.isFeatureAvailable('audioControl')) {
            return { success: false, message: 'Audio control requires Pro license' };
        }

        // Existing audio logic would go here
        return { success: true };
    } catch (error) {
        console.error('[MAIN] Error muting application audio:', error);
        return { success: false, message: 'Failed to mute application audio' };
    }
});

ipcMain.handle('validate-shortcut', async (event, shortcut) => {
    try {
        const isValid = licenseManager.validateShortcutComplexity(shortcut);
        if (!isValid) {
            const message = licenseManager.isPro()
                ? 'Invalid shortcut format'
                : 'Complex shortcuts require Pro license';
            return { success: false, message };
        }
        return { success: true };
    } catch (error) {
        console.error('[MAIN] Error validating shortcut:', error);
        return { success: false, message: 'Failed to validate shortcut' };
    }
});

ipcMain.handle('set-startup', async (event, enable) => {
    try {
        const storeCtx = getStoreInstallContext();
        if (storeCtx.isStoreInstall) {
            const state = await runWinRTStartupTask(enable ? 'enable' : 'disable');
            console.log('[MAIN] WinRT StartupTask set to', enable ? 'enable' : 'disable', '→ state:', state);
            const isEnabled = state === 'Enabled' || state === 'EnabledByPolicy';
            const disabledByUser = state === 'DisabledByUser';

            if (state) {
                // PowerShell succeeded — use its result
                config.startup = isEnabled;
                await updateConfig(config);
                return { success: true, startupTaskState: state, isEnabled, disabledByUser };
            }

            // WinRT falhou (null). Para instalações MSIX/Store, o
            // app.setLoginItemSettings() do Electron é um no-op, então cair no
            // fallback abaixo fingiria sucesso sem nunca habilitar a
            // StartupTask — exatamente o bug relatado na 1.1.1. Reportamos a
            // falha para a UI mostrar um erro (fix 1.1.2).
            console.warn('[MAIN] WinRT StartupTask failed for MSIX install; no usable fallback.');
            return {
                success: false,
                message: 'Não foi possível configurar a inicialização automática neste dispositivo. Tente habilitá-la em Configurações > Aplicativos > Inicialização.'
            };
        }

        // Passo 1: Tentar com Electron API nativa (escreve em HKCU, sem elevação necessária)
        try {
            setLoginItemEnabled(enable);
            config.startup = enable;
            await updateConfig(config);
            console.log('[MAIN] Startup set via Electron API:', enable);
            return { success: true, isEnabled: enable };
        } catch (electronError) {
            console.warn('[MAIN] Electron setLoginItemSettings failed, trying helper:', electronError.message);

            // Passo 2: Tentar com helper não-elevado (também escreve em HKCU)
            try {
                const helperResult = await runHelperAction('set-autostart', getAutostartArgs(enable));
                if (helperResult && helperResult.success) {
                    config.startup = enable;
                    await updateConfig(config);
                    console.log('[MAIN] Startup set via helper (non-elevated):', enable);
                    return { success: true, isEnabled: enable, helper: true };
                }
                throw new Error(helperResult && helperResult.message ? helperResult.message : 'Helper non-elevated failed');
            } catch (helperError) {
                console.warn('[MAIN] Helper non-elevated failed, trying elevated:', helperError.message);

                // Passo 3: Pedir elevação como último recurso
                if (window && await askForElevation('Startup automático', enable ? 'Habilitar inicialização com Windows' : 'Desabilitar inicialização com Windows')) {
                    const elevatedResult = await setStartupWithElevation(enable);
                    if (elevatedResult && elevatedResult.success) {
                        config.startup = enable;
                        await updateConfig(config);
                        return { success: true, isEnabled: enable, elevated: true };
                    }
                    return { success: false, message: elevatedResult && elevatedResult.message ? elevatedResult.message : 'Falha ao configurar inicialização mesmo com elevação', code: elevatedResult && elevatedResult.code };
                }
                return { success: false, message: 'Operação cancelada pelo usuário.' };
            }
        }
    } catch (error) {
        console.error('[MAIN] Error setting startup:', error);
        return { success: false, message: error.message || 'Falha ao configurar inicialização' };
    }
});

ipcMain.handle('get-startup-state', async () => {
    try {
        const storeCtx = getStoreInstallContext();
        if (storeCtx.isStoreInstall) {
            const state = await runWinRTStartupTask('get');
            if (state) {
                const isEnabled = state === 'Enabled' || state === 'EnabledByPolicy';
                return { isStoreInstall: true, state, isEnabled };
            }
            // PowerShell failed — fallback to Electron API
            console.warn('[MAIN] WinRT StartupTask get failed, falling back to Electron API');
        }
        const isEnabled = isLoginItemEnabled();
        return { isStoreInstall: storeCtx.isStoreInstall || false, isEnabled: !!isEnabled };
    } catch (error) {
        console.error('[MAIN] Error getting startup state:', error);
        return { isStoreInstall: false, isEnabled: !!config.startup };
    }
});

ipcMain.handle('set-high-priority', async (event, enable) => {
    try {
        if (!licenseManager.isFeatureAvailable('highPriority')) {
            return { success: false, message: 'High priority mode requires Pro license' };
        }

        config.runHighPriority = enable;
        updateConfig(config);

        const result = await system.setProcessSchedulingPriority(enable);
        if (result && result.requiresElevation) {
            const confirmed = await askForElevation('Prioridade alta', 'Ajustar prioridade requer privilégios elevados para alguns alvos.');
            if (!confirmed) {
                return { success: false, code: 'USER_CANCELLED', message: 'Operação cancelada pelo usuário.' };
            }
            return await runElevatedAction('set-priority', { enable });
        }

        return result && typeof result === 'object' ? result : { success: true };
    } catch (error) {
        console.error('[MAIN] Error setting high priority:', error);
        return { success: false, message: 'Failed to set high priority' };
    }
});

ipcMain.handle('toggle-maximize', async (event) => {
    console.log('[MAIN] ===== TOGGLE-MAXIMIZE CALLED =====');
    try {
        if (!window) {
            console.error('[MAIN] Window is null!');
            return { success: false, message: 'Window not available' };
        }

        // Use both isMaximized() and isWindowMaximized() to detect maximized state
        const isMaximizedByElectron = window.isMaximized();
        const isMaximizedBySize = isWindowMaximized();
        const wasMaximized = isMaximizedByElectron || isMaximizedBySize;

        console.log('[MAIN] Current window state:');
        console.log('[MAIN]   - isMaximized() (Electron):', isMaximizedByElectron);
        console.log('[MAIN]   - isWindowMaximized() (by size):', isMaximizedBySize);
        console.log('[MAIN]   - Final decision (wasMaximized):', wasMaximized);
        console.log('[MAIN] Window bounds:', window.getBounds());

        if (wasMaximized) {
            // Set flag to prevent resize listener from interfering
            isRestoring = true;
            console.log('[MAIN] Setting isRestoring flag to true');

            // Prefer the last known normal (non-maximized) bounds instead of the
            // current maximized size held in mainWindowSize/mainWindowPosition.
            const workArea = screen.getPrimaryDisplay().workArea;
            const tolerance = 50;
            const savedSizeLooksMaximized = mainWindowSize &&
                (mainWindowSize.width >= workArea.width - tolerance ||
                    mainWindowSize.height >= workArea.height - tolerance);

            let restoreSize, restorePosition;

            const fallbackRestore = () => {
                const { width, height } = screen.getPrimaryDisplay().workAreaSize;
                return {
                    size: { width: 640, height: 550 },
                    position: { x: width - 640 - 18, y: height - 550 }
                };
            };

            const preferredNormalBounds = lastNormalWindowBounds || {
                size: mainWindowSize || { width: 640, height: 550 },
                position: mainWindowPosition || { x: 100, y: 100 }
            };

            if (savedSizeLooksMaximized && lastNormalWindowBounds) {
                console.log('[MAIN] Saved main bounds look maximized; restoring to last known normal bounds');
                restoreSize = lastNormalWindowBounds.size;
                restorePosition = lastNormalWindowBounds.position;
            } else if (savedSizeLooksMaximized) {
                console.log('[MAIN] Saved size appears to be maximized, using defaults');
                const fallback = fallbackRestore();
                restoreSize = fallback.size;
                restorePosition = fallback.position;
            } else if (lastNormalWindowBounds) {
                console.log('[MAIN] Restoring to last normal bounds captured before maximize');
                restoreSize = lastNormalWindowBounds.size;
                restorePosition = lastNormalWindowBounds.position;
            } else {
                // Use saved size or defaults
                restoreSize = preferredNormalBounds.size;
                const { width, height } = screen.getPrimaryDisplay().workAreaSize;
                restorePosition = preferredNormalBounds.position || { x: width - 640 - 18, y: height - 550 };
            }

            console.log('[MAIN] Restoring window from maximized state');
            console.log('[MAIN] Restore size:', restoreSize);
            console.log('[MAIN] Restore position:', restorePosition);
            console.log('[MAIN] mainWindowSize (may be maximized):', mainWindowSize);
            console.log('[MAIN] mainWindowPosition:', mainWindowPosition);

            // Send the unmaximize event immediately to update the button without delay
            console.log('[MAIN] Sending window-maximized-changed event immediately (false)');
            if (window && window.webContents) {
                window.webContents.send('window-maximized-changed', false);
                lastMaximizedState = false;
            }

            // If window.isMaximized() is true, call restore(), otherwise just set size directly
            if (isMaximizedByElectron) {
                console.log('[MAIN] Window is maximized by Electron, calling window.restore()...');
                window.restore();
            } else {
                console.log('[MAIN] Window is at maximized size but not maximized by Electron, setting size directly...');
            }

            // Always set size and position directly (restore() might not work if not technically maximized)
            setTimeout(() => {
                console.log('[MAIN] Setting window size and position directly...');
                window.setSize(restoreSize.width, restoreSize.height);
                window.setPosition(restorePosition.x, restorePosition.y);

                // Update saved main window bounds using helper (will also persist to config)
                setMainWindowBounds(restoreSize, restorePosition, { applyToWindow: false, save: true });

                // Verify it worked
                setTimeout(() => {
                    const finalSize = window.getSize();
                    const finalPos = window.getPosition();
                    const finalMaximizedByElectron = window.isMaximized();
                    const finalMaximizedBySize = isWindowMaximized();
                    const finalMaximized = finalMaximizedByElectron || finalMaximizedBySize;

                    console.log('[MAIN] Final window state:');
                    console.log('[MAIN]   - Size:', finalSize);
                    console.log('[MAIN]   - Position:', finalPos);
                    console.log('[MAIN]   - isMaximized() (Electron):', finalMaximizedByElectron);
                    console.log('[MAIN]   - isWindowMaximized() (by size):', finalMaximizedBySize);
                    console.log('[MAIN]   - Final decision (maximized):', finalMaximized);

                    if (finalMaximized) {
                        console.warn('[MAIN] Window is still at maximized size after restore!');
                        console.warn('[MAIN] Trying again with different size...');
                        // Try with a slightly different size to force the change
                        window.setSize(restoreSize.width - 1, restoreSize.height - 1);
                        setTimeout(() => {
                            window.setSize(restoreSize.width, restoreSize.height);
                            isRestoring = false;
                            console.log('[MAIN] Restore flag cleared after retry');
                        }, 100);
                    } else {
                        // Clear the flag after a delay to allow resize events to work normally
                        setTimeout(() => {
                            isRestoring = false;
                            console.log('[MAIN] Restore flag cleared');
                        }, 200);
                    }
                }, 50);

                console.log('[MAIN] Window restored to size:', restoreSize, 'at position:', restorePosition);
            }, 100);

            console.log('[MAIN] Window restore initiated');
        } else {
            // Before maximizing, save the current size and position to a dedicated
            // "normal bounds" snapshot. This avoids reusing the maximized geometry
            // when the user restores the window afterwards.
            const currentSize = window.getSize();
            const currentPosition = window.getPosition();

            const workArea = screen.getPrimaryDisplay().workArea;
            const tolerance = 50;
            const isMaximizedSize = currentSize[0] >= workArea.width - tolerance ||
                currentSize[1] >= workArea.height - tolerance;

            if (!isMaximizedSize) {
                lastNormalWindowBounds = {
                    size: { width: currentSize[0], height: currentSize[1] },
                    position: { x: currentPosition[0], y: currentPosition[1] }
                };

                // Persist current bounds via helper to ensure validation and consistent saving
                setMainWindowBounds({ width: currentSize[0], height: currentSize[1] }, { x: currentPosition[0], y: currentPosition[1] }, { applyToWindow: false, save: true });
                console.log('[MAIN] Saved window size before maximizing (via helper):', mainWindowSize);
                console.log('[MAIN] Saved window position before maximizing (via helper):', mainWindowPosition);
                console.log('[MAIN] Saved last normal window bounds before maximize:', lastNormalWindowBounds);
            } else {
                console.log('[MAIN] Window already at maximized size, not saving');
            }

            console.log('[MAIN] Maximizing window...');
            // Send the maximize event immediately to update the button without delay
            // The actual maximize event will fire later, but we update the UI immediately
            if (window && window.webContents) {
                window.webContents.send('window-maximized-changed', true);
                lastMaximizedState = true;
            }
            window.maximize();
            console.log('[MAIN] Window maximized');
        }

        console.log('[MAIN] ===== TOGGLE-MAXIMIZE COMPLETED =====');
        return { success: true };
    } catch (error) {
        console.error('[MAIN] Error toggling maximize:', error);
        console.error('[MAIN] Error stack:', error.stack);
        isRestoring = false; // Clear flag on error
        return { success: false, message: error.message };
    }
});

// IPC handler to select image file for cloaking
ipcMain.handle('select-cloak-icon', async (event) => {
    try {
        // Check if user has Pro license for cloaking feature
        const licenseManager = requireLicense();
        const effectivePro = config.isPro || licenseManager.isPro();
        if (!effectivePro) {
            return { success: false, error: 'Pro license required for cloaking features' };
        }

        const result = await dialog.showOpenDialog(window, {
            title: 'Select Icon Image',
            filters: [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        return { success: true, filePath: result.filePaths[0] };
    } catch (error) {
        console.error('[MAIN] Error selecting icon:', error);
        return { success: false, error: error.message };
    }
});

// IPC handler to set cloak icon
ipcMain.handle('set-cloak-icon', async (event, sourceImagePath) => {
    try {
        // Check if user has Pro license for cloaking feature
        const licenseManager = requireLicense();
        const effectivePro = config.isPro || licenseManager.isPro();
        if (!effectivePro) {
            return { success: false, error: 'Pro license required for cloaking features' };
        }

        // Validate input
        if (!sourceImagePath || typeof sourceImagePath !== 'string') {
            return { success: false, error: 'Invalid source image path' };
        }

        // Check if source file exists
        if (!fs.existsSync(sourceImagePath)) {
            return { success: false, error: 'Source image file does not exist' };
        }

        // Validate config.paths
        if (!config.paths || !config.paths.data) {
            return { success: false, error: 'Config paths.data not available' };
        }

        // Validate image
        const isValid = await iconProcessor.validateImage(sourceImagePath);
        if (!isValid) {
            return { success: false, error: 'Invalid image file' };
        }

        // Process icon
        let processedIcons;
        try {
            processedIcons = await iconProcessor.processCloakIcon(
                sourceImagePath,
                config.paths.data
            );
        } catch (error) {
            console.error('[MAIN] Error processing icon:', error);
            return { success: false, error: `Failed to process icon: ${error.message}` };
        }

        // Validate processed icons
        if (!processedIcons || !processedIcons.primary) {
            return { success: false, error: 'Failed to create processed icons' };
        }

        // Verify primary icon exists
        if (!fs.existsSync(processedIcons.primary)) {
            return { success: false, error: 'Processed icon file was not created' };
        }

        // Save relative path in config
        let relativePath;
        try {
            relativePath = path.relative(config.paths.data, processedIcons.primary);
            // Normalize path separators for cross-platform compatibility
            relativePath = relativePath.replace(/\\/g, '/');
        } catch (error) {
            console.error('[MAIN] Error calculating relative path:', error);
            return { success: false, error: 'Failed to calculate relative path' };
        }

        config.cloakIconPath = relativePath;
        // Ensure config is flushed to disk immediately (Proxy should save, but be explicit)
        try {
            if (config && typeof config.instance !== 'undefined' && typeof config.toObject === 'function') {
                config.instance.saveData(config.toObject());
                console.log('[MAIN] Config saved explicitly after setting cloakIconPath');
                // Notify renderer of updated config so UI state stays in sync
                try {
                    if (window && window.webContents) {
                        window.webContents.send('config-change', config.toObject());
                        console.log('[MAIN] Sent config-change to renderer after setting cloakIconPath');
                    }
                } catch (notifyErr) {
                    console.warn('[MAIN] Failed to send config-change after setting cloakIconPath:', notifyErr && notifyErr.message ? notifyErr.message : notifyErr);
                }
            }
        } catch (saveErr) {
            console.warn('[MAIN] Explicit config save failed:', saveErr && saveErr.message ? saveErr.message : saveErr);
        }

        // Apply cloaking immediately (this will update both icon and title)
        try {
            applyCloaking();
        } catch (error) {
            console.error('[MAIN] Error applying cloaking after icon set:', error);
            // Don't fail the operation if cloaking application fails
        }

        // Also ensure title is updated if cloaking is enabled
        if (config.cloakEnabled && config.cloakName) {
            try {
                if (window && window.webContents) {
                    window.webContents.send('update-cloak-title', config.cloakName);
                }
            } catch (error) {
                console.error('[MAIN] Error sending update-cloak-title after icon set:', error);
            }
        }

        // Return paths for preview - use titlebar version for preview
        const previewPath = (processedIcons.titlebar && fs.existsSync(processedIcons.titlebar))
            ? processedIcons.titlebar
            : processedIcons.primary;

        console.log('[MAIN] Icon processing complete - previewPath:', previewPath, 'iconPath:', processedIcons.primary);

        // Force update of titlebar icon immediately after processing
        // Add small delay to ensure listener is registered
        try {
            if (window && window.webContents && previewPath) {
                console.log('[MAIN] Force sending update-cloak-icon after processing:', previewPath);
                setTimeout(() => {
                    if (window && window.webContents) {
                        window.webContents.send('update-cloak-icon', previewPath);
                        console.log('[MAIN] update-cloak-icon event sent');
                    }
                }, 100);
            }
        } catch (error) {
            console.error('[MAIN] Error force sending update-cloak-icon:', error);
        }

        return {
            success: true,
            iconPath: processedIcons.primary,
            previewPath: previewPath,
            relativePath: relativePath
        };
    } catch (error) {
        console.error('[MAIN] Error setting cloak icon:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
});

// IPC handler to apply cloaking
ipcMain.handle('apply-cloaking', async (event) => {
    applyCloaking();
    return { success: true };
});

// IPC handler to clear cloak icon
ipcMain.handle('clear-cloak-icon', async (event) => {
    // Check if user has Pro license for cloaking feature
    const licenseManager = requireLicense();
    const effectivePro = config.isPro || licenseManager.isPro();
    if (!effectivePro) {
        return { success: false, error: 'Pro license required for cloaking features' };
    }

    config.cloakEnabled = false;
    config.cloakName = '';
    config.cloakIconPath = null;
    applyCloaking();
    try {
        if (config && typeof config.instance !== 'undefined' && typeof config.toObject === 'function') {
            config.instance.saveData(config.toObject());
            console.log('[MAIN] Config saved explicitly after clear-cloak-icon request');
            // Notify renderer of updated config so UI state stays in sync
            try {
                if (window && window.webContents) {
                    window.webContents.send('config-change', config.toObject());
                    console.log('[MAIN] Sent config-change to renderer after clear-cloak-icon request');
                }
            } catch (notifyErr) {
                console.warn('[MAIN] Failed to send config-change after clear-cloak-icon:', notifyErr && notifyErr.message ? notifyErr.message : notifyErr);
            }
        }
    } catch (saveErr) {
        console.warn('[MAIN] Explicit config save failed (clear-cloak-icon handler):', saveErr && saveErr.message ? saveErr.message : saveErr);
    }
    return { success: true };
});

// Security: Periodic license validation (every 5 minutes)
let licenseValidationInterval = null;

function startPeriodicLicenseValidation() {
    // Clear existing interval if any
    if (licenseValidationInterval) {
        clearInterval(licenseValidationInterval);
    }

    // Validate license every 5 minutes
    licenseValidationInterval = setInterval(async () => {
        try {
            await refreshStoreProEntitlement('periodic-license-validation', 3000);
            enforceProCheck();

            // Silent online verification if possible
            const license = licenseManager.loadLicense();
            if (license && licenseManager.enableOnlineVerification) {
                licenseManager.isProWithOnlineCheck().catch((error) => {
                    // Silent fail - don't disrupt user experience
                    console.warn('[MAIN] Periodic online verification failed:', error.message);
                });
            }
        } catch (error) {
            console.error('[MAIN] Error in periodic license validation:', error);
        }
    }, 5 * 60 * 1000); // 5 minutes

    console.log('[MAIN] Periodic license validation started (every 5 minutes)');
}

console.log('[MAIN] before app.whenReady() registration');
app.on('ready', () => {
    console.log('[MAIN] app ready event fired');
});

app.whenReady().then(async () => {
    console.log('[MAIN] app.whenReady callback entered');
    detectAndSetLanguage();
    if (process.platform === 'win32') {
        try {
            // Must match the AppUserModelId registered by the installer
            // (electron-builder appId: Edenware.app.Snapcover), otherwise
            // Windows shows the raw AUMID as the notification title instead
            // of the app display name ("SnapAway").
            app.setAppUserModelId('Edenware.app.Snapcover');
            console.log('[MAIN] setAppUserModelId: Edenware.app.Snapcover');
        } catch (error) {
            console.warn('[MAIN] Failed to set AppUserModelId:', error);
        }
    }

    try {
        setupTitlebar();
    } catch (error) {
        console.warn('[MAIN] Failed to initialize custom titlebar:', error && error.stack ? error.stack : error);
    }

    // Create the main window immediately so UI can start loading.
    createWindow();
    startTitlebarOverlay();

    // Analítica de retenção: launch, primeiro launch e marcadores de retorno.
    try {
        retention.trackRetentionEvent('retention.launch', {
            storeInstall: getStoreInstallContext().isStoreInstall,
            appVersion: app.getVersion ? app.getVersion() : 'unknown'
        });
        retention.markFirstLaunchIfNeeded(config);
        retention.trackReturnOnLaunch(config);
    } catch (error) {
        console.warn('[MAIN] Retention tracking failed:', error && error.message ? error.message : error);
    }

    // Initialize license and startup tasks in the background so they do not block initial UI.
    (async () => {
        try {
            await initializeLicense();
        } catch (error) {
            console.warn('[MAIN] Background license initialization failed:', error && error.message ? error.message : error);
        }

        try {
            await refreshStoreProEntitlement('startup', 10000);
        } catch (error) {
            console.warn('[MAIN] Background Store entitlement refresh failed:', error && error.message ? error.message : error);
        }

        try {
            startPeriodicLicenseValidation();
        } catch (error) {
            console.warn('[MAIN] Failed to start periodic license validation:', error && error.message ? error.message : error);
        }

        try {
            await syncStartupPreferenceOnBoot();
        } catch (error) {
            console.warn('[MAIN] Background startup preference sync failed:', error && error.message ? error.message : error);
        }
    })();

    // Register custom protocol for serving process icons
    protocol.registerFileProtocol('icon', (request, callback) => {
        let url = request.url.replace('icon://', '');

        // Remove query/hash (e.g. ?retry=...) so the filesystem path stays valid.
        const queryIndex = url.indexOf('?');
        if (queryIndex !== -1) {
            url = url.slice(0, queryIndex);
        }
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
            url = url.slice(0, hashIndex);
        }

        try {
            // Decode URI component to handle escaped Windows paths.
            let decodedPath = decodeURIComponent(url);

            // icon:///C:/... can decode with a leading slash before drive letter.
            if (/^\/[A-Za-z]:[\\/]/.test(decodedPath)) {
                decodedPath = decodedPath.slice(1);
            }

            if (fs.existsSync(decodedPath)) {
                callback({ path: decodedPath });
                return;
            }

            // Fallback prevents renderer spam when an extracted temp icon was removed.
            const fallbackCandidates = [
                path.join(__dirname, '..', 'renderer', 'assets', 'images', 'default-icon.png'),
                path.join(__dirname, '..', '..', 'src', 'renderer', 'assets', 'images', 'default-icon.png'),
                path.join(process.cwd(), 'src', 'renderer', 'assets', 'images', 'default-icon.png')
            ];

            const fallbackPath = fallbackCandidates.find((candidate) => {
                try {
                    return fs.existsSync(candidate);
                } catch (_) {
                    return false;
                }
            });

            if (fallbackPath) {
                callback({ path: fallbackPath });
                return;
            }

            callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND
        } catch (error) {
            console.error('[ICON-PROTOCOL] Error serving icon:', error);
            callback({ error: -2 }); // net::ERR_FAILED
        }
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(permission != 'geolocation');
    });

    try {
        globalShortcut.register(config.hideKey, () => shortcutAction('hide', 'shortcut'));
        globalShortcut.register(config.showKey, () => shortcutAction('show', 'shortcut'));
    } catch (error) {
        console.error(error);
    }
    // config.language is always set by detectAndSetLanguage(); apply it to the lang module.
    await lang.setUserLanguage(config.language);

    const isLoginItemLaunch = app.getLoginItemSettings ? app.getLoginItemSettings({ path: process.execPath }).wasOpenedAtLogin : false;
    const isAutoStartLaunch = process.argv.includes('--autostart') || isLoginItemLaunch;

    const shouldRunIapDevTest = process.env.IAP_DEV_TEST === '1' || process.argv.includes('--iap-test');
    if (shouldRunIapDevTest) {
        await runIapDevStartupTest();
        return;
    }

    createWindow();

    // Autostart behavior: if launched via startup and there are filters, switch to float mode.
    if (isAutoStartLaunch && config?.filters?.length > 0) {
        console.log('[MAIN] Autostart with filters detected, switching to float mode');
        if (global.uiMode !== 'float') {
            toggleUIMode('float', 'autostart');
        }
    }

    ipcMain.on('auth-canceled', () => {
        console.log('[MAIN] Authentication canceled, restoring window to correct UI mode');

        // Clear saved auth window state first
        authWindowSize = null;
        authWindowPosition = null;

        // Restore window based on current UI mode
        if (global.uiMode === 'main') {
            // Restore to main mode size and position
            console.log('[MAIN] Restoring to main mode size:', mainWindowSize);
            console.log('[MAIN] Restoring to main mode position:', mainWindowPosition);

            if (window && window.webContents) {
                window.webContents.send('toggle-titlebar', true);
                window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
            }

            if (window) {
                window.setBounds({
                    x: mainWindowPosition.x,
                    y: mainWindowPosition.y,
                    width: mainWindowSize.width,
                    height: mainWindowSize.height
                });
                window.setAlwaysOnTop(false);
                window.setSkipTaskbar(false);
            }
        } else if (global.uiMode === 'float') {
            // Restore to floating mode size and position
            const margin = FLOAT_MARGIN, { width, height } = screen.getPrimaryDisplay().workAreaSize;
            const buttonSize = { width: 36, height: 36 };
            const x = width - buttonSize.width - margin;
            const y = height - buttonSize.height - margin;

            console.log('[MAIN] Restoring to floating mode size:', buttonSize);
            console.log('[MAIN] Restoring to floating mode position:', { x, y });

            if (window && window.webContents) {
                window.webContents.send('toggle-titlebar', false);
                window.webContents.send('resize-window', x, y, buttonSize.width, buttonSize.height);
            }

            // Force resize in main process to override Windows minimum size limitation
            if (window) {
                window.setBounds({
                    x: x,
                    y: y,
                    width: buttonSize.width,
                    height: buttonSize.height
                });
                console.log('[MAIN] Window bounds set to:', buttonSize.width, 'x', buttonSize.height, 'at', x, ',', y);
            }

            if (window) {
                window.setAlwaysOnTop(true, 'screen-saver');
                window.setSkipTaskbar(true);
            }
        }

        // Notify renderer that auth was canceled
        if (window && window.webContents) window.webContents.send('auth-canceled');

        // Mantém o estado atual (hide-state) e modo UI (float)
        console.log('[MAIN] Auth canceled - maintaining current hide-state and float mode');
    });

    ipcMain.on('force-float-mode', () => {
        console.log('[MAIN] force-float-mode requested from renderer');
        toggleUIMode('float', 'force-float-mode');
    });
    ipcMain.on('auth-result-response', (event, result) => {
        if (result === true) {
            // Autenticação bem-sucedida
            console.log('[MAIN] XXXXXX Authentication successful, restoring window', previousWindowState);

            // Ativa o show-state primeiro
            toggleShowHide('show', 'auth-success', true);

            // Restaura o estado anterior da janela baseado no previousWindowState
            if (previousWindowState === 'minimized') {
                console.log('[MAIN] Previous state was minimized, restoring to main mode and minimizing');
                toggleUIMode('main', 'auth-success');

                // Restore to main window size and position first
                console.log('[MAIN] Restoring to main window size after auth (minimized):', mainWindowSize);
                console.log('[MAIN] Restoring to main window position after auth (minimized):', mainWindowPosition);

                // Small delay to ensure UI mode change is complete
                setTimeout(() => {
                    if (window.webContents) {
                        window.webContents.send('toggle-titlebar', true);
                        window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
                    }
                    // also adjust bounds immediately so the renderer sees the new size
                    if (window) {
                        if (window.webContents) {
                            window.webContents.send('toggle-titlebar', true);
                            window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
                        }

                        window.setBounds({
                            x: mainWindowPosition.x,
                            y: mainWindowPosition.y,
                            width: mainWindowSize.width,
                            height: mainWindowSize.height
                        });
                        console.log('[MAIN] Bounds explicitly restored after auth (minimized) to:', mainWindowSize.width, 'x', mainWindowSize.height, 'at', mainWindowPosition.x, ',', mainWindowPosition.y);
                    }

                    if (window) {
                        window.setAlwaysOnTop(false);
                        window.setSkipTaskbar(false);
                        window.minimize();
                    }

                    // Clear saved auth window state
                    authWindowSize = null;
                    authWindowPosition = null;
                    uiModeBeforeHide = null;
                }, 300);
            } else if (previousWindowState === 'hidden') {
                console.log('[MAIN] Previous state was hidden, user authenticated; switching to show-state as expected');

                if (shouldRestoreFloatModeAfterHide()) {
                    console.log('[MAIN] Restoring auth-success to float mode (UI was float before hide)');
                    toggleUIMode('float', 'auth-success');
                } else {
                    console.log('[MAIN] Restoring auth-success to main mode (UI was main before hide)');
                    toggleUIMode('main', 'auth-success');
                }

                // Limpa estado de auth capturado
                authWindowSize = null;
                authWindowPosition = null;
                uiModeBeforeHide = null;
            } else {
                // Estado 'visible' ou padrão - decide modo com base no modo salvo antes do hide
                const restoreToFloat = shouldRestoreFloatModeAfterHide();

                if (restoreToFloat) {
                    console.log('[MAIN] Previous state was visible, restoring to float mode');
                    toggleUIMode('float', 'auth-success');
                } else {
                    console.log('[MAIN] Previous state was visible, going to main mode');
                    toggleUIMode('main', 'auth-success');
                }

                if (!restoreToFloat) {
                    // Restore main geometry only when the target mode is main.
                    console.log('[MAIN] Restoring to main window size after auth:', mainWindowSize);
                    console.log('[MAIN] Restoring to main window position after auth:', mainWindowPosition);

                    // Small delay to ensure UI mode change is complete
                    setTimeout(() => {
                        if (window && window.webContents) {
                            window.webContents.send('toggle-titlebar', true);
                            window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
                        }
                        // also update bounds so the actual window resizes promptly
                        if (window) {
                            window.setBounds({
                                x: mainWindowPosition.x,
                                y: mainWindowPosition.y,
                                width: mainWindowSize.width,
                                height: mainWindowSize.height
                            });
                            console.log('[MAIN] Bounds explicitly restored after auth to:', mainWindowSize.width, 'x', mainWindowSize.height, 'at', mainWindowPosition.x, ',', mainWindowPosition.y);
                        }

                        if (window) {
                            window.setAlwaysOnTop(false);
                            window.setSkipTaskbar(false);
                        }

                        // Clear saved auth window state
                        authWindowSize = null;
                        authWindowPosition = null;
                        uiModeBeforeHide = null;
                    }, 100);
                } else {
                    // Clear saved auth window state without forcing main geometry.
                    authWindowSize = null;
                    authWindowPosition = null;
                    uiModeBeforeHide = null;
                }
            }
        } else {
            // Autenticação falhou, restaurar janela de autenticação
            console.log('[MAIN] Authentication failed, restoring auth window');
            restoreWindowAfterAuth();
        }
    });
    ipcMain.on('floating-button-clicked', () => {
        console.log('[MAIN] Floating button clicked - current state:', global.currentState);

        if (global.currentState === 'hide') {
            // Estamos no hide-state, queremos ir para show-state
            console.log('[MAIN] Currently in hide-state, attempting to show');

            if (config.password) {
                // Tem senha definida - vai para auth-mode
                console.log('[MAIN] Password is set, showing auth prompt');
                showAuthPrompt('auth-request');
                // Não muda o modo UI agora, será feito apÃ³s autenticação
            } else {
                // Não tem senha - vai direto para show-state
                console.log('[MAIN] No password set, going directly to show-state');

                // Primeiro, ativa o show-state
                toggleShowHide('show', 'floating-button', true);

                // Depois, decide o modo de UI com base no estado anterior
                if (previousWindowState === 'minimized') {
                    console.log('[MAIN] Previous state was minimized, restoring to main mode');
                    toggleUIMode('main', 'floating-button');
                } else if (previousWindowState === 'hidden' || previousWindowState === 'visible') {
                    console.log('[MAIN] Previous state was hidden/visible, restoring to float mode');
                    toggleUIMode('float', 'floating-button');
                } else {
                    // fallback
                    console.log('[MAIN] Previous state unsupported, defaulting to main mode');
                    toggleUIMode('main', 'floating-button');
                }
            }
        } else {
            // Estamos no show-state, queremos ir para hide-state
            console.log('[MAIN] Currently in show-state, going to hide-state');

            // If no filters are configured, do not hide; force main-mode/open window.
            if (!config.filters || config.filters.length === 0) {
                handleHideWithoutFilters('floating-button');
                return;
            }

            // Salva o estado atual da janela antes de esconder
            if (window && window.isVisible()) {
                if (window.isMinimized()) {
                    previousWindowState = 'minimized';
                } else {
                    previousWindowState = 'visible';
                }
                console.log('[MAIN] Saved current window state as:', previousWindowState);

                // Notifica o renderer sobre a mudanÃ§a de estado
                if (window && window.webContents) window.webContents.send('previous-window-state-changed', previousWindowState);
            }

            // Ativa o hide-state
            toggleShowHide('hide', 'floating-button', true);

            // Muda para float mode se estiver no modo main
            if (global.uiMode === 'main') {
                console.log('[MAIN] Switching to float mode after hiding');
                toggleUIMode('float', 'floating-button');
            } else {
                console.log('[MAIN] Already in float mode, staying in float mode after hiding');
            }
        }
    });

    ipcMain.on('floating-button-restore', () => {
        console.log('[MAIN] Floating button restore requested (double click or right click)');
        console.log('[MAIN] Current state:', global.currentState);

        // Check if we're in hide-state and need authentication
        if (global.currentState === 'hide') {
            if (config.password) {
                // Password is set - show auth prompt first
                console.log('[MAIN] In hide-state with password, showing auth prompt');
                showAuthPrompt('auth-request');
            } else {
                // No password - go directly to show-state.
                // Choose UI mode based on previousWindowState so we restore
                // to float-mode when the windows were previously hidden.
                console.log('[MAIN] In hide-state without password, going to show-state (restore)');
                toggleShowHide('show', 'floating-button-restore', true);

                if (previousWindowState === 'minimized') {
                    console.log('[MAIN] Previous state was minimized, restoring to main mode');
                    toggleUIMode('main', 'floating-button-restore');
                } else {
                    if (shouldRestoreFloatModeAfterHide()) {
                        console.log('[MAIN] Restoring to float mode (UI was float before hide)');
                        toggleUIMode('float', 'floating-button-restore');
                    } else {
                        console.log('[MAIN] Restoring to main mode (UI was main before hide)');
                        toggleUIMode('main', 'floating-button-restore');
                    }
                }
                uiModeBeforeHide = null;
            }
        } else {
            // Already in show-state - just switch to main mode
            console.log('[MAIN] Already in show-state, switching to main mode');
            toggleUIMode('main', 'floating-button-restore');
        }
    });

    ipcMain.on('floating-button-right-click', () => {
        console.log('[MAIN] Floating button right click - switching to main mode');
        // Force switch to main mode regardless of current state
        if (global.uiMode !== 'main') {
            toggleUIMode('main', 'floating-button-right-click');
        } else {
            // If already in main mode but window is small, force resize to main window size
            console.log('[MAIN] Already in main mode, forcing window resize to main size');
            if (window && window.webContents) {
                window.webContents.send('toggle-titlebar', true);

                // Check if current window is small and mainWindowSize is also small
                const currentSize = window.getSize();
                if (currentSize[0] < 300 || currentSize[1] < 300 || mainWindowSize.width < 300 || mainWindowSize.height < 300) {
                    // Use default main window size
                    const defaultSize = { width: 640, height: 550 };
                    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
                    const defaultPosition = { x: width - defaultSize.width - 18, y: height - defaultSize.height };
                    console.log('[MAIN] Window too small, using default main window size:', defaultSize);
                    window.webContents.send('resize-window', defaultPosition.x, defaultPosition.y, defaultSize.width, defaultSize.height);

                    // Update mainWindowSize to default
                    // Use helper to update main window bounds to default
                    setMainWindowBounds(defaultSize, defaultPosition, { applyToWindow: false, save: true });
                } else {
                    // Use saved main window size
                    window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
                }
            }
            if (window) {
                window.setAlwaysOnTop(false);
                window.setSkipTaskbar(false);
            }
        }
    });

    ipcMain.on('floating-button-settings', () => {
        console.log('[MAIN] Floating button settings icon clicked - switching to main mode');
        // Force switch to main mode regardless of current state
        if (global.uiMode !== 'main') {
            toggleUIMode('main', 'floating-button-settings');
        } else {
            // If already in main mode but window is small, force resize to main window size
            console.log('[MAIN] Already in main mode, forcing window resize to main size');
            if (window && window.webContents) {
                window.webContents.send('toggle-titlebar', true);

                // Check if current window is small and mainWindowSize is also small
                const currentSize = window.getSize();
                if (currentSize[0] < 300 || currentSize[1] < 300 || mainWindowSize.width < 300 || mainWindowSize.height < 300) {
                    // Use default main window size
                    const defaultSize = { width: 640, height: 550 };
                    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
                    const defaultPosition = { x: width - defaultSize.width - 18, y: height - defaultSize.height };
                    console.log('[MAIN] Window too small, using default main window size:', defaultSize);
                    window.webContents.send('resize-window', defaultPosition.x, defaultPosition.y, defaultSize.width, defaultSize.height);

                    // Update mainWindowSize to default via helper
                    setMainWindowBounds(defaultSize, defaultPosition, { applyToWindow: false, save: true });
                } else {
                    // Use saved main window size
                    window.webContents.send('resize-window', mainWindowPosition.x, mainWindowPosition.y, mainWindowSize.width, mainWindowSize.height);
                }
            }
            if (window) {
                window.setAlwaysOnTop(false);
                window.setSkipTaskbar(false);
            }
        }
    });

    ipcMain.on('set-password', async () => {
        try {
            console.log('[MAIN] Setting new password...');
            const newPassword = await getAuthInput();
            if (newPassword === false) {
                console.log('[MAIN] Password setting canceled');
                return;
            }
            // Hash the new password for comparison with existing password
            const newPasswordHash = newPassword?.length >= 4 ? hashPin(newPassword) : undefined;
            if (newPasswordHash === config.password) {
                console.log('[MAIN] Password unchanged');
                // Ensure renderer exits auth mode even if password didn't change
                restoreWindowAfterAuth();
                if (window && window.webContents) window.webContents.send('password-set');
                return;
            }
            config.password = newPasswordHash;
            updateConfig(config);
            console.log('[MAIN] Password set successfully');
            restoreWindowAfterAuth();
            if (window && window.webContents) window.webContents.send('password-set');
        } catch (error) {
            console.error('[MAIN] Error setting password:', error);
        }
    });

    ipcMain.on('clear-password', () => {
        try {
            console.log('[MAIN] Clearing password from config...');
            config.password = null;
            updateConfig(config);
            console.log('[MAIN] Password cleared successfully');
        } catch (error) {
            console.error('[MAIN] Error clearing password:', error);
        }
    });

    window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            if (window.webContents.isDevToolsOpened()) {
                window.webContents.closeDevTools();
            } else {
                window.webContents.openDevTools();
            }
            event.preventDefault();
        }
    });

    system.events.on('icon', icons => {
        if (window && window.webContents) window.webContents.send('icon', icons);
    });

    // Listen for notification badge updates from system module
    ipcMain.on('update-notification-badge', (event, count) => {
        if (window && window.webContents) {
            window.webContents.send('update-notification-badge', count);
        }
    });

    superagent.get(config.updateUrl)
        .then(response => {
            if (response.body.version > manifest.version) {
                dialog.showMessageBox(window, {
                    type: 'question',
                    buttons: [` ${lang.UPDATE} `, ` ${lang.NO} `], // added spacing as a workaround to prevent the 'no' button to have a weird visual effect
                    defaultId: 0,
                    title: 'SnapAway',
                    message: lang.UPDATE_AVAILABLE
                }).then(result => {
                    result.response === 0 && shell.openExternal(response.body.url);
                }).catch(error => {
                    console.error(error);
                });
            }
        })
        .catch(error => {
            console.error(String(error));
        });
});

app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
    } else { // window is closed or destroyed
        if (window) global.window = null; // limpa referência obsoleta
        app.relaunch();
        app.quit();
    }
});

app.on('window-all-closed', () => {
    appendIapTrace('app.window-all-closed', { platform: process.platform });
    stopTitlebarOverlay()
    if (process.platform !== 'darwin') {
        // Limpar sistema de áudio antes de sair
        system.cleanupAudio().catch(error => {
            console.error('[MAIN] Error cleaning up audio system:', error);
        });
        app.isQuiting = true;
        app.quit();
    }
});

app.on('activate', () => {
    appendIapTrace('app.activate');
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        startTitlebarOverlay()
    }
});

app.on('before-quit', () => {
    stopTitlebarOverlay()
    stopElevatedHelperServer()
})

// Windows: sessão encerrando (desligar, reiniciar ou sair da conta). O Windows
// dá um orçamento curto de "quiesce" e encerra à força apps que não respondem
// a tempo (WER bucket APPLICATION_HANG_QUIESCE / moapplication_hang_*_hang_quiesce
// no painel de Health da Store). Aqui finalizamos rápido: sem diálogos e sem
// cleanup longo, dentro do orçamento do sistema.
app.on('session-end', () => {
    try {
        appendIapTrace('app.session-end');
        if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
            telemetry.captureTelemetryEvent('app.session-end');
        }
        app.isQuiting = true;
        stopElevatedHelperServer();
        app.quit();
    } catch (error) {
        console.warn('[MAIN] session-end handler error:', error && error.message ? error.message : String(error));
    }
})

app.on('child-process-gone', (event, details) => {
    console.error('[MAIN] child-process-gone:', details);
    appendIapTrace('app.child-process-gone', details || null);
    if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
        telemetry.captureTelemetryEvent('app.child-process-gone', details || null);
    }
});

app.on('render-process-gone', (event, webContents, details) => {
    console.error('[MAIN] app render-process-gone:', details);
    appendIapTrace('app.render-process-gone', details || null);
    if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
        telemetry.captureTelemetryEvent('app.render-process-gone', details || null);
    }
});

app.on('gpu-process-crashed', (event, killed) => {
    console.error('[MAIN] gpu-process-crashed:', { killed });
    appendIapTrace('app.gpu-process-crashed', { killed });
    if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
        telemetry.captureTelemetryEvent('app.gpu-process-crashed', { killed });
    }

    // Resiliência (fallback GPU): após crashes repetidos, desliga a aceleração
    // de hardware (persistido). Se acabou de cruzar o limiar, reinicia o app
    // uma vez para aplicar o fallback imediatamente. Não reinicia de novo se já
    // estiver desabilitado (evita loop crash→relaunch→crash).
    try {
        const shouldRelaunch = gpuPolicy.recordGpuCrash(app);
        if (shouldRelaunch) {
            console.warn('[GPU FALLBACK] Relaunching app to apply GPU fallback.');
            appendIapTrace('app.gpu-fallback.activated');
            app.isQuiting = true;
            app.relaunch();
            setImmediate(() => app.quit());
        }
    } catch (err) {
        console.warn('[GPU FALLBACK] Failed to record GPU crash:', err && err.message ? err.message : err);
    }
});

app.on('suspend', () => {
    appendIapTrace('app.suspend');
    if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
        telemetry.captureTelemetryEvent('app.suspend');
    }
});

app.on('resume', () => {
    appendIapTrace('app.resume');
    if (telemetry && typeof telemetry.captureTelemetryEvent === 'function') {
        telemetry.captureTelemetryEvent('app.resume');
    }
});