# Privacy Policy — DayDayMoney: Auto Innovate

> 中文版：[隐私政策](./PRIVACY.md)
>
> Applies to the Chrome extension "DayDayMoney: Auto Innovate" (祝你天天赚钱: 自动创新助手).
> Effective date: 2026-11-14. This policy is updated with extension releases; the latest version is this file in the repository.

This policy explains what data the extension reads, where it is used, how long it is kept, and how you can control it.
It describes the extension's own behaviour only. Data handling on the platform server you connect to (default `https://daydaymoney.com`, editable on the sign-in screen) is governed by that platform's terms of service and privacy policy.

## 1. Permissions and their purposes

The permissions declared in `manifest.json` and their purposes (one-to-one with the declaration):

| Permission | Purpose |
|---|---|
| `storage` | Stores the sign-in token, server URL, workspace / project choices, shortcuts, forward target, content prefix, and suggestion cache on this device |
| `alarms` | Periodic badge refresh, suggestion queue, and the on-device-model keepalive heartbeat; no always-on page polling |
| `webRequest` | Fills the DevTools single-request panel and captures 5xx errors in batches by status code; recorded only when you open those features |
| `tabs` | Reads the current tab's URL / title to attach page context and deliver tasks or suggestions to the right tab |
| `webNavigation` | Page navigation / reload events, used to refresh pending entries and page context |
| `sidePanel` | Provides the side panel UI (Page optimization / Create task / Settings / Edge compute) |
| `downloads` | Downloads the zip when a newer Beta build is detected, then opens `chrome://extensions/` for you to load it manually |
| `clipboardWrite` | "Copy and fill all / Copy and fill one" writes suggestions to the clipboard |
| Host permission `<all_urls>` | Injects the content script on any web page for `Alt+X` element picking, `Alt+Z` / `Alt+Shift+Z` suggestions, in-page preview, and anchored suggestion cards |

The extension does **not** request `cookies`, `history`, `bookmarks`, `identity`, or similar permissions. It does not read browser cookies and does not maintain your browsing history.

## 2. Data categories

### 2.1 Stored on this device only (extension storage)

- Sign-in token and server URL (signing out clears the token only; the URL is kept);
- Workspace / project choices, shortcuts, forward target, content prefix, UI language, and other settings;
- Suggestion cache (used to show earlier suggestions for the same URL offline);
- Captured requests (up to 500) and task-creation history;
- On-device-model registration cache and the extension fingerprint;
- The "Locate source (local)" toggle state; locate results are not persisted and expire on reload.

### 2.2 Sent to the platform server you configure

- Sign-in and OAuth2 + PKCE authentication information;
- When creating a task: task fields (title, description, priority, project, workspace, etc.) plus the request / page information you selected;
- When using `Alt+Z` / `Alt+Shift+Z`: the current page's title, URL, visible text, DOM outline (truncated when too long), and the selected prompt id;
- When "attach element screenshot" is checked: the cropped screenshot (uploaded temporarily; a link with an expiry is returned and written into the task description);
- Anonymous trial when signed out: accounted server-side by install fingerprint, IP, and daily quota;
- When using "Sell on-device model": device registration information and the outbound keepalive heartbeat;
- When "Include source location" is checked: only `source file:line` (no source body) is sent with the task description or IDE deeplink.

### 2.3 What the extension does not collect

- No third-party analytics or ad SDKs are embedded, and no data is sold or shared with third parties;
- Content is not sent to Cursor / Claude / Codex unless you click "Send to …" (that action opens the editor via the official deeplink with the prompt prefilled and requires your explicit trigger);
- Page content unrelated to page optimization or task creation is not collected.

### 2.4 Source locating (local)

- Runs only when you click "Locate source" in the `Alt+X` dialog or enable the `Alt+Z` toolbar toggle;
- Reads only the page's already-loaded public scripts / CSS and the source maps the page itself declares; requests omit cookies (`credentials: omit`) and reject loopback / private / link-local / cloud-metadata addresses;
- Never reads form `value`s; source bodies are not uploaded, not written to extension storage, and not logged;
- Only after you check "Include source location" is `source file:line` sent with the task description or IDE deeplink.

## 3. Retention

| Data | Retention |
|---|---|
| Sign-in token | Until you sign out, uninstall the extension, or clear extension data |
| Settings and suggestion cache | Until you change them, clear extension data, or uninstall |
| Captured requests (≤500) and task history | Rolling last 500 entries, clearable in the panel; deleted on uninstall |
| Element screenshots | Served via links with a time-to-live (TTL); the server cleans them up after expiry; the exact TTL is configured by the platform |
| Platform-side task and account data | Governed by the connected platform's terms of service and privacy policy |
| Anonymous-trial accounting | Server-side daily quota accounting for limiting and abuse prevention |

## 4. Your controls

- **Sign out / clear at any time**: signing out in the side panel Settings clears the token only; clearing extension data or uninstalling deletes all local data.
- **Screenshots are optional**: no screenshot is uploaded unless "attach element screenshot" is checked.
- **Forwarding is manual**: forwarding to Cursor / Claude / Codex happens only when you click "Send to …".
- **Request capture can be turned off**: the DevTools panel's request tracking can be disabled at any time, and captured records can be cleared.
- **Node unregistration**: registered "Sell on-device model" nodes can be unregistered from the list, stopping the keepalive.
- **Sensitive content reminder**: before submitting tasks or screenshots, confirm they contain no passwords, keys, or other sensitive information.

## 5. Contact

- Questions and data requests: GitHub [Issues](https://github.com/task2money/taskChromePlugin/issues) or Gitee [Issues](https://gitee.com/ljy-ruandao/task-chrome-plugin/issues);
- Platform account requests: through the support channels of the platform you use (default `https://daydaymoney.com`).

## 6. Changes to this policy

This policy is updated as the extension's capabilities change; changes are recorded in the repository's commit history, and release notes flag any material policy change.
Continuing to use the updated extension means you accept the updated policy.
