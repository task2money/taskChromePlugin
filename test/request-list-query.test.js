'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Query = require('../lib/request-list-query.js');

const {
  resourceTypeBucket,
  filterRequests,
  sortRequests,
  nextSortState,
  queryRequestList,
} = Query;

function req(partial) {
  return {
    id: 'id',
    method: 'GET',
    url: 'https://example.com/a',
    statusCode: 200,
    canceled: false,
    type: 'xhr',
    time: 10,
    timestamp: 1000,
    ...partial,
  };
}

describe('resourceTypeBucket', () => {
  it('maps xhr/fetch/preflight to xhr', () => {
    assert.equal(resourceTypeBucket('xhr'), 'xhr');
    assert.equal(resourceTypeBucket('Fetch'), 'xhr');
    assert.equal(resourceTypeBucket('preflight'), 'xhr');
  });

  it('maps document frames to doc', () => {
    assert.equal(resourceTypeBucket('document'), 'doc');
    assert.equal(resourceTypeBucket('main_frame'), 'doc');
    assert.equal(resourceTypeBucket('sub_frame'), 'doc');
  });

  it('maps script/stylesheet/image families', () => {
    assert.equal(resourceTypeBucket('script'), 'js');
    assert.equal(resourceTypeBucket('stylesheet'), 'css');
    assert.equal(resourceTypeBucket('image'), 'img');
    assert.equal(resourceTypeBucket('imageset'), 'img');
  });

  it('maps empty and unknown to other', () => {
    assert.equal(resourceTypeBucket(''), 'other');
    assert.equal(resourceTypeBucket(undefined), 'other');
    assert.equal(resourceTypeBucket('websocket'), 'other');
    assert.equal(resourceTypeBucket('font'), 'other');
  });
});

describe('filterRequests', () => {
  const list = [
    req({ id: '1', url: 'https://api.example.com/users', method: 'GET', statusCode: 200, type: 'xhr' }),
    req({ id: '2', url: 'https://api.example.com/users', method: 'POST', statusCode: 201, type: 'fetch' }),
    req({ id: '3', url: 'https://cdn.example.com/app.js', method: 'GET', statusCode: 200, type: 'script' }),
    req({ id: '4', url: 'https://api.example.com/fail', method: 'GET', statusCode: 404, type: 'xhr' }),
    req({ id: '5', url: 'https://api.example.com/abort', method: 'GET', statusCode: 0, canceled: true, type: 'xhr' }),
    req({ id: '6', url: 'https://example.com/', method: 'GET', statusCode: 200, type: 'document' }),
  ];

  it('T1 search matches URL', () => {
    const out = filterRequests(list, { search: 'app.js' });
    assert.deepEqual(out.map((r) => r.id), ['3']);
  });

  it('T2 search canceled matches canceled label', () => {
    const out = filterRequests(list, { search: 'canceled' });
    assert.deepEqual(out.map((r) => r.id), ['5']);
  });

  it('T3 method=POST keeps only POST', () => {
    const out = filterRequests(list, { method: 'POST' });
    assert.deepEqual(out.map((r) => r.id), ['2']);
  });

  it('T4 status=4xx keeps 400-499', () => {
    const out = filterRequests(list, { status: '4xx' });
    assert.deepEqual(out.map((r) => r.id), ['4']);
  });

  it('T5 status=canceled keeps canceled only', () => {
    const out = filterRequests(list, { status: 'canceled' });
    assert.deepEqual(out.map((r) => r.id), ['5']);
  });

  it('T6 type=xhr keeps xhr/fetch, drops script', () => {
    const out = filterRequests(list, { type: 'xhr' });
    assert.deepEqual(out.map((r) => r.id), ['1', '2', '4', '5']);
  });

  it('type=doc keeps document', () => {
    const out = filterRequests(list, { type: 'doc' });
    assert.deepEqual(out.map((r) => r.id), ['6']);
  });

  it('combines search + method + status', () => {
    const out = filterRequests(list, { search: 'users', method: 'GET', status: '2xx' });
    assert.deepEqual(out.map((r) => r.id), ['1']);
  });

  it('empty filters return a shallow copy of all', () => {
    const out = filterRequests(list, {});
    assert.equal(out.length, list.length);
    assert.notEqual(out, list);
  });
});

