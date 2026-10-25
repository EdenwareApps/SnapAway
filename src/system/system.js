const path = require('path');
const config = require('../config/config.js');
const xsystem = require('../x-system/win32-support.js');
const { evaluateWindowEligibility, isBlockedWindowClass, describeWindow, isWindowDiagnosticsEnabled } = require('../shared/window-eligibility');
const { createTransitionTrace, markTransitionStep, markTransitionWindow, logTransitionTrace } = require('../shared/window-transition-trace');
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const os = require('os');
const { createRequire } = require('module');
const runtimeRequire = createRequire(__filename);
const nativeAddonsDisabled = process.env.SNAPAWAY_DISABLE_NATIVE_ADDONS === '1';
if (nativeAddonsDisabled) {
	console.warn('[SYSTEM] Native addons disabled by env (SNAPAWAY_DISABLE_NATIVE_ADDONS=1).');
}

class NoopNativeAudioController {
	async initialize() { return false; }
	async cleanup() {}
	async muteProcess() { return false; }
	async hasActiveAudioSession() { return false; }
	isAvailable() { return false; }
}

class NoopIconExtractorWrapper {
	constructor() {
		this.isAvailable = false;
	}

	async extractIcon() { return false; }
	async extractIcons() { return {}; }
	cleanup() {}
}

class NoopProcessManagerWrapper {
	enumWindows() { return []; }
	showWindow() { return false; }
	isWindow() { return false; }
	isWindowVisible() { return false; }
	isHungAppWindow() { return false; }
	getWindowText() { return ''; }
	getClassName() { return ''; }
	getWindowThreadProcessId() { return { threadId: 0, processId: 0 }; }
	getWindowLongPtr() { return 0; }
	getWindow() { return null; }
	getExecutablePath() { return ''; }
	openProcess() { return null; }
	closeHandle() { return false; }
	queryFullProcessImageName() { return ''; }
}

function loadWrapperModule(relativePath, label, FallbackClass) {
	if (nativeAddonsDisabled) {
		console.warn(`[SYSTEM] Native addons disabled, using fallback for ${label}`);
		return FallbackClass;
	}

	try {
		console.log(`[SYSTEM] before require ${label}`);
		const requiredModule = runtimeRequire(path.join(__dirname, relativePath));
		const resolvedModule = (requiredModule && (requiredModule.default || requiredModule)) || requiredModule;
		console.log(`[SYSTEM] after require ${label}`, resolvedModule);
		return resolvedModule;
	} catch (error) {
		console.error(`[SYSTEM] failed to require ${label}:`, error && error.stack ? error.stack : error);
		throw error;
	}
}
// load wrapper modules at runtime to keep Rollup from bundling them
// they are copied into out/main by the build step above
// when running from the built bundle, __dirname points at out/main
console.log('[SYSTEM] before loading native wrappers');
const NativeAudioController = loadWrapperModule(path.join('audio', 'audio-wrapper.js'), 'audio-wrapper', NoopNativeAudioController);
const IconExtractorWrapper = loadWrapperModule(path.join('icons', 'icon-wrapper.js'), 'icon-wrapper', NoopIconExtractorWrapper);
const ProcessManagerWrapper = loadWrapperModule(path.join('process', 'process-wrapper.js'), 'process-wrapper', NoopProcessManagerWrapper);

const fs = require('fs'); // Added for fs.existsSync and fs.mkdirSync

// Native audio controller for audio control

// Verificação de plataforma
if (process.platform !== 'win32') {
    throw new Error('This module is only supported on Windows');
}

const icons = {};
const events = new EventEmitter();

// Constantes para controle de janelas
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;

// 3. Constantes atualizadas
const WindowConstants = {
	GWL_STYLE: -16,
	GWL_EXSTYLE: -20,
	GW_OWNER: 4,
	WS_CHILD: 0x40000000,
	SW_HIDE: 0,
	SW_SHOW: 5,
	SW_SHOWNA: 8,
	SW_MINIMIZE: 6,
	GW_HWNDFIRST: 0,    // Adicione
	GW_HWNDNEXT: 2      // Adicione
}

// Track hidden windows for notification badge
let hiddenWindowsCount = 0;
let hiddenWindowsSet = new Set();
const hiddenWindowZOrder = new Map();

// Native audio controller instance
const nativeAudioController = new NativeAudioController();

// Native icon extractor instance
const iconExtractor = new IconExtractorWrapper();

// Native process manager instance
const processManager = new ProcessManagerWrapper();

// Adapter for the shared window-eligibility decision (single source of truth).
// `formatHwnd` is identity here because hwnds are already strings in this layer.
const windowEligibilityApi = {
	isWindow: (hwnd) => processManager.isWindow(hwnd),
	getStyle: (hwnd) => processManager.getWindowLongPtr(hwnd, WindowConstants.GWL_STYLE),
	getExStyle: (hwnd) => processManager.getWindowLongPtr(hwnd, WindowConstants.GWL_EXSTYLE),
	getOwner: (hwnd) => processManager.getWindow(hwnd, WindowConstants.GW_OWNER),
	getClassName: (hwnd) => processManager.getClassName(hwnd),
	isVisible: (hwnd) => processManager.isWindowVisible(hwnd),
	processIdOf: (hwnd) => {
		const info = processManager.getWindowThreadProcessId(hwnd);
		return info ? info.processId : 0;
	},
	getProcessName: (hwnd) => {
		try {
			const executable = getExecutableFromHwnd(hwnd);
			return executable ? path.basename(executable) : '';
		} catch (_) {
			return '';
		}
	},
	formatHwnd: (hwnd) => String(hwnd)
};

// Cache for processed executables to avoid repeated icon extraction
const processedExecutables = new Set();

// session-only managed windows added by titlebar overlay clicks
const sessionManagedWindows = new Map();

// Function to clear the processed executables cache (useful for testing or when icons need to be refreshed)
function clearProcessedExecutablesCache() {
    processedExecutables.clear();
    console.log('[ICONS] Cleared processed executables cache');
}

function getAllSelectionFilters() {
	const persisted = Array.isArray(config.filters) ? config.filters : []
	if (sessionManagedWindows.size === 0) return persisted
	return [...persisted, ...Array.from(sessionManagedWindows.values()).map(item => item.filter)]
}

function buildManagedFilterFromHwnd(hwndStr) {
	if (!hwndStr || !processManager.isWindow(hwndStr)) {
		return null
	}

	const title = processManager.getWindowText(hwndStr) || ''
	const className = processManager.getClassName(hwndStr) || ''
	const executable = getExecutableFromHwnd(hwndStr)
	const process = executable ? path.basename(executable) : ''

	return {
		type: 'overlay-hwnd',
		value: hwndStr,
		hwnd: hwndStr,
		title,
		className,
		process,
		executable,
		insensitive: false
	}
}

// Returns the cached icon:// URL for an executable path, if any.
function getIconUrlForExecutable(executable) {
	if (!executable) return ''
	const cached = icons[executable]
	if (!cached) return ''
	return cached.startsWith('icon://') ? cached : 'icon://' + encodeURIComponent(cached)
}

