/**
 * 浮窗收尾：关闭面板、runtime 消息、init（须最后注入）。
 */
function bindFloatPanelCloseButton() {
  const closeBtn = document.getElementById('taskplugin-float-close');
  if (!closeBtn) return;
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Anti-Replay-OK: ui-only — 仅收起浮窗，不隐藏悬浮球、无写接口
    hideFloatPanel();
  });
}

/**
 * 浮窗顶栏语言选择器（OPT-20260922-037）：复用 lib/locale-switcher-ui.js，
 * 与 Popup / DevTools Panel 同一取词与同步入口（aidevpush.locale）。
 */
function bindFloatLocaleSwitcher() {
  const select = document.getElementById('taskplugin-float-locale');
  if (!select) return;
  if (typeof PluginLocaleSwitcher === 'undefined' || !PluginLocaleSwitcher.bind) return;
  const i18n = globalThis.AidevpushI18n;
  if (!i18n) return;
  // Anti-Replay-OK: locale switch; syncPreferredLocale 为既有 best-effort PATCH（ADR-0089）
  PluginLocaleSwitcher.bind({
    select,
    i18n,
    sendMessage: (msg) => chrome.runtime.sendMessage(msg),
    onApplied: () => {
      if (typeof renderShortcutHints === 'function') renderShortcutHints();
    },
  });
}

function hideFloatPanel() {
  isOpen = false;
  panel.classList.remove('taskplugin-open');
  btn.classList.remove('taskplugin-active');
  btn.textContent = '+';
  if (typeof syncFloatPanelFocusTrap === 'function') syncFloatPanelFocusTrap();
  if (pickMode) setPickMode(false);
  if (adjustModal && !adjustModal.hidden) closeAdjustModal();
  if (typeof clearFloatResult === 'function') clearFloatResult();
  if (btn && typeof btn.focus === 'function') btn.focus();
}

function showPageToast(msg, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  let toast = document.getElementById('taskplugin-page-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'taskplugin-page-toast';
    root.appendChild(toast);
  }
  toast.replaceChildren();
  const parts = options.parts;
  if (parts && parts.kind === 'link' && /^https?:\/\//i.test(String(parts.href || ''))) {
    if (parts.before) toast.appendChild(document.createTextNode(parts.before));
    const a = document.createElement('a');
    a.href = String(parts.href);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'taskplugin-page-toast-link';
    a.textContent = String(parts.linkText || '');
    toast.appendChild(a);
    if (parts.after) toast.appendChild(document.createTextNode(parts.after));
  } else {
    toast.textContent = msg;
  }
  toast.className = 'taskplugin-page-toast taskplugin-page-toast-show';
  if (pageToastTimer) clearTimeout(pageToastTimer);
  const rawMs = Number(options.durationMs);
  const hideMs = Number.isFinite(rawMs) && rawMs > 0 ? rawMs : 3000;
  pageToastTimer = setTimeout(() => {
    toast.classList.remove('taskplugin-page-toast-show');
  }, hideMs);
}

function esc(s) {
  const d = document.createElement('span');
  d.textContent = String(s);
  return d.innerHTML;
}

