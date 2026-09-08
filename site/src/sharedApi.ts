import type { Person, Post } from './types'

export interface Member { id: string; name: string; canInvite?: boolean }
export interface Artifact {
  id: string; ownerId: string; title: string; body: string; revision: number; digest: string
  sourceIds: string[]; slug: string | null; publishedRevision: number | null; publicUrl: string | null
}
export interface Lesson { id: string; ownerId: string; title: string; body: string; revision: number; status: string; sourceIds: string[]; program?: string; candidateDigest?: string; candidateSource?: string }
export interface SharedPost {
  id: string; authorId: string; type: Post['kind']; title?: string; body: string; createdAt: string
  resolved: boolean; acknowledgedBy: string[]; replies: Post['replies']; resolution?: Post['resolution']
}
export interface SharedWorkspace { people: Member[]; posts: SharedPost[]; artifacts: Artifact[]; lessons: Lesson[] }

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({ error: 'The workspace returned an unreadable response.' }))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`)
  return data as T
}
export function asPerson(member: Member): Person {
  return { ...member, initials: member.name.split(/\s+/).map(p => p[0]).slice(0, 2).join(''), onboarding: [] }
}
export function asPost(post: SharedPost): Post {
  return { ...post, kind: post.type, acknowledgements: post.acknowledgedBy,
    resolution: post.resolution ?? (post.resolved ? { summary: 'Resolved', resolvedAt: post.createdAt, resolvedBy: post.authorId } : undefined) }
}
