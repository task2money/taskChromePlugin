# Task Chrome Plugin 🔧

从 Chrome DevTools Network 面板捕获 HTTP 请求并创建任务的浏览器扩展。

## 功能

### 0. 登录认证
- 点击扩展图标 → 输入服务器地址、账号（用户名或邮箱）、访问令牌
- 访问令牌在 task2app **个人资料 → 访问令牌** 中生成（以 `at_` 开头）；登录后自动存储 Session Token，用于后续 API 调用
- 令牌格式不正确时插件会提前提示，无需发起网络请求

### 1. 单请求创建任务
- 打开 DevTools (F12) → 切换到 **TaskPlugin** 面板
- 在 Network 面板中点击选中一个请求 → 点击「刷新选中请求」
- 选择目标工作空间 → 勾选项目 → 编辑标题/描述 → 点击「创建任务」
- 支持捕获 **Canceled**（客户端中止，status=0）请求，列表中显示为 `Canceled`

### 2. 批量错误捕获
- 切换到「批量错误捕获」Tab → 启用自动错误捕获
- 配置要捕获的状态码 (默认 2xx/3xx/4xx/5xx/**Canceled**)
- 浏览网页过程中自动收集错误请求
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
└── lib/
    ├── api.js                     # API 客户端 (REST 封装)
    ├── har-request.js             # HAR 解析纯函数（DevTools + 单测）
    ├── capture-status.js          # 批量捕获状态码匹配
    └── storage.js                 # chrome.storage 封装
├── test/
    ├── har-request.test.js        # node --test 单元测试
    └── capture-status.test.js
├── scripts/hooks/pre-commit       # 暂存源码时跑 npm test
└── package.json                   # npm test
```

## 测试

```bash
cd taskChromePlugin && npm test
```

覆盖：Canceled HAR 条目（无 response）、正常 200、headers 缺失不抛错、harKey 去重、缓冲区截断、`matchStatusCode`、`shouldEnrichHarBody`。

### CI

- 工作流：仓库根 `.github/workflows/task-chrome-plugin-test.yml`（仅 `taskChromePlugin/**` 变更时触发）
- 本地 pre-commit：`taskChromePlugin/scripts/hooks/pre-commit`（暂存 lib/devtools/background/test 时跑 `npm test`）

## API 接口约定

插件默认连接 `http://183.250.1.132:18081`（taskGateway API 网关），可在登录界面修改。注意：`http://183.250.1.132:4000` 为 Vue 前端站点，不代理 `/api` 请求。期望以下 REST 端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/accounts/users/login-with-access-token/` | 登录，body: `{username, access_token}`，返回 `{token, user:{id, companies}}` |
| GET | `/api/user/{userId}/accounts/users/me/` | 获取当前用户及所属公司列表 |
| GET | `/api/tenant/{companyId}/workspaces/` | 获取指定租户的工作空间列表，返回 `[]` 或 `{items: []}` 或 `{data: []}` |
| GET | `/api/tenant/{companyId}/projects/?workspace_id={id}` | 获取项目列表 |
| POST | `/api/tenant/{companyId}/workspace/{workspaceId}/todos/` | 创建单个任务 |

所有需要认证的请求自动携带 `Authorization` 头：session token 为 `Token <token>`，`at_` 访问令牌为 `Bearer <token>`。

## 数据存储

- Token 和配置存储在 `chrome.storage.local`
- 捕获的错误请求最多保留 500 条
- 工作空间/项目选择自动记忆

## 技术栈

- Manifest V3
- Vanilla JavaScript (无框架依赖)
- chrome.devtools.network (HAR API)
- chrome.webRequest (网络拦截)
- chrome.storage.local (持久化)
