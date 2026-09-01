export const personIds = ['shubham', 'om', 'kush'] as const
export type PersonId = (typeof personIds)[number]

export const postKinds = ['update', 'decision', 'question', 'announcement'] as const
export type PostKind = (typeof postKinds)[number]
export type Theme = 'light' | 'dark'
export type ViewName = 'now' | 'people' | 'interfaces' | 'changelog'

export interface Reply {
  id: string
  authorId: PersonId
  body: string
  createdAt: string
  example?: boolean
}

export interface Post {
  id: string
  kind: PostKind
  authorId: PersonId
  title?: string
  body: string
  createdAt: string
  pinned?: boolean
  example?: boolean
  acknowledgements: PersonId[]
  replies: Reply[]
  resolution?: {
    summary: string
    resolvedAt: string
    resolvedBy: PersonId
  }
}

export interface OnboardingItem {
  id: string
  label: string
  complete: boolean
}

export interface Person {
  id: PersonId
  name: string
  initials: string
  onboarding: OnboardingItem[]
}

export interface WorkspaceState {
  activePersonId: PersonId
  theme: Theme
  posts: Post[]
  people: Person[]
}

export interface ChangelogEntry {
  version: string
  date: string
  title: string
  summary: string
  changes: string[]
}
