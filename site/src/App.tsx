import { useEffect, useReducer, useState } from 'react'
import { initialWorkspace } from './seed'
import type { PersonId, Post, Reply, ViewName } from './types'
import {
  loadWorkspace,
  saveWorkspace,
  workspaceReducer,
} from './workspace'
import {
  ChangelogIcon,
  MoonIcon,
  NowIcon,
  PeopleIcon,
  ResetIcon,
  SunIcon,
} from './components/Icons'
import { NowView } from './views/NowView'
import { PeopleView } from './views/PeopleView'
import { ChangelogView } from './views/ChangelogView'

const navItems: { id: ViewName; label: string; icon: typeof NowIcon }[] = [
  { id: 'now', label: 'Now', icon: NowIcon },
  { id: 'people', label: 'People', icon: PeopleIcon },
  { id: 'changelog', label: 'Changelog', icon: ChangelogIcon },
]

export default function App() {
  const [workspace, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    () => loadWorkspace(window.localStorage),
  )
  const [view, setView] = useState<ViewName>('now')
  const [announcement, setAnnouncement] = useState('')
  const activePerson = workspace.people.find(
    (person) => person.id === workspace.activePersonId,
  ) ?? workspace.people[0]

  useEffect(() => {
    saveWorkspace(window.localStorage, workspace)
  }, [workspace])

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    themeMeta?.setAttribute('content', workspace.theme === 'dark' ? '#1d1b18' : '#f2eee6')
  }, [workspace.theme])

  const navigate = (nextView: ViewName) => {
    setView(nextView)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    })
  }

  const addPost = (post: Post) => {
    dispatch({ type: 'add-post', post })
    setAnnouncement(`${post.kind} added to Now as ${activePerson.name}.`)
  }

  const resetDemo = () => {
    const confirmed = window.confirm(
      'Reset every local post, reply, acknowledgement, onboarding change, and preference in this demo?',
    )
    if (!confirmed) return
    const freshState = JSON.parse(JSON.stringify(initialWorkspace)) as typeof initialWorkspace
    dispatch({ type: 'reset', state: freshState })
    setView('now')
    setAnnouncement('The local demo was reset.')
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <aside className="sidebar">
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">T</span>
          <div>
            <span className="brand-name">Telepathy</span>
            <span className="alpha-label">Internal alpha</span>
          </div>
        </div>

        <nav aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                aria-current={view === item.id ? 'page' : undefined}
                key={item.id}
                onClick={() => navigate(item.id)}
                type="button"
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar__bottom">
          <div className="local-note">
            <span>Browser only</span>
            <p>Your changes remain in this browser.</p>
          </div>
          <button className="reset-button" onClick={resetDemo} type="button">
            <ResetIcon />
            Reset local demo
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-bar">
          <div className="alpha-notice">
            <span>Internal alpha</span>
            <p>Changes are saved only in this browser. Switching identity does not sign you in as another person.</p>
          </div>

          <div className="workspace-controls">
            <label className="identity-control">
              <span>Demo identity</span>
              <select
                aria-label="Demo identity"
                aria-describedby="identity-help"
                onChange={(event) => {
                  const personId = event.target.value as PersonId
                  dispatch({ type: 'set-active-person', personId })
                  const person = workspace.people.find((item) => item.id === personId)
                  setAnnouncement(`Demo identity changed to ${person?.name}.`)
                }}
                value={workspace.activePersonId}
              >
                {workspace.people.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
              <small className="sr-only" id="identity-help">This controls authorship for local demo actions only.</small>
            </label>

            <button
              aria-label={workspace.theme === 'light' ? 'Use dark theme' : 'Use light theme'}
              className="theme-toggle"
              onClick={() => dispatch({
                type: 'set-theme',
                theme: workspace.theme === 'light' ? 'dark' : 'light',
              })}
              type="button"
            >
              {workspace.theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
          </div>
        </header>

        <main id="main-content" tabIndex={-1}>
          <div className="view-transition" key={view}>
            {view === 'now' && (
              <NowView
                activePerson={activePerson}
                onAddPost={addPost}
                onAddReply={(postId: string, reply: Reply) => {
                  dispatch({ type: 'add-reply', postId, reply })
                  setAnnouncement(`Reply added as ${activePerson.name}.`)
                }}
                onResolve={(postId, summary) => {
                  dispatch({
                    type: 'resolve-question',
                    postId,
                    personId: activePerson.id,
                    summary,
                    now: new Date().toISOString(),
                  })
                  setAnnouncement(`Question resolved as ${activePerson.name}.`)
                }}
                onToggleAcknowledgement={(postId, personId) => {
                  dispatch({ type: 'toggle-acknowledgement', postId, personId })
                  setAnnouncement(`Acknowledgement updated for ${activePerson.name}.`)
                }}
                people={workspace.people}
                posts={workspace.posts}
              />
            )}
            {view === 'people' && (
              <PeopleView
                activePersonId={workspace.activePersonId}
                onSelectPerson={(personId) => {
                  dispatch({ type: 'set-active-person', personId })
                  setAnnouncement('Demo identity updated. You can now edit this local checklist.')
                }}
                onToggleOnboarding={(personId, itemId) => {
                  dispatch({ type: 'toggle-onboarding', personId, itemId })
                  setAnnouncement('Local onboarding status updated.')
                }}
                people={workspace.people}
                posts={workspace.posts}
              />
            )}
            {view === 'changelog' && <ChangelogView />}
          </div>
        </main>
      </div>

      <div aria-atomic="true" aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  )
}
