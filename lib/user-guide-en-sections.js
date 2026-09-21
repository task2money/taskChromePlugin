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
      'Extension icon → server URL → OAuth login in the browser (OAuth2+PKCE).',
      'Server URL is remembered; sign-out clears tokens only.',
      'When signed out the float panel shows “Not signed in”; sign in from the popup before creating tasks.',
      'Extension sign-in and web sign-in are separate sessions. If the web account changed and the float workspace errors with “not a member”, sign in again in the popup with the same account.',
      'Login and shortcut changes sync via storage across pages; no cross-tab broadcast. Background tabs skip badge timers and sync when focused.',
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
      'Sign in and set the default workspace/project in the popup Alt+Shift+Z block (click ! for shortcut help; float overrides when open), then Alt+Z (rebind in chrome://extensions/shortcuts).',
      'Optionally set OpenAI-compatible Base URL, model, and API Key under Auto-innovate agent in the popup. When all three are set the extension calls the agent directly; otherwise it uses the cloud path with no platform deduction. The key stays on this device.',
      'Popup Prompt skills (tendencies): save multiple local prompts and pick one. It is appended only on direct agent calls; the JSON contract cannot be replaced. Cloud fallback and create-task do not receive skills.',
      'Collects visible text and DOM outline; suggestions show as anchored cards without full-screen mask. Float create panel stays closed while loading.',
      'Fill all/one into float description (append only); float opens only after fill buttons; no auto task creation; cancel preview undoes changes.',
      'Dynamic SPAs may lose preview after re-render; re-run Alt+Z if rebinding fails.',
      'Timeouts / LLM errors show data-traceId and a copyable `traceId:` line for Loki (~75s client poll); use Retry.',
      'If agent resources missing, configure under tenant or personal settings.',
    ],
    'page-optimization-suggest-region': [
      'After sign-in and workspace, Alt+Shift+Z enters pick mode; float panel collapses.',
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
      'Tracking toggle keeps requests across refresh. Float ball toggle at top. Save a local agent API key under Auto-innovate agent. Manage local prompt skills (tendencies) for direct Alt+Z only. Panel × does not hide ball.',
      'Request preview in popup; full create via DevTools or float.',
      'Descriptions are per-tab.',
      'Element pick is current page only.',
    ],
  };

  function keyboardShortcutStepsEn(combo) {
    const pick = combo || 'Alt+X';
    return [
      `${pick}: toggle element picker on any page.`,
      'Alt+Z: page optimization suggestions (configure workspace first).',
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
