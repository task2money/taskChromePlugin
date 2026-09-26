"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PageAdvisorA11y = require("../lib/page-advisor-a11y.js");
const PageAdvisorFill = require("../lib/page-advisor-fill.js");

const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("PageAdvisorA11y.copy", () => {
  it("exposes toolbar, safety hint, and action labels/titles", () => {
    assert.equal(PageAdvisorA11y.toolbarLabel, "优化建议操作栏");
    assert.equal(
      PageAdvisorA11y.safetyHint,
      "填入仅写入任务描述，不会自动创建任务",
    );
    assert.equal(PageAdvisorA11y.cancelLabel, "关闭预览并撤销改动");
    assert.match(PageAdvisorA11y.cancelTitle, /还原本次预览已应用的所有改动/);
    assert.equal(PageAdvisorA11y.fillOneLabel, "逐条填入任务描述");
    assert.match(PageAdvisorA11y.fillOneTitle, /任务描述输入框/);
    assert.equal(PageAdvisorA11y.fillAllLabel, "全部填入任务描述");
    assert.match(PageAdvisorA11y.fillAllTitle, /追加/);
    assert.doesNotMatch(PageAdvisorA11y.fillAllTitle, /覆盖/);
    assert.equal(PageAdvisorA11y.heading, "工作面板优化建议");
    assert.match(PageAdvisorA11y.documentTitle, /工作面板 · 优化建议/);
  });

  it("formatReadyStatus announces full completion copy", () => {
    assert.equal(PageAdvisorA11y.formatReadyStatus(8), "已生成 8 条优化建议");
    assert.equal(PageAdvisorA11y.formatReadyStatus(0), "未返回可用建议");
    assert.equal(PageAdvisorA11y.formatReadyStatus(-1), "未返回可用建议");
  });

  it("fill-all title matches append (not overwrite) fill semantics", () => {
    const next = PageAdvisorFill.appendSuggestionsToDescription(
      "已有内容",
      [{ id: "1", title: "A", summary: "s" }],
      ["1"],
      "https://example.com",
    );
    assert.match(next, /^已有内容\n\n## 页面优化建议/);
    assert.match(PageAdvisorA11y.fillAllTitle, /追加|保留已有/);
  });
});

describe("page-advisor UI a11y wiring (source contracts)", () => {
  it("status live region uses aria-atomic and completion path", () => {
    const ui = read("content/float-page-advisor.js");
    const layer = read("content/float-page-advisor-layer.js");
    const a11y = read("lib/page-advisor-a11y.js");
    assert.match(a11y + ui, /aria-atomic="true"/);
    assert.match(a11y + ui, /role="status"/);
    assert.match(ui, /formatReadyStatus|已生成/);
    assert.match(layer + ui, /document\.title|PageAdvisorA11y\.documentTitle/);
    assert.match(
      a11y + layer + ui,
      /工作面板优化建议|PageAdvisorA11y\.heading/,
    );
  });

  it("toolbar has accessible name and describedby safety hint", () => {
    const ui = read("content/float-page-advisor.js");
    const a11y = read("lib/page-advisor-a11y.js");
    const src = ui + a11y;
    assert.match(
      src,
      /aria-label="\$\{e\(PAGE_ADVISOR_A11Y\.toolbarLabel\)\}"|paToolbarLabel|aria-label="优化建议操作栏"/,
    );
    assert.match(src, /aria-describedby="taskplugin-page-advisor-hint"/);
    assert.match(src, /填入仅写入任务描述，不会自动创建任务/);
    assert.match(src, /taskplugin-page-advisor-safety-hint/);
    assert.match(src, /taskplugin-page-advisor-toolbar-drag/);
    assert.match(src, /paToolbarDragHandle/);
    assert.match(src, /设置夜间任务调度，享用低价机器及智能体资源/);
    const html = PageAdvisorA11y.buildLayerHtml((s) => s);
    const dragAt = html.indexOf("taskplugin-page-advisor-toolbar-drag");
    const hintAt = html.indexOf('id="taskplugin-page-advisor-hint"');
    assert.ok(dragAt >= 0 && hintAt > dragAt);
    assert.ok(html.indexOf("设置夜间任务调度，享用低价机器及智能体资源") < hintAt);
  });

  it("action buttons use explicit labels and titles", () => {
    const src =
      read("content/float-page-advisor.js") + read("lib/page-advisor-a11y.js");
    assert.match(src, /关闭预览并撤销改动/);
    assert.match(src, /逐条填入任务描述/);
    assert.match(src, /全部填入任务描述/);
    assert.match(src, /还原本次预览已应用的所有改动/);
    assert.match(src, /需手动提交/);
    assert.match(src, /追加写入任务描述/);
  });

  it("manifest injects page-advisor-a11y before advisor UI", () => {
    const manifest = JSON.parse(read("manifest.json"));
    const js = manifest.content_scripts[0].js;
    const a11y = js.indexOf("lib/page-advisor-a11y.js");
    const ui = js.indexOf("content/float-page-advisor.js");
    assert.ok(a11y >= 0, "page-advisor-a11y.js listed");
    assert.ok(ui > a11y, "a11y lib before float-page-advisor.js");
  });
});

describe("project radiogroup a11y", () => {
  it("float markup exposes radiogroup with 项目（单选） label", () => {
    const markup = read("lib/float-panel-markup.js");
    assert.match(markup, /role="radiogroup"/);
    assert.match(markup, /aria-label="项目（单选）"|panelProjectSingleAria/);
    assert.match(markup, /aria-required="true"/);
  });

  it("panel project containers are radiogroups with required label", () => {
    const html = read("panel/panel.html");
    assert.match(html, /id="singleProjects"[^>]*role="radiogroup"/);
    assert.match(html, /id="batchProjects"[^>]*role="radiogroup"/);
    assert.match(html, /aria-label="项目（单选）"/);
    assert.match(html, /aria-required="true"/);
  });
});
