/*
 * icon-addon-capi.c
 * Pure C N-API implementation of IconExtractor native addon.
 * Uses WIC (Windows Imaging Component) via COM C-style vtable API to
 * extract icons from executables and save them as PNG files.
 * Built as .c so the linker emits correct delay-load structure for node.exe.
 *
 * Note: gdiplus.h is C++-only, so we use WIC instead.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define COBJMACROS          /* Enable IXxx_Method(ptr,...) macros */
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <objbase.h>
#include <initguid.h>       /* Must come before wincodec.h to define GUIDs */
#include <wincodec.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ *
 *  Per-instance state                                                 *
 * ------------------------------------------------------------------ */

typedef struct {
    int com_initialized;
    IWICImagingFactory *factory;
} IconExtractorInst;

static void ie_finalize(napi_env env, void *data, void *hint) {
    IconExtractorInst *inst = (IconExtractorInst*)data;
    if (inst->factory) {
        IWICImagingFactory_Release(inst->factory);
        inst->factory = NULL;
    }
    if (inst->com_initialized) {
        CoUninitialize();
        inst->com_initialized = 0;
    }
    free(inst);
}

/* ------------------------------------------------------------------ *
 *  Utility                                                            *
 * ------------------------------------------------------------------ */

/* UTF-8 → wide string, returns allocated buffer that caller must free */
static wchar_t *utf8_to_wide(const char *utf8) {
    int n = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    if (n <= 0) return NULL;
    wchar_t *w = (wchar_t*)malloc((size_t)n * sizeof(wchar_t));
    if (!w) return NULL;
    MultiByteToWideChar(CP_UTF8, 0, utf8, -1, w, n);
    return w;
}

/* ------------------------------------------------------------------ *
 *  IconExtractor instance methods                                     *
 * ------------------------------------------------------------------ */

static napi_value ie_Initialize(napi_env env, napi_callback_info info) {
    napi_value this_val;
    napi_get_cb_info(env, info, NULL, NULL, &this_val, NULL);

    IconExtractorInst *inst = NULL;
    napi_unwrap(env, this_val, (void**)&inst);

    if (!inst->com_initialized) {
        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE) {
            inst->com_initialized = 1;
        } else {
            napi_value ret; napi_get_boolean(env, 0, &ret);
            return ret;
        }
    }

    if (!inst->factory) {
        HRESULT hr = CoCreateInstance(&CLSID_WICImagingFactory, NULL,
                                      CLSCTX_INPROC_SERVER,
                                      &IID_IWICImagingFactory,
                                      (void**)&inst->factory);
        if (FAILED(hr)) {
            inst->factory = NULL;
            napi_value ret; napi_get_boolean(env, 0, &ret);
            return ret;
        }
    }

    napi_value ret; napi_get_boolean(env, 1, &ret);
    return ret;
}

static napi_value ie_Cleanup(napi_env env, napi_callback_info info) {
    napi_value this_val;
    napi_get_cb_info(env, info, NULL, NULL, &this_val, NULL);

    IconExtractorInst *inst = NULL;
    napi_unwrap(env, this_val, (void**)&inst);

    if (inst->factory) {
        IWICImagingFactory_Release(inst->factory);
        inst->factory = NULL;
    }
    if (inst->com_initialized) {
        CoUninitialize();
        inst->com_initialized = 0;
    }

    napi_value ret; napi_get_boolean(env, 1, &ret);
    return ret;
}

