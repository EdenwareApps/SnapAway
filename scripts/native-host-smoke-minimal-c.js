try {
  console.log('minimal-c smoke start');
  const addon = require('../src/minimal/build/Release/minimal_c_addon.node');
  console.log('minimal-c addon loaded');
  console.log('minimal-c hello:', addon.hello());
  process.exit(0);
} catch (error) {
  console.error('minimal-c smoke failed:', error && error.stack ? error.stack : error);
  process.exit(1);
}
