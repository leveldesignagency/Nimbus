const fs = require('fs');
const path = require('path');

const files = ['popup.js', 'background.js', 'contentScript.js'];

files.forEach(file => {
  if (!fs.existsSync(file)) {
    console.log(`Skipping ${file} - not found`);
    return;
  }
  
  let content = fs.readFileSync(file, 'utf8');
  const originalLength = content.length;
  
  // Remove console.log, console.info, console.debug, console.warn
  // Keep console.error but minimize it
  content = content.replace(/console\.(log|info|debug|warn)\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.(log|info|debug|warn)\([^)]*\)/g, '');
  
  // Remove multi-line console.log statements
  content = content.replace(/console\.(log|info|debug|warn)\([^)]*\)/gs, '');
  
  // Clean up empty lines (more than 2 consecutive)
  content = content.replace(/\n{3,}/g, '\n\n');
  
  fs.writeFileSync(file, content, 'utf8');
  console.log(`${file}: Removed ${originalLength - content.length} characters`);
});

console.log('Done!');
