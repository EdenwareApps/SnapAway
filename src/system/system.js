const path = require('path');
const config = require('../config/config.js');
const xsystem = require('../x-system/win32-support.js');
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
	GW_OWNER: 4,
	WS_CHILD: 0x40000000,
	SW_HIDE: 0,
	SW_SHOW: 5,
	SW_MINIMIZE: 6,
	GW_HWNDFIRST: 0,    // Adicione
	GW_HWNDNEXT: 2      // Adicione
}

// Track hidden windows for notification badge
let hiddenWindowsCount = 0;
let hiddenWindowsSet = new Set();

// Native audio controller instance
const nativeAudioController = new NativeAudioController();

// Native icon extractor instance
const iconExtractor = new IconExtractorWrapper();

// Native process manager instance
const processManager = new ProcessManagerWrapper();

// Cache for processed executables to avoid repeated icon extraction
const processedExecutables = new Set();

// Function to clear the processed executables cache (useful for testing or when icons need to be refreshed)
function clearProcessedExecutablesCache() {
    processedExecutables.clear();
    console.log('[ICONS] Cleared processed executables cache');
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
	show = WindowConstants[show === true ? 'SW_SHOW' : 'SW_HIDE'];
	const hungWindows = windows.filter(hwndStr => {
		if(processManager.isHungAppWindow(hwndStr)) return true;
		processManager.showWindow(hwndStr, show);
		return false;
	});
	console.log('!!! externalShowWindow hungWindows', hungWindows);
	if(hungWindows.length == 0) return;

    const content = `
        const { parentPort } = require('worker_threads');
        const ProcessManagerWrapper = require('../process/process-wrapper.js');
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

function isValidWindow(hwndStr) {
	try {
		// Verificar estilo da janela
		const style = Number(processManager.getWindowLongPtr(hwndStr, WindowConstants.GWL_STYLE));
		if (style & WindowConstants.WS_CHILD) return false;

		// Verificar janela proprietária
		if (processManager.getWindow(hwndStr, WindowConstants.GW_OWNER)) return false;

		// Verificar classe da janela
		const className = processManager.getClassName(hwndStr);

		const blockedClasses = new Set([
			'Windows.Internal.Shell.TabProxyWindow',
			'Windows.UI.Core.CoreWindow',            // Janelas UWP
			'Intermediate D3D Window',               // Janelas gráficas
			'Shell_TrayWnd',                         // Barra de tarefas
			'Shell_SecondaryTrayWnd'                 // Barra de tarefas secundária
		]);
		return !blockedClasses.has(className);
	} catch (error) {
		console.error('Window validation error:', error);
		return false;
	}
}

function isFilteredWindow(hwndStr) {
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
		windowData = { hwnd: hwndStr, process, title, className };
	} catch (error) {
		// If we can't obtain window details, fallback to only matching by HWND
		windowData = { hwnd: hwndStr, process: '', title: '', className: '' };
	}

	return config.filters.some(filter => {
		if (filter.hwnd && hwndStr === filter.hwnd) {
			return true;
		}

		const compare = (a = '', b = '') => {
			if (filter.insensitive) {
				return a.toLowerCase().includes(b.toLowerCase());
			}
			return a.includes(b);
		};

		switch (filter.type) {
			case 'title':
				return windowData.title && compare(windowData.title, filter.value);
			case 'process':
				return windowData.process && compare(windowData.process, filter.value);
			case 'className':
				return windowData.className && compare(windowData.className, filter.value);
			default:
				return false;
		}
	});
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
		if (processManager.isWindow(hwndStr)) {
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

async function list(serializable = false, skipHiddenWindows = false) {
	const processes = [];
	const executables = [];
	
	// Use native process manager to enumerate windows
	const windows = processManager.enumWindows();
	
	for (const window of windows) {
		const hwndStr = window.hwnd;
		
		if (isValidWindow(hwndStr) || isFilteredWindow(hwndStr)) {
			// Sempre incluir janelas filtradas, mesmo quando estão ocultas
			// Isso permite que o app restaure janelas ocultas corretamente
			if (skipHiddenWindows && isWindowHidden(hwndStr) && !isFilteredWindow(hwndStr)) {
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
	windows.forEach(win => {
		const hwndStr = win.hwnd; // Already a string
		config.filters.some(filter => {
			if (hwndOnly && hwndStr != filter.hwnd) {
				return false;
			}
			const directMatch = filter.hwnd && hwndStr == filter.hwnd && win.process == filter.process;
			if (directMatch) {
				if (filter.type == 'title' && win.title != filter.title) {
					const index = config.filters.indexOf(filter);
					config.filters[index].title = filter.title = win.title || win.process;
				}
				callback(win);
				return true;
			}
			const compare = (a, b) => {
				if (filter.insensitive) {
					return a.toLowerCase().includes(b.toLowerCase());
				}
				return a.includes(b);
			}
			switch (filter.type) {
				case 'title':
					if (win.title && compare(win.title, filter.value)) {
						callback(win);
						return true;
					}
					break;
				case 'className':
					if (win.className && compare(win.className, filter.value)) {
						callback(win);
						return true;
					}
					break;
				case 'process':
					if (win.process && compare(win.process, filter.value)) {
						callback(win);
						return true;
					}
					break;
			}
			return false;
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

async function cleanupAudio() {
	try {
		// Cleanup native audio controller
		await nativeAudioController.cleanup();
		console.log('[AUDIO] Audio cleanup completed');
		
		// Cleanup native icon extractor
		iconExtractor.cleanup();
		// console.log('[ICON-ADDON] Icon extractor cleanup completed');
	} catch (error) {
		console.error('[AUDIO] Error cleaning up audio:', error);
	}
}

async function muteWindowAudio(hwndStr) {
	try {
		console.log(`[AUDIO] config.muteWindows: ${config.muteWindows}`);
		if (!config.muteWindows) {
			console.log('[AUDIO] Audio muting disabled by config');
			return false;
		}
		
		// Use native audio controller
		if (nativeAudioController.isAvailable()) {
			const processInfo = processManager.getWindowThreadProcessId(hwndStr);
			if (!processInfo || !processInfo.processId) {
				console.error('[AUDIO] Invalid process ID for HWND:', hwndStr);
				return false;
			}
			return await nativeAudioController.muteProcess(processInfo.processId, true);
		}
		
		console.log('[AUDIO] Native audio controller not available');
		return false;
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
		
		// Use native audio controller
		if (nativeAudioController.isAvailable()) {
			const processInfo = processManager.getWindowThreadProcessId(hwndStr);
			if (!processInfo || !processInfo.processId) {
				console.error('[AUDIO] Invalid process ID for HWND:', hwndStr);
				return false;
			}
			return await nativeAudioController.muteProcess(processInfo.processId, false);
		}
		
		console.log('[AUDIO] Native audio controller not available');
		return false;
	} catch (error) {
		console.error('[AUDIO] Error unmuting window audio:', error);
		return false;
	}
}





async function hideWindows() {
	const queue = [], hidden = [];
	await iterateWindows(async (win) => {
		const processInfo = processManager.getWindowThreadProcessId(win.hwnd);
		console.log(`[AUDIO] Processing window: ${win.process} (HWND: ${win.hwnd}, PID: ${processInfo ? processInfo.processId : 'unknown'})`);

		// Não ocultar janelas da barra de tarefas ou outras classes de sistema
		// mesmo quando o processo (ex: explorer.exe) estiver nos filtros.
		const className = win.className || processManager.getClassName(win.hwnd) || '';
		const blockedClassesForHide = new Set([
			'Shell_TrayWnd',
			'Shell_SecondaryTrayWnd',
			'Windows.Internal.Shell.TabProxyWindow',
			'Windows.UI.Core.CoreWindow',
			'Intermediate D3D Window'
		]);
		if (blockedClassesForHide.has(className)) {
			console.log(`[SYSTEM] Skipping hide for system window: ${win.hwnd} class: ${className}`);
			return;
		}
		if (!isWindowHidden(win.hwnd)) {
			if (processManager.isHungAppWindow(win.hwnd)) {
				queue.push(win.hwnd);
			} else {
				processManager.showWindow(win.hwnd, WindowConstants.SW_HIDE);
				hidden.push(win.hwnd);
				addHiddenWindow(win.hwnd); // Track hidden window for notification badge
				if (config.muteWindows) {
					const processId = processInfo ? processInfo.processId : 0;
					const hasAudio = await hasActiveAudioSession(processId);
					console.log(`[AUDIO] Process ${win.process} (PID: ${processId}) has active audio session: ${hasAudio}`);
					await muteWindowAudio(win.hwnd).catch(error => {
						console.error('[AUDIO] Error muting window audio during hide:', error);
					});
				}
			}
		}
	}, false, true);
	const ret = await externalShowWindow(queue, false);
	// Preserve any previously hidden windows so we don't "forget" them if hideWindows runs multiple times
	const previousHidden = Array.isArray(config.hiddenWindows) ? config.hiddenWindows : [];
	config.hiddenWindows = [...new Set([...previousHidden, ...queue, ...hidden])];
	return ret;
}

async function hideSpecificWindow(hwndStr) {
	console.log(`[SYSTEM] Hiding specific window with HWND: ${hwndStr}`);
	
	if (!isWindowHidden(hwndStr)) {
		if (processManager.isHungAppWindow(hwndStr)) {
			console.log(`[SYSTEM] Window ${hwndStr} is hung, cannot hide`);
			return { success: false, message: 'Window is hung', code: 'WINDOW_HUNG' };
		} else {
			const hidden = processManager.showWindow(hwndStr, WindowConstants.SW_HIDE);
			if (!hidden) {
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
			return { success: true };
		}
	} else {
		console.log(`[SYSTEM] Window ${hwndStr} is already hidden`);
		return { success: false, message: 'Window already hidden', code: 'ALREADY_HIDDEN' };
	}
}

async function showSpecificWindow(hwndStr) {
	console.log(`[SYSTEM] Showing specific window with HWND: ${hwndStr}`);
	try {
		if (!processManager.isWindow(hwndStr)) {
			console.log(`[SYSTEM] HWND ${hwndStr} is not a valid window`);
			return false;
		}

		processManager.showWindow(hwndStr, WindowConstants.SW_SHOW);

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

async function showWindows() {
	const queue = [];
	config.hiddenWindows.forEach(hwndStr => {
		if (processManager.isWindow(hwndStr)) {
			queue.push(hwndStr);
		} else {
			console.log('Invalid hwnd', hwndStr);
		}
	});
	config.hiddenWindows = [];
	
	// Sempre procurar por janelas ocultas, independentemente da configuração hideSystemWindows
	// Isso garante que janelas filtradas sejam sempre restauradas
	await iterateWindows(win => {
		if (isWindowHidden(win.hwnd)) {
			queue.push(win.hwnd);
		}
	}, true, false);

	const hasHiddenWindows = queue.length > 0;
	
	// Desmutar o áudio de todas as janelas que serão exibidas apenas se a configuração estiver ativada
	if (config.muteWindows) {
		await Promise.all(queue.map(hwndStr => unmuteWindowAudio(hwndStr).catch(error => {
			console.error('[AUDIO] Error unmuting window audio during show:', error);
		})));
	}

	await externalShowWindow(queue, true);

	// Clear all hidden windows tracking quando mostrar todas as janelas
	clearHiddenWindows();

	// Cleanup any stale hidden windows data after attempts to show windows
	cleanupOrphanedHiddenWindows();

	return hasHiddenWindows;
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
	muteWindowAudio,
	unmuteWindowAudio,
	hasActiveAudioSession,
	cleanupOrphanedHiddenWindows,
	getHiddenWindowsCount: updateNotificationBadge,
	clearProcessedExecutablesCache,
	...processManager
}