if (!__taskpluginFloatSkip && !globalThis.__taskpluginContentBoot?.skip) {
// ---- 监听来自 popup / background 的消息 ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'openDevToolsHint') {
    if (!btn) return;
    btn.style.animation = 'none';
    void btn.getBoundingClientRect();
    btn.style.animation = 'taskplugin-pulse 0.3s ease 3';
  }
  if (msg.action === 'setFloatBallEnabled') {
    console.log('[taskChromePlugin] setFloatBallEnabled from popup:', msg.enabled);
    root.style.setProperty('display', msg.enabled ? 'block' : 'none', 'important');
    if (!msg.enabled) hideFloatPanel();
  }
  if (msg.action === 'getPageAdvisorContext') {
    try {
      const resp = (typeof getPageAdvisorContextFromFloat === 'function')
        ? getPageAdvisorContextFromFloat()
        : { success: false, error: (typeof tx === 'function' ? tx('contentAdvisorNotReady') : 'page advisor content 未就绪') };
      sendResponse?.(resp);
    } catch (e) {
      sendResponse?.({ success: false, error: e?.message || (typeof tx === 'function' ? tx('contentCaptureFailed') : '采集页面上下文失败') });
    }
    return true;
  }
  if (msg.action === 'startPageAdvisorRegionSelect') {
    try {
      const resp = (typeof startPageAdvisorRegionSelect === 'function')
        ? startPageAdvisorRegionSelect()
        : { success: false, error: (typeof tx === 'function' ? tx('contentRegionNotReady') : 'region select 未就绪') };
      sendResponse?.(resp);
    } catch (e) {
      sendResponse?.({ success: false, error: e?.message || (typeof tx === 'function' ? tx('contentRegionStartFailed') : '无法启动区域框选') });
    }
    return true;
  }
  if (msg.action === 'pageAdvisorResult') {
    try {
      if (typeof handlePageAdvisorResultMessage === 'function') {
        handlePageAdvisorResultMessage(msg);
      }
      sendResponse?.({ success: true });
    } catch (e) {
      sendResponse?.({ success: false, error: e?.message || (typeof tx === 'function' ? tx('contentShowSuggestionsFailed') : '展示建议失败') });
    }
    return true;
  }
  if (msg.action === 'pageAdvisorSitePending') {
    try {
      if (typeof handlePageAdvisorSitePendingMessage === 'function') {
        handlePageAdvisorSitePendingMessage(msg);
      }
      sendResponse?.({ success: true });
    } catch (e) {
      sendResponse?.({ success: false, error: e?.message || (typeof tx === 'function' ? tx('contentShowSitePendingFailed') : '展示待确认建议失败') });
    }
    return true;
  }
  if (msg.action === 'toggleElementPick') {
    console.log('[taskChromePlugin] toggleElementPick via keyboard shortcut');
    // 与页内 keydown 兜底监听共享去抖时间戳：
    // 浏览器级命令与按键穿透可能对同一次按键双触发，任一路径处理过则忽略另一路径
    const now = Date.now();
    if (now - lastShortcutToggleAt >= SHORTCUT_DEBOUNCE_MS) {
      lastShortcutToggleAt = now;
      if (adjustModal && !adjustModal.hidden) closeAdjustModal();
      const nextPickMode = !pickMode;
      setPickMode(nextPickMode, 'float');
      sendResponse?.({ success: true, pickMode: nextPickMode });
    } else {
      sendResponse?.({ success: true, pickMode, debounced: true });
    }
    return true;
  }
  if (msg.action === 'startElementPick') {
    console.log('[taskChromePlugin] startElementPick from', msg.source || 'float');
    if (adjustModal && !adjustModal.hidden) closeAdjustModal();
    setPickMode(true, 'float');
    sendResponse?.({ success: true });
    return true;
  }
  if (msg.action === 'cancelElementPick') {
    setPickMode(false);
    closeAdjustModal();
    sendResponse?.({ success: true });
    return true;
  }
  if (msg.action === 'elementPickedInFrame' && msg.snapshot) {
    // 来自跨域 iframe 的选中结果（经 SW 转发，含嵌套 framePath）
    console.log('[taskChromePlugin] elementPickedInFrame', msg.frameUrl, 'pathLen=', (msg.framePath || []).length);
    setPickMode(false);
    const nestDepth = Array.isArray(msg.framePath) ? msg.framePath.length : 1;
    pendingElementSnapshot = {
      ...msg.snapshot,
      crossOriginIframe: true,
      inIframe: true,
      frameNestingDepth: nestDepth,
    };
    const leafRect = msg.rectInFrame || { left: 0, top: 0, width: 0, height: 0 };
    if (typeof ElementPicker !== 'undefined' && Array.isArray(msg.ancestorIframeRects) && msg.ancestorIframeRects.length) {
      pendingElementSnapshot._viewportRect = ElementPicker.accumulateFrameViewportRect(
        leafRect,
        msg.ancestorIframeRects,
      );
    } else {
      const iframeEl = findIframeByUrl(msg.frameUrl);
      const fr = iframeEl ? iframeEl.getBoundingClientRect() : { left: 0, top: 0 };
      pendingElementSnapshot._viewportRect = {
        left: fr.left + (leafRect.left || 0),
        top: fr.top + (leafRect.top || 0),
        width: leafRect.width || 0,
        height: leafRect.height || 0,
      };
    }
    if (typeof ElementPicker !== 'undefined') {
      const prefixes = [];
      const path = msg.framePath || [];
      let doc = document;
      for (let i = 0; i < path.length; i++) {
        const iframeEl = ElementPicker.findIframeElementByUrl(doc, path[i].url)
          || (i === path.length - 1 ? findIframeByUrl(msg.frameUrl) : null);
        if (!iframeEl) break;
        try {
          const frameSnap = ElementPicker.snapshotElement(iframeEl);
          prefixes.push(frameSnap.cssPath || frameSnap.label);
          if (iframeEl.contentDocument) doc = iframeEl.contentDocument;
          else break;
        } catch (_) {
          break;
        }
      }
      if (prefixes.length) {
        pendingElementSnapshot = ElementPicker.applyFramePrefixesToSnapshot(
          pendingElementSnapshot,
          prefixes,
        );
      }
    }
    openAdjustModal(pendingElementSnapshot);
    sendResponse?.({ success: true });
    return true;
  }
  if (msg.action === 'locateChildFrameRect') {
    const iframe = typeof ElementPicker !== 'undefined'
      ? ElementPicker.findIframeElementByUrl(document, msg.childFrameUrl)
      : findIframeByUrl(msg.childFrameUrl);
    if (!iframe) {
      sendResponse?.({ success: false, error: (typeof tx === 'function' ? tx('contentIframeNotFound') : '未找到子 iframe') });
      return true;
    }
    const r = iframe.getBoundingClientRect();
    sendResponse?.({
      success: true,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    });
    return true;
  }
});

}
function findIframeByUrl(frameUrl) {
  if (!frameUrl) return null;
  if (typeof ElementPicker !== 'undefined' && ElementPicker.findIframeElementByUrl) {
    return ElementPicker.findIframeElementByUrl(document, frameUrl);
  }
  const iframes = Array.from(document.querySelectorAll('iframe'));
  let match = iframes.find((f) => f.src && f.src === frameUrl);
  if (match) return match;
  try {
    const u = new URL(frameUrl);
    match = iframes.find((f) => {
      try {
        return f.src && new URL(f.src).pathname === u.pathname;
      } catch (_) {
        return false;
      }
    });
  } catch (_) { /* ignore */ }
  return match || null;
}

