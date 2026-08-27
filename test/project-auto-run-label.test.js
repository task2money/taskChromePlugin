'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  projectDisplayName,
  projectAllowsAutoRun,
  projectAutoRunBadgeText,
  formatProjectListLabel,
  renderProjectCheckboxCaptionHtml,
  renderProjectRadioHtml,
  findProjectById,
  pickSingleProjectId,
  hasInstalledImageId,
  resolveAutoRunControlState,
  resolveImageFieldAppearance,
  applyAutoRunControlToElements,
  applyImageFieldAppearance,
  validateAutoRunRequiresImage,
  projectHasConfiguredRunTemplate,
} = require('../lib/project-auto-run-label.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const allowed = {
  id: 'p1',
  name: 'Alpha',
  server_run_template: { default_auto_run: true, platform: 'aliyun' },
};

describe('projectAllowsAutoRun', () => {
  it('T1 true when default_auto_run is boolean true', () => {
    assert.equal(projectAllowsAutoRun(allowed), true);
    assert.equal(projectAutoRunBadgeText(allowed), '可自动运行');
  });

  it('T2 false when default_auto_run is false', () => {
    const p = { id: 'p2', name: 'Beta', server_run_template: { default_auto_run: false } };
    assert.equal(projectAllowsAutoRun(p), false);
    assert.equal(projectAutoRunBadgeText(p), '不可自动运行');
  });

  it('T3 false when server_run_template missing', () => {
    assert.equal(projectAllowsAutoRun({ id: 'p3', name: 'Gamma' }), false);
    assert.equal(projectAllowsAutoRun(null), false);
    assert.equal(projectAllowsAutoRun(undefined), false);
  });

  it('T4 false when template is array or non-object', () => {
    assert.equal(projectAllowsAutoRun({ server_run_template: [] }), false);
    assert.equal(projectAllowsAutoRun({ server_run_template: 'yes' }), false);
    assert.equal(projectAllowsAutoRun({ server_run_template: { default_auto_run: 'true' } }), false);
    assert.equal(projectAllowsAutoRun({ server_run_template: { default_auto_run: 1 } }), false);
  });
});

describe('formatProjectListLabel', () => {
  it('T6 puts badge in parentheses next to name', () => {
    assert.equal(formatProjectListLabel(allowed), 'Alpha（可自动运行）');
    assert.equal(
      formatProjectListLabel({ id: 'x', name: 'Zed' }),
      'Zed（不可自动运行）',
    );
  });

  it('uses displayName / title / id fallback', () => {
    assert.equal(projectDisplayName({ displayName: 'D' }), 'D');
    assert.equal(projectDisplayName({ title: 'T' }), 'T');
    assert.equal(projectDisplayName({ id: 'id-9' }), 'id-9');
  });
});

describe('renderProjectCheckboxCaptionHtml', () => {
  it('T5 escapes project name', () => {
    const html = renderProjectCheckboxCaptionHtml(
      { id: 'evil', name: '<script>x</script>', server_run_template: { default_auto_run: true } },
      esc,
    );
    assert.equal(html.includes('<script>'), false);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
    assert.match(html, /data-auto-run="true"/);
    assert.match(html, /可自动运行/);
  });

  it('sets data-auto-run false when not allowed', () => {
    const html = renderProjectCheckboxCaptionHtml({ id: 'n', name: 'Nope' }, esc);
    assert.match(html, /data-auto-run="false"/);
    assert.match(html, /不可自动运行/);
  });
});

