const { app } = require('electron');

app.whenReady().then(() => {
  console.log('ELECTRON_SIMPLE_OK');
  app.quit();
}).catch((error) => {
  console.error('ELECTRON_SIMPLE_ERROR', error && error.message ? error.message : error);
  process.exit(1);
});
