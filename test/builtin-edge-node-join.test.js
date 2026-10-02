import test from 'node:test'
import assert from 'node:assert/strict'
import { saveBuiltinEdgeNodeJoin, loadBuiltinEdgeNodeJoin } from '../lib/builtin-edge-node-join.js'

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

test('save and load builtin edge node join', async () => {
  const storage = memStorage()
  const saved = await saveBuiltinEdgeNodeJoin(
    { offer_id: 'offer-1', node_id: 'node-9', device_label: 'desk' },
    storage,
  )
  assert.equal(saved.node_id, 'node-9')
  const loaded = await loadBuiltinEdgeNodeJoin('offer-1', storage)
  assert.equal(loaded.node_id, 'node-9')
  assert.equal(loaded.device_label, 'desk')
})
