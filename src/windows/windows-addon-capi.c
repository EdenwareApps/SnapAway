/*
 * windows-addon-capi.c
 * Pure C N-API implementation of the windows native addon.
 * Exports Win32 window-management functions directly (no JS class).
 * The JS-level wrapper (windows-wrapper.js) creates its own class on top.
 * Built as .c so the linker emits correct delay-load structure for node.exe.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ *
 *  Utility helpers                                                    *
 * ------------------------------------------------------------------ */

static void handle_to_str(void *h, char *buf, size_t n) {
    snprintf(buf, n, "%p", h);
}

static HWND str_to_hwnd(const char *s) {
    return (HWND)(uintptr_t)strtoull(s, NULL, 16);
}

static HANDLE str_to_handle(const char *s) {
    return (HANDLE)(uintptr_t)strtoull(s, NULL, 16);
}

static int wide_to_utf8(const wchar_t *w, char *buf, int sz) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, buf, sz, NULL, NULL);
    return n > 0 ? n - 1 : 0;
}

/* ------------------------------------------------------------------ *
 *  EnumWindows callback                                               *
 * ------------------------------------------------------------------ */

typedef struct {
    napi_env env;
    napi_value arr;
    uint32_t count;
} EnumCtx;

static BOOL CALLBACK enum_proc(HWND hwnd, LPARAM lp) {
    EnumCtx *ctx = (EnumCtx*)lp;
    char buf[64];
    handle_to_str((void*)hwnd, buf, sizeof(buf));
    napi_value str;
    napi_create_string_utf8(ctx->env, buf, NAPI_AUTO_LENGTH, &str);
    napi_set_element(ctx->env, ctx->arr, ctx->count++, str);
    return TRUE;
}

/* ------------------------------------------------------------------ *
 *  Exported functions                                                 *
 * ------------------------------------------------------------------ */