if (!__taskpluginFloatSkip) {
// pulse 动画
var style = document.createElement('style');
style.textContent = `
  @keyframes taskplugin-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.2); }
  }
`;
document.head.appendChild(style);
}

if (!__taskpluginFloatSkip && !globalThis.__taskpluginContentBoot?.skip) {
// ---- Init ----
(async function init() {
  try {
    // 0. 立即绑定 UI 交互（拖拽），不依赖任何异步操作
    //    防止 Service Worker 延迟 / 启动失败导致按钮无响应
    setupDrag();
    bindFloatPanelCloseButton();
    bindFloatLocaleSwitcher();
    setupElementPicker();
    setupDescReset();
    bindStorageListeners();

    // 1. 同步初始化 datalist（不依赖网络/存储）
    seedBranchDatalists();

    // 2. 异步恢复配置和认证状态（失败不影响核心交互）
    const floatCfg = await loadFloatBallConfigFromStorage();
    console.log('[taskChromePlugin] floatBall enabled:', floatCfg.enabled);
    if (!floatCfg.enabled) {
      root.style.setProperty('display', 'none', 'important');
    }

    // 加载元素拾取快捷键配置（Popup 可自定义任意组合，默认 Alt+X）
    try {
      pickShortcutCombo = await Storage.getElementPickerShortcut();
      renderShortcutHints();
      console.log('[taskChromePlugin] pick shortcut combo:', pickShortcutCombo);
    } catch (_) { /* 保持默认 Alt+X */ }

    await restoreFloatBallPosition();

    const urlEl = document.getElementById('taskplugin-page-url');
    if (urlEl) urlEl.textContent = `📍 ${window.location.href}`;

    await refreshAuthAndWorkspaces();

    if (typeof requestSitePendingRefresh === 'function') {
      requestSitePendingRefresh();
    }

    startAuthBadgeTimer();
  } catch (err) {
    console.error('[taskChromePlugin] init() 初始化失败，核心交互已就绪:', err.message || err);
    // setupDrag 已在 try 块首行执行，
    // 即使后续异步操作全部失败，悬浮球仍可正常工作
  }
})();

}
