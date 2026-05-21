# SnapAway - Edenware

A powerful Electron application for managing and hiding Windows applications with advanced features including audio control, system tray integration, freemium model, and comprehensive license management.

## Features

### Core Functionality
- **Application Hiding**: Hide any running Windows application from view
- **System Tray Integration**: Minimize to system tray with quick access
- **Global Shortcuts**: Customizable keyboard shortcuts for show/hide actions
- **Password Protection**: Optional password protection for hidden applications
- **Emergency Button**: Quick access button to restore all hidden applications

### Freemium System
- **Free Version**: Limited to hiding 3 applications
- **Pro Version**: Unlimited applications + advanced features
- **License Activation**: Secure offline license verification
- **Upgrade Modal**: Seamless upgrade experience within the app

### Advanced UI Modes
- **Main Mode**: Full application interface (640x550+)
- **Float Mode**: Compact floating button (28x28) when minimized/oculto
- **Auth Mode**: Secure password entry interface (160x190)
- **Automatic Transitions**: Seamless mode switching based on window state

### Advanced Features
- **Audio Control**: Mute/unmute applications when hiding/showing
- **Process Management**: View and manage running processes
- **Icon Extraction**: Automatic extraction of application icons
- **Multi-language Support**: Internationalization support
- **Startup Integration**: Option to start with Windows
- **High Priority Mode**: Run with elevated system priority
- **Notification Badge**: Visual indicator showing count of hidden windows

### Security Features
- **SHA-256 Password Hashing**: Secure password storage
- **License Verification**: Offline license validation
- **Window State Tracking**: Remembers previous window states
- **Secure Hiding**: Applications remain hidden until explicitly shown

### Adblock Protection
The application includes protection against ad blockers that may interfere with functionality:

#### Protected Elements
- Generic CSS classes and IDs to avoid blocking
- Fallback mechanisms for blocked scripts
- Alternative naming conventions for affiliate/marketing elements

#### Best Practices
- Use neutral naming for UI elements
- Implement detection and fallback for blocked resources
- Avoid sensitive keywords in critical code paths

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Windows 10/11

### Development Setup
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd SnapAway
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build native modules:
   ```bash
   npm run rebuild:native
   ```

4. Start the application:
   ```bash
   npm run dev:vite
   ```

### Building for Distribution
```bash
npm run build
npm run dist:win
```

## Usage

### Basic Operation
1. **Launch the Application**: Start SnapAway from the desktop or system tray
2. **Select Applications**: Choose which applications to hide from the process list
3. **Set Shortcuts**: Configure keyboard shortcuts for show/hide actions
4. **Hide Applications**: Use the hide shortcut or click the "PROTECT" button
5. **Show Applications**: Use the show shortcut or access from system tray

### UI Modes

#### Main Mode
- **Size**: 640x550 pixels (default) or larger
- **Features**: Full application interface, titlebar visible
- **Access**: Normal application window

#### Float Mode
- **Size**: 28x28 pixels
- **Location**: Bottom-right corner of screen
- **Features**: Floating button with notification badge
- **Triggers**: When minimizing or hiding windows

#### Auth Mode
- **Size**: 160x190 pixels
- **Location**: Bottom-right corner of screen
- **Features**: Password entry interface
- **Triggers**: When password protection is enabled

### Configuration Options

#### Keyboard Shortcuts
- **Hide Shortcut**: Global shortcut to hide selected applications
- **Show Shortcut**: Global shortcut to show all hidden applications
- **Customization**: Set any combination of Ctrl, Alt, Shift, and function keys

#### Application Settings
- **Language**: Choose from available language options
- **Font Size**: Adjust UI text size (Small, Medium, Large, Extra Large)
- **Password Protection**: Set optional password for hidden applications
- **Emergency Button**: Enable/disable quick restore button
- **Startup**: Automatically start with Windows
- **System Windows**: Include/exclude system windows in process list
- **High Priority**: Run with elevated system priority
- **Audio Muting**: Automatically mute applications when hiding
- **Mask Character**: Customize character for masking application names

### Freemium Features

#### Free Version (5 App Limit)
- Basic window hiding functionality
- Standard shortcuts
- System tray integration
- Basic audio control

#### Pro Features
- **Unlimited Applications**: No limit on hidden apps
- **Password Protection**: Secure access to hidden windows
- **Advanced Audio Control**: Mute applications when hidden
- **Custom Shortcuts**: Advanced keyboard shortcuts
- **Auto Startup**: Launch with Windows
- **High Priority Mode**: Elevated system priority
- **Advanced Filtering**: Process, title, and class-based filtering

