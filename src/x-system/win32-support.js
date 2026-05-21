const koffi = require('koffi');
const config = require('../config/config.js');
const path = require('path');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const shell32 = koffi.load('shell32.dll');
const psapi = koffi.load('psapi.dll');

const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
const HWND = koffi.alias('HWND', HANDLE);
const LPARAM = koffi.alias('LPARAM', 'int32');
const DWORD = koffi.alias('DWORD', 'uint32_t');

const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;
const PROCESS_SET_INFORMATION = 0x0200;
const MAX_PROCESS_ENTRIES = 4096;

const priorityMap = {
    high: 0x00008000, // ABOVE_NORMAL_PRIORITY_CLASS
    normal: 0x00000020 // NORMAL_PRIORITY_CLASS
};

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, LPARAM lParam)');

const functions = {
    FindWindowA: user32.func('HWND __stdcall FindWindowA(const char *lpClassName, const char *lpWindowName)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(HWND hWnd, int nCmdShow)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hWnd, _Out_ char16_t *lpString, int nMaxCount)'),
    IsWindow: user32.func('bool __stdcall IsWindow(HWND hWnd)'),
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, LPARAM lParam)'),
    OpenProcess: kernel32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, bool bInheritHandle, DWORD dwProcessId)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(HANDLE hObject)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, wchar_t *lpExeName, _Inout_ DWORD *lpdwSize)'),
    SetPriorityClass: kernel32.func('bool __stdcall SetPriorityClass(HANDLE hProcess, DWORD dwPriorityClass)'),
    EnumProcesses: psapi.func('bool __stdcall EnumProcesses(DWORD *lpidProcess, DWORD cb, DWORD *lpcbNeeded)'),
    GetWindowLongPtrW: user32.func('int64 __stdcall GetWindowLongPtrW(HWND hWnd, int nIndex)'),
    GetWindow: user32.func('HWND __stdcall GetWindow(HWND hWnd, int uCmd)'),
    GetWindowThreadProcessId: user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hWnd, _Out_ char16_t *lpClassName, int nMaxCount)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(HWND hWnd)')
};

const ShellExecuteA = shell32.func('int64 __stdcall ShellExecuteA(void* hwnd, const char* lpOperation, const char* lpFile, const char* lpParameters, const char* lpDirectory, int nShowCmd)');

const WindowConstants = {
    GWL_STYLE: -16,
    GW_OWNER: 4,
    WS_CHILD: 0x40000000,
    SW_HIDE: 0,
    SW_SHOW: 5,
    GW_HWNDFIRST: 0,
    GW_HWNDNEXT: 2
};

function isValidWindow(hwnd) {
    try {
        const style = Number(functions.GetWindowLongPtrW(hwnd, WindowConstants.GWL_STYLE));
        if (style & WindowConstants.WS_CHILD) return false;
        if (functions.GetWindow(hwnd, WindowConstants.GW_OWNER)) return false;
        const classNameBuffer = Buffer.alloc(256 * 2);
        functions.GetClassNameW(hwnd, classNameBuffer, classNameBuffer.length / 2);
        const className = classNameBuffer.toString('utf16le').replace(/\0/g, '');
        const blockedClasses = new Set([
            'Windows.Internal.Shell.TabProxyWindow',
            'Windows.UI.Core.CoreWindow',
            'Intermediate D3D Window',
            'Shell_TrayWnd',
            'Shell_SecondaryTrayWnd'
        ]);
        return !blockedClasses.has(className);
    } catch (error) {
        console.error('Window validation error:', error);
        return false;
    }
}

function isWindowHidden(hwnd) {
    return !functions.IsWindowVisible(hwnd) || (functions.GetWindowLongPtrW(hwnd, WindowConstants.GWL_STYLE) & WindowConstants.WS_CHILD) !== 0;
}

const strHwndCache = {};
function strHwnd(hwnd) {
    const str = koffi.address(hwnd).toString();
    strHwndCache[str] = hwnd;
    return str;
}

function originalHwnd(str) {
    return strHwndCache[str] || str;
}

async function list(serializable = false, hideSystemWindows = false) {
    const processes = [];
    const callback = koffi.register((hwnd, lParam) => {
        if (isValidWindow(hwnd)) {
            if (hideSystemWindows && isWindowHidden(hwnd)) {
                return true;
            }
            const executable = getExecutableFromHwnd(hwnd);
            const process = executable ? path.basename(executable) : null;
            if (!process) return true;

            const hwndStr = koffi.address(hwnd).toString();
            const buffer = Buffer.alloc(256 * 2);
            const length = functions.GetWindowTextW(hwnd, buffer, buffer.length / 2);
            const title = buffer.toString('utf16le', 0, length * 2).replace(/\0+$/, '');
            const classNameBuffer = Buffer.alloc(256 * 2);
            functions.GetClassNameW(hwnd, classNameBuffer, classNameBuffer.length / 2);
            const className = classNameBuffer.toString('utf16le').replace(/\0/g, '');

            processes.push({
                hwnd: serializable ? hwndStr : hwnd,
                process,
                title,
                className
            });
        }
        return true;
    }, koffi.pointer(EnumWindowsProc));

    functions.EnumWindows(callback, 0);
    koffi.unregister(callback);
    return processes;
}

