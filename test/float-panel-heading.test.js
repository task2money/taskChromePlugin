'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('float panel primary h1 contract', () => {
  it('float-panel-markup uses h1 for taskplugin-float-title', () => {
    const markup = fs.readFileSync(
      path.join(root, 'lib/float-panel-markup.js'),
      'utf8',
    );
    assert.match(markup, /<h1 id="taskplugin-float-title"/);
    assert.doesNotMatch(markup, /<h3 id="taskplugin-float-title"/);
  });

  it('advisor layer syncs float title h1/h2 when advisor opens', () => {
    const layer = fs.readFileSync(
      path.join(root, 'content/float-page-advisor-layer.js'),
      'utf8',
    );
    assert.match(layer, /function syncFloatPanelPrimaryHeading/);
    assert.match(layer, /showPageAdvisorLayer[\s\S]*syncFloatPanelPrimaryHeading/);
    assert.match(layer, /wantTag = advisorOpen \? "h2" : "h1"/);
  });

  it('closePageAdvisorModal restores float h1 via syncFloatPanelPrimaryHeading', () => {
    const advisor = fs.readFileSync(
      path.join(root, 'content/float-page-advisor.js'),
      'utf8',
    );
    assert.match(advisor, /closePageAdvisorModal[\s\S]*syncFloatPanelPrimaryHeading/);
  });
});
