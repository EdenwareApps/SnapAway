#include <windows.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <iostream>
#include <utility>

static std::string Base64Decode(const std::string &in) {
    std::string out;
    std::vector<int> T(256, -1);
    for (int i = 0; i < 64; i++) T["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[i]] = i;
    int val = 0, valb = -8;
    for (unsigned char c : in) {
        if (T[c] == -1) break;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(char((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

static std::string Utf16ToUtf8(const std::wstring &wstr) {
    if (wstr.empty()) return std::string();
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, wstr.data(), (int)wstr.size(), NULL, 0, NULL, NULL);
    std::string strTo(size_needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.data(), (int)wstr.size(), &strTo[0], size_needed, NULL, NULL);
    return strTo;
}

static std::wstring Utf8ToUtf16(const std::string &str) {
    if (str.empty()) return std::wstring();
    int size_needed = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), NULL, 0);
    std::wstring wstrTo(size_needed, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), &wstrTo[0], size_needed);
    return wstrTo;
}

static std::string JsonUnescape(const std::string &s) {
    // O payload é JSON: caminhos chegam como "C:\\Users\\..." e precisam voltar a
    // "C:\Users\..." antes de irem para o registro, senão o valor gravado não é igual
    // ao que getLoginItemSettings espera encontrar.
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] != '\\' || i + 1 >= s.size()) {
            out += s[i];
            continue;
        }
        char c = s[++i];
        switch (c) {
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'u': {
                unsigned code = 0;
                bool ok = (i + 4 < s.size());
                for (int k = 1; ok && k <= 4; ++k) {
                    char h = s[i + k];
                    code <<= 4;
                    if (h >= '0' && h <= '9') code |= (unsigned)(h - '0');
                    else if (h >= 'a' && h <= 'f') code |= (unsigned)(h - 'a' + 10);
                    else if (h >= 'A' && h <= 'F') code |= (unsigned)(h - 'A' + 10);
                    else ok = false;
                }
                if (ok) {
                    i += 4;
                    if (code < 0x80) {
                        out += (char)code;
                    } else if (code < 0x800) {
                        out += (char)(0xC0 | (code >> 6));
                        out += (char)(0x80 | (code & 0x3F));
                    } else {
                        out += (char)(0xE0 | (code >> 12));
                        out += (char)(0x80 | ((code >> 6) & 0x3F));
                        out += (char)(0x80 | (code & 0x3F));
                    }
                }
                break;
            }
            default: out += c; break; // \\, \" e \/ chegam aqui
        }
    }
    return out;
}

static std::string GetArgValue(const std::string &payload, const std::string &key) {
    auto pos = payload.find("\"" + key + "\"");
    if (pos == std::string::npos) return "";
    auto colon = payload.find(':', pos + key.size() + 2);
    if (colon == std::string::npos) return "";
    auto quote1 = payload.find('"', colon);
    if (quote1 == std::string::npos) return "";
    std::string raw;
    bool escaped = false;
    for (size_t i = quote1 + 1; i < payload.size(); ++i) {
        char c = payload[i];
        if (escaped) {
            raw += '\\';
            raw += c;
            escaped = false;
            continue;
        }
        if (c == '\\') {
            escaped = true;
            continue;
        }
        if (c == '"') break;
        raw += c;
    }
    return JsonUnescape(raw);
}

static std::vector<std::string> SplitComma(const std::string &s) {
    std::vector<std::string> out;
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ',')) {
        if (!item.empty()) out.push_back(item);
    }
    return out;
}

// Resolve a lista de HWNDs a partir de `hwnd` (único) e/ou `hwnds` (lista
// separada por vírgula, em decimal). Usado por hide-window/show-window para
// processar várias janelas numa única invocação elevada (um só prompt de UAC).
static std::vector<std::string> ResolveHwndList(const std::string &payload) {
    std::vector<std::string> out;
    std::string single = GetArgValue(payload, "hwnd");
    std::string list = GetArgValue(payload, "hwnds");
    if (!single.empty()) out.push_back(single);
    if (!list.empty()) {
        auto parts = SplitComma(list);
        out.insert(out.end(), parts.begin(), parts.end());
    }
    return out;
}

