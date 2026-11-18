/**
 * Source-locate scan/fetch runner (service worker).
 * Split from sw-source-locate.js to keep each SW file ≤500 lines.
 */

'use strict';

(function (global) {
  const MAX_RESOURCES = 24;
  const MAX_SCRIPT_CHARS = 3 * 1024 * 1024;
  const MAX_TOTAL_SCRIPT_CHARS = 12 * 1024 * 1024;
  const MAX_MAP_CHARS = 20 * 1024 * 1024;
  const MAX_TOTAL_MAP_CHARS = 40 * 1024 * 1024;
  const CONCURRENCY = 3;
  const MAX_ITEMS = 24;
  const MAX_EVIDENCE = 24;
  const MAX_OCCURRENCES = 8;
  const NO_MAP_CACHE_MAX = 128;
  const NO_MAP_CACHE_TTL = 10 * 60 * 1000;
  const EVIDENCE_KINDS = new Set(['testid', 'id', 'name', 'aria', 'class', 'framework', 'text', 'html']);
  const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

  const noMapCache = new Map();

  function resolveLocate() {
    if (global.SourceMapLocate) return global.SourceMapLocate;
    if (typeof require === 'function') {
      try { return require('../lib/source-map-locate.js'); } catch (_) { /* SW global */ }
    }
    return null;
  }

  function now() {
    return Date.now();
  }

  function cacheGet(map, key, ttl) {
    const entry = map.get(key);
    if (!entry) return null;
    if (now() - entry.at > ttl) {
      map.delete(key);
      return null;
    }
    map.delete(key);
    map.set(key, entry);
    return entry.value;
  }

  function cacheSet(map, key, value, max) {
    map.delete(key);
    map.set(key, { value, at: now() });
    while (map.size > max) {
      map.delete(map.keys().next().value);
    }
  }

  async function fetchTextCapped(url, maxChars, signal) {
    const res = await fetch(url, {
      credentials: 'omit',
      cache: 'default',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (!res || res.ok === false) {
      throw new Error(`http-${(res && res.status) || 0}`);
    }
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxChars) {
          try { await reader.cancel(); } catch (_) { /* ignore */ }
          throw new Error('too-large');
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(merged);
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxChars) throw new Error('too-large');
    return new TextDecoder().decode(buffer);
  }

  async function fetchMap(url, maxChars, signal) {
    const locate = resolveLocate();
    if (url.startsWith('data:')) {
      const text = locate.parseDataUriMap(url);
      if (text == null) throw new Error('bad-data-uri');
      if (text.length > maxChars) throw new Error('too-large');
      return { map: JSON.parse(text), chars: text.length };
    }
    const text = await fetchTextCapped(url, maxChars, signal);
    return { map: JSON.parse(text), chars: text.length };
  }

  function validMap(map) {
    return !!map
      && map.version === 3
      && typeof map.mappings === 'string'
      && Array.isArray(map.sources)
      && map.sources.length > 0;
  }

  function resourceRank(url, pageHost) {
    try {
      const host = new URL(url).hostname;
      if (host === pageHost) return 0;
      if (pageHost) {
        const suffix = pageHost.split('.').slice(-2).join('.');
        if (host === suffix || host.endsWith(`.${suffix}`)) return 1;
      }
      return 2;
    } catch (_) {
      return 3;
    }
  }

  function normalizeItems(rawItems) {
    const out = [];
    const list = Array.isArray(rawItems) ? rawItems.slice(0, MAX_ITEMS) : [];
    for (const raw of list) {
      if (!raw || raw.id == null) continue;
      const evidence = [];
      for (const ev of (Array.isArray(raw.evidence) ? raw.evidence : []).slice(0, MAX_EVIDENCE)) {
        const kind = String(ev && ev.kind || '');
        const value = String(ev && ev.value || '').trim().slice(0, 200);
        if (!EVIDENCE_KINDS.has(kind) || !value) continue;
        evidence.push({ kind, value });
      }
      if (evidence.length) out.push({ id: String(raw.id), evidence });
    }
    return out;
  }

  function buildEvidenceIndex(items) {
    const locate = resolveLocate();
    const index = new Map();
    items.forEach((item) => {
      item.evidence.forEach((ev, rank) => {
        for (const variant of locate.escapeVariants(ev.value)) {
          if (!index.has(variant)) index.set(variant, []);
          index.get(variant).push({
            itemId: item.id,
            kind: ev.kind,
            value: ev.value,
            rank,
            variant,
          });
        }
      });
    });
    return index;
  }

  function searchText(text, index) {
    const locate = resolveLocate();
    const hits = [];
    const seen = new Set();
    for (const [variant, entries] of index.entries()) {
      for (const entry of entries) {
        const boundary = entry.kind !== 'text' && entry.kind !== 'html';
        const offsets = locate.findOccurrences(text, variant, { boundary, max: MAX_OCCURRENCES });
        for (const offset of offsets) {
          const key = `${entry.itemId}|${entry.kind}|${entry.value}|${offset}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ ...entry, offset });
        }
      }
    }
    return hits;
  }

  function pathScore(path) {
    let score = 0;
    if (path.startsWith('src/') || path.includes('/src/')) score += 2;
    if (/(^|\/)node_modules\//.test(path)) score -= 3;
    if (/\.(vue|tsx|jsx|ts|js|scss|css)$/i.test(path)) score += 1;
    return score;
  }

  async function locateInResource(resourceUrl, items, index, state, signal) {
    const locate = resolveLocate();
    const result = { hits: [], rawCounts: {}, mapsFetched: 0, skipped: [] };
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    if (state.totalExceeded) return result;

    let text;
    try {
      text = await fetchTextCapped(resourceUrl, MAX_SCRIPT_CHARS, signal);
    } catch (err) {
      if (err && err.name === 'AbortError') throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      result.skipped.push(`${resourceUrl}:${err.message || 'fetch-failed'}`);
      return result;
    }
    state.scriptChars += text.length;
    if (state.scriptChars > MAX_TOTAL_SCRIPT_CHARS) {
      state.totalExceeded = true;
      result.skipped.push('too-large:total-script');
      return result;
    }

    const rawHits = searchText(text, index);
    if (!rawHits.length) return result;
    for (const hit of rawHits) {
      hit.resourceUrl = resourceUrl;
      const key = `${hit.itemId}|${hit.kind}|${hit.value}`;
      result.rawCounts[key] = (result.rawCounts[key] || 0) + 1;
    }

    const isCss = /\.css(\?|#|$)/i.test(resourceUrl)
      || /^\s*(\/\*|@charset)/.test(text.slice(0, 200));
    const rel = locate.extractSourceMappingUrl(text, isCss ? 'css' : 'js');
    if (!rel) return result;
    let mapUrl = rel;
    if (!rel.startsWith('data:')) {
      try {
        mapUrl = new URL(rel, resourceUrl).href;
      } catch (_) {
        return result;
      }
      if (!locate.isAllowedResourceUrl(mapUrl).ok) {
        result.skipped.push(`${mapUrl}:blocked-url`);
        return result;
      }
    }

    const cachedNoMap = cacheGet(noMapCache, resourceUrl, NO_MAP_CACHE_TTL);
    if (cachedNoMap) return result;

    const remaining = MAX_TOTAL_MAP_CHARS - state.mapChars;
    if (remaining <= 0) {
      state.totalExceeded = true;
      result.skipped.push('too-large:total-map');
      return result;
    }

    let parsed;
    try {
      parsed = await fetchMap(mapUrl, Math.min(MAX_MAP_CHARS, remaining), signal);
    } catch (err) {
      if (err && err.name === 'AbortError') throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      result.skipped.push(`${mapUrl}:${err.message || 'map-fetch-failed'}`);
      return result;
    }
    state.mapChars += parsed.chars;
    result.mapsFetched += 1;

    if (!validMap(parsed.map)) {
      cacheSet(noMapCache, resourceUrl, true, NO_MAP_CACHE_MAX);
      result.skipped.push(`${mapUrl}:unsupported-map`);
      return result;
    }

    const map = parsed.map;
    for (const hit of rawHits) {
      const pos = locate.offsetToPosition(text, hit.offset);
      const mapping = locate.locateMapping(map.mappings, pos.line, pos.column);
      if (!mapping) continue;
      const sourcePath = locate.normalizeSourcePath(map.sources[mapping.sourceIndex], map.sourceRoot);
      if (!sourcePath) continue;
      const verified = locate.verifySourceWindow(
        map.sourcesContent,
        mapping.sourceIndex,
        mapping.originalLine,
        hit.value,
      );
      result.hits.push({
        ...hit,
        generatedLine: pos.line,
        generatedColumn: pos.column,
        delta: mapping.delta,
        sourcePath,
        sourceVerified: verified,
        line: mapping.originalLine + 1,
        column: mapping.originalColumn,
      });
    }
    return result;
  }

  async function mapLimit(list, limit, worker) {
    const out = new Array(list.length);
    let next = 0;
    async function run() {
      while (true) {
        const i = next;
        next += 1;
        if (i >= list.length) return;
        out[i] = await worker(list[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, run));
    return out;
  }

  async function runSourceLocate(message, signal) {
    const locate = resolveLocate();
    if (!locate) return { results: [], stats: {}, error: 'fetch-failed' };
    const pageUrl = String(message.pageUrl || '');
    let pageHost = '';
    try { pageHost = new URL(pageUrl).hostname; } catch (_) { /* ignore */ }
    const items = normalizeItems(message.items);
    if (!items.length) return { results: [], stats: {}, error: 'invalid' };

    const resources = [];
    const seen = new Set();
    for (const raw of (Array.isArray(message.resources) ? message.resources : [])) {
      const url = String(raw || '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (!locate.isAllowedResourceUrl(url).ok) continue;
      resources.push(url);
    }
    if (!resources.length) return { results: [], stats: {}, error: 'blocked-url' };
    resources.sort((a, b) => resourceRank(a, pageHost) - resourceRank(b, pageHost));
    resources.splice(MAX_RESOURCES);

    const index = buildEvidenceIndex(items);
    const state = { scriptChars: 0, mapChars: 0, totalExceeded: false };
    const perResource = await mapLimit(
      resources,
      CONCURRENCY,
      (url) => locateInResource(url, items, index, state, signal),
    );

    const allHits = [];
    const mapsFetched = perResource.reduce((n, r) => n + (r && r.mapsFetched || 0), 0);
    const skipped = perResource.flatMap((r) => (r && r.skipped) || []);
    for (const r of perResource) {
      if (r && r.hits) allHits.push(...r.hits);
    }

    const counts = new Map();
    for (const r of perResource) {
      const rawCounts = r && r.rawCounts;
      if (!rawCounts) continue;
      for (const [key, count] of Object.entries(rawCounts)) {
        counts.set(key, (counts.get(key) || 0) + count);
      }
    }

    const byItem = new Map();
    for (const hit of allHits) {
      const key = `${hit.itemId}|${hit.kind}|${hit.value}`;
      const score = locate.scoreCandidate({
        evidenceKind: hit.kind,
        delta: hit.delta,
        occurrences: counts.get(key) || 1,
        secondBestDelta: secondBestDelta(allHits, key, hit.delta),
        sourcePath: hit.sourcePath,
        sourceVerified: hit.sourceVerified,
        genericId: hit.kind === 'id' && locate.GENERIC_IDS.has(hit.value),
      });
      const candidate = {
        id: hit.itemId,
        file: hit.sourcePath,
        line: hit.line,
        column: hit.column,
        confidence: score.confidence,
        reason: score.reason,
        delta: hit.delta,
        evidenceRank: hit.rank,
        pathScore: pathScore(hit.sourcePath),
      };
      if (!byItem.has(hit.itemId)) byItem.set(hit.itemId, []);
      byItem.get(hit.itemId).push(candidate);
    }

    const results = [];
    for (const [id, candidates] of byItem.entries()) {
      candidates.sort((a, b) => (
        (CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])
        || (a.delta - b.delta)
        || (a.evidenceRank - b.evidenceRank)
        || (b.pathScore - a.pathScore)
      ));
      const best = candidates[0];
      results.push({
        id,
        file: best.file,
        line: best.line,
        column: best.column,
        confidence: best.confidence,
        reason: best.reason,
      });
    }

    const stats = {
      resourcesScanned: resources.length,
      mapsFetched,
      scriptChars: state.scriptChars,
      mapChars: state.mapChars,
      skipped: skipped.slice(0, 20),
    };
    if (!results.length) {
      return {
        results: [],
        stats,
        error: state.totalExceeded ? 'too-large' : 'no-map',
      };
    }
    return { results, stats };
  }

  function secondBestDelta(hits, key, currentDelta) {
    let best = Infinity;
    let second = Infinity;
    for (const hit of hits) {
      if (`${hit.itemId}|${hit.kind}|${hit.value}` !== key) continue;
      const delta = hit.delta;
      if (delta < best) {
        second = best;
        best = delta;
      } else if (delta < second) {
        second = delta;
      }
    }
    if (currentDelta === best) return second;
    return best;
  }

  function resetCaches() {
    noMapCache.clear();
  }

  const SwSourceLocateRun = {
    resolveLocate,
    cacheGet,
    cacheSet,
    fetchTextCapped,
    fetchMap,
    validMap,
    normalizeItems,
    buildEvidenceIndex,
    searchText,
    locateInResource,
    runSourceLocate,
    resetCaches,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SwSourceLocateRun;
  }
  global.SwSourceLocateRun = SwSourceLocateRun;
}(typeof globalThis !== 'undefined' ? globalThis : this));
