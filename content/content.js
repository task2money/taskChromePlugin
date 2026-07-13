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
    <button id="taskplugin-float-btn" title="TaskPlugin — 快速创建任务">+</button>
    <div id="taskplugin-float-panel">
      <div class="taskplugin-panel-header">
        <h3>🔧 快速创建任务</h3>
        <div style="display:flex;align-items:center;gap:6px">
          <label class="taskplugin-mini-toggle" title="关闭悬浮球">
            <input type="checkbox" id="taskplugin-float-enabled" checked>
            <span class="taskplugin-mini-slider"></span>
          </label>
          <span id="taskplugin-login-badge" class="taskplugin-badge taskplugin-badge-err">未登录</span>
        </div>
      </div>
      <div class="taskplugin-panel-body">
        <div class="taskplugin-captured-url" id="taskplugin-page-url"></div>
        <div class="taskplugin-form-group">
          <label>标题</label>
          <input class="taskplugin-input" id="taskplugin-title" placeholder="任务标题">
        </div>
        <div class="taskplugin-form-group">
          <label class="taskplugin-label-row">
            <span>描述</span>
            <button type="button" class="taskplugin-btn taskplugin-btn-pick" id="taskplugin-pick-btn" title="指针选择页面元素后填写调整期望">🖱️ 指针选择</button>
          </label>
          <textarea class="taskplugin-textarea" id="taskplugin-desc" placeholder="任务描述...（可用指针选择页面元素）"></textarea>
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
          <label>已安装镜像</label>
          <select class="taskplugin-select" id="taskplugin-image">
            <option value="">无</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>环境变量参数 <span style="color:#f38ba8;font-size:10px;">*必填</span></label>
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
            <input type="checkbox" id="taskplugin-auto-run">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title">是否自动运行</span>
              <span class="taskplugin-toggle-hint">创建后按项目运行模版启动云服务器</span>
            </span>
          </label>
        </div>
        <div class="taskplugin-form-group">
          <label>工作空间</label>
          <select class="taskplugin-select" id="taskplugin-workspace">
            <option value="">-- 请先登录 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>项目 (可多选)</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-projects">
            <span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>逐仓基准分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 对齐工作面板</span></label>
          <div id="taskplugin-repo-bases" class="taskplugin-checkbox-list">
            <span style="color:#6c7086;font-size:11px;">勾选项目后按仓库填写</span>
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
        <div class="taskplugin-modal-actions">
          <button type="button" class="taskplugin-btn" id="taskplugin-adjust-cancel">取消</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-btn-modal-primary" id="taskplugin-adjust-confirm">确认加入描述</button>
        </div>
        <div id="taskplugin-adjust-error" class="taskplugin-result"></div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

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
  const assigneesDiv = document.getElementById('taskplugin-assignees');
  const titleInput = document.getElementById('taskplugin-title');
  const descInput = document.getElementById('taskplugin-desc');
  const progressSelect = document.getElementById('taskplugin-progress');
  const deliverableSelect = document.getElementById('taskplugin-deliverable');
  const imageSelect = document.getElementById('taskplugin-image');
  const featureParamsSelect = document.getElementById('taskplugin-feature-params');
  const personalWrap = document.getElementById('taskplugin-personal-wrap');
  const personalConfigSelect = document.getElementById('taskplugin-personal-config');
  const dueDateInput = document.getElementById('taskplugin-due-date');
  const autoRunInput = document.getElementById('taskplugin-auto-run');
  let membersData = [];

  const floatEnabledToggle = document.getElementById('taskplugin-float-enabled');
  const pickBtn = document.getElementById('taskplugin-pick-btn');
  const adjustModal = document.getElementById('taskplugin-adjust-modal');
  const adjustElSummary = document.getElementById('taskplugin-adjust-el-summary');
  const adjustInput = document.getElementById('taskplugin-adjust-input');
  const adjustCancel = document.getElementById('taskplugin-adjust-cancel');
  const adjustConfirm = document.getElementById('taskplugin-adjust-confirm');
  const adjustError = document.getElementById('taskplugin-adjust-error');

  let isOpen = false;
  let isLoggedIn = false;
  let pickMode = false;
  let highlightedEl = null;
  let pendingElementSnapshot = null;
  let apiCfg = { baseUrl: 'http://183.250.1.132:18081', token: '' };
  let workspacesData = [];
  let projectsData = [];

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
      setupElementPicker();

      // 1. 同步初始化 datalist（不依赖网络/存储）
      seedBranchDatalists();

      // 2. 异步恢复配置和认证状态（失败不影响核心交互）
      const floatCfg = await loadFloatBallConfigFromStorage();
      console.log('[taskChromePlugin] floatBall enabled:', floatCfg.enabled);
      if (!floatCfg.enabled) {
        root.style.setProperty('display', 'none', 'important');
      }
      floatEnabledToggle.checked = floatCfg.enabled;

      await restoreFloatBallPosition();

      const urlEl = document.getElementById('taskplugin-page-url');
      if (urlEl) urlEl.textContent = `📍 ${window.location.href}`;

      await refreshAuthAndWorkspaces();

      floatEnabledToggle.addEventListener('change', async () => {
        const enabled = floatEnabledToggle.checked;
        root.style.setProperty('display', enabled ? 'block' : 'none', 'important');
        await saveFloatBallConfigToStorage(enabled);
      });
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
  // ================================================================

  function isPluginDom(node) {
    if (!node || node.nodeType !== 1) return true;
    if (node === root || root.contains(node)) return true;
    if (typeof node.closest === 'function' && node.closest('#taskplugin-float-root')) return true;
    return false;
  }

  function clearHighlight() {
    if (highlightedEl) {
      highlightedEl.classList.remove('taskplugin-el-highlight');
      highlightedEl = null;
    }
  }

  function setPickMode(on) {
    pickMode = !!on;
    document.documentElement.classList.toggle('taskplugin-picking', pickMode);
    pickBtn?.classList.toggle('taskplugin-pick-active', pickMode);
    if (pickBtn) {
      pickBtn.textContent = pickMode ? '✕ 取消选择' : '🖱️ 指针选择';
      pickBtn.title = pickMode ? '取消指针选择（Esc）' : '指针选择页面元素后填写调整期望';
    }
    if (!pickMode) clearHighlight();
    console.log('[taskChromePlugin] element pick mode:', pickMode ? 'on' : 'off');
  }

  function onPickMouseOver(e) {
    if (!pickMode) return;
    const t = e.target;
    if (isPluginDom(t)) {
      clearHighlight();
      return;
    }
    if (highlightedEl === t) return;
    clearHighlight();
    highlightedEl = t;
    highlightedEl.classList.add('taskplugin-el-highlight');
  }

  function onPickClick(e) {
    if (!pickMode) return;
    const t = e.target;
    if (isPluginDom(t)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    if (typeof ElementPicker === 'undefined') {
      console.error('[taskChromePlugin] ElementPicker 未加载');
      setPickMode(false);
      return;
    }

    try {
      pendingElementSnapshot = ElementPicker.snapshotElement(t);
      setPickMode(false);
      openAdjustModal(pendingElementSnapshot);
    } catch (err) {
      console.warn('[taskChromePlugin] snapshotElement 失败:', err.message || err);
      setPickMode(false);
    }
  }

  function onPickKeyDown(e) {
    if (e.key !== 'Escape') return;
    if (pickMode) {
      e.preventDefault();
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
    adjustElSummary.textContent = `${snapshot.label}${snapshot.visibleText ? ` — "${snapshot.visibleText}"` : ''}`;
    adjustInput.value = '';
    adjustError.className = 'taskplugin-result';
    adjustError.textContent = '';
    adjustModal.hidden = false;
    if (!isOpen) {
      isOpen = true;
      panel.classList.add('taskplugin-open');
      btn.classList.add('taskplugin-active');
    }
    setTimeout(() => adjustInput.focus(), 0);
    console.log('[taskChromePlugin] adjust modal open for:', snapshot.label);
  }

  function closeAdjustModal() {
    if (!adjustModal) return;
    adjustModal.hidden = true;
    pendingElementSnapshot = null;
    adjustInput.value = '';
    adjustError.className = 'taskplugin-result';
    adjustError.textContent = '';
  }

  function confirmAdjustModal() {
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
    try {
      descInput.value = ElementPicker.appendElementAdjustmentToDescription(descInput.value, {
        pageUrl: window.location.href,
        pageTitle: document.title,
        element: pendingElementSnapshot,
        adjustment,
      });
      console.log('[taskChromePlugin] element adjustment appended to description');
      closeAdjustModal();
      showResult('已将元素调整期望加入任务描述', 'success');
    } catch (ex) {
      adjustError.textContent = ex.message || String(ex);
      adjustError.className = 'taskplugin-result taskplugin-show taskplugin-result-error';
    }
  }

  function setupElementPicker() {
    if (!pickBtn) {
      console.warn('[taskChromePlugin] pick button missing');
      return;
    }
    pickBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (adjustModal && !adjustModal.hidden) closeAdjustModal();
      setPickMode(!pickMode);
    });
    document.addEventListener('mouseover', onPickMouseOver, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKeyDown, true);
    adjustCancel?.addEventListener('click', (e) => {
      e.preventDefault();
      closeAdjustModal();
    });
    adjustConfirm?.addEventListener('click', (e) => {
      e.preventDefault();
      confirmAdjustModal();
    });
  }

  // ---- Drag Logic ----
  function setupDrag() {
    btn.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
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
    isOpen = !isOpen;
    panel.classList.toggle('taskplugin-open', isOpen);
    btn.classList.toggle('taskplugin-active', isOpen);
    btn.textContent = isOpen ? '+' : '+';

    if (isOpen) {
      await refreshAuthAndWorkspaces();
    }
  });

  // ================================================================
  //  登录 / 工作空间 / 项目
  // ================================================================

  async function initApiClient() {
    const mapping = await Storage.getEndpointMapping();
    const cred = await Storage.getCredentials();
    API.init(apiCfg.baseUrl, apiCfg.token, mapping, cred.userId || '');
  }

  async function resolveTaskOwner(endpointMapping, wsId) {
    if (endpointMapping?.owner) return String(endpointMapping.owner);
    const cred = await Storage.getCredentials();
    if (cred.memberId) return String(cred.memberId);

    const ws = workspacesData.find(w => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    if (companyId && cred.userId) {
      try {
        await initApiClient();
        const data = await API.getMembers(String(companyId));
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

  async function checkLoginStatus() {
    try {
      const cfg = await Storage.getApiConfig();
      const expired = await Storage.isTokenExpired();
      if (cfg.token && !expired) {
        isLoggedIn = true;
        apiCfg = cfg;
        await initApiClient();
        badge.textContent = '已登录';
        badge.className = 'taskplugin-badge taskplugin-badge-ok';
        wsSelect.innerHTML = '<option value="">加载中...</option>';
      } else {
        isLoggedIn = false;
        apiCfg = cfg;
        badge.textContent = expired ? '会话过期' : '未登录';
        badge.className = 'taskplugin-badge taskplugin-badge-err';
        wsSelect.innerHTML = '<option value="">-- 请先登录 --</option>';
      }
    } catch (e) {
      console.warn('[taskChromePlugin] checkLoginStatus 失败:', e.message);
      isLoggedIn = false;
      badge.textContent = '未登录';
      badge.className = 'taskplugin-badge taskplugin-badge-err';
      wsSelect.innerHTML = '<option value="">-- 请先登录 --</option>';
    }
  }

  async function refreshAuthAndWorkspaces() {
    workspacesData = [];
    await checkLoginStatus();
    if (isLoggedIn) {
      await loadWorkspaces();
    }
  }

  function handleApiAuthFailure(err) {
    const msg = String(err?.message || err || '');
    if (!/\b401\b/.test(msg)) return false;
    isLoggedIn = false;
    badge.textContent = '会话失效';
    badge.className = 'taskplugin-badge taskplugin-badge-err';
    wsSelect.innerHTML = '<option value="">-- 请在扩展中重新登录 --</option>';
    return true;
  }

  async function loadWorkspaces() {
    if (!isLoggedIn) {
      wsSelect.innerHTML = '<option value="">-- 请先登录 --</option>';
      return;
    }
    wsSelect.innerHTML = '<option value="">加载中...</option>';
    try {
      await initApiClient();
      const data = await API.getWorkspaces();

      workspacesData = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      if (!workspacesData.length) {
        wsSelect.innerHTML = '<option value="">(无工作空间)</option>';
        return;
      }
      wsSelect.innerHTML = '<option value="">-- 选择工作空间 --</option>';
      for (const ws of workspacesData) {
        const id = ws.id || ws._id;
        const name = ws.name || ws.displayName || ws.title || id;
        wsSelect.innerHTML += `<option value="${id}">${esc(name)}</option>`;
      }
    } catch (e) {
      console.warn('[taskChromePlugin] loadWorkspaces 失败:', e.message);
      if (handleApiAuthFailure(e)) return;
      wsSelect.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  }

  async function loadProjects(wsId) {
    projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">加载中...</span>';
    try {
      await initApiClient();
      const ws = workspacesData.find((w) => String(w.id || w._id) === String(wsId));
      const companyId = ws?.company_id || ws?.companyId;
      const data = await API.getProjects(wsId, companyId);

      projectsData = Array.isArray(data) ? data : (data?.items || data?.data || []);
      if (!projectsData.length) {
        projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">无项目</span>';
        return;
      }
      let html = '';
      for (const p of projectsData) {
        const id = p.id || p._id;
        const name = p.name || p.displayName || p.title || id;
        html += `<label><input type="checkbox" value="${id}"> ${esc(name)}</label>`;
      }
      projectsDiv.innerHTML = html;
    } catch (e) {
      console.warn('[taskChromePlugin] loadProjects 失败:', e.message);
      if (handleApiAuthFailure(e)) return;
      projectsDiv.innerHTML = `<span style="color:#f38ba8;font-size:11px;">加载失败: ${e.message}</span>`;
    }
  }

  function refreshFloatRepoBases() {
    if (!repoBasesDiv || typeof CreateTaskPayload === 'undefined') return;
    const prev = CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv);
    const pids = Array.from(projectsDiv.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
    repoBasesDiv.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
      projectIds: pids,
      projectsList: projectsData,
      previousValues: prev,
      inputClass: 'taskplugin-input',
      emptyHint: '勾选项目后按仓库填写',
    });
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
      if (repoBasesDiv) repoBasesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">勾选项目后按仓库填写</span>';
      if (assigneesDiv) assigneesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">选择工作空间后加载</span>';
      membersData = [];
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
    if (e.target.type !== 'checkbox') return;
    const wsId = wsSelect.value;
    const pids = Array.from(projectsDiv.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    refreshFloatRepoBases();
    await fetchBranchesForFloatingPanel(wsId, pids);
  });

  async function loadWorkspaceCreateMeta(wsId) {
    const ws = workspacesData.find(w => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    if (!companyId) return;
    try {
      await initApiClient();
      const [colsResp, delivResp, imagesResp, personalResp, membersResp] = await Promise.all([
        API.fetchProgressColumns(String(companyId), wsId).catch((e) => ({ __err: e })),
        API.getDeliverableTypes(String(companyId), wsId).catch((e) => ({ __err: e })),
        API.getInstalledImages(String(companyId)).catch((e) => ({ __err: e })),
        API.getPersonalFeatureParamsConfigs().catch((e) => ({ __err: e })),
        API.getMembers(String(companyId)).catch((e) => ({ __err: e })),
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
    const pids = Array.from(projectsDiv.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    const priority = document.getElementById('taskplugin-priority').value;

    if (!wsId) return showResult('请选择工作空间', 'error');
    if (!pids.length) return showResult('请勾选至少一个项目', 'error');
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

      if (!resp.success) throw new Error(resp.error);

      showResult(`✅ 任务创建成功! ID: ${resp.data?.id || resp.data?._id || '(已创建)'}`, 'success');
      titleInput.value = '';
      descInput.value = '';
    } catch (e) {
      showResult(`❌ 创建失败: ${e.message}`, 'error');
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
        await initApiClient();
        const resp = await API.getBranches(String(companyId), pid, repoUrl);
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
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task';
    if (presetType === 'release') {
      return `release/${today}_aidev\${taskId}`;
    }
    if (presetType === 'feature' || presetType === 'bugfix' || presetType === 'hotfix') {
      return `${presetType}/${today}_aidev\${taskId}_${titleSlug}`;
    }
    return '';
  }

  function showResult(msg, type) {
    resultDiv.textContent = msg;
    resultDiv.className = `taskplugin-result taskplugin-show taskplugin-result-${type}`;
    setTimeout(() => { resultDiv.className = 'taskplugin-result'; }, 6000);
  }

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ---- 监听来自 popup / background 的消息 ----
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'openDevToolsHint') {
      if (!btn) return;
      btn.style.animation = 'none';
      btn.offsetHeight;
      btn.style.animation = 'taskplugin-pulse 0.3s ease 3';
    }
    if (msg.action === 'setFloatBallEnabled') {
      console.log('[taskChromePlugin] setFloatBallEnabled from popup:', msg.enabled);
      root.style.setProperty('display', msg.enabled ? 'block' : 'none', 'important');
      floatEnabledToggle.checked = msg.enabled;
    }
    if (msg.action === 'authStateChanged') {
      refreshAuthAndWorkspaces().catch((e) => {
        console.warn('[taskChromePlugin] authStateChanged 刷新失败:', e.message);
      });
    }
  });

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