// Resolves an icon:// URL for an executable, extracting it on demand if it is
// not cached yet. Resolves to null when unavailable. Used by the overlay click
// path so a filter added via the overlay gets its icon even if the window is
// hidden right away (and thus no longer present in the visible process list).
function resolveIconForExecutable(executable) {
	if (!executable) return Promise.resolve(null)
	const cached = getIconUrlForExecutable(executable)
	if (cached) return Promise.resolve(cached)
	if (!iconExtractor.isAvailable) return Promise.resolve(null)

	const tempDir = path.join(
		process.env.TEMP || process.env.TMP || os.tmpdir() || '/tmp',
		'SnapAway',
		'icons'
	)
	try {
		fs.mkdirSync(tempDir, { recursive: true })
	} catch (_) {}
	return iconExtractor.extractIcons([executable], tempDir)
		.then(mappings => {
			const extracted = mappings && mappings[executable]
			if (!extracted) return null
			const iconUrl = 'icon://' + encodeURIComponent(extracted)
			if (icons[executable] !== iconUrl) {
				icons[executable] = iconUrl
				events.emit('icon', icons)
			}
			return iconUrl
		})
		.catch(error => {
			console.error('[ICON] Error resolving icon for executable:', executable, error && error.message ? error.message : error)
			return null
		})
}

function registerWindow(hwndStr) {
	const filter = buildManagedFilterFromHwnd(hwndStr)
	if (!filter) {
		return false
	}

	sessionManagedWindows.set(hwndStr, {
		hwnd: hwndStr,
		filter,
		createdAt: Date.now()
	})

	return true
}

function isWindowManaged(hwndStr) {
	if (!hwndStr) return false
	if (sessionManagedWindows.has(hwndStr)) return true

	const allFilters = getAllSelectionFilters()
	return allFilters.some(filter => filter && filter.hwnd && filter.hwnd === hwndStr)
}

async function enableHideState(hwndStr, trace = null) {
	return hideSpecificWindow(hwndStr, trace)
}

async function enableHideStateForSelected(trace = null) {
	return hideWindows(trace)
}

function hasManagedWindows() {
	const persistedFilters = Array.isArray(config.filters) ? config.filters.length : 0
	return persistedFilters > 0 || sessionManagedWindows.size > 0
}

// Initialize icon extractor and ensure temp directory exists
async function initializeIconExtractor() {
    try {
        // Ensure temp directory exists
        const tempDir = path.join(process.env.TEMP || process.env.TMP || '/tmp', 'SnapAway', 'icons');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
            console.log('[ICONS] Created temp directory:', tempDir);
        }
        
        // Clear any old file:// URLs from icons cache
        for (const executable in icons) {
            if (icons[executable] && !icons[executable].startsWith('icon://')) {
                console.log('[ICONS] Cleaning old icon URL for:', executable);
                delete icons[executable];
            }
        }
        
        // Test icon extractor availability
        if (iconExtractor.isAvailable) {
            console.log('[ICONS] Icon extractor initialized successfully');
        } else {
            console.log('[ICONS] Icon extractor not available');
        }
    } catch (error) {
        console.error('[ICONS] Error initializing icon extractor:', error);
    }
}

function updateNotificationBadge() {
    // This function will be called by the main process to get the current count
    return hiddenWindowsCount;
}

function addHiddenWindow(hwndStr) {
    if (!hiddenWindowsSet.has(hwndStr)) {
        hiddenWindowsSet.add(hwndStr);
        hiddenWindowsCount = hiddenWindowsSet.size;
        updateNotificationBadge();
    }
}

// "O SnapAway ocultou esta janela?" — windows hidden by the app itself (tray
// apps, self-hiding stubs) never enter this set, so they are never restored.
// Hides from previous runs are covered by config.hiddenWindows (persisted).
function wasHiddenByUs(hwndStr) {
    return hiddenWindowsSet.has(hwndStr);
}

function removeHiddenWindow(hwndStr) {
    if (hiddenWindowsSet.has(hwndStr)) {
        hiddenWindowsSet.delete(hwndStr);
        hiddenWindowsCount = hiddenWindowsSet.size;
        updateNotificationBadge();
    }
}

function clearHiddenWindows() {
    hiddenWindowsSet.clear();
    hiddenWindowsCount = 0;
    updateNotificationBadge();
}

async function hasActiveAudioSession(processId) {
    try {
        if (nativeAudioController.isAvailable()) {
            return await nativeAudioController.hasActiveAudioSession(processId);
        }
        return false;
    } catch (error) {
        console.error('[AUDIO] Error checking active audio session:', error);
        return false;
    }
}

async function initializeAudio() {
    try {
        await nativeAudioController.initialize();
        console.log('[AUDIO] Audio system initialized successfully');
    } catch (error) {
        console.error('[AUDIO] Error initializing audio system:', error);
    }
}

async function externalShowWindow(windows, show=false) {
	console.log('!!! externalShowWindow', windows, show);
	const isShow = show === true;
	show = WindowConstants[show === true ? 'SW_SHOWNA' : 'SW_HIDE'];
	// Last gate before ShowWindow: never touch a window that is not a real
	// target, so an auxiliary window can never be revealed (or hidden). When
	// showing, a zero-area window is dropped too: there is nothing to present
	// and it would appear as an empty, title-less frame.
	const targets = windows.filter(hwndStr => {
		if (!processManager.isWindow(hwndStr) || !isValidWindow(hwndStr)) return false;
		return isShow ? !xsystem.isZeroAreaWindow(hwndStr) : true;
	});
	const hungWindows = targets.filter(hwndStr => {
		if(processManager.isHungAppWindow(hwndStr)) return true;
		processManager.showWindow(hwndStr, show);
		return false;
	});
	console.log('!!! externalShowWindow hungWindows', hungWindows);
	if(hungWindows.length == 0) return;

    // O worker roda em contexto eval; require relativo resolve errado no build
    // (out/main/index.js). Usamos o caminho ABSOLUTO do wrapper para o worker
    // conseguir carregá-lo (fix 1.1.2).
    const wrapperPath = path.join(__dirname, 'process', 'process-wrapper.js');
    const content = `
        const { parentPort } = require('worker_threads');
        const ProcessManagerWrapper = require(${JSON.stringify(wrapperPath)});
        const processManager = new ProcessManagerWrapper();
        
        parentPort.on('message', hwnds => {
			console.log('!!!! hwnds on worker', hwnds);
            for(const hwndStr of hwnds) {
				try {
					processManager.showWindow(hwndStr, ${show});
				} catch (e) {
					console.error('!!!! Error in ShowWindow:', e);
				}
			}
            parentPort.postMessage('done');
			process.exit(0);
        });
    `
	const worker = new Worker(content, { eval: true });
	console.log('!!! externalShowWindow worker', worker);
    worker.postMessage(hungWindows);
	return new Promise((resolve, reject) => {
		let timer = 0;
		const finish = () => {
			clearTimeout(timer);
			worker.terminate();
			resolve();
		}
		worker.on('message', (message) => {
			if (message === 'done') {
				finish();
			}
		});
		worker.on('error', (err) => {
			console.error('!!!! Error in Worker:', err);
			finish();
		});
		worker.on('exit', (code) => {
			if (code !== 0)
				console.error(`Worker finished with exit code ${code}`);
		});
		timer = setTimeout(() => worker.terminate(), Math.min(windows.length * 1000, 10000));
	});
}

