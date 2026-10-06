'use strict';

/**
 * 指针选择：⌘/Ctrl 多选必须在 pointerdown 判定修饰键。
 * Alt+X 后 click 上的 ctrlKey/metaKey 常被浏览器剥掉，只听 click 会变成立刻单选。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'float-pick.js'), 'utf8');
const pickFrame = fs.readFileSync(path.join(__dirname, '..', 'content', 'pick-frame.js'), 'utf8');
const region = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'float-page-advisor-region.js'),
  'utf8',
);

describe('Ctrl/Cmd multi-select uses pointerdown', () => {
  it('float-pick attaches pointerdown and contextmenu in pick mode', () => {
    assert.match(src, /addEventListener\('pointerdown',\s*onPickSelectEvent,\s*true\)/);
    assert.match(src, /addEventListener\('contextmenu',\s*onPickSelectEvent,\s*true\)/);
    assert.match(src, /pickGestureKind\(/);
  });

  it('pick-frame uses the same gesture helper', () => {
    assert.match(pickFrame, /addEventListener\('pointerdown'/);
    assert.match(pickFrame, /pickGestureKind\(/);
  });

  it('region select uses the same gesture helper', () => {
    assert.match(region, /addEventListener\('pointerdown'/);
    assert.match(region, /pickGestureKind\(/);
  });
});