describe('injection and usage contracts', () => {
  it('T7 float and panel render radios via ProjectAutoRunLabel', () => {
    const content = read('content/content.js');
    const workspace = read('panel/lib/workspace.js') + read('panel/lib/workspace-projects.js');
    assert.match(content, /ProjectAutoRunLabel\.renderProjectRadioHtml/);
    assert.match(workspace, /ProjectAutoRunLabel\.renderProjectRadioHtml/);
    assert.match(content, /ProjectAutoRunLabel\.resolveAutoRunControlState/);
    assert.match(workspace, /ProjectAutoRunLabel\.resolveAutoRunControlState/);
  });

  it('T8 manifest and panel.html load lib before consumers', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const scripts = manifest.content_scripts[0].js;
    const libIdx = scripts.indexOf('lib/project-auto-run-label.js');
    const contentIdx = scripts.indexOf('content/content.js');
    assert.ok(libIdx >= 0, 'manifest must inject project-auto-run-label.js');
    assert.ok(libIdx < contentIdx, 'lib must load before content.js');

    const panelHtml = read('panel/panel.html');
    const libPos = panelHtml.indexOf('lib/project-auto-run-label.js');
    const wsPos = panelHtml.indexOf('lib/workspace.js');
    const projPos = panelHtml.indexOf('lib/workspace-projects.js');
    assert.ok(libPos >= 0, 'panel.html must load project-auto-run-label.js');
    assert.ok(wsPos > libPos, 'label lib must load before workspace.js');
    assert.ok(projPos > wsPos, 'workspace-projects.js must load after workspace.js');
  });

  it('T9 user guide mentions auto-run badges', () => {
    assert.match(read('docs/USER_GUIDE.md'), /可自动运行/);
    assert.match(read('lib/user-guide.js'), /可自动运行/);
  });
});

describe('pickSingleProjectId / findProjectById', () => {
  it('T14 picks first preferred id that is still available', () => {
    assert.equal(pickSingleProjectId(['gone', 'p2', 'p1'], ['p1', 'p2']), 'p2');
    assert.equal(pickSingleProjectId(['p9'], ['p1']), '');
    assert.equal(pickSingleProjectId(null, ['p1']), '');
  });

  it('finds project by id or _id', () => {
    const list = [{ id: 'a', name: 'A' }, { _id: 'b', name: 'B' }];
    assert.equal(findProjectById(list, 'b').name, 'B');
    assert.equal(findProjectById(list, 'missing'), null);
  });
});

describe('resolveAutoRunControlState', () => {
  it('T10 disables when no project selected', () => {
    const st = resolveAutoRunControlState({ selectedProject: null, checkedPreference: true });
    assert.equal(st.enabled, false);
    assert.equal(st.checked, false);
    assert.match(st.hint, /请先选择项目/);
  });

  it('T11 disables and unchecks when project does not allow auto-run', () => {
    const st = resolveAutoRunControlState({
      selectedProject: { id: 'p2', name: 'Beta' },
      checkedPreference: true,
    });
    assert.equal(st.enabled, false);
    assert.equal(st.checked, false);
    assert.match(st.hint, /未允许自动运行/);
  });

  it('T12 enables and checks when allowed, image selected, and preference true', () => {
    const st = resolveAutoRunControlState({
      selectedProject: allowed,
      checkedPreference: true,
      hasInstalledImage: true,
    });
    assert.equal(st.enabled, true);
    assert.equal(st.checked, true);
    assert.match(st.hint, /运行模版/);
  });

  it('T13 enables but leaves unchecked when allowed, image selected, and preference false', () => {
    const st = resolveAutoRunControlState({
      selectedProject: allowed,
      checkedPreference: false,
      hasInstalledImage: true,
    });
    assert.equal(st.enabled, true);
    assert.equal(st.checked, false);
  });

  it('T15 configured-template project stays enabled (OPT-20260827-034 gate no-op for full template)', () => {
    const st = resolveAutoRunControlState({
      selectedProject: { id: 'p3', name: 'Gamma', server_run_template: { default_auto_run: true, platform: 'aliyun', region: 'cn-hangzhou' } },
      checkedPreference: true,
      hasInstalledImage: true,
    });
    assert.equal(st.enabled, true);
    assert.equal(st.checked, true);
  });

  it('T16 project without server_run_template is disabled by allows-auto-run gate first', () => {
    const st = resolveAutoRunControlState({
      selectedProject: { id: 'p4', name: 'Delta' },
      checkedPreference: true,
      hasInstalledImage: true,
    });
    assert.equal(st.enabled, false);
    assert.match(st.hint, /未允许自动运行/);
  });
});

