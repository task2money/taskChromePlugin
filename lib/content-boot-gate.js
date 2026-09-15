/**
 * Content script 热重载门闩：扩展 Reload 且不刷新页面时，后续注入文件跳过重复顶层绑定。
 * 各脚本文件须包裹：if (!globalThis.__taskpluginContentBoot?.skip) { ... }
 */
'use strict';

(function taskpluginContentBootGate() {
  const g = typeof globalThis !== 'undefined' ? globalThis : self;
  if (g.__taskpluginContentBoot) {
    g.__taskpluginContentBoot.skip = true;
    return;
  }
  g.__taskpluginContentBoot = { skip: false };
})();