function captureZOrderSnapshot() {
	const snapshot = new Map();
	try {
		const windows = processManager.enumWindows();
		for (let i = 0; i < windows.length; i += 1) {
			const window = windows[i];
			if (!window || !window.hwnd) continue;
			snapshot.set(window.hwnd, i);
		}
	} catch (error) {
		console.error('[SYSTEM] Failed to capture z-order snapshot:', error);
	}
	return snapshot;
}

function isValidWindow(hwndStr) {
	try {
		// Eligibility only (structure + documented class exceptions). Visibility
		// is a separate STATE: a window hidden by SnapAway is still eligible and
		// must stay in the list so it can be restored.
		return evaluateWindowEligibility(windowEligibilityApi, hwndStr).eligible;
	} catch (error) {
		console.error('Window validation error:', error);
		return false;
	}
}

// A window can only be shown again when it is both a real target and something
// the user could actually see. Zero-area helpers (message-only stubs, IME
// listeners) have nothing to present: SW_SHOWNA on them maps an empty frame
// that was never on screen — the "ghost window" bug reported with Spotify.
function isRestorableWindow(hwndStr) {
	if (!processManager.isWindow(hwndStr)) return false;
	if (!isValidWindow(hwndStr)) return false;
	if (xsystem.isZeroAreaWindow(hwndStr)) return false;
	return true;
}

// Counts, per executable (lowercased path), how many valid top-level windows
// currently exist. This is what lets us treat single-window processes as
// "identity == process": when an app owns exactly one window, the filter can be
// re-bound to that window after a restart or a title change.
//
// Accepts an already-enumerated window list (each item needing at least `hwnd`,
// optionally `executable`) to avoid enumerating twice; when omitted it
// enumerates windows itself. Executables are resolved once per PID.
function buildExecutableWindowCounts(windows) {
	const counts = new Map();
	const executableByPid = new Map();
	const source = Array.isArray(windows) ? windows : processManager.enumWindows();

	for (const window of source) {
		const hwndStr = window && window.hwnd;
		if (!hwndStr) continue;
		if (!isValidWindow(hwndStr)) continue;

		let executable = window.executable || '';
		if (!executable) {
			try {
				const info = processManager.getWindowThreadProcessId(hwndStr);
				const pid = info ? info.processId : 0;
				if (pid) {
					if (executableByPid.has(pid)) {
						executable = executableByPid.get(pid);
					} else {
						executable = processManager.getExecutablePath(pid) || '';
						executableByPid.set(pid, executable);
					}
				}
			} catch (error) {
				executable = '';
			}
		}

		if (executable) {
			const key = String(executable).toLowerCase();
			// list() output already carries the authoritative per-executable
			// count; reuse it so iterateWindows() (which runs over list() output)
			// does not undercount windows that list() intentionally omitted.
			const known = Number(window.windowCount);
			if (Number.isFinite(known) && known > 0) {
				counts.set(key, Math.max(counts.get(key) || 0, known));
			} else {
				counts.set(key, (counts.get(key) || 0) + 1);
			}
		}
	}

	return counts;
}

// Single shared matcher used by list()/isFilteredWindow() and iterateWindows()
// so every lookup path applies the exact same precedence:
//
//   1. overlay-hwnd filters stay bound to their session HWND.
//   2. A stored HWND that is still the same window AND belongs to the same
//      executable matches. Checking the executable (not only the HWND) protects
//      against Windows recycling a destroyed HWND for an unrelated window.
//   3. Single-window processes: window identity == process identity, so the
//      window can be re-resolved by executable after a restart or a title
//      change. filter.hwnd is refreshed by syncFilterWithWindow().
//   4. Fallback: the original type-based comparison (title/process/className).
function matchesFilter(win, filter, windowCounts) {
	if (!filter || !win) return false;

	// Overlay filters are always bound to a single, session-scoped HWND.
	if (filter.type === 'overlay-hwnd') {
		return !!filter.hwnd && win.hwnd === filter.hwnd;
	}

	// Auxiliary windows that a filter process owns (IME/"Default IME",
	// "GDI+ Hook Window Class", "DDE Server Window", crashpad watchers...) are
	// never targets. They are structurally rejected (child/owned/blocked class)
	// and must not match even when a filter still stores their HWND: a legacy
	// binding like that makes the show path call SW_SHOWNA on a window the user
	// never had visible.
	if (!isValidWindow(win.hwnd)) {
		return false;
	}

	const execKey = filter.executable ? String(filter.executable).toLowerCase() : '';
	const winExecKey = win.executable ? String(win.executable).toLowerCase() : '';
	const execMatch = !!execKey && !!winExecKey && execKey === winExecKey;
	const processMatch = !execMatch && !!filter.process && !!win.process &&
		String(filter.process).toLowerCase() === String(win.process).toLowerCase();
	const identityMatch = execMatch || processMatch;

	// The live window must be the same KIND as the filtered one. An empty
	// className on the filter (e.g. elevated windows where GetClassName fails)
	// means "no constraint", so recovery keeps working where the class is
	// unreadable; when the filter does carry a class it must match exactly.
	const classMatch = !filter.className || filter.className === win.className;

	// 2) Stored HWND still alive and owned by the same executable.
	if (filter.hwnd && win.hwnd === filter.hwnd && identityMatch) {
		return true;
	}

	// 2b) Identity could not be resolved at all (e.g. a system window whose
	// process handle is inaccessible). Fall back to a pure HWND match so
	// explicitly-bound filters keep working instead of silently dropping.
	if (filter.hwnd && win.hwnd === filter.hwnd && win.unknownIdentity) {
		return true;
	}

	// 3) Recover the HWND for single-window processes. Requires the same
	// executable AND the same window class (when known) as the filtered window.
	if (execMatch && classMatch && windowCounts && windowCounts.get(execKey) === 1) {
		return true;
	}

	// 4) Type-based fallback.
	const insensitive = !!filter.insensitive;
	const compare = (a = '', b = '') => insensitive
		? String(a).toLowerCase().includes(String(b).toLowerCase())
		: String(a).includes(String(b));

	switch (filter.type) {
		case 'title':
			if (!win.title) return false;
			if (compare(win.title, filter.value)) return true;
			// Learned title tokens (drifted titles) are additive: they only ever
			// widen the match, never gate it.
			return Array.isArray(filter.tokens) && filter.tokens.some(token => token && compare(win.title, token));
		case 'process':
			return !!win.process && compare(win.process, filter.value);
		case 'className':
			return !!win.className && compare(win.className, filter.value);
		default:
			return false;
	}
}