function getExecutableFromHwnd(hwnd) {
    let pidHolder = [null];
    const threadId = functions.GetWindowThreadProcessId(hwnd, pidHolder);
    if (!threadId) return null;
    const processId = pidHolder[0];

    const hProcess = functions.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, processId);
    if (!hProcess) return null;

    const bufferSize = 1024;
    const buffer = Buffer.alloc(bufferSize * 2);
    let sizeHolder = [bufferSize];
    const success = functions.QueryFullProcessImageNameW(hProcess, 0, buffer, sizeHolder);
    if (!success) return null;

    const actualSize = sizeHolder[0];
    return buffer.toString('utf16le', 0, actualSize * 2);
}

async function hideWindows() {
    const windows = await list();
    windows.forEach(win => {
        if (!isWindowHidden(win.hwnd)) {
            config.hiddenWindows.push(strHwnd(win.hwnd));
            functions.ShowWindow(win.hwnd, WindowConstants.SW_HIDE);
        }
    });
    config.hiddenWindows = config.hiddenWindows;
}

async function showWindows() {
    config.hiddenWindows.forEach(hwnd => functions.ShowWindow(originalHwnd(hwnd), WindowConstants.SW_SHOW));
    config.hiddenWindows.length = 0;
    const windows = await list();
    windows.forEach(win => {
        if (isWindowHidden(win.hwnd)) {
            functions.ShowWindow(win.hwnd, WindowConstants.SW_SHOW);
        }
    });
}

function getProcessPIDsByName(processName) {
    const normalizedName = processName.toLowerCase().endsWith('.exe') ? processName.slice(0, -4) : processName;
    return new Promise((resolve, reject) => {
        try {
            const pidsBuffer = Buffer.alloc(MAX_PROCESS_ENTRIES * 4);
            const needed = [0];
            const success = functions.EnumProcesses(pidsBuffer, pidsBuffer.length, needed);
            if (!success) {
                reject(new Error('EnumProcesses falhou'));
                return;
            }

            const count = needed[0] / 4;
            const pids = [];

            for (let i = 0; i < count; i += 1) {
                const pid = pidsBuffer.readUInt32LE(i * 4);
                if (!pid) continue;

                const hProcess = functions.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
                if (!hProcess) continue;

                try {
                    const buffer = Buffer.alloc(1024 * 2);
                    const sizeHolder = [1024];

                    if (!functions.QueryFullProcessImageNameW(hProcess, 0, buffer, sizeHolder)) {
                        continue;
                    }

                    const exePath = buffer.toString('utf16le', 0, sizeHolder[0] * 2).replace(/\0+$/, '');
                    const baseName = path.basename(exePath).toLowerCase();
                    if (baseName === normalizedName || baseName === `${normalizedName}.exe`) {
                        pids.push(pid);
                    }
                } finally {
                    functions.CloseHandle(hProcess);
                }
            }

            resolve(pids);
        } catch (error) {
            reject(new Error(`Erro ao enumerar processos: ${error.message}`));
        }
    });
}

async function setProcessPriority(above = false) {
    const pids = await getProcessPIDsByName(path.basename(process.execPath));
    if (pids.length === 0) return;
    const priorityClass = above ? priorityMap.high : priorityMap.normal;

    await Promise.all(pids.map(async pid => {
        const hProcess = functions.OpenProcess(PROCESS_SET_INFORMATION, false, pid);
        if (!hProcess) return;

        try {
            const setResult = functions.SetPriorityClass(hProcess, priorityClass);
            if (!setResult) {
                console.warn(`Falha ao definir prioridade para PID ${pid}`);
            }
        } finally {
            functions.CloseHandle(hProcess);
        }
    }));
}

function runAsAdmin(executablePath, args = [], workingDirectory = '') {
    const quotedArgs = args.map(arg => `"${String(arg).replace(/"/g, '\\"')}"`).join(' ');
    const result = ShellExecuteA(null, 'runas', executablePath, quotedArgs, workingDirectory || '', WindowConstants.SW_HIDE);

    if (result <= 32) {
        throw new Error(`Falha ShellExecuteA para iniciar ${executablePath} (código ${result})`);
    }

    return result;
}

module.exports = {
    list,
    hideWindows,
    showWindows,
    getProcessPIDsByName,
    setProcessPriority,
    runAsAdmin
};