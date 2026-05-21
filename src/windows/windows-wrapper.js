const path = require('path');

class WindowsManager {
    constructor() {
        this.addon = null;
        this.isAvailable = false;
        this.loadAddon();
    }

    loadAddon() {
        try {
            // Try multiple possible paths for the addon
            const possiblePaths = [
                path.join(__dirname, 'build', 'Release', 'windows_addon.node'),
                path.join(__dirname, 'build', 'Debug', 'windows_addon.node'),
                path.join(__dirname, 'dist', 'windows_addon.node'),
                path.join(__dirname, '..', '..', 'dist', 'windows_addon.node'),
                path.join(process.cwd(), 'dist', 'windows_addon.node'),
                // ASAR unpacked paths
                path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'windows', 'build', 'Release', 'windows_addon.node'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'windows', 'build', 'Debug', 'windows_addon.node')
            ];

            for (const addonPath of possiblePaths) {
                try {
                    this.addon = require(addonPath);
                    this.isAvailable = true;
                    console.log('[WINDOWS] Native windows addon loaded from:', addonPath);
                    break;
                } catch (e) {
                    // Continue to next path
                }
            }

            if (!this.isAvailable) {
                throw new Error('Windows addon not found in any of the expected locations');
            }

            console.log('[WINDOWS] Native windows addon loaded successfully');
        } catch (error) {
            console.log('[WINDOWS] Native windows addon not available:', error.message);
            this.isAvailable = false;
        }
    }

    // Window management methods
    findWindow(className, windowName) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for findWindow');
            return null;
        }
        return this.addon.findWindow(className, windowName);
    }

    showWindow(hwnd, nCmdShow) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for showWindow');
            return false;
        }
        return this.addon.showWindow(hwnd, nCmdShow);
    }

    hideWindow(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for hideWindow');
            return false;
        }
        return this.addon.hideWindow(hwnd);
    }

    getWindowText(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for getWindowText');
            return '';
        }
        return this.addon.getWindowText(hwnd);
    }

    isWindow(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for isWindow');
            return false;
        }
        return this.addon.isWindow(hwnd);
    }

    isWindowVisible(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for isWindowVisible');
            return false;
        }
        return this.addon.isWindowVisible(hwnd);
    }

    isHungAppWindow(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for isHungAppWindow');
            return false;
        }
        return this.addon.isHungAppWindow(hwnd);
    }

    getWindowThreadProcessId(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for getWindowThreadProcessId');
            return { processId: 0, threadId: 0 };
        }
        return this.addon.getWindowThreadProcessId(hwnd);
    }

    getClassName(hwnd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for getClassName');
            return '';
        }
        return this.addon.getClassName(hwnd);
    }

    getWindowLongPtr(hwnd, nIndex) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for getWindowLongPtr');
            return 0;
        }
        return this.addon.getWindowLongPtr(hwnd, nIndex);
    }

    getWindow(hwnd, uCmd) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for getWindow');
            return null;
        }
        return this.addon.getWindow(hwnd, uCmd);
    }

    enumWindows(callback) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for enumWindows');
            return [];
        }
        return this.addon.enumWindows(callback);
    }

    openProcess(dwDesiredAccess, bInheritHandle, dwProcessId) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for openProcess');
            return null;
        }
        return this.addon.openProcess(dwDesiredAccess, bInheritHandle, dwProcessId);
    }

    queryFullProcessImageName(hProcess, dwFlags) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for queryFullProcessImageName');
            return '';
        }
        return this.addon.queryFullProcessImageName(hProcess, dwFlags);
    }

    closeHandle(hObject) {
        if (!this.isAvailable) {
            console.log('[WINDOWS] Native addon not available for closeHandle');
            return false;
        }
        return this.addon.closeHandle(hObject);
    }

    // Utility methods for HWND conversion
    hwndToString(hwnd) {
        if (typeof hwnd === 'string') {
            return hwnd;
        }
        if (hwnd && typeof hwnd === 'object' && hwnd.address) {
            return hwnd.address().toString();
        }
        return hwnd ? hwnd.toString() : '';
    }

    stringToHwnd(hwndStr) {
        if (!hwndStr) return null;
        return hwndStr;
    }
}

module.exports = WindowsManager; 