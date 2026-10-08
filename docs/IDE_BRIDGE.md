# IDE 深链分批送达

Alt+Z / Alt+X 把建议发到 Cursor / Claude / Codex 时，扩展会：

1. 把完整 Markdown 写入剪贴板。
2. 经官方深链打开编辑器并预填。Cursor：`cursor://anysphere.cursor-deeplink/prompt?text=` + `encodeURIComponent(正文)`（不拼 `/new`）；Claude：`claude://code/new?q=`；Codex：`codex://new?prompt=`。
3. 单条深链编码后不超过 7500 字符（Cursor 官方上限约 8000，留余量）。中文经百分号编码大约膨胀到 9 倍，多条建议会超过上限。
4. 超过上限时**不截断、不写本机文件**。按每条建议（`- **元素**:` 起头）装进若干批，每批都带共用说明、`批次 k/n` 和来源页，并各开一条深链。请在编辑器里把同一轮的各批一起应用。
5. 某一条建议自己仍超过上限时，按行再按字符切开，字符不丢。没有建议边界的自由文本同样按能放进一条深链的长度切开。

深链由 Service Worker `chrome.tabs.create` 触发，依赖本机已安装对应应用并注册协议。未装应用时，完整正文仍在剪贴板，请在目标编辑器按 Ctrl+V / ⌘V。

一次点击会按批次连续打开多条协议链接，中间留短暂间隔，避免系统只收下最后一条。
