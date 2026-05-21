#include <napi.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <functiondiscoverykeys_devpkey.h>
#include <comdef.h>
#include <stdio.h>

// GUIDs for Core Audio interfaces
const CLSID CLSID_MMDeviceEnumerator = {0xBCDE0395, 0xE52F, 0x467C, {0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}};
const IID IID_IMMDeviceEnumerator = {0xA95664D2, 0x9614, 0x4F35, {0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}};
const IID IID_IAudioSessionManager2 = {0x77AA99A0, 0x1BD6, 0x484F, {0x8B, 0xC7, 0x2C, 0x65, 0x4C, 0x9A, 0x9B, 0x6F}};
const IID IID_ISimpleAudioVolume = {0x87CE5498, 0x68D6, 0x44E5, {0x92, 0x15, 0x6D, 0xA4, 0x7E, 0xF8, 0x83, 0xD8}};
const IID IID_IAudioSessionControl2 = {0xBFB7FF88, 0x7239, 0x4FC9, {0x8F, 0xA2, 0x07, 0xC9, 0x50, 0xBE, 0x9C, 0x6D}};

class AudioController {
private:
    IMMDeviceEnumerator* deviceEnumerator;
    IAudioSessionManager2* sessionManager;
    bool comInitialized;

public:
    AudioController() : deviceEnumerator(nullptr), sessionManager(nullptr), comInitialized(false) {}

    ~AudioController() {
        cleanup();
    }

    bool initialize() {
        printf("[AUDIO-NATIVE] initialize() called\n");
        if (comInitialized) {
            printf("[AUDIO-NATIVE] COM already initialized\n");
            return true;
        }

        // Try different COM initialization modes
        HRESULT hr = S_OK;
        
        // First try multithreaded
        hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        printf("[AUDIO-NATIVE] CoInitializeEx(COINIT_MULTITHREADED) result: 0x%08X\n", hr);
        
        if (hr == RPC_E_CHANGED_MODE) {
            // COM was already initialized with a different threading model
            // Try apartment-threaded instead
            hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
            printf("[AUDIO-NATIVE] CoInitializeEx(COINIT_APARTMENTTHREADED) result: 0x%08X\n", hr);
        }
        
        if (FAILED(hr) && hr != S_FALSE) {
            printf("[AUDIO-NATIVE] COM initialization failed with HRESULT: 0x%08X\n", hr);
            return false;
        }
        
        comInitialized = true;
        printf("[AUDIO-NATIVE] COM initialized successfully\n");

        hr = CoCreateInstance(
            CLSID_MMDeviceEnumerator,
            nullptr,
            CLSCTX_ALL,
            IID_IMMDeviceEnumerator,
            (void**)&deviceEnumerator
        );
        printf("[AUDIO-NATIVE] CoCreateInstance result: 0x%08X\n", hr);
        if (FAILED(hr)) {
            printf("[AUDIO-NATIVE] Failed to create device enumerator\n");
            return false;
        }
        printf("[AUDIO-NATIVE] Device enumerator created successfully\n");

        IMMDevice* device = nullptr;
        hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device);
        printf("[AUDIO-NATIVE] GetDefaultAudioEndpoint result: 0x%08X\n", hr);
        if (FAILED(hr)) {
            printf("[AUDIO-NATIVE] Failed to get default audio endpoint\n");
            return false;
        }
        printf("[AUDIO-NATIVE] Default audio endpoint obtained\n");

        hr = device->Activate(
            IID_IAudioSessionManager2,
            CLSCTX_ALL,
            nullptr,
            (void**)&sessionManager
        );
        printf("[AUDIO-NATIVE] Activate result: 0x%08X\n", hr);
        device->Release();

