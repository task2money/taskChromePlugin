/**
 * 深链分批的共用核心（OPT-20261011-045）：协议前缀、长度上限，以及「超限按字符切开、
 * 一个字都不丢」的切分原语。插件与 taskFE 的评论唤醒各有一段完全相同的
 * @deeplink-core 区块；`db/scripts/ci/check_deeplink_core_sync.py` 逐字比对，改一边
 * 不改另一边会直接红。两边的分批编排（元素锚点、来源页、批次横幅）各留在原地。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function initDeeplinkCore(global) {
  'use strict';

  // >>> @deeplink-core（与 taskFE/app/src/utils/deeplinkCore.js 逐字相同）
  /** Deeplink URL 总长上限（Cursor 文档 8000；留余量）。超限按建议分批，不截断正文。 */
  var DEEPLINK_MAX_URL_LEN = 7500;
  /** 用户内容前缀上限。中文百分号编码约 9 倍，200 字仍给正文留预算。 */
  var CONTENT_PREFIX_MAX_LEN = 200;
  /** 仅保留有官方 prompt 深链的 IDE；任务描述、未知值都没有深链。 */
  var IDE_DEEPLINK_PREFIX = {
    cursor: 'cursor://anysphere.cursor-deeplink/prompt?text=',
    claude: 'claude://code/new?q=',
    codex: 'codex://new?prompt=',
  };

  function normalizeContentPrefix(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\r\n]+/g, ' ').trim();
    if (s.length > CONTENT_PREFIX_MAX_LEN) s = s.slice(0, CONTENT_PREFIX_MAX_LEN).trim();
    return s;
  }

  /** 该目标的深链前缀；没有深链的目标（任务描述、未知值）返回空串。 */
  function deeplinkPrefix(target) {
    var v = String(target == null ? '' : target).trim();
    return IDE_DEEPLINK_PREFIX[v] || '';
  }

  /** 这一批正文编码后是否放得进一条深链。空正文不算放得下。 */
  function promptFitsDeeplink(target, text) {
    var prefix = deeplinkPrefix(target);
    var body = String(text == null ? '' : text);
    if (!prefix || !body) return false;
    return prefix.length + encodeURIComponent(body).length <= DEEPLINK_MAX_URL_LEN;
  }

  /**
   * 二分出最长的、能被 fits 接受的字符数。不切开代理对，所以调用方按这个长度切片、
   * 再切下一段，就能保证「超限按字符切开且不丢字」。fits 收到的是待测切片，前缀与
   * 批次横幅怎么拼由调用方决定。
   */
  function maxFittingChars(text, fits) {
    var body = String(text == null ? '' : text);
    var lo = 1;
    var hi = body.length;
    var best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var n = mid;
      if (n < body.length) {
        var ch = body.charCodeAt(n - 1);
        if (ch >= 0xD800 && ch <= 0xDBFF) n -= 1;
      }
      if (n < 1) n = 1;
      if (fits(body.slice(0, n))) {
        best = n;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }
  // <<< @deeplink-core

  var DeeplinkCore = {
    DEEPLINK_MAX_URL_LEN: DEEPLINK_MAX_URL_LEN,
    CONTENT_PREFIX_MAX_LEN: CONTENT_PREFIX_MAX_LEN,
    IDE_DEEPLINK_PREFIX: IDE_DEEPLINK_PREFIX,
    normalizeContentPrefix: normalizeContentPrefix,
    deeplinkPrefix: deeplinkPrefix,
    promptFitsDeeplink: promptFitsDeeplink,
    maxFittingChars: maxFittingChars,
  };

  global.DeeplinkCore = DeeplinkCore;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeeplinkCore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
}