// Keeps a persisted filter in sync with the live window it matched. Refreshing
// the stored HWND/title is what makes the single-window recovery durable across
// process restarts and dynamic title changes. Only touches in-memory config
// (nested mutations must not trigger disk writes on every list() call).
function syncFilterWithWindow(filter, win) {
	if (!filter || !win || filter.type === 'overlay-hwnd') return;
	// Never re-bind a filter to a non-target window: the last enumerated
	// matching window used to win, so a process filter could end up pointing at
	// an auxiliary window (Default IME) instead of the app window.
	if (!win.hwnd || !isValidWindow(win.hwnd)) return;
	if (!Array.isArray(config.filters)) return;

	const index = config.filters.indexOf(filter);
	if (index === -1) return;

	const stored = config.filters[index];

	if (win.hwnd && stored.hwnd !== win.hwnd) {
		stored.hwnd = win.hwnd;
	}

	if (stored.type === 'title' && win.title && stored.title !== win.title) {
		stored.title = win.title;
	}
}

function isFilteredWindow(hwndStr, windowCounts) {
	// A window is considered "filtered" if it matches any filter, not just when
	// a filter explicitly stores the HWND. This is important so that hidden
	// windows remain included in the process list and can be restored later.
	//
	// We use the same matching logic as iterateWindows to ensure consistency.
	let windowData;
	try {
		const executable = getExecutableFromHwnd(hwndStr);
		const process = executable ? path.basename(executable) : '';
		const title = processManager.getWindowText(hwndStr) || '';
		const className = processManager.getClassName(hwndStr) || '';
		windowData = { hwnd: hwndStr, process, title, className, executable };
	} catch (error) {
		// If we can't obtain window details, fallback to only matching by HWND
		windowData = { hwnd: hwndStr, process: '', title: '', className: '', executable: '', unknownIdentity: true };
	}

	return getAllSelectionFilters().some(filter => matchesFilter(windowData, filter, windowCounts));
}

function isWindowHidden(hwndStr) {
	return !processManager.isWindowVisible(hwndStr) || (processManager.getWindowLongPtr(hwndStr, WindowConstants.GWL_STYLE) & WindowConstants.WS_CHILD) !== 0;
}	

// Função para limpar janelas órfãs da lista hiddenWindows
function cleanupOrphanedHiddenWindows() {
	if (!Array.isArray(config.hiddenWindows)) {
		config.hiddenWindows = [];
		return;
	}
	
	const validHiddenWindows = [];
	config.hiddenWindows.forEach(hwndStr => {
		// A tracked window must still exist AND still be a real, restorable
		// target: legacy entries pointing at auxiliary windows (IME/DDE/GDI+)
		// or zero-area stubs are dropped here so they can never be "restored"
		// on the next show.
		if (isRestorableWindow(hwndStr)) {
			validHiddenWindows.push(hwndStr);
		} else {
			console.log('[SYSTEM] Removing orphaned hidden window:', hwndStr);
			// Remove from tracking set as well
			removeHiddenWindow(hwndStr);
		}
	});
	
	if (validHiddenWindows.length !== config.hiddenWindows.length) {
		console.log(`[SYSTEM] Cleaned up ${config.hiddenWindows.length - validHiddenWindows.length} orphaned hidden windows`);
		config.hiddenWindows = validHiddenWindows;
	}
}

// Opt-in diagnostic (SNAPAWAY_WINDOW_DIAG=1): dump the eligibility decision for
// every enumerated top-level window, deduped by signature so it only logs when
// the window landscape changes. Meant to build a real test matrix instead of
// guessing classes in advance.
let lastEligibilityDumpSignature = '';
function maybeDumpWindowEligibility(windows) {
	if (!isWindowDiagnosticsEnabled()) return;
	try {
		const rows = [];
		for (const window of windows) {
			const hwndStr = window && window.hwnd;
			if (!hwndStr) continue;
			rows.push(describeWindow(windowEligibilityApi, hwndStr));
		}
		const signature = rows.map(row => `${row.hwnd}|${row.className}|${row.code}`).sort().join(',');
		if (signature === lastEligibilityDumpSignature) return;
		lastEligibilityDumpSignature = signature;
		console.log('[WINDOW-DIAG] enumerate', JSON.stringify(rows));
	} catch (error) {
		console.warn('[WINDOW-DIAG] dump failed:', error && error.message ? error.message : error);
	}
}

async function list(serializable = false, skipHiddenWindows = false) {
	const processes = [];
	const executables = [];
	
	// Use native process manager to enumerate windows
	const windows = processManager.enumWindows();

	// Opt-in diagnostics for building a real eligibility test matrix.
	maybeDumpWindowEligibility(windows);

	// Count valid top-level windows per executable once per list run so the
	// shared matcher can treat single-window processes as process-identified.
	const windowCounts = buildExecutableWindowCounts(windows);

	for (const window of windows) {
		const hwndStr = window.hwnd;
		
		if (isValidWindow(hwndStr) || isFilteredWindow(hwndStr, windowCounts)) {
			// Sempre incluir janelas filtradas, mesmo quando estão ocultas
			// Isso permite que o app restaure janelas ocultas corretamente
			if (skipHiddenWindows && isWindowHidden(hwndStr) && !isFilteredWindow(hwndStr, windowCounts)) {
				continue;
			}

			const executable = getExecutableFromHwnd(hwndStr);
			const process = executable ? path.basename(executable) : null;
			if (!process) {
				continue;
			}
			if (process.toLowerCase() === 'snapaway.exe') {
				continue;
			}
			
			const title = window.title || '';
			const className = window.className || '';

			if (typeof icons[executable] !== 'string') {
				executables.push(executable);
			}

			const iconUrl = icons[executable] ? (icons[executable].startsWith('icon://') ? icons[executable] : 'icon://' + encodeURIComponent(icons[executable])) : '';
			processes.push({
				hwnd: hwndStr, // Always use string HWND
				process,
				title,
				className,
				executable,
				// Authoritative count of valid top-level windows for this
				// executable, used by the renderer matcher for HWND recovery.
				windowCount: windowCounts.get(String(executable).toLowerCase()) || 1,
				icon: iconUrl
			});
		}
	}

	// Use native icon extractor
	const tempDir = path.join(process.env.TEMP || process.env.TMP || '/tmp', 'SnapAway', 'icons');
	
	// Ensure temp directory exists
	if (!fs.existsSync(tempDir)) {
		try {
			fs.mkdirSync(tempDir, { recursive: true });
			console.log('[ICONS] Created temp directory for first run:', tempDir);
		} catch (error) {
			console.error('[ICONS] Error creating temp directory:', error);
		}
	}
	
	// Filter out already processed executables to avoid repeated extraction
	const newExecutables = executables.filter(executable => !processedExecutables.has(executable));
	
	// Only extract icons if we have new executables and the extractor is available
	if (newExecutables.length > 0 && iconExtractor.isAvailable) {
		// Mark these executables as processed
		newExecutables.forEach(executable => processedExecutables.add(executable));
		
		console.log(`[ICONS] Extracting icons for ${newExecutables.length} new executables`);
		
		// Process in batches to avoid OOM crashes when many new executables appear at once
		const BATCH_SIZE = 10;
		const batches = [];
		for (let i = 0; i < newExecutables.length; i += BATCH_SIZE) {
			batches.push(newExecutables.slice(i, i + BATCH_SIZE));
		}

		(async () => {
			for (const batch of batches) {
				try {
					const mappings = await iconExtractor.extractIcons(batch, tempDir);
					let changed = false;
					for (const executable in mappings) {
						const iconUrl = 'icon://' + encodeURIComponent(mappings[executable]);
						if (icons[executable] !== iconUrl) {
							icons[executable] = iconUrl;
							changed = true;
						}
					}
					if (changed) {
						console.log('[ICONS] Icon mappings updated, emitting event');
						events.emit('icon', icons);
					}
				} catch (e) {
					console.error('[ICONS] Error extracting icons batch:', e);
				}
			}
		})();
	} else if (newExecutables.length > 0 && !iconExtractor.isAvailable) {
		console.log('[ICONS] Icon extractor not available, skipping icon extraction');
	}

	return processes;
}

