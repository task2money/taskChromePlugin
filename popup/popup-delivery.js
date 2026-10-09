/** 转发目标单选：同步写入本机，并镜像到 chrome.storage，下次打开仍勾选。 */
(function initPopupDeliveryPreference(global) {
  'use strict';

  function deliveryApi() {
    if (global.PageAdvisorDelivery && global.PageAdvisorDelivery.chooseDeliveryPreference) {
      return global.PageAdvisorDelivery;
    }
    if (typeof require === 'function') {
      return require('../lib/page-advisor-delivery.js');
    }
    return null;
  }

  function storageKey(api) {
    return (api && api.STORAGE_KEY) || 'pageAdvisorDeliveryTarget';
  }

  function invokeStorage(storage, method, arg) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function ok(v) {
        if (settled) return;
        settled = true;
        resolve(v);
      }
      function bad(e) {
        if (settled) return;
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
      try {
        var ret = storage[method](arg, function (v) {
          var runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
          var err = runtime && runtime.lastError;
          if (err) bad(new Error(err.message || 'storage_failed'));
          else ok(method === 'get' ? (v || {}) : undefined);
        });
        if (ret && typeof ret.then === 'function') {
          ret.then(function (v) {
            ok(method === 'get' ? (v || {}) : undefined);
          }, bad);
        }
      } catch (e) {
        bad(e);
      }
    });
  }

  function applyChecked(field, target) {
    var nodes = field.querySelectorAll
      ? field.querySelectorAll('input[name="pageAdvisorDeliveryTarget"]')
      : [];
    var matched = false;
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].value === target;
      nodes[i].checked = on;
      if (on) matched = true;
    }
    if (!matched && field.querySelector) {
      var one = field.querySelector('input[name="pageAdvisorDeliveryTarget"][value="' + target + '"]');
      if (one) one.checked = true;
    }
  }

  function bindPageAdvisorDeliveryRadios(opts) {
    var field = opts && opts.field;
    var storage = opts && opts.storage;
    var local = opts && opts.localStore;
    var now = (opts && opts.now) || function () { return Date.now(); };
    var log = (opts && opts.log) || function () {};
    var notify = (opts && opts.notify) || function () {};
    if (!field || !storage || !local) return { ready: Promise.resolve() };

    var generation = 0;

    function readLocal(key) {
      try {
        return { target: local.getItem(key), at: local.getItem(key + 'At') };
      } catch (e) {
        log('delivery preference local read failed', {
          message: e && e.message ? e.message : String(e),
        });
        return { target: '', at: 0 };
      }
    }

    function writeLocal(payload, key) {
      try {
        local.setItem(key, payload[key]);
        local.setItem(key + 'At', String(payload[key + 'At']));
      } catch (e) {
        log('delivery preference local write failed', {
          message: e && e.message ? e.message : String(e),
        });
      }
    }

    function persist(raw) {
      generation += 1;
      var api = deliveryApi();
      var key = storageKey(api);
      var at = now();
      var payload = api
        ? api.preferencePayload(raw, at)
        : { pageAdvisorDeliveryTarget: String(raw || 'task_description'), pageAdvisorDeliveryTargetAt: at };
      writeLocal(payload, key);
      try { notify(payload); } catch (_) { /* 面板关闭时消息可能发不出去 */ }
      log('delivery preference saved', {
        target: payload[key],
        at: payload[key + 'At'],
      });
      applyChecked(field, payload[key]);
      return invokeStorage(storage, 'set', payload).catch(function (e) {
        log('delivery preference storage write failed', {
          message: e && e.message ? e.message : String(e),
        });
      });
    }

    var ready = (async function loadPreference() {
      var gen = generation;
      var api = deliveryApi();
      var key = storageKey(api);
      var bag = {};
      try {
        bag = await invokeStorage(storage, 'get', [key, key + 'At']);
      } catch (e) {
        log('delivery preference storage read failed', {
          message: e && e.message ? e.message : String(e),
        });
        bag = {};
      }
      if (gen !== generation) return;
      var loc = readLocal(key);
      var choice = api
        ? api.chooseDeliveryPreference({
          localTarget: loc.target,
          localAt: loc.at,
          remoteTarget: bag && bag[key],
          remoteAt: bag && bag[key + 'At'],
        })
        : { target: 'task_description', at: 0, source: 'default' };
      if (gen !== generation) return;
      applyChecked(field, choice.target);
      if (choice.source === 'default' || !(choice.at > 0)) return;
      var payload = api.preferencePayload(choice.target, choice.at);
      if (choice.source === 'local') {
        writeLocal(payload, key);
        log('delivery preference restored', { target: choice.target, at: choice.at, source: 'local' });
        await invokeStorage(storage, 'set', payload).catch(function (e) {
          log('delivery preference storage write failed', {
            message: e && e.message ? e.message : String(e),
          });
        });
      } else if (choice.source === 'remote') {
        writeLocal(payload, key);
        log('delivery preference restored', { target: choice.target, at: choice.at, source: 'remote' });
      }
    })();

    field.addEventListener('change', function (ev) {
      var el = ev && ev.target;
      if (!el || el.name !== 'pageAdvisorDeliveryTarget') return;
      // Anti-Replay-OK: ui-only — 覆盖本机送达目标，无写接口
      persist(el.value);
    });

    return { ready: ready, persist: persist };
  }

  function bindContentPrefixInput(opts) {
    var input = opts && opts.input;
    var storage = opts && opts.storage;
    var local = opts && opts.localStore;
    var log = (opts && opts.log) || function () {};
    if (!input || !storage || !local) return { ready: Promise.resolve() };

    var api = deliveryApi();
    var key = (api && api.CONTENT_PREFIX_KEY) || 'pageAdvisorContentPrefix';

    function normalize(raw) {
      return api && api.normalizeContentPrefix
        ? api.normalizeContentPrefix(raw)
        : String(raw || '').trim();
    }

    function write(raw) {
      var value = normalize(raw);
      try {
        local.setItem(key, value);
      } catch (e) {
        log('content prefix local write failed', {
          message: e && e.message ? e.message : String(e),
        });
      }
      log('content prefix saved', { prefixChars: value.length });
      var payload = {};
      payload[key] = value;
      return invokeStorage(storage, 'set', payload).catch(function (e) {
        log('content prefix storage write failed', {
          message: e && e.message ? e.message : String(e),
        });
      });
    }

    var ready = invokeStorage(storage, 'get', [key]).then(function (bag) {
      var remote = bag && Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
      var localVal = '';
      try { localVal = local.getItem(key) || ''; } catch (_) { localVal = ''; }
      if (remote == null) {
        input.value = normalize(localVal);
        if (input.value) return write(input.value);
        return undefined;
      }
      input.value = normalize(remote);
      return undefined;
    }, function (e) {
      log('content prefix storage read failed', {
        message: e && e.message ? e.message : String(e),
      });
      try { input.value = normalize(local.getItem(key) || ''); } catch (_) { input.value = ''; }
    });

    input.addEventListener('input', function () {
      // Anti-Replay-OK: ui-only — 覆盖本机内容前缀，无写接口
      write(input.value);
    });
    input.addEventListener('blur', function () {
      var next = normalize(input.value);
      if (input.value !== next) input.value = next;
      write(next);
    });

    return { ready: ready, write: write };
  }

  function bindFromDocument(doc) {
    var field = doc.getElementById('popupDeliveryTargetField');
    var area = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
    var local = null;
    try { local = global.localStorage; } catch (_) { local = null; }
    if (!field || !area || !local) return;
    bindPageAdvisorDeliveryRadios({
      field: field,
      storage: area,
      localStore: local,
      log: function (msg, detail) {
        console.info('[taskChromePlugin] ' + msg, detail || '');
      },
      notify: function (payload) {
        try {
          if (!chrome.runtime || !chrome.runtime.sendMessage) return;
          chrome.runtime.sendMessage({
            action: 'persistPageAdvisorDeliveryTarget',
            target: payload.pageAdvisorDeliveryTarget,
            at: payload.pageAdvisorDeliveryTargetAt,
          });
        } catch (_) { /* 面板卸载时忽略 */ }
      },
    });
    var prefixInput = doc.getElementById('pageAdvisorContentPrefix');
    if (prefixInput) {
      bindContentPrefixInput({
        input: prefixInput,
        storage: area,
        localStore: local,
        log: function (msg, detail) {
          console.info('[taskChromePlugin] ' + msg, detail || '');
        },
      });
    }
  }

  var api = {
    bindPageAdvisorDeliveryRadios: bindPageAdvisorDeliveryRadios,
    bindContentPrefixInput: bindContentPrefixInput,
  };
  global.PopupDeliveryPreference = api;
  if (typeof document !== 'undefined' && document.getElementById) {
    bindFromDocument(document);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
