# 浏览器 MCP 本地 dev 登录：SW 会话 Cookie 注入手册

> OPT-20260808-022 交付物。解决「Chrome 拒绝 localhost 域 Set-Cookie → 浏览器 MCP 无法在
> localhost:4000 完成登录」问题。2026-08-08 全链路验证通过。

## 1. 问题根因

Chrome（含 HeadlessChrome/149）**拒绝接受 Set-Cookie 响应头**作用于 localhost 域：

- `Domain=localhost` 显式域 → 静默丢弃（cookie store 为空）
- `cookieDomainRewrite: ''` 剥离 Domain 为 host-only → **仍然丢弃**
- DevTools Network 可见 Set-Cookie 头，但 cookie store 始终为空

已验证的可行写入通道（二选一）：

- `chrome.cookies.set`（扩展 SW 上下文，HttpOnly/strict 全属性支持）
- `document.cookie`（页面上下文，非 HttpOnly）

因此登录 cookie 必须由扩展 SW 注入，不能依赖服务端 Set-Cookie。

## 2. 前置

1. 启动 dev taskAuth 实例（独立端口 8005，host-only cookie 域）：

   ```bash
   cd /tmp/ram-work/taskAuth && bash run.sh dev
   # 停止：pkill -f taskAuth-dev
   ```

   - `SSO_COOKIE_DOMAIN=localhost` → Set-Cookie `Domain=.localhost`
   - `TASKAUTH_PORT=8005`（env 优先于 yaml，见 config.go env-precedence + 回归测试）
   - `exec -a taskAuth-dev`：argv[0] 改名，避免 `run.sh stop` 误杀 dev 实例

2. 启动 Vite dev（localhost:4000），proxy 已将 `/api/auth/`、`/api/accounts/` 分流到 8005，
   其余 `/api` 走网关 18081（forward-auth 用同一 sso cookie 校验）。

3. 浏览器 MCP 已安装本扩展（sw-2: `knfffehmbkgkgablkedpniahimobgkgn`）。
   扩展 MV3 scope 决定：SW 可直连 `http://127.0.0.1:8005`，不能 fetch `http://localhost:4000`。

## 3. 注入流程（一次性）

在 chrome-devtools MCP 中，对扩展 Service Worker 执行（`serviceWorkerId` 见 `list_pages`）：

```js
async () => {
  const EMAIL = 'ljy124818167@qq.com';          // 替换为 e2e/目标账号
  const PASSWORD = '***';                        // 替换
  const DEV_AUTH = 'http://127.0.0.1:8005';
  // 1) 登录拿 token + user.id
  const login = await fetch(DEV_AUTH + '/api/auth/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const b = await login.json();
  // 2) activate-session 激活会话（Token 头前缀，与前端 apiFetch 一致）
  const act = await fetch(DEV_AUTH + '/api/accounts/users/activate-session/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + b.token },
    body: JSON.stringify({ user_id: b.user.id }),
  });
  // 3) 注入 userId + token 到 localhost（HttpOnly + Strict，同源 /api 自动携带）
  const c1 = await chrome.cookies.set({
    url: 'http://localhost:4000/', name: 'userId', value: b.user.id,
    path: '/', httpOnly: true, sameSite: 'strict', secure: false,
  });
  const c2 = await chrome.cookies.set({
    url: 'http://localhost:4000/', name: 'token', value: b.token,
    path: '/', httpOnly: true, sameSite: 'strict', secure: false,
  });
  return { login: login.status, activate: act.status,
           set: c1 && c2 ? 'ok' : 'fail',
           cookies: (await chrome.cookies.getAll({ domain: 'localhost' }))
                    .map(c => c.name + (c.httpOnly ? '(H)' : '(h)')) };
}
```

预期返回：`{"login":200,"activate":200,"set":"ok","cookies":["userId(H)","token(H)"]}`

## 4. 验证（页面上下文，localhost:4000）

刷新 work-panel 后（无 Authorization 头、仅 cookie）：

```js
async () => {
  const t = '873472655125147648'; // tenant_id
  const me = await fetch(`/api/accounts/users/me/?tenant_id=${t}`, { credentials: 'include' });
  const ws = await fetch(`/tenant/${t}/api/projects/workspaces/?tenant_id=${t}`, { credentials: 'include' });
  return { me: me.status, ws: ws.status };
}
```

预期：`{"me":200,"ws":200}`。若 ws 返回 400 `tenant_id required` 属参数缺失而非认证失败
（forward-auth 已放行）；401/403 才是认证问题。

## 5. 清理

- 停 dev taskAuth：`pkill -f taskAuth-dev`（生产实例 8003 不受影响）
- 清除注入 cookie：`chrome.cookies.remove({url:'http://localhost:4000/',name:'userId'})`（token 同理）
