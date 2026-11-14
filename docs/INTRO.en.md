# DayDayMoney: Auto Innovate — Product Introduction

> A user-facing primer. For step-by-step details, read the [User Guide](./USER_GUIDE.md).
>
> 中文版：[产品介绍](./INTRO.md)
>
> This document describes the features of extension 1.9.12; your installed version's UI and capabilities may differ slightly.

## Understand it in 30 seconds

**DayDayMoney: Auto Innovate** is a Chrome extension. It turns "the problem you see on a web page" directly into "a task a cloud agent can execute":

1. Click the spot that needs work on the page (or ask it to read the whole page);
2. The extension automatically captures the element, selector, page URL, visible copy — everything you would otherwise copy and paste;
3. Add one sentence about "how it should change", then create a task in the side panel / DevTools, or send the suggestions straight to Cursor / Claude / Codex.

It does not make decisions for you and never changes live code behind your back — it expresses the requirement clearly and files the task into the right project; execution and delivery stay with the platform agents and your confirmation.

## What problems it solves

| Before | With the extension |
|---|---|
| Screenshot, copy the copy, hand-write "this button is ugly", then switch to the platform to find a project and create a task | Pick the element in-page; the element identity, page URL, and adjustment expectation are written into the task description automatically |
| You feel "this page looks off" but cannot say exactly what to change | `Alt+Z` generates whole-page optimization suggestions; `Alt+Shift+Z` targets only the picked region |
| The content is fine, but search indexing / ranking is not | Choose "System default · SEO" to generate an On-Page SEO plan: title, keywords, image alt text, internal links, Schema, and more |
| 5xx errors appear in production and you note them one by one before creating tasks | Batch error capture by status code, then create tasks in one batch |
| Copy-pasting back and forth between the editor and the platform | Set Forward target to Cursor / Claude / Codex; "Send to …" deep-links with the prompt prefilled |

## Who it is for

- **Product managers / operations**: turn web-experience issues into engineering-executable tasks without writing technical descriptions.
- **QA / engineers**: reproduce requests and create tasks directly; collect production 5xx errors in batches.
- **Site owners / indie developers**: get whole-page or region-level optimization suggestions quickly.
- **Team leads**: connect "raising a requirement" and "running tasks" with workspaces, projects, auto-run, and run-hardware stock.

## Core capabilities

### 1. Point and fix: `Alt+X` element picker

- On any web page, press `Alt+X` to enter pick mode; the hovered element gets a highlight box.
- **Click** to select a single element → fill in the "adjustment expectation"; press `Esc` or the shortcut again to cancel.
- **Multi-select unconnected elements**: hold `⌘/Ctrl` and click to add (click again to remove), press `Enter` to confirm; `Esc` clears the multi-selection first, then exits on the next press.
- Supports Shadow DOM and same-origin / cross-origin iframes; for native controls (video / audio, etc.) the browser does not allow reaching inside, so the extension selects the host element and notes it in the description.
- Optional "attach element screenshot": captures the selected region and uploads it temporarily; the description gets an https link with an expiry. With a multi-selection, it captures the union bounding box of all picked elements.
- After confirmation, the element identity, adjustment expectation, and page URL are appended to the task description automatically; you can also send this content to Cursor / Claude / Codex.

### 2. Page optimization suggestions: `Alt+Z` / `Alt+Shift+Z`

- **`Alt+Z`**: collects the visible copy and DOM outline of the current page and generates whole-page optimization suggestions.
- **`Alt+Shift+Z`**: pick page elements first (or multi-select), then generate suggestions for that scope only.
- When signed in, generation runs on the platform backend and the workspace decides which custom prompts are merged; when signed out, the anonymous daily trial is used.
- Suggestions appear as **anchored floating cards**: hovering a card highlights the corresponding page region; checking it applies a temporary preview on the page, unchecking restores it immediately.
- The bottom bar's "Copy and fill all / Copy and fill one" writes suggestions into the side panel's task description — **fill only, no automatic task creation**; you still review and submit.
- If Forward target is Cursor / Claude / Codex, suggestions are not auto-sent after generation; click "Send to …" on the bottom bar to open the editor via the official deeplink with the prompt prefilled.

### 3. Agent optimization directions and SEO plans

