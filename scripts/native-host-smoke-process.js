try {
  console.log('process smoke start');
  const p = require('../src/process/build/Release/process_addon.node');
  console.log('process addon keys:', Object.keys(p || {}));
  console.log('process smoke ok');
  process.exit(0);
} catch (e) {
  console.error('process smoke error:', e && e.stack ? e.stack : e);
  process.exit(1);
}
