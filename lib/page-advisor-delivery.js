/**
 * 转发目标（任务描述 / Cursor / Claude / Codex）。
 * 同时作用于 Alt+Z 优化建议与 Alt+X 元素调整确认。
 * 仅保留有官方 prompt 深链的 IDE；纯函数；content 词法名不得冲突。
 * 正文超过单条深链上限时按建议分批，每批各自成链，不截断、不写本机文件。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function initPageAdvisorDelivery(global) {
  'use strict';

  var PAGE_ADVISOR_DELIVERY_TARGETS = [
    'task_description',
    'cursor',
    'claude',
    'codex',
  ];

  function normalizeTarget(raw) {
    var v = String(raw || '').trim();
    return PAGE_ADVISOR_DELIVERY_TARGETS.indexOf(v) >= 0 ? v : 'task_description';
  }

  /** Cursor / Claude / Codex：走深链送达，不打开创建浮窗。 */
  function isIdeDeliveryTarget(target) {
    return normalizeTarget(target) !== 'task_description';
  }

  /**
   * Alt+Z / Alt+Shift+Z 生成成功后是否自动转发。
   * 恒为 false：须等用户点建议底栏按钮（或 Alt+X 确认）后再送达。
   */
  function shouldAutoDeliverOnResult(_target) {
    return false;
  }

  function shouldOpenCreatePanel(target) {
    return normalizeTarget(target) === 'task_description';
  }

  var IDE_I18N = {
    cursor: 'paDeliveryCursor',
    claude: 'paDeliveryClaude',
    codex: 'paDeliveryCodex',
  };
  var IDE_FALLBACK = {
    cursor: 'Cursor',
    claude: 'Claude',
    codex: 'Codex',
  };

  function ideDisplayName(target, tx) {
    var t = normalizeTarget(target);
    if (typeof tx === 'function') {
      return tx(IDE_I18N[t] || 'paDeliveryTaskDesc');
    }
    return IDE_FALLBACK[t] || '任务描述';
  }

  /** Deeplink URL 总长上限（Cursor 文档 8000；留余量）。超限按建议分批，不截断正文。 */
  var DEEPLINK_MAX_URL_LEN = 7500;

  var IDE_DEEPLINK_PREFIX = {
    cursor: 'cursor://anysphere.cursor-deeplink/prompt?text=',
    claude: 'claude://code/new?q=',
    codex: 'codex://new?prompt=',
  };

  /** 预留「批次 999/999」横幅，打包时按最坏长度计算，写出的横幅不会更长。 */
  var BATCH_BANNER_WORST = '批次 999/999。请与同一轮其它批次一起应用，不要只做本批。';
  var SUGGESTION_MARKER = '- **元素**:';

  function deeplinkPrefix(target) {
    return IDE_DEEPLINK_PREFIX[normalizeTarget(target)] || '';
  }

  function promptFitsDeeplink(target, text) {
    var prefix = deeplinkPrefix(target);
    var body = String(text || '');
    if (!prefix || !body) return false;
    return prefix.length + encodeURIComponent(body).length <= DEEPLINK_MAX_URL_LEN;
  }

  /**
   * 按目标构造 IDE 深链。仅当这一批编码后不超过 URL 上限时返回链接。
   * Cursor：cursor://anysphere.cursor-deeplink/prompt?text=（仅建议正文，不拼 /new）
   * Claude：claude://code/new?q=
   * Codex：codex://new?prompt=
   */
  function buildIdeDeeplink(target, text) {
    var prefix = deeplinkPrefix(target);
    var body = String(text || '');
    if (!prefix || !body || !promptFitsDeeplink(target, body)) return '';
    return prefix + encodeURIComponent(body);
  }

  function joinBatch(preamble, parts, pageUrl, banner) {
    var chunks = [];
    if (banner) chunks.push(banner);
    if (preamble) chunks.push(preamble);
    if (parts && parts.length) chunks.push(parts.join('\n\n'));
    if (pageUrl) chunks.push('来源页: ' + pageUrl);
    return chunks.join('\n');
  }

  function fitsJoined(target, preamble, parts, pageUrl) {
    return promptFitsDeeplink(target, joinBatch(preamble, parts, pageUrl, BATCH_BANNER_WORST));
  }

  /**
   * 从格式化块拆出共用抬头、每条建议、来源页。
   * 没有「- **元素**:」时整段当作一条（Alt+X 自由文本）。
   */
  function splitFormattedSuggestions(text) {
    var raw = String(text || '').replace(/\r\n/g, '\n');
    var pageUrl = '';
    var lines = raw.split('\n');
    if (lines.length && /^来源页:\s*/.test(lines[lines.length - 1])) {
      pageUrl = lines.pop().replace(/^来源页:\s*/, '').trim();
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
    }
    var body = lines.join('\n');
    var idx = body.indexOf(SUGGESTION_MARKER);
    if (idx < 0) {
      return { preamble: '', parts: body ? [body] : [], pageUrl: pageUrl };
    }
    var preamble = body.slice(0, idx).replace(/\n+$/, '');
    var rest = body.slice(idx);
    var parts = rest.split(/\n\n(?=- \*\*元素\*\*:)/);
    return { preamble: preamble, parts: parts, pageUrl: pageUrl };
  }

  function maxFitPrefix(target, preamble, pageUrl, text) {
    var lo = 1;
    var hi = text.length;
    var best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var n = mid;
      if (n < text.length) {
        var ch = text.charCodeAt(n - 1);
        if (ch >= 0xD800 && ch <= 0xDBFF) n -= 1;
      }
      if (n < 1) n = 1;
      if (fitsJoined(target, preamble, [text.slice(0, n)], pageUrl)) {
        best = n;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /** 单条建议自己就超限时按行再按字符切开，不丢任何字符。 */
  function splitOversizedPart(target, preamble, part, pageUrl) {
    if (fitsJoined(target, preamble, [part], pageUrl)) return [part];
    var lines = String(part).split('\n');
    var pieces = [];
    var buf = [];
    function flush() {
      if (buf.length) pieces.push(buf.join('\n'));
      buf = [];
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!fitsJoined(target, preamble, [line], pageUrl)) {
        flush();
        var rest = line;
        var guard = 0;
        while (rest && guard < 10000) {
          guard += 1;
          var n = maxFitPrefix(target, preamble, pageUrl, rest);
          if (n < 1) n = 1;
          pieces.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        continue;
      }
      var trial = buf.concat([line]);
      if (fitsJoined(target, preamble, [trial.join('\n')], pageUrl)) buf = trial;
      else {
        flush();
        buf = [line];
      }
    }
    flush();
    return pieces.length ? pieces : [part];
  }

  function packSuggestionBatches(target, preamble, parts, pageUrl) {
    var units = [];
    for (var i = 0; i < parts.length; i++) {
      var pieces = splitOversizedPart(target, preamble, parts[i], pageUrl);
      for (var j = 0; j < pieces.length; j++) units.push(pieces[j]);
    }
    if (!units.length) {
      var only = joinBatch(preamble, [], pageUrl, '');
      return only ? [only] : [];
    }
    var groups = [];
    var current = [];
    for (var u = 0; u < units.length; u++) {
      var trial = current.concat([units[u]]);
      if (current.length && !fitsJoined(target, preamble, trial, pageUrl)) {
        groups.push(current);
        current = [units[u]];
      } else {
        current = trial;
      }
    }
    if (current.length) groups.push(current);
    var n = groups.length;
    var out = [];
    for (var g = 0; g < n; g++) {
      var banner = n > 1
        ? ('批次 ' + (g + 1) + '/' + n + '。请与同一轮其它批次一起应用，不要只做本批。')
        : '';
      out.push(joinBatch(preamble, groups[g], pageUrl, banner));
    }
    return out;
  }

  /**
   * 全文放得进一条深链时原样返回。否则按建议边界打包，每批都带抬头、批次号和来源页。
   */
  function buildIdeDeeplinkBatches(target, text, pageUrl) {
    var raw = String(text || '');
    if (!raw) return [];
    if (!deeplinkPrefix(target)) return [];
    if (promptFitsDeeplink(target, raw)) return [raw];
    var split = splitFormattedSuggestions(raw);
    var url = split.pageUrl || String(pageUrl || '').trim();
    return packSuggestionBatches(target, split.preamble, split.parts, url);
  }

  function formatUserStatus(target, outcome, tx) {
    var t = typeof tx === 'function' ? tx : function (k) { return k; };
    var name = ideDisplayName(target, tx);
    var deeplinkOk = !!(outcome && outcome.deeplinkOk);
    var clipboardOk = !!(outcome && outcome.clipboardOk);
    var batchCount = Number((outcome && outcome.batchCount) || 0);
    if (deeplinkOk && batchCount > 1) {
      return { ok: true, text: t('paDeliverBatched', { name: name, count: String(batchCount) }) };
    }
    if (deeplinkOk) {
      return { ok: true, text: t('paDeliverDeeplinkOk', { name: name }) };
    }
    if (clipboardOk) {
      return { ok: true, text: t('paDeliverClipboardOnly', { name: name }) };
    }
    return { ok: false, text: t('paDeliverClipboardFail') };
  }

  var PageAdvisorDelivery = {
    TARGETS: PAGE_ADVISOR_DELIVERY_TARGETS,
    STORAGE_KEY: 'pageAdvisorDeliveryTarget',
    DEEPLINK_MAX_URL_LEN: DEEPLINK_MAX_URL_LEN,
    normalizeTarget: normalizeTarget,
    isIdeDeliveryTarget: isIdeDeliveryTarget,
    shouldAutoDeliverOnResult: shouldAutoDeliverOnResult,
    shouldOpenCreatePanel: shouldOpenCreatePanel,
    ideDisplayName: ideDisplayName,
    buildIdeDeeplink: buildIdeDeeplink,
    buildIdeDeeplinkBatches: buildIdeDeeplinkBatches,
    promptFitsDeeplink: promptFitsDeeplink,
    formatUserStatus: formatUserStatus,
  };

  global.PageAdvisorDelivery = PageAdvisorDelivery;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorDelivery;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
