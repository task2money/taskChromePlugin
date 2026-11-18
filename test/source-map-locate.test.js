'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const L = require('../lib/source-map-locate.js');

describe('source-map-locate URL guard', () => {
  it('allows public http(s) resources', () => {
    assert.equal(L.isAllowedResourceUrl('https://cdn.example.com/app.js').ok, true);
    assert.equal(L.isAllowedResourceUrl('http://example.com/a.css').ok, true);
  });

  it('blocks loopback, private, link-local, metadata and non-http schemes', () => {
    const blocked = [
      'http://localhost/a.js',
      'http://foo.local/a.js',
      'http://127.0.0.1/a.js',
      'http://127.1.2.3/a.js',
      'http://10.1.2.3/a.js',
      'http://172.16.0.1/a.js',
      'http://172.31.255.255/a.js',
      'http://192.168.1.1/a.js',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/a.js',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://100.100.100.200/latest/meta-data/',
      'http://[::1]/a.js',
      'http://[fd00:ec2::254]/a.js',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'blob:https://example.com/x',
      'chrome-extension://abc/x',
      'data:text/html,x',
      'not a url',
    ];
    for (const url of blocked) {
      assert.equal(L.isAllowedResourceUrl(url).ok, false, url);
    }
  });

  it('does not block public hosts that merely contain a private-looking string', () => {
    assert.equal(L.isAllowedResourceUrl('https://10.example.com/app.js').ok, true);
    assert.equal(L.isAllowedResourceUrl('https://localhost.example.com/app.js').ok, true);
  });
});

describe('source-map-locate VLQ + mappings', () => {
  it('decodes VLQ segments', () => {
    assert.deepEqual(L.decodeVlq('AAAA'), [0, 0, 0, 0]);
    assert.deepEqual(L.decodeVlq('UAAU'), [10, 0, 0, 10]);
    assert.deepEqual(L.decodeVlq('SACS'), [9, 0, 1, 9]);
  });

  it('locates a generated position to an original position', () => {
    assert.deepEqual(L.locateMapping('AAAA,SACS', 0, 9), {
      sourceIndex: 0,
      originalLine: 1,
      originalColumn: 9,
      delta: 0,
    });
    assert.deepEqual(L.locateMapping('AAAA,SACS', 0, 12), {
      sourceIndex: 0,
      originalLine: 1,
      originalColumn: 9,
      delta: 3,
    });
    assert.equal(L.locateMapping('', 0, 0), null);
    assert.equal(L.locateMapping('AAAA', 3, 0), null);
  });

  it('carries source/original state across generated lines', () => {
    // line 0: genCol 0 -> src0 line0 col0; line 1: genCol 9 -> src0 line1 col9
    assert.deepEqual(L.locateMapping('AAAA;SACS', 1, 9), {
      sourceIndex: 0,
      originalLine: 1,
      originalColumn: 9,
      delta: 0,
    });
  });
});

describe('source-map-locate text helpers', () => {
  it('extracts sourceMappingURL from JS and CSS tails', () => {
    assert.equal(
      L.extractSourceMappingUrl('var a=1;\n//# sourceMappingURL=app.js.map', 'js'),
      'app.js.map',
    );
    assert.equal(
      L.extractSourceMappingUrl('/*# sourceMappingURL=app.css.map */', 'css'),
      'app.css.map',
    );
    assert.equal(L.extractSourceMappingUrl('var a=1;', 'js'), '');
  });

  it('parses data-uri maps', () => {
    assert.equal(
      L.parseDataUriMap('data:application/json;base64,eyJ2ZXJzaW9uIjozfQ=='),
      '{"version":3}',
    );
    assert.equal(L.parseDataUriMap('https://example.com/app.js.map'), null);
    assert.equal(L.parseDataUriMap('data:text/plain,hello'), null);
  });

  it('normalizes source paths', () => {
    assert.equal(L.normalizeSourcePath('webpack:///../src/views/A.vue'), 'src/views/A.vue');
    assert.equal(L.normalizeSourcePath('a.ts', 'webpack:///src'), 'src/a.ts');
    assert.equal(L.normalizeSourcePath('../../../packages/a/b.tsx'), 'packages/a/b.tsx');
    assert.equal(L.normalizeSourcePath('https://x/y/src/a.ts'), 'https://x/y/src/a.ts');
  });

  it('converts offsets to generated positions', () => {
    assert.deepEqual(L.offsetToPosition('ab\ncd', 4), { line: 1, column: 1 });
    assert.deepEqual(L.offsetToPosition('abc', 0), { line: 0, column: 0 });
  });

  it('finds occurrences with identifier boundaries', () => {
    assert.deepEqual(
      L.findOccurrences('xclear-canvas-buttony', 'clear-canvas-button', { boundary: true }),
      [],
    );
    assert.deepEqual(
      L.findOccurrences('"clear-canvas-button"', 'clear-canvas-button', { boundary: true }),
      [1],
    );
    assert.deepEqual(
      L.findOccurrences('a a', 'a', { boundary: true }),
      [0, 2],
    );
    assert.deepEqual(
      L.findOccurrences('保存 保存', '保存', { boundary: false }),
      [0, 3],
    );
  });
});

describe('source-map-locate confidence', () => {
  it('caps confidence by evidence kind and generic ids', () => {
    assert.equal(L.maxConfidenceForKind('testid'), 'high');
    assert.equal(L.maxConfidenceForKind('class'), 'high');
    assert.equal(L.maxConfidenceForKind('text'), 'medium');
    assert.equal(L.maxConfidenceForKind('html'), 'medium');
  });

  it('verifies mapped source windows', () => {
    assert.equal(L.verifySourceWindow(['const a = "x";'], 0, 0, 'x'), true);
    assert.equal(L.verifySourceWindow(['const a = "x";'], 0, 0, 'zzz'), false);
    assert.equal(L.verifySourceWindow(null, 0, 0, 'x'), null);
  });

  it('scores candidates with caps and verification', () => {
    assert.equal(L.scoreCandidate({
      evidenceKind: 'testid', delta: 1, occurrences: 1,
      sourcePath: 'src/A.vue', sourceVerified: true,
    }).confidence, 'high');
    assert.equal(L.scoreCandidate({
      evidenceKind: 'text', delta: 0, occurrences: 1,
      sourcePath: 'src/locale/zh.ts', sourceVerified: true,
    }).confidence, 'medium');
    assert.equal(L.scoreCandidate({
      evidenceKind: 'text', delta: 0, occurrences: 1,
      sourcePath: 'src/A.ts', sourceVerified: false,
    }).confidence, 'low');
    assert.equal(L.scoreCandidate({
      evidenceKind: 'testid', delta: 1, occurrences: 1,
      sourcePath: 'src/A.vue', sourceVerified: true, genericId: true,
    }).confidence, 'medium');
    assert.equal(L.scoreCandidate({
      evidenceKind: 'testid', delta: 300, occurrences: 1,
      sourcePath: 'src/A.vue', sourceVerified: true,
    }).confidence, 'low');
    assert.equal(L.scoreCandidate({
      evidenceKind: 'id', delta: 1, occurrences: 2,
      sourcePath: 'node_modules/pkg/a.js', sourceVerified: true,
    }).confidence, 'low');
  });
});
