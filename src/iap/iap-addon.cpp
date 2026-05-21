#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>
#include <ctime>
#include <chrono>
#include <sstream>
#include <cstdio>
#include <cstring>
#include <thread>
#include <atomic>

// Declare IInitializeWithWindow inline to avoid shobjidl_core.h / WinRT IUnknown ambiguity.
// The GUID is the official COM interface GUID for IInitializeWithWindow.
struct __declspec(uuid("3E68D4BD-7135-4D10-8018-9FB6D9F33FA1")) IInitializeWithWindowNative {
    virtual HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppvObject) = 0;
    virtual ULONG   STDMETHODCALLTYPE AddRef() = 0;
    virtual ULONG   STDMETHODCALLTYPE Release() = 0;
    virtual HRESULT STDMETHODCALLTYPE Initialize(HWND hwnd) = 0;
};

#include <winrt/base.h>
#include <winrt/Windows.Services.Store.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.System.h>

using namespace winrt;
using namespace Windows::Services::Store;
using namespace Windows::Foundation;
using namespace Windows::Foundation::Collections;

static std::string JsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() * 2);
  for (char c : value) {
    switch (c) {
      case '"': escaped += "\\\""; break;
      case '\\': escaped += "\\\\"; break;
      case '\b': escaped += "\\b"; break;
      case '\f': escaped += "\\f"; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[7];
          sprintf_s(buf, "\\u%04x", static_cast<unsigned char>(c));
          escaped += buf;
        } else {
          escaped += c;
        }
    }
  }
  return escaped;
}

// Thread-local flag to ensure the WinRT apartment is initialized once per thread
static thread_local bool g_apartmentInitialized = false;

static std::string HResultToHex(HRESULT hr) {
  std::stringstream ss;
  ss << "0x" << std::hex << std::uppercase << static_cast<uint32_t>(hr);
  return ss.str();
}

static const std::string DefaultStoreProductId = "9NNLVZPCLLTZ";

static std::string GetStoreContextUserId(const StoreContext& context) {
  try {
    auto user = context.User();
    if (user != nullptr) {
      return winrt::to_string(user.NonRoamableId());
    }
  } catch (...) {
  }
  return std::string();
}

static bool StringEqualsIgnoreCase(const char* a, const char* b) {
  return _stricmp(a, b) == 0;
}

static void LogStoreOperationDuration(const std::string& operationName, const std::chrono::steady_clock::time_point& start) {
  auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
  printf("[IAP-NATIVE] %s took %lld ms\n", operationName.c_str(), static_cast<long long>(elapsedMs));
}

bool EnsureWinRTApartment() {
  if (g_apartmentInitialized) {
    return true;
  }

  try {
    printf("[IAP-NATIVE] init_apartment(single_threaded)\n");
    init_apartment(apartment_type::single_threaded);
    g_apartmentInitialized = true;
    return true;
  } catch (const std::exception& e) {
    printf("[IAP-NATIVE] init_apartment failed: %s\n", e.what());
    return false;
  } catch (...) {
    printf("[IAP-NATIVE] init_apartment failed with unknown exception\n");
    return false;
  }
}

// Helper function to verify whether a StoreContext already has a valid user
static bool HasValidStoreContextUser(const StoreContext& context) {
  try {
    auto user = context.User();
    return user != nullptr;
  } catch (...) {
    return false;
  }
}

// Helper function to get a StoreContext for the current user, if default fails.
bool TryGetStoreContextForCurrentUser(StoreContext& context) {
  try {
    auto users = Windows::System::User::FindAllAsync().get();
    if (!users) {
      return false;
    }

    for (auto user : users) {
      if (!user) {
        continue;
      }

      try {
        auto candidate = StoreContext::GetForUser(user);
        if (candidate != nullptr && HasValidStoreContextUser(candidate)) {
          context = candidate;
          printf("[IAP-NATIVE] TryGetStoreContextForCurrentUser succeeded with user id %s\n", winrt::to_string(user.NonRoamableId()).c_str());
          return true;
        }
      } catch (...) {
        continue;
      }
    }
  } catch (...) {
    return false;
  }

  return false;
}

