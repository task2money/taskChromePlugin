'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const F = require('../lib/source-locate-format.js');

describe('source-locate-format element lines', () => {
  it('writes high and medium confidence lines', () => {
    assert.equal(
      F.formatElementLine({ file: 'src/A.vue', line: 42, confidence: 'high' }),
      '- **源码定位**: `src/A.vue:42`（source map，置信度高）',
    );
    assert.equal(
      F.formatElementLine({ file: 'src/B.tsx', line: 7, confidence: 'medium' }),
      '- **源码定位**: `src/B.tsx:7`（source map，置信度中）',
    );
  });

  it('omits low confidence and invalid results', () => {
    assert.equal(F.formatElementLine({ file: 'src/A.vue', line: 42, confidence: 'low' }), '');
    assert.equal(F.formatElementLine({ file: '', line: 42, confidence: 'high' }), '');
    assert.equal(F.formatElementLine(null), '');
  });

  it('supports multi-select indexes', () => {
    assert.equal(
      F.formatElementLine({ file: 'src/A.vue', line: 42, confidence: 'high' }, 2),
      '- **源码定位 2**: `src/A.vue:42`（source map，置信度高）',
    );
  });
});

describe('source-locate-format suggestion lines', () => {
  it('writes a compact suggestion line', () => {
    assert.equal(
      F.formatSuggestionLine({ file: 'src/B.tsx', line: 7, confidence: 'medium' }),
      '- **源码**: `src/B.tsx:7`',
    );
  });

  it('omits low confidence', () => {
    assert.equal(F.formatSuggestionLine({ file: 'src/B.tsx', line: 7, confidence: 'low' }), '');
  });

  it('keeps the block note stable', () => {
    assert.match(F.formatBlockNote(), /^源码行号来自本页公开 source map/);
  });
});

describe('source-locate-format path safety', () => {
  it('strips control chars and backticks and caps length', () => {
    assert.equal(F.sanitizePath('a`b\nc'), 'aˋb c');
    assert.equal(F.sanitizePath('x'.repeat(300)).length, 200);
  });

  it('labels confidence', () => {
    assert.equal(F.confidenceLabel('high'), '高');
    assert.equal(F.confidenceLabel('medium'), '中');
    assert.equal(F.confidenceLabel('low'), '低');
  });

  it('only writes high/medium', () => {
    assert.equal(F.isWritable('high'), true);
    assert.equal(F.isWritable('medium'), true);
    assert.equal(F.isWritable('low'), false);
    assert.equal(F.isWritable(''), false);
  });
});
