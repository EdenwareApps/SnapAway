<script>
  import { createEventDispatcher } from 'svelte';
  
  export let lang = {};
  export let isPro = false;
  export let remainingApps = 2;
  export let freeAppLimit = 2;
  export let isAtLimit = false;
  export let showNotification = false;
  
  const dispatch = createEventDispatcher();
  
  function closeNotification() {
    dispatch('close');
  }
  
  function openProModal() {
    dispatch('open-pro');
  }
  
  $: notificationType = isAtLimit ? 'warning' : 'info';
  $: notificationMessage = isAtLimit 
    ? lang.FREE_APP_LIMIT.replace('{0}', freeAppLimit)
    : `${lang.UPGRADE_PRO} - ${remainingApps} ${lang.APPS_REMAINING}`;
</script>

{#if showNotification && !isPro}
  <div class="pro-notification" class:warning={notificationType === 'warning'}>
    <div class="notification-content">
      <div class="notification-icon">
        {#if isAtLimit}
          <i class="fas fa-exclamation-triangle"></i>
        {:else}
          <i class="fas fa-star"></i>
        {/if}
      </div>
      <div class="notification-text">
        <p>{notificationMessage}</p>
        {#if isAtLimit}
          <p class="upgrade-text">{lang.UPGRADE_FOR_UNLIMITED}</p>
        {/if}
      </div>
      <div class="notification-actions">
        <button class="action-btn primary" on:click={openProModal}>
          <i class="fas fa-crown"></i> {lang.UPGRADE_NOW}
        </button>
      </div>
    </div>
    <button class="close-btn" on:click={closeNotification}>
      <i class="fas fa-times"></i>
    </button>
  </div>
{/if}

<style>
  .pro-notification {
    position: fixed;
    top: 20px;
    right: 20px;
    background: Highlight;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
  }
  
  .pro-notification.warning {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  }
  
  .notification-content {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  
  .notification-icon {
    font-size: 1.5rem;
    color: white;
    margin-top: 2px;
  }
  
  .notification-text {
    flex: 1;
  }
  
  .notification-text p {
    margin: 0 0 8px 0;
    color: white;
    font-weight: 500;
  }
  
  .upgrade-text {
    font-size: 0.9rem;
    opacity: 0.9;
  }
  
  .notification-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  
  .action-btn {
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .action-btn.primary {
    background: white;
    color: #667eea;
  }
  
  .action-btn.primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.3);
  }
  
  .action-btn.secondary {
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  
  .action-btn.secondary:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  
  .close-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.2s;
  }
  
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @media (max-width: 480px) {
    .pro-notification {
      top: 10px;
      right: 10px;
      left: 10px;
      max-width: none;
    }
    
    .notification-actions {
      flex-direction: column;
    }
  }
</style> 