static std::string resultFailedList(const std::string &code, const std::vector<std::string> &failed) {
    std::ostringstream s;
    s << "{\"success\":false,\"code\":\"" << code << "\",\"failed\":[";
    for (size_t i = 0; i < failed.size(); i++) {
        if (i) s << ",";
        s << "\"" << failed[i] << "\"";
    }
    s << "]}";
    return s.str();
}

static std::string resultError(const std::string &code, const std::string &message) {
    std::ostringstream s;
    s << "{\"success\":false,\"code\":\"" << code << "\",\"message\":\"";
    for (char c : message) {
        if (c == '\\') s << "\\\\";
        else if (c == '"') s << "\\\"";
        else if (c == '\n') s << "\\n";
        else s << c;
    }
    s << "\"}";
    return s.str();
}

static std::string resultOk() {
    return "{\"success\":true}";
}

static void WriteResult(const std::wstring &path, const std::string &body) {
    std::ofstream out(Utf16ToUtf8(path), std::ios::out | std::ios::trunc);
    if (out.is_open()) {
        out << body;
    }
}

static void EnsureDpiAwareness() {
    typedef BOOL (WINAPI *SetProcessDpiAwarenessContextFn)(HANDLE);
    typedef HRESULT (WINAPI *SetProcessDpiAwarenessFn)(int);

    const HANDLE dpiAwarenessContextPerMonitorAwareV2 = (HANDLE)-4;
    const int PROCESS_PER_MONITOR_DPI_AWARE = 2;

    HMODULE user32 = LoadLibraryW(L"user32.dll");
    if (user32) {
        auto setDpiContext = (SetProcessDpiAwarenessContextFn)GetProcAddress(user32, "SetProcessDpiAwarenessContext");
        if (setDpiContext) {
            setDpiContext(dpiAwarenessContextPerMonitorAwareV2);
        }
        FreeLibrary(user32);
    }

    HMODULE shcore = LoadLibraryW(L"shcore.dll");
    if (shcore) {
        auto setDpi = (SetProcessDpiAwarenessFn)GetProcAddress(shcore, "SetProcessDpiAwareness");
        if (setDpi) {
            setDpi(PROCESS_PER_MONITOR_DPI_AWARE);
        }
        FreeLibrary(shcore);
    }
}

