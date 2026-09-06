/**
 * Focused meta-agent interface catalog.
 *
 * Source of truth: `.opencode/agents/*.md` (the `telepathy.md` main agent plus
 * the five subagent charters) and the Buzz-native plugin in `plugins/telepathy/`.
 * This module is a static projection of those charters for the Interfaces view —
 * it is not an execution registry.
 *
 * `intendedHost` / `fallbackPath` are aspirational routing hints (the UI labels
 * them "Not live"). The agents themselves are opencode subagents invoked as
 * `@prime`, `@build`, `@steward`, `@research`, `@relationships` — not HTTP
 * services.
 */

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

export const interfaceCatalog: MetaInterface[] = [
  {
    id: 'prime',
    name: 'Prime',
    label: 'Project steward',
    purpose: 'Turn human intent into a reviewable job proposal.',
    intendedHost: 'prime.telepathy.intuitxn.com',
    fallbackPath: '/agents/prime',
    status: 'Planned',
    humanOwner: 'Unassigned',
  },
  {
    id: 'build',
    name: 'Build',
    label: 'Builder',
    purpose: 'Produce a tested candidate artifact from an accepted job.',
    intendedHost: 'build.telepathy.intuitxn.com',
    fallbackPath: '/agents/build',
    status: 'Planned',
    humanOwner: 'Unassigned',
  },
  {
    id: 'steward',
    name: 'Steward',
    label: 'Release keeper',
    purpose: 'Project accepted work into receipts, changelog, git, and knowledge views.',
    intendedHost: 'steward.telepathy.intuitxn.com',
    fallbackPath: '/agents/steward',
    status: 'Planned',
    humanOwner: 'Unassigned',
  },
  {
    id: 'research',
    name: 'Research',
    label: 'Research scout',
    purpose: 'Prepare evidence-backed research artifacts for human review.',
    intendedHost: 'research.telepathy.intuitxn.com',
    fallbackPath: '/agents/research',
    status: 'Planned',
    humanOwner: 'Unassigned',
  },
  {
    id: 'relationships',
    name: 'Relationships',
    label: 'Relationship desk',
    purpose: 'Prepare reviewed external-conversation drafts from approved context.',
    intendedHost: 'relationships.telepathy.intuitxn.com',
    fallbackPath: '/agents/relationships',
    status: 'Planned',
    humanOwner: 'Unassigned',
  },
]
