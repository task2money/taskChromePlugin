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
  /** 用户内容前缀上限。中文百分号编码约 9 倍，200 字仍给正文留预算。 */
  var CONTENT_PREFIX_MAX_LEN = 200;
  var PAGE_ADVISOR_CONTENT_PREFIX_KEY = 'pageAdvisorContentPrefix';

  function normalizeContentPrefix(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\r\n]+/g, ' ').trim();
    if (s.length > CONTENT_PREFIX_MAX_LEN) s = s.slice(0, CONTENT_PREFIX_MAX_LEN).trim();
    return s;
  }

  /** 有前缀时加在正文前，中间换行。空前缀原样返回。 */
  function prependContentPrefix(text, prefix) {
    var p = normalizeContentPrefix(prefix);
    var body = String(text == null ? '' : text);
    if (!p) return body;
    if (!body) return p;
    return p + '\n' + body;
  }

  var IDE_DEEPLINK_PREFIX = {
    cursor: 'cursor://anysphere.cursor-deeplink/prompt?text=',
    claude: 'claude://code/new?q=',
    codex: 'codex://new?prompt=',
  };

  /**
   * 多批时每批都写成可单独执行的提示。横幅按「批次 999/999」预留最坏长度，
   * 实际写出的更短，不会在打包后再超限。
   */
  function batchIndependenceBanner(index, total) {
    return '批次 ' + index + '/' + total
      + '。本批可单独应用：只改本批列出的内容并完成，不要等待或合并其它批次。';
  }
  var BATCH_BANNER_WORST = batchIndependenceBanner(999, 999);
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

  /** 本次打包使用的内容前缀。buildIdeDeeplinkBatches 同步设置，结束即恢复。 */
  var batchContentPrefix = '';

  function withContentPrefix(prefix, fn) {
    var prev = batchContentPrefix;
    batchContentPrefix = normalizeContentPrefix(prefix);
    try {
      return fn();
    } finally {
      batchContentPrefix = prev;
    }
  }

  function joinBatch(preamble, parts, pageUrl, banner) {
    var chunks = [];
    if (batchContentPrefix) chunks.push(batchContentPrefix);
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

  function maxFitPrefix(target, preamble, pageUrl, text, wrap) {
    var render = typeof wrap === 'function' ? wrap : function (s) { return [s]; };
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
      if (fitsJoined(target, preamble, render(text.slice(0, n)), pageUrl)) {
        best = n;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /** 单条建议自己就超限时按行再按字符切开，不丢任何字符。 */
  /** 该建议自身的元素行与选择器行；续段补回后仍能单独定位同一元素。 */
  function elementAnchorLines(part) {
    var out = [];
    var lines = String(part).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/^- \*\*元素\*\*:/.test(lines[i]) || /^- \*\*选择器\*\*:/.test(lines[i])) {
        out.push(lines[i]);
      }
    }
    return out;
  }

  function splitOversizedPart(target, preamble, part, pageUrl) {
    if (fitsJoined(target, preamble, [part], pageUrl)) return [part];
    // 只拿到后半段正文的续段，编辑器不知道改哪个元素；在 URL 预算内补回元素/选择器行。
    var headerText = elementAnchorLines(part).join('\n');
    // 选择器本身极大以致单放都超限时退回不补，避免每段都被头部撑爆。
    if (headerText && !fitsJoined(target, preamble, [headerText + '\n'], pageUrl)) headerText = '';
    var lines = String(part).split('\n');
    var pieces = [];
    var buf = [];
    function continuation(text) {
      return headerText ? headerText + '\n' + text : text;
    }
    function renderHeadered(text) {
      return [pieces.length ? continuation(text) : text];
    }
    function flush() {
      if (buf.length) pieces.push(pieces.length ? continuation(buf.join('\n')) : buf.join('\n'));
      buf = [];
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!fitsJoined(target, preamble, renderHeadered(line), pageUrl)) {
        flush();
        var rest = line;
        var guard = 0;
        while (rest && guard < 10000) {
          guard += 1;
          var n = maxFitPrefix(target, preamble, pageUrl, rest, renderHeadered);
          if (n < 1) n = 1;
          var slice = rest.slice(0, n);
          pieces.push(pieces.length ? continuation(slice) : slice);
          rest = rest.slice(n);
        }
        continue;
      }
      var trial = buf.concat([line]);
      if (fitsJoined(target, preamble, renderHeadered(trial.join('\n')), pageUrl)) buf = trial;
      else {
        flush();
        buf = [line];
      }
    }
    flush();
    return pieces.length ? pieces : [part];
  }

  function expectationTitles(text) {
    var titles = [];
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^- \*\*调整期望\*\*: (.+)$/);
      if (!m) continue;
      var raw = m[1];
      var cut = raw.indexOf('：');
      if (cut < 0) cut = raw.indexOf(':');
      titles.push((cut > 0 ? raw.slice(0, cut) : raw).trim());
    }
    return titles;
  }

  /** 多批时去掉指向不在本批的「同目标」，避免编辑器去等另一批。 */
  function scrubAbsentPeerNotes(parts) {
    var present = {};
    var titles = expectationTitles(parts.join('\n'));
    for (var t = 0; t < titles.length; t++) present[titles[t]] = true;
    var out = [];
    for (var p = 0; p < parts.length; p++) {
      var lines = String(parts[p]).split('\n');
      var kept = [];
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/^(\s*)同目标:\s*与「([^」]*)」/);
        if (!m) {
          kept.push(lines[i]);
          continue;
        }
        var names = m[2].split('、').map(function (s) { return s.trim(); }).filter(function (name) {
          return name && present[name];
        });
        if (!names.length) continue;
        kept.push(m[1] + '同目标: 与「' + names.join('、') + '」指向同一元素或父子节点，请一次改完');
      }
      out.push(kept.join('\n').replace(/\n+$/, ''));
    }
    return out;
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
      var groupParts = n > 1 ? scrubAbsentPeerNotes(groups[g]) : groups[g];
      var banner = n > 1 ? batchIndependenceBanner(g + 1, n) : '';
      out.push(joinBatch(preamble, groupParts, pageUrl, banner));
    }
    return out;
  }

  /**
   * 全文（含内容前缀）放得进一条深链时作为一批返回。否则按建议边界打包。
   * 前缀加在每一批最前，并计入 URL 长度。多批时每批都可单独应用。
   */
  function buildIdeDeeplinkBatches(target, text, pageUrl, contentPrefix) {
    var raw = String(text || '');
    if (!raw) return [];
    if (!deeplinkPrefix(target)) return [];
    return withContentPrefix(contentPrefix, function () {
      var whole = batchContentPrefix ? (batchContentPrefix + '\n' + raw) : raw;
      if (promptFitsDeeplink(target, whole)) return [whole];
      var split = splitFormattedSuggestions(raw);
      var url = split.pageUrl || String(pageUrl || '').trim();
      return packSuggestionBatches(target, split.preamble, split.parts, url);
    });
  }


  var PAGE_ADVISOR_DELIVERY_STORAGE_KEY = 'pageAdvisorDeliveryTarget';

  /**
   * 本机 localStorage 与 chrome.storage 可能一先一后写完。
   * 时间戳更大的一侧胜出；都没有时间戳时沿用已有的 chrome.storage（旧版只写了目标）。
   */
  function chooseDeliveryPreference(opts) {
    opts = opts || {};
    var lAt = Number(opts.localAt) || 0;
    var rAt = Number(opts.remoteAt) || 0;
    var l = opts.localTarget == null ? '' : String(opts.localTarget);
    var r = opts.remoteTarget == null ? '' : String(opts.remoteTarget);
    if (lAt > rAt && l) return { target: normalizeTarget(l), at: lAt, source: 'local' };
    if (rAt > lAt && r) return { target: normalizeTarget(r), at: rAt, source: 'remote' };
    if (r) return { target: normalizeTarget(r), at: rAt, source: 'remote' };
    if (l) return { target: normalizeTarget(l), at: lAt, source: 'local' };
    return { target: 'task_description', at: 0, source: 'default' };
  }

  function preferencePayload(raw, at) {
    var stamp = Number(at);
    if (!isFinite(stamp) || stamp <= 0) stamp = Date.now();
    var out = {};
    out[PAGE_ADVISOR_DELIVERY_STORAGE_KEY] = normalizeTarget(raw);
    out[PAGE_ADVISOR_DELIVERY_STORAGE_KEY + 'At'] = stamp;
    return out;
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
    STORAGE_KEY: PAGE_ADVISOR_DELIVERY_STORAGE_KEY,
    chooseDeliveryPreference: chooseDeliveryPreference,
    preferencePayload: preferencePayload,
    DEEPLINK_MAX_URL_LEN: DEEPLINK_MAX_URL_LEN,
    CONTENT_PREFIX_MAX_LEN: CONTENT_PREFIX_MAX_LEN,
    CONTENT_PREFIX_KEY: PAGE_ADVISOR_CONTENT_PREFIX_KEY,
    normalizeContentPrefix: normalizeContentPrefix,
    prependContentPrefix: prependContentPrefix,
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
