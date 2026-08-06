/**
 * Task Chrome Plugin — 面向用户的使用说明（UI 渲染 SSOT）
 *
 * 人可读长文见 docs/USER_GUIDE.md；二者须同步维护（见目录 ai.md）。
 * content / panel / popup 共用；无 Chrome API 硬依赖。
 */

(function initUserGuide(global) {
  'use strict';

  /** @typedef {'popup'|'float'|'panel'} GuideSurface */

  /**
   * @type {Array<{
   *   id: string,
   *   title: string,
   *   surfaces: GuideSurface[],
   *   steps: string[]
   * }>}
   */
  const SECTIONS = [
    {
      id: 'overview',
      title: '插件能做什么',
      surfaces: ['popup', 'float', 'panel'],
      steps: [
        '从 DevTools Network / 页内浮窗捕获请求或页面元素，快速创建对齐工作面板的任务。',
        '主要入口：① 扩展弹窗登录 ② 页内悬浮球快速建任务 ③ DevTools「TaskPlugin」面板（单请求 / 批量错误）。',
      ],
    },
    {
      id: 'login',
      title: '登录与服务器',
      surfaces: ['popup', 'float', 'panel'],
      steps: [
        '点击扩展图标 → 填写服务器地址、账号（用户名或邮箱）、访问令牌（task2app「个人资料 → 访问令牌」，以 at_ 开头）。',
        '服务器地址会自动记住；退出登录只清除令牌，不重置地址。',
        '未登录时浮窗会显示「未登录」；请先在弹窗完成登录后再创建任务。',
      ],
    },
    {
      id: 'float-create',
      title: '页内浮窗 — 快速创建任务',
      surfaces: ['float', 'popup', 'panel'],
      steps: [
        '打开任意网页 → 点击右下角悬浮球「+」打开浮窗（可在弹窗或浮窗内关闭「显示悬浮球」）。',
        '选择工作空间与项目（可多选）→ 填写标题、描述、优先级、进度、交付物、镜像、环境变量参数（必填）、截止日期等。',
        '可勾选「是否自动运行」、填写逐仓基准分支、协作人员、工作分支与合并目标分支（支持模板 / 手写）。',
        '点击「创建任务」提交；成功后表单恢复为本次打开时的状态并自动收起浮窗，页面右下角 toast 提示成功；失败时结果仍显示在浮窗底部。',
      ],
    },
    {
      id: 'element-pick',
      title: '指针选择页面元素',
      surfaces: ['float', 'panel'],
      steps: [
        '在描述旁点击「🖱️ 指针选择」进入选元素模式（十字光标）；Esc 或再次点击可取消。',
        '普通点击：选中单个元素 → 填写调整期望 → 确认后追加到任务描述。',
        '多选不关联元素：⌘/Ctrl+点击累加（再点取消）→ Enter 确认；Esc 先清空多选，再按退出。多选仅限同一 frame。',
        '支持 Shadow DOM（选择器含 >>>）、同源/跨域 iframe、原生控件 UA Shadow（内部不可穿透时选中宿主）。',
        '可选「附带元素截图」：裁剪后上传，描述写入 https URL（多选时截取全部选中元素包围盒并集）。',
      ],
    },
    {
      id: 'devtools-single',
      title: 'DevTools — 单请求创建任务',
      surfaces: ['panel', 'popup'],
      steps: [
        '按 F12 打开开发者工具 → 切换到「TaskPlugin」面板 →「单请求创建」Tab。',
        '确保 Network 面板已打开并产生请求；在本面板请求列表中搜索/筛选后点选一条。',
        '新请求实时自动出现；若列表与 Network 面板不同步，点「🔄 刷新列表」会从后台重新拉取最新请求。',
        '选择工作空间、项目、进度列、优先级、负责人 → 填写分支策略与任务信息 →「创建任务」。',
        '描述可用「指针选择」从页面追加元素调整块；环境变量参数为必填。',
        '优先级：高(0) / 中(1) / 低(2)。支持 Canceled（客户端中止）请求显示为 Canceled。',
      ],
    },
    {
      id: 'devtools-batch',
      title: 'DevTools — 批量错误捕获',
      surfaces: ['panel', 'popup'],
      steps: [
        '切换到「批量错误捕获」→ 启用自动请求捕获，并勾选要捕获的状态码（含 Canceled）。',
        '浏览网页过程中自动收集；角标示数 / 错误列表 / 批量建任务仅计 HTTP 5xx（其它码可预览但不计入示数）。',
        '选择批量创建目标（工作空间、项目、进度、交付物、镜像、环境变量、截止日期、自动运行、分支等）→「批量创建任务」。',
        '「错误列表」「历史记录」Tab 可查看已捕获错误与创建历史，支持清空与失败重试。',
      ],
    },
    {
      id: 'popup-extras',
      title: '扩展弹窗 — 其它开关',
      surfaces: ['popup'],
      steps: [
        '登录后可开关「显示悬浮球」「跟踪请求（保留刷新前的记录）」。',
        '请求预览可展开查看近期捕获；详细建任务请用 DevTools TaskPlugin 或页内浮窗。',
      ],
    },
    {
      id: 'keyboard-shortcuts',
      title: '⌨️ 快捷键',
      surfaces: ['popup', 'float', 'panel'],
      steps: keyboardShortcutSteps,
    },
  ];

  // 快捷键组合串状态：''（未知，展示平台默认文案）| 'Ctrl+Shift+X' 等规范组合
  let shortcutCombo = '';

  /** 默认组合（平台分派：mac ⌘+Shift+X / 其他 Ctrl+Shift+X；无 navigator 环境回退 Ctrl） */
  function defaultShortcutCombo() {
    try {
      const plat = String(navigator?.platform || navigator?.userAgent || '').toLowerCase();
      return plat.includes('mac') ? 'Command+Shift+X' : 'Ctrl+Shift+X';
    } catch {
      return 'Ctrl+Shift+X';
    }
  }

  /**
   * 快捷键步骤按用户当前自定义的组合动态插值（OPT-20260806-017 演进）：
   * 未设置/未知时展示平台默认（mac ⌘+Shift+X / 其他 Ctrl+Shift+X）；已自定义时展示实际组合，
   * 与浏览器级键位（chrome.commands.update）及页内兜底监听的严格匹配保持一致。
   */
  function keyboardShortcutSteps() {
    const combo = shortcutCombo || defaultShortcutCombo();
    return [
      `${combo}：切换指针选择模式，在任意页面选取元素加入任务描述。`,
      '在扩展弹窗「快捷键」中可自定义唤起组合（须包含 Ctrl/Alt/Command，可选 Shift）；修改后浏览器级键位与页内兜底监听同步生效。',
      'F12：打开 Chrome DevTools → 切换到 TaskPlugin 面板创建任务或批量捕获错误。',
      'Esc：取消指针选择；多选状态下先清空多选，再按退出指针模式；关闭调整弹窗。',
      '⌘/Ctrl + 点击：指针选择模式下累加多选不关联元素（再点取消），仅限同一 frame。',
      'Enter：指针选择模式下确认多选，打开调整弹窗填写期望。',
      '快捷键无效？插件内置页内兜底监听，浏览器级注册失败时在页面内按所选组合仍可用；也可到 chrome://extensions/shortcuts 检查键位绑定（默认 Mac ⌘+Shift+X / 其他 Ctrl+Shift+X，可能被其他扩展占用）。',
    ];
  }

  function setShortcutMode(mode) {
    // 旧版 'cmd'/'ctrl' 迁移为组合串；合法组合串直接采用；其他值（含空）回退默认文案
    shortcutCombo = mode === 'cmd' ? 'Command+Shift+X'
      : mode === 'ctrl' ? 'Ctrl+Shift+X'
      : (typeof mode === 'string' && mode.includes('+') ? mode : '');
  }

  /** 从 storage 加载用户自定义的快捷键组合（渲染前调用；无 chrome API 环境安全返回 ''） */
  async function loadShortcutModeFromStorage() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return '';
      const res = await chrome.storage.local.get({ elementPickerShortcut: '' });
      setShortcutMode(res && res.elementPickerShortcut);
    } catch (_) { /* 保持默认文案 */ }
    return shortcutCombo;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {GuideSurface} surface
   */
  function getSectionsForSurface(surface) {
    return SECTIONS.filter((s) => s.surfaces.includes(surface));
  }

  function renderSectionHtml(section) {
    // steps 可为函数（动态插值当前快捷键模式）
    const steps = typeof section.steps === 'function' ? section.steps() : section.steps || [];
    const items = steps
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join('');
    return (
      `<details class="tcp-guide-section" data-guide-id="${escapeHtml(section.id)}">`
      + `<summary class="tcp-guide-summary">${escapeHtml(section.title)}</summary>`
      + `<ol class="tcp-guide-steps">${items}</ol>`
      + `</details>`
    );
  }

  /**
   * 可折叠总览（浮窗 / 弹窗用）
   * @param {{ surface: GuideSurface, open?: boolean, title?: string }} opts
   */
  function renderCollapsibleHtml(opts) {
    const surface = opts?.surface || 'float';
    const openAttr = opts?.open ? ' open' : '';
    const title = opts?.title || '📖 使用说明';
    const body = getSectionsForSurface(surface).map(renderSectionHtml).join('');
    return (
      `<details class="tcp-guide-root" data-guide-surface="${escapeHtml(surface)}"${openAttr}>`
      + `<summary class="tcp-guide-root-summary">${escapeHtml(title)}</summary>`
      + `<div class="tcp-guide-body">${body}</div>`
      + `</details>`
    );
  }

  /**
   * 完整说明页（DevTools Tab）
   * @param {{ surface?: GuideSurface, title?: string }} opts
   */
  function renderFullGuideHtml(opts) {
    const surface = opts?.surface || 'panel';
    const title = opts?.title || 'TaskPlugin 使用说明';
    const body = getSectionsForSurface(surface).map(renderSectionHtml).join('');
    return (
      `<div class="tcp-guide-full" data-guide-surface="${escapeHtml(surface)}">`
      + `<p class="tcp-guide-lead">${escapeHtml(title)} — 展开各节查看步骤。新增功能须同步更新 docs/USER_GUIDE.md 与本模块。</p>`
      + body
      + `</div>`
    );
  }

  function mount(el, html) {
    if (!el) return false;
    el.innerHTML = html;
    return true;
  }

  function listSectionIds() {
    return SECTIONS.map((s) => s.id);
  }

  const UserGuide = {
    VERSION: '1.0.0',
    SECTIONS,
    getSectionsForSurface,
    renderCollapsibleHtml,
    renderFullGuideHtml,
    renderSectionHtml,
    mount,
    listSectionIds,
    escapeHtml,
    setShortcutMode,
    loadShortcutModeFromStorage,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserGuide;
  }
  if (global) {
    global.UserGuide = UserGuide;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
