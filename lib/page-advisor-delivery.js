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

  /** Deeplink URL 总长上限（Cursor 文档 8000；留余量）。 */
  var DEEPLINK_MAX_URL_LEN = 7500;

  /**
   * 按目标构造 IDE 深链。仅支持有官方 prompt 预填协议的目标。
   * Cursor：cursor://anysphere.cursor-deeplink/prompt?text=（仅建议正文，不拼 /new）
   * Claude：claude://code/new?q=
   * Codex：codex://new?prompt=
   */
  function buildIdeDeeplink(target, text) {
    var t = normalizeTarget(target);
    var body = String(text || '');
    if (t === 'task_description' || !body) return '';

    function fitPrompt(prefix, encodeBody) {
      var slice = encodeBody;
      while (slice.length > 0) {
        var enc = encodeURIComponent(slice);
        if (prefix.length + enc.length <= DEEPLINK_MAX_URL_LEN) {
          return prefix + enc;
        }
        var next = Math.floor(slice.length * 0.85);
        if (next >= slice.length) next = slice.length - 200;
        if (next < 80) return '';
        slice = slice.slice(0, next) + '\n…';
      }
      return '';
    }

    if (t === 'cursor') {
      // 官方 prompt deeplink：整段一次 encodeURIComponent(正文)，不含 /new 前缀
      return fitPrompt('cursor://anysphere.cursor-deeplink/prompt?text=', body);
    }
    if (t === 'claude') {
      return fitPrompt('claude://code/new?q=', body);
    }
    if (t === 'codex') {
      return fitPrompt('codex://new?prompt=', body);
    }
    return '';
  }

  function formatUserStatus(target, outcome, tx) {
    var t = typeof tx === 'function' ? tx : function (k) { return k; };
    var name = ideDisplayName(target, tx);
    var deeplinkOk = !!(outcome && outcome.deeplinkOk);
    var nativeOk = !!(outcome && outcome.nativeOk);
    var clipboardOk = !!(outcome && outcome.clipboardOk);
    var nativeError = String((outcome && outcome.nativeError) || '');
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
    formatUserStatus: formatUserStatus,
  };

  global.PageAdvisorDelivery = PageAdvisorDelivery;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorDelivery;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
