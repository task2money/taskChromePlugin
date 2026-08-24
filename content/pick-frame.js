/**
 * 跨域 / 所有 iframe 内的轻量选元素脚本（all_frames）
 * 顶层完整浮窗由 content.js 负责；本脚本在子 frame 响应 pick 模式。
 * 支持 ⌘/Ctrl+点击累加多选，Enter 确认。
 */
(() => {
  if (window === window.top) return; // 顶层由 content.js 处理
  if (window.__taskpluginPickFrame) return;
  window.__taskpluginPickFrame = true;

  let pickMode = false;
  let highlightedEls = [];
  let pickSelection = [];
  // 页内兜底快捷键组合串（与 content.js 同规则：默认平台分派 mac ⌘+Shift+X / 其他 Ctrl+Shift+X，
  // Popup 可自定义）。子 frame 内按键不冒泡到顶层，content.js 的顶层 keydown 兜底在子 frame
  // 聚焦时不触发（OPT-20260806-016）— 此处检测并转发 SW。
  let pickShortcutCombo = (() => {
    try {
      const plat = String(navigator?.platform || navigator?.userAgent || '').toLowerCase();
      return plat.includes('mac') ? 'Command+Shift+X' : 'Ctrl+Shift+X';
    } catch { return 'Ctrl+Shift+X'; }
  })();

  function ensureHighlightStyle() {
    if (document.getElementById('taskplugin-el-hl-style')) return;
    const s = document.createElement('style');
    s.id = 'taskplugin-el-hl-style';
    s.textContent = 'html.taskplugin-picking .taskplugin-el-highlight{outline:2px solid #89b4fa!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(137,180,250,.35)!important;}';
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

  function setPickMode(on) {
    pickMode = !!on;
    document.documentElement.classList.toggle('taskplugin-picking', pickMode);
    if (!pickMode) {
      clearHighlight();
      pickSelection = [];
    } else {
      pickSelection = [];
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
      if (pickSelection.length) applyHighlightMany(pickSelection);
      else clearHighlight();
      return;
    }
    const hoverSet = pickSelection.includes(el)
      ? pickSelection
      : pickSelection.concat([el]);
    applyHighlightMany(hoverSet);
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
      if (e.metaKey || e.ctrlKey) {
        pickSelection = ElementPicker.toggleDisjointSelection(pickSelection, el);
        applyHighlightMany(pickSelection.length ? pickSelection : [el]);
        return;
      }
      pickSelection = [];
      const snapshot = ElementPicker.snapshotElement(el, {
        closedShadow,
        inIframe: true,
        crossOriginIframe: true,
      });
      const rect = el.getBoundingClientRect();
      relaySnapshot(snapshot, {
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      });
    } catch (err) {
      console.warn('[taskChromePlugin] pick-frame snapshot failed:', err.message || err);
      pickSelection = [];
      setPickMode(false);
    }
  }

  function onKeyDown(e) {
    if (!pickMode) return;
    if (e.key === 'Enter' && pickSelection.length > 0) {
      e.preventDefault();
      const snapshot = ElementPicker.snapshotDisjointSelection(pickSelection, {
        inIframe: true,
        crossOriginIframe: true,
      });
      relaySnapshot(snapshot, unionRectsInFrame(pickSelection));
      pickSelection = [];
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pickSelection.length > 0) {
        pickSelection = [];
        clearHighlight();
        return;
      }
      setPickMode(false);
    }
  }

  // 子 frame 内页内兜底快捷键（OPT-20260806-016）：
  /**
   * 严格匹配快捷键组合串（与 content.js Storage.matchShortcutKeydown 同规则，
   * 内联实现避免依赖 storage.js）：组合中列出的修饰键必须按下、未列出的不得按下。
   */
  function matchShortcut(e, combo) {
    if (!e || !combo) return false;
    const parts = String(combo).split('+');
    if (parts.length < 2) return false;
    const keyName = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const k = String(e.key || '');
    let eventKey = k === ' ' ? 'Space' : k.startsWith('Arrow') ? k.slice(5) : k;
    if (eventKey === ',') eventKey = 'Comma';
    if (eventKey === '.') eventKey = 'Period';
    const keyOk = keyName.length === 1
      ? eventKey.toUpperCase() === keyName
      : eventKey === keyName;
    if (!keyOk) return false;
    return e.ctrlKey === mods.includes('Ctrl')
      && e.altKey === mods.includes('Alt')
      && e.shiftKey === mods.includes('Shift')
      && e.metaKey === mods.includes('Command');
  }

  // 严格匹配用户自定义的组合，转发 SW 走浏览器命令路径（toggleElementPickShortcut）
  // → 顶层 content.js 切换（共享去抖时间戳，浏览器命令与按键穿透不会双触发）。
  function onShortcutKeyDown(e) {
    if (e.repeat) return;
    if (!matchShortcut(e, pickShortcutCombo)) return;
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'toggleElementPickShortcut' }).catch((err) => {
      console.warn('[taskChromePlugin] pick-frame shortcut relay failed:', err?.message || err);
    });
  }

  // 加载快捷键组合 + storage 实时同步（与 content.js bindPickShortcutStorageListener 对齐）
  try {
    chrome.storage?.local?.get({ elementPickerShortcut: '' }).then((res) => {
      const v = res && res.elementPickerShortcut;
      // 旧版 'cmd'/'ctrl' 模式迁移（与 Storage.getElementPickerShortcut 一致）
      const combo = v === 'cmd' ? 'Command+Shift+X' : v === 'ctrl' ? 'Ctrl+Shift+X' : v;
      if (typeof combo === 'string' && combo.includes('+')) pickShortcutCombo = combo;
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local') return;
      const v = changes && changes.elementPickerShortcut && changes.elementPickerShortcut.newValue;
      if (typeof v !== 'string') return;
      const combo = v === 'cmd' ? 'Command+Shift+X' : v === 'ctrl' ? 'Ctrl+Shift+X' : v;
      if (combo.includes('+')) pickShortcutCombo = combo;
    });
  } catch (_) { /* 保持平台默认（mac ⌘+Shift+X / 其他 Ctrl+Shift+X） */ }

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keydown', onShortcutKeyDown, true);

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
