/**
 * 浮窗指针选择、高亮、调整期望弹窗。
 */
// ================================================================
//  指针选择页面元素 → 调整期望 → 追加到任务描述
//  （支持 open Shadow DOM / 同源 iframe / 可选截图 / DevTools 回传）
// ================================================================

function isPluginDom(node) {
  if (!node || node.nodeType !== 1) return true;
  if (node === root || root.contains(node)) return true;
  if (typeof node.closest === 'function' && node.closest('#taskplugin-float-root')) return true;
  return false;
}

function ensureHighlightStyle(doc) {
  if (!doc || doc.getElementById('taskplugin-el-hl-style')) return;
  const s = doc.createElement('style');
  s.id = 'taskplugin-el-hl-style';
  s.textContent = 'html.taskplugin-picking .taskplugin-el-highlight{outline:2px solid #89b4fa!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(137,180,250,.35)!important;}';
  (doc.head || doc.documentElement).appendChild(s);
}

function clearHighlight() {
  for (const el of highlightedEls) {
    try {
      el.classList.remove('taskplugin-el-highlight');
    } catch (_) { /* detached */ }
  }
  highlightedEls = [];
  highlightDoc = null;
}

function applyHighlightMany(els, doc) {
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
  const owner = doc || list[0].ownerDocument || document;
  ensureHighlightStyle(owner);
  highlightDoc = owner;
  for (const el of list) {
    el.classList.add('taskplugin-el-highlight');
    highlightedEls.push(el);
  }
}

function applyHighlight(el, doc) {
  applyHighlightMany(el ? [el] : [], doc);
}

function clearPickSelection() {
  pickSelection = [];
  pickSelectionFrame = null;
}

function isMetaClick(e) {
  return !!(e && (e.metaKey || e.ctrlKey));
}

function samePickFrame(a, b) {
  return a === b;
}

