import registry from '../../plugins/telepathy-meta-agents/registry.json'

export interface MetaInterface {
  id: 'prime' | 'build' | 'steward' | 'research' | 'relationships'
  name: string
  label: string
  purpose: string
  intendedHost: string
  fallbackPath: string
  status: string
  humanOwner: 'Unassigned'
}

const interfaceIds = ['prime', 'build', 'steward', 'research', 'relationships'] as const

export const interfaceCatalog: MetaInterface[] = interfaceIds.map((id) => {
  const entry = registry.interfaces.find((item) => item.id === id)
  if (!entry) throw new Error(`Canonical interface missing: ${id}`)

  return {
    id,
    name: entry.name,
    label: entry.label,
    purpose: entry.purpose,
    intendedHost: entry.host,
    fallbackPath: entry.path,
    status: entry.status.charAt(0).toUpperCase() + entry.status.slice(1),
    humanOwner: 'Unassigned',
  }
})
