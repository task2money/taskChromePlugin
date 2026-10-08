/**
 * Content script 热重载门闩：扩展 Reload 且不刷新页面时，后续注入文件跳过重复顶层绑定。
 * 各脚本文件须包裹：if (!globalThis.__taskpluginContentBoot?.skip) { ... }
 */
'use strict';

(function taskpluginContentBootGate() {
  const g = typeof globalThis !== 'undefined' ? globalThis : self;
  // Node/CommonJS 下每个模块独立求值，不存在「热重载重复注入顶层绑定」问题。
  // 若同进程第二次加载时置 skip，后续 require 的 lib 模块会跳过 IIFE，
  // module.exports 保持空对象（OPT-20261008-011：node --test 多用例假失败）。
  const isNodeModule = typeof module !== 'undefined' && !!module.exports;
  if (g.__taskpluginContentBoot) {
    if (!isNodeModule) {
      g.__taskpluginContentBoot.skip = true;
    }
    return;
  }
  g.__taskpluginContentBoot = { skip: false };
})();
