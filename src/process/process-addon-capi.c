/*
 * process-addon-capi.c
 * Pure C N-API implementation of ProcessManager native addon.
 * Exports a `ProcessManager` JS class whose instances expose window/process Win32 APIs.
 * Built as a .c file so the linker emits correct delay-load structure for node.exe.
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

static void hwnd_to_str(HWND h, char *buf, size_t n) {
    snprintf(buf, n, "%p", (void*)h);
}

/* Parse a HWND from the hex pointer string produced by hwnd_to_str */
static HWND str_to_hwnd(const char *s) {
    return (HWND)(uintptr_t)strtoull(s, NULL, 16);
}

static HANDLE str_to_handle(const char *s) {
    return (HANDLE)(uintptr_t)strtoull(s, NULL, 16);
}

/* Convert wide string to UTF-8, returns number of bytes written (excl NUL) */
static int wide_to_utf8(const wchar_t *w, char *buf, int bufsize) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, buf, bufsize, NULL, NULL);
    return n > 0 ? n - 1 : 0;
}

/* Get one string argument from N-API callback info */
static napi_status get_string_arg(napi_env env, napi_callback_info info,
                                  size_t idx, char *buf, size_t bufsz,
                                  size_t argc_min, napi_value *argv_out,
                                  size_t *argc_out) {
    size_t argc = (idx + 1 > argc_min) ? idx + 1 : argc_min;
    napi_value argv_local[8];
    if (argc > 8) {
        return napi_invalid_arg;
    }
    napi_value *argv = argv_local;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc_out) *argc_out = argc;
    if (argv_out) {
        for (size_t i = 0; i < argc; i++) argv_out[i] = argv[i];
    }
    size_t written;
    return napi_get_value_string_utf8(env, argv[idx], buf, bufsz, &written);
}

/* ------------------------------------------------------------------ *
 *  EnumWindows callback context                                       *
 * ------------------------------------------------------------------ */

typedef struct {
    napi_env env;
    napi_value arr;
    uint32_t count;
} EnumCtx;

static BOOL CALLBACK enum_proc(HWND hwnd, LPARAM lp) {
    EnumCtx *ctx = (EnumCtx*)lp;

    char hwnd_str[64];
    hwnd_to_str(hwnd, hwnd_str, sizeof(hwnd_str));

    wchar_t wbuf[512];
    char title[2048] = {0};
    GetWindowTextW(hwnd, wbuf, 512);
    wide_to_utf8(wbuf, title, sizeof(title));

    char classname[1024] = {0};
    GetClassNameW(hwnd, wbuf, 512);
    wide_to_utf8(wbuf, classname, sizeof(classname));

    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);

    napi_value obj, v_hwnd, v_title, v_class, v_pid;
    napi_create_object(ctx->env, &obj);
    napi_create_string_utf8(ctx->env, hwnd_str, NAPI_AUTO_LENGTH, &v_hwnd);
    napi_create_string_utf8(ctx->env, title,    NAPI_AUTO_LENGTH, &v_title);
    napi_create_string_utf8(ctx->env, classname,NAPI_AUTO_LENGTH, &v_class);
    napi_create_uint32(ctx->env, (uint32_t)pid, &v_pid);

    napi_set_named_property(ctx->env, obj, "hwnd",      v_hwnd);
    napi_set_named_property(ctx->env, obj, "title",     v_title);
    napi_set_named_property(ctx->env, obj, "className", v_class);
    napi_set_named_property(ctx->env, obj, "processId", v_pid);
    napi_set_element(ctx->env, ctx->arr, ctx->count++, obj);
    return TRUE;
}

/* ------------------------------------------------------------------ *
 *  ProcessManager instance methods                                    *
 * ------------------------------------------------------------------ */

static napi_value pm_EnumWindows(napi_env env, napi_callback_info info) {
    napi_value arr;
    napi_create_array(env, &arr);
    EnumCtx ctx = { env, arr, 0 };
    EnumWindows(enum_proc, (LPARAM)&ctx);
    return arr;
}

