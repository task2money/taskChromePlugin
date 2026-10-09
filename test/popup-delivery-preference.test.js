'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Pref = require('../popup/popup-delivery.js');

function memoryLocal(seed) {
  const bag = Object.assign({}, seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null; },
    setItem(k, v) { bag[k] = String(v); },
    bag,
  };
}

function fakeField() {
  const inputs = [
    { name: 'pageAdvisorDeliveryTarget', value: 'task_description', checked: true },
    { name: 'pageAdvisorDeliveryTarget', value: 'cursor', checked: false },
    { name: 'pageAdvisorDeliveryTarget', value: 'claude', checked: false },
    { name: 'pageAdvisorDeliveryTarget', value: 'codex', checked: false },
  ];
  const listeners = [];
  return {
    querySelectorAll(sel) {
      if (String(sel).indexOf('pageAdvisorDeliveryTarget') >= 0) return inputs;
      return [];
    },
    querySelector(sel) {
      const m = /value="([^"]+)"/.exec(String(sel));
      if (!m) return null;
      return inputs.find((i) => i.value === m[1]) || null;
    },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    emit(type, ev) {
      listeners.filter((l) => l.type === type).forEach((l) => l.fn(ev));
    },
    checked() {
      return inputs.filter((i) => i.checked).map((i) => i.value);
    },
  };
}

describe('popup delivery preference', () => {
  it('切换选项时同步写入本机，再镜像到 chrome.storage', () => {
    let setCalls = 0;
    const notes = [];
    const storage = {
      get() { return new Promise(() => {}); },
      set(obj) {
        setCalls += 1;
        notes.push(obj);
        return new Promise(() => {});
      },
    };
    const local = memoryLocal();
    const field = fakeField();
    Pref.bindPageAdvisorDeliveryRadios({
      field,
      storage,
      localStore: local,
      now: () => 1000,
      log() {},
    });
    field.emit('change', { target: field.querySelector('[value="cursor"]') });
    assert.equal(local.getItem('pageAdvisorDeliveryTarget'), 'cursor');
    assert.equal(local.getItem('pageAdvisorDeliveryTargetAt'), '1000');
    assert.equal(setCalls, 1);
    assert.equal(notes[0].pageAdvisorDeliveryTarget, 'cursor');
    assert.equal(notes[0].pageAdvisorDeliveryTargetAt, 1000);
    assert.deepEqual(field.checked(), ['cursor']);
  });

  it('下次打开用较新的本机记录勾选，并回填 chrome.storage', async () => {
    const written = [];
    const storage = {
      async get() {
        return { pageAdvisorDeliveryTarget: 'task_description', pageAdvisorDeliveryTargetAt: 1 };
      },
      async set(obj) { written.push(obj); },
    };
    const local = memoryLocal({
      pageAdvisorDeliveryTarget: 'codex',
      pageAdvisorDeliveryTargetAt: '50',
    });
    const field = fakeField();
    const bound = Pref.bindPageAdvisorDeliveryRadios({
      field,
      storage,
      localStore: local,
      now: () => 9,
      log() {},
    });
    await bound.ready;
    assert.deepEqual(field.checked(), ['codex']);
    assert.equal(written.length, 1);
    assert.equal(written[0].pageAdvisorDeliveryTarget, 'codex');
    assert.equal(written[0].pageAdvisorDeliveryTargetAt, 50);
  });

  it('慢返回的旧读取不能盖住用户刚选的目标', async () => {
    let resolveGet;
    const storage = {
      get() { return new Promise((resolve) => { resolveGet = resolve; }); },
      async set() {},
    };
    const local = memoryLocal();
    const field = fakeField();
    const bound = Pref.bindPageAdvisorDeliveryRadios({
      field,
      storage,
      localStore: local,
      now: () => 9,
      log() {},
    });
    field.emit('change', { target: field.querySelector('[value="claude"]') });
    resolveGet({ pageAdvisorDeliveryTarget: 'task_description', pageAdvisorDeliveryTargetAt: 1 });
    await bound.ready;
    assert.deepEqual(field.checked(), ['claude']);
  });

  it('旧版只写了 chrome.storage 时，下次打开仍勾选该目标', async () => {
    let setCalls = 0;
    const storage = {
      async get() { return { pageAdvisorDeliveryTarget: 'claude' }; },
      async set() { setCalls += 1; },
    };
    const field = fakeField();
    const bound = Pref.bindPageAdvisorDeliveryRadios({
      field,
      storage,
      localStore: memoryLocal(),
      now: () => 9,
      log() {},
    });
    await bound.ready;
    assert.deepEqual(field.checked(), ['claude']);
    assert.equal(setCalls, 0);
  });

  it('没有记录时保持任务描述，且不写入 storage', async () => {
    let setCalls = 0;
    const storage = {
      async get() { return {}; },
      async set() { setCalls += 1; },
    };
    const field = fakeField();
    const bound = Pref.bindPageAdvisorDeliveryRadios({
      field,
      storage,
      localStore: memoryLocal(),
      now: () => 9,
      log() {},
    });
    await bound.ready;
    assert.deepEqual(field.checked(), ['task_description']);
    assert.equal(setCalls, 0);
  });
});

describe('popup content prefix', () => {
  function fakeInput(value) {
    const listeners = [];
    return {
      value: value || '',
      addEventListener(type, fn) { listeners.push({ type, fn }); },
      emit(type) {
        listeners.filter((l) => l.type === type).forEach((l) => l.fn());
      },
    };
  }

  it('输入时把前缀写入本机与 chrome.storage，不记录正文', async () => {
    const notes = [];
    const logs = [];
    const storage = {
      async get() { return {}; },
      async set(obj) { notes.push(obj); },
    };
    const local = memoryLocal();
    const input = fakeInput('');
    const bound = Pref.bindContentPrefixInput({
      input,
      storage,
      localStore: local,
      log(msg, detail) { logs.push({ msg, detail }); },
    });
    await bound.ready;
    input.value = '  请用中文  ';
    input.emit('input');
    assert.equal(local.getItem('pageAdvisorContentPrefix'), '请用中文');
    assert.equal(notes.at(-1).pageAdvisorContentPrefix, '请用中文');
    assert.ok(logs.some((row) => row.detail && row.detail.prefixChars === 4));
    assert.equal(JSON.stringify(logs).includes('请用中文'), false);
  });

  it('下次打开恢复已保存的前缀', async () => {
    const storage = {
      async get() { return { pageAdvisorContentPrefix: '先看这里' }; },
      async set() { throw new Error('should not write'); },
    };
    const input = fakeInput('');
    const bound = Pref.bindContentPrefixInput({
      input,
      storage,
      localStore: memoryLocal(),
      log() {},
    });
    await bound.ready;
    assert.equal(input.value, '先看这里');
  });
});
