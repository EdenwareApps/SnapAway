<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  
  export let lang = {};
  export let currentAppCount = 0;
  export let freeAppLimit = 2;
  export let feature = '';
  export let featureName = '';
  
  const dispatch = createEventDispatcher();
  
  let showLicenseInput = false;
  let licenseKey = '';
  let isActivating = false;
  let isPurchasing = false;
  let activationMessage = '';
  let activationStatus = null; // 'success' | 'error' | 'info'
  let purchaseDebugDetails = '';
  let storeProductInfo = null;
  let isPriceLoading = true;
  let iapAvailable = false;
  let iapDiagnostics = null;
  let premiumCapabilities = null;
  let isStoreInstall = false;
  let isPackaged = true;
  let showFallbackNotice = false;
  let storeInitResult = null;
  let isStoreInitLoading = false;
  const storeProductId = '9NNLVZPCLLTZ';
  const fallbackStorePrice = 'US$ 8,99';
  const storePriceCacheKey = 'snapaway.lastKnownStorePrice';
  let lastKnownStorePrice = loadCachedStorePrice();

  function getBillingAvailability(capabilities) {
    if (!capabilities || !capabilities.billing) {
      return null;
    }
    return capabilities.billing.available === true;
  }

  function getBillingReason(capabilities) {
    if (!capabilities || !capabilities.billing) {
      return null;
    }
    return capabilities.billing.reason || null;
  }

  function loadCachedStorePrice() {
    if (typeof localStorage === 'undefined') {
      return fallbackStorePrice;
    }

    try {
      const cachedPrice = localStorage.getItem(storePriceCacheKey);
      return hasValidStorePrice(cachedPrice) ? cachedPrice.trim() : fallbackStorePrice;
    } catch (error) {
      console.warn('[ProModal] Failed to read cached store price:', error);
      return fallbackStorePrice;
    }
  }

  function saveCachedStorePrice(price) {
    if (!hasValidStorePrice(price)) return;

    const normalizedPrice = price.trim();
    lastKnownStorePrice = normalizedPrice;

    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(storePriceCacheKey, normalizedPrice);
    } catch (error) {
      console.warn('[ProModal] Failed to persist store price:', error);
    }
  }

  function hasValidStorePrice(rawPrice) {
    if (typeof rawPrice !== 'string') return false;

    const trimmed = rawPrice.trim();
    if (!trimmed) return false;

    const normalized = trimmed.toLowerCase();
    if (normalized.includes('free') || normalized.includes('gratis')) {
      return false;
    }

    const numericCandidate = trimmed.replace(/[^\d.,-]/g, '').replace(',', '.');
    if (!numericCandidate) return false;

    const amount = Number.parseFloat(numericCandidate);
    return Number.isFinite(amount) && amount > 0;
  }
  
  function closeModal() {
    dispatch('close');
  }

  async function loadStoreProduct() {
    if (!window.api || !window.api.getIapProducts) {
      isPriceLoading = false;
      return;
    }

    if (!iapAvailable) {
      isPriceLoading = false;
      return;
    }

    try {
      if (storeInitResult && storeInitResult.initialized === false) {
        console.warn('[ProModal] initStoreContext failed, skipping product load', storeInitResult);
        activationMessage = storeInitResult.error || 'Store context initialization failed.';
        activationStatus = 'error';
        return;
      }

      const products = await window.api.getIapProducts();
      if (Array.isArray(products)) {
        storeProductInfo = products.find(item => item.id === storeProductId);
        if (hasValidStorePrice(storeProductInfo?.price)) {
          saveCachedStorePrice(storeProductInfo.price);
        }
      }
    } catch (error) {
      console.error('Error loading Store product info:', error);
    } finally {
      isPriceLoading = false;
    }
  }

  onMount(async () => {
    if (window.api && window.api.isPackaged) {
      try {
        isPackaged = await window.api.isPackaged();
      } catch (error) {
        console.error('[ProModal] Failed to detect packaged state:', error);
        isPackaged = true;
      }
    }

    if (window.api && window.api.getIapStatus) {
      try {
        const status = await window.api.getIapStatus();
        isStoreInstall = !!status?.isStoreInstall;
        console.log('[ProModal] getIapStatus result', status, 'isPackaged', isPackaged, 'isStoreInstall', isStoreInstall);
        iapAvailable = !!status?.available;
        iapDiagnostics = status?.diagnostics || null;
        premiumCapabilities = status?.premiumCapabilities || null;

        // Keep purchase UX resilient: if billing capability says unavailable,
        // we immediately switch to fallback notice even when diagnostics are partial.
        const billingAvailable = getBillingAvailability(premiumCapabilities);
        showFallbackNotice = billingAvailable === false || !iapAvailable;

        if (!premiumCapabilities && window.api?.getPremiumCapabilities) {
          premiumCapabilities = await window.api.getPremiumCapabilities();
          const explicitBillingAvailable = getBillingAvailability(premiumCapabilities);
          if (explicitBillingAvailable !== null) {
            showFallbackNotice = explicitBillingAvailable === false || !iapAvailable;
          }
        }
      } catch (error) {
        console.error('Error checking IAP status:', error);
        iapAvailable = false;
        isStoreInstall = false;
        showFallbackNotice = true;
      }
    }

    if (window.api && window.api.initStoreContext && iapAvailable) {
      isStoreInitLoading = true;
      try {
        storeInitResult = await window.api.initStoreContext();
        console.log('[ProModal] initStoreContext result', storeInitResult);
      } catch (error) {
        console.error('Error initializing Store context:', error);
        storeInitResult = { initialized: false, error: error?.message || String(error) };
      } finally {
        isStoreInitLoading = false;
      }
    }

    loadStoreProduct();
  });
  
  async function purchasePro() {
    console.log('[ProModal] purchasePro called', { iapAvailable, isPackaged, isPurchasing, hasApi: !!window.api?.requestPurchase });
    if (!window.api || !window.api.requestPurchase) {
      console.warn('[ProModal] requestPurchase API unavailable');
      activationStatus = 'info';
      if (window.api && typeof window.api.openPaymentPage === 'function') {
        isPurchasing = true;
        await tick();
        const fallback = await window.api.openPaymentPage();
        isPurchasing = false;
        if (fallback?.success) {
          activationMessage = lang.PAYMENT_PAGE_OPENED || 'Microsoft Store purchase is not available in this installation. Opening fallback payment page now; complete the purchase there and return to the app.';
          activationStatus = 'info';
          showFallbackNotice = false;
        } else {
          activationMessage = fallback?.message || lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase API is unavailable.';
          activationStatus = 'error';
        }
        return;
      }
      activationMessage = lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase API is unavailable.';
      activationStatus = 'error';
      return;
    }

    if (!iapAvailable) {
      console.warn('[ProModal] IAP unavailable in dev mode, opening fallback payment page');
      activationStatus = 'info';
      if (window.api && typeof window.api.openPaymentPage === 'function') {
        isPurchasing = true;
        await tick();
        const fallback = await window.api.openPaymentPage();
        isPurchasing = false;
        if (fallback?.success) {
          activationMessage = lang.PAYMENT_PAGE_OPENED || 'Microsoft Store purchase is not available in this installation. Opening fallback payment page now; complete the purchase there and return to the app.';
          activationStatus = 'info';
          showFallbackNotice = false;
        } else {
          activationMessage = fallback?.message || lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase API is unavailable.';
          activationStatus = 'error';
        }
        return;
      }
      activationMessage = lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase API is unavailable.';
      activationStatus = 'error';
      return;
    }

    isPurchasing = true;
    activationMessage = '';
    activationStatus = null;
    purchaseDebugDetails = '';

    // Suspend auto-float so the window doesn't collapse while the Store dialog is open
    if (window.api?.pauseAutoFloat) window.api.pauseAutoFloat();

    try {
      const result = await window.api.requestPurchase(storeProductId);
      const status = result?.status || 'Error';

      if (status === 'Purchased' || status === 'AlreadyPurchased') {
        activationMessage = lang.PURCHASE_SUCCESS || 'Purchase completed successfully!';
        activationStatus = 'success';

        setTimeout(() => {
          dispatch('activated');
          closeModal();
        }, 2000);
      } else if (status === 'NotPurchased') {
        activationMessage = lang.PURCHASE_CANCELLED || 'Purchase cancelled.';
        activationStatus = 'info';
      } else if (status === 'NotStoreInstall' || result?.shouldUseFallback) {
        activationStatus = 'info';
        if (window.api && typeof window.api.openPaymentPage === 'function') {
          isPurchasing = true;
          await tick();
          const fallback = await window.api.openPaymentPage();
          isPurchasing = false;
          if (fallback?.success) {
            activationMessage = lang.PAYMENT_PAGE_OPENED || 'Microsoft Store purchase is not available in this installation. Opening fallback payment page now; complete the purchase there and return to the app.';
            activationStatus = 'info';
            showFallbackNotice = false;
          } else {
            activationMessage = fallback?.message || lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase API is unavailable.';
            activationStatus = 'error';
          }
          return;
        }
        activationMessage = result?.error || lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase is unavailable in this installation.';
        activationStatus = 'error';
      } else {
        activationMessage = result?.error || lang.PURCHASE_FAILED || 'Purchase failed. Please try again.';
        activationStatus = 'error';
      }
    } catch (error) {
      activationMessage = error?.message || lang.PURCHASE_FAILED || 'Purchase failed. Please try again.';
      activationStatus = 'error';
    } finally {
      isPurchasing = false;
      if (window.api?.resumeAutoFloat) window.api.resumeAutoFloat();
    }
  }

  async function toggleLicenseInput() {
    showLicenseInput = !showLicenseInput;
    if (showLicenseInput) {
      licenseKey = '';
      activationMessage = '';

      // wait for DOM update so .license-input-section exists
      await tick();
      const section = document.querySelector('.license-input-section');
      const parent = document.querySelector('.modal-content');
      if (section && parent) {
        const sectionRect = section.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        // if any part of the section is outside the parent's viewport, scroll to it
        if (sectionRect.top < parentRect.top || sectionRect.bottom > parentRect.bottom) {
          // scroll so the section's top aligns with the parent's top
          parent.scrollBy({ top: sectionRect.top - parentRect.top, behavior: 'smooth' });
        }
      }
    }
  }
  
  async function activateLicense() {
    if (!licenseKey.trim()) {
      activationMessage = lang.ENTER_LICENSE_KEY || 'Please enter a license key';
      activationSuccess = false;
      return;
    }
    
    isActivating = true;
    activationMessage = '';
    
    try {
      if (window.api && window.api.activateLicense) {
        const result = await window.api.activateLicense(licenseKey.trim());
        
        if (result.success) {
          activationMessage = lang.LICENSE_ACTIVATED || 'License activated successfully!';
          activationSuccess = true;
          
          // Close modal after 2 seconds and reload Pro status
          setTimeout(() => {
            dispatch('activated');
            closeModal();
          }, 2000);
        } else {
          activationMessage = result.message || lang.ACTIVATION_FAILED || 'Activation failed';
          activationSuccess = false;
        }
      } else {
        activationMessage = 'API not available';
        activationSuccess = false;
      }
    } catch (error) {
      console.error('License activation error:', error);
      activationMessage = lang.ACTIVATION_FAILED || 'Activation failed. Please try again.';
      activationSuccess = false;
    } finally {
      isActivating = false;
    }
  }
  
  function handleKeyPress(event) {
    if (event.key === 'Enter' && !isActivating && licenseKey.trim()) {
      activateLicense();
    }
  }
  
  $: remainingApps = freeAppLimit - currentAppCount;
  $: isAtLimit = currentAppCount >= freeAppLimit;

  const featureTitleByKey = {
    muteWindows: lang.MUTE_WINDOWS || 'Mute windows when hidden',
    runHighPriority: lang.RUN_HIGH_PRIORITY || 'Run high priority',
    passwordProtection: lang.PASSWORD || 'Password protection',
    cloaking: lang.CLOAKING_LABEL || 'Cloaking',
    customShortcuts: lang.CUSTOM_SHORTCUTS || 'Custom keyboard shortcuts',
    appLimit: lang.FREE_APP_LIMIT ? lang.FREE_APP_LIMIT.replace('{0}', freeAppLimit) : `Free version limited to ${freeAppLimit} applications`,
  };

  $: featureTitle = featureName || featureTitleByKey[feature] || (feature ? (lang.PRO_FEATURE || 'Premium Feature') : '');

  const defaultProFeatureMessage = '{0} is a premium feature. Activate Lifetime Unlock to enable it.';

  $: featureMessage = feature && feature !== 'appLimit'
    ? ((lang.PRO_FEATURE_SPECIFIC_MESSAGE || defaultProFeatureMessage).replace('{0}', featureTitle))
    : '';

  $: displayStorePrice = hasValidStorePrice(storeProductInfo?.price)
    ? storeProductInfo.price.trim()
    : lastKnownStorePrice;
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" on:click={closeModal} on:keydown={(e) => { if (e.key === 'Escape') closeModal(); }}>
  <!-- svelte-ignore a11y-no-static-element-interactions --><div class="modal-content" role="document" tabindex="-1" on:click|stopPropagation on:keydown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
    <div class="modal-header">
      <h2><i class="fas fa-chevron-down"></i>&nbsp; {lang.PRO_BENEFITS || lang.PRO_BENEFITS || 'Lifetime Unlock Benefits'}</h2>
      <button class="close-button" on:click={closeModal}>&times;</button>
    </div>
    
    <div class="modal-body">
      {#if feature && feature !== 'appLimit'}
        <div class="limit-warning">
          <h3>⚠ {featureTitle}</h3>
          <p>{featureMessage}</p>
        </div>
      {:else if isAtLimit || feature === 'appLimit'}
        <div class="limit-warning">
          <h3>⚠ {lang.FREE_APP_LIMIT.replace('{0}', freeAppLimit)}</h3>
          <p>{lang.REACHED_LIMIT_MESSAGE || 'You\'ve reached the free version limit. Activate Lifetime Unlock for expanded coverage and controls.'}</p>
        </div>
      {:else}
        <div class="limit-info">
          <h3>📊 {lang.CURRENT_USAGE || 'Current Usage'}</h3>
          <p>{lang.APPS_REMAINING_MESSAGE ? lang.APPS_REMAINING_MESSAGE.replace('{0}', remainingApps) : `You have ${remainingApps} applications remaining in the free version.`}</p>
          <div class="usage-bar">
            <div class="usage-fill" style="width: {(currentAppCount / freeAppLimit) * 100}%"></div>
          </div>
          <p class="usage-text">{lang.APPS_USED_MESSAGE ? lang.APPS_USED_MESSAGE.replace('{0}', currentAppCount).replace('{1}', freeAppLimit) : `${currentAppCount} of ${freeAppLimit} applications used`}</p>
        </div>
      {/if}
      
      {#if !showLicenseInput}
        {#if !iapAvailable && !isPriceLoading}
          <div class="iap-warning">
            <strong>{lang.STORE_IAP_UNAVAILABLE || 'Microsoft Store purchase API is unavailable.'}</strong>
            {#if iapDiagnostics?.error}
              <p>{lang.IAP_DIAGNOSTIC_ERROR || 'Diagnostic:'} {iapDiagnostics.error}</p>
            {/if}
            {#if getBillingReason(premiumCapabilities)}
              <p>{lang.IAP_DIAGNOSTIC_ERROR || 'Diagnostic:'} {getBillingReason(premiumCapabilities)}</p>
            {/if}
          </div>
        {/if}
        <div class="pricing">
          <h3>💰 {storeProductInfo?.title || lang.LIFETIME_UNLOCK || lang.LIFETIME_LICENSE || 'Lifetime Unlock'}</h3>
          <div class="price">{displayStorePrice}</div>
          <p>{lang.ONE_TIME_PAYMENT || 'One-time payment, lifetime access'}</p>
          <ul class="benefits">
            <li>✓ {lang.SECURE_PAYMENT}</li>
            <li>✓ {lang.MONEY_BACK}</li>
            <li>✓ {lang.INSTANT_ACTIVATION || 'Instant activation'}</li>
            <li>✓ {lang.FREE_UPDATES || 'Free updates'}</li>
          </ul>
          {#if showFallbackNotice && !activationMessage}
            <div class="fallback-notice">
              {lang.IAP_FALLBACK_NOTICE || 'Microsoft Store purchase is not available in this installation. Clicking Buy will open the fallback payment page.'}
              {#if premiumCapabilities?.mode}
                <div class="fallback-mode">{lang.IAP_DIAGNOSTIC_ERROR || 'Diagnostic:'} mode={premiumCapabilities.mode}</div>
              {/if}
            </div>
          {/if}
          {#if activationMessage}
            <div class="message" class:success={activationStatus === 'success'} class:error={activationStatus === 'error'} class:info={activationStatus === 'info'}>
              {activationMessage}
            </div>
          {/if}

        </div>
      {:else}
        <div class="license-input-section">
          <h3><i class="fas fa-key"></i> {lang.ACTIVATE_LICENSE || 'Activate License'}</h3>
          <p class="license-description">
            {lang.ENTER_LICENSE_KEY || 'Enter your license key to activate Lifetime Unlock features:'}
          </p>
          
          <div class="input-group">
            <input
              type="text"
              bind:value={licenseKey}
              placeholder={lang.LICENSE_KEY_PLACEHOLDER || 'Enter license key...'}
              on:keypress={handleKeyPress}
              disabled={isActivating}
              class="license-input"
            />
          </div>
          
          {#if activationMessage}
            <div class="message" class:success={activationStatus === 'success'} class:error={activationStatus === 'error'} class:info={activationStatus === 'info'}>
              {activationMessage}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    
    <div class="modal-footer">
      {#if !showLicenseInput}
        <button class="secondary-button" on:click={toggleLicenseInput}>
          <i class="fas fa-key"></i> {lang.ALREADY_HAVE_KEY || 'Already have a key?'}
        </button>
        <button class="primary-button" on:click={purchasePro} disabled={isPurchasing}>
          {#if isPurchasing}
            <i class="fas fa-spinner fa-spin"></i> {lang.PURCHASING || 'Purchasing...'}
          {:else}
            <i class="fas fa-shopping-cart"></i> {lang.BUY_IN_STORE || 'Buy in Microsoft Store'}
            &nbsp;({displayStorePrice})
          {/if}
        </button>
      {:else}
        <button class="secondary-button" on:click={toggleLicenseInput} disabled={isActivating}>
          {lang.BACK || 'Back'}
        </button>
        <button 
          class="primary-button" 
          on:click={activateLicense}
          disabled={isActivating || !licenseKey.trim()}
        >
          {#if isActivating}
            <i class="fas fa-spinner fa-spin"></i> {lang.ACTIVATING || 'Activating...'}
          {:else}
            <i class="fas fa-check"></i> {lang.ACTIVATE || 'Activate'}
          {/if}
        </button>
      {/if}
    </div>
    
    <div class="modal-body pro-features-section">
      <div class="pro-features">
        <h3>✨ {lang.PRO_FEATURES || lang.PRO_FEATURES || 'Lifetime Unlock Features'}</h3>
        <ul>
          <li><strong>{lang.UNLIMITED_APPS}:</strong> {lang.HIDE_UNLIMITED_APPS || 'Hide unlimited applications'}</li>
          <li><strong>{lang.PASSWORD_PROTECTION}:</strong> {lang.SECURE_WINDOWS_PASSWORD || 'Secure your hidden windows with password'}</li>
          <li><strong>{lang.AUDIO_CONTROL}:</strong> {lang.MUTE_WHEN_HIDDEN || 'Mute applications when hidden'}</li>
          <li><strong>{lang.ADVANCED_SHORTCUTS}:</strong> {lang.CUSTOM_SHORTCUTS || 'Custom keyboard shortcuts'}</li>
          <li><strong>{lang.AUTO_STARTUP}:</strong> {lang.LAUNCH_AUTOMATICALLY || 'Launch automatically with Windows'}</li>
          <li><strong>{lang.HIGH_PRIORITY}:</strong> {lang.HIGH_SYSTEM_PRIORITY || 'Run with high system priority'}</li>
        </ul>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: var(--background-color, #2d3748);
    border-radius: 12px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    
    /* Custom scrollbar styling with padding */
    scrollbar-width: thin;
    scrollbar-color: var(--border-color, #4a5568) transparent;
  }
  
  .modal-content::-webkit-scrollbar {
    width: 8px;
  }
  
  .modal-content::-webkit-scrollbar-track {
    background: transparent;
    margin: 12px 0; /* Padding top and bottom to respect border-radius */
    border-radius: 4px;
  }
  
  .modal-content::-webkit-scrollbar-thumb {
    background: var(--border-color, #4a5568);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  
  .modal-content::-webkit-scrollbar-thumb:hover {
    background: var(--hover-color, #2d3748);
    background-clip: padding-box;
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-color, #4a5568);
  }
  
  .modal-header h2 {
    margin: 0;
    color: #ffffff;
    font-size: 1.5rem;
  }
  
  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    color: #e2e8f0;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color 0.2s;
    line-height: 30px;
  }
  
  .close-button:hover {
    background: var(--hover-color, #4a5568);
  }
  
  .modal-body {
    padding: 18px 24px;
  }
  
  .limit-warning {
    background: linear-gradient(310deg, #a96000 0%, #b80061 100%);
    border: 1px solid #9e0000;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 18px;
  }
  
  .limit-warning h3 {
    margin: 0 0 8px 0;
    color: #ffffff;
  }
  
  .limit-warning p {
    margin: 0;
    color: #fff7f6;
  }
  
  .limit-info {
    background: linear-gradient(135deg, #c6f6d5 0%, #9ae6b4 100%);
    border: 1px solid #68d391;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 20px;
  }
  
  .limit-info h3 {
    margin: 0 0 8px 0;
    color: #22543d;
  }
  .iap-warning {
    background: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 18px;
    color: #92400e;
  }
  .iap-warning p {
    margin: 8px 0 0;
    color: #92400e;
  }
  
  .limit-info p {
    margin: 0;
    color: #22543d;
  }
  
  .pro-features-section {
    padding: 20px 24px;
    border-top: 1px solid var(--border-color, #4a5568);
  }
  
  .pro-features {
    margin-bottom: 0;
  }
  
  .pro-features h3 {
    margin: 0 0 12px 0;
    background: linear-gradient(131deg, #a5a5ff, #a846fb);
    background-clip: text;
    display: inline-block;
    color: transparent;
    font-size: 1.2rem;
  }
  
  .pro-features ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .pro-features li {
    padding: 8px 0;
    color: #ffffff;
    border-bottom: 1px solid var(--border-color, #4a5568);
  }
  
  .pro-features li:last-child {
    border-bottom: none;
  }
  
  .pro-features strong {
    background: linear-gradient(131deg, #a5a5ff, #a846fb);
    background-clip: text;
    display: inline-block;
    color: transparent;
  }
  
  .pricing {
    text-align: center;
    background: linear-gradient(131deg, #000099, #6c00c8);
    border-radius: 8px;
    padding: 16px 20px;
  }
  
  .pricing h3 {
    margin: 0 0 8px 0;
    color: white;
    font-size: 1.1rem;
  }
  
  .price {
    font-size: 2rem;
    font-weight: bold;
    color: white;
    margin: 4px 0;
  }
  
  .pricing p {
    margin: 0 0 12px 0;
    color: #e2e8f0;
  }
  
  .benefits {
    list-style: none;
    padding: 0;
    margin: 0;
    text-align: left;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
  
  .benefits li {
    padding: 1px 0;
    color: #e2e8f0;
  }
  
  .usage-bar {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    margin: 12px 0;
    overflow: hidden;
  }
  
  .usage-fill {
    height: 100%;
    background: linear-gradient(90deg, #48bb78 0%, #38a169 100%);
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  
  .usage-text {
    font-size: 0.9rem;
    margin: 8px 0 0 0;
    color: #e2e8f0;
    text-align: center;
  }
  
  .modal-footer {
    display: flex;
    gap: 12px;
    padding: 18px 24px;
    border-top: 1px solid var(--border-color, #4a5568);
  }
  
  .primary-button, .secondary-button {
    flex: 1;
    padding: 12px 20px;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  
  .primary-button {
    background: linear-gradient(178deg, #00b631 0%, #0b7620 100%);
    transition: filter 0.4s ease-out 0s;
    color: white;
  }
  
  .primary-button:hover:not(:disabled) {
    filter: saturate(112%);
    transform: translateY(-1px);
  }
  
  .secondary-button {
    background: var(--button-color, #4a5568);
    color: #ffffff;
  }
  
  .secondary-button:hover {
    background: var(--hover-color, #5a6578);
    opacity: 1;
  }
  
  .license-input-section {
    background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
    border: 2px solid var(--border-color, #4a5568);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }
  
  .license-input-section h3 {
    margin: 0 0 12px 0;
    color: #e2e8f0;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .license-description {
    margin: 0 0 16px 0;
    color: #e2e8f0;
    line-height: 1.5;
    font-size: 0.95rem;
  }
  
  .input-group {
    margin-bottom: 16px;
  }
  
  .license-input {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid var(--border-color, #4a5568);
    border-radius: 8px;
    background: var(--input-background, #1a202c);
    color: #e2e8f0;
    font-size: 1rem;
    font-family: 'Courier New', monospace;
    letter-spacing: 1px;
    transition: border-color 0.2s;
    box-sizing: border-box;
  }

  .license-input::placeholder {
    color: #999 !important; /* Change to your desired color value (hex, rgb, or named color) */
    opacity: 1;  /* Firefox applies a default lower opacity, this ensures full opacity */
  }
  
  .license-input:focus {
    outline: none;
    border-color: #4299e1;
  }
  
  .license-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .message {
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 0;
    font-weight: 500;
  }
  
  .message.success {
    background: linear-gradient(135deg, #c6f6d5 0%, #9ae6b4 100%);
    border: 1px solid #68d391;
    color: #22543d;
  }
  
  .message.error {
    background: linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%);
    border: 1px solid #fc8181;
    color: #742a2a;
    margin-top: 12px;
  }

  .message.info {
    background: linear-gradient(135deg, #ebf8ff 0%, #bee3f8 100%);
    border: 1px solid #90cdf4;
    color: #2a4365;
    margin-top: 12px;
  }

  .fallback-notice {
    margin-top: 1rem;
    padding: 12px 16px;
    border-radius: 8px;
    background: linear-gradient(135deg, #fefcbf 0%, #faf089 100%);
    border: 1px solid #f6e05e;
    color: #744210;
    font-weight: 500;
  }

  .fallback-mode {
    margin-top: 8px;
    font-size: 0.85rem;
    opacity: 0.85;
    word-break: break-word;
  }
  
  .primary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
  
  .secondary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style> 