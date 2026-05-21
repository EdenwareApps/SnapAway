#include <node_api.h>
#include <stdbool.h>

static bool g_initialized = false;

static napi_value make_bool(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value InitializeAudio(napi_env env, napi_callback_info info) {
  (void)info;
  g_initialized = true;
  return make_bool(env, true);
}

static napi_value CleanupAudio(napi_env env, napi_callback_info info) {
  (void)info;
  g_initialized = false;
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value MuteProcess(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_status status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (status != napi_ok || argc < 2) {
    napi_throw_type_error(env, NULL, "Wrong number of arguments");
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }

  napi_valuetype t0;
  napi_valuetype t1;
  napi_typeof(env, args[0], &t0);
  napi_typeof(env, args[1], &t1);
  if (t0 != napi_number || t1 != napi_boolean) {
    napi_throw_type_error(env, NULL, "Wrong arguments");
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }

  if (!g_initialized) {
    return make_bool(env, false);
  }

  // Temporary C N-API shim: keeps module load-safe in Electron.
  // Full native audio implementation will be migrated incrementally.
  return make_bool(env, false);
}

static napi_value HasActiveAudioSession(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_status status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (status != napi_ok || argc < 1) {
    napi_throw_type_error(env, NULL, "Wrong number of arguments");
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }

  napi_valuetype t0;
  napi_typeof(env, args[0], &t0);
  if (t0 != napi_number) {
    napi_throw_type_error(env, NULL, "Wrong arguments");
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }

  if (!g_initialized) {
    return make_bool(env, false);
  }

  return make_bool(env, false);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn_init;
  napi_value fn_cleanup;
  napi_value fn_mute;
  napi_value fn_has;

  napi_create_function(env, "initializeAudio", NAPI_AUTO_LENGTH, InitializeAudio, NULL, &fn_init);
  napi_set_named_property(env, exports, "initializeAudio", fn_init);

  napi_create_function(env, "cleanupAudio", NAPI_AUTO_LENGTH, CleanupAudio, NULL, &fn_cleanup);
  napi_set_named_property(env, exports, "cleanupAudio", fn_cleanup);

  napi_create_function(env, "muteProcess", NAPI_AUTO_LENGTH, MuteProcess, NULL, &fn_mute);
  napi_set_named_property(env, exports, "muteProcess", fn_mute);

  napi_create_function(env, "hasActiveAudioSession", NAPI_AUTO_LENGTH, HasActiveAudioSession, NULL, &fn_has);
  napi_set_named_property(env, exports, "hasActiveAudioSession", fn_has);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
