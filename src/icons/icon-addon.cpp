#define NOMINMAX
#include <algorithm>
#ifndef min
#define min(a,b) (((a) < (b)) ? (a) : (b))
#endif
#ifndef max
#define max(a,b) (((a) > (b)) ? (a) : (b))
#endif
#include <napi.h>
#include <windows.h>
#include <gdiplus.h>
#include <shlobj.h>
#include <psapi.h>
#include <vector>
#include <string>
#include <memory>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "gdi32.lib")

using namespace Gdiplus;

class IconExtractor : public Napi::ObjectWrap<IconExtractor> {
private:
    static Napi::FunctionReference constructor;
    static ULONG_PTR gdiplusToken;
    static bool gdiplusInitialized;

public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "IconExtractor", {
            InstanceMethod("extractIcon", &IconExtractor::ExtractIcon),
            InstanceMethod("initialize", &IconExtractor::Initialize),
            InstanceMethod("cleanup", &IconExtractor::Cleanup)
        });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
        exports.Set("IconExtractor", func);
        return exports;
    }

    IconExtractor(const Napi::CallbackInfo& info) : Napi::ObjectWrap<IconExtractor>(info) {}

private:
    Napi::Value Initialize(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (gdiplusInitialized) {
            return Napi::Boolean::New(env, true);
        }

        GdiplusStartupInput gdiplusStartupInput;
        Status status = GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);
        
        if (status == Ok) {
            gdiplusInitialized = true;
            // printf("[ICONS] GDI+ initialized successfully\n");
            return Napi::Boolean::New(env, true);
        } else {
            printf("[ICONS] Failed to initialize GDI+, status: %d\n", status);
            return Napi::Boolean::New(env, false);
        }
    }

    Napi::Value Cleanup(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (gdiplusInitialized) {
            GdiplusShutdown(gdiplusToken);
            gdiplusInitialized = false;
            // printf("[ICONS] GDI+ cleanup completed\n");
        }
        
        return Napi::Boolean::New(env, true);
    }

    Napi::Value ExtractIcon(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string executablePath = info[0].As<Napi::String>();
        std::string outputPath = info[1].As<Napi::String>();
        
        if (!gdiplusInitialized) {
            // printf("[ICONS] GDI+ not initialized, attempting to initialize\n");
            GdiplusStartupInput gdiplusStartupInput;
            Status status = GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);
            if (status != Ok) {
                printf("[ICONS] Failed to initialize GDI+ for icon extraction\n");
                return env.Null();
            }
            gdiplusInitialized = true;
        }

        try {
            // printf("[ICONS] Starting icon extraction for: %s\n", executablePath.c_str());
            
            // Convert string to wide string
            int wideLength = MultiByteToWideChar(CP_UTF8, 0, executablePath.c_str(), -1, NULL, 0);
            if (wideLength == 0) {
                printf("[ICONS] Failed to convert path to wide string\n");
                return env.Null();
            }
            
            std::wstring widePath(wideLength - 1, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, executablePath.c_str(), -1, &widePath[0], wideLength);

            // Get icon from file using SHGetFileInfo (more reliable than ExtractIconEx)
            SHFILEINFOW shfi = {0};
            DWORD_PTR result = SHGetFileInfoW(
                widePath.c_str(),
                0,
                &shfi,
                sizeof(shfi),
                SHGFI_ICON | SHGFI_LARGEICON
            );
            
            if (result == 0 || shfi.hIcon == NULL) {
                // Try small icon as fallback
                result = SHGetFileInfoW(
                    widePath.c_str(),
                    0,
                    &shfi,
                    sizeof(shfi),
                    SHGFI_ICON | SHGFI_SMALLICON
                );
                
                if (result == 0 || shfi.hIcon == NULL) {
                    DWORD error = GetLastError();
                    printf("[ICONS] Failed to extract icon from: %s (error: %lu)\n", executablePath.c_str(), error);
                    return env.Null();
                }
            }

            HICON hIcon = shfi.hIcon;
            // printf("[ICONS] Icon extracted successfully using SHGetFileInfo\n");

            // printf("[ICONS] Icon extracted successfully, creating bitmap...\n");

            // Get icon info to determine size
            ICONINFO iconInfo;
            if (!GetIconInfo(hIcon, &iconInfo)) {
                printf("[ICONS] Failed to get icon info for: %s\n", executablePath.c_str());
                DestroyIcon(hIcon);
                return env.Null();
            }

            // Create a 32-bit ARGB bitmap to preserve transparency
            Bitmap* gdiBitmap = new Bitmap(32, 32, PixelFormat32bppARGB);
            if (!gdiBitmap) {
                printf("[ICONS] Failed to create ARGB bitmap for: %s\n", executablePath.c_str());
                DestroyIcon(hIcon);
                return env.Null();
            }

            // Create graphics object and draw the icon
            Graphics graphics(gdiBitmap);
            graphics.Clear(Color::Transparent);
            
            // Draw the icon using DrawIconEx for better transparency support
            HDC hdc = graphics.GetHDC();
            DrawIconEx(hdc, 0, 0, hIcon, 32, 32, 0, NULL, DI_NORMAL);
            graphics.ReleaseHDC(hdc);

            // Clean up icon info
            if (iconInfo.hbmColor) DeleteObject(iconInfo.hbmColor);
            if (iconInfo.hbmMask) DeleteObject(iconInfo.hbmMask);

            // Convert to PNG format
            CLSID pngClsid;
            int encoderResult = GetEncoderClsid(L"image/png", &pngClsid);
            if (encoderResult < 0) {
                printf("[ICONS] Failed to get PNG encoder for: %s\n", executablePath.c_str());
                delete gdiBitmap;
                DestroyIcon(hIcon);
                return env.Null();
            }

            // Convert output path to wide string
            int outputWideLength = MultiByteToWideChar(CP_UTF8, 0, outputPath.c_str(), -1, NULL, 0);
            if (outputWideLength == 0) {
                printf("[ICONS] Failed to convert output path to wide string\n");
                DestroyIcon(hIcon);
                return env.Null();
            }
            
            std::wstring outputWidePath(outputWideLength - 1, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, outputPath.c_str(), -1, &outputWidePath[0], outputWideLength);

            // printf("[ICONS] Saving icon to: %ws\n", outputWidePath.c_str());

            // Save as PNG
            Status saveStatus = gdiBitmap->Save(outputWidePath.c_str(), &pngClsid, NULL);

            // Cleanup
            delete gdiBitmap;
            DestroyIcon(hIcon);

            if (saveStatus == Ok) {
                // printf("[ICONS] Successfully extracted icon to: %s\n", outputPath.c_str());
                return Napi::Boolean::New(env, true);
            } else {
                printf("[ICONS] Failed to save icon as PNG, status: %d\n", saveStatus);
                return env.Null();
            }

        } catch (const std::exception& e) {
            printf("[ICONS] Exception during icon extraction: %s\n", e.what());
            return env.Null();
        }
    }

    static int GetEncoderClsid(const WCHAR* format, CLSID* pClsid) {
        UINT num = 0;
        UINT size = 0;

        ImageCodecInfo* pImageCodecInfo = NULL;

        GetImageEncodersSize(&num, &size);
        if (size == 0) return -1;

        pImageCodecInfo = (ImageCodecInfo*)(malloc(size));
        if (pImageCodecInfo == NULL) return -1;

        GetImageEncoders(num, size, pImageCodecInfo);

        for (UINT j = 0; j < num; ++j) {
            if (wcscmp(pImageCodecInfo[j].MimeType, format) == 0) {
                *pClsid = pImageCodecInfo[j].Clsid;
                free(pImageCodecInfo);
                return j;
            }
        }

        free(pImageCodecInfo);
        return -1;
    }
};

Napi::FunctionReference IconExtractor::constructor;
ULONG_PTR IconExtractor::gdiplusToken = 0;
bool IconExtractor::gdiplusInitialized = false;

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return IconExtractor::Init(env, exports);
}

NODE_API_MODULE(icon_addon, Init) 