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
    storage,
    apiRequest: async (method, path, body) => {
      calls.push({ method, path, body })
      return { id: 'node-9', device_label: body.device_label }
    },
  })
  assert.equal(out.nodeId, 'node-9')
  assert.equal(out.projectId, 'proj-1')
  assert.equal(calls[0].method, 'POST')
  assert.match(calls[0].path, /offers\/proj-1\/nodes/)
  assert.equal(storage._data.builtinEdgeOfferNodes['proj-1'].node_id, 'node-9')
})

test('runBuiltinEdgeKeepaliveRound heartbeats and polls tunnel', async () => {
  const paths = []
  const tunnel = []
  const result = await runBuiltinEdgeKeepaliveRound({
    projectId: 'o1',
    nodeId: 'n1',
    apiRequest: async (method, path) => {
      paths.push(`${method} ${path}`)
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
