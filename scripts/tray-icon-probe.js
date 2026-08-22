#!/usr/bin/env node
/**
 * Tray Icon Probe — Fase 1 (PoC read-only)
 * ---------------------------------------------------------------
 * Objetivo: validar empiricamente se conseguimos enumerar os ícones
 * da bandeja do sistema (notification area) do Windows e mapear
 * cada ícone ao seu processo (PID), SEM esconder nada.
 *
 * Técnica (não documentada, como descrito no relatório de pesquisa):
 *   Shell_TrayWnd -> TrayNotifyWnd -> [SysPager] -> ToolbarWindow32
 *   - TB_BUTTONCOUNT / TB_GETBUTTON via SendMessageW
 *   - TBBUTTON.dwData -> NOTIFYICONDATA (hWnd + uID) na memória do explorer
 *   - ReadProcessMemory no explorer.exe (somente leitura)
 *
 * Uso:
 *   node scripts/tray-icon-probe.js            # tabela de ícones x processo
 *   node scripts/tray-icon-probe.js --hierarchy  # dump da árvore de janelas
 *   node scripts/tray-icon-probe.js --json       # saída JSON
 *   node scripts/tray-icon-probe.js --pid <n>    # filtra por PID do processo
 *
 * Aviso: script de diagnóstico; não altera nenhum estado do sistema.
 */
'use strict';

let koffi = null;
try {
    koffi = require('koffi');
} catch (err) {
    console.error('[TRAY-PROBE] koffi não disponível. Rode `npm install` na raiz.');
    process.exit(2);
}

if (process.platform !== 'win32') {
    console.error('[TRAY-PROBE] Este probe é específico para Windows.');
    process.exit(2);
}

// ---------------------------------------------------------------------------
// Win32 bindings (koffi). hWnd é tratado como int64 cru (ABI-compatível) para
// aceitar endereços lidos da memória do explorer sem construir ponteiros.
// ---------------------------------------------------------------------------
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
const HWND = koffi.alias('HWND', HANDLE);
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, int64 lParam)');

const f = {
    // user32
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, int64 lParam)'),
    FindWindowExW: user32.func('HWND __stdcall FindWindowExW(int64 hWndParent, int64 hWndChildAfter, const char16_t *lpszClass, const char16_t *lpszWindow)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(int64 hWnd, _Out_ char16_t *lpClassName, int nMaxCount)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(int64 hWnd, _Out_ char16_t *lpString, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(int64 hWnd, _Out_ uint32_t *lpdwProcessId)'),
    IsWindow: user32.func('bool __stdcall IsWindow(int64 hWnd)'),
    SendMessageW: user32.func('int64 __stdcall SendMessageW(int64 hWnd, uint32_t Msg, int64 wParam, int64 lParam)'),
    // kernel32
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void * hObject)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError(void)'),
    VirtualAllocEx: kernel32.func('void * __stdcall VirtualAllocEx(void * hProcess, void * lpAddress, uint64_t dwSize, uint32_t flAllocationType, uint32_t flProtect)'),
    VirtualFreeEx: kernel32.func('bool __stdcall VirtualFreeEx(void * hProcess, void * lpAddress, uint64_t dwSize, uint32_t dwFreeType)'),
    ReadProcessMemory: kernel32.func('bool __stdcall ReadProcessMemory(void * hProcess, int64 lpBaseAddress, void * lpBuffer, uint64_t nSize, void * lpNumberOfBytesRead)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void * hProcess, uint32_t dwFlags, _Out_ char16_t * lpExeName, _Inout_ uint32_t * lpdwSize)')
};

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const WM_USER = 0x400;
const TB_BUTTONCOUNT = WM_USER + 24;    // 0x418
const TB_GETBUTTON = WM_USER + 23;      // 0x417
const TB_BUTTONSTRUCTSIZE = WM_USER + 30; // 0x41E

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;
const MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;
const PROCESS_VM_WRITE = 0x0020;
const PROCESS_VM_OPERATION = 0x0008;
// Direitos necessários para alocar/ler memória no explorer via VirtualAllocEx + ReadProcessMemory
const PROCESS_ACCESS_FOR_TRAY = PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION;

