/**
 * English user-guide section bodies (locale branch for ADR-0089).
 * Titles use i18n-messages guideT keys; steps listed by section id.
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  'use strict';

  /** @type {Record<string, string[] | (() => string[])>} */
  const STEPS_EN = {
    overview: [
      'Capture DevTools Network requests or pick page elements from the float panel to create tasks aligned with the work panel.',
      'Main entry points: ① extension popup sign-in ② in-page float ball ③ DevTools panel (single request / batch errors).',
      'The popup and DevTools panel headers show the installed version. Unpacked developer-mode installs are marked Beta and checked against the GitHub Release; if a newer build exists, the header shows only the download link and hides the current version number. After you click download and the zip finishes, chrome://extensions/ opens automatically so you can load the just-downloaded Beta package in developer mode. Double-click the version to check again immediately (the one-hour cache is skipped). Up to date or a failed check is shown after the version number.',
    ],
    login: [
      'After opening the popup, the header Log in button and the sign-in form stay collapsed. Click Log in to expand the form → server URL → OAuth in the browser (OAuth2+PKCE). The form opens on sign-in failure, a status-check timeout, or an expired session so the reason is visible.',
      'Server URL is remembered; sign-out clears tokens only.',
      'When signed out, Quick create task shows Sign in beside the title. Click it to start the same OAuth sign-in as the popup, using the saved server URL. After sign-in the button hides and the workspace list loads.',
      'Extension sign-in and web sign-in are separate sessions. If the web account changed and the float workspace errors with “not a member”, sign in again in the popup with the same account.',
      'Login and shortcut changes sync via storage across pages; no cross-tab broadcast. Background tabs skip badge timers and sync when focused.',
      'After sign-in the extension loads your Profile default language (Chinese / English) for this help text. If unset, it keeps the device language. The popup and DevTools panel headers also have a language switch: signed-in changes sync to Profile; signed-out changes stay on this device.',
    ],
    'float-create': [
      'Open any page → click the + floating ball to open Create task in the browser side panel. Click the toolbar extension icon to open or close that side panel; opening it shows Settings. Filling the task description switches to Create task; you can also switch tabs yourself. Panel × closes the side panel; hide the ball from the Settings toggle.',
      'Pick workspace and project (single) → title, description, priority, progress, deliverable, image, agent config (required when image set), due date, etc. Duplicate workspace names show “name · company”. Projects show auto-run allowed or not.',
      'Auto-run follows project policy; requires an installed image when allowed. Git identity required when auto-run is on. Optional “Join auto-schedule queue” when workspace scheduling is enabled. Submitting with auto-run checks that project’s run-hardware stock; if none is available the task is not created and the project name in the message is a link that opens the project details page in a new tab so you can change the hardware. The × on that notice dismisses only the message; closing the panel (header × or ball ×) clears it too.',
      'Owner is required (loaded after workspace; defaults to you). Base branch, collaborators, work branch and merge target (template or custom).',
      'Submit creates the task; success resets the form and collapses the panel. The toast shows the task ID as a link (opens task detail in a new tab) and hides after about 5 seconds; errors stay in the panel footer.',
      'Task descriptions are per-tab and do not sync across pages.',
    ],
    'element-pick': [
      'Shortcut (default Alt+X) enters pick mode (crosshair; hovered element gets a highlight box); Esc or the shortcut again cancels. Ball shows ✕ while picking. Not available in DevTools panel.',
      'Click selects one element → adjustment dialog → append to description.',
      '⌘/Ctrl+click adds/removes multi-select → Enter confirms; Esc clears multi-select first. Same frame only.',
      'Shadow DOM (>>>), iframes, and UA shadow hosts supported.',
      'Optional screenshot uploads to HTTPS URL in description.',
    ],
    'page-optimization-suggest': [
      'Choose the call path under Auto-innovate agent: Direct with my key (not uploaded; set it again after switching browsers; Settings for an OpenAI-compatible Base URL, model, and API Key; works while signed out) or Platform backend (sign-in required). When the browser has a built-in model, Use the browser’s built-in model also appears: page text stays on this device, no API key is required, and it works while signed out. The first run needs Download model in the popup; the shortcut does not start a download. Closing the popup aborts that enable; keep the side panel Built-in model tab open to finish unpacking. After about three minutes without ready, status returns to not enabled so you can click Download model again. Refresh status clears a stuck enabling line. If enable is still running, Alt+Z waits and shows elapsed seconds; if it already failed, it says not enabled. The side panel Built-in model tab includes a clickable chrome://on-device-internals link that opens in a new tab for advanced troubleshooting. Change those settings carefully; a wrong parameter can make the on-device model unusable. If you have not chosen, direct is the default. Direct mode can store several key groups on this device and switch the active one from the dropdown. Leaving the popup to copy the next field keeps unsaved text on this device, and it is still there when you reopen; it replaces the active key only after you save. Test connection sends one short request with the fields currently filled in and does not write the saved key. Keys stay on this device. After sign-in, a workspace dropdown appears under Platform backend and stays hidden while signed out. The chosen workspace is the default for Alt+Z and Alt+Shift+Z when using the platform backend. Popup heading shows Alt+Shift+Z. Idle market in the heading opens https://www.aidevpush.com/friend-links/#idle-market in a new tab. Settings sits next to the Saved keys dropdown to add or edit a group.',
      'Popup Prompt skills: click Settings. Saved skills: choose a category first (Accessibility / Conversion / Performance / SEO / Custom), then pick a skill in that category. Use New to add your own skill — there is no system-vs-custom step. Only the auto-innovate skill is preloaded even while signed out (read-only, selected by default; or choose “Do not apply”). Titles on their own line with Manage opening the workspace prompt-skills page; sync/edit/delete below. Catalog (system) skills are read-only for tenants—no Delete, body locked. While signed out the status line is a Prompt market link that opens /en/prompt-shares/ in a new tab (Chinese UI uses /prompt-shares/). Skills stay on this device until sign-in. After sign-in the popup overlays the live catalog body for the same id and can sync a workspace. If the service worker is briefly unreachable, a stored token still counts as signed in. Appended on direct agent calls and on the built-in model when it still fits; otherwise the skill is left out and the popup says so. API keys stay on this device.',
      'Collects visible text and DOM outline; suggestion card title/summary/detail follow the popup language switch (Chinese / English); preview edits stay in the page’s existing language. Cards are anchored without full-screen mask. Float create panel stays closed while loading.',
      'Fill all/one into float description (append only); the suggestion-bar drag handle is titled “Schedule tasks overnight for lower-priced machines and agent resources”; drag it so it does not cover the page bottom; double-click resets it to bottom center; float opens only after fill buttons; no auto task creation; cancel preview undoes changes.',
      'Dynamic SPAs may lose preview after re-render; re-run Alt+Z if rebinding fails.',
      'Timeouts / LLM errors show data-traceId and a copyable `traceId:` line for Loki (~75s client poll); use Retry.',
      'If agent resources missing, configure under tenant or personal settings.',
    ],
    'page-optimization-suggest-region': [
      'After local agent settings (may be signed out), or after sign-in and choosing a workspace in the dropdown under Platform backend for the cloud path, Alt+Shift+Z enters pick mode; float panel collapses.',
      'Hover highlights elements; click generates suggestions for that subtree (same flow as Alt+Z).',
      'Hovering a suggestion card highlights its region.',
      '⌘/Ctrl+click multi-select → Enter; Esc clears selection or exits. Retry remembers pick scope.',
      'Fill buttons open float panel; drag the suggestion-bar handle, double-click to reset; no auto create.',
    ],
    'devtools-single': [
      'F12 → DevTools → extension panel → Single request tab.',
      'Ensure Network has traffic; filter/sort the list and pick one row to fill description with method, URL, status, headers/bodies.',
      'New requests appear live; Refresh reloads from background; Clear list clears panel cache only.',
      'Workspace, project, progress, priority, owner, branches, create task. Auto-run/image/queue rules match float panel.',
      'Agent config required when image set. Element pick uses float/shortcut only.',
      'Success clears fields then shows message; failure keeps inputs.',
      'Priority high(0)/medium(1)/low(2). Canceled requests shown as Canceled.',
    ],
    'devtools-batch': [
      'Batch errors tab → enable capture and status filters (incl. Canceled).',
      'Collect while browsing; counts focus on HTTP 5xx.',
      'Set batch target fields → Batch create. History/errors tabs for review and retry.',
    ],
    'builtin-edge-sell': [
      'Sign in to the extension first. Register and keep the tunnel alive under the On-device model side-panel tab; Settings does not show the sell block.',
      'On install the extension derives a plugin fingerprint from this browser (same browser can recompute it after reinstall). After sign-in, if local registration was wiped, it restores your sell-project node from the platform and resumes keepalive.',
      'Create a sell project in Account → Sell on-device model, then pick it from the Sell project dropdown in the On-device model tab (no need to type the project ID). Optionally add a device label, then Register this browser to the project.',
      'After registration the extension keeps an outbound keepalive to the platform (no public IP) so traffic can reach this browser’s built-in model.',
      'While registered, the tab shows Current registration, Call activity (in flight / dispatched / succeeded / failed), the plugin fingerprint, and Unregister. The Account sell-project page shows the same call activity and fingerprint per node and can unregister a node.',
    ],
    'popup-extras': [
      'Tracking toggle keeps requests across refresh. Float ball toggle at top. Pin to toolbar below it only shows whether Chrome has pinned the icon; the extension cannot turn that on. If it is not pinned, the in-page panel shows the hint once; Got it hides it for good. Click ! next to a section title for help. Auto-innovate agent heading shows Alt+Shift+Z; in direct mode the dropdown switches saved on-device key groups; Settings sits next to the Saved keys dropdown to add or edit a group. Idle market in the heading opens https://www.aidevpush.com/friend-links/#idle-market in a new tab. Unsaved fields stay on this device if the popup closes. Under Prompt skills click Settings: “Do not apply a skill” radio, title-row Manage opens the workspace prompt-skills page, New, custom-row Edit/Delete (Delete confirms; catalog skills read-only, no Delete). Panel × does not hide ball.',
      'Request preview in popup; full create via DevTools or float.',
      'The float panel header has a compact language select (Chinese / English); it shares aidevpush.locale with the popup and DevTools panel, and syncs to your profile preference when signed in.',
      'Descriptions are per-tab.',
      'Element pick is current page only.',
    ],
  };

  function keyboardShortcutStepsEn(combo) {
    const pick = combo || 'Alt+X';
    return [
      `${pick}: toggle element picker on any page.`,
      'Alt+Z: page optimization suggestions. Local agent settings work without sign-in; cloud fallback and create-task need sign-in. Pick a workspace under Platform backend in the popup, or in the float panel.',
      'Alt+Shift+Z: pick element then suggest for subtree.',
      'Customize picker shortcut in popup (Ctrl/Alt/Command required).',
      'F12: DevTools extension panel.',
      'Esc: cancel picker or region mode.',
      '⌘/Ctrl+click: multi-select in picker/region modes.',
      'Enter: confirm multi-select.',
      'Shortcuts not working? In-page fallback + check chrome://extensions/shortcuts.',
    ];
  }

  STEPS_EN['keyboard-shortcuts'] = keyboardShortcutStepsEn;

  global.UserGuideEnSections = { STEPS_EN };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { STEPS_EN };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
}
