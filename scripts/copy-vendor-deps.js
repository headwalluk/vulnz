#!/usr/bin/env node
/**
 * Copy vendor dependencies from node_modules to public/vendor
 * This ensures all frontend dependencies are available during development and build
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'public/vendor');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`✓ Copied ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
}

console.log('Copying vendor dependencies...\n');

// Select2
const select2Files = [
  { src: path.join(NODE_MODULES, 'select2/dist/css/select2.min.css'), dest: path.join(VENDOR, 'select2/css/select2.min.css') },
  { src: path.join(NODE_MODULES, 'select2/dist/js/select2.min.js'), dest: path.join(VENDOR, 'select2/js/select2.min.js') },
];

// Select2 Bootstrap 5 Theme
const select2ThemeFiles = [
  {
    src: path.join(NODE_MODULES, 'select2-bootstrap-5-theme/dist/select2-bootstrap-5-theme.min.css'),
    dest: path.join(VENDOR, 'select2/css/select2-bootstrap-5-theme.min.css'),
  },
];

const allFiles = [...select2Files, ...select2ThemeFiles];

let copied = 0;
let errors = 0;

allFiles.forEach((file) => {
  try {
    copyFile(file.src, file.dest);
    copied++;
  } catch (err) {
    console.error(`✗ Failed to copy ${file.src}: ${err.message}`);
    errors++;
  }
});

console.log(`\n${copied} files copied successfully${errors > 0 ? `, ${errors} errors` : ''}`);
process.exit(errors > 0 ? 1 : 0);
