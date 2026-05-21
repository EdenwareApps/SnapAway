// Simplified Custom Electron Titlebar for browser compatibility
(function() {
  'use strict';

  // Utility functions
  function $(selector) {
    return document.querySelector(selector);
  }

  function addClass(element, className) {
    if (element) {
      element.classList.add(className);
    }
  }

  function append(parent, child) {
    if (parent && child) {
      parent.appendChild(child);
    }
  }

  // Platform detection
  const platform = {
    isWindows: navigator.platform.indexOf('Win') !== -1,
    isMacintosh: navigator.platform.indexOf('Mac') !== -1,
    isLinux: navigator.platform.indexOf('Linux') !== -1
  };

  // Window icons
  const menuIcons = {
    windows: {
      minimize: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11"><path d="M11,4.9v1.1H0V4.399h11z"/></svg>',
      maximize: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11"><path d="M0,1.7v7.6C0,10.2,0.8,11,1.7,11h7.6c0.9,0,1.7-0.8,1.7-1.7V1.7C11,0.8,10.2,0,9.3,0H1.7C0.8,0,0,0.8,0,1.7z M8.8,9.9H2.2c-0.6,0-1.1-0.5-1.1-1.1V2.2c0-0.6,0.5-1.1,1.1-1.1h6.7c0.6,0,1.1,0.5,1.1,1.1v6.7C9.9,9.4,9.4,9.9,8.8,9.9z"/></svg>',
      restore: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11"><path d="M7.9,2.2h-7C0.4,2.2,0,2.6,0,3.1v7C0,10.6,0.4,11,0.9,11h7c0.5,0,0.9-0.4,0.9-0.9v-7C8.8,2.6,8.4,2.2,7.9,2.2z M7.7,9.6 c0,0.2-0.1,0.3-0.3,0.3h-6c-0.2,0-0.3-0.1-0.3-0.3v-6c0-0.2,0.1-0.3,0.3-0.3h6c0.2,0,0.3,0.1,0.3,0.3V9.6z"/><path d="M10,0H3.5v1.1h6.1c0.2,0,0.3,0.1,0.3,0.3v6.1H11V1C11,0.4,10.6,0,10,0z"/></svg>',
      close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11"><path d="M6.279 5.5L11 10.221l-.779.779L5.5 6.279.779 11 0 10.221 4.721 5.5 0 .779.779 0 5.5 4.721 10.221 0 11 .779 6.279 5.5z"/></svg>'
    }
  };

  // Color utility
  const Color = {
    WHITE: { toString: () => '#ffffff' },
    fromHex: (hex) => ({ toString: () => hex })
  };

  // ThemeBar base class
  class ThemeBar {
    constructor() {
      this.menuBar = null;
    }
  }

  // CustomTitlebar class
  class CustomTitlebar extends ThemeBar {
    constructor(options = {}) {
      super();
      
      this.currentOptions = {
        closeable: true,
        enableMnemonics: true,
        iconSize: 16,
        itemBackgroundColor: undefined,
        maximizable: true,
        menuPosition: 'left',
        menuTransparency: 0,
        minimizable: true,
        onlyShowMenuBar: false,
        shadow: false,
        titleHorizontalAlignment: 'center',
        tooltips: {
          close: 'Close',
          maximize: 'Maximize',
          minimize: 'Minimize',
          restoreDown: 'Restore Down'
        },
        unfocusEffect: true,
        ...options
      };

      this.platformIcons = menuIcons.windows;
      this.isInactive = false;

      this.initializeElements();
      this.setupTitlebar();
    }

    initializeElements() {
      // Create titlebar elements if they don't exist
      this.createTitlebarElements();
      
      // Get references to elements
      this.titlebar = $('.cet-titlebar');
      this.dragRegion = $('.cet-drag-region');
      this.icon = $('.cet-icon');
      this.menuBarContainer = $('.cet-menubar');
      this.title = $('.cet-title');
      this.controlsContainer = $('.cet-window-controls');
      this.container = $('.cet-container');
      
      this.controls = {
        minimize: $('.cet-control-minimize'),
        maximize: $('.cet-control-maximize'),
        close: $('.cet-control-close')
      };
      
      this.resizer = {
        top: $('.cet-resizer.top'),
        left: $('.cet-resizer.left')
      };
    }

    createTitlebarElements() {
      // Create container if it doesn't exist
      if (!$('.cet-container')) {
        const container = document.createElement('div');
        container.className = 'cet-container';
        document.body.appendChild(container);
      }

      // Create titlebar if it doesn't exist
      if (!$('.cet-titlebar')) {
        const titlebar = document.createElement('div');
        titlebar.className = 'cet-titlebar';
        
        // Create drag region
        const dragRegion = document.createElement('div');
        dragRegion.className = 'cet-drag-region';
        titlebar.appendChild(dragRegion);
        
        // Create icon
        const icon = document.createElement('div');
        icon.className = 'cet-icon';
        titlebar.appendChild(icon);
        
        // Create title
        const title = document.createElement('div');
        title.className = 'cet-title';
        title.textContent = document.title;
        titlebar.appendChild(title);
        
        // Create controls container
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'cet-window-controls';
        
        // Create control buttons
        const minimizeBtn = document.createElement('div');
        minimizeBtn.className = 'cet-control-minimize';
        controlsContainer.appendChild(minimizeBtn);
        
        const maximizeBtn = document.createElement('div');
        maximizeBtn.className = 'cet-control-maximize';
        controlsContainer.appendChild(maximizeBtn);
        
        const closeBtn = document.createElement('div');
        closeBtn.className = 'cet-control-close';
        controlsContainer.appendChild(closeBtn);
        
        titlebar.appendChild(controlsContainer);
        
        // Add titlebar to container
        $('.cet-container').appendChild(titlebar);
      }
    }

    setupTitlebar() {
      this.createIcon();
      this.setupTitle();
      this.setupWindowControls();
      this.setupContainer();
      this.loadEvents();
    }

    createIcon() {
      if (platform.isMacintosh) return;
      
      let icon = this.currentOptions.icon;
      if (!icon) {
        const tagLink = document.querySelectorAll('link');
        tagLink.forEach(link => {
          if (link.getAttribute('rel') === 'icon' || link.getAttribute('rel') === 'shortcut icon') {
            icon = link.getAttribute('href');
          }
        });
      }
      
      if (icon && this.icon) {
        const windowIcon = document.createElement('img');
        windowIcon.setAttribute('src', icon);
        windowIcon.style.height = `${this.currentOptions.iconSize}px`;
        this.icon.appendChild(windowIcon);
      }
    }

    setupTitle() {
      if (this.currentOptions.onlyShowMenuBar) return;
      
      this.updateTitle(document.title);
      this.updateTitleAlignment(this.currentOptions.titleHorizontalAlignment);
    }

    setupWindowControls() {
      if (platform.isMacintosh || this.currentOptions.onlyShowMenuBar) return;
      
      this.createControlButton(this.controls.minimize, this.platformIcons.minimize, this.currentOptions.tooltips.minimize, this.currentOptions.minimizable);
      this.createControlButton(this.controls.maximize, this.platformIcons.maximize, this.currentOptions.tooltips.maximize, this.currentOptions.maximizable);
      this.createControlButton(this.controls.close, this.platformIcons.close, this.currentOptions.tooltips.close, this.currentOptions.closeable);
    }

    createControlButton(element, icon, title, active = true) {
      if (!element) return;
      
      addClass(element, 'cet-control-icon');
      element.innerHTML = icon;
      element.title = title;
      
      if (!active) {
        addClass(element, 'inactive');
      }
    }

    setupContainer() {
      // Move all body children to container
      const container = this.container;
      if (container) {
        while (document.body.firstChild && document.body.firstChild !== container) {
          container.appendChild(document.body.firstChild);
        }
      }
    }

    loadEvents() {
      // Add event listeners for window controls
      if (this.controls.minimize) {
        this.controls.minimize.addEventListener('click', () => {
          if (window.api && window.api.minimize) {
            window.api.minimize();
          }
        });
      }

      if (this.controls.maximize) {
        this.controls.maximize.addEventListener('click', () => {
          if (window.api && window.api.toggleMaximize) {
            window.api.toggleMaximize();
          }
        });
      }

      // Listen for window maximize state changes to update button icon
      if (window.api && window.api.onWindowMaximizedChanged) {
        window.api.onWindowMaximizedChanged((event, isMaximized) => {
          this.updateMaximizeButtonIcon(isMaximized);
        });
      }

      // Check initial maximize state
      this.checkInitialMaximizeState();
      
      if (this.controls.close) {
        this.controls.close.addEventListener('click', () => {
          if (window.api && window.api.close) {
            window.api.close();
          }
        });
      }
    }

    updateMaximizeButtonIcon(isMaximized) {
      if (this.controls.maximize) {
        this.controls.maximize.innerHTML = isMaximized ? this.platformIcons.restore : this.platformIcons.maximize;
        this.controls.maximize.title = isMaximized ? this.currentOptions.tooltips.restoreDown : this.currentOptions.tooltips.maximize;
      }
    }

    // Check initial maximize state when titlebar is ready
    checkInitialMaximizeState() {
      if (window.api && window.api.getCurrentState) {
        window.api.getCurrentState().then(state => {
          if (state && state.maximized !== undefined) {
            this.updateMaximizeButtonIcon(state.maximized);
          }
        }).catch(err => {
          console.warn('[TITLEBAR] Failed to get initial maximize state:', err);
        });
      }
    }

    updateTitle(title) {
      if (this.title) {
        this.title.textContent = title;
      }
    }

    updateTitleAlignment(alignment) {
      if (this.title) {
        this.title.style.textAlign = alignment;
      }
    }

    dispose() {
      // Cleanup if needed
    }

    get titlebarElement() {
      return this.titlebar;
    }

    get menubarElement() {
      return this.menuBarContainer;
    }

    get containerElement() {
      return this.container;
    }

    get titleElement() {
      return this.title;
    }
  }

  // Expose globally
  window.CustomTitlebar = CustomTitlebar;

})();







