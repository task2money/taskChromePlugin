'use strict';

/**
 * Concatenate popup page scripts in popup.html order (lib tags skipped).
 * Source-contract tests must read this bundle after the popup IIFE split.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function popupPageScriptsFromHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
  const scripts = [];
  const re = /<script src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (src.startsWith('../')) continue;
    scripts.push(path.join('popup', path.basename(src)));
  }
  return scripts;
}

function readPopupBundle() {
  return popupPageScriptsFromHtml()
    .map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    .join('\n');
}

module.exports = { ROOT, popupPageScriptsFromHtml, readPopupBundle };
