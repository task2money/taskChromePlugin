# Task Chrome Plugin 🔧

从 Chrome DevTools Network 面板捕获 HTTP 请求并创建任务的浏览器扩展。

**使用说明**：扩展内浮窗 / DevTools「使用说明」Tab / 弹窗均可展开查看；完整文稿见 [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md)。**新增用户可见功能须同步更新说明**（目录规则 [`ai.md`](./ai.md)）。

## 功能

### 0. 登录认证
- 点击扩展图标 → 输入服务器地址、账号（用户名或邮箱）、访问令牌
- 访问令牌在 task2app **个人资料 → 访问令牌** 中生成（以 `at_` 开头）；登录后自动存储 Session Token，用于后续 API 调用
- 令牌格式不正确时插件会提前提示，无需发起网络请求
- **服务器地址会自动保留**：失焦/登录尝试时写入本地；退出登录只清 token，不重置地址

### 0.5 页内浮窗 — 指针选择元素
- 打开任意网页 → 点击右下角悬浮球 → 描述旁「🖱️ 指针选择」
- 再点击页面上的目标元素 → 弹出对话框填写**调整期望**
- **列表 / 兄弟节点**：按住 **Shift** 点击起点，再 **Shift+点击** 同父下的相邻兄弟，一次选中连续区间（悬停预览多元素高亮）；普通点击仍为单选
- 确认后自动把**元素标识、调整期望、页面链接**追加到任务描述（多选含兄弟区间与区间选择器）
- 支持 **open / closed Shadow DOM**（选择器含 `>>>`；closed 会在描述中标注）与 **同源 / 跨域 iframe**（含多层嵌套：经 frame 祖先链累加视口坐标）
- 选中 **原生控件**（video/audio/部分 input 等）时标注 **UA Shadow 内部不可穿透**（浏览器限制，选中宿主）
- 可选勾选「附带元素截图」：裁剪后**上传媒体存储**，描述写入 **https URL**（支持 CDN 基址与 TTL；上传失败会报错）；多选截取区间并集
- DevTools **TaskPlugin** 面板描述旁同样可触发指针选择，结果追加到面板任务描述
- Esc 或再次点击悬浮球可取消选元素模式；弹窗取消不写入描述

### 1. 单请求创建任务
- 打开 DevTools (F12) → 切换到 **TaskPlugin** 面板
- 在 Network 面板中点击选中一个请求 → 点击「刷新选中请求」
- 选择工作空间 → 勾选项目 → 填写与 **工作面板创建任务** 对齐的参数（进度列、交付物、镜像、环境变量参数、截止日期、自动运行、分支策略等）→ 点击「创建任务」
- **环境变量参数为必填**（公司默认 / 工作空间默认 / 个人配置），与 work-panel 一致
- 优先级为 **高(0) / 中(1) / 低(2)**
- 勾选项目后可为**每个仓库单独填写基准分支**（对齐 CreateTaskModal）
- 页内浮窗支持**协作人员多选**
- 批量创建同样暴露交付物 / 镜像 / 环境变量参数 / 截止日期 / 自动运行 / 逐仓基准分支
- 支持捕获 **Canceled**（客户端中止，status=0）请求，列表中显示为 `Canceled`

