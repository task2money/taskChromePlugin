/**
 * aidevpush.yaml 轻量解析 + 页面 meta 读取（与 task2app aidevpushMeta.js 同构）
 */

const FORBIDDEN_TOP_KEYS = new Set([
  'workspace_id',
  'workspace_ids',
  'project_id',
  'project_ids',
  'company_id',
  'tenant_id',
])

const SERVICE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/
const TAG_MAX_LENGTH = 64
const TAGS_MAX_COUNT = 20

function stripYamlComment(line) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    if (c === '"' && !inSingle) inDouble = !inDouble
    if (c === '#' && !inSingle && !inDouble) return line.slice(0, i).trimEnd()
  }
  return line
}

function parseYamlScalar(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return Number(s)
  return s
}

function parseSimpleYaml(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const root = {}
  let currentKey = null
  let listItems = null

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine)
    if (!line.trim()) continue

    const listMatch = line.match(/^\s+-\s+(.*)$/)
    if (listMatch && currentKey && listItems) {
      listItems.push(parseYamlScalar(listMatch[1]))
      continue
    }

    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!kvMatch) {
      throw new Error(`无法解析 YAML 行: ${line.trim()}`)
    }

    const key = kvMatch[1]
    const rest = kvMatch[2]

    if (rest === '') {
      currentKey = key
      listItems = []
      root[key] = listItems
    } else {
      currentKey = null
      listItems = null
      root[key] = parseYamlScalar(rest)
    }
  }

  return root
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  const out = []
  const seen = new Set()
  for (const raw of tags) {
    const tag = String(raw ?? '').trim()
    if (!tag || tag.length > TAG_MAX_LENGTH) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= TAGS_MAX_COUNT) break
  }
  return out
}

function parseTagsList(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map((t) => String(t ?? '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((t) => t.trim()).filter(Boolean)
  }
  return []
}

function assertTagConstraints(tags) {
  if (!tags.length) throw new Error('aidevpush.yaml tags 不能为空')
  if (tags.length > TAGS_MAX_COUNT) {
    throw new Error(`aidevpush.yaml tags 最多 ${TAGS_MAX_COUNT} 个`)
  }
  for (const tag of tags) {
    if (tag.length > TAG_MAX_LENGTH) {
      throw new Error(`aidevpush.yaml 标签过长（>${TAG_MAX_LENGTH}）: ${tag}`)
    }
  }
}

function parseAidevpushYaml(text) {
  const root = parseSimpleYaml(text)

  for (const key of Object.keys(root)) {
    if (FORBIDDEN_TOP_KEYS.has(key)) {
      throw new Error(`aidevpush.yaml 禁止顶层键: ${key}`)
    }
  }

  const version = root.version
  if (version !== undefined && version !== 1 && version !== '1') {
    throw new Error('aidevpush.yaml version 必须为 1')
  }

  const service_id = String(root.service_id ?? '').trim()
  if (!SERVICE_ID_RE.test(service_id)) {
    throw new Error('aidevpush.yaml service_id 格式无效')
  }

  let tags = normalizeTags(parseTagsList(root.tags))
  const svcTag = `svc:${service_id}`
  if (!tags.some((t) => t.toLowerCase() === svcTag.toLowerCase())) {
    tags = normalizeTags([svcTag, ...tags])
  }
  assertTagConstraints(tags)

  const display_name = root.display_name != null ? String(root.display_name).trim() : ''

  return { service_id, tags, display_name }
}

function readAidevMetaFromDocument(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null)
  if (!d) return null

  const sidEl = d.querySelector('meta[name="aidev-service-id"]')
  const tagsEl = d.querySelector('meta[name="aidev-tags"]')
  const service_id = String(sidEl?.getAttribute('content') || '').trim()
  if (!service_id) return null

  const tagsRaw = String(tagsEl?.getAttribute('content') || '').trim()
  const tags = tagsRaw
    ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  return { service_id, tags }
}

function uniqueWorkspaceIdsFromMatches(matches) {
  return [...new Set(
    (matches || [])
      .map((m) => String(m.workspace_id || '').trim())
      .filter(Boolean),
  )]
}

function projectIdsForWorkspace(matches, workspaceId) {
  const ws = String(workspaceId || '').trim()
  return [...new Set(
    (matches || [])
      .filter((m) => String(m.workspace_id || '').trim() === ws)
      .map((m) => String(m.project_id || '').trim())
      .filter(Boolean),
  )]
}

function formatAidevResolveStatus(matches) {
  const n = (matches || []).length
  if (!n) return '页面元信息未匹配到项目'
  const wsCount = uniqueWorkspaceIdsFromMatches(matches).length
  if (wsCount <= 1) return `已根据页面元信息匹配 ${n} 个项目`
  return `已根据页面元信息匹配 ${n} 个项目（${wsCount} 个工作空间）`
}

function readAidevMetaEvalExpression() {
  return `(() => {
    const sidEl = document.querySelector('meta[name="aidev-service-id"]');
    const tagsEl = document.querySelector('meta[name="aidev-tags"]');
    const service_id = (sidEl && sidEl.getAttribute('content') || '').trim();
    if (!service_id) return null;
    const tagsRaw = (tagsEl && tagsEl.getAttribute('content') || '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    return { service_id: service_id, tags: tags };
  })()`
}

function readAidevMetaFromInspectedWindow(inspectedWindow) {
  const iw = inspectedWindow || (typeof chrome !== 'undefined' && chrome.devtools?.inspectedWindow)
  if (!iw?.eval) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    iw.eval(readAidevMetaEvalExpression(), (result, isException) => {
      if (isException || !result?.service_id) {
        resolve(null)
        return
      }
      resolve(result)
    })
  })
}

const AidevMeta = {
  parseAidevpushYaml,
  readAidevMetaFromDocument,
  readAidevMetaFromInspectedWindow,
  uniqueWorkspaceIdsFromMatches,
  projectIdsForWorkspace,
  formatAidevResolveStatus,
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AidevMeta
}
if (typeof globalThis !== 'undefined') {
  globalThis.AidevMeta = AidevMeta
}