Page optimization suggestions are not a fixed rule set: the **platform prompt catalog** decides the direction. When signed in, the catalog merges the selected workspace's custom prompts; when signed out, the public catalog is used with the platform's anonymous trial.

| Direction | Problems it addresses |
|---|---|
| System default · SEO | On-Page SEO: title / H1, meta description, heading hierarchy, keyword layout, image alt text, internal-link anchor text, Schema, crawlability |
| System default · SEO deep audit (jev-seo) | The platform runs a deterministic audit first, then rewrites the body based on the findings; marked "· Audit" in the dropdown |
| System default · Conversion | Optimizes value proposition, CTA, social proof, trust signals, and form friction while staying SEO-friendly |
| System default · Accessibility | WCAG 2.1 AA: keyboard operation, contrast, ARIA, forms, motion, and zoom |
| System default · Performance | LCP, CLS, INP, resource loading, main-thread blocking, CSS / JS size |
| System default Auto Innovate | Visual hierarchy, information architecture, interaction micro-innovation, and mobile experience |
| Workspace custom | Maintained in SaaS "Auto-innovate prompt management"; merged into that workspace's catalog |

> The catalog is served by the backend; the extension only shows titles, directions, and the "Audit" mark — prompt bodies never enter the extension. The selected prompt is sent with the generation request; `Alt+Z` and `Alt+Shift+Z` share the same one.

#### How an SEO plan is generated

1. In the side panel's Settings, pick the workspace; then at the top of Page optimization choose "System default · SEO" — or the deep-audit SEO entry marked "· Audit" when needed.
2. Open the target page and press `Alt+Z` for a whole-page plan; or press `Alt+Shift+Z` to pick a region and optimize only that region.
3. A regular SEO prompt's suggestions usually include: **SEO status diagnosis** (issue + risk level), **P0/P1/P2 priorities**, **multiple options** (e.g. a minimal safe change, a semantic enhancement, a content expansion experiment), the recommended copy and structure, an **engineering change list**, HTML / JSON-LD snippets, verification methods, and risk notes. Deep-audit mode focuses on the platform's audit findings and the rewritten body. Exact fields vary slightly by prompt version.
4. Hover cards to compare with page regions; check them for a temporary preview, then "Copy and fill all" writes them into the task description, or "Send to …" forwards them to Cursor / Claude / Codex.
5. Submit the task from the side panel's Create task or the DevTools panel for the agent to implement. The extension only generates plans and **never changes the live page automatically**.

> SEO plans follow white-hat constraints: no keyword stuffing, no hidden text, no fabricated customers / data / credentials. Changing titles, Schema, or internal links may cause short-term ranking fluctuations. Ship in small steps following the verification and A/B testing steps in the plan. **SEO advice is not a ranking guarantee**; the final result depends on the page's real content, site quality, and search-engine rules.

> While generating suggestions the extension collects the current page's visible text, DOM outline, URL, and title; pages behind login walls, anti-bot protections, or pure client-side rendering may not be collectable — refresh the page, use region picking, or make the target content visible first.

### 4. Side panel: quick task creation

- Click the toolbar icon to open / close the side panel. Tabs: **Page optimization / Create task / Settings / Edge compute**.
- Task fields align with the web work panel: workspace, project (single), title, description, priority, progress column, deliverable, image, agent resource config, owner, collaborators, due date, branch strategy, and more.
- When same-named workspaces come from different companies, options show "name · company" to avoid mistakes.
- **Auto-run** requires all of: the project allows auto-run + an installed image is selected + a Git commit identity is set + the project's run hardware has stock. When the workspace has auto-scheduling enabled, you can also check "Join auto-schedule queue".
- After creation, a toast in the lower-right corner shows the task ID; click it to open the task detail in a new tab.

### 5. DevTools: single request and batch errors

- Press `F12` → switch to the "DayDayMoney: Auto Innovate" panel.
- **Single-request creation**: the request list supports search, filtering by method / status / type, and sorting by column header; picking one row writes request headers / body / response headers / response body into the task description automatically. Canceled (client-aborted) requests are supported.
- **Batch error capture**: once enabled, requests are collected by status code; the badge count, error list, and batch task creation **only count HTTP 5xx** (4xx, Canceled, 2xx / 3xx can be previewed but are not counted or included in batch creation).
- **Error list / history**: review captured errors and creation history; failed tasks can be retried.

