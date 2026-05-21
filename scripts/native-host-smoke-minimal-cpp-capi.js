try {
  console.log('minimal-cpp-capi smoke start');
  const addon = require('../src/minimal/build/Release/minimal_cpp_capi_addon.node');
  console.log('minimal-cpp-capi addon loaded');
  console.log('minimal-cpp-capi hello:', addon.hello());
  process.exit(0);
} catch (error) {
  console.error('minimal-cpp-capi smoke failed:', error && error.stack ? error.stack : error);
  process.exit(1);
}
