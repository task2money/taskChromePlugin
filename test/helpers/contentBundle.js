'use strict';

/**
 * Concatenate top-frame content scripts in manifest order.
 * Source-contract tests must read this bundle after the float IIFE split:
 * identifiers live in content/float-*.js, not only content/content.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function contentScriptJsFromManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return manifest.content_scripts[0].js.filter((s) => s.startsWith('content/'));
}

function readContentBundle() {
  return contentScriptJsFromManifest()
    .map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    .join('\n');
}

module.exports = { ROOT, contentScriptJsFromManifest, readContentBundle };
