#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'templates');
const dest = path.join(root, 'dist', 'templates');

function copyRecursiveSync(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    console.error('Source templates not found:', srcDir);
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, entry);
    const d = path.join(destDir, entry);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyRecursiveSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

try {
  copyRecursiveSync(src, dest);
  console.log('Templates copied to', dest);
} catch (err) {
  console.error('Failed to copy templates:', err);
  process.exit(1);
}
