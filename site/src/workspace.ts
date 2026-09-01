import { initialWorkspace } from './seed'
import {
  personIds,
  postKinds,
  type PersonId,
  type Post,
  type PostKind,
  type Reply,
  type Theme,
  type WorkspaceState,
} from './types'

export const STORAGE_KEY = 'telepathy.workspace.v1'

export type WorkspaceAction =
  | { type: 'set-active-person'; personId: PersonId }
  | { type: 'set-theme'; theme: Theme }
  | { type: 'add-post'; post: Post }
  | { type: 'add-reply'; postId: string; reply: Reply }
  | { type: 'toggle-acknowledgement'; postId: string; personId: PersonId }
  | {
      type: 'resolve-question'
      postId: string
      personId: PersonId
      summary: string
      now: string
    }
  | { type: 'toggle-onboarding'; personId: PersonId; itemId: string }
  | { type: 'reset'; state: WorkspaceState }

const cloneInitialWorkspace = (): WorkspaceState =>
  JSON.parse(JSON.stringify(initialWorkspace)) as WorkspaceState

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'set-active-person':
      return { ...state, activePersonId: action.personId }
    case 'set-theme':
      return { ...state, theme: action.theme }
    case 'add-post':
      return { ...state, posts: [action.post, ...state.posts] }
    case 'add-reply':
      return {
        ...state,
        posts: state.posts.map((post) =>
          post.id === action.postId
            ? { ...post, replies: [...post.replies, action.reply] }
            : post,
        ),
      }
    case 'toggle-acknowledgement':
      return {
        ...state,
        posts: state.posts.map((post) => {
          if (post.id !== action.postId) return post
          if (post.authorId === action.personId) return post
          const hasAcknowledged = post.acknowledgements.includes(action.personId)
          return {
            ...post,
            acknowledgements: hasAcknowledged
              ? post.acknowledgements.filter((id) => id !== action.personId)
              : [...post.acknowledgements, action.personId],
          }
        }),
      }
    case 'resolve-question':
      return {
        ...state,
        posts: state.posts.map((post) => {
          if (
            post.id !== action.postId ||
            post.kind !== 'question' ||
            post.resolution ||
            !action.summary.trim()
          ) {
            return post
          }
          return {
            ...post,
            resolution: {
              summary: action.summary.trim(),
              resolvedAt: action.now,
              resolvedBy: action.personId,
            },
          }
        }),
      }
    case 'toggle-onboarding':
      return {
        ...state,
        people: state.people.map((person) =>
          person.id === action.personId
            ? {
                ...person,
                onboarding: person.onboarding.map((item) =>
                  item.id === action.itemId ? { ...item, complete: !item.complete } : item,
                ),
              }
            : person,
        ),
      }
    case 'reset':
      return action.state
  }
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkspaceState>
  return (
    personIds.includes(candidate.activePersonId as PersonId) &&
    (candidate.theme === 'light' || candidate.theme === 'dark') &&
    Array.isArray(candidate.posts) &&
    candidate.posts.every(
      (post) =>
        post &&
        typeof post.id === 'string' &&
        postKinds.includes(post.kind as PostKind) &&
        personIds.includes(post.authorId as PersonId) &&
        typeof post.body === 'string' &&
        typeof post.createdAt === 'string' &&
        Number.isFinite(Date.parse(post.createdAt)) &&
        (post.example === undefined || typeof post.example === 'boolean') &&
        Array.isArray(post.replies) &&
        post.replies.every(
          (reply) =>
            reply &&
            typeof reply.id === 'string' &&
            personIds.includes(reply.authorId as PersonId) &&
            typeof reply.body === 'string' &&
            typeof reply.createdAt === 'string' &&
            Number.isFinite(Date.parse(reply.createdAt)) &&
            (reply.example === undefined || typeof reply.example === 'boolean'),
        ) &&
        Array.isArray(post.acknowledgements) &&
        post.acknowledgements.every((id) => personIds.includes(id as PersonId)) &&
        (!post.resolution ||
          (typeof post.resolution.summary === 'string' &&
            typeof post.resolution.resolvedAt === 'string' &&
            Number.isFinite(Date.parse(post.resolution.resolvedAt)) &&
            personIds.includes(post.resolution.resolvedBy as PersonId))),
    ) &&
    Array.isArray(candidate.people) &&
    personIds.every((id) => candidate.people?.some((person) => person.id === id)) &&
    candidate.people.every(
      (person) =>
        person &&
        personIds.includes(person.id as PersonId) &&
        typeof person.name === 'string' &&
        typeof person.initials === 'string' &&
        Array.isArray(person.onboarding) &&
        person.onboarding.every(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.label === 'string' &&
            typeof item.complete === 'boolean',
        ),
    )
  )
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'>): WorkspaceState {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    if (!stored) return cloneInitialWorkspace()
    const parsed: unknown = JSON.parse(stored)
    return isWorkspaceState(parsed) ? parsed : cloneInitialWorkspace()
  } catch {
    return cloneInitialWorkspace()
  }
}

export function saveWorkspace(
  storage: Pick<Storage, 'setItem'>,
  state: WorkspaceState,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The workspace remains usable for this tab if browser storage is unavailable.
  }
}

function createId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${suffix}`
}

export function createPost(input: {
  kind: PostKind
  authorId: PersonId
  title?: string
  body: string
  now?: string
}): Post {
  return {
    id: createId('post'),
    kind: input.kind,
    authorId: input.authorId,
    title: input.title?.trim() || undefined,
    body: input.body.trim(),
    createdAt: input.now ?? new Date().toISOString(),
    acknowledgements: [],
    replies: [],
  }
}

export function createReply(input: {
  authorId: PersonId
  body: string
  now?: string
}): Reply {
  return {
    id: createId('reply'),
    authorId: input.authorId,
    body: input.body.trim(),
    createdAt: input.now ?? new Date().toISOString(),
  }
}
