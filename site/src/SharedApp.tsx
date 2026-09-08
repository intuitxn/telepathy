import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Composer } from './components/Composer'
import { PostItem } from './components/PostItem'
import { MoonIcon, SunIcon, NowIcon, PeopleIcon, InterfacesIcon } from './components/Icons'
import { api, asPerson, asPost, type Artifact, type Member, type SharedWorkspace } from './sharedApi'
import './shared.css'

// Cache only the in-flight exchange, so React StrictMode cannot redeem a link twice.
let invitationExchange: Promise<{ person: Member }> | undefined
function exchangeInvitation() {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const invite = fragment.get('invite')
  if (invite) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    const exchange = api<{ person: Member }>('/login', 'POST', { token: invite })
    invitationExchange = exchange
    const clear = () => { if (invitationExchange === exchange) invitationExchange = undefined }
    void exchange.then(clear, clear)
  }
  return invitationExchange
}

export function SharedApp() {
  const [person, setPerson] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<SharedWorkspace>({ people: [], posts: [], artifacts: [], lessons: [] })
  const [view, setView] = useState('now')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [token, setToken] = useState('')
  const [invitation, setInvitation] = useState<{ name: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState('light')
  const [selected, setSelected] = useState<string[]>([])
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [lessonTitle, setLessonTitle] = useState('')
  const [lessonBody, setLessonBody] = useState('')
  const [lessonKind, setLessonKind] = useState('note')
  const [reviewedLessons, setReviewedLessons] = useState<string[]>([])
  const refresh = useCallback(async () => { setData(await api<SharedWorkspace>('/workspace')) }, [])
  useEffect(() => {
    let active = true
    const exchange = exchangeInvitation()
    ;(exchange ?? api<{ person: Member | null }>('/me')).then(async result => {
      if (!active) return
      setPerson(result.person)
      if (result.person) await refresh()
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  useEffect(() => {
    if (!person) return
    const timer = window.setInterval(() => { refresh().catch(err => setError(`Connection interrupted: ${err.message}`)) }, 5000)
    return () => window.clearInterval(timer)
  }, [person, refresh])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (err) { setError(err instanceof Error ? err.message : 'Could not complete this action.') }
    finally { setBusy(false) }
  }
  const login = (event: FormEvent) => {
    event.preventDefault()
    void act(async () => {
      const result = await api<{ person: Member }>('/login', 'POST', { token })
      setToken(''); setPerson(result.person); await refresh()
    })
  }
  const choose = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])
  const createArtifact = () => void act(async () => {
    const draft = await api<Artifact>('/artifacts', 'POST', { title: 'Untitled report', sourceIds: selected })
    setArtifact(draft); setView('artifacts'); await refresh()
  })
  if (loading) return <main className="view"><h1>Telepathy</h1><p role="status">Opening your workspace…</p></main>
  if (!person) return <main className="shared-login view">
    <span className="brand-mark" aria-hidden="true">T</span><span className="eyebrow">Intuitxn · Shared workspace</span>
    <h1>Your team’s work, together.</h1><p>Conversations become reviewed pages and lessons we can use again.</p>
    <form className="composer" onSubmit={login}>
      <h2>Join Telepathy</h2><label className="field"><span>Invitation code</span><input type="password" autoComplete="off" required value={token} onChange={event => setToken(event.target.value)} /></label>
      <p>Open your personal invitation link or enter the invitation code from your workspace owner. Each invitation signs in one person.</p>
      <button className="primary-button" disabled={busy} type="submit">Open workspace</button>
    </form>{error && <p role="alert">{error}</p>}
  </main>
  const people = data.people.map(asPerson)
  const activePerson = asPerson(person)
  return <div className="app-shell shared-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="brand-lockup"><span aria-hidden="true" className="brand-mark">T</span><div><span className="brand-name">Telepathy</span><span className="alpha-label">Shared workspace</span></div></div>
      <nav aria-label="Primary">{[{ id: 'now', label: 'Now', icon: NowIcon }, { id: 'artifacts', label: 'Pages', icon: InterfacesIcon }, { id: 'learning', label: 'Learning', icon: InterfacesIcon }, { id: 'people', label: 'People', icon: PeopleIcon }].map(item => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}><item.icon /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar__bottom"><div className="local-note"><span>Intuitxn network</span><p>Shared with signed-in teammates. Public pages are published explicitly.</p></div></div>
    </aside>
    <div className="workspace">
      <header className="workspace-bar"><div className="alpha-notice"><span>Team workspace</span><p>Conversations stay here. You choose what becomes a public page.</p></div><div className="workspace-controls"><span>Signed in as {person.name}</span><button className="theme-toggle" aria-label={theme === 'light' ? 'Use dark theme' : 'Use light theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <MoonIcon /> : <SunIcon />}</button><button className="text-button" onClick={() => void act(async () => { if (draftDirty && !window.confirm('Discard your unsaved page changes and sign out?')) return; await api('/logout', 'POST', {}); setPerson(null); setData({ people: [], posts: [], artifacts: [], lessons: [] }); setArtifact(null); setSelected([]); setInvitation(null); invitationExchange = undefined })}>Sign out</button></div></header>
      <main id="main-content" tabIndex={-1}>
        {error && <div className="shared-banner" role="alert">{error}<button className="text-button" onClick={() => void act(refresh)}>Reconnect</button></div>}
        {notice && <p className="shared-banner" role="status">{notice}</p>}
        {view === 'now' && <section className="view view--now"><header className="view-heading"><div><span className="eyebrow">Shared team conversations</span><h1>Now</h1><p>Discuss the work. Choose the parts worth turning into a page.</p></div></header>
          <Composer shared activePerson={activePerson} onAddPost={async post => { await api('/posts', 'POST', { type: post.kind, title: post.title ?? '', body: post.body }); await refresh() }} />
          {selected.length > 0 && <div className="shared-selection"><span>{selected.length} selected messages</span><button className="primary-button" disabled={busy} onClick={createArtifact}>Create page</button><button className="text-button" onClick={() => setSelected([])}>Clear selection</button></div>}
          <div className="feed" aria-label="Team posts">{[...data.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(post => <div key={post.id} className="shared-thread">
            <PostItem canResolve={post.authorId === person.id} post={asPost(post)} people={people} activePerson={activePerson} onAddReply={async (id, reply) => { await api(`/posts/${id}/replies`, 'POST', { body: reply.body }); await refresh() }} onResolve={async (id, summary) => { await api(`/posts/${id}/resolve`, 'POST', { resolved: true, summary }); await refresh() }} onToggleAcknowledgement={id => act(async () => { await api(`/posts/${id}/ack`, 'POST', {}); await refresh() })} />
            <details className="source-selector"><summary>Select messages for a page or lesson</summary><label><input type="checkbox" checked={selected.includes(post.id)} onChange={() => choose(post.id)} /> {post.title || post.body.slice(0, 90)}</label>{post.replies.map(reply => <label key={reply.id}><input type="checkbox" checked={selected.includes(reply.id)} onChange={() => choose(reply.id)} /> {data.people.find(p => p.id === reply.authorId)?.name}: {reply.body.slice(0, 100)}</label>)}</details>
          </div>)}</div>{data.posts.length === 0 && <div className="empty-state">Start the first team conversation above.</div>}
        </section>}
        <section className="view" hidden={view !== 'artifacts'}><header className="view-heading"><div><span className="eyebrow">From conversation to publication</span><h1>Pages</h1><p>Select messages in Now to start a draft. Review the exact page before publishing.</p></div></header>
          {artifact ? <ArtifactEditor key={artifact.id} artifact={artifact} owner={artifact.ownerId === person.id} onDirtyChange={setDraftDirty} onClose={() => setArtifact(null)} onSaved={async next => { setArtifact(next); await refresh().catch(err => setError(`Page saved. Refresh failed: ${err.message}`)) }} /> : <div className="feed">{data.artifacts.map(item => <article className="post" key={item.id}><span className="eyebrow">{item.publishedRevision ? `Published revision ${item.publishedRevision}` : 'Private draft'}</span><h2>{item.title}</h2><p>Draft revision {item.revision}</p><button className="secondary-button" onClick={() => setArtifact(item)}>Review page</button>{item.publicUrl && <p><a href={item.publicUrl} target="_blank" rel="noreferrer">Open published page ↗</a></p>}</article>)}{data.artifacts.length === 0 && <div className="empty-state">Your reviewed reports and pages will appear here.</div>}</div>}
        </section>
        {view === 'learning' && <section className="view"><header className="view-heading"><div><span className="eyebrow">Improve how we work</span><h1>Learning</h1><p>Record a useful practice with its evidence. Accept it deliberately after review.</p></div></header>
          <form className="composer" onSubmit={event => { event.preventDefault(); void act(async () => { await api(lessonKind === 'program' ? '/lessons/propose' : '/lessons', 'POST', lessonKind === 'program' ? { program: 'artifact-design', feedback: lessonBody, sourceIds: selected } : { title: lessonTitle, body: lessonBody, sourceIds: selected }); setLessonTitle(''); setLessonBody(''); await refresh(); setNotice('Learning proposal saved for review.') }) }}><h2>Propose a lesson</h2><label className="field"><span>Learning destination</span><select value={lessonKind} onChange={event => setLessonKind(event.target.value)}><option value="note">Team practice note</option><option value="program">Artifact design program</option></select></label>{lessonKind === 'note' && <label className="field"><span>Lesson title</span><input required value={lessonTitle} onChange={event => setLessonTitle(event.target.value)} /></label>}<label className="field"><span>Practice and evidence</span><textarea required rows={5} value={lessonBody} onChange={event => setLessonBody(event.target.value)} /></label><p>{selected.length} selected conversation messages attached as evidence.{lessonKind === 'program' && selected.length === 0 ? ' Select evidence messages in Now before proposing a program improvement.' : ''}</p><button className="primary-button" disabled={busy || (lessonKind === 'program' && selected.length === 0)}>{lessonKind === 'program' ? 'Propose program improvement' : 'Save proposal'}</button>{busy && <p role="status">Preparing the proposal for review…</p>}</form>
          <div className="feed">{data.lessons.map(lesson => <article className="post" key={lesson.id}><span className="eyebrow">{lesson.status === 'approved' ? 'Approved · activation pending' : lesson.status}</span><h2>{lesson.title}</h2><p className="preserve-lines">{lesson.body}</p>{lesson.candidateSource && <><details><summary>Review proposed program source</summary><pre className="program-source">{lesson.candidateSource}</pre></details>{lesson.status !== 'accepted' && <label className="review-check"><input type="checkbox" checked={reviewedLessons.includes(lesson.id)} onChange={event => setReviewedLessons(ids => event.target.checked ? [...ids, lesson.id] : ids.filter(id => id !== lesson.id))} /> I reviewed this program revision and approve it for future artifact designs.</label>}</>}{lesson.status !== 'accepted' && (lesson.candidateSource ? person.canInvite : lesson.ownerId === person.id) && <button className="secondary-button" disabled={busy || Boolean(lesson.candidateSource && !reviewedLessons.includes(lesson.id))} onClick={() => void act(async () => { const accepted = await api<{ status: string }>(`/lessons/${lesson.id}/accept`, 'POST', { revision: lesson.revision, ...(lesson.candidateDigest ? { digest: lesson.candidateDigest } : {}) }); await refresh(); setNotice(accepted.status === 'approved' ? 'Program revision approved; activation is pending. Retry activation to complete it.' : lesson.candidateSource ? 'Program revision accepted for future artifact designs.' : 'Lesson accepted as a reviewed reference.') })}>{lesson.status === 'approved' ? 'Retry program activation' : lesson.candidateSource ? 'Accept program revision' : 'Accept revision'} {lesson.revision}</button>}</article>)}</div>
        </section>}
        {view === 'people' && <section className="view"><header className="view-heading"><div><span className="eyebrow">Shared workspace members</span><h1>People</h1><p>Each person signs in with their own invitation.</p></div></header><div className="feed">{people.map(member => <article className="post" key={member.id}><h2>{member.name}</h2>{member.id === person.id && <p>You</p>}{person.canInvite && member.id !== person.id && <button className="secondary-button" disabled={busy} onClick={() => void act(async () => { const result = await api<{ url: string }>('/invitations', 'POST', { personId: member.id }); setInvitation({ name: member.name, url: result.url }) })}>Create invitation for {member.name}</button>}</article>)}</div>{invitation && <div className="composer"><h2>Personal invitation for {invitation.name}</h2><p>Send this privately to {invitation.name}. Anyone with this invitation can sign in as them.</p><label className="field"><span>Invitation link</span><input readOnly value={invitation.url} /></label><button className="secondary-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(invitation.url); setNotice('Invitation copied. Share it privately.') })}>Copy personal invitation</button><button className="text-button" onClick={() => setInvitation(null)}>Hide invitation</button></div>}</section>}
      </main>
    </div>
  </div>
}

function ArtifactEditor({ artifact, owner, onClose, onSaved, onDirtyChange }: { artifact: Artifact; owner: boolean; onDirtyChange: (dirty: boolean) => void; onClose: () => void; onSaved: (artifact: Artifact) => Promise<void> }) {
  const [title, setTitle] = useState(artifact.title)
  const [body, setBody] = useState(artifact.body)
  const [slug, setSlug] = useState(artifact.slug || artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [preview, setPreview] = useState(false)
  const dirty = title !== artifact.title || body !== artifact.body
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [dirty])
  const mutate = async (path: string, method: string, payload: unknown) => {
    setBusy(true); setError('')
    try { const next = await api<Artifact>(path, method, payload); setTitle(next.title); setBody(next.body); await onSaved(next); setReviewed(false); setPreview(false) }
    catch (err) { setError(err instanceof Error ? err.message : 'Action failed. Your draft is retained.') }
    finally { setBusy(false) }
  }
  return <div className="artifact-editor"><button className="text-button" onClick={() => { if (!dirty || window.confirm('Discard your unsaved page changes?')) onClose() }}>← All pages</button><div className="composer">
    <span className="eyebrow">Draft revision {artifact.revision}{artifact.publishedRevision ? ` · Published revision ${artifact.publishedRevision}` : ' · Not published'}</span>
    <label className="field"><span>Page title</span><input readOnly={!owner} value={title} onChange={event => { setTitle(event.target.value); setReviewed(false) }} /></label>
    <label className="field"><span>Page content (Markdown)</span><textarea readOnly={!owner} rows={16} value={body} onChange={event => { setBody(event.target.value); setReviewed(false) }} /></label>
    <p>{artifact.sourceIds.length} source messages attached privately. Only this page’s title and content will be published.</p>
    {owner && <button className="secondary-button" disabled={busy || !dirty || !title.trim() || !body.trim()} onClick={() => void mutate(`/artifacts/${artifact.id}`, 'PATCH', { title, body, revision: artifact.revision })}>Save draft</button>}
    <button className="text-button" disabled={dirty || busy} onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview saved page'}</button>
    {owner && <button className="secondary-button" disabled={busy || dirty} onClick={() => void mutate(`/artifacts/${artifact.id}/design`, 'POST', { revision: artifact.revision })}>Design draft with Nudge</button>}
    {busy && <p role="status">Preparing your page… Agent design can take a minute. Review the returned draft before publishing.</p>}
    {dirty && <p>Save your changes before reviewing or publishing.</p>}
    {preview && !dirty && <iframe key={artifact.digest} className="artifact-preview" title="Public page preview" sandbox="" src={`/api/artifacts/${artifact.id}/preview`} />}
    {owner && <fieldset className="publication-controls" disabled={busy || dirty}><legend>Publish a reviewed revision</legend>
      <label className="field"><span>Public URL slug</span><input pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={event => { setSlug(event.target.value); setReviewed(false) }} /></label>
      <p>Anyone with the public link can read this page. New conversation messages will stay private.</p>
      <label className="review-check"><input type="checkbox" checked={reviewed} disabled={!preview} onChange={event => setReviewed(event.target.checked)} /> I reviewed this saved revision and approve its content for public sharing.</label>
      <button className="primary-button" disabled={!reviewed || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)} onClick={() => void mutate(`/artifacts/${artifact.id}/publish`, 'POST', { digest: artifact.digest, slug })}>{artifact.publishedRevision ? 'Publish updated page' : 'Publish page'}</button>
    </fieldset>}
    {artifact.publicUrl && <div className="shared-banner"><a href={artifact.publicUrl} target="_blank" rel="noreferrer">{artifact.publicUrl}</a><p>Copy this link into Buzz to share the page.</p>{owner && <button className="text-button" disabled={busy} onClick={() => void mutate(`/artifacts/${artifact.id}/unpublish`, 'POST', {})}>Unpublish page</button>}</div>}
    {error && <p role="alert">{error}</p>}
  </div></div>
}