describe('projectHasConfiguredRunTemplate', () => {
  it('true when template has a meaningful field', () => {
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: { platform: 'aliyun', region: 'cn-hangzhou' } }), true);
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: { label: '2c8g', hardware_config: { cpu_cores: 2 } } }), true);
  });

  it('true when template has default_auto_run key (work-panel summarizeRunTemplate 语义)', () => {
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: { default_auto_run: true } }), true);
  });

  it('false when template missing or empty', () => {
    assert.equal(projectHasConfiguredRunTemplate({}), false);
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: undefined }), false);
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: {} }), false);
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: { default_auto_run: undefined } }), false);
    assert.equal(projectHasConfiguredRunTemplate({ server_run_template: { platform: '' } }), false);
  });
});

describe('renderProjectRadioHtml', () => {
  it('emits a named radio with caption badge', () => {
    const html = renderProjectRadioHtml(allowed, { name: 'taskplugin-project', esc });
    assert.match(html, /type="radio"/);
    assert.match(html, /class="project-radio"/);
    assert.match(html, /name="taskplugin-project"/);
    assert.match(html, /value="p1"/);
    assert.match(html, /可自动运行/);
  });
});

describe('applyAutoRunControlToElements', () => {
  it('T15 writes disabled, checked, hint and aria-disabled', () => {
    const attrs = {};
    const input = {
      disabled: false,
      checked: true,
      setAttribute(k, v) { attrs[k] = String(v); },
    };
    const hint = { textContent: '' };
    applyAutoRunControlToElements(input, hint, {
      enabled: false,
      checked: false,
      hint: '请先选择项目',
    });
    assert.equal(input.disabled, true);
    assert.equal(input.checked, false);
    assert.equal(attrs['aria-disabled'], 'true');
    assert.equal(hint.textContent, '请先选择项目');
  });
});

describe('single-select source contracts', () => {
  it('T16 float and panel use radios and drop select-all', () => {
    const markup = read('lib/float-panel-markup.js');
    const content = read('content/content.js');
    const workspace = read('panel/lib/workspace.js') + read('panel/lib/workspace-projects.js');
    const panelHtml = read('panel/panel.html');
    const lib = read('lib/project-auto-run-label.js');
    assert.match(markup, /项目 \(单选\)/);
    assert.match(lib, /type="radio"/);
    assert.match(content, /input\.project-radio/);
    assert.doesNotMatch(workspace, /select-all/);
    assert.doesNotMatch(workspace, /全选\/取消/);
    assert.match(workspace, /project-radio/);
    assert.match(panelHtml, /项目 \(单选\)/);
    assert.doesNotMatch(panelHtml, /项目 \(可多选\)/);
  });
});

describe('hasInstalledImageId', () => {
  it('true only for non-empty trimmed id', () => {
    assert.equal(hasInstalledImageId('img-1'), true);
    assert.equal(hasInstalledImageId('  '), false);
    assert.equal(hasInstalledImageId(''), false);
    assert.equal(hasInstalledImageId(null), false);
  });
});

describe('resolveAutoRunControlState image gate', () => {
  it('T-image-1 disables when project allows auto-run but no image', () => {
    const st = resolveAutoRunControlState({
      selectedProject: allowed,
      checkedPreference: true,
      hasInstalledImage: false,
    });
    assert.equal(st.enabled, false);
    assert.equal(st.checked, false);
    assert.match(st.hint, /请先选择已安装镜像/);
  });

  it('T-image-2 no project still wins over missing image', () => {
    const st = resolveAutoRunControlState({
      selectedProject: null,
      checkedPreference: true,
      hasInstalledImage: true,
    });
    assert.equal(st.enabled, false);
    assert.match(st.hint, /请先选择项目/);
  });

  it('T-image-3 project not allowed still wins over selected image', () => {
    const st = resolveAutoRunControlState({
      selectedProject: { id: 'p2', name: 'Beta' },
      checkedPreference: true,
      hasInstalledImage: true,
    });
    assert.equal(st.enabled, false);
    assert.match(st.hint, /未允许自动运行/);
  });

  it('omitted hasInstalledImage is treated as missing (fail-safe)', () => {
    const st = resolveAutoRunControlState({
      selectedProject: allowed,
      checkedPreference: true,
    });
    assert.equal(st.enabled, false);
    assert.match(st.hint, /请先选择已安装镜像/);
  });
});

