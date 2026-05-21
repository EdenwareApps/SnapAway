console.log('electron process addon load');

try {
  require('./src/process/build/Release/process_addon.node');
  console.log('electron process addon load ok');
  process.exit(0);
} catch (e) {
  console.error('electron process addon load error', e && e.stack ? e.stack : e);
  process.exit(1);
}
