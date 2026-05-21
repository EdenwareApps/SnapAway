const fs = require('fs');
const paths = ['src/language/texts.json','src/language/texts.fixed.json'];
paths.forEach(p => {
  try {
    let full = fs.readFileSync(p,'utf8');
    full = full.replace(/\u0000/g, '');
    const j = JSON.parse(full);
    let changed = false;
    Object.keys(j).forEach(lang => {
      if (j[lang] && Object.prototype.hasOwnProperty.call(j[lang], 'MASKED_WINDOW_NAMES')) {
        delete j[lang]['MASKED_WINDOW_NAMES'];
        changed = true;
      }
    });
    if (changed) {
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
      console.log('Cleaned', p);
    } else {
      console.log('No key found in', p);
    }
  } catch (e) {
    console.error('Error processing', p, e.message);
    process.exitCode = 1;
  }
});
