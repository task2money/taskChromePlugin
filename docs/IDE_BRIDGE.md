# 本机 IDE 桥（可选）

Alt+Z 把建议发到 Cursor / Claude / Codex 时，扩展会：

1. 把 Markdown 写入剪贴板（必做）
2. **深链打开编辑器（主路径）** — Cursor：`cursor://anysphere.cursor-deeplink/prompt?text=` + `encodeURIComponent(建议正文)`（不拼 `/new`）；Claude：`claude://code/new?q=`；Codex：`codex://new?prompt=`
3. 若已安装本机 Native Host `com.aidevpush.ide_bridge`，再尝试聚焦窗口并粘贴（辅助）

仅保留有官方 prompt 深链的 IDE。深链由 Service Worker `chrome.tabs.create` 触发，依赖本机已安装对应应用并注册协议。未装应用或协议失败时，请在目标编辑器按 Ctrl+V / ⌘V。Host **不会**把建议正文当命令执行。

## 安装（Linux）

1. 在 `chrome://extensions` 打开本扩展，复制 ID。
2. 把 `native-host/ide_bridge.py` 放到固定路径并 `chmod +x`。
3. 复制 `native-host/com.aidevpush.ide_bridge.json`，把 `path` 改成该脚本绝对路径，把 `allowed_origins` 里的 ID 换成真实扩展 ID。
4. 放到 `~/.config/google-chrome/NativeMessagingHosts/com.aidevpush.ide_bridge.json`（Chromium 则为 `~/.config/chromium/NativeMessagingHosts/`）。
5. 确保本机有 `python3`，以及 `xclip`/`wl-copy`（复制）与可选 `wmctrl`/`xdotool`（粘贴）。

macOS：host JSON 放 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`。