// Helper function to get a StoreContext for the current thread
bool TryGetStoreContext(StoreContext& context) {
  try {
    context = StoreContext::GetDefault();
    if (context != nullptr && HasValidStoreContextUser(context)) {
      return true;
    }
  } catch (...) {
  }

  return TryGetStoreContextForCurrentUser(context);
}

static IVector<hstring> CreateStoreProductKinds() {
  IVector<hstring> productKinds = single_threaded_vector<hstring>();
  productKinds.Append(hstring(L"Durable"));
  productKinds.Append(hstring(L"Consumable"));
  productKinds.Append(hstring(L"UnmanagedConsumable"));
  productKinds.Append(hstring(L"Subscription"));
  return productKinds;
}

// Common helper for async worker results
struct IapProductInfo {
  std::string id;
  std::string title;
  std::string description;
  std::string price;
  std::string currency;
};

class IapWorker : public Napi::AsyncWorker {
public:
  IapWorker(Napi::Env env)
    : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() const { return deferred_.Promise(); }

protected:
  void OnError(const Napi::Error& e) override {
    deferred_.Reject(e.Value());
  }

  Napi::Promise::Deferred deferred_;
};

class CheckOwnershipWorker : public IapWorker {
public:
  CheckOwnershipWorker(Napi::Env env, const std::string& productId)
    : IapWorker(env), productId_(productId), isOwned_(false) {}

  void Execute() override {
    if (!EnsureWinRTApartment()) {
      SetError("Store context unavailable");
      return;
    }

    StoreContext storeContext = nullptr;
    if (!TryGetStoreContext(storeContext)) {
      SetError("Store context unavailable");
      return;
    }

    auto appLicense = storeContext.GetAppLicenseAsync().get();
    if (appLicense == nullptr) {
      return;
    }

    auto addOnLicenses = appLicense.AddOnLicenses();
    try {
      std::wstring wstr(productId_.begin(), productId_.end());
      hstring productIdHStr(wstr);
      if (addOnLicenses.HasKey(productIdHStr)) {
        isOwned_ = true;
      }
    } catch (...) {
      isOwned_ = false;
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("isOwned", Napi::Boolean::New(env, isOwned_));
    result.Set("productId", Napi::String::New(env, productId_));
    result.Set("timestamp", Napi::Number::New(env, std::time(nullptr)));
    deferred_.Resolve(result);
  }

private:
  std::string productId_;
  bool isOwned_;
};

class GetLicenseInfoWorker : public IapWorker {
public:
  GetLicenseInfoWorker(Napi::Env env)
    : IapWorker(env), isPro_(false), appLimit_(2) {}

