'use strict';

/**
 * Expand service-worker importScripts (lib + local ./sw-*.js) the way Chrome does:
 * one shared global scope. Source-contract tests must read this bundle after the SW split.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SW_PATH = path.join(ROOT, 'background', 'service-worker.js');
const BG_DIR = path.join(ROOT, 'background');

function parseImportScriptsArgs(swSrc) {
  const m = swSrc.match(/importScripts\(([\s\S]*?)\);/);
  if (!m) return [];
  return (m[1].match(/'[^']+'/g) || []).map((p) => p.slice(1, -1));
}

function resolveImportScript(relFromSw) {
  return path.normalize(path.join(BG_DIR, relFromSw));
}

function importedScriptAbsPaths() {
  const swSrc = fs.readFileSync(SW_PATH, 'utf8');
  return parseImportScriptsArgs(swSrc).map(resolveImportScript);
}

/** Local background scripts listed in importScripts (not ../lib). */
function swLocalRelPaths() {
  const swSrc = fs.readFileSync(SW_PATH, 'utf8');
  return parseImportScriptsArgs(swSrc)
    .filter((p) => !p.startsWith('../'))
    .map((p) => path.join('background', path.basename(p)));
}

function swBodyWithoutImportScripts() {
  const swSrc = fs.readFileSync(SW_PATH, 'utf8');
  return swSrc.replace(/importScripts\(([\s\S]*?)\);/, '');
}

/** Concatenate local SW modules + remaining service-worker.js (no lib). */
function readSWLocalBundle() {
  const locals = swLocalRelPaths().map((rel) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return locals.join('\n') + '\n' + swBodyWithoutImportScripts();
}

/** Full vm script: libs + local SW modules + remaining body. */
function buildSWScript() {
  const imported = importedScriptAbsPaths().map((abs) => fs.readFileSync(abs, 'utf8'));
  return imported.join('\n') + '\n' + swBodyWithoutImportScripts();
}

function swFilesForLineLimit() {
  return ['background/service-worker.js', ...swLocalRelPaths()];
}

module.exports = {
  ROOT,
  SW_PATH,
  parseImportScriptsArgs,
  buildSWScript,
  readSWLocalBundle,
  swLocalRelPaths,
  swFilesForLineLimit,
};
