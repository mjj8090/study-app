// Build single HTML file for offline use
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
const js = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf-8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');

const output = html
  .replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
  .replace('<script src="app.js"></script>', `<script>${js}</script>`)
  .replace('<link rel="manifest" href="manifest.json">', '')
  .replace('<link rel="apple-touch-icon" href="icon.svg">', '')
  .replace('<link rel="icon" href="icon.svg" type="image/svg+xml">', '');

fs.writeFileSync(path.join(__dirname, 'study-app-all.html'), output);
console.log('✓ Built study-app-all.html');