  void Execute() override {
    if (!EnsureWinRTApartment()) {
      SetError("Store context unavailable");
      return;
    }

    StoreContext storeContext = nullptr;
    if (!TryGetStoreContext(storeContext)) {
      SetError("Store context unavailable");
      return;
    }

    auto appLicense = storeContext.GetAppLicenseAsync().get();
    if (!appLicense) {
      return;
    }

    auto addOnLicenses = appLicense.AddOnLicenses();
    isPro_ = addOnLicenses.Size() > 0;
    appLimit_ = 2;

    for (auto pair : addOnLicenses) {
      auto storeLicense = pair.Value();
      auto skuStoreId = storeLicense.SkuStoreId();
      auto expirationDate = storeLicense.ExpirationDate();

      char dateStr[128] = {0};
      __int64 filetime = expirationDate.time_since_epoch().count();
      const __int64 EPOCH_DIFF = 116444736000000000LL;
      time_t unixTime = (filetime - EPOCH_DIFF) / 10000000;
      struct tm* tm_info = gmtime(&unixTime);
      std::string expirationDateStr = "";
      if (tm_info) {
        strftime(dateStr, sizeof(dateStr), "%Y-%m-%dT%H:%M:%SZ", tm_info);
        expirationDateStr = std::string(dateStr);
      }

      LicenseFeature feature;
      feature.id = winrt::to_string(skuStoreId);
      feature.expirationDate = expirationDateStr;
      features_.push_back(feature);
      if (!expirationDateStr.empty()) {
        expirationDate_ = expirationDateStr;
      }
    }

    // Fallback: if no add-on licenses found, check if the Pro product is in the user's
    // collection via GetStoreProductsAsync. This handles the case where the purchase was
    // recorded as an app-level purchase rather than a DLC add-on.
    if (!isPro_) {
      try {
        auto productKinds = CreateStoreProductKinds();
        auto storeIds = single_threaded_vector<hstring>();
        std::wstring productW(DefaultStoreProductId.begin(), DefaultStoreProductId.end());
        storeIds.Append(hstring(productW));

        auto fallbackStart = std::chrono::steady_clock::now();
        auto productsResult = storeContext.GetStoreProductsAsync(productKinds, storeIds).get();
        LogStoreOperationDuration("GetLicenseInfo.GetStoreProductsAsync", fallbackStart);

        if (productsResult && productsResult.Products().Size() > 0) {
          for (auto pair : productsResult.Products()) {
            auto product = pair.Value();
            if (product.IsInUserCollection()) {
              printf("[IAP-NATIVE] GetLicenseInfo: product %s IsInUserCollection=true, marking as Pro\n",
                     winrt::to_string(product.StoreId()).c_str());
              isPro_ = true;

              LicenseFeature feature;
              feature.id = winrt::to_string(product.StoreId());
              feature.expirationDate = "";
              features_.push_back(feature);
              break;
            }
          }
        }
      } catch (...) {
        printf("[IAP-NATIVE] GetLicenseInfo: GetStoreProductsAsync fallback failed\n");
      }
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("isPro", Napi::Boolean::New(env, isPro_));
    result.Set("expirationDate", Napi::String::New(env, expirationDate_));
    result.Set("appLimit", Napi::Number::New(env, appLimit_));

    Napi::Array featureArray = Napi::Array::New(env, features_.size());
    for (size_t i = 0; i < features_.size(); ++i) {
      Napi::Object featureObj = Napi::Object::New(env);
      featureObj.Set("id", Napi::String::New(env, features_[i].id));
      featureObj.Set("expirationDate", Napi::String::New(env, features_[i].expirationDate));
      featureArray.Set(i, featureObj);
    }
    result.Set("features", featureArray);
    deferred_.Resolve(result);
  }

private:
  struct LicenseFeature { std::string id; std::string expirationDate; };
  bool isPro_;
  int appLimit_;
  std::string expirationDate_;
  std::vector<LicenseFeature> features_;
};

class GetProductsWorker : public IapWorker {
public:
  GetProductsWorker(Napi::Env env)
    : IapWorker(env) {}

