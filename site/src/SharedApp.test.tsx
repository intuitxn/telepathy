import { StrictMode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SharedApp } from './SharedApp'
import { WorkspaceEntry } from './WorkspaceEntry'
import type { Artifact, SharedWorkspace } from './sharedApi'

function server() {
  let authenticated = false
  let rejectPost = false
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const state: SharedWorkspace = {
    people: [{ id: 'member-1', name: 'Shubham', canInvite: true }, { id: 'member-2', name: 'Om' }],
    posts: [{ id: 'thread-1', authorId: 'member-2', type: 'question', title: 'A shared product', body: 'Which part should become a report?', createdAt: '2026-09-08T10:00:00Z', resolved: false, acknowledgedBy: [], replies: [] }], artifacts: [], lessons: [],
  }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input).replace('/api', '')
    const body = JSON.parse(String(options?.body || '{}'))
    calls.push({ path, body })
    let result: unknown = {}
    if (path === '/config') result = { mode: 'shared' }
    else if (path === '/me') result = { person: authenticated ? state.people[0] : null }
    else if (path === '/login') { authenticated = true; result = { person: state.people[0] } }
    else if (path === '/workspace') result = state
    else if (path === '/posts') {
      if (rejectPost) return new Response(JSON.stringify({ error: 'Connection failed. Retry your draft.' }), { status: 503 })
      state.posts.push({ ...body, id: 'thread-2', authorId: 'member-1', createdAt: new Date().toISOString(), resolved: false, acknowledgedBy: [], replies: [] })
    }
    else if (path.endsWith('/replies')) state.posts[0].replies.push({ id: 'reply-1', authorId: 'member-1', body: body.body, createdAt: new Date().toISOString() })
    else if (path.startsWith('/lessons/') && path.endsWith('/accept')) { state.lessons[0].status = 'accepted'; result = state.lessons[0] }
    else if (path === '/artifacts') {
      const artifact: Artifact = { id: 'page-1', ownerId: 'member-1', title: body.title, body: 'Selected conversation content', revision: 1, digest: 'digest-1', sourceIds: body.sourceIds, slug: null, publishedRevision: null, publicUrl: null }
      state.artifacts.push(artifact); result = artifact
    } else if (path.startsWith('/artifacts/page-1')) {
      const artifact = state.artifacts[0]
      if (path.endsWith('/publish')) Object.assign(artifact, { slug: body.slug, publishedRevision: artifact.revision, publicUrl: `https://telepathy.intuitxn.com/p/${body.slug}` })
      else if (path.endsWith('/unpublish')) Object.assign(artifact, { publishedRevision: null, publicUrl: null })
      else if (options?.method === 'PATCH') Object.assign(artifact, { title: body.title, body: body.body, revision: artifact.revision + 1, digest: `digest-${artifact.revision + 1}` })
      result = artifact
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  return { calls, fetchMock, state, rejectPosts: () => { rejectPost = true } }
}

async function signIn() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Invitation code'), 'personal-secret')
  await user.click(screen.getByRole('button', { name: 'Open workspace' }))
  await screen.findByText('Signed in as Shubham')
  return user
}