        bool success = SUCCEEDED(hr);
        printf("[AUDIO-NATIVE] initialize() returning: %s\n", success ? "true" : "false");
        return success;
    }

    void cleanup() {
        if (sessionManager) {
            sessionManager->Release();
            sessionManager = nullptr;
        }
        if (deviceEnumerator) {
            deviceEnumerator->Release();
            deviceEnumerator = nullptr;
        }
        if (comInitialized) {
            CoUninitialize();
            comInitialized = false;
        }
    }

    bool muteProcess(DWORD processId, bool mute) {
        if (!sessionManager) return false;

        IAudioSessionEnumerator* sessionEnumerator = nullptr;
        HRESULT hr = sessionManager->GetSessionEnumerator(&sessionEnumerator);
        if (FAILED(hr)) return false;

        int sessionCount = 0;
        hr = sessionEnumerator->GetCount(&sessionCount);
        if (FAILED(hr)) {
            sessionEnumerator->Release();
            return false;
        }

        bool success = false;
        for (int i = 0; i < sessionCount; i++) {
            IAudioSessionControl* session = nullptr;
            hr = sessionEnumerator->GetSession(i, &session);
            if (FAILED(hr)) continue;

            IAudioSessionControl2* sessionControl2 = nullptr;
            hr = session->QueryInterface(IID_IAudioSessionControl2, (void**)&sessionControl2);
            session->Release();
            if (FAILED(hr)) continue;

            DWORD sessionProcessId = 0;
            hr = sessionControl2->GetProcessId(&sessionProcessId);
            if (SUCCEEDED(hr) && sessionProcessId == processId) {
                ISimpleAudioVolume* audioVolume = nullptr;
                hr = sessionControl2->QueryInterface(IID_ISimpleAudioVolume, (void**)&audioVolume);
                if (SUCCEEDED(hr)) {
                    hr = audioVolume->SetMute(mute ? TRUE : FALSE, nullptr);
                    if (SUCCEEDED(hr)) {
                        success = true;
                    }
                    audioVolume->Release();
                }
            }
            sessionControl2->Release();
        }

        sessionEnumerator->Release();
        return success;
    }

    bool hasActiveAudioSession(DWORD processId) {
        if (!sessionManager) return false;

        IAudioSessionEnumerator* sessionEnumerator = nullptr;
        HRESULT hr = sessionManager->GetSessionEnumerator(&sessionEnumerator);
        if (FAILED(hr)) return false;

        int sessionCount = 0;
        hr = sessionEnumerator->GetCount(&sessionCount);
        if (FAILED(hr)) {
            sessionEnumerator->Release();
            return false;
        }

        bool found = false;
        for (int i = 0; i < sessionCount; i++) {
            IAudioSessionControl* session = nullptr;
            hr = sessionEnumerator->GetSession(i, &session);
            if (FAILED(hr)) continue;

            IAudioSessionControl2* sessionControl2 = nullptr;
            hr = session->QueryInterface(IID_IAudioSessionControl2, (void**)&sessionControl2);
            session->Release();
            if (FAILED(hr)) continue;

            DWORD sessionProcessId = 0;
            hr = sessionControl2->GetProcessId(&sessionProcessId);
            if (SUCCEEDED(hr) && sessionProcessId == processId) {
                found = true;
            }
            sessionControl2->Release();
        }

        sessionEnumerator->Release();
        return found;
    }
};

static AudioController audioController;

Napi::Value InitializeAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    bool success = audioController.initialize();
    return Napi::Boolean::New(env, success);
}

Napi::Value CleanupAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    audioController.cleanup();
    return env.Undefined();
}

Napi::Value MuteProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    DWORD processId = info[0].As<Napi::Number>().Uint32Value();
    bool mute = info[1].As<Napi::Boolean>().Value();
    
    bool success = audioController.muteProcess(processId, mute);
    return Napi::Boolean::New(env, success);
}

Napi::Value HasActiveAudioSession(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    DWORD processId = info[0].As<Napi::Number>().Uint32Value();
    
    bool hasSession = audioController.hasActiveAudioSession(processId);
    return Napi::Boolean::New(env, hasSession);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("initializeAudio", Napi::Function::New(env, InitializeAudio));
    exports.Set("cleanupAudio", Napi::Function::New(env, CleanupAudio));
    exports.Set("muteProcess", Napi::Function::New(env, MuteProcess));
    exports.Set("hasActiveAudioSession", Napi::Function::New(env, HasActiveAudioSession));
    return exports;
}

NODE_API_MODULE(audio_addon, Init) 