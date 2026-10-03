import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('../lib/builtin-edge-node-join.js')
const {
  registerPluginToSellProject,
  runBuiltinEdgeKeepaliveRound,
} = require('../lib/builtin-edge-tunnel.js')

function memStorage() {
  const data = {}
  return {
    get(keys, cb) {
      const out = {}
      for (const k of keys) out[k] = data[k]
      cb(out)
    },
    set(obj, cb) {
      Object.assign(data, obj)
      cb()
    },
    _data: data,
  }
}

test('registerPluginToSellProject calls nodes API and persists join', async () => {
  const calls = []
  const storage = memStorage()
  const out = await registerPluginToSellProject({
    projectId: 'proj-1',
    deviceLabel: 'desk',
    installFingerprint: 'pf_test_abc12345',
    supportedModels: ['builtin-edge'],
    storage,
    apiRequest: async (method, path, body) => {
      calls.push({ method, path, body })
      return { id: 'node-9', device_label: body.device_label, install_fingerprint: body.install_fingerprint }
    },
  })
  assert.equal(out.nodeId, 'node-9')
  assert.equal(out.projectId, 'proj-1')
  assert.equal(out.installFingerprint, 'pf_test_abc12345')
  assert.equal(calls[0].method, 'POST')
  assert.match(calls[0].path, /offers\/proj-1\/nodes/)
  assert.equal(calls[0].body.install_fingerprint, 'pf_test_abc12345')
  assert.deepEqual(calls[0].body.supported_models, ['builtin-edge'])
  assert.equal(storage._data.builtinEdgeOfferNodes['proj-1'].node_id, 'node-9')
  assert.equal(storage._data.builtinEdgeOfferNodes['proj-1'].install_fingerprint, 'pf_test_abc12345')
})

test('runBuiltinEdgeKeepaliveRound heartbeats and polls tunnel', async () => {
  const paths = []
  const tunnel = []
  const result = await runBuiltinEdgeKeepaliveRound({
    projectId: 'o1',
    nodeId: 'n1',
    supportedModels: ['builtin-edge'],
    apiRequest: async (method, path, body) => {
      paths.push(`${method} ${path}`)
      assert.deepEqual(body.supported_models, ['builtin-edge'])
      return {}
    },
    tunnelFetch: async (action, body) => {
      tunnel.push({ action, body })
      if (action === 'poll') return { job: { id: 'j1' } }
      return { session_id: 's1' }
    },
  })
  assert.ok(paths.some((p) => p.includes('/heartbeat')))
  assert.deepEqual(tunnel.map((t) => t.action), ['register', 'poll'])
  assert.equal(result.polled.id, 'j1')
})

test('runBuiltinEdgeKeepaliveRound 心跳携带 install_fingerprint 回写（OPT-20261003-021）', async () => {
  const bodies = []
  await runBuiltinEdgeKeepaliveRound({
    projectId: 'o1',
    nodeId: 'n1',
    installFingerprint: 'pf_reinstalled_9f',
    apiRequest: async (method, path, body) => {
      if (String(path).includes('/heartbeat')) bodies.push(body)
      return {}
    },
    tunnelFetch: async (action) => (action === 'poll' ? { job: null } : {}),
  })
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].install_fingerprint, 'pf_reinstalled_9f')
  assert.equal(bodies[0].online, true)
})

test('runBuiltinEdgeKeepaliveRound 无指纹来源时省略 install_fingerprint', async () => {
  const bodies = []
  await runBuiltinEdgeKeepaliveRound({
    projectId: 'o1',
    nodeId: 'n1',
    apiRequest: async (method, path, body) => {
      if (String(path).includes('/heartbeat')) bodies.push(body)
      return {}
    },
    tunnelFetch: async (action) => (action === 'poll' ? { job: null } : {}),
  })
  assert.equal(bodies.length, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(bodies[0], 'install_fingerprint'), false)
})

test('executeBuiltinEdgeTunnelJob runs LanguageModel via builtin prompt adapter', async () => {
  const { executeBuiltinEdgeTunnelJob } = require('../lib/builtin-edge-tunnel.js')
  const calls = []
  const fakeLm = { tag: 'lm' }
  const out = await executeBuiltinEdgeTunnelJob(
    { id: 'j1', payload: { prompt: 'hello edge' } },
    {
      languageModel: fakeLm,
      locale: 'en',
      builtinPrompt: {
        async run(lm, locale, text) {
          calls.push({ lm, locale, text })
          return { availability: 'available', result: 'world' }
        },
      },
    },
  )
  assert.equal(out.ok, true)
  assert.equal(out.result.content, 'world')
  assert.equal(calls[0].text, 'hello edge')
  assert.equal(calls[0].locale, 'en')
  assert.equal(calls[0].lm, fakeLm)
})

test('executeBuiltinEdgeTunnelJob reports unavailable without LanguageModel', async () => {
  const { executeBuiltinEdgeTunnelJob } = require('../lib/builtin-edge-tunnel.js')
  const out = await executeBuiltinEdgeTunnelJob(
    { payload: { prompt: 'x' } },
    { languageModel: null, builtinPrompt: { async run() { return {} } } },
  )
  assert.equal(out.ok, false)
  assert.equal(out.error, 'language_model_unavailable')
})