### License Activation
1. **Purchase**: Buy license from Edenware platform
2. **Activation**: Enter license key in the app
3. **Verification**: Offline SHA-256 verification
4. **Unlock**: Access to Pro features

### System Tray Features
- **Right-click Menu**: Quick access to show/hide and settings
- **Double-click**: Show main window
- **Status Indicator**: Visual indication of hidden applications
- **Notification Badge**: Shows count of hidden windows

## Architecture

### Process Structure
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚   Main Process  â”‚    â”‚ Renderer Processâ”‚    â”‚  Native Modules â”‚
â”‚   (main.js)     â”‚â—„â”€â”€â–ºâ”‚   (Svelte UI)   â”‚â—„â”€â”€â–ºâ”‚   (C++ Addons)  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
       â”‚                       â”‚                       â”‚
       â”‚                       â”‚                       â”‚
       â–¼                       â–¼                       â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  System Tray    â”‚    â”‚   UI Components â”‚    â”‚  Windows API    â”‚
â”‚  Global Shortcutsâ”‚   â”‚   State Mgmt    â”‚    â”‚  Process Controlâ”‚
â”‚  Window Control â”‚    â”‚   Event Handlingâ”‚    â”‚  Audio Control  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Key Design Principles
- **Single Window Architecture**: One unified window that changes modes
- **Native Integration**: Direct Windows API access via C++ modules
- **State-Driven UI**: CSS classes control appearance and behavior
- **Event-Driven Communication**: IPC for process communication
- **Modular Design**: Separated concerns across different modules

### Main Components
- **Main Process** (`main.js`): Electron main process handling system integration
- **Renderer Process** (`renderer/`): Svelte-based UI components
- **Native Modules** (`src/`): C++ addons for Windows API integration
- **License Server** (`server/`): Node.js/Express license management system

### Key Modules
- **Process Management**: Native module for process enumeration and control
- **Window Management**: Native module for window manipulation
- **Icon Extraction**: Native module for application icon extraction
- **Audio Control**: Native module for audio device management
- **System Integration**: Native module for system tray and shortcuts
- **License Management**: Offline license verification and management

### UI State Management
- **Window State Tracking**: Remembers previous window states (minimized, visible, hidden)
- **Mode Transitions**: Automatic switching between main/float/auth modes
- **Event Handling**: IPC communication between main and renderer processes
- **Focus Management**: Proper window focus and activation

### UI Mode System

The application operates in three distinct modes:

#### 1. Main Mode (`main-mode`)
- **Purpose**: Full application interface
- **Size**: Configurable (default: 800x600)
- **Position**: User-controlled
- **Behavior**: Normal window behavior
- **CSS Classes**: `main-mode` + state class

#### 2. Float Mode (`float-mode`)
- **Purpose**: Minimal floating button
- **Size**: Fixed 28x28 pixels
- **Position**: Bottom-right corner (18px margin)
- **Behavior**: Always on top, skip taskbar
- **CSS Classes**: `float-mode` + state class

#### 3. Auth Mode (`auth-mode`)
- **Purpose**: Password authentication
- **Size**: Fixed 160x190 pixels
- **Position**: Bottom-right corner (18px margin)
- **Behavior**: Always on top, modal-like
- **CSS Classes**: `auth-mode` (no state class)

## Project Structure
```
SnapAway/
â”œâ”€â”€ main.js                 # Electron main process
â”œâ”€â”€ preload.js             # Preload script for IPC
â”œâ”€â”€ renderer/              # Svelte frontend
â”‚   â”œâ”€â”€ App.svelte        # Main application component
â”‚   â”œâ”€â”€ components/       # UI components
â”‚   â”‚   â”œâ”€â”€ ProModal.svelte    # Pro upgrade modal
â”‚   â”‚   â”œâ”€â”€ LicenseActivator.svelte # License activation
â”‚   â”‚   â””â”€â”€ ...           # Other components
â”‚   â””â”€â”€ assets/          # Static assets
â”œâ”€â”€ src/                  # Native modules
â”‚   â”œâ”€â”€ process/         # Process management
â”‚   â”œâ”€â”€ windows/         # Window management
â”‚   â”œâ”€â”€ icons/           # Icon extraction
â”‚   â”œâ”€â”€ audio/           # Audio control
â”‚   â”œâ”€â”€ system/          # System integration
â”‚   â””â”€â”€ license/         # License management
â”œâ”€â”€ server/              # License server (see server/README.md)
â”‚   â”œâ”€â”€ server.js        # Express server
â”‚   â”œâ”€â”€ routes/          # API routes
â”‚   â”œâ”€â”€ services/        # Business logic
â”‚   â”œâ”€â”€ admin/           # Admin panel
â”‚   â””â”€â”€ public/          # Landing pages
â””â”€â”€ scripts/             # Build and deployment scripts
```