static std::string ReadFileUtf8(const std::wstring &path) {
    std::ifstream in(Utf16ToUtf8(path), std::ios::in | std::ios::binary);
    if (!in.is_open()) return "";
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

static void WriteReadyFile(const std::wstring &dir) {
    std::ofstream out(Utf16ToUtf8(dir + L"\\ready"), std::ios::out | std::ios::trunc);
    if (out.is_open()) out << "1";
    std::ofstream pidOut(Utf16ToUtf8(dir + L"\\pid"), std::ios::out | std::ios::trunc);
    if (pidOut.is_open()) pidOut << GetCurrentProcessId();
}

// Retorna o primeiro arquivo de pedido encontrado em <dir>\request-*.json.
static std::pair<std::wstring, std::wstring> FindNextRequest(const std::wstring &dir) {
    std::wstring pattern = dir + L"\\request-*.json";
    WIN32_FIND_DATAW fd;
    HANDLE hFind = FindFirstFileW(pattern.c_str(), &fd);
    if (hFind == INVALID_HANDLE_VALUE) return { L"", L"" };
    std::wstring name = fd.cFileName;
    FindClose(hFind);
    std::wstring uuid = name;
    size_t dot = uuid.find(L'.');
    if (dot != std::wstring::npos) uuid = uuid.substr(0, dot);
    const std::wstring prefix = L"request-";
    if (uuid.rfind(prefix, 0) == 0) uuid = uuid.substr(prefix.size());
    return { dir + L"\\" + name, uuid };
}

// Despacha uma ação (código compartilhado entre o modo one-shot e o servidor).
static int DispatchAction(const std::string &jsonText, const std::wstring &resultFile) {
    const std::wstring &targetFile = resultFile;
    std::string action = GetArgValue(jsonText, "action");

    if (action == "hide-window") {
        auto hwnds = ResolveHwndList(jsonText);
        if (hwnds.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "hwnd ausente"));
            return 1;
        }
        std::vector<std::string> failed;
        for (const auto &hs : hwnds) {
            HWND hwnd = (HWND)strtoull(hs.c_str(), nullptr, 10);
            if (!hwnd || !IsWindow(hwnd)) { failed.push_back(hs); continue; }
            ShowWindow(hwnd, SW_HIDE);
            // ShowWindow retorna a visibilidade ANTERIOR, não sucesso. Checamos
            // a visibilidade real após a chamada para detectar falha.
            if (IsWindowVisible(hwnd)) failed.push_back(hs);
        }
        if (!failed.empty()) {
            WriteResult(targetFile, resultFailedList("HIDE_FAILED", failed));
            return 1;
        }
        WriteResult(targetFile, resultOk());
        return 0;
    }

    if (action == "show-window") {
        auto hwnds = ResolveHwndList(jsonText);
        if (hwnds.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "hwnd ausente"));
            return 1;
        }
        std::vector<std::string> failed;
        for (const auto &hs : hwnds) {
            HWND hwnd = (HWND)strtoull(hs.c_str(), nullptr, 10);
            if (!hwnd || !IsWindow(hwnd)) { failed.push_back(hs); continue; }
            ShowWindow(hwnd, SW_SHOWNA);
            if (!IsWindowVisible(hwnd)) failed.push_back(hs);
        }
        if (!failed.empty()) {
            WriteResult(targetFile, resultFailedList("SHOW_FAILED", failed));
            return 1;
        }
        WriteResult(targetFile, resultOk());
        return 0;
    }

    if (action == "kill-process") {
        std::string processName = GetArgValue(jsonText, "processName");
        std::string pidStr = GetArgValue(jsonText, "pid");
        DWORD pid = 0;
        if (!pidStr.empty()) pid = (DWORD)std::stoul(pidStr);

        if (pid == 0 && processName.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "pid ou processName requerido"));
            return 1;
        }

        if (pid > 0) {
            HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
            if (!hProc) {
                WriteResult(targetFile, resultError("ELEVATION_REQUIRED", "Programa precisa de direitos administrativos para terminar o processo"));
                return 1;
            }
            BOOL ok = TerminateProcess(hProc, 1);
            CloseHandle(hProc);
            if (!ok) {
                WriteResult(targetFile, resultError("KILL_FAILED", "Falha ao terminar processo"));
                return 1;
            }
            WriteResult(targetFile, resultOk());
            return 0;
        }

        // Não implementado processName kill neste helper mínimo
        WriteResult(targetFile, resultError("NOT_IMPLEMENTED", "kill by processName não implementado"));
        return 1;
    }

    if (action == "set-priority") {
        std::string pidStr = GetArgValue(jsonText, "pid");
        std::string mode = GetArgValue(jsonText, "mode");
        if (pidStr.empty() || mode.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "pid e mode são necessários"));
            return 1;
        }
        DWORD pid = (DWORD)std::stoul(pidStr);
        HANDLE hProc = OpenProcess(PROCESS_SET_INFORMATION, FALSE, pid);
        if (!hProc) {
            WriteResult(targetFile, resultError("ELEVATION_REQUIRED", "Necessário elevação para priorizar processo"));
            return 1;
        }
        DWORD priority = NORMAL_PRIORITY_CLASS;
        if (mode == "high") priority = HIGH_PRIORITY_CLASS;
        else if (mode == "realtime") priority = REALTIME_PRIORITY_CLASS;
        else if (mode == "above") priority = ABOVE_NORMAL_PRIORITY_CLASS;
        else if (mode == "below") priority = BELOW_NORMAL_PRIORITY_CLASS;

        if (!SetPriorityClass(hProc, priority)) {
            WriteResult(targetFile, resultError("PRIORITY_FAILED", "Falha ao ajustar prioridade"));
            CloseHandle(hProc);
            return 1;
        }
        CloseHandle(hProc);
        WriteResult(targetFile, resultOk());
        return 0;
    }

    if (action == "set-autostart") {
        std::string enableStr = GetArgValue(jsonText, "enable");
        std::string exePath = GetArgValue(jsonText, "exePath");
        std::string args = GetArgValue(jsonText, "args");
        std::string name = GetArgValue(jsonText, "name");
        if (name.empty()) {
            // Electron names the Run value after the Application User Model ID, and its
            // getLoginItemSettings reads only that entry: any other name here would
            // write a second value the app cannot see.
            name = "Edenware.app.Snapcover";
        }
        if (enableStr.empty() || exePath.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "enable e exePath são necessários"));
            return 1;
        }

        HKEY hKey;
        // Wide variants: o valor é comparado byte a byte por
        // getLoginItemSettings, e a API ANSI corromperia caminhos com acento.
        LONG result = RegCreateKeyExW(HKEY_CURRENT_USER,
            L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            0,
            NULL,
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            NULL,
            &hKey,
            NULL);

        if (result != ERROR_SUCCESS) {
            WriteResult(targetFile, resultError("REGISTRY_ERROR", "Falha ao abrir a chave de inicialização"));
            return 1;
        }

        std::wstring wname = Utf8ToUtf16(name);

        if (enableStr == "true" || enableStr == "1") {
            std::wstring command = std::wstring(L"\"") + Utf8ToUtf16(exePath) + L"\"";
            if (!args.empty()) {
                command += L" " + Utf8ToUtf16(args);
            }
            result = RegSetValueExW(hKey, wname.c_str(), 0, REG_SZ, reinterpret_cast<const BYTE*>(command.c_str()), static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
            RegCloseKey(hKey);
            if (result != ERROR_SUCCESS) {
                WriteResult(targetFile, resultError("REGISTRY_ERROR", "Falha ao gravar chave de inicialização"));
                return 1;
            }
            WriteResult(targetFile, resultOk());
            return 0;
        }

        // disable
        result = RegDeleteValueW(hKey, wname.c_str());
        RegCloseKey(hKey);
        if (result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND) {
            WriteResult(targetFile, resultError("REGISTRY_ERROR", "Falha ao remover chave de inicialização"));
            return 1;
        }
        WriteResult(targetFile, resultOk());
        return 0;
    }

    WriteResult(targetFile, resultError("UNKNOWN_ACTION", "Ação desconhecida"));
    return 1;
}

