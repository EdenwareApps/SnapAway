console.log('electron windows addon load');

try {
  require('./src/windows/build/Release/windows_addon.node');
  console.log('electron windows addon load ok');
  process.exit(0);
} catch (e) {
  console.error('electron windows addon load error', e && e.stack ? e.stack : e);
  process.exit(1);
}
