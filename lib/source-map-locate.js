/**
 * Source map locating primitives (pure).
 *
 * Loaded by content scripts / SW via globalThis and by node tests via require.
 * No DOM and no chrome API here.
 */

'use strict';

(function (global) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_INDEX = Object.create(null);
  for (let i = 0; i < B64.length; i += 1) B64_INDEX[B64[i]] = i;

  const METADATA_HOSTS = new Set([
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
    'metadata.tencentyun.com',
  ]);

  const GENERIC_IDS = new Set([
    'root', 'app', 'main', 'content', 'container', 'page', 'wrapper',
  ]);

  const HIGH_KINDS = new Set(['testid', 'id', 'name', 'aria', 'class', 'framework']);

  function isAllowedResourceUrl(raw) {
    let url;
    try {
      url = new URL(String(raw));
    } catch (_) {
      return { ok: false, reason: 'invalid' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, reason: 'scheme' };
    }
    const host = String(url.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return { ok: false, reason: 'invalid' };
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return { ok: false, reason: 'loopback' };
    }
    if (METADATA_HOSTS.has(host)) return { ok: false, reason: 'metadata' };

    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
      const octets = v4.slice(1).map(Number);
      if (octets.some((n) => n > 255)) return { ok: false, reason: 'invalid' };
      const [a, b] = octets;
      if (a === 127) return { ok: false, reason: 'loopback' };
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return { ok: false, reason: 'private' };
      }
      if (a === 169 && b === 254) {
        return {
          ok: false,
          reason: (octets[2] === 169 && octets[3] === 254) ? 'metadata' : 'private',
        };
      }
      if (a === 100 && octets[1] === 100 && octets[2] === 100 && octets[3] === 200) {
        return { ok: false, reason: 'metadata' };
      }
      if (a === 0) return { ok: false, reason: 'private' };
      return { ok: true };
    }

    if (host.includes(':')) {
      if (host === '::1' || host === '::') return { ok: false, reason: 'loopback' };
      if (host === 'fd00:ec2::254') return { ok: false, reason: 'metadata' };
      if (/^fe[89ab][0-9a-f]:/i.test(host)) return { ok: false, reason: 'private' };
      if (/^f[cd][0-9a-f]{2}:/i.test(host)) return { ok: false, reason: 'private' };
      return { ok: true };
    }

    return { ok: true };
  }

  function decodeVlq(segment) {
    const out = [];
    let value = 0;
    let shift = 0;
    const text = String(segment || '');
    for (let i = 0; i < text.length; i += 1) {
      const digit = B64_INDEX[text[i]];
      if (digit === undefined) throw new Error('invalid VLQ character');
      const cont = digit & 32;
      value += (digit & 31) * (2 ** shift);
      if (cont) {
        shift += 5;
        continue;
      }
      const neg = value % 2 === 1;
      const magnitude = (value - (neg ? 1 : 0)) / 2;
      out.push(neg ? -magnitude : magnitude);
      value = 0;
      shift = 0;
    }
    return out;
  }

  function locateMapping(mappings, genLine, genColumn) {
    const lines = String(mappings || '').split(';');
    const targetLine = Number(genLine);
    const targetColumn = Number(genColumn);
    if (!Number.isInteger(targetLine) || targetLine < 0 || targetLine >= lines.length) return null;
    if (!Number.isFinite(targetColumn) || targetColumn < 0) return null;

    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let found = null;

    for (let li = 0; li <= targetLine; li += 1) {
      const line = lines[li];
      if (!line) continue;
      let generatedColumn = 0;
      const segments = line.split(',');
      for (let si = 0; si < segments.length; si += 1) {
        const seg = segments[si];
        if (!seg) continue;
        const values = decodeVlq(seg);
        generatedColumn += values[0];
        if (values.length >= 4) {
          sourceIndex += values[1];
          originalLine += values[2];
          originalColumn += values[3];
          if (li === targetLine && generatedColumn <= targetColumn) {
            found = {
              sourceIndex,
              originalLine,
              originalColumn,
              delta: targetColumn - generatedColumn,
            };
          }
        }
      }
    }
    return found;
  }

  function normalizeSourcePath(path, sourceRoot) {
    let p = String(path || '').trim();
    const root = String(sourceRoot || '').trim();
    if (!p) return '';
    if (root && !/^[a-z]+:\/\//i.test(p)) {
      p = `${root.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
    }
    p = p
      .replace(/^webpack:\/\/\/?/i, '')
      .replace(/^vite:\/\/\/?/i, '')
      .replace(/^file:\/\//i, '');
    while (/^\.\.?\//.test(p)) p = p.replace(/^\.\.?\//, '');
    p = p.replace(/^\/+/, '');
    if (/^[a-z]+:\/\//i.test(p)) return p.slice(0, 200);
    const srcAt = p.indexOf('src/');
    if (srcAt > 0) p = p.slice(srcAt);
    return p.slice(0, 200);
  }

  function extractSourceMappingUrl(text, kind) {
    const tail = String(text || '').slice(-2048);
    if (kind === 'css') {
      const m = /\/\*#\s*sourceMappingURL=([^\s*]+)\s*\*\//.exec(tail);
      return m ? m[1] : '';
    }
    const re = /\/\/[#@]\s*sourceMappingURL=([^\s*]+)/g;
    let last = '';
    let m;
    while ((m = re.exec(tail))) last = m[1];
    return last;
  }

  function parseDataUriMap(url) {
    const s = String(url || '').trim();
    const m = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/is.exec(s);
    if (!m) return null;
    try {
      if (m[1]) {
        if (typeof atob === 'function') return atob(m[2]);
        if (typeof Buffer !== 'undefined') return Buffer.from(m[2], 'base64').toString('binary');
        return null;
      }
      return decodeURIComponent(m[2]);
    } catch (_) {
      return null;
    }
  }

  function offsetToPosition(text, offset) {
    const s = String(text || '');
    const idx = Math.max(0, Math.min(Number(offset) || 0, s.length));
    const before = s.slice(0, idx);
    let line = 0;
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] === '\n') line += 1;
    }
    const lastNl = before.lastIndexOf('\n');
    return { line, column: idx - (lastNl + 1) };
  }

  function findOccurrences(text, literal, opts) {
    const s = String(text || '');
    const lit = String(literal || '');
    if (!lit) return [];
    const max = opts && Number(opts.max) > 0 ? Number(opts.max) : 8;
    const boundary = !opts || opts.boundary !== false;
    const out = [];
    let from = 0;
    while (out.length < max) {
      const i = s.indexOf(lit, from);
      if (i < 0) break;
      if (!boundary) {
        out.push(i);
      } else {
        const before = i > 0 ? s[i - 1] : '';
        const after = i + lit.length < s.length ? s[i + lit.length] : '';
        const ident = /[A-Za-z0-9_-]/;
        if (!ident.test(before) && !ident.test(after)) out.push(i);
      }
      from = i + Math.max(1, lit.length);
    }
    return out;
  }

  function decodeHtmlEntities(value) {
    return String(value || '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function jsUnicodeEscape(value) {
    return Array.from(String(value || '')).map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) return ch;
      if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, '0')}`;
      const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
      return `\\u${hi.toString(16).padStart(4, '0')}\\u${lo.toString(16).padStart(4, '0')}`;
    }).join('');
  }

  function escapeVariants(value) {
    const raw = String(value || '');
    if (!raw) return [];
    const out = new Set([raw, decodeHtmlEntities(raw)]);
    const escaped = jsUnicodeEscape(raw);
    if (escaped !== raw) {
      out.add(escaped);
      out.add(escaped.replace(/\\u([0-9a-f]{4})/g, (m, hex) => `\\u${hex.toUpperCase()}`));
    }
    return Array.from(out).filter(Boolean);
  }

  function maxConfidenceForKind(kind) {
    return HIGH_KINDS.has(String(kind || '')) ? 'high' : 'medium';
  }

  function verifySourceWindow(sourcesContent, sourceIndex, originalLine, literal) {
    if (!Array.isArray(sourcesContent)) return null;
    const content = sourcesContent[sourceIndex];
    if (typeof content !== 'string') return false;
    const lines = content.split('\n');
    const line = Number(originalLine) || 0;
    const start = Math.max(0, line - 2);
    const end = Math.min(lines.length, line + 3);
    const windowText = lines.slice(start, end).join('\n');
    return escapeVariants(literal).some((v) => windowText.includes(v));
  }

  function scoreCandidate(input) {
    const data = input || {};
    const kind = String(data.evidenceKind || '');
    const path = String(data.sourcePath || '');
    const inNodeModules = /(^|\/)node_modules\//.test(path);
    const delta = Math.max(0, Number(data.delta) || 0);
    const occurrences = Math.max(1, Number(data.occurrences) || 1);
    const secondBestDelta = Number(data.secondBestDelta);
    const cap = maxConfidenceForKind(kind);
    const genericId = !!data.genericId;

    if (data.sourceVerified === false) {
      return { confidence: 'low', reason: 'source-verify-failed' };
    }

    if (cap === 'high' && !genericId && !inNodeModules && occurrences === 1 && delta <= 32) {
      return { confidence: 'high', reason: 'unique-identifier' };
    }
    if (occurrences === 1 && delta <= 128) {
      return { confidence: 'medium', reason: 'unique-near' };
    }
    if (occurrences === 1 && inNodeModules && delta <= 128) {
      return { confidence: 'medium', reason: 'node-modules' };
    }
    if (
      occurrences > 1
      && delta <= 32
      && cap === 'high'
      && !genericId
      && !inNodeModules
      && Number.isFinite(secondBestDelta)
      && secondBestDelta > delta * 4
    ) {
      return { confidence: 'medium', reason: 'multi-hit-best' };
    }
    if (cap === 'medium' && occurrences === 1 && delta <= 32) {
      return { confidence: 'medium', reason: 'text-verified' };
    }
    return { confidence: 'low', reason: 'ambiguous' };
  }

  const SourceMapLocate = {
    GENERIC_IDS,
    isAllowedResourceUrl,
    decodeVlq,
    locateMapping,
    normalizeSourcePath,
    extractSourceMappingUrl,
    parseDataUriMap,
    offsetToPosition,
    findOccurrences,
    escapeVariants,
    maxConfidenceForKind,
    verifySourceWindow,
    scoreCandidate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SourceMapLocate;
  }
  global.SourceMapLocate = SourceMapLocate;
}(typeof globalThis !== 'undefined' ? globalThis : this));
