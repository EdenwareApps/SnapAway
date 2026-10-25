// Diagnostic: enumerate every top-level window owned by a process (default:
// Spotify.exe) and report the structural facts SnapAway's eligibility rules
// rely on, so we can see exactly which secondary window gets resurrected.
//
// Usage: node scripts/diag-spotify-windows.js [processNameFragment]

const koffi = require('koffi');
const { evaluateWindowEligibility, CODES } = require('../src/shared/window-eligibility');

const fragment = (process.argv[2] || 'spotify').toLowerCase();

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
const HWND = koffi.alias('HWND', HANDLE);
const LPARAM = koffi.alias('LPARAM', 'int32');
const DWORD = koffi.alias('DWORD', 'uint32_t');
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, LPARAM lParam)');

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, LPARAM lParam)');
const IsWindow = user32.func('bool __stdcall IsWindow(HWND hWnd)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(HWND hWnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hWnd, _Out_ char16_t *lpString, int nMaxCount)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hWnd, _Out_ char16_t *lpClassName, int nMaxCount)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HWND hWnd, void *lpRect)');
const GetWindowLongPtrW = user32.func('int64 __stdcall GetWindowLongPtrW(HWND hWnd, int nIndex)');
const GetWindow = user32.func('HWND __stdcall GetWindow(HWND hWnd, int uCmd)');
const GetWindowThreadProcessId = user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)');
const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, DWORD dwAttribute, _Out_ void *pvAttribute, DWORD cbAttribute)');
const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, bool bInheritHandle, DWORD dwProcessId)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, char16_t *lpExeName, _Inout_ DWORD *lpdwSize)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE hObject)');

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const WS_EX_NOACTIVATE = 0x08000000;
const GW_OWNER = 4;
const DWMWA_CLOAKED = 14;

function text(fn, hwnd) {
    const buffer = Buffer.alloc(512 * 2);
    const length = fn(hwnd, buffer, 512);
    return buffer.toString('utf16le', 0, length * 2).replace(/\0+$/, '');
}

function rect(hwnd) {
    const buffer = Buffer.alloc(16);
    if (!GetWindowRect(hwnd, buffer)) return null;
    const left = buffer.readInt32LE(0), top = buffer.readInt32LE(4);
    const right = buffer.readInt32LE(8), bottom = buffer.readInt32LE(12);
    return { w: right - left, h: bottom - top };
}

function cloaked(hwnd) {
    const buffer = Buffer.alloc(4);
    if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, buffer, 4) !== 0) return null;
    return buffer.readInt32LE(0) !== 0;
}

function pidToExe(pid) {
    const handle = OpenProcess(0x1000, false, pid);
    if (!handle) return '';
    try {
        const buffer = Buffer.alloc(1024 * 2);
        const size = [1024];
        if (!QueryFullProcessImageNameW(handle, 0, buffer, size)) return '';
        return buffer.toString('utf16le', 0, size[0] * 2);
    } finally {
        CloseHandle(handle);
    }
}

const rows = [];
const callback = koffi.register((hwnd) => {
    const pidBuffer = Buffer.alloc(4);
    GetWindowThreadProcessId(hwnd, pidBuffer);
    const pid = pidBuffer.readUInt32LE(0);
    if (!pid) return true;

    const exeName = pidToExe(pid).split(/[\\/]/).pop() || '';
    if (!exeName.toLowerCase().includes(fragment)) return true;

    const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) || 0;
    const exStyle = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) || 0;
    const owner = GetWindow(hwnd, GW_OWNER);
    const r = rect(hwnd);

    rows.push({
        ptr: hwnd,
        hwnd: koffi.address(hwnd).toString(),
        pid,
        className: text(GetClassNameW, hwnd),
        title: text(GetWindowTextW, hwnd),
        visible: IsWindowVisible(hwnd),
        iconic: IsIconic(hwnd),
        child: (style & WS_CHILD) !== 0,
        toolWindow: (exStyle & WS_EX_TOOLWINDOW) !== 0,
        appWindow: (exStyle & WS_EX_APPWINDOW) !== 0,
        noActivate: (exStyle & WS_EX_NOACTIVATE) !== 0,
        owned: !!owner,
        cloaked: cloaked(hwnd),
        w: r ? r.w : null,
        h: r ? r.h : null
    });
    return true;
}, koffi.pointer(EnumWindowsProc));

EnumWindows(callback, 0);
koffi.unregister(callback);

// Same decision the app uses (src/shared/window-eligibility.js), so the report
// shows what SnapAway would hide/restore instead of only raw Win32 facts.
const eligibilityApi = {
    isWindow: (hwnd) => IsWindow(hwnd),
    getStyle: (hwnd) => Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) || 0,
    getExStyle: (hwnd) => Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) || 0,
    getOwner: (hwnd) => GetWindow(hwnd, GW_OWNER),
    getClassName: (hwnd) => text(GetClassNameW, hwnd),
    processIdOf: (hwnd) => {
        const pidBuffer = Buffer.alloc(4);
        GetWindowThreadProcessId(hwnd, pidBuffer);
        return pidBuffer.readUInt32LE(0);
    },
    isVisible: (hwnd) => IsWindowVisible(hwnd),
    isCloaked: (hwnd) => cloaked(hwnd) === true,
    formatHwnd: (hwnd) => koffi.address(hwnd).toString()
};

// Mirrors system.js#isRestorableWindow: eligible AND something to show.
function decisionFor(hwnd, row) {
    const result = evaluateWindowEligibility(eligibilityApi, hwnd);
    if (!result.eligible) return result.code;
    if (!row.iconic && (row.w <= 0 || row.h <= 0)) return 'IGNORE_ZERO_AREA';
    return CODES.TARGET;
}

console.log(`\n=== ${rows.length} window(s) for process "${fragment}" ===`);
for (const row of rows) {
    const flags = [
        row.visible ? 'VISIBLE' : 'hidden',
        row.child ? 'CHILD' : 'top-level',
        row.owned ? 'OWNED' : 'unowned',
        `tool=${row.toolWindow}`,
        `app=${row.appWindow}`,
        `noact=${row.noActivate}`,
        `cloaked=${row.cloaked}`,
        `size=${row.w}x${row.h}`,
        row.iconic ? 'MINIMIZED' : ''
    ].filter(Boolean).join(' ');
    console.log(`${row.hwnd} | ${flags}`);
    console.log(`    class="${row.className}" title="${row.title}"`);
    console.log(`    snapaway=${decisionFor(row.ptr, row)}`);
}
