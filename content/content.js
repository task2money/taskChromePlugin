/**
 * Content Script — 页内浮窗快速创建任务
 * 注入到所有页面，在右下角显示浮动按钮
 */

(() => {
  // 防重复注入
  if (document.getElementById('taskplugin-float-root')) return;

  // ---- 创建 DOM ----
  const root = document.createElement('div');
  root.id = 'taskplugin-float-root';

  root.innerHTML = `
    <button id="taskplugin-float-btn" title="云端Coding: 自动创新助手 — 快速创建任务">+</button>
    <div id="taskplugin-float-panel">
      <div class="taskplugin-panel-header">
        <h3>🔧 快速创建任务</h3>
        <div style="display:flex;align-items:center;gap:6px">
          <span id="taskplugin-login-badge" class="taskplugin-badge taskplugin-badge-err">未登录</span>
          <button id="taskplugin-float-close" type="button" class="taskplugin-float-close" aria-label="关闭浮窗" title="关闭浮窗">×</button>
        </div>
      </div>
      <div class="taskplugin-panel-body">
        <div id="taskplugin-user-guide" class="taskplugin-user-guide-host"></div>
        <div class="taskplugin-captured-url" id="taskplugin-page-url"></div>
        <div id="taskplugin-aidev-status" class="taskplugin-aidev-status" hidden></div>
        <div class="taskplugin-form-group">
          <label>工作空间</label>
          <select class="taskplugin-select" id="taskplugin-workspace">
            <option value="">-- 请先登录 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>项目 (单选)</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-projects">
            <span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>标题</label>
          <input class="taskplugin-input" id="taskplugin-title" placeholder="任务标题">
        </div>
        <div class="taskplugin-form-group">
          <div class="taskplugin-label-row">
            <span>描述</span>
            <span class="taskplugin-label-actions">
              <button type="button" class="taskplugin-btn taskplugin-btn-reset" id="taskplugin-desc-reset" title="清空任务描述" disabled>重置</button>
            </span>
          </div>
          <textarea class="taskplugin-textarea" id="taskplugin-desc" placeholder="任务描述...（按快捷键指针选择页面元素）"></textarea>
        </div>
        <div class="taskplugin-form-group">
          <label>优先级</label>
          <select class="taskplugin-select" id="taskplugin-priority">
            <option value="0">高</option>
            <option value="1" selected>中</option>
            <option value="2">低</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>进度状态</label>
          <select class="taskplugin-select" id="taskplugin-progress">
            <option value="">-- 请先选择工作空间 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>交付物类别</label>
          <select class="taskplugin-select" id="taskplugin-deliverable">
            <option value="">-- 请先选择工作空间 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>已安装镜像 <span id="taskplugin-image-required" hidden style="color:#f38ba8;font-size:10px;">*自动运行必选</span></label>
          <select class="taskplugin-select" id="taskplugin-image">
            <option value="">无</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>智能体资源配置 <span style="color:#f38ba8;font-size:10px;">*必填</span></label>
          <select class="taskplugin-select" id="taskplugin-feature-params">
            <option value="">-- 请选择 --</option>
            <option value="company">公司默认</option>
            <option value="workspace">工作空间默认</option>
            <option value="personal">个人配置</option>
          </select>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-personal-wrap" style="display:none">
          <label>个人配置</label>
          <select class="taskplugin-select" id="taskplugin-personal-config">
            <option value="">-- 请选择个人配置 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>截止日期</label>
          <input class="taskplugin-input" type="datetime-local" id="taskplugin-due-date">
        </div>
        <div class="taskplugin-form-group">
          <label class="taskplugin-toggle-label" for="taskplugin-auto-run">
            <input type="checkbox" id="taskplugin-auto-run" disabled aria-disabled="true">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title">是否自动运行</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-auto-run-hint">请先选择项目</span>
            </span>
          </label>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-git-identities"></div>
        <div class="taskplugin-form-group">
          <label>逐仓基准分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 对齐工作面板</span></label>
          <div id="taskplugin-repo-bases" class="taskplugin-checkbox-list">
            <span style="color:#6c7086;font-size:11px;">选择项目后按仓库填写</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>协作人员 (可多选)</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-assignees">
            <span style="color:#6c7086;font-size:11px;">选择工作空间后加载</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>工作分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 模板 / 仓库分支 / 可手写</span></label>
          <input class="taskplugin-input" id="taskplugin-work-branch" placeholder="选择或输入工作分支" list="taskplugin-work-branch-list">
          <datalist id="taskplugin-work-branch-list"></datalist>
        </div>
        <div class="taskplugin-form-group">
          <label>合并目标分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 模板 / 仓库分支 / 可手写</span></label>
          <input class="taskplugin-input" id="taskplugin-merge-target" placeholder="选择或输入合并目标分支" list="taskplugin-merge-list">
          <datalist id="taskplugin-merge-list"></datalist>
        </div>
        <button class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-submit">✅ 创建任务</button>
        <div id="taskplugin-result" class="taskplugin-result"></div>
      </div>
    </div>
    <div id="taskplugin-adjust-modal" class="taskplugin-modal" hidden>
      <div class="taskplugin-modal-card" role="dialog" aria-modal="true" aria-labelledby="taskplugin-adjust-title">
        <h4 id="taskplugin-adjust-title">希望对这个元素做什么调整？</h4>
        <p class="taskplugin-modal-el" id="taskplugin-adjust-el-summary"></p>
        <textarea id="taskplugin-adjust-input" class="taskplugin-textarea" rows="4" placeholder="例如：把按钮改成红色、增大字号、调整间距..."></textarea>
        <label class="taskplugin-shot-label">
          <input type="checkbox" id="taskplugin-adjust-shot">
          <span>附带元素截图（上传后写入 URL，不内嵌 data URL）</span>
        </label>
        <div class="taskplugin-modal-actions">
          <button type="button" class="taskplugin-btn" id="taskplugin-adjust-cancel">取消</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-btn-modal-primary" id="taskplugin-adjust-confirm">确认加入描述</button>
        </div>
        <div id="taskplugin-adjust-error" class="taskplugin-result"></div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // ---- 使用说明（SSOT: lib/user-guide.js）----
  (async function mountFloatUserGuide() {
    const host = document.getElementById('taskplugin-user-guide');
    if (!host) return;
    if (typeof UserGuide === 'undefined') {
      console.warn('[taskChromePlugin] UserGuide 未加载，浮窗使用说明跳过');
      return;
    }
    // 快捷键说明动态插值用户当前选择的组合（OPT-20260806-017）
    await UserGuide.loadShortcutModeFromStorage().catch(() => {});
    UserGuide.mount(host, UserGuide.renderCollapsibleHtml({ surface: 'float', open: false }));
  })();

  // ---- Refs ----
  const btn = document.getElementById('taskplugin-float-btn');
  const panel = document.getElementById('taskplugin-float-panel');
  const badge = document.getElementById('taskplugin-login-badge');
  const wsSelect = document.getElementById('taskplugin-workspace');
  const projectsDiv = document.getElementById('taskplugin-projects');
  const submitBtn = document.getElementById('taskplugin-submit');
  const resultDiv = document.getElementById('taskplugin-result');
  const mergeTarget = document.getElementById('taskplugin-merge-target');
  const workBranch = document.getElementById('taskplugin-work-branch');
  const repoBasesDiv = document.getElementById('taskplugin-repo-bases');
  const gitIdentitiesDiv = document.getElementById('taskplugin-git-identities');
  const assigneesDiv = document.getElementById('taskplugin-assignees');
  const titleInput = document.getElementById('taskplugin-title');
  const descInput = document.getElementById('taskplugin-desc');
  const descResetBtn = document.getElementById('taskplugin-desc-reset');
  const progressSelect = document.getElementById('taskplugin-progress');
  const deliverableSelect = document.getElementById('taskplugin-deliverable');
  const imageSelect = document.getElementById('taskplugin-image');
  const imageRequiredMark = document.getElementById('taskplugin-image-required');
  const featureParamsSelect = document.getElementById('taskplugin-feature-params');
  const personalWrap = document.getElementById('taskplugin-personal-wrap');
  const personalConfigSelect = document.getElementById('taskplugin-personal-config');
  const dueDateInput = document.getElementById('taskplugin-due-date');
  const autoRunInput = document.getElementById('taskplugin-auto-run');
  const autoRunHint = document.getElementById('taskplugin-auto-run-hint');
  let membersData = [];
  let gitIdentitiesCache = [];

  const adjustModal = document.getElementById('taskplugin-adjust-modal');
  const adjustElSummary = document.getElementById('taskplugin-adjust-el-summary');
  const adjustInput = document.getElementById('taskplugin-adjust-input');
  const adjustCancel = document.getElementById('taskplugin-adjust-cancel');
  const adjustConfirm = document.getElementById('taskplugin-adjust-confirm');
  const adjustError = document.getElementById('taskplugin-adjust-error');
  const adjustShot = document.getElementById('taskplugin-adjust-shot');

  let isOpen = false;
  /** 本次打开浮窗（鉴权/aidev 完成后）的表单快照；创建成功后还原 */
  let openSnapshot = null;
  let isLoggedIn = false;
  let pageToastTimer = null;
  let pickMode = false;
  /**
   * 快捷键兜底（页内 keydown）：chrome.commands 注册失败/被占用时，
   * 按键事件会穿透到页面，此监听保证 Cmd/Ctrl+Shift+X 依然可用。
   * 与 chrome.commands 消息路径共享去抖，防止浏览器命令与 keydown 双触发。
   */
  let lastShortcutToggleAt = 0;
  const SHORTCUT_DEBOUNCE_MS = 300;
  /**
   * 页内兜底监听使用的快捷键组合串（如 'Ctrl+Shift+X' / 'Alt+Shift+E'）。
   * 由 Popup「快捷键」自定义配置决定，默认平台分派：mac ⌘+Shift+X / 其他 Ctrl+Shift+X
   * （Storage.getElementPickerShortcut；初始值取平台默认兜底 storage 读取失败路径）。
   */
  let pickShortcutCombo = Storage.detectDefaultShortcut();
  let highlightedEls = [];
  let highlightDoc = null;
  let pendingElementSnapshot = null;
  let pendingFrameElement = null;
  let pickSource = 'float'; // float | devtools
  let pickCrossOriginHintShown = false;
  /** Cmd/Ctrl 累加多选（同 frame 内，点击顺序） */
  let pickSelection = [];
  let pickSelectionFrame = null; // Element|null，与第一次累加的 frameElement 对齐
  let apiCfg = { baseUrl: 'https://aidevpush.com', token: '' };
  let workspacesData = [];
  let projectsData = [];
  let pendingAidevMatches = null;
  const aidevStatusEl = document.getElementById('taskplugin-aidev-status');

  /**
   * 带超时的 chrome.runtime.sendMessage 封装
   * 防止 Service Worker 未就绪或 API 调用超时时消息无限挂起导致悬浮球面板卡死
   */
  function sendMessageWithTimeout(action, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`消息超时: ${action.action || action}`));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(action)
          .then((res) => { clearTimeout(timer); resolve(res); })
          .catch((err) => { clearTimeout(timer); reject(err); });
      } catch (syncErr) {
        clearTimeout(timer);
        reject(syncErr);
      }
    });
  }

  // ---- Drag State ----
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let btnStartX = 0;
  let btnStartY = 0;
  let hasMoved = false;
  const DRAG_THRESHOLD = 4;

  // 分支模板 datalist 预设值前缀（须在 init → seedBranchDatalists 之前初始化）
  const PRESET_PREFIX = '__preset:';

  // ---- Init ----
  (async function init() {
    try {
      // 0. 立即绑定 UI 交互（拖拽），不依赖任何异步操作
      //    防止 Service Worker 延迟 / 启动失败导致按钮无响应
      setupDrag();
      bindFloatPanelCloseButton();
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

      // 加载元素拾取快捷键配置（Popup 可自定义任意组合，默认 mac ⌘+Shift+X / 其他 Ctrl+Shift+X）
      try {
        pickShortcutCombo = await Storage.getElementPickerShortcut();
        renderShortcutHints();
        console.log('[taskChromePlugin] pick shortcut combo:', pickShortcutCombo);
      } catch (_) { /* 保持平台默认（mac ⌘+Shift+X / 其他 Ctrl+Shift+X） */ }

      await restoreFloatBallPosition();

      const urlEl = document.getElementById('taskplugin-page-url');
      if (urlEl) urlEl.textContent = `📍 ${window.location.href}`;

      await refreshAuthAndWorkspaces();

      startAuthBadgeTimer();
    } catch (err) {
      console.error('[taskChromePlugin] init() 初始化失败，核心交互已就绪:', err.message || err);
      // setupDrag 已在 try 块首行执行，
      // 即使后续异步操作全部失败，悬浮球仍可正常工作
    }
  })();

  async function loadFloatBallConfigFromStorage() {
    try {
      const r = await sendMessageWithTimeout({ action: 'getFloatBallConfig' }, 5000);
      if (r && r.success) return r.data;
    } catch (e) {
      console.warn('[taskChromePlugin] loadFloatBallConfig 失败:', e.message);
    }
    return { enabled: true };
  }

  async function saveFloatBallConfigToStorage(enabled) {
    try {
      await sendMessageWithTimeout({ action: 'saveFloatBallConfig', enabled }, 5000);
    } catch (e) {
      console.warn('[taskChromePlugin] saveFloatBallConfig 失败:', e.message);
    }
  }

  async function restoreFloatBallPosition() {
    try {
      const r = await sendMessageWithTimeout({ action: 'getFloatBallPosition' }, 5000);
      if (r && r.success && r.data && r.data.x != null && r.data.y != null) {
        btn.style.bottom = 'auto';
        btn.style.right = 'auto';
        btn.style.left = r.data.x + 'px';
        btn.style.top = r.data.y + 'px';
      }
    } catch (e) {
      console.warn('[taskChromePlugin] restoreFloatBallPosition 失败:', e.message);
    }
  }

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

  let pickPointerListenersAttached = false;
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

  function setupElementPicker() {
    document.addEventListener('keydown', onShortcutKeyDown, true);
    adjustCancel?.addEventListener('click', (e) => {
      e.preventDefault();
      closeAdjustModal();
    });
    adjustConfirm?.addEventListener('click', (e) => {
      e.preventDefault();
      confirmAdjustModal();
    });
    adjustInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && adjustModal && !adjustModal.hidden) {
        e.preventDefault();
        confirmAdjustModal();
      }
    });
  }

  function syncDescResetButton() {
    if (!descResetBtn) return;
    if (typeof CreateTaskPayload === 'undefined' || typeof CreateTaskPayload.shouldEnableDescReset !== 'function') {
      throw new Error('CreateTaskPayload.shouldEnableDescReset 未加载');
    }
    descResetBtn.disabled = !CreateTaskPayload.shouldEnableDescReset(descInput.value);
  }

  function setupDescReset() {
    if (!descResetBtn) {
      console.warn('[taskChromePlugin] desc reset button missing');
      return;
    }
    descInput.addEventListener('input', syncDescResetButton);
    descResetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (descResetBtn.disabled) return;
      descInput.value = '';
      syncDescResetButton();
      descInput.focus();
    });
    syncDescResetButton();
  }

  // ---- Drag Logic ----
  function setupDrag() {
    btn.addEventListener('mousedown', onDragStart);
    btn.addEventListener('dragstart', (e) => e.preventDefault());
  }

  function onDragStart(e) {
    if (e.button !== 0) return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = btn.getBoundingClientRect();
    if (btn.style.bottom && btn.style.bottom !== 'auto') {
      btn.style.left = rect.left + 'px';
      btn.style.top = rect.top + 'px';
      btn.style.bottom = 'auto';
      btn.style.right = 'auto';
    }
    btnStartX = rect.left;
    btnStartY = rect.top;
    btn.style.transition = 'none';
    btn.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    hasMoved = true;
    let newX = btnStartX + dx;
    let newY = btnStartY + dy;
    const w = btn.offsetWidth;
    const h = btn.offsetHeight;
    newX = Math.max(0, Math.min(newX, window.innerWidth - w));
    newY = Math.max(0, Math.min(newY, window.innerHeight - h));
    btn.style.left = newX + 'px';
    btn.style.top = newY + 'px';
  }

  function onDragEnd() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    if (!isDragging) return;
    isDragging = false;
    btn.style.transition = '';
    btn.style.cursor = '';
    if (hasMoved) {
      const x = parseInt(btn.style.left, 10);
      const y = parseInt(btn.style.top, 10);
      if (!isNaN(x) && !isNaN(y)) {
        chrome.runtime.sendMessage({ action: 'saveFloatBallPosition', x, y }).catch(() => {});
      }
    }
  }

  btn.addEventListener('click', async (e) => {
    if (hasMoved) {
      hasMoved = false;
      return;
    }
    // 选元素模式下，点击悬浮球 = 取消选择
    if (pickMode) {
      setPickMode(false);
      return;
    }
    isOpen = !isOpen;
    panel.classList.toggle('taskplugin-open', isOpen);
    btn.classList.toggle('taskplugin-active', isOpen);
    btn.textContent = isOpen ? '×' : '+';

    if (isOpen) {
      await refreshAuthAndWorkspaces();
      openSnapshot = captureOpenSnapshot();
    }
  });

  // ================================================================
  //  登录 / 工作空间 / 项目（业务 API 一律经 Service Worker，避免页面上下文差异）
  // ================================================================

  /**
   * 经 SW 调用业务 API。SW 会回退到 storage 中的 baseUrl/token。
   */
  async function swApi(action, extra = {}, timeoutMs = 12000) {
    const r = await sendMessageWithTimeout({
      action,
      baseUrl: apiCfg.baseUrl,
      token: apiCfg.token,
      ...extra,
    }, timeoutMs);
    if (!r?.success) {
      throw new Error(r?.error || `${action} 失败`);
    }
    return r.data;
  }

  /**
   * 获取工作空间创建任务字段设置（与 createTaskFieldSettings.js 对齐）。
   * 返回字段名 → 是否可见的映射，例如 { description: true, code_lang: false, ... }。
   * 用于隐藏 Web 端工作空间配置中关闭的字段，保持插件与工作面板行为一致。
   *
   * 若 SW 尚未实现对应 API action，静默回退默认配置（全部开启，仅 code_lang / structured_fields 关闭）。
   * @param {string} companyId
   * @returns {Promise<Record<string, boolean>>}
   */
  async function fetchCreateTaskFieldSettings(companyId) {
    try {
      const fields = await swApi('getCreateTaskFieldSettings', { companyId });
      if (fields && typeof fields === 'object') return fields;
    } catch (_) { /* SW 尚未实现则静默回退默认 */ }
    // 默认值：与 defaultCreateTaskFieldSettings() 对齐
    return {
      description: true, task_kind: true, code_lang: false,
      structured_fields: false, project_branch: true, container_image: true,
      feature_params: true, priority: true, due_date: true,
      auto_run: true, owner: true, assignees: true,
    };
  }

  async function resolveTaskOwner(endpointMapping, wsId) {
    if (endpointMapping?.owner) return String(endpointMapping.owner);
    const cred = await Storage.getCredentials();
    if (cred.memberId) return String(cred.memberId);

    const ws = workspacesData.find(w => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    if (companyId && cred.userId) {
      try {
        const data = await swApi('getMembers', { companyId: String(companyId) });
        const members = Array.isArray(data) ? data : (data?.results || data?.data || []);
        const mine = members.find((m) => String(m.user_id || m.userId) === String(cred.userId));
        if (mine?.id) return String(mine.id);
        if (members.length === 1) return String(members[0].id);
      } catch (e) {
        console.warn('[taskChromePlugin] resolveTaskOwner getMembers 失败:', e.message);
      }
    }
    return '';
  }

  /**
   * 经 Service Worker 读取登录态（与 Popup 同源），避免 content script
   * 直读 storage 与过期字段不同步、或扩展上下文异常时误判未登录。
   */
  async function fetchAuthStatusFromBackground() {
    const r = await sendMessageWithTimeout({ action: 'getAuthStatus' }, 5000);
    if (!r?.success || !r.data) {
      throw new Error(r?.error || 'getAuthStatus 失败');
    }
    return r.data;
  }

  function applyLoginBadge(loggedIn, { expired = false, expiryHint = null, invalidated = false } = {}) {
    if (invalidated) {
      badge.textContent = '请刷新页面';
      badge.className = 'taskplugin-badge taskplugin-badge-err';
      badge.title = '扩展已重载，请刷新本页后重试';
      return;
    }
    if (!loggedIn) {
      badge.textContent = expired ? '会话过期' : '未登录';
      badge.className = 'taskplugin-badge taskplugin-badge-err';
      badge.title = expired ? '请在扩展弹窗中重新登录' : '请先在扩展弹窗中登录';
      return;
    }
    if (expiryHint?.text) {
      badge.textContent = expiryHint.text;
      badge.className = expiryHint.level === 'critical'
        ? 'taskplugin-badge taskplugin-badge-warn taskplugin-badge-critical'
        : 'taskplugin-badge taskplugin-badge-warn';
      badge.title = '登录会话即将过期，请尽快在扩展弹窗中重新登录';
      return;
    }
    badge.textContent = '已登录';
    badge.className = 'taskplugin-badge taskplugin-badge-ok';
    badge.title = '';
  }

  function workspaceSelectNeedsLoad() {
    if (typeof FloatWorkspaceSelect === 'undefined'
        || typeof FloatWorkspaceSelect.selectNeedsWorkspaceLoad !== 'function') {
      return workspacesData.length === 0;
    }
    return FloatWorkspaceSelect.selectNeedsWorkspaceLoad(wsSelect, {
      workspacesCount: workspacesData.length,
    });
  }

  function applyWorkspaceSelectFromAuth({ loggedIn, mode, invalidated = false }) {
    const selectNeeds = workspaceSelectNeedsLoad();
    if (typeof FloatWorkspaceSelect === 'undefined') {
      console.warn('[taskChromePlugin] FloatWorkspaceSelect 未加载');
      if (!loggedIn) {
        wsSelect.innerHTML = `<option value="">-- ${invalidated ? '请刷新页面后重试' : '请先登录'} --</option>`;
      } else if (mode !== 'badgeOnly' || selectNeeds) {
        wsSelect.innerHTML = '<option value="">加载中...</option>';
      }
      return;
    }
    const action = FloatWorkspaceSelect.resolveFloatWorkspaceSelectAction({
      loggedIn,
      mode,
      invalidated,
      selectNeedsWorkspaceLoad: selectNeeds,
    });
    const text = FloatWorkspaceSelect.floatWorkspaceSelectPlaceholder(action);
    if (text == null) return;
    wsSelect.innerHTML = `<option value="">${text}</option>`;
  }

  /**
   * @param {{ mode?: 'full' | 'badgeOnly' }} [opts]
   *   full：完整鉴权刷新（可进入「加载中」再由 loadWorkspaces 填充）
   *   badgeOnly：仅角标，已登录时不得冲掉工作空间下拉框
   */
  async function checkLoginStatus({ mode = 'full' } = {}) {
    try {
      let cfg;
      let expired = false;
      let loggedIn = false;
      let expiryHint = null;
      try {
        const auth = await fetchAuthStatusFromBackground();
        cfg = {
          baseUrl: auth.baseUrl,
          token: auth.token || '',
          tokenExpiresAt: auth.tokenExpiresAt || 0,
          tokenIssuedAt: auth.tokenIssuedAt || 0,
        };
        expired = !!auth.expired;
        loggedIn = !!auth.loggedIn;
        expiryHint = auth.expiryHint || Storage.formatTokenExpiryHint(auth.remainingSeconds);
      } catch (bgErr) {
        console.warn('[taskChromePlugin] getAuthStatus 回退 Storage:', bgErr.message);
        cfg = await Storage.getApiConfig();
        expired = await Storage.isTokenExpired();
        loggedIn = !!(cfg.token && !expired);
        const remaining = await Storage.getTokenRemainingSeconds();
        expiryHint = Storage.formatTokenExpiryHint(remaining);
      }

      apiCfg = cfg;
      if (loggedIn) {
        isLoggedIn = true;
        applyLoginBadge(true, { expiryHint });
      } else {
        isLoggedIn = false;
        applyLoginBadge(false, { expired: !!(cfg.token && expired) });
      }
      applyWorkspaceSelectFromAuth({ loggedIn, mode });
    } catch (e) {
      console.warn('[taskChromePlugin] checkLoginStatus 失败:', e.message);
      isLoggedIn = false;
      const invalidated = /Extension context invalidated/i.test(String(e.message || e));
      applyLoginBadge(false, { invalidated });
      applyWorkspaceSelectFromAuth({ loggedIn: false, mode, invalidated });
    }
  }

  async function refreshAuthAndWorkspaces() {
    workspacesData = [];
    await checkLoginStatus({ mode: 'full' });
    if (isLoggedIn) {
      await loadWorkspaces();
    }
  }

  /**
   * auth 刷新去抖（500ms 尾缘合批，OPT-20260808-019）：
   * storage.onChanged 对 token/baseUrl/userId/memberId 任一变更都会触发，
   * 多键写入与多标签页广播会在毫秒级连发多次 → 每次都是一轮
   * checkLoginStatus(full) + loadWorkspaces()（网络请求 + DOM 重建）。
   * 轮询密集型页面（work-panel）下这是主要的 CPU/网络风暴来源之一。
   * 去抖后一次变更风暴只刷新一次；登录等少量场景可直接 await 原函数。
   */
  let authRefreshTimer = null;
  let authRefreshPendingFromHidden = false;
  const AUTH_REFRESH_DEBOUNCE_MS = 500;
  function scheduleAuthRefresh() {
    if (authRefreshTimer) clearTimeout(authRefreshTimer);
    authRefreshTimer = setTimeout(() => {
      authRefreshTimer = null;
      // OPT-20260808-023 F5: 不可见标签页跳过全量刷新（跨页放大降噪）——
      // auth 广播会触发 N 个标签页同时 checkLoginStatus(full)+loadWorkspaces()
      // （网络+DOM 突发）；隐藏页不再跑 60s 角标定时器。
      // 跳过时打 pending：可见性 tick 必须 full 补跑，否则角标已登录、下拉仍「请先登录」。
      if (shouldSkipDebouncedAuthRefresh(document)) {
        authRefreshPendingFromHidden = true;
        return;
      }
      refreshAuthAndWorkspaces().catch((e) => {
        console.warn('[taskChromePlugin] 去抖后 auth 刷新失败:', e.message);
      });
    }, AUTH_REFRESH_DEBOUNCE_MS);
  }

  /**
   * 角标/可见性 tick：默认只刷新角标；若 hidden-skip 待补跑或已登录但下拉仍是
   * 未登录占位，则补拉工作空间，避免「已登录 + 请先登录」分裂。
   */
  async function refreshAuthBadgeOnly() {
    const pendingHidden = authRefreshPendingFromHidden;
    authRefreshPendingFromHidden = false;
    const selectNeedsLoad = workspaceSelectNeedsLoad();
    const decide = (typeof resolveAuthBadgeTickFollowUp === 'function')
      ? resolveAuthBadgeTickFollowUp
      : null;
    const pre = decide
      ? decide({ pendingHiddenRefresh: pendingHidden, loggedIn: isLoggedIn, selectNeedsLoad })
      : (pendingHidden ? 'full' : 'none');
    if (pre === 'full') {
      console.info('[taskChromePlugin] hidden-skip 补跑全量 auth/workspaces');
      await refreshAuthAndWorkspaces();
      return;
    }
    await checkLoginStatus({ mode: 'badgeOnly' });
    const followUp = decide
      ? decide({ pendingHiddenRefresh: false, loggedIn: isLoggedIn, selectNeedsLoad })
      : (isLoggedIn && selectNeedsLoad ? 'loadWorkspaces' : 'none');
    if (followUp === 'loadWorkspaces') {
      console.info('[taskChromePlugin] 角标已登录但工作空间未加载，补拉工作空间');
      await loadWorkspaces();
    }
  }

  let authBadgeCtl = null;
  function startAuthBadgeTimer() {
    if (authBadgeCtl) {
      authBadgeCtl.stop();
      authBadgeCtl = null;
    }
    if (window.__taskpluginAuthBadgeTimer) {
      clearInterval(window.__taskpluginAuthBadgeTimer);
      window.__taskpluginAuthBadgeTimer = null;
    }
    if (typeof startDocumentVisibilityInterval !== 'function') return;
    authBadgeCtl = startDocumentVisibilityInterval(60 * 1000, () => refreshAuthBadgeOnly().catch((e) => {
      console.warn('[taskChromePlugin] 悬浮面板定时刷新登录态失败:', e.message);
    }));
    window.__taskpluginAuthBadgeCtl = authBadgeCtl;
  }

  function handleApiAuthFailure(err) {
    const msg = String(err?.message || err || '');
    if (!/\b401\b/.test(msg)) return false;
    isLoggedIn = false;
    badge.textContent = '会话失效';
    badge.className = 'taskplugin-badge taskplugin-badge-err';
    badge.title = '请在扩展弹窗中重新登录';
    wsSelect.innerHTML = '<option value="">-- 请在扩展中重新登录 --</option>';
    return true;
  }

  /** storage 变更：单一监听合并登录态 / 悬浮球 / 快捷键（禁止三个 onChanged 叠加唤醒） */
  function bindStorageListeners() {
    try {
      if (!chrome.storage?.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.floatBallEnabled !== undefined) {
          const enabled = changes.floatBallEnabled.newValue !== false;
          root.style.setProperty('display', enabled ? 'block' : 'none', 'important');
          if (!enabled) hideFloatPanel();
        }
        if (changes.elementPickerShortcut) {
          const combo = resolveShortcutCombo(changes.elementPickerShortcut.newValue);
          if (combo) {
            pickShortcutCombo = combo;
            renderShortcutHints();
          }
        }
        if (!changes.token && !changes.tokenExpiresAt && !changes.baseUrl && !changes.userId && !changes.memberId) {
          return;
        }
        scheduleAuthRefresh();
      });
    } catch (e) {
      console.warn('[taskChromePlugin] bindStorageListeners 失败:', e.message);
    }
  }

  /** 解析快捷键存储值 → 规范组合串（兼容旧版 'cmd'/'ctrl'，与 Storage.getElementPickerShortcut 迁移一致） */
  function resolveShortcutCombo(v) {
    if (v === 'cmd') return 'Command+Shift+X';
    if (v === 'ctrl') return 'Ctrl+Shift+X';
    return Storage.normalizeShortcut(v);
  }

  /**
   * storage 变更时同步快捷键组合已并入 bindStorageListeners。
   */

  async function loadWorkspaces() {
    if (!isLoggedIn) {
      wsSelect.innerHTML = '<option value="">-- 请先登录 --</option>';
      return;
    }
    wsSelect.innerHTML = '<option value="">加载中...</option>';
    try {
      const data = await swApi('getWorkspaces');

      workspacesData = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      if (!workspacesData.length) {
        wsSelect.innerHTML = '<option value="">(无工作空间)</option>';
        return;
      }
      wsSelect.innerHTML = '<option value="">-- 选择工作空间 --</option>';
      if (typeof WorkspaceList === 'undefined' || typeof WorkspaceList.workspaceOptionLabels !== 'function') {
        throw new Error('WorkspaceList helpers missing');
      }
      const labels = WorkspaceList.workspaceOptionLabels(workspacesData);
      for (let i = 0; i < workspacesData.length; i++) {
        const ws = workspacesData[i];
        const id = ws.id || ws._id;
        wsSelect.innerHTML += `<option value="${id}">${esc(labels[i])}</option>`;
      }
      await applyAidevMetaAfterWorkspacesLoaded();
    } catch (e) {
      console.warn('[taskChromePlugin] loadWorkspaces 失败:', e.message);
      if (handleApiAuthFailure(e)) return;
      wsSelect.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  }

  function setAidevStatus(text, visible = true) {
    if (!aidevStatusEl) return;
    if (!visible || !text) {
      aidevStatusEl.hidden = true;
      aidevStatusEl.textContent = '';
      return;
    }
    aidevStatusEl.textContent = text;
    aidevStatusEl.hidden = false;
  }

  function checkAidevMatchingProjects(wsId) {
    if (!pendingAidevMatches?.length || typeof AidevMeta === 'undefined') return;
    const pids = AidevMeta.projectIdsForWorkspace(pendingAidevMatches, wsId);
    if (!pids.length) return;
    const available = Array.from(projectsDiv.querySelectorAll('input.project-radio')).map((el) => el.value);
    const pick = ProjectAutoRunLabel.pickSingleProjectId(pids, available);
    for (const el of projectsDiv.querySelectorAll('input.project-radio')) {
      el.checked = el.value === pick;
    }
  }

  async function applyAidevMetaAfterWorkspacesLoaded() {
    pendingAidevMatches = null;
    if (typeof AidevMeta === 'undefined') {
      setAidevStatus('', false);
      return;
    }

    const meta = AidevMeta.readAidevMetaFromDocument(document);
    if (!meta?.service_id) {
      setAidevStatus('', false);
      return;
    }

    try {
      const resp = await swApi('resolveAidevMeta', { serviceId: meta.service_id });
      const matches = Array.isArray(resp?.matches) ? resp.matches : [];
      setAidevStatus(AidevMeta.formatAidevResolveStatus(matches));
      if (!matches.length) return;

      pendingAidevMatches = matches;
      const wsIds = AidevMeta.uniqueWorkspaceIdsFromMatches(matches);
      if (wsIds.length === 1) {
        wsSelect.value = wsIds[0];
        await loadProjects(wsIds[0]);
        checkAidevMatchingProjects(wsIds[0]);
        await loadWorkspaceCreateMeta(wsIds[0]);
        refreshFloatRepoBases();
        await seedBranchDatalists([]);
      }
    } catch (e) {
      console.warn('[taskChromePlugin] aidev resolve 失败:', e.message);
      setAidevStatus(`元信息反查失败: ${e.message}`);
    }
  }

  function selectedFloatProjectIds() {
    if (!projectsDiv) return [];
    return Array.from(projectsDiv.querySelectorAll('input.project-radio:checked')).map((el) => el.value);
  }

  function syncFloatImageAppearance(project) {
    if (typeof ProjectAutoRunLabel === 'undefined'
        || typeof ProjectAutoRunLabel.resolveImageFieldAppearance !== 'function'
        || typeof ProjectAutoRunLabel.applyImageFieldAppearance !== 'function') {
      return;
    }
    const ap = ProjectAutoRunLabel.resolveImageFieldAppearance({
      projectAllowsAutoRun: ProjectAutoRunLabel.projectAllowsAutoRun(project),
    });
    ProjectAutoRunLabel.applyImageFieldAppearance(imageRequiredMark, imageSelect, ap);
  }

  function syncFloatAutoRun(checkedPreference) {
    if (typeof ProjectAutoRunLabel === 'undefined'
        || typeof ProjectAutoRunLabel.resolveAutoRunControlState !== 'function') {
      return;
    }
    const project = ProjectAutoRunLabel.findProjectById(projectsData, selectedFloatProjectIds()[0]);
    const hasImage = typeof ProjectAutoRunLabel.hasInstalledImageId === 'function'
      ? ProjectAutoRunLabel.hasInstalledImageId(imageSelect?.value)
      : Boolean(String(imageSelect?.value || '').trim());
    const pref = checkedPreference !== undefined
      ? Boolean(checkedPreference)
      : ProjectAutoRunLabel.projectAllowsAutoRun(project);
    const st = ProjectAutoRunLabel.resolveAutoRunControlState({
      selectedProject: project,
      checkedPreference: pref,
      hasInstalledImage: hasImage,
    });
    ProjectAutoRunLabel.applyAutoRunControlToElements(autoRunInput, autoRunHint, st);
    syncFloatImageAppearance(project);
  }

  async function loadProjects(wsId) {
    projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">加载中...</span>';
    try {
      const ws = workspacesData.find((w) => String(w.id || w._id) === String(wsId));
      const companyId = ws?.company_id || ws?.companyId;
      const data = await swApi('getProjects', { workspaceId: wsId, companyId });

      projectsData = Array.isArray(data) ? data : (data?.items || data?.data || []);
      if (!projectsData.length) {
        projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">无项目</span>';
        syncFloatAutoRun(false);
        return;
      }
      if (typeof ProjectAutoRunLabel === 'undefined'
          || typeof ProjectAutoRunLabel.renderProjectRadioHtml !== 'function'
          || typeof ProjectAutoRunLabel.resolveAutoRunControlState !== 'function') {
        throw new Error('ProjectAutoRunLabel helpers missing');
      }
      let html = '';
      for (const p of projectsData) {
        html += ProjectAutoRunLabel.renderProjectRadioHtml(p, { name: 'taskplugin-project', esc });
      }
      projectsDiv.innerHTML = html;
      checkAidevMatchingProjects(wsId);
      syncFloatAutoRun();
    } catch (e) {
      console.warn('[taskChromePlugin] loadProjects 失败:', e.message);
      projectsData = [];
      syncFloatAutoRun(false);
      if (handleApiAuthFailure(e)) return;
      projectsDiv.innerHTML = `<span style="color:#f38ba8;font-size:11px;">加载失败: ${e.message}</span>`;
    }
  }

  function refreshFloatGitIdentities() {
    if (!gitIdentitiesDiv || typeof CreateTaskGitIdentity === 'undefined') return;
    const prevIdent = CreateTaskGitIdentity.readSelectionsMap(gitIdentitiesDiv);
    const pids = selectedFloatProjectIds();
    const GitId = CreateTaskGitIdentity;
    const wsId = wsSelect?.value || '';
    const ws = workspacesData.find((w) => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId || '';
    gitIdentitiesDiv.innerHTML = GitId.buildEditorsHtml({
      projectIds: pids,
      projectsList: projectsData,
      identities: gitIdentitiesCache,
      previousByUrl: prevIdent,
      settingsHref: companyId ? GitId.settingsHref(companyId) : '',
      enabled: Boolean(autoRunInput?.checked),
    });
  }

  function refreshFloatRepoBases() {
    if (!repoBasesDiv || typeof CreateTaskPayload === 'undefined') return;
    const prev = CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv);
    const pids = selectedFloatProjectIds();
    repoBasesDiv.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
      projectIds: pids,
      projectsList: projectsData,
      previousValues: prev,
      inputClass: 'taskplugin-input',
      emptyHint: '选择项目后按仓库填写',
    });
    refreshFloatGitIdentities();
  }

  function renderAssignees() {
    if (!assigneesDiv) return;
    if (!membersData.length) {
      assigneesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">暂无成员</span>';
      return;
    }
    let html = '';
    for (const m of membersData) {
      const mid = String(m.id);
      const name = m.member_name || m.name || mid;
      html += `<label><input type="checkbox" class="taskplugin-assignee" value="${esc(mid)}"> ${esc(name)}</label>`;
    }
    assigneesDiv.innerHTML = html;
  }

  function getSelectedAssigneeIds() {
    if (!assigneesDiv) return [];
    return Array.from(assigneesDiv.querySelectorAll('.taskplugin-assignee:checked')).map((cb) => cb.value);
  }

  // ---- 事件 ----
  wsSelect.addEventListener('change', async () => {
    const wsId = wsSelect.value;
    if (!wsId) {
      projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>';
      if (progressSelect) progressSelect.innerHTML = '<option value="">-- 请先选择工作空间 --</option>';
      if (deliverableSelect) deliverableSelect.innerHTML = '<option value="">-- 请先选择工作空间 --</option>';
      if (repoBasesDiv) repoBasesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">选择项目后按仓库填写</span>';
      if (assigneesDiv) assigneesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">选择工作空间后加载</span>';
      membersData = [];
      projectsData = [];
      syncFloatAutoRun(false);
      await seedBranchDatalists([]);
      return;
    }
    await loadProjects(wsId);
    await loadWorkspaceCreateMeta(wsId);
    refreshFloatRepoBases();
    await seedBranchDatalists([]);
  });

  featureParamsSelect?.addEventListener('change', () => {
    if (personalWrap) {
      personalWrap.style.display = featureParamsSelect.value === 'personal' ? '' : 'none';
    }
  });

  workBranch.addEventListener('change', () => applyPresetIfNeeded(workBranch));
  mergeTarget.addEventListener('change', () => applyPresetIfNeeded(mergeTarget));

  projectsDiv.addEventListener('change', async (e) => {
    if (e.target.type !== 'radio' || !e.target.classList.contains('project-radio')) return;
    const wsId = wsSelect.value;
    const pids = selectedFloatProjectIds();
    syncFloatAutoRun();
    refreshFloatRepoBases();
    await fetchBranchesForFloatingPanel(wsId, pids);
  });

  autoRunInput?.addEventListener('change', () => {
    refreshFloatRepoBases();
  });

  imageSelect?.addEventListener('change', () => {
    const wasEnabled = Boolean(autoRunInput && !autoRunInput.disabled);
    syncFloatAutoRun(wasEnabled ? Boolean(autoRunInput?.checked) : undefined);
    refreshFloatGitIdentities();
  });

  async function loadWorkspaceCreateMeta(wsId) {
    const ws = workspacesData.find(w => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    if (!companyId) return;
    try {
      const cid = String(companyId);
      const [colsResp, delivResp, imagesResp, personalResp, membersResp, identResp] = await Promise.all([
        swApi('fetchProgressColumns', { companyId: cid, workspaceId: wsId }).catch((e) => ({ __err: e })),
        swApi('getDeliverableTypes', { companyId: cid, workspaceId: wsId }).catch((e) => ({ __err: e })),
        swApi('getInstalledImages', { companyId: cid }).catch((e) => ({ __err: e })),
        swApi('getPersonalFeatureParamsConfigs').catch((e) => ({ __err: e })),
        swApi('getMembers', { companyId: cid }).catch((e) => ({ __err: e })),
        swApi('listGitIdentities', { companyId: cid }).catch((e) => ({ __err: e })),
      ]);

      if (progressSelect && !colsResp.__err) {
        const columns = colsResp?.columns || [];
        progressSelect.innerHTML = columns.length
          ? columns.map((c) => `<option value="${esc(String(c.id))}">${esc(c.name || c.id)}</option>`).join('')
          : '<option value="">无进度列</option>';
      }
      if (deliverableSelect && !delivResp.__err) {
        const types = delivResp?.current_deliverable_objs || [];
        deliverableSelect.innerHTML = types.length
          ? types.map((t) => `<option value="${esc(String(t.id))}">${esc(t.name || t.id)}</option>`).join('')
          : '<option value="">无可用类别</option>';
      }
      if (imageSelect && !imagesResp.__err) {
        const images = Array.isArray(imagesResp) ? imagesResp : (imagesResp?.results || imagesResp?.items || imagesResp?.data || []);
        let h = '<option value="">无</option>';
        for (const img of images) {
          const id = img.id || img._id;
          h += `<option value="${esc(String(id))}">${esc(`${img.name || id}:${img.version || img.tag || 'latest'}`)}</option>`;
        }
        imageSelect.innerHTML = h;
        if (images.length === 1) imageSelect.value = String(images[0].id || images[0]._id);
        syncFloatAutoRun();
      }
      if (personalConfigSelect && !personalResp.__err) {
        const configs = personalResp?.configs || (Array.isArray(personalResp) ? personalResp : []);
        personalConfigSelect.innerHTML = '<option value="">-- 请选择个人配置 --</option>'
          + configs.map((c) => `<option value="${esc(String(c.id || c._id))}">${esc(c.name || c.title || c.id)}</option>`).join('');
      }
      if (!membersResp.__err) {
        membersData = Array.isArray(membersResp) ? membersResp : (membersResp?.results || membersResp?.data || []);
        renderAssignees();
      }
      const GitId = typeof CreateTaskGitIdentity !== 'undefined' ? CreateTaskGitIdentity : null;
      gitIdentitiesCache = (!identResp.__err && GitId)
        ? GitId.unwrapIdentities(identResp)
        : [];
      refreshFloatRepoBases();
      if (dueDateInput && !dueDateInput.value && typeof CreateTaskPayload !== 'undefined') {
        dueDateInput.value = CreateTaskPayload.getDefaultTaskDeadline();
      }
    } catch (e) {
      console.warn('[taskChromePlugin] loadWorkspaceCreateMeta 失败:', e.message);
    }
  }

  // 提交
  submitBtn.addEventListener('click', async () => {
    if (!isLoggedIn) {
      showResult('请先在扩展弹窗中登录', 'error');
      return;
    }

    const wsId = wsSelect.value;
    const pids = selectedFloatProjectIds();
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    const priority = document.getElementById('taskplugin-priority').value;

    if (!wsId) return showResult('请选择工作空间', 'error');
    if (!pids.length) return showResult('请选择一个项目', 'error');
    if (!title) return showResult('请输入任务标题', 'error');

    submitBtn.disabled = true;
    submitBtn.textContent = '创建中...';

    try {
      const mappingResp = await sendMessageWithTimeout({ action: 'getEndpointMapping' }, 5000);
      const endpointMapping = mappingResp.success ? mappingResp.data : null;
      const owner = await resolveTaskOwner(endpointMapping, wsId);
      if (!owner) {
        showResult('无法确定任务负责人，请在扩展 Popup 中重新登录', 'error');
        return;
      }

      const wb = workBranch.value.trim();
      const mt = mergeTarget.value.trim();
      const repoBaseBranches = CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv);

      let fullDesc = desc;
      const sourceInfo = [
        `---`,
        `**来源页面**: ${window.location.href}`,
        `**页面标题**: ${document.title}`,
      ];
      fullDesc = fullDesc + '\n\n' + sourceInfo.join('\n');

      const form = {
        title,
        description: fullDesc,
        priority,
        workspaceId: wsId,
        projectIds: pids,
        projectsList: projectsData,
        owner,
        assignees: getSelectedAssigneeIds(),
        progress_column_id: progressSelect?.value || '',
        deliverable_obj_id: deliverableSelect?.value || '',
        container_image_id: imageSelect?.value || '',
        feature_params_source: featureParamsSelect?.value || '',
        personal_feature_params_config_id: personalConfigSelect?.value || '',
        due_date: dueDateInput?.value || '',
        auto_run: Boolean(autoRunInput?.checked),
        workBranch: wb,
        mergeTarget: mt,
        repoBaseBranches,
        repo_identities: (typeof CreateTaskGitIdentity !== 'undefined' && gitIdentitiesDiv)
          ? CreateTaskGitIdentity.readRepoIdentitiesFromRoot(gitIdentitiesDiv)
          : [],
      };

      const blocked = CreateTaskPayload.validateCreateTaskForm(form);
      if (blocked) {
        showResult(blocked, 'error');
        return;
      }

      const taskData = CreateTaskPayload.buildCreateTaskPayload(form);

      const resp = await sendMessageWithTimeout({
        action: 'createTask',
        baseUrl: apiCfg.baseUrl,
        token: apiCfg.token,
        endpointMapping: mappingResp.success ? mappingResp.data : undefined,
        taskData,
      }, 15000);

      if (!resp?.success) {
        if (handleApiAuthFailure({ message: resp?.error })) {
          showResult('会话失效，请重新登录', 'error');
          return;
        }
        const err = new Error(resp?.error || '创建失败');
        const tid = extractTraceId(resp);
        if (tid) err.traceId = tid;
        throw err;
      }

      const AfterCreate = typeof FloatPanelAfterCreate !== 'undefined' ? FloatPanelAfterCreate : null;
      const taskId = AfterCreate
        ? AfterCreate.extractCreatedTaskId(resp.data)
        : (resp.data?.id || resp.data?._id || '(已创建)');
      const toastMsg = AfterCreate
        ? AfterCreate.formatFloatCreateSuccessToast(taskId)
        : `✅ 任务创建成功! ID: ${taskId}`;

      hideFloatPanel();
      try {
        await restoreOpenSnapshot(openSnapshot);
      } catch (restoreErr) {
        console.warn('[taskChromePlugin] restoreOpenSnapshot 失败:', restoreErr?.message || restoreErr);
        titleInput.value = '';
        descInput.value = '';
        syncDescResetButton();
      }
      showPageToast(toastMsg);
    } catch (e) {
      showResult(`❌ 创建失败: ${e.message}`, 'error', e.traceId);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '✅ 创建任务';
    }
  });

  // ---- 工具 ----
  function getWorkPresetDatalistOptions() {
    return [
      { value: `${PRESET_PREFIX}work:feature`, label: '【模板】feature' },
      { value: `${PRESET_PREFIX}work:bugfix`, label: '【模板】bugfix' },
      { value: `${PRESET_PREFIX}work:hotfix`, label: '【模板】hotfix' },
      { value: `${PRESET_PREFIX}work:release`, label: '【模板】release' },
    ];
  }

  function getMergePresetDatalistOptions() {
    const opts = [
      { value: `${PRESET_PREFIX}merge:develop`, label: '【模板】develop' },
      { value: `${PRESET_PREFIX}merge:main`, label: '【模板】main' },
    ];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startWeek = dayOfWeek > 4 ? 1 : 0;
    const labels = dayOfWeek > 4
      ? ['下周四', '下下周四', '下下下周四']
      : ['本周四', '下周四', '下下周四'];
    for (let i = 0; i < 3; i++) {
      const ymd = getThursdayYmd(startWeek + i);
      opts.push({
        value: `${PRESET_PREFIX}merge:release:${startWeek + i}`,
        label: `【模板】release/${ymd} (${labels[i] || `第${startWeek + i + 1}个周四`})`,
      });
    }
    return opts;
  }

  function applyPresetIfNeeded(inputEl) {
    const v = inputEl.value;
    if (!v.startsWith(PRESET_PREFIX)) return;
    const rest = v.slice(PRESET_PREFIX.length);
    if (rest.startsWith('work:')) {
      inputEl.value = buildWorkBranchName(rest.slice(5));
    } else if (rest.startsWith('merge:')) {
      inputEl.value = buildMergeBranchName(rest.slice(6));
    }
  }

  function renderBranchDatalist(datalistId, presetOptions, gitOptions) {
    const datalist = document.getElementById(datalistId);
    if (!datalist) return;
    datalist.innerHTML = '';
    for (const p of presetOptions) {
      datalist.innerHTML += `<option value="${esc(p.value)}">${esc(p.label)}</option>`;
    }
    for (const g of gitOptions) {
      datalist.innerHTML += `<option value="${esc(g.value)}">${esc(g.label)}</option>`;
    }
  }

  function seedBranchDatalists(gitOptions = []) {
    renderBranchDatalist('taskplugin-work-branch-list', getWorkPresetDatalistOptions(), gitOptions);
    renderBranchDatalist('taskplugin-merge-list', getMergePresetDatalistOptions(), gitOptions);
  }

  async function fetchBranchesForFloatingPanel(wsId, pids) {
    const gitOptions = await loadBranchOptions(wsId, pids);
    seedBranchDatalists(gitOptions);
  }

  async function loadBranchOptions(wsId, pids) {
    if (!wsId || !pids.length) return [];

    const ws = workspacesData.find(w => (w.id || w._id) === wsId);
    const companyId = ws?.company_id || ws?.companyId;
    if (!companyId) return [];

    const options = [];
    const seen = new Set();
    for (const b of ['develop', 'main']) {
      seen.add(b);
      options.push({ value: b, label: `${b}  [内置]` });
    }

    for (const pid of pids.slice(0, 3)) {
      const proj = projectsData.find(p => String(p.id || p._id) === String(pid));
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
      const repoUrl = repos[0];
      if (!repoUrl) continue;

      try {
        const resp = await swApi('getBranches', {
          companyId: String(companyId),
          projectId: pid,
          repoUrl,
        });
        const branches = Array.isArray(resp?.branches) ? resp.branches : (Array.isArray(resp) ? resp : []);
        for (const b of branches) {
          const name = typeof b === 'string' ? b : (b.name || b.branch_name || '');
          if (name && !seen.has(name)) {
            seen.add(name);
            const shortRepo = extractRepoLabel(repoUrl);
            const label = shortRepo ? `${name}  [${shortRepo}]` : name;
            options.push({ value: name, label });
          }
        }
      } catch (_) { /* ignore */ }
    }
    return options;
  }

  function extractRepoLabel(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\.git$/, '').replace(/^\//, '');
      const parts = path.split('/');
      if (parts.length >= 2) return parts.slice(-2).join('/');
      return u.hostname;
    } catch (_) { return ''; }
  }

  function getThursdayYmd(weekOffset = 0) {
    const d = new Date();
    const dayOfWeek = d.getDay();
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    d.setDate(d.getDate() + daysUntilThursday + weekOffset * 7);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  function buildMergeBranchName(presetType) {
    const releaseMatch = /^release:(\d+)$/.exec(presetType);
    if (releaseMatch) {
      const weekOffset = parseInt(releaseMatch[1], 10);
      const ymd = getThursdayYmd(weekOffset);
      return `release/${ymd}_aidev\${taskId}`;
    }
    if (presetType === 'develop' || presetType === 'main') {
      return presetType;
    }
    return '';
  }

  function buildWorkBranchName(presetType) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const titleSlug = (titleInput.value.trim() || 'task')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/(^-+)|(-+$)/g, '')
      .slice(0, 40) || 'task';
    if (presetType === 'release') {
      return `release/${today}_aidev\${taskId}`;
    }
    if (presetType === 'feature' || presetType === 'bugfix' || presetType === 'hotfix') {
      return `${presetType}/${today}_aidev\${taskId}_${titleSlug}`;
    }
    return '';
  }

  function showResult(msg, type, traceId) {
    resultDiv.textContent = msg;
    resultDiv.className = `taskplugin-result taskplugin-show taskplugin-result-${type}`;
    if (type === 'error') {
      setDataTraceId(resultDiv, traceId);
    } else {
      setDataTraceId(resultDiv, '');
    }
    setTimeout(() => {
      resultDiv.className = 'taskplugin-result';
      resultDiv.removeAttribute('data-traceId');
    }, 6000);
  }

  function captureOpenSnapshot() {
    const AfterCreate = typeof FloatPanelAfterCreate !== 'undefined' ? FloatPanelAfterCreate : null;
    const raw = {
      workspaceId: wsSelect.value || '',
      projectIds: selectedFloatProjectIds(),
      title: titleInput.value,
      description: descInput.value,
      priority: document.getElementById('taskplugin-priority')?.value || '1',
      progress_column_id: progressSelect?.value || '',
      deliverable_obj_id: deliverableSelect?.value || '',
      container_image_id: imageSelect?.value || '',
      feature_params_source: featureParamsSelect?.value || '',
      personal_feature_params_config_id: personalConfigSelect?.value || '',
      due_date: dueDateInput?.value || '',
      auto_run: Boolean(autoRunInput?.checked),
      repoBaseBranches: (typeof CreateTaskPayload !== 'undefined' && repoBasesDiv)
        ? CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv)
        : {},
      assigneeIds: getSelectedAssigneeIds(),
      workBranch: workBranch.value,
      mergeTarget: mergeTarget.value,
    };
    return AfterCreate ? AfterCreate.normalizeOpenSnapshot(raw) : raw;
  }

  function applyScalarFieldsFromSnapshot(snap) {
    titleInput.value = snap.title || '';
    descInput.value = snap.description || '';
    syncDescResetButton();
    const priorityEl = document.getElementById('taskplugin-priority');
    if (priorityEl) priorityEl.value = snap.priority || '1';
    if (workBranch) workBranch.value = snap.workBranch || '';
    if (mergeTarget) mergeTarget.value = snap.mergeTarget || '';
    if (featureParamsSelect) {
      featureParamsSelect.value = snap.feature_params_source || '';
      if (personalWrap) {
        personalWrap.style.display = featureParamsSelect.value === 'personal' ? '' : 'none';
      }
    }
  }

  async function restoreOpenSnapshot(snap) {
    if (!snap) {
      titleInput.value = '';
      descInput.value = '';
      syncDescResetButton();
      return;
    }
    const AfterCreate = typeof FloatPanelAfterCreate !== 'undefined' ? FloatPanelAfterCreate : null;
    const normalized = AfterCreate ? AfterCreate.normalizeOpenSnapshot(snap) : snap;

    applyScalarFieldsFromSnapshot(normalized);

    const wsId = normalized.workspaceId || '';
    if (!wsId) {
      wsSelect.value = '';
      projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>';
      if (progressSelect) progressSelect.innerHTML = '<option value="">-- 请先选择工作空间 --</option>';
      if (deliverableSelect) deliverableSelect.innerHTML = '<option value="">-- 请先选择工作空间 --</option>';
      if (repoBasesDiv) repoBasesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">选择项目后按仓库填写</span>';
      if (assigneesDiv) assigneesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">选择工作空间后加载</span>';
      membersData = [];
      projectsData = [];
      syncFloatAutoRun(false);
      if (dueDateInput) dueDateInput.value = normalized.due_date || '';
      await seedBranchDatalists([]);
      return;
    }

    wsSelect.value = wsId;
    await loadProjects(wsId);
    const available = Array.from(projectsDiv.querySelectorAll('input.project-radio')).map((el) => el.value);
    const pick = ProjectAutoRunLabel.pickSingleProjectId(normalized.projectIds || [], available);
    for (const el of projectsDiv.querySelectorAll('input.project-radio')) {
      el.checked = el.value === pick;
    }
    syncFloatAutoRun(normalized.auto_run);
    await loadWorkspaceCreateMeta(wsId);

    if (progressSelect && normalized.progress_column_id) {
      progressSelect.value = normalized.progress_column_id;
    }
    if (deliverableSelect && normalized.deliverable_obj_id) {
      deliverableSelect.value = normalized.deliverable_obj_id;
    }
    if (imageSelect) imageSelect.value = normalized.container_image_id || '';
    if (personalConfigSelect) {
      personalConfigSelect.value = normalized.personal_feature_params_config_id || '';
    }
    if (dueDateInput) dueDateInput.value = normalized.due_date || '';

    const assigneeSet = new Set(normalized.assigneeIds || []);
    if (assigneesDiv) {
      for (const cb of assigneesDiv.querySelectorAll('.taskplugin-assignee')) {
        cb.checked = assigneeSet.has(String(cb.value));
      }
    }

    if (repoBasesDiv && typeof CreateTaskPayload !== 'undefined') {
      repoBasesDiv.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
        projectIds: pick ? [pick] : [],
        projectsList: projectsData,
        previousValues: normalized.repoBaseBranches || {},
        inputClass: 'taskplugin-input',
        emptyHint: '选择项目后按仓库填写',
      });
      refreshFloatGitIdentities();
    }

    await fetchBranchesForFloatingPanel(wsId, pick ? [pick] : []);
    if (workBranch) workBranch.value = normalized.workBranch || '';
    if (mergeTarget) mergeTarget.value = normalized.mergeTarget || '';
  }

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

  function hideFloatPanel() {
    isOpen = false;
    panel.classList.remove('taskplugin-open');
    btn.classList.remove('taskplugin-active');
    if (pickMode) setPickMode(false);
    if (adjustModal && !adjustModal.hidden) closeAdjustModal();
    resultDiv.className = 'taskplugin-result';
    resultDiv.textContent = '';
    resultDiv.removeAttribute('data-traceId');
  }

  function showPageToast(msg) {
    let toast = document.getElementById('taskplugin-page-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'taskplugin-page-toast';
      root.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'taskplugin-page-toast taskplugin-page-toast-show';
    if (pageToastTimer) clearTimeout(pageToastTimer);
    pageToastTimer = setTimeout(() => {
      toast.classList.remove('taskplugin-page-toast-show');
    }, 3000);
  }

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = String(s);
    return d.innerHTML;
  }

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
      console.log('[taskChromePlugin] startElementPick from', msg.source || 'devtools');
      if (adjustModal && !adjustModal.hidden) closeAdjustModal();
      setPickMode(true, msg.source === 'float' ? 'float' : 'devtools');
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
        sendResponse?.({ success: false, error: '未找到子 iframe' });
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

  // pulse 动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes taskplugin-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }
  `;
  document.head.appendChild(style);
})();
