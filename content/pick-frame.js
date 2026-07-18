/**
 * 跨域 / 所有 iframe 内的轻量选元素脚本（all_frames）
 * 顶层完整浮窗由 content.js 负责；本脚本在子 frame 响应 pick 模式。
 * 支持 Shift+点击选择同父相邻兄弟区间。
 */
(() => {
  if (window === window.top) return; // 顶层由 content.js 处理
  if (window.__taskpluginPickFrame) return;
  window.__taskpluginPickFrame = true;

  let pickMode = false;
  let highlightedEls = [];
  let rangeAnchorEl = null;

  function ensureHighlightStyle() {
    if (document.getElementById('taskplugin-el-hl-style')) return;
    const s = document.createElement('style');
    s.id = 'taskplugin-el-hl-style';
    s.textContent = '.taskplugin-el-highlight{outline:2px solid #89b4fa!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(137,180,250,.35)!important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function clearHighlight() {
    for (const el of highlightedEls) {
      try {
        el.classList.remove('taskplugin-el-highlight');
      } catch (_) { /* detached */ }
    }
    highlightedEls = [];
  }

  function applyHighlightMany(els) {
    const list = (Array.isArray(els) ? els : [els]).filter((el) => el && el.nodeType === 1);
    if (list.length === 0) {
      clearHighlight();
      return;
    }
    const same =
      list.length === highlightedEls.length
      && list.every((el, i) => el === highlightedEls[i]);
    if (same) return;
    clearHighlight();
    ensureHighlightStyle();
    for (const el of list) {
      el.classList.add('taskplugin-el-highlight');
      highlightedEls.push(el);
    }
  }

  function clearRangeAnchor() {
    rangeAnchorEl = null;
  }

  function setPickMode(on) {
    pickMode = !!on;
    document.documentElement.classList.toggle('taskplugin-picking', pickMode);
    if (!pickMode) {
      clearHighlight();
      clearRangeAnchor();
    } else {
      clearRangeAnchor();
    }
    console.log('[taskChromePlugin] pick-frame mode:', pickMode ? 'on' : 'off', location.href);
  }

  function resolveTarget(e) {
    if (typeof ElementPicker === 'undefined') {
      return { el: e.target && e.target.nodeType === 1 ? e.target : null, closedShadow: false };
    }
    const deep = ElementPicker.deepElementFromPoint(document, e.clientX, e.clientY);
    return deep;
  }

  function locateChildFrameRect(childFrameUrl) {
    if (typeof ElementPicker === 'undefined') {
      return { success: false, error: 'ElementPicker 未加载' };
    }
    const iframe = ElementPicker.findIframeElementByUrl(document, childFrameUrl);
    if (!iframe) return { success: false, error: '未找到子 iframe' };
    const r = iframe.getBoundingClientRect();
    return {
      success: true,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
  }

  function unionRectsInFrame(els) {
    if (typeof ElementPicker !== 'undefined' && typeof ElementPicker.unionClientRects === 'function') {
      return ElementPicker.unionClientRects(
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        }),
      );
    }
    const r = els[0].getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function relaySnapshot(snapshot, rectInFrame) {
    setPickMode(false);
    chrome.runtime.sendMessage({
      action: 'elementPickedInFrame',
      snapshot,
      rectInFrame,
      frameUrl: location.href,
    }).catch((err) => {
      console.warn('[taskChromePlugin] pick-frame relay failed:', err.message || err);
    });
  }

  function onMouseOver(e) {
    if (!pickMode) return;
    const { el } = resolveTarget(e);
    if (!el) {
      clearHighlight();
      return;
    }
    if (
      e.shiftKey
      && rangeAnchorEl
      && rangeAnchorEl.parentElement
      && el.parentElement === rangeAnchorEl.parentElement
      && typeof ElementPicker !== 'undefined'
    ) {
      const range = ElementPicker.collectContiguousSiblings(rangeAnchorEl, el);
      if (range && range.length) {
        applyHighlightMany(range);
        return;
      }
    }
    applyHighlightMany([el]);
  }

  function onClick(e) {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const { el, closedShadow } = resolveTarget(e);
    if (!el || typeof ElementPicker === 'undefined') {
      setPickMode(false);
      return;
    }

    try {
      if (e.shiftKey) {
        if (!rangeAnchorEl || !rangeAnchorEl.parentElement || el.parentElement !== rangeAnchorEl.parentElement) {
          rangeAnchorEl = el;
          applyHighlightMany([el]);
          console.log('[taskChromePlugin] pick-frame range anchor set:', el.tagName);
          return;
        }
        const range = ElementPicker.collectContiguousSiblings(rangeAnchorEl, el);
        if (!range || range.length === 0) {
          rangeAnchorEl = el;
          applyHighlightMany([el]);
          return;
        }
        const snapshot = range.length === 1
          ? ElementPicker.snapshotElement(range[0], {
            closedShadow,
            inIframe: true,
            crossOriginIframe: true,
          })
          : ElementPicker.snapshotSiblingRange(range, {
            closedShadow,
            inIframe: true,
            crossOriginIframe: true,
          });
        relaySnapshot(snapshot, unionRectsInFrame(range));
        return;
      }

      clearRangeAnchor();
      const snapshot = ElementPicker.snapshotElement(el, {
        closedShadow,
        inIframe: true,
        crossOriginIframe: true,
      });
      const rect = el.getBoundingClientRect();
      relaySnapshot(snapshot, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    } catch (err) {
      console.warn('[taskChromePlugin] pick-frame snapshot failed:', err.message || err);
      clearRangeAnchor();
      setPickMode(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && pickMode) {
      e.preventDefault();
      setPickMode(false);
    }
  }

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'startElementPick') {
      setPickMode(true);
      sendResponse?.({ success: true, frame: true });
      return true;
    }
    if (msg.action === 'cancelElementPick') {
      setPickMode(false);
      sendResponse?.({ success: true, frame: true });
      return true;
    }
    if (msg.action === 'locateChildFrameRect') {
      sendResponse?.(locateChildFrameRect(msg.childFrameUrl));
      return true;
    }
  });
})();