function getExecutableFromHwnd(hwndStr) {
	const processInfo = processManager.getWindowThreadProcessId(hwndStr);
	if (!processInfo || !processInfo.processId) {
		throw new Error('Failed to get thread/process ID');
	}
	const processId = processInfo.processId;

	const executable = processManager.getExecutablePath(processId);
	return executable;
}

async function iterateWindows(callback, hwndOnly = false, skipHiddenWindows = false) {
	const windows = await list(false, skipHiddenWindows);
	// Reuse the executables already resolved by list() to build the per-process
	// window counts without enumerating or opening processes again.
	const windowCounts = buildExecutableWindowCounts(windows);
	windows.forEach(win => {
		const hwndStr = win.hwnd; // Already a string
		getAllSelectionFilters().some(filter => {
			if (hwndOnly && hwndStr != filter.hwnd) {
				return false;
			}
			if (!matchesFilter(win, filter, windowCounts)) {
				return false;
			}
			// Keep the persisted filter bound to the live window so the HWND
			// recovery survives process restarts and dynamic title changes.
			syncFilterWithWindow(filter, win);
			callback(win);
			return true;
		});
	});
}

// Funções para controle de áudio das janelas
async function initializeAudio() {
	try {
		// Initialize native audio controller
		const nativeInitialized = await nativeAudioController.initialize();
		if (nativeInitialized) {
			console.log('[AUDIO] Native audio controller initialized successfully');
		} else {
			console.log('[AUDIO] Native audio controller initialization failed');
		}
	} catch (error) {
		console.error('[AUDIO] Error initializing audio:', error);
	}
}

// O cleanup nativo é SÍNCRONO por dentro (COM: Release + CoUninitialize em
// audio-addon.cpp) e pode pendurar a thread principal quando o serviço de áudio
// está lento (Bluetooth/HDMI reconectando, endpoint removido no meio do
// encerramento) — é um dos candidatos a HANG_QUIESCE / ENDTASK_HungThreadIsIdle.
// Como ele fica no caminho de quit, aqui ele é "best effort" e com orçamento:
//   - idempotente: executa no máximo uma vez por processo (chamadas repetidas
//     reaproveitam a mesma promise, sem repetir o teardown COM);
//   - nunca rejeita: o encerramento não pode falhar por causa dele;
//   - com timeout: quem chama recebe o controle em no máximo `timeoutMs`;
//   - instrumentado: mede a duração e expõe em getAudioCleanupStats();
//   - escape hatch: SNAPAWAY_SKIP_AUDIO_CLEANUP=1 (ou skipNative=true) pula o
//     teardown nativo — o processo está saindo e o SO libera os recursos.
const AUDIO_CLEANUP_TIMEOUT_MS = 1000;
const SKIP_NATIVE_AUDIO_CLEANUP = process.env.SNAPAWAY_SKIP_AUDIO_CLEANUP === '1';
let audioCleanupPromise = null;
let audioCleanupStats = { started: false, completed: false, timedOut: false, durationMs: 0, reason: null };

function cleanupAudio({ timeoutMs = AUDIO_CLEANUP_TIMEOUT_MS, reason = 'unspecified', skipNative = SKIP_NATIVE_AUDIO_CLEANUP } = {}) {
	// Uma única execução por processo: window-all-closed, before-quit e
	// session-end podem chamar sem risco de repetir o teardown nativo.
	if (audioCleanupPromise) return audioCleanupPromise;

	audioCleanupStats = { started: true, completed: false, timedOut: false, durationMs: 0, reason };
	const startedAt = Date.now();

	// Orçamento armado ANTES do trabalho nativo: mesmo que a chamada nativa nunca
	// retorne (refactor futuro/async), o caller é liberado dentro do timeout.
	// O timer é unref() para nunca manter o processo vivo por causa dele.
	let budgetTimer = null;
	const budget = new Promise(resolve => {
		budgetTimer = setTimeout(() => resolve(false), timeoutMs);
		if (budgetTimer && typeof budgetTimer.unref === 'function') budgetTimer.unref();
	});

	const nativeCleanup = (async () => {
		if (skipNative) {
			console.log(`[AUDIO] cleanup nativo ignorado (skipNative=true, reason=${reason})`);
			return true;
		}
		try {
			// Cleanup native audio controller (síncrono por dentro)
			await nativeAudioController.cleanup();
		} catch (error) {
			console.error('[AUDIO] Error cleaning up native audio controller:', error);
		}
		try {
			// Cleanup native icon extractor
			iconExtractor.cleanup();
		} catch (error) {
			console.error('[ICON-ADDON] Error cleaning up icon extractor:', error);
		}
		return true;
	})();

	audioCleanupPromise = Promise.race([nativeCleanup, budget])
		.then(() => {
			if (budgetTimer) clearTimeout(budgetTimer);
			const durationMs = Date.now() - startedAt;
			// A duração é o único sinal confiável: um bloqueio síncrono não pode ser
			// interrompido pelo timer (a thread só volta quando o COM retorna).
			const timedOut = durationMs > timeoutMs;
			audioCleanupStats = { started: true, completed: !timedOut, timedOut, durationMs, reason, skipped: skipNative };
			if (timedOut) {
				console.warn(`[AUDIO] cleanup levou ${durationMs}ms (> ${timeoutMs}ms, reason=${reason}) — possível travamento no encerramento`);
			} else {
				console.log(`[AUDIO] Audio cleanup completed em ${durationMs}ms (reason=${reason})`);
			}
			return audioCleanupStats;
		})
		.catch(error => {
			// Nunca propaga: o encerramento não pode depender deste caminho.
			console.error('[AUDIO] Error cleaning up audio:', error);
			audioCleanupStats = { ...audioCleanupStats, completed: false };
			return audioCleanupStats;
		});

	return audioCleanupPromise;
}

function getAudioCleanupStats() {
	return { ...audioCleanupStats };
}

