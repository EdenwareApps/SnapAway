try {
  console.log('audio smoke start');
  const a = require('../src/audio/build/Release/audio_addon.node');
  console.log('audio addon keys:', Object.keys(a || {}));
  console.log('audio smoke ok');
  process.exit(0);
} catch (e) {
  console.error('audio smoke error:', e && e.stack ? e.stack : e);
  process.exit(1);
}