static napi_value fn_FindWindow(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    char cls[512] = {0}, name[512] = {0};
    size_t len;
    napi_get_value_string_utf8(env, argv[0], cls,  sizeof(cls),  &len);
    napi_get_value_string_utf8(env, argv[1], name, sizeof(name), &len);

    HWND hwnd = FindWindowA(cls[0]  ? cls  : NULL,
                            name[0] ? name : NULL);
    if (!hwnd) {
        napi_value null_val; napi_get_null(env, &null_val);
        return null_val;
    }
    char buf[64]; handle_to_str((void*)hwnd, buf, sizeof(buf));
    napi_value ret; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value fn_ShowWindow(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char s[64]; size_t len;
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    int32_t cmd; napi_get_value_int32(env, argv[1], &cmd);
    BOOL ok = ShowWindow(str_to_hwnd(s), cmd);
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value fn_HideWindow(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    BOOL ok = ShowWindow(str_to_hwnd(s), SW_HIDE);
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value fn_GetWindowText(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    char buf[1024] = {0};
    GetWindowTextA(str_to_hwnd(s), buf, sizeof(buf));
    napi_value ret; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value fn_IsWindow(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    BOOL ok = IsWindow(str_to_hwnd(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value fn_IsWindowVisible(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    BOOL ok = IsWindowVisible(str_to_hwnd(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value fn_IsHungAppWindow(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    BOOL ok = IsHungAppWindow(str_to_hwnd(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value fn_GetWindowThreadProcessId(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    DWORD pid = 0;
    DWORD tid = GetWindowThreadProcessId(str_to_hwnd(s), &pid);
    napi_value obj, v_pid, v_tid;
    napi_create_object(env, &obj);
    napi_create_uint32(env, (uint32_t)pid, &v_pid);
    napi_create_uint32(env, (uint32_t)tid, &v_tid);
    napi_set_named_property(env, obj, "processId", v_pid);
    napi_set_named_property(env, obj, "threadId",  v_tid);
    return obj;
}

static napi_value fn_GetClassName(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    wchar_t wbuf[512] = {0};
    GetClassNameW(str_to_hwnd(s), wbuf, 512);
    char utf8[2048] = {0};
    wide_to_utf8(wbuf, utf8, sizeof(utf8));
    napi_value ret; napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value fn_GetWindowLongPtr(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char s[64]; size_t len;
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    int32_t idx; napi_get_value_int32(env, argv[1], &idx);
    LONG_PTR lp = GetWindowLongPtrW(str_to_hwnd(s), idx);
    napi_value ret; napi_create_double(env, (double)lp, &ret);
    return ret;
}

static napi_value fn_GetWindow(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char s[64]; size_t len;
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    uint32_t cmd; napi_get_value_uint32(env, argv[1], &cmd);
    HWND result = GetWindow(str_to_hwnd(s), (UINT)cmd);
    if (!result) {
        napi_value null_val; napi_get_null(env, &null_val);
        return null_val;
    }
    char buf[64]; handle_to_str((void*)result, buf, sizeof(buf));
    napi_value ret; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value fn_EnumWindows(napi_env env, napi_callback_info info) {
    /* callback parameter is accepted but the native function returns the
       full array directly, matching the behavior of the original C++ addon */
    napi_value arr; napi_create_array(env, &arr);
    EnumCtx ctx = { env, arr, 0 };
    EnumWindows(enum_proc, (LPARAM)&ctx);
    return arr;
}

static napi_value fn_OpenProcess(napi_env env, napi_callback_info info) {
    size_t argc = 3; napi_value argv[3];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    uint32_t access; napi_get_value_uint32(env, argv[0], &access);
    bool inherit; napi_get_value_bool(env, argv[1], &inherit);
    uint32_t pid; napi_get_value_uint32(env, argv[2], &pid);
    HANDLE h = OpenProcess((DWORD)access, inherit ? TRUE : FALSE, (DWORD)pid);
    if (!h) {
        napi_value null_val; napi_get_null(env, &null_val);
        return null_val;
    }
    char buf[64]; handle_to_str(h, buf, sizeof(buf));
    napi_value ret; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value fn_QueryFullProcessImageName(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char s[64]; size_t len;
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    uint32_t flags; napi_get_value_uint32(env, argv[1], &flags);

    HANDLE h = str_to_handle(s);
    wchar_t wbuf[MAX_PATH] = {0};
    DWORD sz = MAX_PATH;
    BOOL ok = QueryFullProcessImageNameW(h, (DWORD)flags, wbuf, &sz);
    char utf8[MAX_PATH * 3] = {0};
    if (ok) wide_to_utf8(wbuf, utf8, sizeof(utf8));
    napi_value ret; napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value fn_CloseHandle(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    size_t argc = 1; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    BOOL ok = CloseHandle(str_to_handle(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

/* ------------------------------------------------------------------ *
 *  Module init                                                        *
 * ------------------------------------------------------------------ */

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor fns[] = {
        { "findWindow",               NULL, fn_FindWindow,               NULL, NULL, NULL, napi_default, NULL },
        { "showWindow",               NULL, fn_ShowWindow,               NULL, NULL, NULL, napi_default, NULL },
        { "hideWindow",               NULL, fn_HideWindow,               NULL, NULL, NULL, napi_default, NULL },
        { "getWindowText",            NULL, fn_GetWindowText,            NULL, NULL, NULL, napi_default, NULL },
        { "isWindow",                 NULL, fn_IsWindow,                 NULL, NULL, NULL, napi_default, NULL },
        { "isWindowVisible",          NULL, fn_IsWindowVisible,          NULL, NULL, NULL, napi_default, NULL },
        { "isHungAppWindow",          NULL, fn_IsHungAppWindow,          NULL, NULL, NULL, napi_default, NULL },
        { "getWindowThreadProcessId", NULL, fn_GetWindowThreadProcessId, NULL, NULL, NULL, napi_default, NULL },
        { "getClassName",             NULL, fn_GetClassName,             NULL, NULL, NULL, napi_default, NULL },
        { "getWindowLongPtr",         NULL, fn_GetWindowLongPtr,         NULL, NULL, NULL, napi_default, NULL },
        { "getWindow",                NULL, fn_GetWindow,                NULL, NULL, NULL, napi_default, NULL },
        { "enumWindows",              NULL, fn_EnumWindows,              NULL, NULL, NULL, napi_default, NULL },
        { "openProcess",              NULL, fn_OpenProcess,              NULL, NULL, NULL, napi_default, NULL },
        { "queryFullProcessImageName",NULL, fn_QueryFullProcessImageName,NULL, NULL, NULL, napi_default, NULL },
        { "closeHandle",              NULL, fn_CloseHandle,              NULL, NULL, NULL, napi_default, NULL },
    };

    napi_define_properties(env, exports, sizeof(fns) / sizeof(fns[0]), fns);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