function viewportRectForElements(els, frameElement) {
  const rects = (els || []).map((el) => {
    const rect = el.getBoundingClientRect();
    if (!frameElement) {
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }
    const fr = frameElement.getBoundingClientRect();
    return {
      left: fr.left + rect.left,
      top: fr.top + rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  return ElementPicker.unionClientRects(rects);
}

/**
 * 解析指针下的真实目标：composedPath（Shadow）+ 同源 iframe 穿透
 * @returns {{ el: Element|null, frameElement: Element|null, crossOrigin: boolean }}
 */
function resolvePickTarget(e) {
  if (typeof ElementPicker === 'undefined') {
    return { el: null, frameElement: null, crossOrigin: false, closedShadow: false };
  }
  const composed = ElementPicker.resolveComposedElement(e, isPluginDom);
  if (!composed) return { el: null, frameElement: null, crossOrigin: false, closedShadow: false };

  if (String(composed.tagName || '').toUpperCase() === 'IFRAME') {
    try {
      const pierced = ElementPicker.pierceSameOriginIframe(composed, e.clientX, e.clientY);
      return {
        el: pierced.el,
        frameElement: composed,
        crossOrigin: false,
        closedShadow: !!pierced.closedShadow,
      };
    } catch (err) {
      if (err?.code === 'CROSS_ORIGIN_IFRAME') {
        // 跨域：由 pick-frame.js 在子 frame 内处理；顶层仅提示等待
        return { el: null, frameElement: composed, crossOrigin: true, closedShadow: false };
      }
      console.warn('[taskChromePlugin] iframe pierce failed:', err.message || err);
      return { el: null, frameElement: composed, crossOrigin: false, closedShadow: false };
    }
  }

  const deep = ElementPicker.deepElementFromPoint(document, e.clientX, e.clientY, {
    isExcluded: isPluginDom,
  });
  return {
    el: deep.el || composed,
    frameElement: null,
    crossOrigin: false,
    closedShadow: !!deep.closedShadow,
  };
}

function setPickMode(on, source) {
  pickMode = !!on;
  if (on && source) pickSource = source;
  if (!on) {
    pickCrossOriginHintShown = false;
  }
  document.documentElement.classList.toggle('taskplugin-picking', pickMode);
  if (!pickMode) {
    clearHighlight();
    clearPickSelection();
    btn.textContent = '+';
    renderShortcutHints();
    btn.classList.remove('taskplugin-picking-fab');
    detachPickPointerListeners();
    chrome.runtime.sendMessage({ action: 'cancelElementPickBroadcast' }).catch(() => {});
  } else {
    clearPickSelection();
    panel.classList.remove('taskplugin-open');
    btn.classList.remove('taskplugin-active');
    isOpen = false;
    btn.textContent = '✕';
    renderShortcutHints();
    btn.classList.add('taskplugin-picking-fab');
    attachPickPointerListeners();
    chrome.runtime.sendMessage({
      action: 'broadcastStartElementPick',
      source: pickSource,
    }).catch((e) => {
      console.warn('[taskChromePlugin] broadcastStartElementPick failed:', e.message || e);
    });
  }
  console.log('[taskChromePlugin] element pick mode:', pickMode ? `on(${pickSource})` : 'off');
}

function onPickMouseOver(e) {
  if (!pickMode || typeof ElementPicker === 'undefined') return;
  const { el, frameElement, crossOrigin } = resolvePickTarget(e);
  if (crossOrigin || !el || isPluginDom(el)) {
    // 仍显示已选集合高亮（若同文档）
    if (pickSelection.length) applyHighlightMany(pickSelection, pickSelection[0].ownerDocument);
    else clearHighlight();
    return;
  }
  const hoverSet = pickSelection.includes(el)
    ? pickSelection
    : pickSelection.concat([el]);
  applyHighlightMany(hoverSet, el.ownerDocument);
}

function finishPickWithElements(els, frameElement, closedShadow) {
  const list = (Array.isArray(els) ? els : [els]).filter((el) => el && el.nodeType === 1);
  if (list.length === 0) return;
  pendingFrameElement = frameElement;
  pendingElementSnapshot = list.length === 1
    ? ElementPicker.snapshotElement(list[0], { frameElement, closedShadow })
    : ElementPicker.snapshotDisjointSelection(list, { frameElement, closedShadow });
  pendingElementSnapshot._viewportRect = viewportRectForElements(list, frameElement);
  clearPickSelection();
  setPickMode(false);
  openAdjustModal(pendingElementSnapshot);
}

function onPickClick(e) {
  if (!pickMode) return;
  if (typeof ElementPicker === 'undefined') {
    console.error('[taskChromePlugin] ElementPicker 未加载');
    setPickMode(false);
    return;
  }
  const { el, frameElement, crossOrigin, closedShadow } = resolvePickTarget(e);
  if (crossOrigin) {
    e.preventDefault();
    e.stopPropagation();
    // 跨域：继续等待子 frame 的 elementPickedInFrame；给一次提示
    if (!pickCrossOriginHintShown) {
      pickCrossOriginHintShown = true;
      showResult('已进入跨域 iframe 选择：请直接点击框内元素（⌘/Ctrl+点击多选）', 'success');
    }
    return;
  }
  if (!el || isPluginDom(el)) return;

  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  try {
    if (isMetaClick(e)) {
      if (pickSelection.length > 0 && !samePickFrame(frameElement, pickSelectionFrame)) {
        showResult('多选仅限同一 frame，请先清空或在同一框架内选择', 'error');
        return;
      }
      if (pickSelection.length === 0) pickSelectionFrame = frameElement || null;
      pickSelection = ElementPicker.toggleDisjointSelection(pickSelection, el);
      if (pickSelection.length === 0) pickSelectionFrame = null;
      applyHighlightMany(pickSelection.length ? pickSelection : [el], el.ownerDocument);
      const tip = pickSelection.length
        ? `已选 ${pickSelection.length} 个：Enter 确认；⌘/Ctrl+点击继续增删（Esc 清空）`
        : '已清空多选：⌘/Ctrl+点击添加，或普通点击单选';
      btn.title = tip;
      return;
    }

    // 普通点击：立即单选
    clearPickSelection();
    finishPickWithElements([el], frameElement, closedShadow);
  } catch (err) {
    console.warn('[taskChromePlugin] snapshotElement 失败:', err.message || err);
    clearPickSelection();
    setPickMode(false);
  }
}

function onPickKeyDown(e) {
  if (e.key === 'Enter' && pickMode) {
    if (pickSelection.length === 0) return;
    e.preventDefault();
    finishPickWithElements(pickSelection, pickSelectionFrame, false);
    return;
  }
  if (e.key !== 'Escape') return;
  if (pickMode) {
    e.preventDefault();
    if (pickSelection.length > 0) {
      clearPickSelection();
      clearHighlight();
      const tip = '已清空多选；Esc 再按退出指针模式';
      btn.title = tip;
      return;
    }
    setPickMode(false);
    return;
  }
  if (adjustModal && !adjustModal.hidden) {
    e.preventDefault();
    closeAdjustModal();
  }
}

function openAdjustModal(snapshot) {
  if (!adjustModal) return;
  const ctx = [
    snapshot.selectionKind === 'disjoint' && snapshot.elements?.length
      ? `多选×${snapshot.elements.length}`
      : '',
    snapshot.inClosedShadow ? 'closed-Shadow' : (snapshot.inShadow ? 'Shadow' : ''),
    snapshot.uaShadowOpaque ? 'UA-Shadow不可穿透' : (snapshot.uaShadowHost ? '原生宿主' : ''),
    snapshot.crossOriginIframe ? 'x-iframe' : (snapshot.inIframe ? 'iframe' : ''),
    snapshot.frameNestingDepth > 1 ? `nest×${snapshot.frameNestingDepth}` : '',
  ].filter(Boolean).join('+');
  let summary = `${snapshot.label}${ctx ? ` [${ctx}]` : ''}`;
  if (snapshot.selectionKind === 'disjoint' && Array.isArray(snapshot.elements)) {
    const labels = snapshot.elements.map((x) => x.label).filter(Boolean).join('、');
    if (labels) summary += ` — ${labels}`;
  } else if (snapshot.visibleText) {
    summary += ` — "${snapshot.visibleText}"`;
  }
  adjustElSummary.textContent = summary;
  if (snapshot.uaShadowOpaque) {
    adjustError.textContent = '提示：原生控件内部（UA Shadow）无法选中，已选中宿主元素。';
    adjustError.className = 'taskplugin-result taskplugin-show';
  } else {
    adjustError.className = 'taskplugin-result';
    adjustError.textContent = '';
  }
  adjustInput.value = ElementPicker.DEFAULT_ADJUST_PROMPT;
  if (adjustShot) adjustShot.checked = false;
  adjustModal.hidden = false;
  if (!isOpen) {
    isOpen = true;
    panel.classList.add('taskplugin-open');
    btn.classList.add('taskplugin-active');
  }
  setTimeout(() => adjustInput.focus(), 0);
  console.log('[taskChromePlugin] adjust modal open for:', snapshot.label, 'source=', pickSource);
}

function closeAdjustModal() {
  if (!adjustModal) return;
  adjustModal.hidden = true;
  pendingElementSnapshot = null;
  pendingFrameElement = null;
  pickSource = 'float';
  adjustInput.value = '';
  if (adjustShot) adjustShot.checked = false;
  adjustError.className = 'taskplugin-result';
  adjustError.textContent = '';
}

async function captureElementScreenshot(rect) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    throw new Error('元素不在可视区域，无法截图');
  }
  // 截图前暂时隐藏插件 UI，避免入镜
  const prevRootDisplay = root.style.display;
  const prevModalHidden = adjustModal.hidden;
  root.style.setProperty('display', 'none', 'important');
  adjustModal.hidden = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const resp = await sendMessageWithTimeout({
      action: 'captureElementScreenshot',
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      maxWidth: ElementPicker.SCREENSHOT_MAX_WIDTH,
    }, 12000);
    if (!resp?.success || !resp.dataUrl) {
      throw new Error(resp?.error || '截图失败');
    }
    return resp.dataUrl;
  } finally {
    root.style.setProperty('display', prevRootDisplay || 'block', 'important');
    adjustModal.hidden = prevModalHidden;
  }
}

