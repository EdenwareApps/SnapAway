try {
  console.log('minimal smoke start');
  const addon = require('../src/minimal/build/Release/minimal_addon.node');
  console.log('minimal addon loaded');
  console.log('minimal hello:', addon.hello());
  process.exit(0);
} catch (error) {
  console.error('minimal smoke failed:', error && error.stack ? error.stack : error);
  process.exit(1);
}
