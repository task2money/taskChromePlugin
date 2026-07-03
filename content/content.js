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
  // 无 inline display，由 CSS 控制（display: block !important）

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
          <label>描述</label>
          <textarea class="taskplugin-textarea" id="taskplugin-desc" placeholder="任务描述..."></textarea>
        </div>
        <div class="taskplugin-form-group">
          <label>优先级</label>
          <select class="taskplugin-select" id="taskplugin-priority">
            <option value="low">低</option>
            <option value="medium" selected>中</option>
            <option value="high">高</option>
            <option value="critical">紧急</option>
          </select>
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
          <label>工作分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 从此分支拉出工作分支</span></label>
          <input class="taskplugin-input" id="taskplugin-work-branch" placeholder="如: fix/20260703_username_aidev${taskId}_fix-502">
        </div>
        <div class="taskplugin-form-group">
          <label>合并目标模板 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 选择模板自动填充</span></label>
          <select class="taskplugin-select" id="taskplugin-merge-preset">
            <option value="develop">develop</option>
            <!-- release 选项由 JS 动态填充（本周四/下周四/下下周四） -->
            <option value="main">main</option>
            <option value="custom">自定义（手动输入）</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>合并目标分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 合并到此分支，可编辑</span></label>
          <input class="taskplugin-input" id="taskplugin-merge-target" placeholder="如: main, develop" list="taskplugin-merge-list">
          <datalist id="taskplugin-merge-list"></datalist>
        </div>
        <button class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-submit">✅ 创建任务</button>
        <div id="taskplugin-result" class="taskplugin-result"></div>
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
  const mergePreset = document.getElementById('taskplugin-merge-preset');
  const mergeTarget = document.getElementById('taskplugin-merge-target');
  const workBranch = document.getElementById('taskplugin-work-branch');

  const floatEnabledToggle = document.getElementById('taskplugin-float-enabled');

  let isOpen = false;
  let isLoggedIn = false;
  let apiCfg = { baseUrl: 'http://183.250.1.132:4000', token: '' };
  let workspacesData = [];
  let projectsData = [];

  // ---- Drag State ----
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let btnStartX = 0;
  let btnStartY = 0;
  let hasMoved = false;
  const DRAG_THRESHOLD = 4; // px — 移动超过此阈值才算拖动

  // ---- Init ----
  (async function init() {
    // 动态填充 release 周四选项
    populateFloatingReleasePresets();

    // 加载悬浮球配置
    const floatCfg = await loadFloatBallConfigFromStorage();
    console.log('[taskChromePlugin] floatBall enabled:', floatCfg.enabled);
    if (!floatCfg.enabled) {
      root.style.setProperty('display', 'none', 'important');
    }
    floatEnabledToggle.checked = floatCfg.enabled;

    // 恢复悬浮球位置
    await restoreFloatBallPosition();

    // 显示当前页面 URL
    const urlEl = document.getElementById('taskplugin-page-url');
    urlEl.textContent = `📍 ${window.location.href}`;

    // 加载登录状态
    await checkLoginStatus();
    if (isLoggedIn) {
      await loadWorkspaces();
    }

    // 设置拖动
    setupDrag();

    // 面板内关闭开关
    floatEnabledToggle.addEventListener('change', async () => {
      const enabled = floatEnabledToggle.checked;
      root.style.setProperty('display', enabled ? 'block' : 'none', 'important');
      await saveFloatBallConfigToStorage(enabled);
    });
  })();

  async function loadFloatBallConfigFromStorage() {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'getFloatBallConfig' });
      if (r.success) return r.data;
    } catch (_) {}
    return { enabled: true };
  }

  async function saveFloatBallConfigToStorage(enabled) {
    try {
      await chrome.runtime.sendMessage({ action: 'saveFloatBallConfig', enabled });
    } catch (_) {}
  }

  async function restoreFloatBallPosition() {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'getFloatBallPosition' });
      if (r.success && r.data && r.data.x != null && r.data.y != null) {
        btn.style.bottom = 'auto';
        btn.style.right = 'auto';
        btn.style.left = r.data.x + 'px';
        btn.style.top = r.data.y + 'px';
      }
    } catch (_) {}
  }

  // ---- Drag Logic ----
  function setupDrag() {
    btn.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    // 防止拖拽时选中文字
    btn.addEventListener('dragstart', (e) => e.preventDefault());
  }

  function onDragStart(e) {
    if (e.button !== 0) return; // 只响应左键
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = btn.getBoundingClientRect();
    // 如果按钮还在用 bottom/right 定位，先转为 top/left
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
    // 限制在视口内
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
      // 持久化位置
      const x = parseInt(btn.style.left, 10);
      const y = parseInt(btn.style.top, 10);
      if (!isNaN(x) && !isNaN(y)) {
        chrome.runtime.sendMessage({ action: 'saveFloatBallPosition', x, y }).catch(() => {});
      }
    }
  }

  // 修改打开/关闭面板逻辑 — 拖动后不触发 click
  btn.addEventListener('click', async (e) => {
    if (hasMoved) {
      hasMoved = false;
      return; // 拖动后不触发面板切换
    }
    isOpen = !isOpen;
    panel.classList.toggle('taskplugin-open', isOpen);
    btn.classList.toggle('taskplugin-active', isOpen);
    btn.textContent = isOpen ? '+' : '+';

    if (isOpen) {
      await checkLoginStatus();
      if (isLoggedIn && workspacesData.length === 0) {
        await loadWorkspaces();
      }
    }
  });

  // ---- 检查登录 ----
  async function checkLoginStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getApiConfig' });
      if (resp.success && resp.data?.token) {
        isLoggedIn = true;
        apiCfg = resp.data;
        badge.textContent = '已登录';
        badge.className = 'taskplugin-badge taskplugin-badge-ok';
        wsSelect.innerHTML = '<option value="">加载中...</option>';
      } else {
        isLoggedIn = false;
        badge.textContent = '未登录';
        badge.className = 'taskplugin-badge taskplugin-badge-err';
        wsSelect.innerHTML = '<option value="">-- 请先登录 --</option>';
      }
    } catch (_) {
      isLoggedIn = false;
    }
  }

  // ---- 加载工作空间 ----
  async function loadWorkspaces() {
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'getWorkspaces',
        baseUrl: apiCfg.baseUrl,
        token: apiCfg.token,
      });
      if (!resp.success) throw new Error(resp.error);

      workspacesData = Array.isArray(resp.data) ? resp.data : (resp.data?.items || resp.data?.data || []);
      wsSelect.innerHTML = '<option value="">-- 选择工作空间 --</option>';
      for (const ws of workspacesData) {
        const id = ws.id || ws._id;
        const name = ws.name || ws.displayName || ws.title || id;
        wsSelect.innerHTML += `<option value="${id}">${esc(name)}</option>`;
      }
    } catch (e) {
      wsSelect.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  }

  // ---- 加载项目 ----
  async function loadProjects(wsId) {
    projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">加载中...</span>';
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'getProjects',
        baseUrl: apiCfg.baseUrl,
        token: apiCfg.token,
        workspaceId: wsId,
      });
      if (!resp.success) throw new Error(resp.error);

      projectsData = Array.isArray(resp.data) ? resp.data : (resp.data?.items || resp.data?.data || []);
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
      projectsDiv.innerHTML = `<span style="color:#f38ba8;font-size:11px;">加载失败: ${e.message}</span>`;
    }
  }

  // ---- 事件 ----

  // 工作空间选择
  wsSelect.addEventListener('change', async () => {
    const wsId = wsSelect.value;
    if (!wsId) {
      projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>';
      return;
    }
    await loadProjects(wsId);
  });

  // 合并目标预设变更 —— 自动填充分支名
  mergePreset.addEventListener('change', () => {
    const preset = mergePreset.value;
    if (!preset || preset === 'custom') return;
    mergeTarget.value = buildMergeBranchName(preset);
  });

  // 项目勾选变化 —— 动态获取 Git 分支
  projectsDiv.addEventListener('change', async (e) => {
    if (e.target.type !== 'checkbox') return;
    const wsId = wsSelect.value;
    const pids = Array.from(projectsDiv.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    await fetchBranchesForFloatingPanel(wsId, pids);
  });

  // 提交
  submitBtn.addEventListener('click', async () => {
    if (!isLoggedIn) {
      showResult('请先在扩展弹窗中登录', 'error');
      return;
    }

    const wsId = wsSelect.value;
    const pids = Array.from(projectsDiv.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
    const title = document.getElementById('taskplugin-title').value.trim();
    const desc = document.getElementById('taskplugin-desc').value.trim();
    const priority = document.getElementById('taskplugin-priority').value;

    if (!wsId) return showResult('请选择工作空间', 'error');
    if (!pids.length) return showResult('请勾选至少一个项目', 'error');
    if (!title) return showResult('请输入任务标题', 'error');

    submitBtn.disabled = true;
    submitBtn.textContent = '创建中...';

    try {
      const mappingResp = await chrome.runtime.sendMessage({ action: 'getEndpointMapping' });

      const wb = workBranch.value.trim();
      const mt = mergeTarget.value.trim();
      const taskData = {
        title,
        description: desc + `\n\n---\n**来源页面**: ${window.location.href}\n**页面标题**: ${document.title}`,
        priority,
        workspaceId: wsId,
        projectIds: pids,
        source: 'chrome-content-script',
        sourceUrl: window.location.href,
        sourceTitle: document.title,
      };
      if (wb || mt) {
        taskData.branch_strategy = {
          work_branch_name: wb,
          merge_target_branch_name: mt,
          target_branch_name: wb,
        };
      }

      const resp = await chrome.runtime.sendMessage({
        action: 'createTask',
        baseUrl: apiCfg.baseUrl,
        token: apiCfg.token,
        endpointMapping: mappingResp.success ? mappingResp.data : undefined,
        taskData,
      });

      if (!resp.success) throw new Error(resp.error);

      showResult(`✅ 任务创建成功! ID: ${resp.data?.id || resp.data?._id || '(已创建)'}`, 'success');
      // 清空表单
      document.getElementById('taskplugin-title').value = '';
      document.getElementById('taskplugin-desc').value = '';
    } catch (e) {
      showResult(`❌ 创建失败: ${e.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '✅ 创建任务';
    }
  });

  // ---- 工具 ----
  async function fetchBranchesForFloatingPanel(wsId, pids) {
    const datalist = document.getElementById('taskplugin-merge-list');
    if (!datalist) return;
    datalist.innerHTML = '';

    if (!wsId || !pids.length) return;

    const ws = workspacesData.find(w => (w.id || w._id) === wsId);
    const companyId = ws?.company_id || ws?.companyId;
    if (!companyId) return;

    const seen = new Set();
    // 内置预设
    for (const b of ['develop', 'main']) {
      seen.add(b);
      datalist.innerHTML += `<option value="${b}">`;
    }

    for (const pid of pids.slice(0, 3)) {
      const proj = projectsData.find(p => String(p.id || p._id) === String(pid));
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
      const repoUrl = repos[0];
      if (!repoUrl) continue;

      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'getBranches',
          baseUrl: apiCfg.baseUrl,
          token: apiCfg.token,
          companyId: String(companyId),
          projectId: pid,
          repoUrl: repoUrl,
        });
        if (resp.success && Array.isArray(resp.data?.branches)) {
          for (const b of resp.data.branches) {
            const name = typeof b === 'string' ? b : (b.name || b.branch_name || '');
            if (name && !seen.has(name)) {
              seen.add(name);
              // 标注来源 repo
              const shortRepo = extractRepoLabel(repoUrl);
              const label = shortRepo ? `${name}  [${shortRepo}]` : name;
              datalist.innerHTML += `<option value="${name}">${esc(label)}</option>`;
            }
          }
        }
      } catch (_) { /* 分支获取失败不影响主流程 */ }
    }
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

  function populateFloatingReleasePresets() {
    const sel = document.getElementById('taskplugin-merge-preset');
    if (!sel) return;
    // 移除旧的单个 release option
    const oldOption = sel.querySelector('option[value="release"]');
    if (oldOption) oldOption.remove();
    sel.querySelectorAll('option[value^="release:"]').forEach(o => o.remove());
    const today = new Date();
    const dayOfWeek = today.getDay();
    // 若今天已过周四（周五/周六），则从下周开始
    const startWeek = dayOfWeek > 4 ? 1 : 0;
    const labels = dayOfWeek > 4
      ? ['下周四', '下下周四', '下下下周四']
      : ['本周四', '下周四', '下下周四'];
    const customOpt = sel.querySelector('option[value="custom"]');
    for (let i = 0; i < 3; i++) {
      const ymd = getThursdayYmd(startWeek + i);
      const opt = document.createElement('option');
      opt.value = `release:${startWeek + i}`;
      opt.textContent = `release / ${ymd} (${labels[i] || `第${startWeek + i + 1}个周四`})`;
      if (customOpt) {
        sel.insertBefore(opt, customOpt);
      } else {
        sel.appendChild(opt);
      }
    }
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
      // 闪烁浮动按钮提醒用户
      btn.style.animation = 'none';
      btn.offsetHeight;
      btn.style.animation = 'taskplugin-pulse 0.3s ease 3';
    }
    if (msg.action === 'setFloatBallEnabled') {
      console.log('[taskChromePlugin] setFloatBallEnabled from popup:', msg.enabled);
      root.style.setProperty('display', msg.enabled ? 'block' : 'none', 'important');
      floatEnabledToggle.checked = msg.enabled;
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
