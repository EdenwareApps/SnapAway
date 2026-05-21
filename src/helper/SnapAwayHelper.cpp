#include <windows.h>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <iostream>

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

static std::string GetArgValue(const std::string &payload, const std::string &key) {
    auto pos = payload.find("\"" + key + "\"");
    if (pos == std::string::npos) return "";
    auto colon = payload.find(':', pos);
    if (colon == std::string::npos) return "";
    auto quote1 = payload.find('"', colon);
    if (quote1 == std::string::npos) return "";
    auto quote2 = payload.find('"', quote1 + 1);
    if (quote2 == std::string::npos) return "";
    return payload.substr(quote1 + 1, quote2 - quote1 - 1);
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

int wmain(int argc, wchar_t *argv[]) {
    EnsureDpiAwareness();
    std::wstring targetFile;
    std::wstring payloadBase64;

    for (int i = 1; i < argc; i++) {
        std::wstring key = argv[i];
        if (key == L"--payloadBase64" && i + 1 < argc) {
            payloadBase64 = argv[++i];
        } else if (key == L"--resultFile" && i + 1 < argc) {
            targetFile = argv[++i];
        }
    }

    if (payloadBase64.empty() || targetFile.empty()) {
        if (!targetFile.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "Argumentos inválidos"));
        }
        return 1;
    }

    auto jsonText = Base64Decode(Utf16ToUtf8(payloadBase64));
    std::string action = GetArgValue(jsonText, "action");

    if (action == "hide-window") {
        std::string hwndStr = GetArgValue(jsonText, "hwnd");
        if (hwndStr.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "hwnd ausente"));
            return 1;
        }
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), nullptr, 10);
        if (!hwnd || !IsWindow(hwnd)) {
            WriteResult(targetFile, resultError("INVALID_WINDOW", "HWND inválido"));
            return 1;
        }
        if (!ShowWindow(hwnd, SW_HIDE)) {
            WriteResult(targetFile, resultError("HIDE_FAILED", "Falha ao ocultar janela"));
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
            name = "SnapAway";
        }
        if (enableStr.empty() || exePath.empty()) {
            WriteResult(targetFile, resultError("INVALID_ARGS", "enable e exePath são necessários"));
            return 1;
        }

        HKEY hKey;
        LONG result = RegCreateKeyExA(HKEY_CURRENT_USER,
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
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

        if (enableStr == "true" || enableStr == "1") {
            std::string command = std::string("\"") + exePath + "\"";
            if (!args.empty()) {
                command += " " + args;
            }
            result = RegSetValueExA(hKey, name.c_str(), 0, REG_SZ, reinterpret_cast<const BYTE*>(command.c_str()), static_cast<DWORD>(command.size() + 1));
            RegCloseKey(hKey);
            if (result != ERROR_SUCCESS) {
                WriteResult(targetFile, resultError("REGISTRY_ERROR", "Falha ao gravar chave de inicialização"));
                return 1;
            }
            WriteResult(targetFile, resultOk());
            return 0;
        }

        // disable
        result = RegDeleteValueA(hKey, name.c_str());
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
