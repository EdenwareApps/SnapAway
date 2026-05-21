#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <vector>
#include <string>
#include <map>

using namespace Napi;

class ProcessManager : public Napi::ObjectWrap<ProcessManager> {
private:
    static Napi::FunctionReference constructor;

public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "ProcessManager", {
            InstanceMethod("enumWindows", &ProcessManager::EnumWindows),
            InstanceMethod("showWindow", &ProcessManager::ShowWindow),
            InstanceMethod("isWindow", &ProcessManager::IsWindow),
            InstanceMethod("isWindowVisible", &ProcessManager::IsWindowVisible),
            InstanceMethod("isHungAppWindow", &ProcessManager::IsHungAppWindow),
            InstanceMethod("getWindowText", &ProcessManager::GetWindowText),
            InstanceMethod("getClassName", &ProcessManager::GetClassName),
            InstanceMethod("getWindowThreadProcessId", &ProcessManager::GetWindowThreadProcessId),
            InstanceMethod("getExecutablePath", &ProcessManager::GetExecutablePath),
            InstanceMethod("getWindowLongPtr", &ProcessManager::GetWindowLongPtr),
            InstanceMethod("getWindow", &ProcessManager::GetWindow),
            InstanceMethod("openProcess", &ProcessManager::OpenProcess),
            InstanceMethod("closeHandle", &ProcessManager::CloseHandle),
            InstanceMethod("queryFullProcessImageName", &ProcessManager::QueryFullProcessImageName)
        });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
        exports.Set("ProcessManager", func);
        return exports;
    }

    ProcessManager(const Napi::CallbackInfo& info) : Napi::ObjectWrap<ProcessManager>(info) {}