describe('resolveImageFieldAppearance', () => {
  it('T-image-5 marks required when project allows auto-run', () => {
    const ap = resolveImageFieldAppearance({ projectAllowsAutoRun: true });
    assert.equal(ap.requiredMarkVisible, true);
    assert.match(ap.requiredMarkText, /自动运行必选/);
    assert.equal(ap.emptyOptionLabel, '请选择已安装镜像');
  });

  it('T-image-6 optional when project does not allow auto-run', () => {
    const ap = resolveImageFieldAppearance({ projectAllowsAutoRun: false });
    assert.equal(ap.requiredMarkVisible, false);
    assert.equal(ap.emptyOptionLabel, '无');
  });
});

describe('applyImageFieldAppearance', () => {
  it('toggles mark, aria-required, and empty option text', () => {
    const mark = { hidden: true, textContent: '' };
    const empty = { textContent: '无' };
    const attrs = {};
    const select = {
      setAttribute(k, v) { attrs[k] = String(v); },
      querySelector() { return empty; },
    };
    applyImageFieldAppearance(mark, select, resolveImageFieldAppearance({ projectAllowsAutoRun: true }));
    assert.equal(mark.hidden, false);
    assert.match(mark.textContent, /自动运行必选/);
    assert.equal(attrs['aria-required'], 'true');
    assert.equal(empty.textContent, '请选择已安装镜像');
  });
});

describe('validateAutoRunRequiresImage', () => {
  it('blocks auto_run without image', () => {
    assert.match(validateAutoRunRequiresImage(true, ''), /请先选择已安装镜像/);
  });

  it('passes auto_run with image', () => {
    assert.equal(validateAutoRunRequiresImage(true, 'img-1'), '');
  });

  it('passes when auto_run off', () => {
    assert.equal(validateAutoRunRequiresImage(false, ''), '');
  });
});

describe('image gate source contracts', () => {
  it('T9 float and panel pass hasInstalledImage into resolve', () => {
    const content = read('content/content.js');
    const workspace = read('panel/lib/workspace.js') + read('panel/lib/workspace-projects.js');
    assert.match(content, /hasInstalledImage/);
    assert.match(workspace, /hasInstalledImage/);
    assert.match(content, /taskplugin-image-required/);
    assert.match(read('panel/panel.html'), /singleImageRequired/);
    assert.match(read('panel/panel.html'), /batchImageRequired/);
    assert.match(read('panel/tabs/batch.js'), /container_image_id: containerImageId/);
    assert.doesNotMatch(read('panel/tabs/batch.js'), /智能体资源配置\|环境变量参数/);
  });

  it('T-image-submit float validates image before createTask', () => {
    const content = read('content/content.js');
    const submitIdx = content.indexOf("submitBtn.addEventListener('click'");
    assert.ok(submitIdx >= 0, 'float submit handler missing');
    const validateIdx = content.indexOf('validateCreateTaskForm(form)', submitIdx);
    const blockedIdx = content.indexOf('if (blocked)', submitIdx);
    const createIdx = content.indexOf("action: 'createTask'", submitIdx);
    assert.ok(validateIdx > submitIdx, 'validateCreateTaskForm not in submit handler');
    assert.ok(blockedIdx > validateIdx && blockedIdx < createIdx, 'blocked return must precede createTask');
    assert.ok(createIdx > validateIdx, 'createTask must run after validateCreateTaskForm');
  });

  it('T-image-restore syncs auto-run after restoring image value', () => {
    const content = read('content/content.js');
    const restoreIdx = content.indexOf('async function restoreOpenSnapshot');
    assert.ok(restoreIdx >= 0, 'restoreOpenSnapshot missing');
    const restore = content.slice(restoreIdx, content.indexOf('function bindFloatPanelCloseButton'));
    const imgIdx = restore.indexOf('imageSelect.value = normalized.container_image_id');
    const syncIdx = restore.indexOf('syncFloatAutoRun(normalized.auto_run)');
    assert.ok(imgIdx >= 0, 'restore must assign container_image_id');
    assert.ok(syncIdx > imgIdx, 'syncFloatAutoRun must run after image value is restored');
  });
});