static napi_value ie_ExtractIcon(napi_env env, napi_callback_info info) {
    napi_value null_ret; napi_get_null(env, &null_ret);

    size_t argc = 2; napi_value argv[2];
    napi_value this_val;
    napi_get_cb_info(env, info, &argc, argv, &this_val, NULL);

    if (argc < 2) return null_ret;

    char exec_path[MAX_PATH * 2] = {0};
    char out_path[MAX_PATH * 2]  = {0};
    size_t len;
    napi_get_value_string_utf8(env, argv[0], exec_path, sizeof(exec_path), &len);
    napi_get_value_string_utf8(env, argv[1], out_path,  sizeof(out_path),  &len);

    IconExtractorInst *inst = NULL;
    napi_unwrap(env, this_val, (void**)&inst);

    /* Lazily initialize COM + factory if the caller skipped initialize() */
    if (!inst->com_initialized) {
        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE) {
            inst->com_initialized = 1;
        }
    }
    if (!inst->factory && inst->com_initialized) {
        CoCreateInstance(&CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER,
                         &IID_IWICImagingFactory, (void**)&inst->factory);
    }
    if (!inst->factory) return null_ret;

    /* ---- 1. Get HICON via SHGetFileInfoW ---- */
    wchar_t *wExecPath = utf8_to_wide(exec_path);
    if (!wExecPath) return null_ret;

    SHFILEINFOW shfi;
    memset(&shfi, 0, sizeof(shfi));
    DWORD_PTR shResult = SHGetFileInfoW(wExecPath, 0, &shfi, sizeof(shfi),
                                         SHGFI_ICON | SHGFI_LARGEICON);
    /* Fallback to small icon */
    if (shResult == 0 || !shfi.hIcon) {
        memset(&shfi, 0, sizeof(shfi));
        shResult = SHGetFileInfoW(wExecPath, 0, &shfi, sizeof(shfi),
                                   SHGFI_ICON | SHGFI_SMALLICON);
    }
    free(wExecPath);

    if (shResult == 0 || !shfi.hIcon) return null_ret;
    HICON hIcon = shfi.hIcon;

    /* ---- 2. Create WIC bitmap from HICON ---- */
    IWICBitmap *pBitmap = NULL;
    HRESULT hr = IWICImagingFactory_CreateBitmapFromHICON(inst->factory, hIcon, &pBitmap);
    DestroyIcon(hIcon);
    if (FAILED(hr) || !pBitmap) return null_ret;

    /* ---- 3. Create WIC stream for output file ---- */
    wchar_t *wOutPath = utf8_to_wide(out_path);
    if (!wOutPath) { IWICBitmap_Release(pBitmap); return null_ret; }

    IWICStream *pStream = NULL;
    hr = IWICImagingFactory_CreateStream(inst->factory, &pStream);
    if (FAILED(hr) || !pStream) {
        free(wOutPath); IWICBitmap_Release(pBitmap);
        return null_ret;
    }
    hr = IWICStream_InitializeFromFilename(pStream, wOutPath, GENERIC_WRITE);
    free(wOutPath);
    if (FAILED(hr)) {
        IWICStream_Release(pStream); IWICBitmap_Release(pBitmap);
        return null_ret;
    }

    /* ---- 4. Create PNG encoder ---- */
    IWICBitmapEncoder *pEncoder = NULL;
    hr = IWICImagingFactory_CreateEncoder(inst->factory, &GUID_ContainerFormatPng,
                                          NULL, &pEncoder);
    if (FAILED(hr) || !pEncoder) {
        IWICStream_Release(pStream); IWICBitmap_Release(pBitmap);
        return null_ret;
    }
    hr = IWICBitmapEncoder_Initialize(pEncoder, (IStream*)pStream,
                                       WICBitmapEncoderNoCache);
    if (FAILED(hr)) {
        IWICBitmapEncoder_Release(pEncoder);
        IWICStream_Release(pStream); IWICBitmap_Release(pBitmap);
        return null_ret;
    }

    /* ---- 5. Create frame and write bitmap ---- */
    IWICBitmapFrameEncode *pFrame = NULL;
    IPropertyBag2 *pProps = NULL;
    hr = IWICBitmapEncoder_CreateNewFrame(pEncoder, &pFrame, &pProps);
    if (FAILED(hr) || !pFrame) {
        IWICBitmapEncoder_Release(pEncoder);
        IWICStream_Release(pStream); IWICBitmap_Release(pBitmap);
        return null_ret;
    }
    if (pProps) { IPropertyBag2_Release(pProps); pProps = NULL; }

    hr = IWICBitmapFrameEncode_Initialize(pFrame, NULL);
    if (SUCCEEDED(hr)) hr = IWICBitmapFrameEncode_WriteSource(pFrame,
                                  (IWICBitmapSource*)pBitmap, NULL);
    if (SUCCEEDED(hr)) hr = IWICBitmapFrameEncode_Commit(pFrame);
    if (SUCCEEDED(hr)) hr = IWICBitmapEncoder_Commit(pEncoder);

    IWICBitmapFrameEncode_Release(pFrame);
    IWICBitmapEncoder_Release(pEncoder);
    IWICStream_Release(pStream);
    IWICBitmap_Release(pBitmap);

    if (FAILED(hr)) return null_ret;

    napi_value ret; napi_get_boolean(env, 1, &ret);
    return ret;
}

/* ------------------------------------------------------------------ *
 *  IconExtractor constructor                                          *
 * ------------------------------------------------------------------ */

static napi_value ie_Constructor(napi_env env, napi_callback_info info) {
    napi_value this_val;
    napi_get_cb_info(env, info, NULL, NULL, &this_val, NULL);

    IconExtractorInst *inst = (IconExtractorInst*)calloc(1, sizeof(IconExtractorInst));
    napi_wrap(env, this_val, inst, ie_finalize, NULL, NULL);
    return this_val;
}

/* ------------------------------------------------------------------ *
 *  Module init                                                        *
 * ------------------------------------------------------------------ */

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor methods[] = {
        { "initialize",  NULL, ie_Initialize,  NULL, NULL, NULL, napi_default, NULL },
        { "cleanup",     NULL, ie_Cleanup,     NULL, NULL, NULL, napi_default, NULL },
        { "extractIcon", NULL, ie_ExtractIcon, NULL, NULL, NULL, napi_default, NULL },
    };

    napi_value ctor;
    napi_define_class(env, "IconExtractor", NAPI_AUTO_LENGTH, ie_Constructor,
                      NULL, sizeof(methods) / sizeof(methods[0]), methods, &ctor);
    napi_set_named_property(env, exports, "IconExtractor", ctor);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
