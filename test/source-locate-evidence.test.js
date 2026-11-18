'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const E = require('../lib/source-locate-evidence.js');

function fakeElement(overrides = {}) {
  const attrs = {
    'data-testid': null,
    'data-test': null,
    'data-cy': null,
    name: null,
    'aria-label': null,
    placeholder: null,
    alt: null,
    href: null,
    type: null,
    class: null,
    ...(overrides.attrs || {}),
  };
  const attributes = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([name, value]) => ({ name, value: String(value) }));
  const el = {
    nodeType: 1,
    tagName: (overrides.tagName || 'BUTTON').toUpperCase(),
    id: overrides.id || '',
    className: overrides.className || '',
    textContent: overrides.textContent || '',
    value: overrides.value,
    attributes,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
  for (const extra of overrides.attributes || []) {
    attributes.push(extra);
    el.getAttribute = ((orig) => (name) => (
      name === extra.name ? extra.value : orig(name)
    ))(el.getAttribute);
  }
  return el;
}

describe('source-locate-evidence element collection', () => {
  it('orders identifier evidence before text and keeps framework scope attrs', () => {
    const el = fakeElement({
      id: 'save',
      className: 'btn btn-primary',
      textContent: '  保存  ',
      attrs: {
        'data-testid': 'save-as-button',
        'aria-label': '保存',
        name: 'save',
      },
      attributes: [{ name: 'data-v-abc123', value: '' }],
    });
    const ev = E.collectForElements([el])[0];
    assert.equal(ev[0].kind, 'testid');
    assert.equal(ev[0].value, 'save-as-button');
    assert.ok(ev.some((x) => x.kind === 'aria' && x.value === '保存'));
    assert.ok(ev.some((x) => x.kind === 'framework' && x.value === 'data-v-abc123'));
    assert.ok(ev.some((x) => x.kind === 'class' && x.value === 'btn-primary'));
    assert.equal(ev.filter((x) => x.value === '保存').length, 1);
  });

  it('uses visible text when no identifier evidence exists', () => {
    const el = fakeElement({ textContent: '  仅有的文案  ' });
    const ev = E.collectForElements([el])[0];
    assert.deepEqual(ev, [{ kind: 'text', value: '仅有的文案' }]);
  });

  it('never reads input values; sensitive fields only keep testid/id/name', () => {
    const input = fakeElement({
      tagName: 'INPUT',
      id: 'pw',
      attrs: { type: 'password', 'data-testid': 'password-input', name: 'password' },
      value: 'secret',
      textContent: 'secret',
    });
    const ev = E.collectForElements([input])[0];
    assert.deepEqual(ev.map((x) => x.value), ['password-input', 'pw', 'password']);
    assert.ok(!JSON.stringify(ev).includes('secret'));
  });

  it('uses placeholder for non-sensitive inputs and still never reads value', () => {
    const input = fakeElement({
      tagName: 'INPUT',
      attrs: { placeholder: '请输入邮箱', 'data-testid': 'email-input' },
      value: 'user@example.com',
    });
    const ev = E.collectForElements([input])[0];
    assert.ok(ev.some((x) => x.value === '请输入邮箱'));
    assert.ok(!JSON.stringify(ev).includes('user@example.com'));
  });

  it('parses class tokens from html snippets', () => {
    assert.deepEqual(
      E.parseClassTokensFromHtmlSnippet('<button class="a b a">x</button>'),
      ['a', 'b'],
    );
    assert.deepEqual(E.parseClassTokensFromHtmlSnippet('<div>x</div>'), []);
  });

  it('dedupes and caps at 5 elements', () => {
    const els = Array.from({ length: 7 }, (_, i) => fakeElement({
      attrs: { 'data-testid': `item-${i}` },
    }));
    const out = E.collectForElements(els);
    assert.equal(out.length, 5);
    assert.equal(out[0][0].value, 'item-0');
  });
});

describe('source-locate-evidence suggestion collection', () => {
  it('uses frozen suggestion anchors without live DOM', () => {
    const ev = E.evidenceFromSuggestion({
      testid: 'toolbar-selection',
      dom_id: 'toolbar',
      aria_label: '工具栏',
      html_snippet: '<div class="toolbar toolbar--top">',
      visible_text: '选择',
    });
    assert.deepEqual(ev.map((x) => [x.kind, x.value]), [
      ['testid', 'toolbar-selection'],
      ['id', 'toolbar'],
      ['aria', '工具栏'],
      ['class', 'toolbar--top'],
      ['text', '选择'],
    ]);
  });

  it('falls back to anchor/outline text', () => {
    const ev = E.evidenceFromSuggestion({ anchor_text: '已归档' });
    assert.deepEqual(ev, [{ kind: 'text', value: '已归档' }]);
  });

  it('dedupes repeated values', () => {
    const ev = E.evidenceFromSuggestion({
      testid: 'same',
      visible_text: 'same',
    });
    assert.equal(ev.filter((x) => x.value === 'same').length, 1);
  });
});

describe('source-locate-evidence escape variants', () => {
  it('adds HTML entity and JS unicode escape variants', () => {
    const vars = E.escapeVariants('保存 & "x"');
    assert.ok(vars.includes('保存 & "x"'));
    assert.ok(vars.includes('\\u4fdd\\u5b58 & "x"'));
    assert.ok(vars.includes('保存 &amp; &quot;x&quot;'));
  });
});

describe('source-locate-evidence value caps', () => {
  it('caps evidence values at 200 chars', () => {
    const long = 'x'.repeat(300);
    const el = fakeElement({
      className: long,
      attrs: { 'data-testid': long },
    });
    const ev = E.collectForElements([el])[0];
    assert.ok(ev.length > 0);
    for (const item of ev) {
      assert.ok(item.value.length <= 200, `${item.kind} value too long`);
    }
  });
});
