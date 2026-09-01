import { initialWorkspace } from './seed'
import {
  STORAGE_KEY,
  createPost,
  createReply,
  loadWorkspace,
  saveWorkspace,
  workspaceReducer,
} from './workspace'

const freshState = () => JSON.parse(JSON.stringify(initialWorkspace)) as typeof initialWorkspace

describe('workspace state', () => {
  it('falls back to a clean seeded workspace when storage is empty or corrupt', () => {
    const emptyStorage = { getItem: () => null }
    const corruptStorage = { getItem: () => '{not-json' }

    expect(loadWorkspace(emptyStorage).posts[0].id).toBe('welcome-to-telepathy')
    expect(loadWorkspace(corruptStorage).people).toHaveLength(3)
    expect(loadWorkspace(emptyStorage)).not.toBe(initialWorkspace)

    const incompleteStorage = {
      getItem: () => JSON.stringify({
        activePersonId: 'shubham',
        theme: 'light',
        posts: [],
        people: [{ id: 'shubham' }, { id: 'om' }, { id: 'kush' }],
      }),
    }
    expect(loadWorkspace(incompleteStorage).posts[0].id).toBe('welcome-to-telepathy')

    const invalidDateState = freshState()
    invalidDateState.theme = 'dark'
    invalidDateState.posts[0].createdAt = 'not-a-date'
    expect(loadWorkspace({ getItem: () => JSON.stringify(invalidDateState) }).theme).toBe('light')
  })

  it('persists and restores JSON-safe workspace state', () => {
    const setItem = vi.fn()
    const state = freshState()
    saveWorkspace({ setItem }, state)

    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(state))
    const restored = loadWorkspace({ getItem: () => JSON.stringify(state) })
    expect(restored).toEqual(state)
    expect(() => saveWorkspace({ setItem: () => { throw new Error('blocked') } }, state)).not.toThrow()
  })

  it('creates posts and replies with trimmed human-authored content', () => {
    const post = createPost({
      kind: 'decision',
      authorId: 'om',
      title: '  Keep it small  ',
      body: '  Start with three people.  ',
      now: '2026-09-02T00:00:00.000Z',
    })
    const reply = createReply({
      authorId: 'kush',
      body: '  Agreed.  ',
      now: '2026-09-02T00:01:00.000Z',
    })

    expect(post).toMatchObject({
      kind: 'decision',
      authorId: 'om',
      title: 'Keep it small',
      body: 'Start with three people.',
    })
    expect(reply).toMatchObject({ authorId: 'kush', body: 'Agreed.' })
  })

  it('keeps acknowledgements unique per person and allows toggling them off', () => {
    const state = freshState()
    const postId = 'question-friday-review'
    const acknowledged = workspaceReducer(state, {
      type: 'toggle-acknowledgement',
      postId,
      personId: 'om',
    })
    const duplicated = workspaceReducer(acknowledged, {
      type: 'toggle-acknowledgement',
      postId,
      personId: 'om',
    })

    expect(acknowledged.posts.find((post) => post.id === postId)?.acknowledgements).toEqual(['om'])
    expect(duplicated.posts.find((post) => post.id === postId)?.acknowledgements).toEqual([])

    const ownPostAttempt = workspaceReducer(state, {
      type: 'toggle-acknowledgement',
      postId: 'welcome-to-telepathy',
      personId: 'shubham',
    })
    expect(ownPostAttempt.posts[0].acknowledgements).toEqual(['om', 'kush'])
  })

  it('adds a reply to only the selected post', () => {
    const state = freshState()
    const reply = createReply({ authorId: 'om', body: 'A direct answer.' })
    const next = workspaceReducer(state, {
      type: 'add-reply',
      postId: 'decision-weekly-shape',
      reply,
    })

    expect(next.posts.find((post) => post.id === 'decision-weekly-shape')?.replies).toContain(reply)
    expect(next.posts.find((post) => post.id === 'update-prototype-ready')?.replies).toHaveLength(0)
  })

  it('records a durable closing answer only for a question', () => {
    const state = freshState()
    const resolved = workspaceReducer(state, {
      type: 'resolve-question',
      postId: 'question-friday-review',
      personId: 'shubham',
      summary: '  Keep the recap to decisions and open questions.  ',
      now: '2026-09-02T05:00:00.000Z',
    })
    const unchanged = workspaceReducer(resolved, {
      type: 'resolve-question',
      postId: 'decision-weekly-shape',
      personId: 'shubham',
      summary: 'Not applicable.',
      now: '2026-09-02T05:00:00.000Z',
    })

    expect(resolved.posts.find((post) => post.id === 'question-friday-review')?.resolution).toMatchObject({
      summary: 'Keep the recap to decisions and open questions.',
      resolvedBy: 'shubham',
    })
    expect(unchanged.posts.find((post) => post.id === 'decision-weekly-shape')?.resolution).toBeUndefined()

    const blankAttempt = workspaceReducer(state, {
      type: 'resolve-question',
      postId: 'question-friday-review',
      personId: 'shubham',
      summary: '   ',
      now: '2026-09-02T05:00:00.000Z',
    })
    expect(blankAttempt.posts.find((post) => post.id === 'question-friday-review')?.resolution).toBeUndefined()

  })
})
