'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PopupWf = require('../popup/popup-waterfall.js');

function fakeDoc(host) {
  const attrs = host ? { 'data-taskplugin-host': host } : {};
  const nodes = {};
  const section = {
    appendChild(el) { nodes[el.id] = el; return el; },
  };
  nodes.pageAdvisorLlmSection = section;
  return {
    documentElement: {
      getAttribute(name) { return attrs[name] || null; },
    },
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        id: '',
        className: '',
        hidden: false,
        innerHTML: '',
        setAttribute(name, value) { this[name] = value; },
      };
      return el;
    },
  };
}

describe('popup page-advisor waterfall host', () => {
  it('mounts only when host is sidepanel', () => {
    assert.equal(PopupWf.mount(fakeDoc('')), null);
    assert.equal(PopupWf.mount(fakeDoc('popup')), null);
    const el = PopupWf.mount(fakeDoc('sidepanel'));
    assert.ok(el);
    assert.equal(el.id, 'pageAdvisorWaterfall');
    assert.equal(el.hidden, false);
  });

  it('popup.html keeps waterfall after llm status and loads scripts', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
    const statusAt = html.indexOf('id="popupLlmStatus"');
    const wfAt = html.indexOf('id="pageAdvisorWaterfall"');
    assert.ok(statusAt >= 0 && wfAt > statusAt);
    assert.match(html, /popup-waterfall\.js/);
    assert.match(html, /page-advisor-timing\.js/);
    assert.match(html, /data-i18n="paWfHelp"/);
  });
});