describe('Shared Telepathy', () => {
  it('signs in, replies, selects sources, reviews and publishes an exact revision, updates and withdraws it', async () => {
    const mock = server()
    render(<WorkspaceEntry />)
    const user = await signIn()
    expect(screen.queryByRole('combobox', { name: 'Demo identity' })).not.toBeInTheDocument()
    expect(window.localStorage.length).toBe(0)
    expect(screen.queryByRole('button', { name: 'Resolve question' })).not.toBeInTheDocument()
    expect(mock.fetchMock.mock.calls.every(([, options]) => options?.credentials === 'same-origin')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Add reply' }))
    await user.type(screen.getByRole('textbox', { name: 'Add reply as Shubham' }), 'Build the shared publishing flow first.')
    await user.click(screen.getByRole('button', { name: 'Add reply' }))
    expect(await screen.findByText('Build the shared publishing flow first.')).toBeInTheDocument()
    await user.click(screen.getByText('Select messages for a page or lesson'))
    await user.click(screen.getByRole('checkbox', { name: 'A shared product' }))
    await user.click(screen.getByRole('button', { name: 'Create page' }))
    const title = await screen.findByRole('textbox', { name: 'Page title' })
    await user.clear(title); await user.type(title, 'Our shared workflow')
    await user.click(screen.getByRole('button', { name: 'Now' }))
    await user.click(screen.getByRole('button', { name: 'Pages' }))
    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveValue('Our shared workflow')
    const discard = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: '← All pages' }))
    expect(discard).toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveValue('Our shared workflow')
    expect(screen.getByRole('button', { name: 'Publish page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(await screen.findByRole('button', { name: 'Preview saved page' }))
    expect(screen.getByTitle('Public page preview')).toHaveAttribute('src', '/api/artifacts/page-1/preview')
    await user.click(screen.getByRole('checkbox', { name: /I reviewed this saved revision/ }))
    await user.click(screen.getByRole('button', { name: 'Publish page' }))
    const link = await screen.findByRole('link', { name: 'https://telepathy.intuitxn.com/p/untitled-report' })
    expect(link).toBeInTheDocument()
    expect(mock.calls.find(call => call.path === '/artifacts')?.body.sourceIds).toEqual(['thread-1'])
    expect(mock.calls.find(call => call.path.endsWith('/publish'))?.body).toEqual({ digest: 'digest-2', slug: 'untitled-report' })
    await user.type(screen.getByRole('textbox', { name: 'Page content (Markdown)' }), '\nNew finding.')
    expect(screen.getByRole('button', { name: 'Publish updated page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(await screen.findByRole('button', { name: 'Preview saved page' }))
    await user.click(screen.getByRole('checkbox', { name: /I reviewed this saved revision/ }))
    await user.click(screen.getByRole('button', { name: 'Publish updated page' }))
    await screen.findByText(/Published revision 3/)
    await user.click(screen.getByRole('button', { name: 'Unpublish page' }))
    await screen.findByText(/Not published/)
    expect(screen.queryByRole('link', { name: /https:/ })).not.toBeInTheDocument()
  })

  it('retains unsent text when the server rejects a post', async () => {
    const mock = server(); mock.rejectPosts()
    render(<SharedApp />)
    const user = await signIn()
    await user.click(screen.getByRole('button', { name: /Add to Now/ }))
    await user.type(screen.getByRole('textbox', { name: 'Details' }), 'Do not lose this draft.')
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    expect(await screen.findByText('Connection failed. Retry your draft.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Details' })).toHaveValue('Do not lose this draft.')
    expect(within(screen.getByLabelText('Team posts')).queryByText('Do not lose this draft.')).not.toBeInTheDocument()
  })

  it('does not silently open the demo when runtime detection fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'))
    render(<WorkspaceEntry />)
    expect(await screen.findByText('The workspace could not be reached. Reload to reconnect.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Demo identity' })).not.toBeInTheDocument()
  })
  it('lets the administrator review and retry another member’s approved program activation', async () => {
    const mock = server()
    mock.state.lessons.push({ id: 'lesson-1', ownerId: 'member-2', title: 'Better artifact design', body: 'Use evidence.', revision: 1, status: 'approved', sourceIds: ['thread-1'], program: 'artifact-design', candidateDigest: 'reviewed-program-digest', candidateSource: '# Program\nUse evidence.' })
    render(<SharedApp />)
    const user = await signIn()
    await user.click(screen.getByRole('button', { name: 'People' }))
    expect(screen.queryByRole('button', { name: 'Create invitation for Shubham' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create invitation for Om' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Learning' }))
    expect(screen.getByText('Approved · activation pending')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry program activation 1' })
    expect(retry).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I reviewed this program revision/ }))
    await user.click(retry)
    expect(await screen.findByText('Program revision accepted for future artifact designs.')).toBeInTheDocument()
    expect(mock.calls.find(call => call.path === '/lessons/lesson-1/accept')?.body).toEqual({ revision: 1, digest: 'reviewed-program-digest' })
  })

  it('redeems a personal invitation link once in StrictMode and removes its secret fragment', async () => {
    const mock = server()
    window.history.replaceState(null, '', '/#invite=private-link-secret')
    render(<StrictMode><SharedApp /></StrictMode>)
    expect(await screen.findByText('Signed in as Shubham')).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mock.calls.filter(call => call.path === '/login')).toEqual([{ path: '/login', body: { token: 'private-link-secret' } }])
    expect(window.localStorage.length).toBe(0)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Join Telepathy' })
  })

})
