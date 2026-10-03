'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../lib/i18n-llm-route.js'), 'utf8');

describe('i18n-llm-route builtin refresh copy', () => {
  it('中英都有 paBuiltinRefreshing', () => {
    const zh = src.indexOf("paBuiltinRefreshing: '正在刷新内置模型状态…'");
    const en = src.indexOf("paBuiltinRefreshing: 'Refreshing on-device model status…'");
    assert.ok(zh > 0);
    assert.ok(en > zh);
  });

  it('中英都有 paBuiltinDownloadNeedEnable', () => {
    assert.match(src, /paBuiltinDownloadNeedEnable:\s*'内置模型下载进度 \{pct\}%，尚未启用/);
    assert.match(src, /paBuiltinDownloadNeedEnable:\s*'Built-in model download is \{pct\}%/);
  });

  it('中英都警示 on-device-internals 改错参数会搞坏本机模型', () => {
    assert.match(src, /paBuiltinOnDeviceInternalsCaution:\s*'。请谨慎修改其中参数；搞错后可能无法再使用本机模型。'/);
    assert.match(
      src,
      /paBuiltinOnDeviceInternalsCaution:\s*'\. Change those settings carefully; a wrong parameter can make the on-device model unusable\.'/,
    );
  });
});
