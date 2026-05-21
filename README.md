# **SnapAway** — Hide Apps Instantly on Windows (Boss Key)

**One keystroke and the apps you choose disappear.**  
Nothing left in the taskbar, Alt+Tab, or screen sharing.

> Someone walks in behind you.  
> Your heart races for a second.  
> You don’t want to explain what’s on your screen.  
> SnapAway lets you hide it instantly.

<div align="center">
  <img src="https://edenware.app/snapaway/files/screenshot-thumb.png" 
       alt="SnapAway - Hide Apps Instantly" 
       width="650" 
       style="border-radius: 16px;">
</div>
<br>

## Why SnapAway Exists

We all know that feeling. You're working, browsing, or chatting and suddenly someone appears behind you. Sometimes you just need a quick way to hide what’s on your screen without closing everything.

That’s why I built SnapAway.

<br>

## Key Features

### Instant Privacy
- Hide selected apps in milliseconds  
- Completely invisible in Alt+Tab, taskbar, and screen sharing  
- Automatically mutes audio from hidden apps  
- One key to hide, one key to bring everything back (or use password)

### Nice Details
- Small floating button (28×28px) when you want it out of the way  
- Fully customizable global shortcuts  
- Optional password protection  
- Emergency button to restore everything  
- Switches smoothly between normal, floating, and password modes

### Built with Care
- One-time purchase — lifetime access, no subscriptions  
- Available on Microsoft Store (safe and auto-updates)  
- Free version lets you hide up to 3 apps  
- Clean, native Windows 10 & 11 support  

<br>

## How to Use (takes about 10 seconds)

1. Install from Microsoft Store or direct download  
2. Choose the apps you want to protect  
3. Set your shortcut (like `Ctrl + Alt + Q`)  
4. Press the key when you need privacy  
5. Relax

<br>

## Download

[![Get it on Microsoft Store](https://get.microsoft.com/images/en-us%20light.svg)](https://apps.microsoft.com/detail/9NWCB3QXSBVJ)

**Direct Download:** [SnapAway_setup.exe](https://edenware.app/snapaway/bin/SnapAway_setup.exe)

<br>

## I'd Love Your Feedback

If you try SnapAway, I’d really appreciate hearing from you.

- What do you like?  
- What feels missing or could be better?  
- Any bugs or weird behavior?  

Feel free to [open an issue](https://github.com/EdenwareApps/SnapAway/issues/new/choose) on GitHub, send me an email, or just reply wherever you found this. Your feedback helps a lot to make it better.

<br>

## For Developers

### Tech Stack
- Electron + Svelte (fast and clean UI)  
- C++ native modules for proper Windows integration  
- Advanced window, process, audio and icon handling  
- Secure offline license system (SHA-256)

### Project Structure
```bash
SnapAway/
├── main.js                 # Electron main process
├── renderer/               # Svelte UI
├── src/                    # C++ native modules
│   ├── windows/
│   ├── process/
│   ├── audio/
│   └── license/
├── server/                 # License server (optional)
└── ...
```