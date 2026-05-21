console.log('electron prebuilt119 load');

try {
  require('./src/audio/bin/win32-x64-119/audio.node');
  console.log('electron prebuilt119 load ok');
  process.exit(0);
} catch (e) {
  console.error('electron prebuilt119 load error', e && e.stack ? e.stack : e);
  process.exit(1);
}
