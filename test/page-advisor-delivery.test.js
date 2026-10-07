'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Delivery = require('../lib/page-advisor-delivery.js');

describe('page-advisor-delivery', () => {
  it('normalizeTarget falls back to task_description', () => {
    assert.equal(Delivery.normalizeTarget('cursor'), 'cursor');
    assert.equal(Delivery.normalizeTarget('claude'), 'claude');
    assert.equal(Delivery.normalizeTarget('codex'), 'codex');
    assert.equal(Delivery.normalizeTarget('trae'), 'trae');
    assert.equal(Delivery.normalizeTarget('workbuddy'), 'workbuddy');
    assert.equal(Delivery.normalizeTarget('task_description'), 'task_description');
    assert.equal(Delivery.normalizeTarget(''), 'task_description');
    assert.equal(Delivery.normalizeTarget('nope'), 'task_description');
    assert.equal(Delivery.normalizeTarget(null), 'task_description');
  });

  it('auto-delivers only IDE targets and opens create panel only for task_description', () => {
    assert.equal(Delivery.shouldAutoDeliverOnResult('cursor'), true);
    assert.equal(Delivery.shouldAutoDeliverOnResult('trae'), true);
    assert.equal(Delivery.shouldAutoDeliverOnResult('workbuddy'), true);
    assert.equal(Delivery.shouldAutoDeliverOnResult('task_description'), false);
    assert.equal(Delivery.shouldOpenCreatePanel('task_description'), true);
    assert.equal(Delivery.shouldOpenCreatePanel('claude'), false);
  });

  it('formatUserStatus prefers deeplink then native then clipboard', () => {
    const labels = {
      paDeliveryCursor: 'Cursor',
      paDeliveryClaude: 'Claude',
      paDeliveryCodex: 'Codex',
      paDeliveryTrae: 'Trae',
      paDeliveryWorkBuddy: 'WorkBuddy',
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
      Delivery.formatUserStatus('trae', { nativeOk: false, clipboardOk: true }, tx).text,
      'paDeliverClipboardOnly:Trae',
    );
    assert.equal(
      Delivery.formatUserStatus('workbuddy', { nativeOk: true, clipboardOk: true }, tx).text,
      'paDeliverNativeOk:WorkBuddy',
    );
    assert.equal(
      Delivery.formatUserStatus('cursor', { nativeOk: false, clipboardOk: false }, tx).ok,
      false,
    );
  });

  it('buildIdeDeeplink uses Cursor/Claude/Codex official schemes', () => {
    const cursor = Delivery.buildIdeDeeplink('cursor', 'fix login');
    assert.ok(cursor.startsWith('cursor://anysphere.cursor-deeplink/prompt?text='));
    const decoded = decodeURIComponent(cursor.split('text=')[1]);
    assert.equal(decoded, '/new\nfix login');

    const claude = Delivery.buildIdeDeeplink('claude', 'hello');
    assert.equal(claude, 'claude://code/new?q=' + encodeURIComponent('hello'));

    const codex = Delivery.buildIdeDeeplink('codex', 'ship it');
    assert.equal(codex, 'codex://new?prompt=' + encodeURIComponent('ship it'));

    assert.equal(Delivery.buildIdeDeeplink('trae', 'x'), 'trae://');
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

  it('popup radios persist pageAdvisorDeliveryTarget', () => {
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
    assert.match(llm, /id="popupDeliveryTargetField"/);
    assert.match(llm, /name="pageAdvisorDeliveryTarget"/);
    assert.match(llm, /value="task_description"/);
    assert.match(llm, /value="cursor"/);
    assert.match(llm, /value="claude"/);
    assert.match(llm, /value="codex"/);
    assert.match(llm, /value="trae"/);
    assert.match(llm, /value="workbuddy"/);
    assert.match(llm, /data-i18n="paDeliveryHint"/);
    assert.match(llm, /data-region-help="1"/);
    const hintIdx = llm.indexOf('data-i18n="paDeliveryHint"');
    const detailsStart = llm.lastIndexOf('<details', hintIdx);
    const detailsEnd = llm.indexOf('</details>', hintIdx);
    assert.ok(detailsStart >= 0 && detailsEnd > hintIdx);
    assert.doesNotMatch(llm.slice(detailsStart, detailsEnd), /\bopen\b/);
  });

  it('建议送达在自动创新智能体区域最底部（Key/状态之后、瀑布图之前）', () => {
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
    const deliveryIdx = llm.indexOf('id="popupDeliveryTargetField"');
    const routeIdx = llm.indexOf('id="popupLlmRouteField"');
    const profileIdx = llm.indexOf('id="popupLlmProfileRow"');
    const statusIdx = llm.indexOf('id="popupLlmStatus"');
    const waterfallIdx = llm.indexOf('id="pageAdvisorWaterfall"');
    assert.ok(deliveryIdx > routeIdx, '建议送达应在调用方式之后');
    assert.ok(deliveryIdx > profileIdx, '建议送达应在已保存的 Key 之后');
    assert.ok(deliveryIdx > statusIdx, '建议送达应在状态行之后');
    assert.ok(
      waterfallIdx > deliveryIdx,
      '耗时瀑布图仍在区块最末；建议送达为其前最后一项配置',
    );
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

  it('native host accepts trae and workbuddy in dry-run', () => {
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
      assert.equal(obj.ok, true, target);
      assert.equal(obj.method, 'clipboard', target);
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

  it('native host 标题匹配覆盖 Trae/WorkBuddy 变体（OPT-20261006-037）', () => {
    const { spawnSync } = require('node:child_process');
    const py = path.join(__dirname, '../native-host/ide_bridge.py');
    const script = [
      'import importlib.util, json',
      `spec = importlib.util.spec_from_file_location("ide_bridge", ${JSON.stringify(py)})`,
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'print(json.dumps({',
      '  "trae_cn": m.match_title(m.TITLES["trae"], ["x", "Trae CN — f.py"]),',
      '  "byte_trae": m.match_title(m.TITLES["trae"], ["ByteDance Trae"]),',
      '  "work_buddy": m.match_title(m.TITLES["workbuddy"], ["Work Buddy"]),',
      '  "byte_wb": m.match_title(m.TITLES["workbuddy"], ["ByteDance WorkBuddy"]),',
      '  "case_insensitive": m.match_title(m.TITLES["workbuddy"], ["workbuddy v2"]),',
      '  "none": m.match_title(m.TITLES["trae"], ["gedit notes.txt"]),',
      '}))',
    ].join('\n');
    const r = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, String(r.stderr || ''));
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.trae_cn, 'Trae');
    assert.equal(out.byte_trae, 'Trae');
    assert.equal(out.work_buddy, 'Work Buddy');
    assert.equal(out.byte_wb, 'WorkBuddy');
    assert.equal(out.case_insensitive, 'WorkBuddy');
    assert.equal(out.none, null);
  });
});
