const path = require('path');
const fs = require('fs');

class ProcessManagerWrapper {
    constructor() {
        this.addon = null;
        this.loadAddon();
    }

    loadAddon() {
        try {
            // Try multiple possible paths for the addon
            const appxPaths = process.resourcesPath ? [
                path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'process_addon.node'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'process', 'process_addon.node'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'process', 'build', 'Release', 'process_addon.node'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'process', 'build', 'Debug', 'process_addon.node')
            ] : [];

            const possiblePaths = [
                ...appxPaths,
                // Dev: wrapper copied to out/main/process, addon copied to out/main
                path.join(__dirname, '..', 'process_addon.node'),
                // Dev: original source location
                path.join(__dirname, 'build', 'Release', 'process_addon.node'),
                path.join(__dirname, 'build', 'Debug', 'process_addon.node'),
                // Dev: from workspace root
                path.join(process.cwd(), 'src', 'process', 'build', 'Release', 'process_addon.node'),
                path.join(process.cwd(), 'out', 'main', 'process_addon.node'),
                path.join(__dirname, 'dist', 'process_addon.node'),
                path.join(__dirname, '..', '..', 'dist', 'process_addon.node'),
                path.join(__dirname, 'process_addon.node'),
                path.join(process.cwd(), 'dist', 'process_addon.node')
            ];

            for (const addonPath of possiblePaths) {
                if (fs.existsSync(addonPath)) {
                    console.log('[PROCESS-ADDON] Loading from:', addonPath);
                    this.addon = require(addonPath);
                    break;
                }
            }

            if (!this.addon) {
                throw new Error('Process addon not found in any of the expected locations');
            }

            // Create instance
            this.processManager = new this.addon.ProcessManager();
            console.log('[PROCESS-ADDON] Successfully loaded process management addon');
        } catch (error) {
            console.error('[PROCESS-ADDON] Failed to load process addon:', error.stack || error);
            throw error;
        }
    }

    // Window enumeration
    enumWindows() {
        try {
            return this.processManager.enumWindows();
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in enumWindows:', error);
            return [];
        }
    }

    // Window visibility control
    showWindow(hwnd, nCmdShow) {
        try {
            return this.processManager.showWindow(hwnd, nCmdShow);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in showWindow:', error);
            return false;
        }
    }

    // Window validation
    isWindow(hwnd) {
        try {
            return this.processManager.isWindow(hwnd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in isWindow:', error);
            return false;
        }
    }

    isWindowVisible(hwnd) {
        try {
            return this.processManager.isWindowVisible(hwnd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in isWindowVisible:', error);
            return false;
        }
    }

    isHungAppWindow(hwnd) {
        try {
            return this.processManager.isHungAppWindow(hwnd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in isHungAppWindow:', error);
            return false;
        }
    }

    // Window information
    getWindowText(hwnd) {
        try {
            return this.processManager.getWindowText(hwnd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in getWindowText:', error);
            return '';
        }
    }

    getClassName(hwnd) {
        try {
            return this.processManager.getClassName(hwnd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in getClassName:', error);
            return '';
        }
    }

    getWindowThreadProcessId(hwnd) {
        try {
            return this.processManager.getWindowThreadProcessId(hwnd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in getWindowThreadProcessId:', error);
            return { threadId: 0, processId: 0 };
        }
    }

    getWindowLongPtr(hwnd, nIndex) {
        try {
            return this.processManager.getWindowLongPtr(hwnd, nIndex);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in getWindowLongPtr:', error);
            return 0;
        }
    }

    getWindow(hwnd, uCmd) {
        try {
            return this.processManager.getWindow(hwnd, uCmd);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in getWindow:', error);
            return null;
        }
    }

    // Process information
    getExecutablePath(processId) {
        try {
            return this.processManager.getExecutablePath(processId);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in getExecutablePath:', error);
            return '';
        }
    }

    openProcess(dwDesiredAccess, bInheritHandle, dwProcessId) {
        try {
            return this.processManager.openProcess(dwDesiredAccess, bInheritHandle, dwProcessId);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in openProcess:', error);
            return null;
        }
    }

    closeHandle(handle) {
        try {
            return this.processManager.closeHandle(handle);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in closeHandle:', error);
            return false;
        }
    }

    queryFullProcessImageName(handle, dwFlags) {
        try {
            return this.processManager.queryFullProcessImageName(handle, dwFlags);
        } catch (error) {
            console.error('[PROCESS-ADDON] Error in queryFullProcessImageName:', error);
            return '';
        }
    }
}

module.exports = ProcessManagerWrapper; 