int wmain(int argc, wchar_t *argv[]) {
    EnsureDpiAwareness();

    // --- Modo relay (instalação MSIX/AppX) ---
    // Processos empacotados têm token restrito e NÃO disparam o prompt de UAC
    // via ShellExecute('runas'). O app copia este helper para fora do pacote
    // (%LOCALAPPDATA%\SnapAway\bin) e o inicia com --relayRunas: esta cópia,
    // sem identity de pacote, pede a própria elevação aqui. Se aprovado, a
    // instância elevada (iniciada pelo UAC) processa a ação real.
    for (int i = 1; i < argc; i++) {
        if (wcscmp(argv[i], L"--relayRunas") == 0) {
            std::wstring relayStatus;
            std::vector<std::wstring> relayArgs;
            for (int j = 1; j < argc; j++) {
                if (wcscmp(argv[j], L"--relayRunas") == 0) continue;
                if (wcscmp(argv[j], L"--relayStatus") == 0 && j + 1 < argc) {
                    relayStatus = argv[++j];
                    continue;
                }
                relayArgs.push_back(argv[j]);
            }

            // Monta a linha de comando (com aspas quando necessário) para passar
            // ao ShellExecuteW como lpParameters.
            std::wstring cmdline;
            for (size_t j = 0; j < relayArgs.size(); j++) {
                const std::wstring &arg = relayArgs[j];
                const bool needQuote = arg.empty()
                    || arg.find(L' ') != std::wstring::npos
                    || arg.find(L'\t') != std::wstring::npos;
                if (j > 0) cmdline += L' ';
                if (needQuote) {
                    cmdline += L'"';
                    for (wchar_t c : arg) {
                        if (c == L'"') cmdline += L"\\\"";
                        else cmdline += c;
                    }
                    cmdline += L'"';
                } else {
                    cmdline += arg;
                }
            }

            wchar_t exePath[MAX_PATH] = { 0 };
            GetModuleFileNameW(NULL, exePath, MAX_PATH);

            // Bloqueia até o usuário responder ao UAC; depois gravamos o status
            // para o app saber se a elevação foi aprovada ou negada.
            HINSTANCE h = ShellExecuteW(NULL, L"runas", exePath, cmdline.c_str(), NULL, SW_HIDE);
            const bool ok = ((INT_PTR)h) > 32;
            if (!relayStatus.empty()) {
                if (ok) WriteResult(relayStatus, "{\"ok\":true}");
                else WriteResult(relayStatus, "{\"ok\":false,\"message\":\"Elevação negada ou falhou\"}");
            }
            return ok ? 0 : 1;
        }
    }

    std::wstring targetFile;
    std::wstring payloadBase64;
    std::wstring serverDir;

    for (int i = 1; i < argc; i++) {
        std::wstring key = argv[i];
        if (key == L"--payloadBase64" && i + 1 < argc) {
            payloadBase64 = argv[++i];
        } else if (key == L"--resultFile" && i + 1 < argc) {
            targetFile = argv[++i];
        } else if (key == L"--server" && i + 1 < argc) {
            serverDir = argv[++i];
        }
    }

    // Modo servidor: sobe elevado UMA vez por sessão e processa pedidos
    // (request-<uuid>.json) gravando respostas (result-<uuid>.json), evitando
    // um prompt de UAC a cada F6. Sai ao receber action "quit" ou por idle.
    if (!serverDir.empty()) {
        WriteReadyFile(serverDir);
        DWORD idleStart = GetTickCount();
        const DWORD IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min sem pedidos
        for (;;) {
            auto req = FindNextRequest(serverDir);
            if (req.first.empty()) {
                if (GetTickCount() - idleStart > IDLE_TIMEOUT_MS) {
                    // Sai por idle; remove o marcador ready para o cliente
                    // saber que precisa subir um novo servidor.
                    DeleteFileW((serverDir + L"\\ready").c_str());
                    return 0;
                }
                Sleep(100);
                continue;
            }
            idleStart = GetTickCount();
            std::wstring resultFile = serverDir + L"\\result-" + req.second + L".json";
            auto jsonText = ReadFileUtf8(req.first);
            DeleteFileW(req.first.c_str());
            if (GetArgValue(jsonText, "action") == "quit") {
                WriteResult(resultFile, resultOk());
                DeleteFileW((serverDir + L"\\ready").c_str());
                return 0;
            }
            DispatchAction(jsonText, resultFile);
        }
    }

    if (payloadBase64.empty() || targetFile.empty()) {
        if (!targetFile.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "Argumentos inválidos"));
        }
        return 1;
    }

    auto jsonText = Base64Decode(Utf16ToUtf8(payloadBase64));
    return DispatchAction(jsonText, targetFile);
}