  void Execute() override {
    if (!EnsureWinRTApartment()) {
      SetError("Store context unavailable");
      return;
    }

    StoreContext storeContext = nullptr;
    if (!TryGetStoreContext(storeContext)) {
      SetError("Store context unavailable");
      return;
    }

    auto user = storeContext.User();
    bool userValid = user != nullptr;
    printf("[IAP-NATIVE] GetProductsWorker StoreContext user valid: %s\n", userValid ? "true" : "false");

    auto productKinds = CreateStoreProductKinds();
    auto start = std::chrono::steady_clock::now();
    auto storeProductsResult = storeContext.GetAssociatedStoreProductsAsync(productKinds).get();
    LogStoreOperationDuration("GetAssociatedStoreProductsAsync", start);

    if (!storeProductsResult || storeProductsResult.Products().Size() == 0) {
      printf("[IAP-NATIVE] GetAssociatedStoreProductsAsync returned no products, trying GetStoreProductsAsync fallback\n");
      auto fallbackStart = std::chrono::steady_clock::now();
      auto storeIds = single_threaded_vector<hstring>();
      std::wstring productW(DefaultStoreProductId.begin(), DefaultStoreProductId.end());
      storeIds.Append(hstring(productW));
      auto fallbackResult = storeContext.GetStoreProductsAsync(productKinds, storeIds).get();
      LogStoreOperationDuration("GetStoreProductsAsync", fallbackStart);
      if (fallbackResult && fallbackResult.Products().Size() > 0) {
        storeProductsResult = fallbackResult;
      }
    }

    if (!storeProductsResult) {
      return;
    }

    for (auto pair : storeProductsResult.Products()) {
      auto storeProduct = pair.Value();
      IapProductInfo info;
      info.id = winrt::to_string(storeProduct.StoreId());
      info.title = winrt::to_string(storeProduct.Title());
      info.description = winrt::to_string(storeProduct.Description());
      auto price = storeProduct.Price();
      if (price != nullptr) {
        info.price = winrt::to_string(price.FormattedPrice());
        info.currency = winrt::to_string(price.CurrencyCode());
      }
      products_.push_back(std::move(info));
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array result = Napi::Array::New(env, products_.size());
    for (size_t i = 0; i < products_.size(); ++i) {
      Napi::Object productObj = Napi::Object::New(env);
      productObj.Set("id", Napi::String::New(env, products_[i].id));
      productObj.Set("title", Napi::String::New(env, products_[i].title));
      productObj.Set("description", Napi::String::New(env, products_[i].description));
      productObj.Set("price", Napi::String::New(env, products_[i].price));
      productObj.Set("currency", Napi::String::New(env, products_[i].currency));
      result.Set(i, productObj);
    }
    deferred_.Resolve(result);
  }

private:
  std::vector<IapProductInfo> products_;
};

class InitStoreContextWorker : public IapWorker {
public:
  InitStoreContextWorker(Napi::Env env)
    : IapWorker(env), initialized_(false) {}

  void Execute() override {
    if (!EnsureWinRTApartment()) {
      error_ = "Failed to initialize Store context";
      return;
    }

    StoreContext storeContext = nullptr;
    if (!TryGetStoreContext(storeContext)) {
      error_ = "Failed to initialize Store context";
      return;
    }

    auto user = storeContext.User();
    bool userValid = user != nullptr;
    storeContextUserValid_ = userValid;
    if (userValid) {
      storeContextUserId_ = GetStoreContextUserId(storeContext);
    }
    printf("[IAP-NATIVE] InitStoreContextWorker StoreContext user valid: %s userId=%s\n", userValid ? "true" : "false", storeContextUserId_.c_str());

    if (!userValid) {
      error_ = "StoreContext user invalid";
      initialized_ = false;
      return;
    }

    initialized_ = true;
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("initialized", Napi::Boolean::New(env, initialized_));
    result.Set("storeContextUserValid", Napi::Boolean::New(env, storeContextUserValid_));
    result.Set("storeContextUserId", Napi::String::New(env, storeContextUserId_));
    if (!initialized_) {
      result.Set("error", Napi::String::New(env, error_));
    }
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("initialized", Napi::Boolean::New(env, false));
    result.Set("storeContextUserValid", Napi::Boolean::New(env, storeContextUserValid_));
    result.Set("storeContextUserId", Napi::String::New(env, storeContextUserId_));
    result.Set("error", e.Message());
    deferred_.Resolve(result);
  }

private:
  bool initialized_;
  bool storeContextUserValid_ = false;
  std::string storeContextUserId_;
  std::string error_;
};

class RequestPurchaseWorker : public IapWorker {
public:
  RequestPurchaseWorker(Napi::Env env, const std::string& productId, uint32_t hwndLow, uint32_t hwndHigh)
    : IapWorker(env), productId_(productId), hwndLow_(hwndLow), hwndHigh_(hwndHigh),
      associatedCount_(0), associatedProductFound_(false), appLicenseAvailable_(false), licensedAddOnCount_(0), extendedErrorValue_(0) {}

