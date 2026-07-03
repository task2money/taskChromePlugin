/**
 * Content Script — 页内浮窗快速创建任务
 * 注入到所有页面，在右下角显示浮动按钮
 * 支持元素选择器模式 — 类似 DevTools 的元素选取功能
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
          <button id="taskplugin-picker-btn" class="taskplugin-picker-btn" title="元素选择器 — 点击后选择页面元素">🎯</button>
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
          <label>目标元素 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 🎯 选择器选取</span></label>
          <div id="taskplugin-target-element" class="taskplugin-target-display">
            <span class="taskplugin-target-placeholder">点击上方 🎯 按钮选取页面元素</span>
          </div>
        </div>
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
          <input class="taskplugin-input" id="taskplugin-work-branch" placeholder="如: fix/20260703_username_aidev\${taskId}_fix-502">
        </div>
        <div class="taskplugin-form-group">
          <label>合并目标模板 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 选择模板自动填充</span></label>
          <select class="taskplugin-select" id="taskplugin-merge-preset">
            <option value="develop">develop</option>
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
  const pickerBtn = document.getElementById('taskplugin-picker-btn');
  const targetDisplay = document.getElementById('taskplugin-target-element');
  const titleInput = document.getElementById('taskplugin-title');
  const descInput = document.getElementById('taskplugin-desc');

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
  const DRAG_THRESHOLD = 4;

  // ---- Element Picker State ----
  const PICKER_IDLE = 'idle';
  const PICKER_ACTIVE = 'active';
  let pickerState = PICKER_IDLE;
  let pickerHighlightEl = null;   // 高亮覆盖层
  let pickerTooltipEl = null;     // 提示标签
  let pickerCurrentTarget = null; // 当前悬停的元素
  let selectedElementData = null; // 选中的元素数据

  // ---- Init ----
  (async function init() {
    populateFloatingReleasePresets();

    const floatCfg = await loadFloatBallConfigFromStorage();
    console.log('[taskChromePlugin] floatBall enabled:', floatCfg.enabled);
    if (!floatCfg.enabled) {
      root.style.setProperty('display', 'none', 'important');
    }
    floatEnabledToggle.checked = floatCfg.enabled;

    await restoreFloatBallPosition();

    const urlEl = document.getElementById('taskplugin-page-url');
    urlEl.textContent = `📍 ${window.location.href}`;

    await checkLoginStatus();
    if (isLoggedIn) {
      await loadWorkspaces();
    }

    setupDrag();
    setupElementPicker();

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
      await checkLoginStatus();
      if (isLoggedIn && workspacesData.length === 0) {
        await loadWorkspaces();
      }
    }
  });

  // ================================================================
  //  元素选择器 (Element Picker) — 类似 DevTools 元素选择
  // ================================================================

  function setupElementPicker() {
    // 点击 🎯 按钮 → 进入选择模式
    pickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pickerState === PICKER_ACTIVE) {
        cancelElementPicker();
        return;
      }
      startElementPicker();
    });
  }

  /**
   * 进入元素选择模式
   * - 隐藏面板
   * - 创建高亮覆盖层 + 提示标签
   * - 绑定全局鼠标/键盘事件
   */
  function startElementPicker() {
    if (pickerState === PICKER_ACTIVE) return;
    pickerState = PICKER_ACTIVE;

    // 隐藏面板
    panel.classList.remove('taskplugin-open');
    btn.classList.remove('taskplugin-active');
    isOpen = false;

    // 高亮按钮表示正在选择
    pickerBtn.classList.add('taskplugin-picker-active');

    // 创建高亮覆盖层
    pickerHighlightEl = document.createElement('div');
    pickerHighlightEl.id = 'taskplugin-picker-highlight';
    document.body.appendChild(pickerHighlightEl);

    // 创建浮动提示标签 (显示元素标签名)
    pickerTooltipEl = document.createElement('div');
    pickerTooltipEl.id = 'taskplugin-picker-tooltip';
    document.body.appendChild(pickerTooltipEl);

    // 创建顶部横幅提示
    const banner = document.createElement('div');
    banner.id = 'taskplugin-picker-banner';
    banner.innerHTML = `
      <span>🎯 元素选择模式 — 移动鼠标选择页面元素</span>
      <span style="font-size:10px;opacity:0.7">点击选中 · <kbd>Esc</kbd> 取消</span>
    `;
    document.body.appendChild(banner);

    // 页面光标变为十字准星
    document.body.style.cursor = 'crosshair';

    // 阻止页面默认交互
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    // 绑定事件 (capture 阶段，确保优先于页面事件)
    document.addEventListener('mousemove', onPickerMouseMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKeyDown, true);

    console.log('[taskChromePlugin] Element picker started');
  }

  /**
   * 选择模式下的鼠标移动 — 高亮鼠标下方的元素
   */
  function onPickerMouseMove(e) {
    if (pickerState !== PICKER_ACTIVE) return;

    // 忽略插件自身的元素
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    if (el.closest('#taskplugin-float-root') ||
        el.closest('#taskplugin-picker-highlight') ||
        el.closest('#taskplugin-picker-tooltip') ||
        el.closest('#taskplugin-picker-banner')) {
      return;
    }

    if (pickerCurrentTarget === el) return;
    pickerCurrentTarget = el;

    // 更新高亮位置
    const rect = el.getBoundingClientRect();
    pickerHighlightEl.style.left = rect.left + 'px';
    pickerHighlightEl.style.top = rect.top + 'px';
    pickerHighlightEl.style.width = rect.width + 'px';
    pickerHighlightEl.style.height = rect.height + 'px';

    // 更新提示标签
    const tagInfo = getElementTagInfo(el);
    pickerTooltipEl.textContent = tagInfo;
    pickerTooltipEl.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
    pickerTooltipEl.style.top = Math.max(e.clientY - 24, 4) + 'px';
  }

  /**
   * 选择模式下的点击 — 确认选择当前元素
   */
  function onPickerClick(e) {
    if (pickerState !== PICKER_ACTIVE) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = pickerCurrentTarget || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    // 忽略插件自身元素
    if (el.closest('#taskplugin-float-root') ||
        el.closest('#taskplugin-picker-highlight') ||
        el.closest('#taskplugin-picker-tooltip') ||
        el.closest('#taskplugin-picker-banner')) {
      return;
    }

    // 生成元素路径
    const cssSelector = buildCssSelector(el);
    const xpath = buildXPath(el);
    const tagInfo = getElementTagInfo(el);
    const outerHtml = el.outerHTML || el.innerHTML || '';

    selectedElementData = {
      cssSelector,
      xpath,
      tagInfo,
      outerHtml: truncateHtml(outerHtml, 3000),
      innerText: (el.textContent || '').trim().substring(0, 500),
      tagName: el.tagName.toLowerCase(),
    };

    console.log('[taskChromePlugin] Element selected:', selectedElementData);

    // 退出选择模式
    exitElementPicker();

    // 重新打开面板
    panel.classList.add('taskplugin-open');
    btn.classList.add('taskplugin-active');
    isOpen = true;

    // 填写选中元素信息到表单
    fillElementDataToForm();
  }

  /**
   * 键盘事件 — Esc 取消选择
   */
  function onPickerKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelElementPicker();
    }
  }

  /**
   * 取消选择模式（不保存选中结果）
   */
  function cancelElementPicker() {
    exitElementPicker();
    // 重新打开面板
    panel.classList.add('taskplugin-open');
    btn.classList.add('taskplugin-active');
    isOpen = true;
  }

  /**
   * 退出选择模式，清理 DOM 和事件
   */
  function exitElementPicker() {
    pickerState = PICKER_IDLE;
    pickerCurrentTarget = null;

    // 移除高亮和提示
    if (pickerHighlightEl && pickerHighlightEl.parentNode) {
      pickerHighlightEl.parentNode.removeChild(pickerHighlightEl);
    }
    pickerHighlightEl = null;

    if (pickerTooltipEl && pickerTooltipEl.parentNode) {
      pickerTooltipEl.parentNode.removeChild(pickerTooltipEl);
    }
    pickerTooltipEl = null;

    // 移除横幅
    const banner = document.getElementById('taskplugin-picker-banner');
    if (banner) banner.parentNode.removeChild(banner);

    // 恢复页面样式
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';

    // 恢复按钮样式
    pickerBtn.classList.remove('taskplugin-picker-active');

    // 解绑事件
    document.removeEventListener('mousemove', onPickerMouseMove, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKeyDown, true);

    console.log('[taskChromePlugin] Element picker exited');
  }

  /**
   * 将选中元素数据填入表单
   */
  function fillElementDataToForm() {
    if (!selectedElementData) return;

    const d = selectedElementData;

    // 更新目标元素显示
    targetDisplay.innerHTML = `
      <div class="taskplugin-target-info">
        <span class="taskplugin-target-tag">${esc(d.tagName)}</span>
        <span class="taskplugin-target-selector" title="${esc(d.cssSelector)}">${esc(truncateStr(d.cssSelector, 80))}</span>
        <button class="taskplugin-target-clear" id="taskplugin-clear-target" title="清除选中元素">✕</button>
      </div>
      <div class="taskplugin-target-detail">
        <div class="taskplugin-target-copy-row">
          <span class="taskplugin-target-xpath" title="XPath: ${esc(d.xpath)}">XPath: ${esc(truncateStr(d.xpath, 60))}</span>
          <button class="taskplugin-copy-btn" data-copy="css" title="复制 CSS 选择器">📋 CSS</button>
          <button class="taskplugin-copy-btn" data-copy="xpath" title="复制 XPath">📋 XPath</button>
        </div>
      </div>
    `;

    // 绑定清除按钮
    const clearBtn = document.getElementById('taskplugin-clear-target');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => clearSelectedElement());
    }

    // 绑定复制按钮
    targetDisplay.querySelectorAll('.taskplugin-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.copy;
        const text = type === 'xpath' ? d.xpath : d.cssSelector;
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✅';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        }).catch(() => {});
      });
    });

    // 自动生成任务标题
    if (!titleInput.value.trim()) {
      const pathname = window.location.pathname.replace(/\/$/, '') || '/';
      titleInput.value = `[${d.tagName}] ${document.title.substring(0, 60)} — ${pathname}`;
    }

    // 将元素信息追加到描述
    const elementInfo = [
      `---`,
      `**🎯 目标元素**`,
      `- **标签**: \`<${d.tagName}>\``,
      `- **CSS 选择器**: \`${d.cssSelector}\``,
      `- **XPath**: \`${d.xpath}\``,
      `- **文本内容**: ${d.innerText || '(空)'}`,
      ``,
      `**📄 页面信息**`,
      `- **页面地址**: ${window.location.href}`,
      `- **页面标题**: ${document.title}`,
      ``,
      `**📝 元素 HTML**:`,
      `\`\`\`html`,
      `${d.outerHtml}`,
      `\`\`\``,
    ].join('\n');

    const existingDesc = descInput.value.trim();
    descInput.value = existingDesc
      ? existingDesc + '\n\n' + elementInfo
      : elementInfo;
  }

  /**
   * 清除已选中的元素
   */
  function clearSelectedElement() {
    selectedElementData = null;
    targetDisplay.innerHTML = '<span class="taskplugin-target-placeholder">点击上方 🎯 按钮选取页面元素</span>';
  }

  /**
   * 生成元素标签信息字符串
   */
  function getElementTagInfo(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = el.classList.length
      ? '.' + Array.from(el.classList).slice(0, 3).join('.')
      : '';
    const dims = `${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`;
    return `<${tag}${id}${classes}> ${dims}`;
  }

  /**
   * 生成唯一 CSS 选择器
   * 策略: ID > 唯一 class 组合 > nth-child 路径
   */
  function buildCssSelector(el) {
    if (!el || el === document.documentElement) return 'html';
    if (el === document.body) return 'body';

    // 精确 ID 直接返回
    if (el.id && /^[a-zA-Z_][\w-]*$/.test(el.id)) {
      const sel = `#${CSS.escape(el.id)}`;
      if (isUniqueSelector(el, sel)) return sel;
    }

    // 尝试 class 组合
    if (el.classList.length > 0) {
      const classes = Array.from(el.classList)
        .filter(c => c && /^[a-zA-Z_][\w-]*$/.test(c));
      if (classes.length > 0) {
        const sel = el.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
        if (isUniqueSelector(el, sel)) return sel;
      }
    }

    // nth-child 路径回退
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`);
      } else {
        // 有 ID 则直接用
        if (current.id && /^[a-zA-Z_][\w-]*$/.test(current.id)) {
          parts.unshift(`#${CSS.escape(current.id)}`);
          break;
        }
        parts.unshift(tag);
      }
      current = parent;
    }

    if (current === document.body) parts.unshift('body');
    else if (current === document.documentElement) parts.unshift('html');

    const sel = parts.join(' > ');
    return sel;
  }

  /**
   * 检查 CSS 选择器是否唯一匹配
   */
  function isUniqueSelector(el, selector) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === el;
    } catch (_) {
      return false;
    }
  }

  /**
   * 生成 XPath
   */
  function buildXPath(el) {
    if (!el || el === document.documentElement) return '/html';
    if (el === document.body) return '/html/body';

    if (el.id) {
      return `//*[@id="${el.id}"]`;
    }

    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}[${idx}]`);
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }

    return '/' + parts.join('/');
  }

  /**
   * 截断字符串
   */
  function truncateStr(s, maxLen) {
    if (!s) return '';
    return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
  }

  /**
   * 截断 HTML（保留结构完整性）
   */
  function truncateHtml(html, maxLen) {
    if (!html) return '';
    if (html.length <= maxLen) return html;
    // 简单截断 + 省略标记
    const truncated = html.substring(0, maxLen);
    // 尝试在最后一个完整的 > 处截断
    const lastClose = truncated.lastIndexOf('>');
    if (lastClose > maxLen * 0.8) {
      return truncated.substring(0, lastClose + 1) + '\n<!-- ... 截断 ... -->';
    }
    return truncated + '\n<!-- ... 截断 ... -->';
  }

  // ================================================================
  //  登录 / 工作空间 / 项目
  // ================================================================

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

  wsSelect.addEventListener('change', async () => {
    const wsId = wsSelect.value;
    if (!wsId) {
      projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>';
      return;
    }
    await loadProjects(wsId);
  });

  mergePreset.addEventListener('change', () => {
    const preset = mergePreset.value;
    if (!preset || preset === 'custom') return;
    mergeTarget.value = buildMergeBranchName(preset);
  });

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
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
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

      // 构建带源信息的描述
      let fullDesc = desc;
      const sourceInfo = [
        `---`,
        `**来源页面**: ${window.location.href}`,
        `**页面标题**: ${document.title}`,
      ];
      if (selectedElementData) {
        sourceInfo.push(
          `**🎯 目标元素**: \`${selectedElementData.cssSelector}\``,
          `**目标 XPath**: \`${selectedElementData.xpath}\``
        );
      }
      fullDesc = fullDesc + '\n\n' + sourceInfo.join('\n');

      const taskData = {
        title,
        description: fullDesc,
        priority,
        workspaceId: wsId,
        projectIds: pids,
        source: 'chrome-content-script',
        sourceUrl: window.location.href,
        sourceTitle: document.title,
      };

      // 附加元素选择器数据
      if (selectedElementData) {
        taskData.target_element = {
          css_selector: selectedElementData.cssSelector,
          xpath: selectedElementData.xpath,
          tag_name: selectedElementData.tagName,
          inner_text: selectedElementData.innerText,
        };
      }

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
      titleInput.value = '';
      descInput.value = '';
      clearSelectedElement();
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
              const shortRepo = extractRepoLabel(repoUrl);
              const label = shortRepo ? `${name}  [${shortRepo}]` : name;
              datalist.innerHTML += `<option value="${name}">${esc(label)}</option>`;
            }
          }
        }
      } catch (_) { /* ignore */ }
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
    const oldOption = sel.querySelector('option[value="release"]');
    if (oldOption) oldOption.remove();
    sel.querySelectorAll('option[value^="release:"]').forEach(o => o.remove());
    const today = new Date();
    const dayOfWeek = today.getDay();
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