const TBBUTTON_SIZE_X64 = 32; // iBitmap(4)+idCommand(4)+fsState(1)+fsStyle(1)+bReserved(6)+dwData(8)+iString(8)
const TBBUTTON_SIZE_X86 = 20;
const TBBUTTON_DWDATA_OFFSET_X64 = 16;
const TBBUTTON_DWDATA_OFFSET_X86 = 12;
const NID_HEADER_SIZE = 16; // hWnd(8) + uID(4) + padding

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ptrToNum(p) {
    if (!p) return 0n;
    const a = koffi.address(p);
    return typeof a === 'bigint' ? a : BigInt(a);
}

function toNumber(v) {
    return typeof v === 'bigint' ? Number(v) : v;
}

function hex(v) {
    const n = typeof v === 'bigint' ? v : BigInt(v);
    return `0x${n.toString(16)}`;
}

function getClassNameOf(hwndNum) {
    try {
        const buf = Buffer.alloc(256 * 2);
        const n = f.GetClassNameW(hwndNum, buf, 256);
        return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
    } catch (_) {
        return '';
    }
}

function getWindowTextOf(hwndNum) {
    try {
        const buf = Buffer.alloc(256 * 2);
        const n = f.GetWindowTextW(hwndNum, buf, 256);
        return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
    } catch (_) {
        return '';
    }
}

function getPidOfHwnd(hwndNum) {
    try {
        const holder = [null];
        f.GetWindowThreadProcessId(hwndNum, holder);
        return holder[0] || 0;
    } catch (_) {
        return 0;
    }
}

function getProcessName(pid) {
    const h = f.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) return null;
    try {
        const size = 1024;
        const buf = Buffer.alloc(size * 2);
        const sizeHolder = [size];
        const ok = f.QueryFullProcessImageNameW(h, 0, buf, sizeHolder);
        if (!ok) return null;
        return buf.toString('utf16le', 0, sizeHolder[0] * 2);
    } catch (_) {
        return null;
    } finally {
        f.CloseHandle(h);
    }
}

// ---------------------------------------------------------------------------
// Enumeração de janelas
// ---------------------------------------------------------------------------
function findTrayWindows() {
    const results = [];
    const cb = koffi.register((hwnd, lParam) => {
        const h = ptrToNum(hwnd);
        const cls = getClassNameOf(h);
        if (cls === 'Shell_TrayWnd' || cls === 'Shell_SecondaryTrayWnd') {
            results.push({ hwnd: h, className: cls });
        }
        return true;
    }, koffi.pointer(EnumWindowsProc));
    try {
        const ok = f.EnumWindows(cb, 0);
        if (!ok) {
            console.error(`[TRAY-PROBE] EnumWindows retornou false (GetLastError=${f.GetLastError()})`);
        }
    } catch (err) {
        console.error('[TRAY-PROBE] EnumWindows lançou exceção:', err && err.message ? err.message : err);
    } finally {
        koffi.unregister(cb);
    }
    return results;
}

// Percorre recursivamente todos os descendentes de um HWND (FindWindowExW).
function walkChildren(parentNum, onNode) {
    let prev = 0n;
    for (;;) {
        const child = f.FindWindowExW(parentNum, prev, null, null);
        if (!child) break;
        const h = ptrToNum(child);
        onNode(h);
        prev = h;
    }
}

function collectTree(trayWin) {
    const tree = [];
    const visit = (hwndNum, depth, chain) => {
        const cls = getClassNameOf(hwndNum);
        const text = getWindowTextOf(hwndNum);
        tree.push({ hwnd: hwndNum, depth, className: cls, text, chain });
        const childChain = [...chain, cls];
        walkChildren(hwndNum, (child) => visit(child, depth + 1, childChain));
    };
    visit(trayWin.hwnd, 0, [trayWin.className]);
    return tree;
}

function findTrayToolbars(trayWin) {
    const toolbars = [];
    const visit = (hwndNum, chain) => {
        const cls = getClassNameOf(hwndNum);
        if (cls === 'ToolbarWindow32') {
            toolbars.push({ hwnd: hwndNum, text: getWindowTextOf(hwndNum), chain });
        }
        const childChain = [...chain, cls];
        walkChildren(hwndNum, (child) => visit(child, childChain));
    };
    walkChildren(trayWin.hwnd, (child) => visit(child, [trayWin.className]));
    return toolbars;
}