private:
    // Convert HWND to string
    static std::string HwndToString(HWND hwnd) {
        char buffer[32];
        sprintf_s(buffer, "%p", hwnd);
        return std::string(buffer);
    }

    // Convert string to HWND
    static HWND StringToHwnd(const std::string& str) {
        HWND hwnd;
        sscanf_s(str.c_str(), "%p", &hwnd);
        return hwnd;
    }

    // Convert wide string to UTF-8
    static std::string WideToUtf8(const std::wstring& wide) {
        if (wide.empty()) return "";
        int size_needed = WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(), NULL, 0, NULL, NULL);
        std::string strTo(size_needed, 0);
        WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(), &strTo[0], size_needed, NULL, NULL);
        return strTo;
    }

    // Convert UTF-8 to wide string
    static std::wstring Utf8ToWide(const std::string& utf8) {
        if (utf8.empty()) return L"";
        int size_needed = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), NULL, 0);
        std::wstring wstrTo(size_needed, 0);
        MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), &wstrTo[0], size_needed);
        return wstrTo;
    }

    Napi::Value EnumWindows(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        std::vector<Napi::Object> windows;

        // Captura o env corretamente
        struct EnumData {
            Napi::Env env;
            std::vector<Napi::Object>* windows;
        } enumData { env, &windows };

        auto enumProc = [](HWND hwnd, LPARAM lParam) -> BOOL {
            EnumData* data = reinterpret_cast<EnumData*>(lParam);
            Napi::Env env = data->env;
            std::vector<Napi::Object>& windows = *(data->windows);

            Napi::Object window = Napi::Object::New(env);
            window.Set("hwnd", HwndToString(hwnd));

            wchar_t titleBuffer[256];
            ::GetWindowTextW(hwnd, titleBuffer, 256);
            window.Set("title", WideToUtf8(titleBuffer));

            wchar_t classBuffer[256];
            ::GetClassNameW(hwnd, classBuffer, 256);
            window.Set("className", WideToUtf8(classBuffer));

            DWORD processId;
            ::GetWindowThreadProcessId(hwnd, &processId);
            window.Set("processId", processId);

            windows.push_back(window);
            return TRUE;
        };

        ::EnumWindows(enumProc, reinterpret_cast<LPARAM>(&enumData));

        Napi::Array result = Napi::Array::New(env, windows.size());
        for (size_t i = 0; i < windows.size(); i++) {
            result.Set(i, windows[i]);
        }

        return result;
    }

    Napi::Value ShowWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        int nCmdShow = info[1].As<Napi::Number>();
        
        HWND hwnd = StringToHwnd(hwndStr);
        BOOL result = ::ShowWindow(hwnd, nCmdShow);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value IsWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = StringToHwnd(hwndStr);
        BOOL result = ::IsWindow(hwnd);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value IsWindowVisible(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = StringToHwnd(hwndStr);
        BOOL result = ::IsWindowVisible(hwnd);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value IsHungAppWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = StringToHwnd(hwndStr);
        BOOL result = ::IsHungAppWindow(hwnd);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value GetWindowText(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = StringToHwnd(hwndStr);
        
        wchar_t buffer[256];
        int length = ::GetWindowTextW(hwnd, buffer, 256);
        
        if (length > 0) {
            return Napi::String::New(env, WideToUtf8(buffer));
        }
        
        return Napi::String::New(env, "");
    }

    Napi::Value GetClassName(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = StringToHwnd(hwndStr);
        
        wchar_t buffer[256];
        int length = ::GetClassNameW(hwnd, buffer, 256);
        
        if (length > 0) {
            return Napi::String::New(env, WideToUtf8(buffer));
        }
        
        return Napi::String::New(env, "");
    }

    Napi::Value GetWindowThreadProcessId(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = StringToHwnd(hwndStr);
        
        DWORD processId;
        DWORD threadId = ::GetWindowThreadProcessId(hwnd, &processId);
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("threadId", threadId);
        result.Set("processId", processId);
        
        return result;
    }

    Napi::Value GetExecutablePath(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        DWORD processId = static_cast<DWORD>(info[0].As<Napi::Number>().Int32Value());
        
        HANDLE hProcess = ::OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
        if (!hProcess) {
            return Napi::String::New(env, "");
        }

        wchar_t buffer[MAX_PATH];
        DWORD size = MAX_PATH;
        BOOL success = ::QueryFullProcessImageNameW(hProcess, 0, buffer, &size);
        
        ::CloseHandle(hProcess);
        
        if (success) {
            return Napi::String::New(env, WideToUtf8(buffer));
        }
        
        return Napi::String::New(env, "");
    }

    Napi::Value GetWindowLongPtr(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        int nIndex = info[1].As<Napi::Number>();
        
        HWND hwnd = StringToHwnd(hwndStr);
        LONG_PTR result = ::GetWindowLongPtrW(hwnd, nIndex);
        
        return Napi::Number::New(env, result);
    }

    Napi::Value GetWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        int uCmd = info[1].As<Napi::Number>();
        
        HWND hwnd = StringToHwnd(hwndStr);
        HWND result = ::GetWindow(hwnd, uCmd);
        
        if (result) {
            return Napi::String::New(env, HwndToString(result));
        }
        
        return env.Null();
    }

    Napi::Value OpenProcess(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        DWORD dwDesiredAccess = static_cast<DWORD>(info[0].As<Napi::Number>().Int32Value());
        BOOL bInheritHandle = info[1].As<Napi::Boolean>();
        DWORD dwProcessId = static_cast<DWORD>(info[2].As<Napi::Number>().Int32Value());
        
        HANDLE hProcess = ::OpenProcess(dwDesiredAccess, bInheritHandle, dwProcessId);
        
        if (hProcess) {
            char buffer[32];
            sprintf_s(buffer, "%p", hProcess);
            return Napi::String::New(env, buffer);
        }
        
        return env.Null();
    }

    Napi::Value CloseHandle(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string handleStr = info[0].As<Napi::String>();
        HANDLE handle;
        sscanf_s(handleStr.c_str(), "%p", &handle);
        
        BOOL result = ::CloseHandle(handle);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value QueryFullProcessImageName(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string handleStr = info[0].As<Napi::String>();
        DWORD dwFlags = static_cast<DWORD>(info[1].As<Napi::Number>().Int32Value());
        
        HANDLE handle;
        sscanf_s(handleStr.c_str(), "%p", &handle);
        
        wchar_t buffer[MAX_PATH];
        DWORD size = MAX_PATH;
        BOOL success = ::QueryFullProcessImageNameW(handle, dwFlags, buffer, &size);
        
        if (success) {
            return Napi::String::New(env, WideToUtf8(buffer));
        }
        
        return Napi::String::New(env, "");
    }
};

Napi::FunctionReference ProcessManager::constructor;

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return ProcessManager::Init(env, exports);
}

NODE_API_MODULE(process_addon, Init) 