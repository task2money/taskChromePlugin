'use strict';

/**
 * content.js / pick-frame.js / SW 源码契约：
 * 定时器、指针监听、消息广播不得在闲置时常驻热路径。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const { readContentBundle } = require('./helpers/contentBundle.js');
const content = readContentBundle();
const pickFrame = read('content/pick-frame.js');
const sw = read('background/service-worker.js');
const manifest = read('manifest.json');

describe('content.js CPU 热路径契约', () => {
  it('角标定时器走可见性感知 interval（hidden 停表）', () => {
    assert.match(content, /startDocumentVisibilityInterval\(/);
  });

  it('不再在 startAuthBadgeTimer 里无条件 setInterval', () => {
    assert.doesNotMatch(
      content,
      /function startAuthBadgeTimer\(\)[\s\S]{0,400}window\.__taskpluginAuthBadgeTimer\s*=\s*setInterval/,
    );
  });

  it('setupDrag 不在初始化时把 mousemove 挂到 document', () => {
    const setup = content.slice(content.indexOf('function setupDrag'), content.indexOf('function onDragStart'));
    assert.doesNotMatch(setup, /document\.addEventListener\('mousemove'/);
    assert.match(content, /onDragStart[\s\S]{0,800}document\.addEventListener\('mousemove',\s*onDragMove\)/);
    assert.match(content, /onDragEnd[\s\S]{0,500}document\.removeEventListener\('mousemove',\s*onDragMove\)/);
  });

  it('选元素 mouseover/click 仅在 pickMode 时挂载', () => {
    const setup = content.slice(content.indexOf('function setupElementPicker'), content.indexOf('function syncDescResetButton'));
    assert.doesNotMatch(setup, /document\.addEventListener\('mouseover',\s*onPickMouseOver/);
    assert.match(content, /function attachPickPointerListeners/);
    assert.match(content, /function detachPickPointerListeners/);
    assert.match(content, /setPickMode[\s\S]*attachPickPointerListeners\(\)/);
  });

  it('storage.onChanged 合并为单一监听（禁止 3 个 addListener）', () => {
    const matches = content.match(/chrome\.storage\.onChanged\.addListener/g) || [];
    assert.equal(matches.length, 1, `content.js 应只有 1 个 storage.onChanged 监听，实际 ${matches.length}`);
    assert.match(content, /function bindStorageListeners/);
    assert.match(content, /changes\.floatBallEnabled/);
  });
});

describe('pick-frame.js CPU 热路径契约', () => {
  it('初始化不挂 mouseover；仅 pickMode 时 attach/detach', () => {
    assert.match(pickFrame, /function attachPickPointerListeners/);
    assert.match(pickFrame, /document\.removeEventListener\('mouseover',\s*onMouseOver,\s*true\)/);
    assert.match(pickFrame, /attachPickPointerListeners\(\)/);
    assert.match(pickFrame, /detachPickPointerListeners\(\)/);
  });
});

describe('SW webRequest body 热路径契约', () => {
  it('onBeforeRequest 使用 WEB_REQUEST_BODY_TYPES 过滤静态资源', () => {
    assert.match(sw, /WEB_REQUEST_BODY_TYPES/);
    assert.match(sw, /shouldCacheWebRequestBody/);
  });

  it('importScripts / manifest 加载新 lib', () => {
    assert.match(sw, /hot-path-guards\.js/);
    assert.match(manifest, /visibility-interval\.js/);
    assert.match(manifest, /hot-path-guards\.js/);
  });
});
