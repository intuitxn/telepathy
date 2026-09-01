#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registryPath = join(pluginRoot, 'registry.json')
const activityRoot = resolve(process.argv[2] ?? join(process.cwd(), 'activity'))
const failures = []

const registry = JSON.parse(await readFile(registryPath, 'utf8'))
const interfaces = Array.isArray(registry.interfaces) ? registry.interfaces : []
const unique = { id: new Set(), host: new Set(), path: new Set() }

if (registry.version !== 1) failures.push('registry.version must be 1')
if (interfaces.length === 0) failures.push('registry.interfaces must not be empty')

for (const item of interfaces) {
  for (const key of ['id', 'name', 'purpose', 'host', 'path', 'status']) {
    if (typeof item[key] !== 'string' || item[key].trim() === '') {
      failures.push(`interface ${item.id ?? '<unknown>'}: ${key} is required`)
    }
  }
  for (const key of ['inputs', 'outputs']) {
    if (!Array.isArray(item[key]) || item[key].length === 0) {
      failures.push(`interface ${item.id ?? '<unknown>'}: ${key} must be non-empty`)
    }
  }
  for (const key of ['allow', 'deny']) {
    if (!Array.isArray(item.authority?.[key]) || item.authority[key].length === 0) {
      failures.push(`interface ${item.id ?? '<unknown>'}: authority.${key} must be non-empty`)
    }
  }
  if (item.host && !item.host.endsWith('.telepathy.intuitxn.com')) {
    failures.push(`interface ${item.id}: host must be under telepathy.intuitxn.com`)
  }
  if (item.path && !item.path.startsWith('/agents/')) {
    failures.push(`interface ${item.id}: path must start with /agents/`)
  }
  for (const key of Object.keys(unique)) {
    const value = item[key]
    if (unique[key].has(value)) failures.push(`duplicate interface ${key}: ${value}`)
    unique[key].add(value)
  }
}

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (extname(entry.name) === '.md' && entry.name !== 'README.md') files.push(path)
  }
  return files
}

const required = [
  'id',
  'occurred_at',
  'project',
  'kind',
  'initiator',
  'owner',
  'reviewer',
  'source_event_id',
  'artifact_id',
  'artifact_revision',
  'visibility',
]
const eventIds = new Set()
let activityFiles = []

try {
  await access(activityRoot)
  activityFiles = await walk(activityRoot)
} catch {
  activityFiles = []
}

for (const file of activityFiles) {
  const content = await readFile(file, 'utf8')
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) {
    failures.push(`${relative(process.cwd(), file)}: missing YAML frontmatter`)
    continue
  }
  const values = new Map()
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator > 0) values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  for (const key of required) {
    if (!values.get(key)) failures.push(`${relative(process.cwd(), file)}: missing ${key}`)
  }
  const id = values.get('id')
  if (id) {
    if (eventIds.has(id)) failures.push(`duplicate activity id: ${id}`)
    eventIds.add(id)
  }
  if (!content.includes('\n## Verification\n')) failures.push(`${relative(process.cwd(), file)}: missing Verification section`)
  if (!content.includes('\n## Limitations\n')) failures.push(`${relative(process.cwd(), file)}: missing Limitations section`)
  if (!content.includes('\n## Next action\n')) failures.push(`${relative(process.cwd(), file)}: missing Next action section`)
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log(`Validated ${interfaces.length} meta-agent interfaces and ${activityFiles.length} accepted activity records.`)