### 6. (Optional) Sell on-device model

- If you have a computer that supports Chrome's built-in model (Prompt API), you can sell its compute as "edge compute" to the platform: the platform forwards requests to your browser and the on-device model performs inference.
- Before use, create a sell project in Account → Sell on-device model, then pick the project and register this device in the side panel's Edge compute tab. The extension keeps an outbound keepalive to the platform — **no public IP required**.
- Capability depends on the device and Chrome version; when the Chinese language pack is unavailable, the extension automatically falls back to probing and downloading the English model pack.
- The extension fingerprint derives from browser characteristics; clearing extension data or switching browsers / profiles makes the platform treat it as a new node. Old nodes can be unregistered from the list.

## Get started in 5 minutes

### Step 1: Install

1. Download the latest version from [GitHub Releases](https://github.com/task2money/taskChromePlugin/releases) (or [Gitee Releases](https://gitee.com/ljy-ruandao/task-chrome-plugin/releases)); the file is named like `task-chrome-plugin-v<version>.zip`.
2. Unzip it into a fixed directory (future updates overwrite this directory).
3. Open `chrome://extensions/` and turn on Developer mode in the upper-right corner.
4. Click "Load unpacked" and choose the unzipped directory.
5. You can also load straight from the source directory: choose the `taskChromePlugin/` folder.

> When loaded in developer mode, the side panel's Settings and the DevTools panel header are marked **Beta**, and check the latest release against GitHub. Double-click the version number to re-check immediately.

### Step 2: Sign in

1. Click the toolbar extension icon to open the side panel (Page optimization opens by default); click the Settings tab at the top, then "Log in" in the header.
2. Confirm the server URL (default `https://daydaymoney.com`, editable).
3. Click "OAuth login" and complete authorization in the opened web page (OAuth2 + PKCE).
4. After sign-in, the workspace list loads automatically.

> Extension sign-in and web sign-in are **two separate sessions**. If the web page switched accounts, sign in again in the extension with the same account.

### Step 3: Choose a workspace

In the side panel's Settings, choose the workspace for the Auto-innovate agent. It decides which custom prompts `Alt+Z` merges, and affects the default project suggestions land in.

### Step 4: Start using it

- **Point out a problem**: press `Alt+X`, pick the element → fill in the adjustment expectation → choose the Forward target.
- **Want suggestions**: choose a prompt at the top of Page optimization (e.g. "System default · SEO") → press `Alt+Z` (whole page) or `Alt+Shift+Z` (pick a region first) → check suggestions → fill them into the task description.
- **Investigate requests**: press `F12` to open DevTools → DayDayMoney: Auto Innovate → single-request creation / batch error capture.
- **Create tasks**: always from the side panel's Create task or the DevTools panel; after filling suggestions you still submit manually.

## Entry points and shortcuts at a glance

| Entry | Location | Main uses |
|---|---|---|
| Side panel | Click the toolbar icon to open / close | Page optimization / Create task / Settings / Edge compute |
| Side panel Settings | Settings tab at the top (the icon opens on Page optimization; switch over) | Sign-in, forward target, workspace, shortcuts, request preview, user guide, version check |
| DevTools panel | `F12` → DayDayMoney: Auto Innovate | Single-request creation / batch error capture / error list / history / user guide |
| In-page | Any web page | `Alt+X` element picking, `Alt+Z` / `Alt+Shift+Z` suggestion generation |

| Shortcut | Action |
|---|---|
| `Alt+X` | Enter / exit pointer pick mode |
| `Alt+Z` | Generate optimization suggestions for the current page |
| `Alt+Shift+Z` | Pick a region / element first, then generate suggestions |
| `⌘/Ctrl + click` | Multi-select unconnected elements (click again to remove) |
| `Enter` | Confirm a multi-selection |
| `Esc` | Cancel selection; in multi-select, clear first then exit |
| `F12` | Open Chrome DevTools |

> `Alt+X` can be rebound in the side panel Settings → Shortcuts; `Alt+Z` / `Alt+Shift+Z` can be rebound at `chrome://extensions/shortcuts`. The side panel Settings and the DevTools panel support a Chinese / English switch.

## Data and privacy

### Stored only on this device

- Sign-in token, server URL;
- Workspace / project choices, shortcuts, forward target, content prefix;
- Captured requests (up to 500) and task history;
- On-device-model registration cache and extension fingerprint.

### Sent to the platform server you configure

- Sign-in credentials;
- When creating a task: task fields plus the request / page information you selected;
- When using `Alt+Z` / `Alt+Shift+Z`: the current page's title, URL, visible text, and DOM outline (truncated when too long);
- When "attach element screenshot" is checked: the cropped screenshot (uploaded temporarily; the returned link has an expiry);
- Anonymous trial when signed out: accounted server-side by install fingerprint, IP, and daily quota.

### The extension will not

- Request the `cookies` permission or read browser cookies;
- Maintain your browsing history; network capture is used only for the request panel and batch error capture;
- Embed third-party analytics or ad SDKs;
- Send content to Cursor / Claude / Codex unless you click "Send to …".

> Before submitting tasks or screenshots, confirm they contain no passwords, keys, or other sensitive information. Uninstalling the extension or clearing its data deletes what is stored on this device.
>
> For the full data scope, retention, and user controls, see the [Privacy Policy](./PRIVACY.en.md) ([中文](./PRIVACY.md)).

## Install, update, and versions

- **Requirements**: desktop Chrome (Manifest V3). The optional on-device model capability additionally requires a device and Chrome version that support the built-in Prompt API.
- **Download**: [GitHub Releases](https://github.com/task2money/taskChromePlugin/releases) / [Gitee Releases](https://gitee.com/ljy-ruandao/task-chrome-plugin/releases).
- **Update**: download the new version and unzip over the old directory → click "Reload" for the extension at `chrome://extensions/` → refresh any open pages once.
- **Version check**: the side panel Settings and DevTools panel header show the current version; developer-mode installs are marked Beta; double-click the version to re-check immediately (one-hour cache by default).
- **Install from source / development**: see [README](../README.md).

## FAQ

**Q1: `Alt+X` / `Alt+Z` does nothing?**
First confirm the extension is enabled; check `chrome://extensions/shortcuts` for a keybinding conflict with another extension. The extension also has an in-page key fallback; if it still fails, reload the extension and refresh the page.

**Q2: It says "the extension script has not entered this page" or "cannot capture this page"?**
After reloading the extension in developer mode, pages opened before the reload do not get the script automatically; refresh the page once.

**Q3: The workspace says "you are not a member of this company"?**
Extension sign-in and web sign-in are two separate sessions. Sign in again in the side panel Settings with the same account as the web page.

**Q4: Cannot check "auto-run"?**
All of these are required: the project allows auto-run, an installed image is selected, and a Git commit identity is set. When the workspace has auto-scheduling enabled, you can also choose to join the queue.

**Q5: It says there is no hardware stock?**
The project's current run hardware has no available stock. Follow the prompt to open the project detail page, change the hardware, and try again.

**Q6: Suggestion generation failed with a `traceId` in the message?**
Send the full error text (including the `traceId`) to platform support, or look it up by `trace_id` in Grafana / Loki. The client polls for about 75 seconds; you can click Retry.

**Q7: The on-device model stays unavailable, or the Chinese pack reports unavailable?**
First confirm the Chrome version and device support the built-in model; the extension automatically switches to the English pack when the Chinese one is unavailable. If it still fails, investigate at `chrome://on-device-internals` (an advanced troubleshooting page; change settings carefully).

**Q8: Why are there extra entries in the node list?**
The extension fingerprint derives from browser characteristics; clearing extension data or switching browsers / profiles is treated as a new node. Nodes you no longer use can be unregistered from the list.

**Q9: Can an SEO plan guarantee ranking?**
No. The extension generates On-Page optimization advice and an executable change list; it does not promise rankings. The final result depends on the page's real content, site quality, competition, and search-engine rules. Ship in small steps following the plan's verification methods, and watch indexing and ranking changes with A/B tests or the search console.

## Further reading

- [User Guide (full manual)](./USER_GUIDE.md)
- [Forward to Cursor / Claude / Codex](./IDE_BRIDGE.md)
- [Developer docs / file structure / API conventions](../README.md)
- License: [AGPL-3.0-only](../LICENSE)

---

**In one sentence**: say clearly "this needs to change here" — the platform agents handle the rest.