  void Execute() override {
    if (!EnsureWinRTApartment()) {
      storeContextError_ = "Store context unavailable";
      error_ = "Store context unavailable";
      return;
    }

    StoreContext storeContext = nullptr;
    if (!TryGetStoreContext(storeContext)) {
      storeContextError_ = "StoreContext.GetDefault failed";
      error_ = "StoreContext.GetDefault failed";
      return;
    }

    auto user = storeContext.User();
    storeContextUserValid_ = user != nullptr;
    if (storeContextUserValid_) {
      try {
        storeContextUserId_ = winrt::to_string(user.NonRoamableId());
      } catch (...) {
        storeContextUserId_.clear();
      }
    } else {
      storeContextError_ = "StoreContext user invalid";
    }
    printf("[IAP-NATIVE] RequestPurchaseWorker StoreContext user valid: %s userId=%s\n",
           storeContextUserValid_ ? "true" : "false",
           storeContextUserId_.c_str());
    storeContextInitialized_ = true;

    if (!storeContextUserValid_) {
      status_ = "Error";
      error_ = "StoreContext user invalid";
      return;
    }

    auto productKinds = CreateStoreProductKinds();
    auto associatedStart = std::chrono::steady_clock::now();
    auto storeProductsResult = storeContext.GetAssociatedStoreProductsAsync(productKinds).get();
    LogStoreOperationDuration("GetAssociatedStoreProductsAsync", associatedStart);
    if (!storeProductsResult || storeProductsResult.Products().Size() == 0) {
      printf("[IAP-NATIVE] GetAssociatedStoreProductsAsync returned no products, trying GetStoreProductsAsync fallback\n");
      auto fallbackStart = std::chrono::steady_clock::now();
      auto storeIds = single_threaded_vector<hstring>();
      std::wstring productW(productId_.begin(), productId_.end());
      storeIds.Append(hstring(productW));
      auto fallbackResult = storeContext.GetStoreProductsAsync(productKinds, storeIds).get();
      LogStoreOperationDuration("GetStoreProductsAsync", fallbackStart);
      if (fallbackResult && fallbackResult.Products().Size() > 0) {
        storeProductsResult = fallbackResult;
      }
    }

    if (!storeProductsResult || storeProductsResult.Products().Size() == 0) {
      status_ = "NetworkError";
      error_ = "No associated Store products available";
      return;
    }

    associatedCount_ = storeProductsResult.Products().Size();
    bool firstId = true;
    std::stringstream jsonStream;
    jsonStream << '[';

    for (auto pair : storeProductsResult.Products()) {
      auto storeProductItem = pair.Value();
      const std::string storeId = winrt::to_string(storeProductItem.StoreId());
      const std::string title = JsonEscape(winrt::to_string(storeProductItem.Title()));
      const std::string description = JsonEscape(winrt::to_string(storeProductItem.Description()));
      std::string priceStr = "";
      std::string currencyStr = "";
      auto price = storeProductItem.Price();
      if (price != nullptr) {
        priceStr = JsonEscape(winrt::to_string(price.FormattedPrice()));
        currencyStr = JsonEscape(winrt::to_string(price.CurrencyCode()));
      }

      if (!firstId) {
        associatedProductIds_ += ", ";
        jsonStream << ',';
      }
      associatedProductIds_ += storeId;
      jsonStream << "{"
                 << "\"storeId\":\"" << JsonEscape(storeId) << "\",";
      jsonStream << "\"title\":\"" << title << "\",";
      jsonStream << "\"description\":\"" << description << "\",";
      jsonStream << "\"price\":\"" << priceStr << "\",";
      jsonStream << "\"currency\":\"" << currencyStr << "\"";
      jsonStream << "}";
      firstId = false;

      if (winrt::to_string(storeProductItem.StoreId()) == productId_) {
        storeProduct_ = storeProductItem;
        associatedProductFound_ = true;
      }
    }

    jsonStream << ']';
    associatedProductsJson_ = jsonStream.str();
    associationLoaded_ = associatedCount_ > 0;

    auto appLicense = storeContext.GetAppLicenseAsync().get();
    if (appLicense != nullptr) {
      appLicenseAvailable_ = true;
      auto addOnLicenses = appLicense.AddOnLicenses();
      licensedAddOnCount_ = addOnLicenses.Size();
      bool firstLicense = true;
      for (auto pair : addOnLicenses) {
        auto license = pair.Value();
        if (!firstLicense) licensedProductIds_ += ", ";
        licensedProductIds_ += winrt::to_string(license.SkuStoreId());
        firstLicense = false;
      }
    }

    if (!associationLoaded_) {
      status_ = "NetworkError";
      error_ = "No associated Store products available";
      return;
    }

    if (!associatedProductFound_) {
      status_ = "NotFound";
      error_ = "Requested product not found among associated Store products";
      return;
    }

    // Cache the StoreId string to avoid cross-apartment WinRT object access
    purchaseStoreId_ = winrt::to_string(storeProduct_.StoreId());

    // Phase 2: RequestPurchaseAsync must run on a dedicated STA thread with a
    // Win32 message pump so that the Windows Store purchase UI (XAML dialog)
    // can display and process user input. Running it on the N-API pool thread
    // without a message loop causes STATUS_STACK_BUFFER_OVERRUN (0xc0000409).
    RunPurchaseOnSTA();
  }

private:
  void RunPurchaseOnSTA() {
    std::thread staThread([this]() {
      ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
      DoRunPurchaseOnSTA();
      ::CoUninitialize();
    });
    staThread.join();
  }

