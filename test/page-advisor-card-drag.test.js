'use strict';

/**
 * Pin-state helpers for Alt+E advisor card drag (content script globals via vm).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('page-advisor-card-drag pin state', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = {
      Map,
      Math,
      Number,
      String,
      document: {
        removeEventListener() {},
        addEventListener() {},
      },
      DRAG_THRESHOLD: 4,
      console,
    };
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-drag.js'),
      'utf8',
    );
    vm.runInNewContext(
      `${src}\n;`
      + 'this.getPageAdvisorPin = getPageAdvisorPin;'
      + 'this.setPageAdvisorPin = setPageAdvisorPin;'
      + 'this.clearPageAdvisorPin = clearPageAdvisorPin;'
      + 'this.clearAllPageAdvisorPins = clearAllPageAdvisorPins;'
      + 'this.isPageAdvisorPinned = isPageAdvisorPinned;',
      sandbox,
    );
  });

  it('set/get/clear pin by sid', () => {
    sandbox.setPageAdvisorPin('s1', 12.6, 40.2);
    const pin = sandbox.getPageAdvisorPin('s1');
    assert.equal(pin.top, 13);
    assert.equal(pin.left, 40);
    assert.equal(sandbox.isPageAdvisorPinned('s1'), true);
    sandbox.clearPageAdvisorPin('s1');
    assert.equal(sandbox.getPageAdvisorPin('s1'), null);
    assert.equal(sandbox.isPageAdvisorPinned('s1'), false);
  });

  it('clearAll removes every pin', () => {
    sandbox.setPageAdvisorPin('a', 1, 2);
    sandbox.setPageAdvisorPin('b', 3, 4);
    sandbox.clearAllPageAdvisorPins();
    assert.equal(sandbox.isPageAdvisorPinned('a'), false);
    assert.equal(sandbox.isPageAdvisorPinned('b'), false);
  });
});

describe('page-advisor card layout wiring', () => {
  it('manifest injects layout + drag before float-page-advisor', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'),
    );
    const js = manifest.content_scripts[0].js;
    const layout = js.indexOf('lib/page-advisor-card-layout.js');
    const drag = js.indexOf('content/float-page-advisor-drag.js');
    const ui = js.indexOf('content/float-page-advisor.js');
    assert.ok(layout >= 0);
    assert.ok(drag >= 0);
    assert.ok(ui >= 0);
    assert.ok(layout < ui);
    assert.ok(drag < ui);
  });

  it('float-page-advisor uses PageAdvisorCardLayout and drag handle markup', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    assert.match(ui, /PageAdvisorCardLayout/);
    assert.match(ui, /taskplugin-page-advisor-drag-handle/);
    assert.match(ui, /bindPageAdvisorCardDrags/);
    assert.match(ui, /clearAllPageAdvisorPins/);
  });
});
