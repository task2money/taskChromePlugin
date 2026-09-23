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
    ],
    login: [
      'Click the extension icon → next to “Not signed in” click Log in to expand the form → server URL → OAuth in the browser (OAuth2+PKCE).',
      'Server URL is remembered; sign-out clears tokens only.',
      'When signed out the float panel shows “Not signed in”; sign in from the popup before creating tasks.',
      'Extension sign-in and web sign-in are separate sessions. If the web account changed and the float workspace errors with “not a member”, sign in again in the popup with the same account.',
      'Login and shortcut changes sync via storage across pages; no cross-tab broadcast. Background tabs skip badge timers and sync when focused.',
      'After sign-in the extension loads your Profile default language (Chinese / English) for this help text. If unset, it keeps the device language. The popup and DevTools panel headers also have a language switch: signed-in changes sync to Profile; signed-out changes stay on this device.',
    ],
    'float-create': [
      'Open any page → click the + floating ball. Panel × closes the panel (ball stays); hide the ball from the popup “Show floating ball” toggle.',
      'Pick workspace and project (single) → title, description, priority, progress, deliverable, image, agent config (required when image set), due date, etc. Duplicate workspace names show “name · company”. Projects show auto-run allowed or not.',
      'Auto-run follows project policy; requires an installed image when allowed. Git identity required when auto-run is on. Optional “Join auto-schedule queue” when workspace scheduling is enabled.',
      'Owner is required (loaded after workspace; defaults to you). Base branch, collaborators, work branch and merge target (template or custom).',
      'Submit creates the task; success resets the form and collapses the panel. The toast shows the task ID as a link (opens task detail in a new tab) and hides after about 5 seconds; errors stay in the panel footer.',
      'Task descriptions are per-tab and do not sync across pages.',
    ],
    'element-pick': [
      'Shortcut (default Alt+X) enters pick mode; Esc or the shortcut again cancels. Ball shows ✕ while picking. Not available in DevTools panel.',
      'Click selects one element → adjustment dialog → append to description.',
      '⌘/Ctrl+click adds/removes multi-select → Enter confirms; Esc clears multi-select first. Same frame only.',
      'Shadow DOM (>>>), iframes, and UA shadow hosts supported.',
      'Optional screenshot uploads to HTTPS URL in description.',
    ],
    'page-optimization-suggest': [
      'Choose the call path under Auto-innovate agent: Direct with my key (no platform deduction; Settings for an OpenAI-compatible Base URL, model, and API Key; works while signed out) or Platform backend (sign-in required; 1 auto-innovate use when a suggestion succeeds). If you have not chosen, a complete key defaults to direct; otherwise the platform backend is used. The key stays on this device. Popup heading shows Alt+Shift+Z.',
      'Popup Prompt skills: click Settings. Saved skills: choose a category first (Accessibility / Conversion / Performance / SEO / Custom), then pick a skill in that category. Use New to add your own skill — there is no system-vs-custom step. The five platform-catalog prompts from system-admin prompt-skills are preloaded even while signed out (same bodies as the catalog page; read-only; pick one or “Do not apply”). Titles on their own line with Manage opening the workspace prompt-skills page; sync/edit/delete below. Catalog (system) skills are read-only for tenants—no Delete, body locked. The footer “Signed out: skills stay on this device” means this popup is signed out (website login is a different session)—use Login at the top. After sign-in the popup overlays live catalog bodies for the same ids and can sync a workspace. If the service worker is briefly unreachable, a stored token still counts as signed in. Appended only on direct agent calls. API keys stay on this device.',
      'Collects visible text and DOM outline; suggestion card title/summary/detail follow the popup language switch (Chinese / English); preview edits stay in the page’s existing language. Cards are anchored without full-screen mask. Float create panel stays closed while loading.',
      'Fill all/one into float description (append only); float opens only after fill buttons; no auto task creation; cancel preview undoes changes.',
      'Dynamic SPAs may lose preview after re-render; re-run Alt+Z if rebinding fails.',
      'Timeouts / LLM errors show data-traceId and a copyable `traceId:` line for Loki (~75s client poll); use Retry.',
      'If agent resources missing, configure under tenant or personal settings.',
    ],
    'page-optimization-suggest-region': [
      'After local agent settings (may be signed out) or after sign-in for cloud fallback, Alt+Shift+Z enters pick mode; float panel collapses.',
      'Hover highlights elements; click generates suggestions for that subtree (same flow as Alt+Z).',
      'Hovering a suggestion card highlights its region.',
      '⌘/Ctrl+click multi-select → Enter; Esc clears selection or exits. Retry remembers pick scope.',
      'Fill buttons open float panel; no auto create.',
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
    'popup-extras': [
      'Tracking toggle keeps requests across refresh. Float ball toggle at top. Click ! next to a section title for help. Auto-innovate agent heading shows Alt+Shift+Z; click Settings to save a local API key. Under Prompt skills click Settings: “Do not apply a skill” radio, title-row Manage opens the workspace prompt-skills page, New, custom-row Edit/Delete (Delete confirms; catalog skills read-only, no Delete). Panel × does not hide ball.',
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
      'Alt+Z: page optimization suggestions. Local agent settings work without sign-in; cloud fallback and create-task need sign-in.',
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
