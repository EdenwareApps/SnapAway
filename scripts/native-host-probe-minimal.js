const fs = require('fs');
const path = require('path');

const logPath = path.join(process.cwd(), 'minimal-probe.log');
function log(msg) {
  fs.appendFileSync(logPath, msg + '\n', 'utf8');
}

try {
  log('probe start');
  const addon = require('../src/minimal/build/Release/minimal_addon.node');
  log('probe loaded');
  log('probe hello=' + addon.hello());
  process.exit(0);
} catch (error) {
  log('probe error=' + (error && error.stack ? error.stack : String(error)));
  process.exit(1);
}
