// Ponte para Windows.ApplicationModel.StartupTask (apps MSIX/Store).
//
// A identidade de pacote é atribuída POR PROCESSO e não é herdada por processos
// filhos: um powershell.exe lançado com execFile a partir do app empacotado sempre
// falha com 0x80070490 (ERROR_NOT_FOUND), mesmo que o manifesto declare a
// startupTask. Por isso a chamada WinRT precisa acontecer aqui dentro, no processo
// principal do Electron. No build EXE (sem identidade) as funções devolvem
// code = "no-identity" e o JavaScript segue pelo caminho de HKCU\...\Run.

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include <napi.h>
#include <windows.h>
#include <appmodel.h>

#include <sstream>
#include <string>
#include <utility>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.ApplicationModel.h>

namespace {

using winrt::Windows::ApplicationModel::StartupTask;
using winrt::Windows::ApplicationModel::StartupTaskState;

std::string HResultToHex(HRESULT hr) {
  std::stringstream ss;
  ss << "0x" << std::hex << std::uppercase << static_cast<uint32_t>(hr);
  return ss.str();
}

const char* StateName(StartupTaskState state) {
  switch (state) {
    case StartupTaskState::Enabled: return "Enabled";
    case StartupTaskState::EnabledByPolicy: return "EnabledByPolicy";
    case StartupTaskState::Disabled: return "Disabled";
    case StartupTaskState::DisabledByUser: return "DisabledByUser";
    case StartupTaskState::DisabledByPolicy: return "DisabledByPolicy";
    default: return "Unknown";
  }
}

std::string CurrentPackageFamilyName() {
  UINT32 length = 0;
  if (GetCurrentPackageFamilyName(&length, nullptr) != ERROR_INSUFFICIENT_BUFFER) {
    return std::string();
  }
  std::wstring buffer(length, L'\0');
  if (GetCurrentPackageFamilyName(&length, buffer.data()) != ERROR_SUCCESS) {
    return std::string();
  }
  buffer.resize(wcslen(buffer.c_str()));
  return winrt::to_string(buffer);
}

// O thread vem do pool do libuv e pode já ter sido inicializado por outro addon.
// Preferimos STA porque as APIs de StartupTask fazem marshalling de callbacks para
// o apartamento de origem: em STA esses callbacks só rodam se bombearmos a fila de
// mensagens, o que WaitForOperation faz no laço de espera.
struct ApartmentScope {
  bool ownsInitialization = false;
  bool singleThreaded = false;

  ApartmentScope() {
    try {
      winrt::init_apartment(winrt::apartment_type::single_threaded);
      ownsInitialization = true;
      singleThreaded = true;
    } catch (winrt::hresult_error const& error) {
      if (error.code() != RPC_E_CHANGED_MODE) {
        throw;
      }
      // O thread já estava em MTA: seguimos sem bombear mensagens.
      singleThreaded = false;
    }
  }

  ~ApartmentScope() {
    if (ownsInitialization) {
      try {
        winrt::uninit_apartment();
      } catch (...) {
      }
    }
  }

  bool ShouldPump() const { return singleThreaded; }

  ApartmentScope(const ApartmentScope&) = delete;
  ApartmentScope& operator=(const ApartmentScope&) = delete;
};

// Nunca usamos IAsyncOperation::get(): ele bloqueia o thread e, em STA, impede a
// entrega dos callbacks de conclusão (deadlock). Aqui consultamos IAsyncInfo::Status
// e só chamamos GetResults() quando o estado já é Completed.
template <typename T>
bool WaitForOperation(winrt::Windows::Foundation::IAsyncOperation<T> const& operation,
                      DWORD timeoutMs,
                      bool pumpMessages,
                      T& result,
                      std::string& error) {
  const auto info = operation.as<winrt::Windows::Foundation::IAsyncInfo>();
  const ULONGLONG start = GetTickCount64();

  while (info.Status() == winrt::Windows::Foundation::AsyncStatus::Started) {
    if (GetTickCount64() - start > timeoutMs) {
      try {
        info.Cancel();
      } catch (...) {
      }
      error = "timeout";
      return false;
    }
    if (pumpMessages) {
      MSG message;
      while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
      }
    }
    Sleep(15);
  }

  const auto status = info.Status();
  if (status != winrt::Windows::Foundation::AsyncStatus::Completed) {
    std::stringstream ss;
    if (status == winrt::Windows::Foundation::AsyncStatus::Error) {
      ss << "erro assincrono " << HResultToHex(info.ErrorCode());
    } else {
      ss << "status assincrono " << static_cast<int32_t>(status);
    }
    error = ss.str();
    return false;
  }

  result = operation.GetResults();
  return true;
}

struct Outcome {
  bool ok = false;
  std::string action;
  std::string state;
  std::string error;
  std::string hresult;
  std::string code;
  std::string packageFamilyName;
};

