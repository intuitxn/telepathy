import type { ChangelogEntry, WorkspaceState } from './types'

export const initialWorkspace: WorkspaceState = {
  activePersonId: 'shubham',
  theme: 'light',
  people: [
    {
      id: 'shubham',
      name: 'Shubham Attri',
      initials: 'SA',
      onboarding: [
        { id: 'profile', label: 'Add working context', complete: true },
        { id: 'intro', label: 'Post an introduction', complete: true },
        { id: 'ack', label: 'Acknowledge a teammate', complete: true },
        { id: 'question', label: 'Ask or resolve a question', complete: true },
      ],
    },
    {
      id: 'om',
      name: 'Om',
      initials: 'OM',
      onboarding: [
        { id: 'profile', label: 'Add working context', complete: true },
        { id: 'intro', label: 'Post an introduction', complete: true },
        { id: 'ack', label: 'Acknowledge a teammate', complete: true },
        { id: 'question', label: 'Ask or resolve a question', complete: false },
      ],
    },
    {
      id: 'kush',
      name: 'Kush',
      initials: 'KU',
      onboarding: [
        { id: 'profile', label: 'Add working context', complete: true },
        { id: 'intro', label: 'Post an introduction', complete: true },
        { id: 'ack', label: 'Acknowledge a teammate', complete: false },
        { id: 'question', label: 'Ask or resolve a question', complete: false },
      ],
    },
  ],
  posts: [
    {
      id: 'welcome-to-telepathy',
      kind: 'announcement',
      authorId: 'shubham',
      title: 'Start here: how we use Telepathy',
      body:
        'Telepathy keeps updates, decisions, questions, and announcements in one calm timeline for Shubham, Om, and Kush. Post what changed, record a decision with its reasoning, ask a direct question, and acknowledge what you have read. This internal alpha is a local demo: activity stays in this browser and is not delivered to the other people.',
      createdAt: '2026-09-01T09:30:00.000Z',
      pinned: true,
      example: true,
      acknowledgements: ['om', 'kush'],
      replies: [
        {
          id: 'welcome-reply-om',
          authorId: 'om',
          body: 'Clear. I’ll use decisions for the why, not just the outcome.',
          createdAt: '2026-09-01T10:05:00.000Z',
          example: true,
        },
      ],
    },
    {
      id: 'decision-weekly-shape',
      kind: 'decision',
      authorId: 'om',
      title: 'One written weekly direction, then async follow-through',
      body:
        'We will start each week with one short direction note here. Follow-up stays attached as replies so the decision and its consequences remain together.',
      createdAt: '2026-09-01T12:15:00.000Z',
      example: true,
      acknowledgements: ['shubham'],
      replies: [],
    },
    {
      id: 'question-friday-review',
      kind: 'question',
      authorId: 'kush',
      title: 'What belongs in the Friday review?',
      body:
        'Should the review include every completed item, or only decisions, unresolved questions, and work that changes next week’s direction?',
      createdAt: '2026-09-01T15:40:00.000Z',
      example: true,
      acknowledgements: [],
      replies: [
        {
          id: 'friday-reply-shubham',
          authorId: 'shubham',
          body: 'Only signal: decisions, open questions, and changes to direction. Routine completions can stay in the feed.',
          createdAt: '2026-09-01T16:12:00.000Z',
          example: true,
        },
      ],
    },
    {
      id: 'update-prototype-ready',
      kind: 'update',
      authorId: 'shubham',
      body:
        'The first workspace shape is ready for us to try. Please use it like a real working surface and call out anything that creates noise.',
      createdAt: '2026-09-01T18:10:00.000Z',
      example: true,
      acknowledgements: ['om'],
      replies: [],
    },
  ],
}

export const changelog: ChangelogEntry[] = [
  {
    version: '0.1.0-alpha.1',
    date: '2 September 2026',
    title: 'Internal alpha workspace',
    summary: 'The first browser-local human workspace and accountable tool catalog are ready for evaluation.',
    changes: [
      'Added Now with updates, decisions, questions, announcements, replies, acknowledgements, and durable answers.',
      'Added People with local onboarding status for Shubham, Om, and Kush.',
      'Added Prime, Build, Steward, Research, and Relationships with their intended routes and honest planned status.',
      'Made required human ownership and the shared Job and artifact acceptance boundary explicit.',
      'Kept browser-only persistence and every intended subdomain visibly marked as not live.',
    ],
  },
]