describe('sortRequests', () => {
  it('T7 timestamp desc puts newer first', () => {
    const list = [
      req({ id: 'old', timestamp: 1 }),
      req({ id: 'new', timestamp: 9 }),
    ];
    const out = sortRequests(list, { key: 'timestamp', dir: 'desc' });
    assert.deepEqual(out.map((r) => r.id), ['new', 'old']);
  });

  it('T8 time asc puts smaller duration first', () => {
    const list = [
      req({ id: 'slow', time: 80 }),
      req({ id: 'fast', time: 5 }),
    ];
    const out = sortRequests(list, { key: 'time', dir: 'asc' });
    assert.deepEqual(out.map((r) => r.id), ['fast', 'slow']);
  });

  it('T9 method asc is lexicographic', () => {
    const list = [
      req({ id: 'g', method: 'GET' }),
      req({ id: 'd', method: 'DELETE' }),
    ];
    const out = sortRequests(list, { key: 'method', dir: 'asc' });
    assert.deepEqual(out.map((r) => r.id), ['d', 'g']);
  });

  it('T10 status asc treats canceled as -1 before 200', () => {
    const list = [
      req({ id: 'ok', statusCode: 200, canceled: false }),
      req({ id: 'aborted', statusCode: 0, canceled: true }),
    ];
    const out = sortRequests(list, { key: 'status', dir: 'asc' });
    assert.deepEqual(out.map((r) => r.id), ['aborted', 'ok']);
  });

  it('url sort is case-insensitive', () => {
    const list = [
      req({ id: 'b', url: 'https://Z.example.com/' }),
      req({ id: 'a', url: 'https://a.example.com/' }),
    ];
    const out = sortRequests(list, { key: 'url', dir: 'asc' });
    assert.deepEqual(out.map((r) => r.id), ['a', 'b']);
  });

  it('ties break on id for stability', () => {
    const list = [
      req({ id: 'b', timestamp: 5 }),
      req({ id: 'a', timestamp: 5 }),
    ];
    const out = sortRequests(list, { key: 'timestamp', dir: 'desc' });
    assert.deepEqual(out.map((r) => r.id), ['a', 'b']);
  });
});

describe('nextSortState', () => {
  it('T11 same column toggles desc to asc', () => {
    assert.deepEqual(
      nextSortState({ key: 'time', dir: 'desc' }, 'time'),
      { key: 'time', dir: 'asc' }
    );
  });

  it('T11 same column toggles asc to desc', () => {
    assert.deepEqual(
      nextSortState({ key: 'url', dir: 'asc' }, 'url'),
      { key: 'url', dir: 'desc' }
    );
  });

  it('T12 new numeric column defaults to desc', () => {
    assert.deepEqual(
      nextSortState({ key: 'timestamp', dir: 'desc' }, 'time'),
      { key: 'time', dir: 'desc' }
    );
    assert.deepEqual(
      nextSortState({ key: 'url', dir: 'asc' }, 'status'),
      { key: 'status', dir: 'desc' }
    );
  });

  it('T12 new string column defaults to asc', () => {
    assert.deepEqual(
      nextSortState({ key: 'timestamp', dir: 'desc' }, 'method'),
      { key: 'method', dir: 'asc' }
    );
    assert.deepEqual(
      nextSortState({ key: 'time', dir: 'desc' }, 'url'),
      { key: 'url', dir: 'asc' }
    );
  });
});