async function muteWindowAudio(hwndStr) {
	try {
		console.log(`[AUDIO] config.muteWindows: ${config.muteWindows}`);
		if (!config.muteWindows) {
			console.log('[AUDIO] Audio muting disabled by config');
			return false;
		}

		// Se o controlador nativo ainda não estiver pronto (ex.: a inicialização
		// no boot falhou transitoriamente ou o dispositivo de áudio não estava
		// disponível), tentamos inicializá-lo lazy antes de desistir (fix 1.1.2).
		if (!nativeAudioController.isAvailable()) {
			console.log('[AUDIO] Native audio controller not available — attempting lazy init');
			try {
				const initialized = await nativeAudioController.initialize();
				if (!initialized) {
					console.log('[AUDIO] Lazy audio init failed, cannot mute');
					return false;
				}
			} catch (initError) {
				console.error('[AUDIO] Error during lazy audio init:', initError);
				return false;
			}
		}

		// Use native audio controller
		const processInfo = processManager.getWindowThreadProcessId(hwndStr);
		if (!processInfo || !processInfo.processId) {
			console.error('[AUDIO] Invalid process ID for HWND:', hwndStr);
			return false;
		}
		return await nativeAudioController.muteProcess(processInfo.processId, true);
	} catch (error) {
		console.error('[AUDIO] Error muting window audio:', error);
		return false;
	}
}





async function unmuteWindowAudio(hwndStr) {
	try {
		if (!config.muteWindows) {
			console.log('[AUDIO] Audio unmuting disabled by config');
			return false;
		}

		// Mesmo lazy init do mute: garante que o controlador esteja disponível
		// antes de tentar reverter o estado de áudio (fix 1.1.2).
		if (!nativeAudioController.isAvailable()) {
			console.log('[AUDIO] Native audio controller not available — attempting lazy init');
			try {
				const initialized = await nativeAudioController.initialize();
				if (!initialized) {
					console.log('[AUDIO] Lazy audio init failed, cannot unmute');
					return false;
				}
			} catch (initError) {
				console.error('[AUDIO] Error during lazy audio init:', initError);
				return false;
			}
		}

		// Use native audio controller
		const processInfo = processManager.getWindowThreadProcessId(hwndStr);
		if (!processInfo || !processInfo.processId) {
			console.error('[AUDIO] Invalid process ID for HWND:', hwndStr);
			return false;
		}
		return await nativeAudioController.muteProcess(processInfo.processId, false);
	} catch (error) {
		console.error('[AUDIO] Error unmuting window audio:', error);
		return false;
	}
}





async function hideWindows(trace = null) {
	const ownsTrace = !trace;
	if (ownsTrace) trace = createTransitionTrace('hide', 'system');

	const queue = [], hidden = [], elevated = [];
	const mutedPids = new Set(); // dedup: mutar 1x por processo, não por janela
	const zOrderSnapshot = captureZOrderSnapshot();
	markTransitionStep(trace, 'snapshot');
	await iterateWindows(async (win) => {
		const processInfo = processManager.getWindowThreadProcessId(win.hwnd);
		console.log(`[AUDIO] Processing window: ${win.process} (HWND: ${win.hwnd}, PID: ${processInfo ? processInfo.processId : 'unknown'})`);

		// Não ocultar janelas da barra de tarefas ou outras classes de sistema
		// mesmo quando o processo (ex: explorer.exe) estiver nos filtros.
		const className = win.className || processManager.getClassName(win.hwnd) || '';
		if (isBlockedWindowClass(className)) {
			console.log(`[SYSTEM] Skipping hide for system window: ${win.hwnd} class: ${className}`);
			markTransitionWindow(trace, win.hwnd, win.process, 'skipped-system-class');
			return;
		}
		// Janelas sem área (helpers IME/listener, stubs invisíveis) não têm nada a
		// ocultar: ocultá-las só polui o rastreamento e o badge de notificação.
		if (xsystem.isZeroAreaWindow(win.hwnd)) {
			console.log(`[SYSTEM] Skipping hide for zero-area window: ${win.hwnd} class: ${className}`);
			markTransitionWindow(trace, win.hwnd, win.process, 'skipped-zero-area');
			return;
		}
		if (!isWindowHidden(win.hwnd)) {
			hiddenWindowZOrder.set(win.hwnd, zOrderSnapshot.get(win.hwnd) ?? Number.MAX_SAFE_INTEGER);
			if (processManager.isHungAppWindow(win.hwnd)) {
				queue.push(win.hwnd);
				markTransitionWindow(trace, win.hwnd, win.process, 'queued-hung');
			} else {
				processManager.showWindow(win.hwnd, WindowConstants.SW_HIDE);
				// Diagnóstico (fix 1.1.2): se a janela continuar visível após
				// SW_HIDE, o hide falhou — tipicamente o alvo pertence a um
				// processo elevado (ex.: Roblox/Discord rodando como admin), o
				// que mantém a presença na barra de tarefas/bandeja.
				if (processManager.isWindowVisible(win.hwnd)) {
					console.warn(`[SYSTEM] Window ${win.hwnd} (${win.process}) still visible after SW_HIDE — likely elevated process; reporting for elevated hide`);
					hiddenWindowZOrder.delete(win.hwnd);
					elevated.push(win.hwnd);
					markTransitionWindow(trace, win.hwnd, win.process, 'elevated-pending');
					return;
				}
				hidden.push(win.hwnd);
				addHiddenWindow(win.hwnd); // Track hidden window for notification badge
				markTransitionWindow(trace, win.hwnd, win.process, 'hidden');
				if (config.muteWindows) {
					const processId = processInfo ? processInfo.processId : 0;
					// Só muta UMA vez por processo (muitas janelas do mesmo PID,
					// ex.: WMP, gerariam N chamadas de mute redundantes).
					if (processId && mutedPids.has(processId)) {
						return;
					}
					if (processId) {
						mutedPids.add(processId);
					}
					const hasAudio = await hasActiveAudioSession(processId);
					console.log(`[AUDIO] Process ${win.process} (PID: ${processId}) has active audio session: ${hasAudio}`);
					await muteWindowAudio(win.hwnd).catch(error => {
						console.error('[AUDIO] Error muting window audio during hide:', error);
					});
				}
			}
		} else {
			markTransitionWindow(trace, win.hwnd, win.process, 'already-hidden');
		}
	}, false, true);
	markTransitionStep(trace, 'sw-hide-done');
	const ret = await externalShowWindow(queue, false);
	markTransitionStep(trace, 'hung-queue-done');
	// Preserve any previously hidden windows so we don't "forget" them if hideWindows runs multiple times
	const previousHidden = Array.isArray(config.hiddenWindows) ? config.hiddenWindows : [];
	config.hiddenWindows = [...new Set([...previousHidden, ...queue, ...hidden])];
	console.log(`[SYSTEM] hideWindows: hidden=${hidden.length} elevated=${elevated.length} queue=${queue.length} config.hiddenWindows=${config.hiddenWindows.length}`);
	markTransitionStep(trace, 'bookkeeping-done');
	if (ownsTrace) logTransitionTrace(trace);
	// Janelas que não puderam ser ocultadas (processo elevado) são retornadas
	// para o main process tentar via helper elevado (fix 1.1.2).
	return { elevated, trace };
}

