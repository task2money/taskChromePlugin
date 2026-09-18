/**
 * Plugin UI message tables (ADR-0089). Chinese keys for applyDom data-i18n values.
 */
(function (global) {
  const zh = {
    extTitle: '云端Coding: 自动创新助手',
    statusLoading: '加载中...',
    showFloatBall: '显示悬浮球',
    floatBallHint:
      '关闭后隐藏页内右下角悬浮球。浮窗顶部「×」只收起面板，不会关掉悬浮球。',
    altZDefaults: 'Alt+Z 默认上下文',
    altZHint:
      '未打开浮窗时，Alt+Z 使用此处的默认工作空间；填入任务描述后也会预选默认项目。',
    defaultWorkspace: '默认工作空间',
    defaultProject: '默认项目',
    pickWorkspaceFirst: '请先选择工作空间',
    checkingLogin: '正在检查登录状态...',
    retry: '重试',
    login: '登录',
    loginHint: '通过网页端授权登录（OAuth2+PKCE）。',
    serverUrl: '服务器地址',
    oauthLogin: 'OAuth 登录',
    expand: '展开',
    shortcuts: '快捷键',
    trackRequests: '跟踪请求（保留刷新前的记录）',
    requestPreview: '请求预览',
    refresh: '刷新',
    clear: '清空',
    noRequests: '暂无捕获的请求。打开网页后错误请求将自动出现在这里。',
    time: '时间',
    status: '状态',
    all: '全部',
    "插件能做什么": "插件能做什么",
    "登录与服务器": "登录与服务器",
    "页内浮窗 — 快速创建任务": "页内浮窗 — 快速创建任务",
    "指针选择页面元素": "指针选择页面元素",
    "页面优化建议（Alt+Z）": "页面优化建议（Alt+Z）",
    "区域元素点选后自动创新（Alt+Shift+Z）": "区域元素点选后自动创新（Alt+Shift+Z）",
    "DevTools — 单请求创建任务": "DevTools — 单请求创建任务",
    "DevTools — 批量错误捕获": "DevTools — 批量错误捕获",
    "扩展弹窗 — 其它开关": "扩展弹窗 — 其它开关",
    "⌨️ 快捷键": "⌨️ 快捷键",
    "快捷键与功能": "快捷键与功能",
    "功能": "功能",
    "使用说明目录": "使用说明目录",
    "快捷键": "快捷键",
  }
  const en = {
    extTitle: 'Cloud Coding: Auto Innovate',
    statusLoading: 'Loading...',
    showFloatBall: 'Show floating ball',
    floatBallHint:
      'When off, hides the in-page floating ball. Panel × only collapses the panel.',
    altZDefaults: 'Alt+Z default context',
    altZHint:
      'When the float panel is closed, Alt+Z uses this default workspace; task fill also preselects the default project.',
    defaultWorkspace: 'Default workspace',
    defaultProject: 'Default project',
    pickWorkspaceFirst: 'Select a workspace first',
    checkingLogin: 'Checking login…',
    retry: 'Retry',
    login: 'Log in',
    loginHint: 'Sign in via the web app (OAuth2+PKCE).',
    serverUrl: 'Server URL',
    oauthLogin: 'OAuth login',
    expand: 'Expand',
    shortcuts: 'Shortcuts',
    trackRequests: 'Track requests (keep records across refresh)',
    requestPreview: 'Request preview',
    refresh: 'Refresh',
    clear: 'Clear',
    noRequests: 'No captured requests yet. Errors will appear after you open pages.',
    time: 'Time',
    status: 'Status',
    all: 'All',
    "插件能做什么": "What the extension can do",
    "登录与服务器": "Login & server",
    "页内浮窗 — 快速创建任务": "In-page float — quick create task",
    "指针选择页面元素": "Pick page elements",
    "页面优化建议（Alt+Z）": "Page optimization (Alt+Z)",
    "区域元素点选后自动创新（Alt+Shift+Z）": "Region auto-innovate (Alt+Shift+Z)",
    "DevTools — 单请求创建任务": "DevTools — create task from one request",
    "DevTools — 批量错误捕获": "DevTools — batch error capture",
    "扩展弹窗 — 其它开关": "Popup — other toggles",
    "⌨️ 快捷键": "⌨️ Shortcuts",
    "快捷键与功能": "Shortcuts and actions",
    "功能": "Action",
    "使用说明目录": "Guide contents",
    "快捷键": "Shortcuts",
  }
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en })
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en }
  }
})(typeof globalThis !== 'undefined' ? globalThis : window)
