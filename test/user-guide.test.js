'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UserGuide = require('../lib/user-guide.js');

const REQUIRED_IDS = [
  'overview',
  'login',
  'float-create',
  'element-pick',
  'page-optimization-suggest',
  'page-optimization-suggest-region',
  'devtools-single',
  'devtools-batch',
  'popup-extras',
  'keyboard-shortcuts',
];

describe('UserGuide sections', () => {
  it('page-optimization-suggest-region 说明元素点选（非拖拽框）', () => {
    const section = UserGuide.SECTIONS.find((s) => s.id === 'page-optimization-suggest-region');
    assert.ok(section, 'missing region section');
    const blob = (section.steps || []).join('\n');
    assert.match(blob, /单击|点击.*元素/);
    assert.match(blob, /悬停|Alt\+X/);
    assert.doesNotMatch(blob, /拖拽画出矩形|拖拽框选/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /单击.*元素|点击.*元素/);
    assert.doesNotMatch(md, /拖拽画出矩形/);
  });

  it('exposes required section ids', () => {
    const ids = UserGuide.listSectionIds();
    for (const id of REQUIRED_IDS) {
      assert.ok(ids.includes(id), `missing section id: ${id}`);
    }
  });

  it('filters sections by surface', () => {
    const floatIds = UserGuide.getSectionsForSurface('float').map((s) => s.id);
    assert.deepEqual(floatIds, [], '浮窗不再挂载使用说明，float surface 应无章节');

    const popupIds = UserGuide.getSectionsForSurface('popup').map((s) => s.id);
    assert.ok(popupIds.includes('popup-extras'));
    assert.ok(popupIds.includes('login'));
    assert.ok(popupIds.includes('element-pick'), '指针选择说明须出现在 Popup');
    assert.ok(popupIds.includes('float-create'));

    const panelIds = UserGuide.getSectionsForSurface('panel').map((s) => s.id);
    assert.ok(panelIds.includes('devtools-single'));
    assert.ok(!panelIds.includes('element-pick'), '指针选择说明不得出现在 DevTools 面板');
  });

  it('renderCollapsibleHtml includes surface and section markers', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /data-guide-surface="popup"/);
    assert.match(html, /data-guide-id="element-pick"/);
    assert.match(html, /使用说明/);
    assert.match(html, /Ctrl|⌘|多选/);
    assert.doesNotMatch(html, /Shift\+点击/);
  });

  it('login 说明插件会话与网页登录互相独立', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /插件登录与网页登录是两套会话/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /插件登录与网页登录是两套会话/);
  });

  it('T6 登录说明提到顶部未登录旁点登录再展开', () => {
    const login = UserGuide.SECTIONS.find((s) => s.id === 'login');
    assert.ok(login, 'missing login section');
    const blob = (login.steps || []).join('\n');
    assert.match(blob, /未登录.*旁.*登录/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    const loginMd = md.split('## 页内浮窗')[0];
    assert.match(loginMd, /未登录.*旁.*登录/);
  });

  it('float-create 说明包含同名工作空间按公司名区分', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /名称 · 公司名/);
  });

  it('float-create 说明包含项目是否可自动运行标注', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /可自动运行/);
    assert.match(html, /不可自动运行/);
  });

  it('T17 float-create 项目为单选且自动运行随项目能力', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /项目（单选）/);
    assert.doesNotMatch(html, /项目（可多选）/);
    assert.match(html, /所选项目是否允许自动运行/);
    assert.match(html, /已安装镜像才能勾选/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /项目（单选）/);
    assert.doesNotMatch(md, /与项目（可多选）/);
    assert.match(md, /已安装镜像才能勾选/);
    assert.match(html, /选择负责人（必选/);
    assert.match(md, /选择\*\*负责人\*\*|选择负责人（必选/);
    assert.match(html, /填写基准分支（空则用项目默认分支）/);
    assert.match(md, /填写基准分支（空则用项目默认分支）/);
    assert.doesNotMatch(html, /逐仓基准分支/);
    assert.doesNotMatch(md, /逐仓基准分支/);
  });

  it('page-optimization-suggest documents timeout data-traceId', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /data-traceId/);
    assert.match(html, /75\s*秒/);
    assert.match(html, /llm http 402|余额不足/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /data-traceId/);
    assert.match(md, /生成优化建议超时/);
    assert.match(md, /llm http 402|余额不足/);
    assert.match(md, /75\s*秒/);
  });

  it('page-optimization-suggest documents plugin-direct LLM API key', () => {
    const section = UserGuide.SECTIONS.find((s) => s.id === 'page-optimization-suggest');
    const blob = (section.steps || []).join('\n');
    assert.match(blob, /API Key/);
    assert.match(blob, /点「设置」/);
    assert.match(blob, /不再扣次|平台不再扣次/);
    assert.match(blob, /提示词 Skill/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /自动创新智能体/);
    assert.match(md, /点 \*\*「设置」\*\*/);
    assert.match(md, /平台不再扣次/);
  });

  it('page-optimization-suggest: 快速创建任务仅在填入后打开', () => {
    const section = UserGuide.SECTIONS.find((s) => s.id === 'page-optimization-suggest');
    assert.ok(section);
    const steps = (section.steps || []).join('\n');
    assert.match(steps, /不打开「快速创建任务」/);
    assert.match(steps, /填入.*后.*打开「快速创建任务」|点击上述填入按钮后才会打开「快速创建任务」/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /仅在点击上述任一填入按钮后/);
  });

  it('float-create 说明包含面板顶部 × 关闭浮窗', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /面板顶部[「"]×[」"]/);
    assert.match(html, /关闭浮窗/);
    assert.doesNotMatch(html, /面板顶部[「"]×[」"].*关闭悬浮球/);
  });

  it('float-create 说明创建成功 toast 任务 ID 可点进详情', () => {
    const section = UserGuide.SECTIONS.find((s) => s.id === 'float-create');
    const blob = (section.steps || []).join('\n');
    assert.match(blob, /任务 ID 为链接/);
    assert.match(blob, /任务详情/);
    assert.match(blob, /5 秒/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /任务 ID 为链接/);
  });

  it('renderFullGuideHtml for panel includes batch section', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(html, /data-guide-id="devtools-batch"/);
    assert.match(html, /5xx/);
  });

  it('devtools-single mentions request body is written into the task description', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(html, /请求体/);
  });

  it('devtools-single mentions type filter and column sort', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(html, /XHR\/Doc\/JS\/CSS\/Img\/Other/);
    assert.match(html, /点击列头/);
    assert.match(md, /XHR\/Doc\/JS\/CSS\/Img\/Other/);
    assert.match(md, /点击列头/);
  });

  it('DevTools 创建成功后先清空选项再提示', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(html, /先清空本次填写的选项/);
    assert.match(html, /再显示成功提示/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /先清空本次填写的选项/);
    assert.match(html, /创建失败仅提示错误，不清空已填写的选项/);
    assert.match(md, /创建失败仅提示错误，不清空已填写的选项/);
  });

  it('DevTools 使用说明不引导在面板里指针选择', () => {
    const html = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.doesNotMatch(html, /data-guide-id="element-pick"/);
    assert.doesNotMatch(html, /描述可用「指针选择」/);
    assert.doesNotMatch(html, /🖱️ 指针选择/);
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.doesNotMatch(md, /描述可用「指针选择」/);
  });

  it('escapeHtml escapes angle brackets', () => {
    assert.equal(UserGuide.escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('快捷键说明按用户自定义的组合动态插值（默认 Alt+X）', () => {
    // 默认（未选择）→ Alt+X 文案
    UserGuide.setShortcutMode('');
    const generic = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(generic, /Alt\+X/);

    // 旧版 'cmd' 迁移 → Command+Shift+X
    UserGuide.setShortcutMode('cmd');
    const cmdHtml = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(cmdHtml, /Command\+Shift\+X/);

    // 旧版 'ctrl' → Ctrl+Shift+X
    UserGuide.setShortcutMode('ctrl');
    const ctrlHtml = UserGuide.renderFullGuideHtml({ surface: 'panel' });
    assert.match(ctrlHtml, /Ctrl\+Shift\+X/);

    // 自定义组合 → 实际组合串（首条步骤跟随；键名在 <kbd> 中）
    UserGuide.setShortcutMode('Alt+Shift+E');
    const customHtml = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(customHtml, /<kbd[^>]*>Alt\+Shift\+E<\/kbd>/);
    assert.match(customHtml, /切换指针选择模式/);
    assert.match(customHtml, /tcp-guide-shortcut-table/);
    assert.match(customHtml, /快捷键无效/);

    // 非法值忽略，回退默认 Alt+X 文案
    UserGuide.setShortcutMode('weird');
    const fallback = UserGuide.renderCollapsibleHtml({ surface: 'popup' });
    assert.match(fallback, /Alt\+X/);
    UserGuide.setShortcutMode('');
  });

  it('使用说明含标题列表、目录、关闭按钮与 ARIA 折叠', () => {
    const html = UserGuide.renderCollapsibleHtml({ surface: 'popup', open: false });
    assert.match(html, /<h4 class="tcp-guide-heading"[^>]*>插件能做什么<\/h4>/);
    assert.match(html, /<ul class="tcp-guide-steps">/);
    assert.match(html, /tcp-guide-toc/);
    assert.match(html, /aria-label="关闭使用说明"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /data-guide-toggle/);
    assert.match(html, /\shidden/);
  });

  it('mount 绑定关闭后焦点回到触发按钮', () => {
    const { JSDOM } = (() => {
      try { return require('jsdom'); } catch { return { JSDOM: null }; }
    })();
    if (!JSDOM) {
      // jsdom optional in node:test env — skip structural bind check via source contract
      const src = fs.readFileSync(path.join(__dirname, '../lib/user-guide.js'), 'utf8');
      assert.match(src, /bindGuideInteractions/);
      assert.match(src, /toggle\.focus/);
      return;
    }
    const dom = new JSDOM('<!doctype html><div id="host"></div>');
    const host = dom.window.document.getElementById('host');
    UserGuide.mount(host, UserGuide.renderCollapsibleHtml({ surface: 'popup', open: true }));
    const toggle = host.querySelector('[data-guide-toggle]');
    const closeBtn = host.querySelector('[data-guide-close]');
    const panel = host.querySelector('.tcp-guide-body');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.hidden, false);
    closeBtn.focus = () => {};
    let focused = false;
    toggle.focus = () => { focused = true; };
    closeBtn.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.hidden, true);
    assert.equal(focused, true);
  });
});