Outcome RunStartupTask(const std::string& action, const std::string& taskId) {
  Outcome outcome;
  outcome.action = action;
  outcome.packageFamilyName = CurrentPackageFamilyName();

  if (outcome.packageFamilyName.empty()) {
    outcome.code = "no-identity";
    outcome.error = "O processo nao tem identidade de pacote MSIX.";
    return outcome;
  }

  if (action != "get" && action != "enable" && action != "disable") {
    outcome.code = "bad-action";
    outcome.error = "Acao invalida: " + action;
    return outcome;
  }

  try {
    ApartmentScope apartment;
    auto id = winrt::to_hstring(taskId);

    StartupTask task{nullptr};
    std::string waitError;
    if (!WaitForOperation(StartupTask::GetAsync(id), 10000, apartment.ShouldPump(), task, waitError)) {
      outcome.code = "timeout";
      outcome.error = "StartupTask.GetAsync: " + waitError;
      return outcome;
    }

    if (!task) {
      outcome.code = "not-found";
      outcome.error = "O pacote nao declara a startupTask '" + taskId + "'.";
      return outcome;
    }

    if (action == "get") {
      outcome.state = StateName(task.State());
    } else if (action == "enable") {
      auto state = task.State();
      // RequestEnableAsync devolve o estado final. Quando o usuario desativou a
      // tarefa nas configuracoes do Windows a resposta continua DisabledByUser e
      // nao adianta insistir.
      if (state == StartupTaskState::Disabled) {
        StartupTaskState requested{StartupTaskState::Disabled};
        std::string enableError;
        if (WaitForOperation(task.RequestEnableAsync(), 20000, apartment.ShouldPump(), requested, enableError)) {
          state = requested;
        } else {
          // Reportamos o estado real lido da tarefa, sem inventar sucesso.
          outcome.code = "timeout";
          outcome.error = "RequestEnableAsync: " + enableError;
          state = task.State();
        }
      }
      outcome.state = StateName(state);
    } else {
      if (task.State() != StartupTaskState::Disabled) {
        task.Disable();
      }
      StartupTask again{nullptr};
      std::string reloadError;
      if (WaitForOperation(StartupTask::GetAsync(id), 10000, apartment.ShouldPump(), again, reloadError)) {
        outcome.state = StateName(again ? again.State() : task.State());
      } else {
        outcome.state = StateName(task.State());
      }
    }

    outcome.ok = true;
  } catch (winrt::hresult_error const& error) {
    outcome.hresult = HResultToHex(error.code());
    outcome.error = winrt::to_string(error.message());
    outcome.code = (error.code() == HRESULT_FROM_WIN32(ERROR_NOT_FOUND)) ? "not-found" : "winrt-error";
  } catch (const std::exception& error) {
    outcome.error = error.what();
    outcome.code = "exception";
  }

  return outcome;
}

class StartupTaskWorker : public Napi::AsyncWorker {
 public:
  StartupTaskWorker(Napi::Env env, std::string action, std::string taskId)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        action_(std::move(action)),
        taskId_(std::move(taskId)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    try {
      outcome_ = RunStartupTask(action_, taskId_);
    } catch (const std::exception& error) {
      outcome_.action = action_;
      outcome_.error = error.what();
      outcome_.code = "exception";
    } catch (...) {
      outcome_.action = action_;
      outcome_.error = "Falha desconhecida na chamada WinRT.";
      outcome_.code = "exception";
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);

    Napi::Object result = Napi::Object::New(env);
    result.Set("ok", Napi::Boolean::New(env, outcome_.ok));
    result.Set("action", Napi::String::New(env, outcome_.action));
    SetOptional(env, result, "state", outcome_.state);
    SetOptional(env, result, "error", outcome_.error);
    SetOptional(env, result, "hresult", outcome_.hresult);
    SetOptional(env, result, "code", outcome_.code);
    SetOptional(env, result, "packageFamilyName", outcome_.packageFamilyName);
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

 private:
  static void SetOptional(Napi::Env env, Napi::Object target, const char* key, const std::string& value) {
    if (value.empty()) {
      target.Set(key, env.Null());
      return;
    }
    target.Set(key, Napi::String::New(env, value));
  }

  Napi::Promise::Deferred deferred_;
  std::string action_;
  std::string taskId_;
  Outcome outcome_;
};

Napi::Value StartupTaskAction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "startupTask(action, taskId?) espera uma string de acao").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string action = info[0].As<Napi::String>().Utf8Value();
  std::string taskId = "SnapAway";
  if (info.Length() > 1 && info[1].IsString()) {
    taskId = info[1].As<Napi::String>().Utf8Value();
  }

  auto* worker = new StartupTaskWorker(env, action, taskId);
  auto promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value PackageFamilyName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string name = CurrentPackageFamilyName();
  if (name.empty()) {
    return env.Null();
  }
  return Napi::String::New(env, name);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("startupTask", Napi::Function::New(env, StartupTaskAction, "startupTask"));
  exports.Set("packageFamilyName", Napi::Function::New(env, PackageFamilyName, "packageFamilyName"));
  return exports;
}

}  // namespace

NODE_API_MODULE(startup_addon, Init)
