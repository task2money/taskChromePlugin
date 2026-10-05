'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../lib/i18n-llm-route.js'), 'utf8');

describe('i18n-llm-route builtin refresh copy', () => {
  it('paLlmRouteBuiltin 标明机子速度差异与约 130s 耗时', () => {
    assert.match(
      src,
      /paLlmRouteBuiltin:\s*'使用浏览器内置模型\(不同机子速度不一样，我的机子耗费时间130s\)'/,
    );
    assert.match(
      src,
      /paLlmRouteBuiltin:\s*'Use the browser’s built-in model \(speed varies by machine; ~130s on mine\)'/,
    );
    assert.equal(src.includes('留在本机，不必填写 API Key'), false);
    assert.equal(src.includes('stays on this device, no API key'), false);
  });

  it('paLlmRouteBuiltinMeasured 中英均带 {sec} 占位（OPT-20261005-005）', () => {
    assert.match(src, /paLlmRouteBuiltinMeasured:\s*'使用浏览器内置模型（本机最近约 \{sec\}s）'/);
    assert.match(src, /paLlmRouteBuiltinMeasured:\s*'Use the browser’s built-in model \(about \{sec\}s on this machine recently\)'/);
  });

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

  it('中英都有 paBuiltinEnabling', () => {
    assert.match(src, /paBuiltinEnabling:\s*'内置模型已下载 \{pct\}%，正在启用.*\{loadPct\}%/);
    assert.match(src, /paBuiltinEnabling:\s*'Built-in model is \{pct\}% downloaded and is being enabled.*\{loadPct\}%/);
  });

  it('中英都有 paBuiltinEnablingWait', () => {
    assert.match(src, /paBuiltinEnablingWait:\s*'内置模型已下载 \{pct\}%，正在启用.*已等待 \{sec\}s/);
    assert.match(src, /paBuiltinEnablingWait:\s*'Built-in model is \{pct\}% downloaded and is being enabled.*waited \{sec\}s/);
  });

  it('中英都警示 on-device-internals 改错参数会搞坏本机模型', () => {
    assert.match(src, /paBuiltinOnDeviceInternalsCaution:\s*'。请谨慎修改其中参数；搞错后可能无法再使用本机模型。'/);
    assert.match(
      src,
      /paBuiltinOnDeviceInternalsCaution:\s*'\. Change those settings carefully; a wrong parameter can make the on-device model unusable\.'/,
    );
  });

  it('中英都有 waterfall 空闲与环节文案', () => {
    assert.match(src, /paWfIdle:\s*'按 Alt\+Z 或 Alt\+Shift\+Z 后这里显示各环节耗时'/);
    assert.match(src, /paWfIdle:\s*'After Alt\+Z or Alt\+Shift\+Z/);
    assert.match(src, /paWfHelp:\s*'按 Alt\+Z 或区域确认后/);
    assert.match(src, /paWfCapture:\s*'采集'/);
    assert.match(src, /paWfCapture:\s*'Capture'/);
  });
});
