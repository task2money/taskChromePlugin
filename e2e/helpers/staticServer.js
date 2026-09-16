'use strict';

/**
 * e2e 静态服务器：把插件根目录以 http://127.0.0.1:<随机端口> 提供。
 *
 * 为什么需要它（OPT-20260917-003）：
 * devtools 页与 panel 页在真实扩展中同源（chrome-extension://<id>），
 * `devtools.js` 以 `panelWindowRef.location.origin` 作为 postMessage 目标源，
 * `panel-core.js` 以 `event.origin === window.location.origin` 校验后放行。
 * 但用 `file://` 加载时两个页面是彼此隔离的不透明源：
 *   - 读取 `iframe.contentWindow.location.origin` 抛 SecurityError（消息根本发不出）；
 *   - 收到的消息 `event.origin === 'null'`，而 `window.location.origin === 'file://'`，
 *     同源校验必然拒绝（消息收到了也不处理）。
 * 结果面板请求列表恒为空，e2e 失去信号价值。
 *
 * 通过 http 提供同源页面后，上述两处校验的真实语义（同源才通信）被如实执行，
 * 与生产环境一致；生产代码无需为测试放宽安全校验。
 *
 * 仅监听回环地址，仅暴露插件根目录内文件；用完必须 close()（硬约束 44）。
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * 把 URL 路径解析为插件根目录内的绝对文件路径。
 * 越界（路径穿越）返回 null，由调用方回 403。
 */
function resolveRequestPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]);
  } catch (_) {
    return null;
  }
  const target = path.resolve(ROOT, '.' + decoded);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

function handleRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }

  const target = resolveRequestPath(req.url);
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const type = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

/**
 * 启动静态服务器（回环地址 + 临时端口）。
 * @returns {Promise<{baseURL: string, port: number, close: () => Promise<void>}>}
 */
async function startStaticServer() {
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}`,
    port,
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { ROOT, MIME_TYPES, resolveRequestPath, startStaticServer };
