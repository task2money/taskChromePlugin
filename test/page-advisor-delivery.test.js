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


  it('本机偏好：较新的本地记录胜过尚未写完的 chrome.storage', () => {
    const newer = Delivery.chooseDeliveryPreference({
      localTarget: 'codex',
      localAt: 50,
      remoteTarget: 'task_description',
      remoteAt: 1,
    });
    assert.equal(newer.target, 'codex');
    assert.equal(newer.at, 50);
    assert.equal(newer.source, 'local');
    const legacy = Delivery.chooseDeliveryPreference({
      localTarget: '',
      localAt: 0,
      remoteTarget: 'claude',
      remoteAt: 0,
    });
    assert.equal(legacy.target, 'claude');
    assert.equal(legacy.source, 'remote');
    const none = Delivery.chooseDeliveryPreference({});
    assert.equal(none.target, 'task_description');
    assert.equal(none.source, 'default');
    const payload = Delivery.preferencePayload('trae', 80);
    assert.equal(payload.pageAdvisorDeliveryTarget, 'task_description');
    assert.equal(payload.pageAdvisorDeliveryTargetAt, 80);
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

  it('formatUserStatus prefers deeplink then clipboard', () => {
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
        { deeplinkOk: true, clipboardOk: true, batchCount: 1 },
        tx,
      ).text,
      'paDeliverDeeplinkOk:Cursor',
    );
    assert.equal(
      Delivery.formatUserStatus('codex', { deeplinkOk: false, clipboardOk: true }, tx).text,
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

  it('buildIdeDeeplink refuses to slice overlong prompts into the URL', () => {
    const tail = 'TAIL_建议未被截断';
    const huge = '调整期望：'.repeat(800) + tail;
    assert.equal(Delivery.promptFitsDeeplink('cursor', 'fix login'), true);
    assert.equal(Delivery.promptFitsDeeplink('cursor', huge), false);
    assert.equal(Delivery.buildIdeDeeplink('cursor', huge), '');
    assert.equal(Delivery.buildIdeDeeplink('claude', huge), '');
    assert.equal(Delivery.buildIdeDeeplink('codex', huge), '');
    assert.equal(Delivery.promptFitsDeeplink('task_description', huge), false);
  });

  it('a multi-suggestion Alt+Z block exceeds the Cursor URL cap and is not inlined', () => {
    const Fill = require('../lib/page-advisor-fill.js');
    const longVisible = '时间来源调用方模型Token转发耗时'.repeat(12);
    const longHtml = '<table class="w-full text-xs text-left min-w-[48rem]"><thead><tr>'
      + '<th class="py-1.5 pr-2 font-medium">时间</th>'.repeat(12);
    const detail = '建议为其添加 aria-label，概述这是一份自动创新调用记录及其列含义，让屏幕阅读器用户在跳转表格时能立刻判断内容范围。';
    const items = [];
    for (let i = 0; i < 7; i += 1) {
      items.push({
        id: 's' + i,
        title: '为调用记录表格补充说明 ' + i,
        detail: detail,
        label: 'table.w-full.text-xs.text-left.min-w-\\[48rem\\]',
        css_path: 'div#app > div.relative.h-screen > div.relative.flex > div.flex-1.min-w-0 > div.flex-1.min-w-0:nth-of-type(2) > div.p-8.f',
        visible_text: longVisible,
        html_snippet: longHtml,
        target_nid: i < 4 ? 'n11' : ('n' + (40 + i)),
      });
    }
    const block = Fill.formatSuggestionsBlock(
      items,
      'https://www.aidevpush.com/tenant/1/settings/page-advisor/',
    );
    const prefix = 'cursor://anysphere.cursor-deeplink/prompt?text=';
    const encodedLen = prefix.length + encodeURIComponent(block).length;
    assert.ok(
      encodedLen > Delivery.DEEPLINK_MAX_URL_LEN,
      `expected encoded deeplink ${encodedLen} to exceed ${Delivery.DEEPLINK_MAX_URL_LEN}`,
    );
    assert.equal(Delivery.promptFitsDeeplink('cursor', block), false);
    assert.equal(Delivery.buildIdeDeeplink('cursor', block), '');
    for (const target of ['cursor', 'claude', 'codex']) {
      const batches = Delivery.buildIdeDeeplinkBatches(target, block, '');
      assert.ok(batches.length > 1, `${target} batches=${batches.length}`);
      const decoded = [];
      for (let i = 0; i < batches.length; i += 1) {
        const url = Delivery.buildIdeDeeplink(target, batches[i]);
        assert.ok(url, `${target} batch ${i} must fit`);
        assert.ok(url.length <= Delivery.DEEPLINK_MAX_URL_LEN);
        const body = decodeURIComponent(url.slice(url.indexOf('=') + 1));
        assert.match(body, new RegExp(`批次 ${i + 1}/${batches.length}`));
        assert.match(body, /来源页:/);
        assert.equal(body.includes('…'), false);
        decoded.push(body);
      }
      const joined = decoded.join('\n');
      for (let i = 0; i < 7; i += 1) {
        assert.match(joined, new RegExp(`为调用记录表格补充说明 ${i}`));
      }
      assert.equal((joined.match(/- \*\*元素\*\*:/g) || []).length, 7);
    }
  });

  it('短文本仍是一条深链且正文不改写', () => {
    const text = 'fix login header';
    const batches = Delivery.buildIdeDeeplinkBatches('cursor', text, 'https://example.test/page');
    assert.deepEqual(batches, [text]);
    const url = Delivery.buildIdeDeeplink('cursor', batches[0]);
    assert.equal(url, 'cursor://anysphere.cursor-deeplink/prompt?text=' + encodeURIComponent(text));
  });

  it('单条建议自身超限时切开且不丢尾部', () => {
    const tail = 'TAIL_建议未被截断';
    const part = `- **元素**: only\n${'调整期望：'.repeat(800)}${tail}`;
    const batches = Delivery.buildIdeDeeplinkBatches('cursor', part, 'https://example.test/page');
    assert.ok(batches.length > 1);
    const pieces = [];
    for (const body of batches) {
      const url = Delivery.buildIdeDeeplink('cursor', body);
      assert.ok(url);
      assert.ok(url.length <= Delivery.DEEPLINK_MAX_URL_LEN);
      pieces.push(decodeURIComponent(url.split('text=')[1]));
    }
    const joined = pieces.join('\n');
    assert.match(joined, new RegExp(tail));
    assert.match(joined, /调整期望：/);
    assert.equal(joined.includes('…'), false);
  });

  it('formatUserStatus 多批用分批文案，单批仍说已填入', () => {
    const tx = (k, p) => {
      if (k === 'paDeliveryCursor') return 'Cursor';
      if (p && p.count) return `${k}:${p.count}:${p.name}`;
      if (p && p.name) return `${k}:${p.name}`;
      return k;
    };
    assert.equal(
      Delivery.formatUserStatus('cursor', {
        deeplinkOk: true,
        batchCount: 3,
        clipboardOk: true,
      }, tx).text,
      'paDeliverBatched:3:Cursor',
    );
    assert.equal(
      Delivery.formatUserStatus('cursor', {
        deeplinkOk: true,
        batchCount: 1,
        clipboardOk: true,
      }, tx).text,
      'paDeliverDeeplinkOk:Cursor',
    );
    assert.equal(
      Delivery.formatUserStatus('cursor', {
        deeplinkOk: false,
        clipboardOk: true,
      }, tx).text,
      'paDeliverClipboardOnly:Cursor',
    );
  });

  it('SW opens IDE via tabs.create deeplink', () => {
    const sw = fs.readFileSync(
      path.join(__dirname, '../background/sw-page-advisor-delivery.js'),
      'utf8',
    );
    assert.match(sw, /buildIdeDeeplink/);
    assert.match(sw, /chrome\.tabs\.create/);
    assert.match(sw, /deeplinkOk/);
    assert.match(sw, /persistPageAdvisorDeliveryTarget/);
    const rest = fs.readFileSync(
      path.join(__dirname, '../background/sw-messages-task.js'),
      'utf8',
    );
    assert.match(rest, /case 'persistPageAdvisorDeliveryTarget'/);
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

  it('manifest declares clipboardWrite and not nativeMessaging', () => {
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
    assert.ok(man.permissions.includes('clipboardWrite'));
    assert.equal(man.permissions.includes('nativeMessaging'), false);
    assert.equal(man.version, '1.8.225');
    const js = man.content_scripts[0].js;
    assert.ok(js.includes('lib/page-advisor-delivery.js'));
    assert.ok(js.includes('content/float-page-advisor-fill-ui.js'));
    assert.ok(js.includes('content/float-page-advisor-deliver.js'));
    assert.equal(fs.existsSync(path.join(__dirname, '../native-host/ide_bridge.py')), false);
  });
});
