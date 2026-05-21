try {
  console.log('audio-addon smoke start');
  const addon = require('../src/audio/build/Release/audio_addon.node');
  console.log('audio-addon loaded keys:', Object.keys(addon || {}));
  console.log('audio initialize:', addon.initializeAudio());
  console.log('audio has session test:', addon.hasActiveAudioSession(1234));
  addon.cleanupAudio();
  console.log('audio-addon smoke ok');
  process.exit(0);
} catch (error) {
  console.error('audio-addon smoke failed:', error && error.stack ? error.stack : error);
  process.exit(1);
}
