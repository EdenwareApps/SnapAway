try {
  console.log('native host smoke start');
  const p = require('../src/process/build/Release/process_addon.node');
  const a = require('../src/audio/build/Release/audio_addon.node');
  console.log('process addon keys:', Object.keys(p || {}));
  console.log('audio addon keys:', Object.keys(a || {}));
  console.log('native host smoke ok');
  process.exit(0);
} catch (e) {
  console.error('native host smoke error:', e && e.stack ? e.stack : e);
  process.exit(1);
}
