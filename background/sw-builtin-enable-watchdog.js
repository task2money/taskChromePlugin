/**
 * SW: recover stale builtin enable (F-141). chrome.alarms, not a ticker.
 * Does not add a second onMessage listener.
 */
(function () {
  'use strict';

  const ALARM = (typeof PageAdvisorBuiltinRuntime !== 'undefined'
    && PageAdvisorBuiltinRuntime.ENABLE_WATCHDOG_ALARM)
    ? PageAdvisorBuiltinRuntime.ENABLE_WATCHDOG_ALARM
    : 'builtin-enable-watchdog';

  async function onEnableWatchdog() {
    const Runtime = globalThis.PageAdvisorBuiltinRuntime;
    if (!Runtime || typeof Runtime.recoverIfStale !== 'function') return;
    const rec = await Runtime.recoverIfStale();
    if (rec && rec.stillInFlight && typeof Runtime.scheduleEnableWatchdog === 'function') {
      Runtime.scheduleEnableWatchdog();
    }
  }

  if (chrome && chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === ALARM) {
        onEnableWatchdog();
      }
    });
  }
})();
