#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <vector>
#include <string>

class WindowsManager : public Napi::ObjectWrap<WindowsManager> {
private:
    static Napi::FunctionReference constructor;

public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "WindowsManager", {
            InstanceMethod("findWindow", &WindowsManager::FindWindow),
            InstanceMethod("showWindow", &WindowsManager::ShowWindow),
            InstanceMethod("hideWindow", &WindowsManager::HideWindow),
            InstanceMethod("getWindowText", &WindowsManager::GetWindowText),
            InstanceMethod("isWindow", &WindowsManager::IsWindow),
            InstanceMethod("isWindowVisible", &WindowsManager::IsWindowVisible),
            InstanceMethod("isHungAppWindow", &WindowsManager::IsHungAppWindow),
            InstanceMethod("getWindowThreadProcessId", &WindowsManager::GetWindowThreadProcessId),
            InstanceMethod("getClassName", &WindowsManager::GetClassName),
            InstanceMethod("getWindowLongPtr", &WindowsManager::GetWindowLongPtr),
            InstanceMethod("getWindow", &WindowsManager::GetWindow),
            InstanceMethod("enumWindows", &WindowsManager::EnumWindows),
            InstanceMethod("openProcess", &WindowsManager::OpenProcess),
            InstanceMethod("queryFullProcessImageName", &WindowsManager::QueryFullProcessImageName),
            InstanceMethod("closeHandle", &WindowsManager::CloseHandle)
        });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
        exports.Set("WindowsManager", func);
        return exports;
    }

    WindowsManager(const Napi::CallbackInfo& info) : Napi::ObjectWrap<WindowsManager>(info) {}

private:
    Napi::Value FindWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string className = info[0].As<Napi::String>();
        std::string windowName = info[1].As<Napi::String>();

        HWND hwnd = ::FindWindowA(className.c_str(), windowName.c_str());
        
        if (hwnd == NULL) {
            return env.Null();
        }

        // Convert HWND to string representation
        char hwndStr[32];
        sprintf_s(hwndStr, "%p", hwnd);
        
        return Napi::String::New(env, hwndStr);
    }

    Napi::Value ShowWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        int nCmdShow = info[1].As<Napi::Number>().Int32Value();

        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        BOOL result = ::ShowWindow(hwnd, nCmdShow);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value HideWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        BOOL result = ::ShowWindow(hwnd, SW_HIDE);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value GetWindowText(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        
        char buffer[1024];
        int length = ::GetWindowTextA(hwnd, buffer, sizeof(buffer));
        
        if (length == 0) {
            return Napi::String::New(env, "");
        }
        
        return Napi::String::New(env, buffer);
    }

    Napi::Value IsWindow(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
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
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
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
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        BOOL result = ::IsHungAppWindow(hwnd);
        
        return Napi::Boolean::New(env, result != 0);
    }

    Napi::Value GetWindowThreadProcessId(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        
        DWORD processId;
        DWORD threadId = ::GetWindowThreadProcessId(hwnd, &processId);
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("processId", Napi::Number::New(env, processId));
        result.Set("threadId", Napi::Number::New(env, threadId));
        
        return result;
    }

    Napi::Value GetClassName(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        
        wchar_t buffer[256];
        int length = ::GetClassNameW(hwnd, buffer, sizeof(buffer) / sizeof(wchar_t));
        
        if (length == 0) {
            return Napi::String::New(env, "");
        }
        
        // Convert wide string to UTF-8
        int utf8Length = WideCharToMultiByte(CP_UTF8, 0, buffer, -1, NULL, 0, NULL, NULL);
        if (utf8Length == 0) {
            return Napi::String::New(env, "");
        }
        
        std::string utf8String(utf8Length - 1, '\0');
        WideCharToMultiByte(CP_UTF8, 0, buffer, -1, &utf8String[0], utf8Length, NULL, NULL);
        
        return Napi::String::New(env, utf8String);
    }

    Napi::Value GetWindowLongPtr(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string hwndStr = info[0].As<Napi::String>();
        int nIndex = info[1].As<Napi::Number>().Int32Value();
        
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
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
        int uCmd = info[1].As<Napi::Number>().Int32Value();
        
        HWND hwnd = (HWND)strtoull(hwndStr.c_str(), NULL, 16);
        HWND result = ::GetWindow(hwnd, uCmd);
        
        if (result == NULL) {
            return env.Null();
        }
        
        char resultStr[32];
        sprintf_s(resultStr, "%p", result);
        
        return Napi::String::New(env, resultStr);
    }

    Napi::Value OpenProcess(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        DWORD dwDesiredAccess = info[0].As<Napi::Number>().Uint32Value();
        BOOL bInheritHandle = info[1].As<Napi::Boolean>().Value();
        DWORD dwProcessId = info[2].As<Napi::Number>().Uint32Value();
        
        HANDLE result = ::OpenProcess(dwDesiredAccess, bInheritHandle, dwProcessId);
        
        if (result == NULL) {
            return env.Null();
        }
        
        char handleStr[32];
        sprintf_s(handleStr, "%p", result);
        
        return Napi::String::New(env, handleStr);
    }

    Napi::Value QueryFullProcessImageName(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string handleStr = info[0].As<Napi::String>();
        DWORD dwFlags = info[1].As<Napi::Number>().Uint32Value();
        
        HANDLE hProcess = (HANDLE)strtoull(handleStr.c_str(), NULL, 16);
        
        wchar_t buffer[MAX_PATH];
        DWORD size = MAX_PATH;
        BOOL result = ::QueryFullProcessImageNameW(hProcess, dwFlags, buffer, &size);
        
        if (!result) {
            return Napi::String::New(env, "");
        }
        
        // Convert wide string to UTF-8
        int utf8Length = WideCharToMultiByte(CP_UTF8, 0, buffer, -1, NULL, 0, NULL, NULL);
        if (utf8Length == 0) {
            return Napi::String::New(env, "");
        }
        
        std::string utf8String(utf8Length - 1, '\0');
        WideCharToMultiByte(CP_UTF8, 0, buffer, -1, &utf8String[0], utf8Length, NULL, NULL);
        
        return Napi::String::New(env, utf8String);
    }

    Napi::Value CloseHandle(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string handleStr = info[0].As<Napi::String>();
        HANDLE hObject = (HANDLE)strtoull(handleStr.c_str(), NULL, 16);
        
        BOOL result = ::CloseHandle(hObject);
        
        return Napi::Boolean::New(env, result != 0);
    }

    // EnumWindows callback structure
    struct EnumWindowsData {
        Napi::FunctionReference callback;
        std::vector<std::string> windows;
    };

    static BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
        EnumWindowsData* data = reinterpret_cast<EnumWindowsData*>(lParam);
        
        char hwndStr[32];
        sprintf_s(hwndStr, "%p", hwnd);
        
        data->windows.push_back(hwndStr);
        return TRUE;
    }

    Napi::Value EnumWindows(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Function callback = info[0].As<Napi::Function>();
        
        EnumWindowsData data;
        data.callback = Napi::Persistent(callback);
        
        BOOL result = ::EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&data));
        
        if (!result) {
            return Napi::Array::New(env, 0);
        }
        
        Napi::Array windows = Napi::Array::New(env, data.windows.size());
        for (size_t i = 0; i < data.windows.size(); i++) {
            windows.Set(i, Napi::String::New(env, data.windows[i]));
        }
        
        return windows;
    }
};

Napi::FunctionReference WindowsManager::constructor;

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return WindowsManager::Init(env, exports);
}

NODE_API_MODULE(windows_addon, Init) 