describe('USER_GUIDE.md sync', () => {
  it('documents every section id from user-guide.js', () => {
    const mdPath = path.join(__dirname, '../docs/USER_GUIDE.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    for (const id of UserGuide.listSectionIds()) {
      assert.ok(md.includes(`\`${id}\``) || md.includes(id), `USER_GUIDE.md missing id ${id}`);
    }
  });

  it('documents that 使用说明 is popup + DevTools only, not float panel', () => {
    const md = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8');
    assert.match(md, /扩展弹窗/);
    assert.match(md, /浮窗不再|页内浮窗不.*使用说明|不在页内浮窗/);
  });
});

describe('float surface does not mount UserGuide', () => {
  it('float-boot.js 不再挂载 UserGuide', () => {
    const src = fs.readFileSync(path.join(__dirname, '../content/float-boot.js'), 'utf8');
    assert.doesNotMatch(src, /UserGuide\.mount/);
    assert.doesNotMatch(src, /renderCollapsibleHtml\(\{\s*surface:\s*['"]float['"]/);
  });

  it('content_scripts 主条目不再注入 user-guide', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'),
    );
    const entry = manifest.content_scripts[0];
    assert.ok(!entry.js.includes('lib/user-guide.js'));
    assert.ok(!entry.js.includes('lib/user-guide-en-sections.js'));
    assert.ok(!(entry.css || []).includes('content/content-guide.css'));
  });

  it('popup 仍挂载使用说明', () => {
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    assert.match(html, /id="popup-user-guide"/);
    const auth = fs.readFileSync(path.join(__dirname, '../popup/popup-auth.js'), 'utf8');
    assert.match(auth, /UserGuide\.mount/);
    assert.match(auth, /surface:\s*['"]popup['"]/);
  });
});
