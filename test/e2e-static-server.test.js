'use strict';

/**
 * e2e 静态服务器回归测试（OPT-20260917-003）
 * 该服务器承载 devtools 页与 panel 页的**同源** e2e 环境，越界与泄漏必须被挡住。
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { startStaticServer, resolveRequestPath, ROOT } = require(
  path.join(__dirname, '..', 'e2e', 'helpers', 'staticServer.js'),
);

function request(baseURL, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(baseURL + urlPath, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
  });
}

describe('e2e 静态服务器', () => {
  let server;

  before(async () => { server = await startStaticServer(); });
  after(async () => { await server.close(); });

  it('监听回环地址并使用临时端口', () => {
    assert.match(server.baseURL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(server.port > 0);
  });

  it('提供 devtools 页与 panel 页（同源前提）', async () => {
    const devtools = await request(server.baseURL, '/devtools/devtools.html');
    assert.equal(devtools.status, 200);
    assert.match(devtools.headers['content-type'], /text\/html/);
    assert.match(devtools.body, /devtools\.js/);

    const panel = await request(server.baseURL, '/panel/panel.html');
    assert.equal(panel.status, 200);
    assert.match(panel.headers['content-type'], /text\/html/);
  });

  it('JS 以 text/javascript 提供', async () => {
    const res = await request(server.baseURL, '/devtools/devtools.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/javascript/);
  });

  it('缺失文件返回 404', async () => {
    const res = await request(server.baseURL, '/no/such/file.js');
    assert.equal(res.status, 404);
  });

  it('非 GET/HEAD 方法返回 405', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(server.baseURL + '/devtools/devtools.html', { method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 405);
  });
});

describe('静态服务器路径解析（路径穿越防护）', () => {
  it('根路径解析到插件根目录', () => {
    assert.equal(resolveRequestPath('/'), ROOT);
  });

  it('插件内路径正常解析', () => {
    assert.equal(resolveRequestPath('/panel/panel.html'), path.join(ROOT, 'panel', 'panel.html'));
  });

  it('.. 穿越与 URL 编码穿越都被拒绝', () => {
    assert.equal(resolveRequestPath('/../../etc/passwd'), null);
    assert.equal(resolveRequestPath('/%2e%2e/%2e%2e/etc/passwd'), null);
    assert.equal(resolveRequestPath('/panel/../../etc/passwd'), null);
  });

  it('查询串与片段不影响解析', () => {
    assert.equal(resolveRequestPath('/panel/panel.html?v=1#x'), path.join(ROOT, 'panel', 'panel.html'));
  });
});

describe('e2e 同源环境守卫（OPT-20260917-003）', () => {
  const PANEL_E2E_FILES = [
    'e2e/panel-request-clear.playwright.test.js',
    'e2e/panel-request-refresh.playwright.test.js',
  ];

  it('面板 e2e 经 http 同源加载，不得回退 file://', () => {
    for (const rel of PANEL_E2E_FILES) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      assert.match(src, /startStaticServer/, `${rel} 未使用静态服务器`);
      assert.doesNotMatch(
        src,
        /goto\(\s*'file:\/\//,
        `${rel} 回退到 file:// 后 devtools 与 panel 互为不透明源，用例会恒失败`,
      );
    }
  });

  it('发送端保持 S2819 收敛：devtools.js 不再用 "*" 作 targetOrigin', () => {
    const devtools = fs.readFileSync(path.join(ROOT, 'devtools', 'devtools.js'), 'utf8');
    assert.doesNotMatch(devtools, /postMessage\([^)]*,\s*'\*'\)/);
    assert.match(devtools, /panelWindowRef\.location\.origin/);
  });

  it('接收端保持同源校验，不因 e2e 放宽', () => {
    const panelCore = fs.readFileSync(
      path.join(ROOT, 'panel', 'lib', 'panel-core.js'),
      'utf8',
    );
    assert.match(panelCore, /event\.origin\s*!==\s*window\.location\.origin/);
  });
});