async function hideSpecificWindow(hwndStr, trace = null) {
	console.log(`[SYSTEM] Hiding specific window with HWND: ${hwndStr}`);
	if (!isValidWindow(hwndStr)) {
		// Auxiliary windows (IME/DDE/GDI+/owned helpers) are not targets: hiding
		// or tracking them would later make the restore path show them.
		console.warn(`[SYSTEM] Refusing to hide non-target window ${hwndStr}`);
		markTransitionWindow(trace, hwndStr, '', 'skipped-non-target');
		return { success: false, message: 'Window is not a hideable target', code: 'WINDOW_NOT_TARGET' };
	}
	if (xsystem.isZeroAreaWindow(hwndStr)) {
		// Nothing to hide and nothing the user could ever have seen.
		console.warn(`[SYSTEM] Refusing to hide zero-area window ${hwndStr}`);
		markTransitionWindow(trace, hwndStr, '', 'skipped-zero-area');
		return { success: false, message: 'Window has no visible area', code: 'WINDOW_ZERO_AREA' };
	}
	const zOrderSnapshot = captureZOrderSnapshot();
	hiddenWindowZOrder.set(hwndStr, zOrderSnapshot.get(hwndStr) ?? Number.MAX_SAFE_INTEGER);
	
	if (!isWindowHidden(hwndStr)) {
		if (processManager.isHungAppWindow(hwndStr)) {
			console.log(`[SYSTEM] Window ${hwndStr} is hung, cannot hide`);
			markTransitionWindow(trace, hwndStr, '', 'queued-hung');
			return { success: false, message: 'Window is hung', code: 'WINDOW_HUNG' };
		} else {
			processManager.showWindow(hwndStr, WindowConstants.SW_HIDE);
			// Verificação real (fix 1.1.2): o retorno de ShowWindow indica o estado
			// ANTERIOR da janela, não o sucesso do hide. Checamos a visibilidade
			// após a chamada para detectar falhas (ex.: processo elevado).
			if (processManager.isWindowVisible(hwndStr)) {
				console.warn(`[SYSTEM] Window ${hwndStr} still visible after SW_HIDE — failed to hide`);
				markTransitionWindow(trace, hwndStr, '', 'elevated-pending');
				return {
					success: false,
					requiresElevation: true,
					code: 'ELEVATION_REQUIRED',
					message: 'Failed to hide target window. It may belong to an elevated process.'
				};
			}

			// Adicionar à lista de janelas ocultas se não estiver já
			if (!config.hiddenWindows.includes(hwndStr)) {
				config.hiddenWindows.push(hwndStr);
			}

			// Track hidden window for notification badge
			addHiddenWindow(hwndStr);

			// Mutar áudio se configurado
			if (config.muteWindows) {
				await muteWindowAudio(hwndStr).catch(error => {
					console.error('[AUDIO] Error muting specific window audio:', error);
				});
			}

			console.log(`[SYSTEM] Successfully hid window ${hwndStr}`);
			markTransitionWindow(trace, hwndStr, '', 'hidden');
			return { success: true };
		}
	} else {
		console.log(`[SYSTEM] Window ${hwndStr} is already hidden`);
		markTransitionWindow(trace, hwndStr, '', 'already-hidden');
		return { success: false, message: 'Window already hidden', code: 'ALREADY_HIDDEN' };
	}
}

async function markElevatedHidden(hwndStr) {
	// Bookkeeping de uma janela que foi ocultada pelo helper ELEVADO (o processo
	// normal não consegue ocultá-la). Chamado pelo main process após o
	// runElevatedAction('hide-window') ter sucesso (fix 1.1.2).
	try {
		if (!hwndStr || !processManager.isWindow(hwndStr)) {
			console.warn(`[SYSTEM] markElevatedHidden: invalid HWND ${hwndStr}`);
			return false;
		}
		if (!config.hiddenWindows.includes(hwndStr)) {
			config.hiddenWindows.push(hwndStr);
		}
		addHiddenWindow(hwndStr);
		if (config.muteWindows) {
			await muteWindowAudio(hwndStr).catch(error => {
				console.error('[AUDIO] Error muting elevated-hidden window audio:', error);
			});
		}
		console.log(`[SYSTEM] Marked elevated-hidden window ${hwndStr}`);
		return true;
	} catch (error) {
		console.error('[SYSTEM] Error marking elevated window hidden:', error);
		return false;
	}
}

async function showSpecificWindow(hwndStr) {
	console.log(`[SYSTEM] Showing specific window with HWND: ${hwndStr}`);
	try {
		if (!processManager.isWindow(hwndStr)) {
			console.log(`[SYSTEM] HWND ${hwndStr} is not a valid window`);
			return false;
		}
		// Restoring must apply to real targets only (never IME/tray/helper
		// windows), otherwise SW_SHOWNA reveals a window the user never saw.
		if (!isRestorableWindow(hwndStr)) {
			console.log(`[SYSTEM] HWND ${hwndStr} is not a restorable target window, refusing to show`);
			return false;
		}

		processManager.showWindow(hwndStr, WindowConstants.SW_SHOWNA);

		// Remove from hidden tracking lists
		config.hiddenWindows = config.hiddenWindows.filter(h => h !== hwndStr);
		removeHiddenWindow(hwndStr);

		// Unmute audio if configured
		if (config.muteWindows) {
			await unmuteWindowAudio(hwndStr).catch(error => {
				console.error('[AUDIO] Error unmuting specific window audio:', error);
			});
		}

		console.log(`[SYSTEM] Successfully showed window ${hwndStr}`);
		return true;
	} catch (error) {
		console.error('[SYSTEM] Error showing specific window:', error);
		return false;
	}
}