async function confirmAdjustModal() {
  if (typeof ElementPicker === 'undefined') {
    adjustError.textContent = 'ElementPicker 未加载';
    adjustError.className = 'taskplugin-result taskplugin-show taskplugin-result-error';
    return;
  }
  if (!pendingElementSnapshot) {
    adjustError.textContent = '未选中元素，请重新用指针选择';
    adjustError.className = 'taskplugin-result taskplugin-show taskplugin-result-error';
    return;
  }
  const adjustment = adjustInput.value;
  const err = ElementPicker.validateAdjustment(adjustment);
  if (err) {
    adjustError.textContent = err;
    adjustError.className = 'taskplugin-result taskplugin-show taskplugin-result-error';
    return;
  }

  const wantShot = !!(adjustShot && adjustShot.checked);
  let screenshotUrl = '';
  adjustConfirm.disabled = true;
  const source = pickSource;
  try {
    if (wantShot) {
      adjustError.textContent = '正在截图并上传...';
      adjustError.className = 'taskplugin-result taskplugin-show';
      const dataUrl = await captureElementScreenshot(pendingElementSnapshot._viewportRect);
      const up = await sendMessageWithTimeout({
        action: 'uploadPluginScreenshot',
        dataUrl,
      }, 20000);
      if (!up?.success || !up.url) {
        throw new Error(up?.error || '截图上传失败');
      }
      screenshotUrl = up.url;
      console.log('[taskChromePlugin] screenshot uploaded:', screenshotUrl);
    }

    const { _viewportRect, ...element } = pendingElementSnapshot;
    const payload = {
      pageUrl: window.location.href,
      pageTitle: document.title,
      element,
      adjustment,
      screenshotUrl: screenshotUrl || undefined,
    };
    const block = ElementPicker.formatElementAdjustmentBlock(payload);

    // 将调整内容复制到剪贴板
    let copied = false;
    try {
      await navigator.clipboard.writeText(block);
      copied = true;
      console.log('[taskChromePlugin] element adjustment copied to clipboard');
    } catch (clipErr) {
      console.warn('[taskChromePlugin] clipboard copy failed:', clipErr.message || clipErr);
    }

    if (source === 'devtools') {
      const relay = await sendMessageWithTimeout({
        action: 'elementPickResult',
        block,
        pageUrl: window.location.href,
      }, 8000);
      if (!relay?.success) throw new Error(relay?.error || '回传 DevTools 失败');
      console.log('[taskChromePlugin] element pick result relayed to DevTools');
      closeAdjustModal();
      const clipSuffix = copied ? '，并已复制到剪贴板' : '';
      showResult(`已将元素调整期望发送到 DevTools 面板${clipSuffix}`, 'success');
    } else {
      descInput.value = ElementPicker.appendElementAdjustmentToDescription(descInput.value, payload);
      syncDescResetButton();
      console.log('[taskChromePlugin] element adjustment appended to float description');
      closeAdjustModal();
      const clipSuffix = copied ? '，并已复制到剪贴板' : '';
      showResult(`已将元素调整期望加入任务描述${clipSuffix}`, 'success');
    }
  } catch (ex) {
    console.warn('[taskChromePlugin] confirmAdjustModal failed:', ex.message || ex);
    adjustError.textContent = ex.message || String(ex);
    adjustError.className = 'taskplugin-result taskplugin-show taskplugin-result-error';
  } finally {
    adjustConfirm.disabled = false;
  }
}