### Building Native Modules
The application uses native C++ modules for Windows API integration:

```bash
# Build all native modules
npm run build

# Build specific module
cd src/process && npm run build
```

### Development Commands
```bash
npm run dev:vite      # Start Electron + Vite dev server
npm run rebuild:native # Rebuild all native modules (required once or after native changes)
npm run build         # Build out/main, out/preload, out/renderer
npm run pack          # Create Windows installer/package (does not rebuild natives)

# or, if you need to rebuild and package in a single command:
npm run pack:all      # rebuild native modules then create installer
```
### Development Workflow
```bash
# Development
npm run dev:vite       # Start development mode

# Building
npm run rebuild:native # Build only native modules
npm run build          # Build Electron + renderer (Vite)

# Distribution
npm run pack           # Build and package Windows app
npm run dist:win       # Alias for pack

# Utilities
npm run appx:dir       # Build APPX directory output
```

### IPC Communication
The application uses secure IPC communication between processes:

#### Preload Script (`preload.js`)
Acts as a secure bridge between main and renderer processes:

```javascript
// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('api', {
  getProcesses: () => ipcRenderer.invoke('get-processes'),
  hideWindows: (processIds) => ipcRenderer.invoke('hide-windows', processIds),
  showWindows: () => ipcRenderer.invoke('show-windows'),
  setShortcuts: (shortcuts) => ipcRenderer.invoke('set-shortcuts', shortcuts),
  extractIcon: (path) => ipcRenderer.invoke('extract-icon', path),
  // ... other APIs
});
```

#### Security Considerations
- Only expose necessary APIs
- Validate all data passed between processes
- Use `invoke` for request-response patterns
- Use `send` for one-way communication

## License Server

The application includes a complete license management server. See [server/README.md](server/README.md) for detailed documentation.

### Key Features
- **Express.js Server**: RESTful API for license management
- **SQLite Database**: Local license storage
- **PayPal Integration**: Payment processing
- **Admin Panel**: Web-based license management
- **Multi-app Support**: Support for multiple Edenware products

## Troubleshooting

### Common Issues

#### Application Won't Start
- Ensure Node.js is properly installed
- Check that all native modules are built
- Verify Windows compatibility

#### Shortcuts Not Working
- Check if shortcuts conflict with other applications
- Ensure SnapAway has necessary permissions
- Verify shortcut configuration in settings

#### Applications Not Hiding
- Check if target applications have elevated privileges
- Verify SnapAway is running with sufficient permissions
- Ensure applications are not system-critical processes

#### UI Mode Issues
- **Window stuck in auth mode**: Check password configuration
- **Float mode not appearing**: Verify emergency button is enabled
- **Mode transitions not working**: Check window state tracking

#### License Issues
- **License not activating**: Verify license key format
- **Pro features locked**: Check license verification
- **Upgrade modal not showing**: Verify freemium system is enabled

#### Audio Issues
- Check audio device permissions
- Verify audio module is properly built
- Ensure no other applications are controlling audio

### Logs and Debugging
- Application logs are available in the console during development
- Check system event logs for permission issues
- Use Windows Task Manager to verify process status
- Enable verbose logging for detailed debugging

## Contributing

### Development Guidelines
- Follow existing code style and conventions
- Test changes thoroughly on Windows systems
- Update documentation for new features
- Ensure native modules are properly built
- Test freemium system functionality

### Building from Source
1. Install development dependencies
2. Build native modules
3. Test functionality
4. Create distribution package

## License

This project is licensed under the [LICENSE] file - see the file for details.

## Support

For issues, questions, or contributions:
- Check existing documentation
- Review troubleshooting section
- Create detailed issue reports
- Provide system information and error logs

## Version History

### Current Version
- **Freemium System**: 5-app limit for free users, Pro features
- **UI Mode Management**: Main, float, and auth modes
- **License Server**: Complete license management system
- **Enhanced Security**: SHA-256 password hashing
- **Improved UX**: Seamless mode transitions
- **Notification System**: Badge showing hidden window count

### Previous Versions
- Initial release with core functionality
- Added audio control features
- Implemented password protection
- Enhanced system tray integration
- Added freemium model
- Implemented license server

## Edenware Ecosystem

SnapAway is part of the Edenware ecosystem, which includes:
- **SnapAway**: Window hiding and management
- **Megacubo**: Advanced system utilities
- **Vimer**: Video editing and processing
- **Songtrip**: Music and audio management
- **Papr**: Document processing and management

Visit [edenware.app](https://edenware.app) for more information about our products.
