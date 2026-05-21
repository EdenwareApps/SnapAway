console.log('electron direct src load');

try {
  require('./src/audio/build/Release/audio_addon.node');
  console.log('electron src load ok');
  process.exit(0);
} catch (e) {
  console.error('electron src load error', e && e.stack ? e.stack : e);
  process.exit(1);
}