  void DoRunPurchaseOnSTA() {
    StoreContext storeCtx = nullptr;
    if (!TryGetStoreContext(storeCtx)) {
      status_ = "Error";
      error_ = "StoreContext unavailable in STA thread";
      return;
    }

    // Associate the Electron main window so the Store purchase dialog can
    // be parented correctly. Required when using GetForUser() fallback.
    HWND hwnd = reinterpret_cast<HWND>(static_cast<uint64_t>(hwndHigh_) << 32 | static_cast<uint64_t>(hwndLow_));
    if (hwnd) {
      try {
        // Use raw QueryInterface via winrt::get_unknown() to avoid WinRT/COM IUnknown ambiguity
        auto storeUnk = winrt::get_unknown(storeCtx);
        IInitializeWithWindowNative* initPtr = nullptr;
        static const GUID iid = __uuidof(IInitializeWithWindowNative);
        if (SUCCEEDED(storeUnk->QueryInterface(iid, reinterpret_cast<void**>(&initPtr))) && initPtr) {
          HRESULT hr = initPtr->Initialize(hwnd);
          printf("[IAP-NATIVE] IInitializeWithWindow::Initialize HWND=%p hr=0x%08X\n", (void*)hwnd, static_cast<uint32_t>(hr));
          initPtr->Release();
        } else {
          printf("[IAP-NATIVE] IInitializeWithWindow QI failed (interface not available)\n");
        }
      } catch (...) {
        printf("[IAP-NATIVE] IInitializeWithWindow::Initialize threw\n");
      }
    } else {
      printf("[IAP-NATIVE] No HWND provided - purchase dialog may not display\n");
    }

    HANDLE hDone = ::CreateEvent(nullptr, TRUE, FALSE, nullptr);
    if (!hDone) {
      status_ = "Error";
      error_ = "CreateEvent failed";
      return;
    }

    std::atomic<bool> purchaseDone{false};
    auto purchaseStart = std::chrono::steady_clock::now();

    try {
      std::wstring productW(purchaseStoreId_.begin(), purchaseStoreId_.end());
      auto op = storeCtx.RequestPurchaseAsync(winrt::hstring(productW));

      op.Completed([this, hDone, &purchaseDone](
          winrt::Windows::Foundation::IAsyncOperation<StorePurchaseResult> const& operation,
          winrt::Windows::Foundation::AsyncStatus asyncStatus) {
        try {
          if (asyncStatus == winrt::Windows::Foundation::AsyncStatus::Completed) {
            auto result = operation.GetResults();
            StorePurchaseStatus s = result.Status();
            switch (s) {
              case StorePurchaseStatus::Succeeded:        status_ = "Purchased"; break;
              case StorePurchaseStatus::AlreadyPurchased: status_ = "AlreadyPurchased"; break;
              case StorePurchaseStatus::NotPurchased:     status_ = "NotPurchased"; break;
              case StorePurchaseStatus::NetworkError:     status_ = "NetworkError"; break;
              case StorePurchaseStatus::ServerError:      status_ = "ServerError"; break;
              default:                                    status_ = "Unknown"; break;
            }
            extendedErrorValue_ = static_cast<uint32_t>(result.ExtendedError().value);
            extendedErrorStr_ = HResultToHex(extendedErrorValue_);
            if (extendedErrorValue_ != 0) {
              printf("[IAP-NATIVE] RequestPurchaseAsync extendedError = 0x%08X\n", extendedErrorValue_);
            }
          } else if (asyncStatus == winrt::Windows::Foundation::AsyncStatus::Canceled) {
            status_ = "NotPurchased";
            error_ = "Purchase canceled by user";
          } else {
            status_ = "Error";
            error_ = "RequestPurchaseAsync operation failed";
          }
        } catch (const winrt::hresult_error& e) {
          status_ = "Error";
          error_ = "Exception in Completed: " + winrt::to_string(e.message());
        } catch (...) {
          status_ = "Error";
          error_ = "Unknown exception in Completed handler";
        }
        purchaseDone.store(true, std::memory_order_release);
        ::SetEvent(hDone);
      });
    } catch (const winrt::hresult_error& e) {
      status_ = "Error";
      error_ = "RequestPurchaseAsync threw: " + winrt::to_string(e.message());
      ::CloseHandle(hDone);
      return;
    } catch (...) {
      status_ = "Error";
      error_ = "RequestPurchaseAsync threw unknown exception";
      ::CloseHandle(hDone);
      return;
    }

    // Pump Win32 messages while waiting for the Store purchase UI to complete
    MSG msg;
    while (!purchaseDone.load(std::memory_order_acquire)) {
      DWORD waitResult = ::MsgWaitForMultipleObjectsEx(
          1, &hDone, 180000, QS_ALLINPUT, MWMO_ALERTABLE | MWMO_INPUTAVAILABLE);
      if (waitResult == WAIT_OBJECT_0) {
        break; // event signaled - operation complete
      } else if (waitResult == WAIT_OBJECT_0 + 1) {
        while (::PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
          ::TranslateMessage(&msg);
          ::DispatchMessage(&msg);
        }
      } else {
        // Timeout or unexpected error
        if (!purchaseDone.load()) {
          status_ = "NetworkError";
          error_ = "RequestPurchaseAsync timed out after 180s";
        }
        break;
      }
    }

    LogStoreOperationDuration("RequestPurchaseAsync(STA)", purchaseStart);
    ::CloseHandle(hDone);
  }

public:

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("status", Napi::String::New(env, status_));
    result.Set("productId", Napi::String::New(env, productId_));
    result.Set("storeContextInitialized", Napi::Boolean::New(env, storeContextInitialized_));
    result.Set("storeContextUserValid", Napi::Boolean::New(env, storeContextUserValid_));
    result.Set("storeContextUserId", Napi::String::New(env, storeContextUserId_));
    result.Set("storeContextError", Napi::String::New(env, storeContextError_));
    result.Set("associatedProductsLoaded", Napi::Boolean::New(env, associationLoaded_));
    result.Set("associatedProductsCount", Napi::Number::New(env, associatedCount_));
    result.Set("associatedProductFound", Napi::Boolean::New(env, associatedProductFound_));
    result.Set("associatedProductIds", Napi::String::New(env, associatedProductIds_));
    result.Set("associatedProductsJson", Napi::String::New(env, associatedProductsJson_));
    result.Set("appLicenseAvailable", Napi::Boolean::New(env, appLicenseAvailable_));
    result.Set("licensedAddOnCount", Napi::Number::New(env, licensedAddOnCount_));
    result.Set("licensedProductIds", Napi::String::New(env, licensedProductIds_));
    result.Set("extendedError", Napi::String::New(env, extendedErrorStr_));
    result.Set("extendedErrorCode", Napi::Number::New(env, extendedErrorValue_));
    if (!error_.empty()) {
      result.Set("error", Napi::String::New(env, error_));
    }
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("status", Napi::String::New(env, "Error"));
    result.Set("error", e.Message());
    deferred_.Resolve(result);
  }

private:
  std::string productId_;
  std::string purchaseStoreId_;
  uint32_t hwndLow_ = 0;
  uint32_t hwndHigh_ = 0;
  StoreProduct storeProduct_{ nullptr };
  bool storeContextInitialized_ = false;
  bool storeContextUserValid_ = false;
  std::string storeContextUserId_;
  std::string storeContextError_;
  bool associationLoaded_ = false;
  uint32_t associatedCount_ = 0;
  std::string associatedProductIds_;
  std::string associatedProductsJson_;
  bool associatedProductFound_ = false;
  bool appLicenseAvailable_ = false;
  uint32_t licensedAddOnCount_ = 0;
  std::string licensedProductIds_;
  std::string status_ = "Unknown";
  std::string error_;
  std::string extendedErrorStr_ = "0x0";
  uint32_t extendedErrorValue_ = 0;
};

Napi::Value CheckOwnership(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Product ID required").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string productId = info[0].As<Napi::String>();
  auto* worker = new CheckOwnershipWorker(env, productId);
  worker->Queue();
  return worker->GetPromise();
}

Napi::Value GetLicenseInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new GetLicenseInfoWorker(env);
  worker->Queue();
  return worker->GetPromise();
}

Napi::Value RequestPurchase(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Product ID required").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string productId = info[0].As<Napi::String>();
  uint32_t hwndLow = 0, hwndHigh = 0;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    hwndLow = info[1].As<Napi::Number>().Uint32Value();
  }
  if (info.Length() >= 3 && info[2].IsNumber()) {
    hwndHigh = info[2].As<Napi::Number>().Uint32Value();
  }
  auto* worker = new RequestPurchaseWorker(env, productId, hwndLow, hwndHigh);
  worker->Queue();
  return worker->GetPromise();
}

Napi::Value GetProducts(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new GetProductsWorker(env);
  worker->Queue();
  return worker->GetPromise();
}

Napi::Value InitStoreContext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new InitStoreContextWorker(env);
  worker->Queue();
  return worker->GetPromise();
}

// Initialize Native Module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(
    Napi::String::New(env, "checkOwnership"),
    Napi::Function::New(env, CheckOwnership)
  );

  exports.Set(
    Napi::String::New(env, "getLicenseInfo"),
    Napi::Function::New(env, GetLicenseInfo)
  );

  exports.Set(
    Napi::String::New(env, "requestPurchase"),
    Napi::Function::New(env, RequestPurchase)
  );

  exports.Set(
    Napi::String::New(env, "getProducts"),
    Napi::Function::New(env, GetProducts)
  );

  exports.Set(
    Napi::String::New(env, "initStoreContext"),
    Napi::Function::New(env, InitStoreContext)
  );

  return exports;
}

NODE_API_MODULE(iap_addon, Init)