static napi_value pm_ShowWindow(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    char hwnd_str[64];
    size_t len;
    napi_get_value_string_utf8(env, argv[0], hwnd_str, sizeof(hwnd_str), &len);
    int32_t cmd;
    napi_get_value_int32(env, argv[1], &cmd);

    HWND hwnd = str_to_hwnd(hwnd_str);
    BOOL ok = ShowWindow(hwnd, cmd);

    napi_value ret;
    napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value pm_IsWindow(napi_env env, napi_callback_info info) {
    char s[64]; size_t l;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    BOOL ok = IsWindow(str_to_hwnd(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value pm_IsWindowVisible(napi_env env, napi_callback_info info) {
    char s[64]; size_t l;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    BOOL ok = IsWindowVisible(str_to_hwnd(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value pm_IsHungAppWindow(napi_env env, napi_callback_info info) {
    char s[64]; size_t l;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    BOOL ok = IsHungAppWindow(str_to_hwnd(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value pm_GetWindowText(napi_env env, napi_callback_info info) {
    char s[64]; size_t l;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    wchar_t wbuf[512] = {0};
    GetWindowTextW(str_to_hwnd(s), wbuf, 512);
    char utf8[2048] = {0};
    wide_to_utf8(wbuf, utf8, sizeof(utf8));
    napi_value ret; napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value pm_GetClassName(napi_env env, napi_callback_info info) {
    char s[64]; size_t l;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    wchar_t wbuf[512] = {0};
    GetClassNameW(str_to_hwnd(s), wbuf, 512);
    char utf8[2048] = {0};
    wide_to_utf8(wbuf, utf8, sizeof(utf8));
    napi_value ret; napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value pm_GetWindowThreadProcessId(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    DWORD pid = 0;
    DWORD tid = GetWindowThreadProcessId(str_to_hwnd(s), &pid);

    napi_value obj, v_tid, v_pid;
    napi_create_object(env, &obj);
    napi_create_uint32(env, (uint32_t)tid, &v_tid);
    napi_create_uint32(env, (uint32_t)pid, &v_pid);
    napi_set_named_property(env, obj, "threadId",  v_tid);
    napi_set_named_property(env, obj, "processId", v_pid);
    return obj;
}

static napi_value pm_GetExecutablePath(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    uint32_t pid;
    napi_get_value_uint32(env, argv[0], &pid);

    HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, (DWORD)pid);
    if (!h) {
        napi_value ret; napi_create_string_utf8(env, "", 0, &ret);
        return ret;
    }
    wchar_t wbuf[MAX_PATH] = {0};
    DWORD sz = MAX_PATH;
    BOOL ok = QueryFullProcessImageNameW(h, 0, wbuf, &sz);
    CloseHandle(h);

    char utf8[MAX_PATH * 3] = {0};
    if (ok) wide_to_utf8(wbuf, utf8, sizeof(utf8));
    napi_value ret; napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value pm_GetWindowLongPtr(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char s[64]; size_t len;
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    int32_t idx;
    napi_get_value_int32(env, argv[1], &idx);

    LONG_PTR lp = GetWindowLongPtrW(str_to_hwnd(s), idx);
    napi_value ret; napi_create_double(env, (double)lp, &ret);
    return ret;
}

static napi_value pm_GetWindow(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    char s[64]; size_t len;
    napi_get_value_string_utf8(env, argv[0], s, sizeof(s), &len);
    uint32_t cmd;
    napi_get_value_uint32(env, argv[1], &cmd);

    HWND result = GetWindow(str_to_hwnd(s), (UINT)cmd);
    if (!result) {
        napi_value null_val; napi_get_null(env, &null_val);
        return null_val;
    }
    char buf[64]; hwnd_to_str(result, buf, sizeof(buf));
    napi_value ret; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value pm_OpenProcess(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    uint32_t access; napi_get_value_uint32(env, argv[0], &access);
    bool inherit; napi_get_value_bool(env, argv[1], &inherit);
    uint32_t pid; napi_get_value_uint32(env, argv[2], &pid);

    HANDLE h = OpenProcess((DWORD)access, inherit ? TRUE : FALSE, (DWORD)pid);
    if (!h) {
        napi_value null_val; napi_get_null(env, &null_val);
        return null_val;
    }
    char buf[64]; snprintf(buf, sizeof(buf), "%p", h);
    napi_value ret; napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &ret);
    return ret;
}

static napi_value pm_CloseHandle(napi_env env, napi_callback_info info) {
    char s[64]; size_t len;
    get_string_arg(env, info, 0, s, sizeof(s), 1, NULL, NULL);
    BOOL ok = CloseHandle(str_to_handle(s));
    napi_value ret; napi_get_boolean(env, ok != 0, &ret);
    return ret;
}

static napi_value pm_QueryFullProcessImageName(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
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

/* ------------------------------------------------------------------ *
 *  ProcessManager constructor (no per-instance state)                *
 * ------------------------------------------------------------------ */

static napi_value pm_Constructor(napi_env env, napi_callback_info info) {
    napi_value this_val;
    napi_get_cb_info(env, info, NULL, NULL, &this_val, NULL);
    return this_val;
}

/* ------------------------------------------------------------------ *
 *  Module init                                                        *
 * ------------------------------------------------------------------ */

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor methods[] = {
        { "enumWindows",               NULL, pm_EnumWindows,               NULL, NULL, NULL, napi_default, NULL },
        { "showWindow",                NULL, pm_ShowWindow,                NULL, NULL, NULL, napi_default, NULL },
        { "isWindow",                  NULL, pm_IsWindow,                  NULL, NULL, NULL, napi_default, NULL },
        { "isWindowVisible",           NULL, pm_IsWindowVisible,           NULL, NULL, NULL, napi_default, NULL },
        { "isHungAppWindow",           NULL, pm_IsHungAppWindow,           NULL, NULL, NULL, napi_default, NULL },
        { "getWindowText",             NULL, pm_GetWindowText,             NULL, NULL, NULL, napi_default, NULL },
        { "getClassName",              NULL, pm_GetClassName,              NULL, NULL, NULL, napi_default, NULL },
        { "getWindowThreadProcessId",  NULL, pm_GetWindowThreadProcessId,  NULL, NULL, NULL, napi_default, NULL },
        { "getExecutablePath",         NULL, pm_GetExecutablePath,         NULL, NULL, NULL, napi_default, NULL },
        { "getWindowLongPtr",          NULL, pm_GetWindowLongPtr,          NULL, NULL, NULL, napi_default, NULL },
        { "getWindow",                 NULL, pm_GetWindow,                 NULL, NULL, NULL, napi_default, NULL },
        { "openProcess",               NULL, pm_OpenProcess,               NULL, NULL, NULL, napi_default, NULL },
        { "closeHandle",               NULL, pm_CloseHandle,               NULL, NULL, NULL, napi_default, NULL },
        { "queryFullProcessImageName", NULL, pm_QueryFullProcessImageName, NULL, NULL, NULL, napi_default, NULL },
    };

    napi_value ctor;
    napi_define_class(env, "ProcessManager", NAPI_AUTO_LENGTH, pm_Constructor,
                      NULL, sizeof(methods) / sizeof(methods[0]), methods, &ctor);
    napi_set_named_property(env, exports, "ProcessManager", ctor);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
