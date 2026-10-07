'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Delivery = require('../lib/page-advisor-delivery.js');

describe('page-advisor-delivery', () => {
  it('normalizeTarget keeps deeplink IDEs; legacy trae/workbuddy fall back', () => {
    assert.equal(Delivery.normalizeTarget('cursor'), 'cursor');
    assert.equal(Delivery.normalizeTarget('claude'), 'claude');
    assert.equal(Delivery.normalizeTarget('codex'), 'codex');
    assert.equal(Delivery.normalizeTarget('trae'), 'task_description');
    assert.equal(Delivery.normalizeTarget('workbuddy'), 'task_description');
    assert.equal(Delivery.normalizeTarget('task_description'), 'task_description');
    assert.equal(Delivery.normalizeTarget(''), 'task_description');
    assert.equal(Delivery.normalizeTarget('nope'), 'task_description');
    assert.equal(Delivery.normalizeTarget(null), 'task_description');
  });

  it('IDE 目标不自动送达；须点底栏；create panel 仅任务描述', () => {
    assert.equal(Delivery.isIdeDeliveryTarget('cursor'), true);
    assert.equal(Delivery.isIdeDeliveryTarget('claude'), true);
    assert.equal(Delivery.isIdeDeliveryTarget('codex'), true);
    assert.equal(Delivery.isIdeDeliveryTarget('trae'), false);
    assert.equal(Delivery.isIdeDeliveryTarget('task_description'), false);
    // Alt+Z 生成成功后不得自动深链；仅按钮/Alt+X 确认触发
    assert.equal(Delivery.shouldAutoDeliverOnResult('cursor'), false);
    assert.equal(Delivery.shouldAutoDeliverOnResult('claude'), false);
    assert.equal(Delivery.shouldAutoDeliverOnResult('codex'), false);
    assert.equal(Delivery.shouldAutoDeliverOnResult('task_description'), false);
    assert.equal(Delivery.shouldOpenCreatePanel('task_description'), true);
    assert.equal(Delivery.shouldOpenCreatePanel('claude'), false);
  });

  it('建议结果展示路径不再调用 maybeAutoDeliver', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /maybeAutoDeliverPageAdvisorResult/);
    const deliver = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-deliver.js'),
      'utf8',
    );
    assert.doesNotMatch(deliver, /function maybeAutoDeliverPageAdvisorResult/);
    assert.match(deliver, /isIdeDeliveryTarget/);
  });

  it('formatUserStatus prefers deeplink then native then clipboard', () => {
    const labels = {
      paDeliveryCursor: 'Cursor',
      paDeliveryClaude: 'Claude',
      paDeliveryCodex: 'Codex',
      paDeliveryTaskDesc: '任务描述',
    };
    const tx = (k, p) => {
      if (p && p.name) return `${k}:${p.name}`;
      return labels[k] || k;
    };
    assert.equal(
      Delivery.formatUserStatus(
        'cursor',
        { deeplinkOk: true, nativeOk: true, clipboardOk: true },
        tx,
      ).text,
      'paDeliverDeeplinkOk:Cursor',
    );
    assert.equal(
      Delivery.formatUserStatus('cursor', { nativeOk: true, clipboardOk: true }, tx).text,
      'paDeliverNativeOk:Cursor',
    );
    assert.equal(
      Delivery.formatUserStatus(
        'claude',
        { nativeOk: false, clipboardOk: true, nativeError: 'app_not_running' },
        tx,
      ).text,
      'paDeliverAppNotRunning:Claude',
    );
    assert.equal(
      Delivery.formatUserStatus('codex', { nativeOk: false, clipboardOk: true }, tx).text,
      'paDeliverClipboardOnly:Codex',
    );
    assert.equal(
      Delivery.formatUserStatus('cursor', { nativeOk: false, clipboardOk: false }, tx).ok,
      false,
    );
  });

  it('buildIdeDeeplink uses Cursor/Claude/Codex official schemes', () => {
    const cursor = Delivery.buildIdeDeeplink('cursor', 'fix login');
    assert.equal(
      cursor,
      'cursor://anysphere.cursor-deeplink/prompt?text=' + encodeURIComponent('fix login'),
    );
    const decoded = decodeURIComponent(cursor.split('text=')[1]);
    assert.equal(decoded, 'fix login');
    assert.doesNotMatch(decoded, /^\/new/);

    const claude = Delivery.buildIdeDeeplink('claude', 'hello');
    assert.equal(claude, 'claude://code/new?q=' + encodeURIComponent('hello'));

    const codex = Delivery.buildIdeDeeplink('codex', 'ship it');
    assert.equal(codex, 'codex://new?prompt=' + encodeURIComponent('ship it'));

    assert.equal(Delivery.buildIdeDeeplink('trae', 'x'), '');
    assert.equal(Delivery.buildIdeDeeplink('workbuddy', 'x'), '');
    assert.equal(Delivery.buildIdeDeeplink('task_description', 'x'), '');
    assert.equal(Delivery.buildIdeDeeplink('cursor', ''), '');
  });

  it('buildIdeDeeplink truncates overlong Cursor URLs', () => {
    const huge = 'a'.repeat(20000);
    const url = Delivery.buildIdeDeeplink('cursor', huge);
    assert.ok(url.length <= Delivery.DEEPLINK_MAX_URL_LEN);
    assert.ok(url.startsWith('cursor://anysphere.cursor-deeplink/prompt?text='));
  });

  it('SW opens IDE via tabs.create deeplink', () => {
    const sw = fs.readFileSync(
      path.join(__dirname, '../background/sw-page-advisor-delivery.js'),
      'utf8',
    );
    assert.match(sw, /buildIdeDeeplink/);
    assert.match(sw, /chrome\.tabs\.create/);
    assert.match(sw, /deeplinkOk/);
    const deliver = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-deliver.js'),
      'utf8',
    );
    assert.match(deliver, /deeplinkOk/);
  });

  it('fill-ui gates create panel on shouldOpenCreatePanel', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../content/float-page-advisor-fill-ui.js'),
      'utf8',
    );
    assert.match(src, /shouldOpenCreatePanel/);
    assert.match(src, /openFloatPanelForAdvisor/);
    assert.match(src, /deliverPageAdvisorSuggestions/);
  });

  it('popup radios only list task_description and deeplink IDEs', () => {
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    const brand = html.match(/id="pluginDeliverySection"[\s\S]*?<\/section>/)[0];
    assert.match(brand, /id="popupDeliveryTargetField"/);
    assert.match(brand, /name="pageAdvisorDeliveryTarget"/);
    assert.match(brand, /value="task_description"/);
    assert.match(brand, /value="cursor"/);
    assert.match(brand, /value="claude"/);
    assert.match(brand, /value="codex"/);
    assert.doesNotMatch(brand, /value="trae"/);
    assert.doesNotMatch(brand, /value="workbuddy"/);
    assert.match(brand, /data-i18n="paDeliveryHint"/);
    assert.match(brand, /data-region-help="1"/);
    const hintIdx = brand.indexOf('data-i18n="paDeliveryHint"');
    const detailsStart = brand.lastIndexOf('<details', hintIdx);
    const detailsEnd = brand.indexOf('</details>', hintIdx);
    assert.ok(detailsStart >= 0 && detailsEnd > hintIdx);
    assert.doesNotMatch(brand.slice(detailsStart, detailsEnd), /\bopen\b/);
  });

  it('转发目标区块不重复品牌标题，且不在自动创新智能体内', () => {
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    const brand = html.match(/id="pluginDeliverySection"[\s\S]*?<\/section>/)[0];
    const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
    assert.match(brand, /id="popupDeliveryTargetField"/);
    assert.match(brand, /data-i18n="paDeliveryLegend"/);
    assert.match(brand, />转发目标</);
    assert.doesNotMatch(brand, /建议送达/);
    assert.doesNotMatch(brand, /data-i18n="extTitle"/);
    assert.doesNotMatch(brand, /云端Coding/);
    assert.match(brand, /class="region-help"/);
    assert.doesNotMatch(llm, /id="popupDeliveryTargetField"/);
    assert.doesNotMatch(llm, /data-i18n="paDeliveryHint"/);
    const brandIdx = html.indexOf('id="pluginDeliverySection"');
    const llmIdx = html.indexOf('id="pageAdvisorLlmSection"');
    assert.ok(brandIdx >= 0 && llmIdx > brandIdx, '品牌转发目标区应在智能体区之前');
  });

  it('Alt+X 确认路径按送达渠道转发（IDE 不写任务描述）', () => {
    const pick = fs.readFileSync(path.join(__dirname, '../content/float-pick.js'), 'utf8');
    assert.match(pick, /loadPageAdvisorDeliveryTarget/);
    assert.match(pick, /isIdeDeliveryTarget/);
    assert.match(pick, /deliverPageAdvisorToIde|deliverPlainTextViaDeliveryTarget/);
    assert.match(pick, /shouldOpenCreatePanel|writeCreateDescription/);
  });

  it('native host dry-run frames json without executing text', () => {
    const { spawnSync } = require('node:child_process');
    const py = path.join(__dirname, '../native-host/ide_bridge.py');
    const payload = Buffer.from(JSON.stringify({
      target: 'cursor',
      text: 'rm -rf /',
      pageUrl: 'https://example.test/',
    }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    const r = spawnSync('python3', [py], {
      input: Buffer.concat([header, payload]),
      env: { ...process.env, AIDEVPUSH_IDE_BRIDGE_DRY: '1' },
      encoding: null,
    });
    assert.equal(r.status, 0, String(r.stderr || ''));
    const n = r.stdout.readUInt32LE(0);
    const obj = JSON.parse(r.stdout.slice(4, 4 + n).toString('utf8'));
    assert.equal(obj.ok, true);
    assert.equal(obj.method, 'clipboard');
  });

  it('native host rejects non-deeplink targets in dry-run', () => {
    const { spawnSync } = require('node:child_process');
    const py = path.join(__dirname, '../native-host/ide_bridge.py');
    for (const target of ['trae', 'workbuddy']) {
      const payload = Buffer.from(JSON.stringify({
        target,
        text: 'hello',
        pageUrl: 'https://example.test/',
      }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length, 0);
      const r = spawnSync('python3', [py], {
        input: Buffer.concat([header, payload]),
        env: { ...process.env, AIDEVPUSH_IDE_BRIDGE_DRY: '1' },
        encoding: null,
      });
      assert.equal(r.status, 0, String(r.stderr || ''));
      const n = r.stdout.readUInt32LE(0);
      const obj = JSON.parse(r.stdout.slice(4, 4 + n).toString('utf8'));
      assert.equal(obj.ok, false, target);
    }
  });

  it('manifest declares clipboardWrite and nativeMessaging', () => {
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
    assert.ok(man.permissions.includes('clipboardWrite'));
    assert.ok(man.permissions.includes('nativeMessaging'));
    assert.ok(man.version.startsWith('1.8.'));
    const js = man.content_scripts[0].js;
    assert.ok(js.includes('lib/page-advisor-delivery.js'));
    assert.ok(js.includes('content/float-page-advisor-fill-ui.js'));
    assert.ok(js.includes('content/float-page-advisor-deliver.js'));
  });

  it('native host 标题匹配覆盖 Cursor/Claude/Codex', () => {
    const { spawnSync } = require('node:child_process');
    const py = path.join(__dirname, '../native-host/ide_bridge.py');
    const script = [
      'import importlib.util, json',
      `spec = importlib.util.spec_from_file_location("ide_bridge", ${JSON.stringify(py)})`,
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'print(json.dumps({',
      '  "cursor": m.match_title(m.TITLES["cursor"], ["x", "Cursor — f.py"]),',
      '  "claude": m.match_title(m.TITLES["claude"], ["Claude"]),',
      '  "codex": m.match_title(m.TITLES["codex"], ["Codex"]),',
      '  "case_insensitive": m.match_title(m.TITLES["cursor"], ["cursor v2"]),',
      '  "none": m.match_title(m.TITLES["cursor"], ["gedit notes.txt"]),',
      '  "allowed": sorted(m.ALLOWED),',
      '}))',
    ].join('\n');
    const r = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, String(r.stderr || ''));
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.cursor, 'Cursor');
    assert.equal(out.claude, 'Claude');
    assert.equal(out.codex, 'Codex');
    assert.equal(out.case_insensitive, 'Cursor');
    assert.equal(out.none, null);
    assert.deepEqual(out.allowed, ['claude', 'codex', 'cursor']);
  });
});
