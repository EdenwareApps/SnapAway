const path = require('path');

let audioAddon = null;
let addonLoaded = false;

try {
    // Try multiple possible paths for the addon
    const possiblePaths = [
        // Dev: wrapper copied to out/main/audio, addon copied to out/main
        path.join(__dirname, '..', 'audio_addon.node'),
        // Dev: original source location
        path.join(__dirname, 'build', 'Release', 'audio_addon'),
        path.join(__dirname, 'build', 'Release', 'audio_addon.node'),
        // Dev: from workspace root
        path.join(process.cwd(), 'src', 'audio', 'build', 'Release', 'audio_addon'),
        path.join(process.cwd(), 'src', 'audio', 'build', 'Release', 'audio_addon.node'),
        path.join(process.cwd(), 'out', 'main', 'audio_addon.node'),
        path.join(process.cwd(), 'dist', 'audio_addon'),
        path.join(__dirname, '..', '..', 'src', 'audio', 'build', 'Release', 'audio_addon'),
        './index.js',
        // ASAR unpacked paths (only when packaged)
        ...(process.resourcesPath ? [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio', 'build', 'Release', 'audio_addon.node'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio', 'build', 'Debug', 'audio_addon.node'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'audio_addon.node')
        ] : [])
    ];
    
    const r = eval('require'); // avoid static analysis by bundler
    for (const addonPath of possiblePaths) {
        console.log('[AUDIO] trying audio addon path:', addonPath);
        try {
            audioAddon = r(addonPath);
            console.log('[AUDIO] Native audio addon loaded from:', addonPath);
            addonLoaded = true;
            break;
        } catch (e) {
            console.warn('[AUDIO] failed to load audio addon from:', addonPath, e && e.message ? e.message : e);
            // Continue to next path
        }
    }
    
    if (!addonLoaded) {
        throw new Error('Audio addon not found in any of the expected paths');
    }
    
    console.log('[AUDIO] Native audio addon loaded successfully');
} catch (error) {
    console.log('[AUDIO] Native audio addon not available:', error.message);
    addonLoaded = false;
}

class NativeAudioController {
    constructor() {
        this.initialized = false;
    }

    async initialize() {
        if (!addonLoaded) {
            console.log('[AUDIO] Native addon not available, cannot initialize');
            return false;
        }

        try {
            console.log('[AUDIO] Attempting to initialize native audio controller...');
            this.initialized = audioAddon.initializeAudio();
            console.log('[AUDIO] Native initializeAudio() returned:', this.initialized);
            if (this.initialized) {
                console.log('[AUDIO] Native audio controller initialized successfully');
            } else {
                console.log('[AUDIO] Failed to initialize native audio controller');
            }
            return this.initialized;
        } catch (error) {
            console.error('[AUDIO] Error initializing native audio controller:', error);
            return false;
        }
    }

    async cleanup() {
        if (!addonLoaded || !this.initialized) {
            return;
        }

        try {
            audioAddon.cleanupAudio();
            this.initialized = false;
            console.log('[AUDIO] Native audio controller cleaned up');
        } catch (error) {
            console.error('[AUDIO] Error cleaning up native audio controller:', error);
        }
    }

    async muteProcess(processId, mute) {
        if (!addonLoaded || !this.initialized) {
            console.log('[AUDIO] Native addon not available or not initialized');
            return false;
        }

        try {
            const success = audioAddon.muteProcess(processId, mute);
            if (success) {
                console.log(`[AUDIO] Native: ${mute ? 'Muted' : 'Unmuted'} process ${processId}`);
            } else {
                console.log(`[AUDIO] Native: Failed to ${mute ? 'mute' : 'unmute'} process ${processId}`);
            }
            return success;
        } catch (error) {
            console.error('[AUDIO] Error in native mute process:', error);
            return false;
        }
    }

    async hasActiveAudioSession(processId) {
        if (!addonLoaded || !this.initialized) {
            return false;
        }

        try {
            return audioAddon.hasActiveAudioSession(processId);
        } catch (error) {
            console.error('[AUDIO] Error checking native audio session:', error);
            return false;
        }
    }

    isAvailable() {
        return addonLoaded && this.initialized;
    }
}

module.exports = NativeAudioController; 