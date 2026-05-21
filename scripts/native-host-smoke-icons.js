try {
  console.log('icons smoke start');
  const m = require('../src/icons/build/Release/icon_addon.node');
  console.log('icons addon keys:', Object.keys(m || {}));
  console.log('icons smoke ok');
  process.exit(0);
} catch (e) {
  console.error('icons smoke error:', e && e.stack ? e.stack : e);
  process.exit(1);
}
