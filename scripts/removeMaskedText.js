const fs = require('fs');
const paths = ['src/language/texts.fixed.json'];
paths.forEach(p => {
  try {
    let s = fs.readFileSync(p,'utf8');
    const re = /"MASKED_WINDOW_NAMES"\s*:\s*\[([\s\S]*?)\]\s*,?/g;
    const newS = s.replace(re, '');
    if (newS !== s) {
      fs.writeFileSync(p, newS, 'utf8');
      console.log('Removed MASKED_WINDOW_NAMES from', p);
    } else {
      console.log('No occurrences found in', p);
    }
  } catch (e) {
    console.error('Error', e.message);
    process.exitCode = 1;
  }
});
