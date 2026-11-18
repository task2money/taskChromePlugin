'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatSuggestionsBlock } = require('../lib/page-advisor-fill.js');

const BASE = {
  id: 's1',
  title: '对比度',
  detail: '提高按钮对比度',
  css_path: 'main > button',
  visible_text: '保存',
};

describe('page-advisor-fill source lines', () => {
  it('adds a source line and the block note for high confidence', () => {
    const block = formatSuggestionsBlock([
      { ...BASE, source_file: 'src/A.vue', source_line: 42, source_confidence: 'high' },
    ], 'https://ex.com');
    assert.match(block, /- \*\*源码\*\*: `src\/A\.vue:42`/);
    assert.match(block, /源码行号来自本页公开 source map/);
  });

  it('adds a source line for medium confidence', () => {
    const block = formatSuggestionsBlock([
      { ...BASE, source_file: 'src/B.tsx', source_line: 7, source_confidence: 'medium' },
    ], 'https://ex.com');
    assert.match(block, /- \*\*源码\*\*: `src\/B\.tsx:7`/);
  });

  it('does not add source lines or the note for low confidence', () => {
    const block = formatSuggestionsBlock([
      { ...BASE, source_file: 'src/C.ts', source_line: 1, source_confidence: 'low' },
    ], 'https://ex.com');
    assert.doesNotMatch(block, /- \*\*源码\*\*/);
    assert.doesNotMatch(block, /源码行号来自本页公开 source map/);
  });

  it('leaves the block byte-identical when no source data exists', () => {
    const block = formatSuggestionsBlock([BASE], 'https://ex.com');
    assert.doesNotMatch(block, /- \*\*源码\*\*/);
    assert.doesNotMatch(block, /源码行号来自本页公开 source map/);
    assert.match(block, /- \*\*调整期望\*\*: 对比度：提高按钮对比度/);
  });
});