/**
 * 快捷键兜底切换：与 chrome.commands → toggleElementPick 消息路径等价。
 * 仅在浏览器级快捷键注册失败（Mac 已知 bug / 键位被占用）导致按键穿透到页面时触发。
 */
function togglePickModeFromShortcut() {
  const now = Date.now();
  if (now - lastShortcutToggleAt < SHORTCUT_DEBOUNCE_MS) return; // 防双触发
  lastShortcutToggleAt = now;
  if (adjustModal && !adjustModal.hidden) closeAdjustModal();
  setPickMode(!pickMode, 'float');
}

/**
 * 页内 keydown 兜底：严格匹配用户自定义的组合串（默认 mac ⌘+Shift+X / 其他 Ctrl+Shift+X）。
 * Storage.matchShortcutKeydown 规则：组合中列出的修饰键必须按下、未列出的不得按下，
 * 与浏览器级键位（chrome.commands.update）行为一致。
 */
function onShortcutKeyDown(e) {
  if (e.repeat) return;
  if (!Storage.matchShortcutKeydown(e, pickShortcutCombo)) return;
  e.preventDefault();
  togglePickModeFromShortcut();
}

/** 快捷键提示文案跟随当前组合（默认平台分派） */
function renderShortcutHints() {
  const combo = pickShortcutCombo || Storage.detectDefaultShortcut();
  const ta = document.getElementById('taskplugin-desc');
  if (ta) ta.placeholder = `任务描述...（按 ${combo} 指针选择页面元素）`;
  const fab = document.getElementById('taskplugin-float-btn');
  if (fab) {
    fab.title = pickMode
      ? `取消指针选择（Esc / ${combo}）；⌘/Ctrl+点击多选，Enter 确认`
      : `${PLUGIN_DISPLAY_NAME} — 快速创建任务 (${combo} 指针选择)`;
  }
}

var pickPointerListenersAttached = false;
function attachPickPointerListeners() {
  if (pickPointerListenersAttached) return;
  document.addEventListener('mouseover', onPickMouseOver, true);
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKeyDown, true);
  pickPointerListenersAttached = true;
}
function detachPickPointerListeners() {
  if (!pickPointerListenersAttached) return;
  document.removeEventListener('mouseover', onPickMouseOver, true);
  document.removeEventListener('click', onPickClick, true);
  document.removeEventListener('keydown', onPickKeyDown, true);
  pickPointerListenersAttached = false;
}