describe('queryRequestList', () => {
  it('T13 applies filter then sort then limit', () => {
    const list = [];
    for (let i = 0; i < 5; i += 1) {
      list.push(req({
        id: `n${i}`,
        method: 'GET',
        url: `https://example.com/${i}`,
        timestamp: 100 + i,
        type: 'xhr',
      }));
    }
    list.push(req({ id: 'script', type: 'script', timestamp: 999 }));
    const out = queryRequestList(list, {
      type: 'xhr',
      sortKey: 'timestamp',
      sortDir: 'desc',
    }, { limit: 3 });
    assert.deepEqual(out.map((r) => r.id), ['n4', 'n3', 'n2']);
  });

  it('does not mutate the input array', () => {
    const list = [req({ id: 'a', timestamp: 1 }), req({ id: 'b', timestamp: 2 })];
    const snapshot = list.map((r) => r.id);
    queryRequestList(list, { sortKey: 'timestamp', sortDir: 'desc' });
    assert.deepEqual(list.map((r) => r.id), snapshot);
  });
});

describe('panel applyRequestFilters wiring', () => {
  const vm = require('node:vm');

  it('uses RequestListQuery and keeps type/sort state', () => {
    const rendered = [];
    const fields = {
      '#requestSearch': { value: 'users', addEventListener() {} },
      '#requestMethodFilter': { value: 'GET', addEventListener() {} },
      '#requestStatusFilter': { value: '2xx', addEventListener() {} },
      '#requestCount': { textContent: '' },
    };
    const P = {
      state: {
        recentRequests: [
          req({ id: 'keep', method: 'GET', url: 'https://api.example.com/users', statusCode: 200, type: 'xhr', timestamp: 1 }),
          req({ id: 'drop-method', method: 'POST', url: 'https://api.example.com/users', statusCode: 201, type: 'xhr', timestamp: 2 }),
          req({ id: 'newer', method: 'GET', url: 'https://api.example.com/users', statusCode: 200, type: 'xhr', timestamp: 9 }),
        ],
        selectedRequest: null,
        requestTypeFilter: 'xhr',
        requestSort: { key: 'timestamp', dir: 'asc' },
      },
      $(sel) { return fields[sel]; },
      $$() { return []; },
      renderRequestList(list) { rendered.push(list.map((r) => r.id)); },
    };
    const ctx = {
      window: { PanelApp: P, RequestListQuery: Query },
      globalThis: { RequestListQuery: Query },
      document: { querySelector() { return null; }, querySelectorAll() { return []; } },
    };
    vm.createContext(ctx);
    const src = fs.readFileSync(path.join(__dirname, '../panel/tabs/single-request.js'), 'utf8');
    vm.runInContext(src, ctx, { filename: 'single-request.js' });
    P.renderRequestList = (list) => { rendered.push(list.map((r) => r.id)); };
    P.applyRequestFilters();
    assert.deepEqual(rendered[0], ['keep', 'newer']);
    assert.equal(fields['#requestCount'].textContent, '共 2 条');
  });
});

describe('panel markup contract', () => {
  const html = fs.readFileSync(path.join(__dirname, '../panel/panel.html'), 'utf8');

  it('loads request-list-query.js before single-request.js', () => {
    const lib = html.indexOf('lib/request-list-query.js');
    const tab = html.indexOf('tabs/single-request.js');
    assert.ok(lib >= 0, 'missing request-list-query.js script');
    assert.ok(tab > lib, 'request-list-query.js must load before single-request.js');
  });

  it('has sortable column headers', () => {
    for (const key of ['method', 'status', 'url', 'time', 'timestamp']) {
      assert.match(html, new RegExp(`data-sort="${key}"`));
    }
  });

  it('has resource type chips including xhr and other', () => {
    assert.match(html, /id="requestTypeFilters"/);
    assert.match(html, /data-type="xhr"/);
    assert.match(html, /data-type="other"/);
  });

  it('method filter includes OPTIONS and HEAD', () => {
    assert.match(html, /<option value="OPTIONS">OPTIONS<\/option>/);
    assert.match(html, /<option value="HEAD">HEAD<\/option>/);
  });
});
