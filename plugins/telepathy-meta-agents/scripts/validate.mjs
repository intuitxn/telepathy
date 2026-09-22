#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STATUSES = new Set(['declared', 'planned', 'active', 'retired'])
const REQUIRED_INTERFACE_STRING_FIELDS = [
  'id',
  'name',
  'label',
  'purpose',
  'host',
  'path',
  'status',
  'agentFile',
  'runtime',
]
const REQUIRED_INTERFACE_LIST_FIELDS = ['jtbd', 'may', 'mustNot']
const ACTIVITY_FIELDS = [
  [/human\s+initiator|\binitiator\b/i, 'human initiator'],
  [/\bowner\b/i, 'owner'],
  [/\breviewer\b/i, 'reviewer'],
  [/exact\s+(artifact\s+)?revision|artifact\s+revision/i, 'exact artifact revision'],
  [/verification\s+evidence/i, 'verification evidence'],
  [/\blimitations?\b/i, 'limitations'],
  [/next\s+action/i, 'next action'],
]

const errors = []
const fail = message => errors.push(message)

const parseRoot = () => {
  const index = process.argv.indexOf('--root')
  if (index !== -1 && process.argv[index + 1]) return path.resolve(process.argv[index + 1])
  return path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
}

const root = parseRoot()

const isPlainObject = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const checkRegistry = () => {
  const file = path.join(root, 'plugins/telepathy-meta-agents/registry.json')
  if (!fs.existsSync(file)) {
    fail(`registry: missing ${path.relative(root, file)}`)
    return
  }
  let registry
  try {
    registry = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`registry: not valid JSON (${error.message})`)
    return
  }
  if (!isPlainObject(registry) || !Array.isArray(registry.interfaces)) {
    fail('registry: expected an object with an "interfaces" array')
    return
  }
  if (registry.interfaces.length === 0) fail('registry: "interfaces" is empty')
  const ids = new Set()
  registry.interfaces.forEach((entry, index) => {
    const at = `registry.interfaces[${index}]`
    if (!isPlainObject(entry)) {
      fail(`${at}: expected an object`)
      return
    }
    for (const field of REQUIRED_INTERFACE_STRING_FIELDS) {
      const value = entry[field]
      if (typeof value !== 'string' || value.trim() === '') {
        fail(`${at}: "${field}" must be a non-empty string`)
      }
    }
    for (const field of REQUIRED_INTERFACE_LIST_FIELDS) {
      const value = entry[field]
      if (!Array.isArray(value) || value.length === 0) {
        fail(`${at}: "${field}" must be a non-empty array`)
        continue
      }
      value.forEach((item, itemIndex) => {
        if (typeof item !== 'string' || item.trim() === '') {
          fail(`${at}.${field}[${itemIndex}]: must be a non-empty string`)
        }
      })
    }
    if (typeof entry.id === 'string') {
      if (ids.has(entry.id)) fail(`${at}: duplicate id "${entry.id}"`)
      ids.add(entry.id)
    }
    if (typeof entry.status === 'string' && !STATUSES.has(entry.status)) {
      fail(`${at}: status "${entry.status}" not one of ${[...STATUSES].join(', ')}`)
    }
    if (typeof entry.host === 'string' && /[:/]/.test(entry.host)) {
      fail(`${at}: host "${entry.host}" must be a bare hostname`)
    }
    if (typeof entry.path === 'string' && !entry.path.startsWith('/')) {
      fail(`${at}: path "${entry.path}" must start with "/"`)
    }
    if (typeof entry.agentFile === 'string' && entry.agentFile.trim() !== '') {
      const agentFile = path.join(root, entry.agentFile)
      if (!agentFile.startsWith(root + path.sep)) {
        fail(`${at}: agentFile "${entry.agentFile}" escapes the repository root`)
      } else if (!fs.existsSync(agentFile) || !fs.statSync(agentFile).isFile()) {
        fail(`${at}: agentFile "${entry.agentFile}" does not exist`)
      }
    }
  })
}

const collectEventFiles = dir => {
  const results = []
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name)
      if (fs.statSync(full).isDirectory()) walk(full)
      else results.push(full)
    }
  }
  walk(dir)
  return results
}

const checkActivity = () => {
  const activity = path.join(root, 'activity')
  if (!fs.existsSync(activity) || !fs.statSync(activity).isDirectory()) {
    fail('activity: missing activity/ directory')
    return
  }
  const eventIds = new Map()
  for (const file of collectEventFiles(activity)) {
    const relative = path.relative(activity, file).split(path.sep)
    if (path.basename(file) === 'README.md') continue
    if (relative.length !== 4) {
      fail(`activity: ${relative.join('/')} must match activity/<project>/<year>/<month>/<event-id>.md`)
      continue
    }
    const [project, year, month, basename] = relative
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(project)) {
      fail(`activity: project "${project}" must be a lowercase slug`)
    }
    if (!/^\d{4}$/.test(year)) fail(`activity: year "${year}" must be four digits`)
    if (!/^(0[1-9]|1[0-2])$/.test(month)) fail(`activity: month "${month}" must be 01-12`)
    if (!/^[a-z0-9][a-z0-9._-]*\.md$/.test(basename)) {
      fail(`activity: event file "${basename}" must be a lowercase slug ending in .md`)
    }
    const eventId = basename.replace(/\.md$/, '')
    if (eventIds.has(eventId)) {
      fail(`activity: event id "${eventId}" is not unique (also at ${eventIds.get(eventId)})`)
    }
    eventIds.set(eventId, relative.join('/'))
    const body = fs.readFileSync(file, 'utf8')
    for (const [pattern, label] of ACTIVITY_FIELDS) {
      if (!pattern.test(body)) fail(`activity: ${relative.join('/')} is missing "${label}"`)
    }
  }
}

checkRegistry()
checkActivity()

if (errors.length > 0) {
  console.error('activity-integrity: FAILED')
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`activity-integrity: OK (registry + activity validated in ${root})`)