### 2. 批量错误捕获
- 切换到「批量错误捕获」Tab → 启用自动错误捕获
- 配置要捕获的状态码 (默认 2xx/3xx/4xx/5xx/**Canceled**)
- 浏览网页过程中自动收集请求
- **插件角标示数 / 错误列表 / 批量建任务仅计 HTTP 5xx**（4xx、Canceled、2xx/3xx 可捕获预览，但不计入示数、不进入批量建任务）
- 选择工作空间和项目 → 点击「批量创建任务」

## 安装

1. 打开 Chrome → `chrome://extensions/`
2. 启用右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `taskChromePlugin/` 目录
5. 扩展安装完成！

## 文件结构

```
taskChromePlugin/
├── manifest.json                  # Chrome 扩展配置 (Manifest V3)
├── icons/                         # 扩展图标
├── background/
│   └── service-worker.js          # 后台服务：webRequest 监听 + 消息路由
├── devtools/
│   ├── devtools.html              # DevTools 入口页
│   └── devtools.js                # 创建 DevTools 面板
├── panel/
│   ├── panel.html                 # DevTools 面板 UI
│   ├── panel.js                   # 面板逻辑
│   └── panel.css                  # 面板样式
├── popup/
│   ├── popup.html                 # 登录弹窗 UI
│   ├── popup.js                   # 登录逻辑
│   └── popup.css                  # 弹窗样式
├── content/
│   ├── content.js                 # 页内浮窗（顶层）
│   ├── content.css
│   └── pick-frame.js              # 跨域/子 frame 轻量选元素（all_frames）
├── lib/
    ├── api.js                     # API 客户端 (REST 封装)
    ├── client-public-ip.js        # auto_run 时附带用户公网 IP（查 client-ip）
    ├── create-task-payload.js     # 创建任务 payload（对齐 work-panel）
    ├── element-picker.js          # 指针选元素：快照/描述拼接（纯函数）
    ├── user-guide.js              # 使用说明 UI 渲染 SSOT（浮窗/面板/弹窗）
    ├── har-request.js             # HAR 解析纯函数（DevTools + 单测）
    ├── capture-status.js          # 批量捕获状态码匹配
    └── storage.js                 # chrome.storage 封装
├── docs/USER_GUIDE.md              # 人可读使用说明（与 user-guide.js 同步）
├── ai.md                          # 目录 Companion：新增功能须写使用说明
├── test/
    ├── har-request.test.js        # node --test 单元测试
    ├── capture-status.test.js
    ├── create-task-payload.test.js
    ├── element-picker.test.js     # 元素描述拼接 / 校验 / Shadow pierce
    ├── user-guide.test.js         # 使用说明章节与 USER_GUIDE.md 同步
    ├── storage-base-url.test.js   # 服务器地址持久化 / 登出保留
    ├── api-login.test.js          # 登录无脏 Authorization / storage 不阻塞
    └── login-finalize.test.js     # 登录收尾：广播不阻塞 success
├── e2e/
    ├── playwright.config.js
    └── popup-token-login.playwright.test.js  # Popup 令牌登录 Playwright E2E
├── scripts/hooks/pre-commit       # 暂存源码时跑 npm test；登录链路改动另跑 E2E
└── package.json                   # npm test / test:e2e:popup-login
```

## 测试

```bash
cd taskChromePlugin && npm test
cd taskChromePlugin && npm run test:e2e:popup-login
# 安装 git hook：
bash scripts/hooks/install.sh
```

覆盖：Canceled HAR 条目（无 response）、正常 200、headers 缺失不抛错、harKey 去重、缓冲区截断、`matchStatusCode`、`shouldEnrichHarBody`、**work-panel 对齐的 create-task payload**、**baseUrl 登出后仍保留**、**element-picker（含 closed Shadow / screenshotUrl）**、**令牌登录成功后 UI 进入已登录态（含广播挂起场景）**。

### CI

- 工作流：仓库根 `.github/workflows/task-chrome-plugin-test.yml`（仅 `taskChromePlugin/**` 变更时触发）
- 本地 pre-commit：`bash scripts/hooks/install.sh` 后，暂存 lib/devtools/background/popup/test 时跑 `npm test`；改动登录链路时另跑 `npm run test:e2e:popup-login`

## API 接口约定

插件默认连接 `https://daydaymoney.com`，可在登录界面修改。注意：`http://183.250.1.132:4000` 为本地 Vue 前端站点，不代理 `/api` 请求。期望以下 REST 端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/accounts/users/login-with-access-token/` | 登录，body: `{username, access_token}`，返回 `{token, user:{id, companies}}` |
| GET | `/api/user/{userId}/accounts/users/me/` | 获取当前用户及所属公司列表 |
| GET | `/api/tenant/{companyId}/workspaces/` | 获取指定租户的工作空间列表，返回 `[]` 或 `{items: []}` 或 `{data: []}` |
| GET | `/api/tenant/{companyId}/projects/?workspace_id={id}` | 获取项目列表 |
| POST | `/api/tenant/{companyId}/workspace/{workspaceId}/todos/` | 创建单个任务（字段对齐 work-panel） |
| GET | `/api/tenant/{companyId}/workspaces/{workspaceId}/progress-system/` | 进度列 |
| GET | `/api/tenant/{companyId}/manage-deliverable-system/?workspace_id=` | 交付物类别 |
| GET | `/api/tenant/{companyId}/installed-images/` | 已安装镜像 |
| GET | `/api/personal/feature-params-configs/` | 个人环境变量配置 |
| POST | `/api/accounts/users/profile/plugin-screenshots/` | 上传元素截图（multipart `file`），返回 `{url, expires_at, ttl_days}`；服务端可配 `PLUGIN_SCREENSHOT_PUBLIC_BASE_URL`（CDN）与 `PLUGIN_SCREENSHOT_TTL_DAYS`，清理命令 `cleanup_plugin_screenshots` |

### 创建任务 body 关键字段

与工作面板一致：`title`、`description`、`priority`(0/1/2)、`workspace_id`、`owner`、`assignees`、`progress_column_id`、`deliverable_obj_id`、`container_image_id`、`due_date`、`auto_run`、`feature_params_source`（必填）、`personal_feature_params_config_id`、`branch_strategy`、`projects[{project_id,repo_index,base_branch,target_branch}]`。

纯函数构建器：`lib/create-task-payload.js`（单测见 `test/create-task-payload.test.js`）。

所有需要认证的请求自动携带 `Authorization` 头：session token 为 `Token <token>`，`at_` 访问令牌为 `Bearer <token>`。

## 数据存储

- Token 和配置存储在 `chrome.storage.local`
- **服务器地址**（`baseUrl`）在输入失焦、登录尝试、登录成功时持久化；退出登录保留上次地址
- 捕获的错误请求最多保留 500 条
- 工作空间/项目选择自动记忆

## 技术栈

- Manifest V3
- Vanilla JavaScript (无框架依赖)
- chrome.devtools.network (HAR API)
- chrome.webRequest (网络拦截)
- chrome.storage.local (持久化)