async function showWindows(trace = null) {
	const ownsTrace = !trace;
	if (ownsTrace) trace = createTransitionTrace('show', 'system');
	console.log('[SYSTEM] showWindows entry: config.hiddenWindows =', JSON.stringify(config.hiddenWindows));
	const queue = [];
	config.hiddenWindows.forEach(hwndStr => {
		// Only tracked windows that are still real targets: a stale entry must
		// never resurrect an auxiliary/hidden-by-itself window.
		if (isRestorableWindow(hwndStr)) {
			queue.push(hwndStr);
		} else {
			console.log(`[SYSTEM] Dropping non-restorable hwnd from tracking: ${hwndStr}`);
		}
	});
	config.hiddenWindows = [];
	
	// Passe de recuperação: só devolve à tela o que o SnapAway ocultou.
	// config.hiddenWindows (acima) cobre o que foi ocultado em sessões
	// anteriores, persistido em disco; aqui cobrimos o que foi ocultado nesta
	// sessão, inclusive via helper elevado (markElevatedHidden).
	// hwndOnly=true: considera apenas janelas com filtro EXPLÍCITO por hwnd.
	// Qualquer janela oculta que o SnapAway não ocultou (app escondido na
	// bandeja, auxiliar do sistema) permanece exatamente como está.
	await iterateWindows(win => {
		if (wasHiddenByUs(win.hwnd) && isWindowHidden(win.hwnd) && isRestorableWindow(win.hwnd)) {
			queue.push(win.hwnd);
		}
	}, true, false);

	const dedupedQueue = [...new Set(queue)].filter(hwndStr => processManager.isWindow(hwndStr));
	dedupedQueue.sort((a, b) => {
		const za = hiddenWindowZOrder.has(a) ? hiddenWindowZOrder.get(a) : Number.MAX_SAFE_INTEGER;
		const zb = hiddenWindowZOrder.has(b) ? hiddenWindowZOrder.get(b) : Number.MAX_SAFE_INTEGER;
		return zb - za;
	});

	const hasHiddenWindows = dedupedQueue.length > 0;
	
	// Desmutar o áudio de todas as janelas que serão exibidas apenas se a configuração estiver ativada
	if (config.muteWindows) {
		await Promise.all(dedupedQueue.map(hwndStr => unmuteWindowAudio(hwndStr).catch(error => {
			console.error('[AUDIO] Error unmuting window audio during show:', error);
		})));
	}

	await externalShowWindow(dedupedQueue, true);
	markTransitionStep(trace, 'sw-show-done');
	dedupedQueue.forEach(hwndStr => hiddenWindowZOrder.delete(hwndStr));

	// Janelas que continuam ocultas após SW_SHOWNA (processo elevado) não podem
	// ser restauradas por este processo não-elevado. Mantemos o rastreamento e
	// reportamos para o main process restaurá-las via helper elevado (fix 1.1.2).
	const stillHidden = dedupedQueue.filter(hwndStr => {
		return processManager.isWindow(hwndStr) && !processManager.isWindowVisible(hwndStr);
	});
	const stillHiddenSet = new Set(stillHidden);
	for (const hwndStr of dedupedQueue) {
		markTransitionWindow(trace, hwndStr, '', stillHiddenSet.has(hwndStr) ? 'still-hidden' : 'shown');
	}

	// Clear all hidden windows tracking quando mostrar todas as janelas
	clearHiddenWindows();

	// Re-track janelas que não puderam ser restauradas para não serem perdidas.
	if (stillHidden.length > 0) {
		stillHidden.forEach(hwndStr => {
			if (!config.hiddenWindows.includes(hwndStr)) {
				config.hiddenWindows.push(hwndStr);
			}
			addHiddenWindow(hwndStr);
		});
	}

	// Cleanup any stale hidden windows data after attempts to show windows
	cleanupOrphanedHiddenWindows();

	markTransitionStep(trace, 'bookkeeping-done');
	if (ownsTrace) logTransitionTrace(trace);
	return { hadHidden: hasHiddenWindows, stillHidden };
}

function updateConfig(newConfig) {
	try {
		if (newConfig && typeof newConfig === 'object') {
			Object.assign(config, newConfig);
		}

		if (!Array.isArray(config.hiddenWindows)) {
			config.hiddenWindows = [];
		}

		// Ensure system hidden windows tracking stays consistent
		cleanupOrphanedHiddenWindows();
	} catch (error) {
		console.error('[SYSTEM] Failed updating config:', error);
	}
}

function getProcessPIDsByName(processName) {
    return xsystem.getProcessPIDsByName(processName);
}

async function setProcessSchedulingPriority(above = false) {
    try {
            await xsystem.setProcessPriority(above);
                    return { success: true, message: 'Process priority updated via native API' };
                        } catch (error) {
                                return { success: false, message: `Failed to set process priority: ${error.message}` };
                                    }
                                    }
                                    
async function killProcess(processName) {
	try {
		const pids = await getProcessPIDsByName(processName);
		if (pids.length === 0) {
			return { success: false, message: `No processes found with name: ${processName}` };
		}

		const tasks = [];
		for (const pid of pids) {
			tasks.push(new Promise((resolve) => {
				try {
					process.kill(pid, 'SIGKILL');
					resolve({ pid, success: true, message: 'Process terminated' });
				} catch (e) {
					// ESRCH = process no longer exists (already terminated)
					if (e.code === 'ESRCH') {
						resolve({ pid, success: true, message: 'Process already terminated' });
					} else if (e.code === 'EPERM') {
						resolve({ pid, success: false, message: 'Access denied for target process', requiresElevation: true, code: 'EPERM' });
					} else {
						resolve({ pid, success: false, message: e.message });
					}
				}
			}));
		}

		const results = await Promise.all(tasks);
		const successful = results.filter(r => r.success).length;
		const failed = results.filter(r => !r.success).length;
		const requiresElevation = results.some(r => r.requiresElevation);

		return {
			success: successful > 0,
			requiresElevation,
			code: requiresElevation ? 'ELEVATION_REQUIRED' : (successful > 0 ? 'OK' : 'KILL_FAILED'),
			message: requiresElevation ? `Killed ${successful} process(es), ${failed} failed (elevation required for some targets)` : `Killed ${successful} process(es), ${failed} failed`,
			details: results
		};
	} catch (error) {
		console.error('[SYSTEM] Error killing process:', error);
		return { success: false, message: error.message };
	}
}

function iconFailure(process, src) {
	if(process.executable) {
		// Use native icon extractor with robust temp directory detection
		let tempDir;
		try {
			// Try multiple ways to get temp directory
			if (process && process.env) {
				tempDir = process.env.TEMP || process.env.TMP;
			}
			if (!tempDir && typeof os !== 'undefined') {
				tempDir = os.tmpdir();
			}
			if (!tempDir) {
				tempDir = '/tmp'; // fallback
			}
			tempDir = path.join(tempDir, 'SnapAway', 'icons');
		} catch (error) {
			console.error('[ICON] Error getting temp directory:', error);
			tempDir = path.join('/tmp', 'SnapAway', 'icons'); // ultimate fallback
		}
		
		iconExtractor.extractIcons([process.executable], tempDir).then(mappings => {
			let changed;
			for (const executable in mappings) {
				// Convert file path to icon:// protocol URL for CSP compatibility
				const iconUrl = 'icon://' + encodeURIComponent(mappings[executable]);
				if (icons[executable] === iconUrl) {
					continue;
				}
				icons[executable] = iconUrl;
				changed = true;
			}
			changed && events.emit('icon', icons);
		}).catch(e => {
			console.error('Error extracting icons:', e);
		});
	}
}

module.exports = {
	list,
	iconFailure,
	hideWindows,
	hideSpecificWindow,
	showSpecificWindow,
	showWindows,
	updateConfig,
	events,
	hiddenWindows: () => {
		return config.hiddenWindows
	},
	setProcessSchedulingPriority,
	killProcess,
	initializeAudio,
	initializeIconExtractor,
	cleanupAudio,
	getAudioCleanupStats,
	muteWindowAudio,
	unmuteWindowAudio,
	hasActiveAudioSession,
	cleanupOrphanedHiddenWindows,
	getHiddenWindowsCount: updateNotificationBadge,
	clearProcessedExecutablesCache,
	registerWindow,
	buildManagedFilterFromHwnd,
	getIconUrlForExecutable,
	resolveIconForExecutable,
	isWindowManaged,
	enableHideState,
	enableHideStateForSelected,
	markElevatedHidden,
	hasManagedWindows,
	...processManager
}