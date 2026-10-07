'use strict';

/**
 * 从 manifest.json 读取 content_scripts 的注入顺序（SSOT）。
 *
 * 为什么需要它（OPT-20261008-003）：
 * 多个自包含 e2e 用「手抄的 LIB_FILES 数组」按 manifest 顺序 addScriptTag。
 * 每新增一个 lib/content 文件都要记得同步这份数组，否则运行时会缺文件——
 * 例如 `content/float-page-advisor-fill-ui.js`（定义 confirmPageAdvisorFill）与
 * `lib/page-advisor-delivery.js`（定义 PageAdvisorDelivery）漏抄后，点击按钮直接
 * 抛 `confirmPageAdvisorFill is not defined`，断言长期红而无人知。
 * 直接读 manifest 可让测试注入面随产品自动同步，杜绝该类漂移。
 *
 * @param {{ matchesAllFrames?: boolean, index?: number }} [opts]
 *   index：取第几个 content_scripts 条目（默认 0，主文档链）。
 *   matchesAllFrames：true 取 `all_frames: true` 的条目（默认取 all_frames 非真者）。
 * @returns {string[]} 相对插件根的文件路径，保持 manifest 声明顺序。
 */

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'manifest.json');

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function manifestContentScripts(opts) {
  opts = opts || {};
  const manifest = readManifest();
  const entries = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  let entry;
  if (typeof opts.index === 'number') {
    entry = entries[opts.index];
  } else if (opts.matchesAllFrames === true) {
    entry = entries.find((e) => e && e.all_frames === true);
  } else {
    entry = entries.find((e) => e && e.all_frames !== true);
  }
  if (!entry || !Array.isArray(entry.js)) {
    throw new Error(`manifest.json: content_scripts entry not found (opts=${JSON.stringify(opts)})`);
  }
  return entry.js.slice();
}

module.exports = { manifestContentScripts };
