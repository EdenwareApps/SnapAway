try {
  console.log('iap smoke start');
  const m = require('../src/iap/build/Release/iap_addon.node');
  console.log('iap addon keys:', Object.keys(m || {}));
  console.log('iap smoke ok');
  process.exit(0);
} catch (e) {
  console.error('iap smoke error:', e && e.stack ? e.stack : e);
  process.exit(1);
}
