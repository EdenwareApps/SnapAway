const audioAddon = require('./build/Release/audio_addon.node');

module.exports = {
    initializeAudio: audioAddon.initializeAudio,
    cleanupAudio: audioAddon.cleanupAudio,
    muteProcess: audioAddon.muteProcess,
    hasActiveAudioSession: audioAddon.hasActiveAudioSession
}; 