// ---------------------------------------------------------------------------
// Leitura dos botões (TBBUTTON) e NOTIFYICONDATA no explorer
// ---------------------------------------------------------------------------
function enumerateToolbar(tb, ownerPid) {
    const count = toNumber(f.SendMessageW(tb.hwnd, TB_BUTTONCOUNT, 0, 0)) || 0;
    const reported = toNumber(f.SendMessageW(tb.hwnd, TB_BUTTONSTRUCTSIZE, 0, 0)) || 0;
    const hProc = f.OpenProcess(PROCESS_ACCESS_FOR_TRAY, false, ownerPid);
    if (!hProc) {
        return { count, btnStructSize: reported, error: `OpenProcess falhou (PID ${ownerPid}) GetLastError=${f.GetLastError()} — explorer elevado?` };
    }

    const buttons = [];
    let readFailures = 0;
    try {
        // Tamanho do TBBUTTON esperado pela toolbar (x64 = 32).
        const isX64Layout = (reported === 0 ? TBBUTTON_SIZE_X64 : reported) >= 24;
        const btnSize = isX64Layout ? TBBUTTON_SIZE_X64 : TBBUTTON_SIZE_X86;
        const dwDataOffset = isX64Layout ? TBBUTTON_DWDATA_OFFSET_X64 : TBBUTTON_DWDATA_OFFSET_X86;

        const remote = f.VirtualAllocEx(hProc, null, btnSize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (!remote) {
            return { count, btnStructSize: reported, error: `VirtualAllocEx falhou no explorer GetLastError=${f.GetLastError()}` };
        }
        const remoteAddr = ptrToNum(remote);
        const local = Buffer.alloc(btnSize);

        for (let i = 0; i < count; i++) {
            const entry = { index: i };
            try {
                const sent = toNumber(f.SendMessageW(tb.hwnd, TB_GETBUTTON, i, remoteAddr));
                if (!sent) {
                    entry.error = 'TB_GETBUTTON retornou 0 (sem botão?)';
                    buttons.push(entry);
                    continue;
                }
                local.fill(0);
                const ok = f.ReadProcessMemory(hProc, remoteAddr, local, btnSize, null);
                if (!ok) {
                    readFailures++;
                    entry.error = 'ReadProcessMemory falhou';
                    buttons.push(entry);
                    continue;
                }
                entry.idCommand = local.readInt32LE(4);
                entry.fsState = local.readUInt8(8);
                entry.fsStyle = local.readUInt8(9);
                entry.dwData = local.readBigUInt64LE(dwDataOffset);
            } catch (e) {
                entry.error = e.message;
            }
            buttons.push(entry);
        }

        try {
            f.VirtualFreeEx(hProc, remote, 0, MEM_RELEASE);
        } catch (_) {}
    } finally {
        f.CloseHandle(hProc);
    }
    return { count, btnStructSize: reported, buttons, readFailures };
}

function readNidHeader(hProc, dwDataAddr) {
    const local = Buffer.alloc(NID_HEADER_SIZE);
    const ok = f.ReadProcessMemory(hProc, dwDataAddr, local, NID_HEADER_SIZE, null);
    if (!ok) return null;
    return {
        hWnd: local.readBigUInt64LE(0),
        uID: local.readUInt32LE(8)
    };
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
function buildReport(trayWin, includeChain) {
    const ownerPid = getPidOfHwnd(trayWin.hwnd);
    const toolbars = findTrayToolbars(trayWin);
    const toolbarResults = new Map();
    const icons = [];

    for (const tb of toolbars) {
        const res = enumerateToolbar(tb, ownerPid);
        toolbarResults.set(tb.hwnd, res);
        for (const btn of (res.buttons || [])) {
            if (btn.error) {
                icons.push({ tb, index: btn.index, error: btn.error });
                continue;
            }
            if (!btn.dwData) continue; // botão sem dados de ícone
            const hProc = f.OpenProcess(PROCESS_ACCESS_FOR_TRAY, false, ownerPid);
            if (!hProc) {
                icons.push({ tb, index: btn.index, error: `OpenProcess falhou ao ler NID GetLastError=${f.GetLastError()}` });
                continue;
            }
            let nid = null;
            try {
                nid = readNidHeader(hProc, btn.dwData);
            } catch (e) {
                nid = { error: e.message };
            } finally {
                f.CloseHandle(hProc);
            }

            if (!nid || nid.error || !nid.hWnd) {
                icons.push({ tb, index: btn.index, idCommand: btn.idCommand, error: nid ? (nid.error || 'hWnd inválido') : 'NID ilegível' });
                continue;
            }

            const hwndNum = toNumber(nid.hWnd);
            const valid = !!f.IsWindow(hwndNum);
            const pid = valid ? getPidOfHwnd(hwndNum) : 0;
            icons.push({
                tb,
                index: btn.index,
                idCommand: btn.idCommand,
                hWnd: nid.hWnd,
                uID: nid.uID,
                validWindow: valid,
                pid,
                process: pid ? getProcessName(pid) : null,
                windowClass: valid ? getClassNameOf(hwndNum) : null,
                windowTitle: valid ? getWindowTextOf(hwndNum) : null
            });
        }
    }

    return {
        trayWindow: trayWin.className,
        trayHwnd: trayWin.hwnd,
        ownerPid,
        toolbars: toolbars.map((t) => ({ hwnd: t.hwnd, text: t.text, chain: includeChain ? t.chain : undefined })),
        toolbarStats: toolbars.map((t) => {
            const res = toolbarResults.get(t.hwnd) || {};
            return { text: t.text, hwnd: t.hwnd, count: res.count, btnStructSize: res.btnStructSize, readFailures: res.readFailures, error: res.error };
        }),
        icons
    };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const wantHierarchy = args.includes('--hierarchy');
const wantJson = args.includes('--json');
const wantDebug = args.includes('--debug');
const pidFilter = (() => {
    const i = args.indexOf('--pid');
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 0;
})();

function printTree(tree) {
    for (const node of tree) {
        const pad = '  '.repeat(node.depth);
        const cls = node.className || '?';
        const text = node.text ? ` "${node.text}"` : '';
        console.log(`${pad}${cls}${text}  [${hex(node.hwnd)}]`);
    }
}

function printReport(report) {
    const osVersion = process.getSystemVersion
        ? process.getSystemVersion()
        : require('os').release();
    console.log('┌────────────────────────────────────────────────────────────────────┐');
    console.log('│  TRAY ICON PROBE — enumeração da bandeja (read-only)             │');
    console.log('└────────────────────────────────────────────────────────────────────┘');
    console.log(`Windows: ${osVersion}  (arch=${process.arch})`);
    console.log(`Janela: ${report.trayWindow}  [${hex(report.trayHwnd)}]  owner PID: ${report.ownerPid}`);
    console.log(`Toolbars encontradas: ${report.toolbars.length}`);
    for (const tb of report.toolbars) {
        console.log(`  - Toolbar [${hex(tb.hwnd)}] "${tb.text || '(sem nome)'}"${tb.chain ? `  (caminho: ${tb.chain.join(' > ')})` : ''}`);
    }
    console.log('  -- stats por toolbar --');
    for (const st of (report.toolbarStats || [])) {
        const err = st.error ? ` | ERRO: ${st.error}` : '';
        console.log(`  - "${st.text || '(sem nome)'}" count=${st.count} TB_BUTTONSTRUCTSIZE=${st.btnStructSize} readFailures=${st.readFailures || 0}${err}`);
    }
    console.log('');
    console.log('Ícones → processo:');
    let shown = 0;
    for (const ic of report.icons) {
        if (pidFilter && ic.pid !== pidFilter) continue;
        shown++;
        const tbName = ic.tb && ic.tb.text ? ic.tb.text : '?';
        const proc = ic.process ? ic.process.split('\\').pop() : '';
        if (ic.error) {
            console.log(`  [!] idx=${ic.index} toolbar="${tbName}" erro=${ic.error}`);
            continue;
        }
        const valid = ic.validWindow ? 'OK' : 'INVÁLIDO';
        const cls = ic.windowClass ? ` cls="${ic.windowClass}"` : '';
        const title = ic.windowTitle ? ` title="${ic.windowTitle.slice(0, 40)}"` : '';
        console.log(
            `  [${String(ic.index).padStart(3)}] cmd=${hex(ic.idCommand || 0)} ` +
            `hWnd=${hex(ic.hWnd)} uID=${ic.uID} PID=${ic.pid} ${proc} ${valid}${cls}${title}`
        );
    }
    console.log('');
    console.log(`Total de botões com dados: ${report.icons.length} | exibidos: ${shown}`);
    console.log('');
    console.log('Dica: se nenhum ícone aparecer, o explorer pode estar elevado (rode como admin)');
    console.log('ou a estrutura Win11 mudou (use --hierarchy para inspecionar).');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function debugProbe(trayWin) {
    const ownerPid = getPidOfHwnd(trayWin.hwnd);
    console.log(`\n=== DEBUG ${trayWin.className} [${hex(trayWin.hwnd)}] ownerPID=${ownerPid} (${getProcessName(ownerPid)}) ===`);
    const toolbars = findTrayToolbars(trayWin);
    for (const tb of toolbars) {
        const isWin = !!f.IsWindow(tb.hwnd);
        const countRaw = f.SendMessageW(tb.hwnd, TB_BUTTONCOUNT, 0, 0);
        const errCount = f.GetLastError();
        const structRaw = f.SendMessageW(tb.hwnd, TB_BUTTONSTRUCTSIZE, 0, 0);
        const errStruct = f.GetLastError();
        const textLen = f.SendMessageW(tb.hwnd, 0x000E, 0, 0); // WM_GETTEXTLENGTH
        const errText = f.GetLastError();
        console.log(`Toolbar [${hex(tb.hwnd)}] "${tb.text || ''}" IsWindow=${isWin}`);
        console.log(`  TB_BUTTONCOUNT=0x418 -> ${countRaw} (GetLastError=${errCount})`);
        console.log(`  TB_BUTTONSTRUCTSIZE=0x41E -> ${structRaw} (GetLastError=${errStruct})`);
        console.log(`  WM_GETTEXTLENGTH=0xE -> ${textLen} (GetLastError=${errText})`);
    }
}

// Varre TODAS as ToolbarWindow32 do sistema para achar onde os ícones vivem no Win11.
function scanAllToolbars() {
    const found = [];
    const cb = koffi.register((hwnd, lParam) => {
        const top = ptrToNum(hwnd);
        const topClass = getClassNameOf(top);
        if (topClass === 'Shell_TrayWnd' || topClass === 'Shell_SecondaryTrayWnd' || topClass === 'NotifyIconOverflowWindow') {
            const visit = (h, chain) => {
                const cls = getClassNameOf(h);
                if (cls === 'ToolbarWindow32') {
                    found.push({ hwnd: h, top: topClass, text: getWindowTextOf(h), chain });
                }
                const childChain = [...chain, cls];
                walkChildren(h, (c) => visit(c, childChain));
            };
            walkChildren(top, (c) => visit(c, [topClass]));
        }
        return true;
    }, koffi.pointer(EnumWindowsProc));
    try {
        f.EnumWindows(cb, 0);
    } finally {
        koffi.unregister(cb);
    }

    console.log(`\n=== VARREDURA GLOBAL DE ToolbarWindow32 (${found.length}) ===`);
    for (const tb of found) {
        const countRaw = f.SendMessageW(tb.hwnd, TB_BUTTONCOUNT, 0, 0);
        const structRaw = f.SendMessageW(tb.hwnd, TB_BUTTONSTRUCTSIZE, 0, 0);
        console.log(`[${hex(tb.hwnd)}] top=${tb.top} "${tb.text || ''}" count=${countRaw} struct=${structRaw} path=${tb.chain.join(' > ')}`);
    }
}

function main() {
    const trayWindows = findTrayWindows();
    if (trayWindows.length === 0) {
        console.error('[TRAY-PROBE] Nenhuma janela Shell_TrayWnd encontrada.');
        process.exit(1);
    }

    if (wantHierarchy) {
        for (const tw of trayWindows) {
            console.log(`\n=== Árvore de ${tw.className} [${hex(tw.hwnd)}] ===`);
            printTree(collectTree(tw));
        }
    }

    if (wantDebug) {
        for (const tw of trayWindows) {
            debugProbe(tw);
        }
        scanAllToolbars();
        return;
    }

    const reports = trayWindows.map((tw) => buildReport(tw, wantHierarchy));

    if (wantJson) {
        console.log(JSON.stringify(reports, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
        return;
    }

    for (const rep of reports) {
        printReport(rep);
        console.log('');
    }
}

try {
    main();
} catch (err) {
    console.error('[TRAY-PROBE] Erro inesperado:', err && err.stack ? err.stack : err);
    process.exit(1);
}
