const { app } = require('electron');

app.whenReady().then(() => {
  try {
    require('./dist/process_addon.node');
    console.log('ELECTRON_OK');
  } catch (e) {
    console.error('ELECTRON_LOAD_ERROR', e.message);
    process.exit(1);
  }
  app.quit();
}).catch((error) => {
  console.error('ELECTRON_APP_ERROR', error && error.message ? error.message : error);
  process.exit(1);
});
