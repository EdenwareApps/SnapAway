<script>
  import { createEventDispatcher } from 'svelte';
  
  export let lang = {};
  
  const dispatch = createEventDispatcher();
  
  let licenseKey = '';
  let isActivating = false;
  let activationMessage = '';
  let activationSuccess = false;
  
  function closeModal() {
    dispatch('close');
  }
  
  async function activateLicense() {
    if (!licenseKey.trim()) {
      activationMessage = 'Please enter a license key';
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
          
          // Close modal after 2 seconds
          setTimeout(() => {
            dispatch('activated');
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
      activationMessage = 'Activation failed. Please try again.';
      activationSuccess = false;
    } finally {
      isActivating = false;
    }
  }
  
  function handleKeyPress(event) {
    if (event.key === 'Enter') {
      activateLicense();
    }
  }
  
  function openWebsite(event) {
    event.preventDefault();
    if (window.api && window.api.launchUrl) {
      window.api.launchUrl('https://edenware.app/snapaway/help');
    } else {
      // Fallback to opening in new tab
      window.open('https://edenware.app/snapaway/help', '_blank');
    }
  }
</script>

<div class="modal-overlay" on:click={closeModal}>
  <div class="modal-content" on:click|stopPropagation>
    <div class="modal-header">
      <h2><i class="fas fa-key"></i> {lang.ACTIVATE_LICENSE}</h2>
      <button class="close-button" on:click={closeModal}>&times;</button>
    </div>
    
    <div class="modal-body">
      <p class="description">
        {lang.ENTER_LICENSE_KEY || 'Enter your license key to activate Pro features:'}
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
        <div class="message" class:success={activationSuccess} class:error={!activationSuccess}>
          {activationMessage}
        </div>
      {/if}
      
      <div class="help-text">
        <p>
          <i class="fas fa-info-circle"></i> 
          Need help? Contact support or 
          <a href="#" on:click={openWebsite} class="website-link">visit our website</a>.
        </p>
      </div>
    </div>
    
    <div class="modal-footer">
      <button class="secondary-button" on:click={closeModal} disabled={isActivating}>
        {lang.CANCEL || 'Cancel'}
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
    max-width: 450px;
    width: 90%;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
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
    color: var(--default-font-color, #e2e8f0);
    font-size: 1.3rem;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--default-font-color, #e2e8f0);
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    line-height: 30px;
    transition: background-color 0.2s;
  }
  
  .close-button:hover {
    background: var(--hover-color, #4a5568);
  }
  
  .modal-body {
    padding: 24px;
  }
  
  .description {
    margin: 0 0 20px 0;
    color: var(--default-font-color, #e2e8f0);
    line-height: 1.5;
  }
  
  .input-group {
    margin-bottom: 20px;
  }
  
  .license-input {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid var(--border-color, #4a5568);
    border-radius: 8px;
    background: var(--input-background, #1a202c);
    color: var(--default-font-color, #e2e8f0);
    font-size: 1rem;
    font-family: 'Courier New', monospace;
    letter-spacing: 1px;
    transition: border-color 0.2s;
    box-sizing: border-box;
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
    margin-bottom: 20px;
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
  }
  
  .help-text {
    background: var(--help-background, #2d3748);
    border: 1px solid var(--border-color, #4a5568);
    border-radius: 8px;
    padding: 12px 16px;
  }
  
  .help-text p {
    margin: 0;
    color: var(--help-text-color, #a0aec0);
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  
  .website-link {
    color: #4299e1;
    text-decoration: none;
    transition: color 0.2s;
  }
  
  .website-link:hover {
    color: #63b3ed;
    text-decoration: underline;
  }
  
  .modal-footer {
    display: flex;
    gap: 12px;
    padding: 20px 24px;
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
  
  .primary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
  
  .secondary-button {
    background: var(--button-color, #4a5568);
    color: #ffffff;
  }
  
  .secondary-button:hover:not(:disabled) {
    background: var(--hover-color, #2d3748);
  }
  
  .secondary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style> 