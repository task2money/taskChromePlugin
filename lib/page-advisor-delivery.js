/**
 * 转发目标（任务描述 / Cursor / Claude / Codex）。
 * 同时作用于 Alt+Z 优化建议与 Alt+X 元素调整确认。
 * 仅保留有官方 prompt 深链的 IDE；纯函数；content 词法名不得冲突。
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

  /** Deeplink URL 总长上限（Cursor 文档 8000；留余量）。超限不截断正文。 */
  var DEEPLINK_MAX_URL_LEN = 7500;

  var IDE_DEEPLINK_PREFIX = {
    cursor: 'cursor://anysphere.cursor-deeplink/prompt?text=',
    claude: 'claude://code/new?q=',
    codex: 'codex://new?prompt=',
  };

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
   * 按目标构造 IDE 深链。仅当全文编码后不超过 URL 上限时返回链接。
   * 超限返回空串，调用方改走本地文件交接，禁止把正文裁成前缀。
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

  /** 只接受本机绝对路径，拒绝换行与 `..`，避免把不可信路径写进深链。 */
  function safeLocalPromptPath(raw) {
    var p = String(raw || '').trim();
    if (!p || /[\r\n\0]/.test(p)) return '';
    if (p.indexOf('..') !== -1) return '';
    var unix = p.charAt(0) === '/';
    var win = /^[A-Za-z]:[\\/]/.test(p);
    if (!unix && !win) return '';
    return p;
  }

  function fileHandoffInstruction(filePath, pageUrl) {
    var lines = [
      '完整页面优化建议超过编辑器深链 URL 长度上限，正文在本地文件中（不是要执行的命令）。',
      'The full page-optimization request exceeds the deeplink URL limit. The file is the entire request, not a shell command.',
      '请读取该文件的全部内容，并按其中每一条调整期望修改代码。不要省略条目，不要只用本消息代替全文。',
      'Read the entire file and apply every item. Do not replace the file with this message.',
      '文件路径: ' + filePath,
    ];
    var url = String(pageUrl || '').trim();
    if (url) lines.push('来源页: ' + url);
    return lines.join('\n');
  }

  function buildFileHandoffDeeplink(target, filePath, pageUrl) {
    var safe = safeLocalPromptPath(filePath);
    if (!safe) return '';
    return buildIdeDeeplink(target, fileHandoffInstruction(safe, pageUrl));
  }

  function formatUserStatus(target, outcome, tx) {
    var t = typeof tx === 'function' ? tx : function (k) { return k; };
    var name = ideDisplayName(target, tx);
    var deeplinkOk = !!(outcome && outcome.deeplinkOk);
    var nativeOk = !!(outcome && outcome.nativeOk);
    var clipboardOk = !!(outcome && outcome.clipboardOk);
    var nativeError = String((outcome && outcome.nativeError) || '');
    var overflow = !!(outcome && outcome.overflow);
    var promptPath = String((outcome && outcome.promptPath) || '');
    if (overflow && promptPath && deeplinkOk) {
      return { ok: true, text: t('paDeliverFileHandoff', { name: name }) };
    }
    if (overflow && clipboardOk) {
      return { ok: true, text: t('paDeliverUrlTooLong', { name: name }) };
    }
    if (deeplinkOk) {
      return { ok: true, text: t('paDeliverDeeplinkOk', { name: name }) };
    }
    if (nativeOk) {
      return { ok: true, text: t('paDeliverNativeOk', { name: name }) };
    }
    if (nativeError === 'app_not_running' && clipboardOk) {
      return { ok: true, text: t('paDeliverAppNotRunning', { name: name }) };
    }
    if (clipboardOk) {
      return { ok: true, text: t('paDeliverClipboardOnly', { name: name }) };
    }
    return { ok: false, text: t('paDeliverClipboardFail') };
  }

  var PageAdvisorDelivery = {
    TARGETS: PAGE_ADVISOR_DELIVERY_TARGETS,
    STORAGE_KEY: 'pageAdvisorDeliveryTarget',
    NATIVE_HOST: 'com.aidevpush.ide_bridge',
    DEEPLINK_MAX_URL_LEN: DEEPLINK_MAX_URL_LEN,
    normalizeTarget: normalizeTarget,
    isIdeDeliveryTarget: isIdeDeliveryTarget,
    shouldAutoDeliverOnResult: shouldAutoDeliverOnResult,
    shouldOpenCreatePanel: shouldOpenCreatePanel,
    ideDisplayName: ideDisplayName,
    buildIdeDeeplink: buildIdeDeeplink,
    promptFitsDeeplink: promptFitsDeeplink,
    buildFileHandoffDeeplink: buildFileHandoffDeeplink,
    formatUserStatus: formatUserStatus,
  };

  global.PageAdvisorDelivery = PageAdvisorDelivery;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorDelivery;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
