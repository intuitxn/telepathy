import type { Person, PersonId, Post } from '../types'
import { Avatar } from '../components/Avatar'
import { CheckIcon } from '../components/Icons'

function getStatus(person: Person) {
  const completed = person.onboarding.filter((item) => item.complete).length
  const total = person.onboarding.length
  if (completed === 0) return { label: 'Not started', completed, total }
  if (completed === total) return { label: 'Ready', completed, total }
  return { label: 'Getting set up', completed, total }
}

interface PeopleViewProps {
  people: Person[]
  posts: Post[]
  activePersonId: PersonId
  onToggleOnboarding: (personId: PersonId, itemId: string) => void
  onSelectPerson: (personId: PersonId) => void
}

export function PeopleView({
  people,
  posts,
  activePersonId,
  onToggleOnboarding,
  onSelectPerson,
}: PeopleViewProps) {
  return (
    <section aria-labelledby="people-title" className="view view--people">
      <header className="view-heading">
        <div>
          <span className="eyebrow">Local onboarding</span>
          <h1 id="people-title">People</h1>
          <p>Three people, one communication pattern to test.</p>
        </div>
      </header>

      <div className="people-intro">
        <p>
          These are editable demo statuses in this browser. They do not indicate
          whether another person has joined, viewed, or completed anything elsewhere.
        </p>
      </div>

      <div className="people-list">
        {people.map((person, index) => {
          const status = getStatus(person)
          const contributionCount = posts.reduce(
            (count, post) =>
              count +
              (post.authorId === person.id && !post.example ? 1 : 0) +
              post.replies.filter(
                (reply) => reply.authorId === person.id && !reply.example,
              ).length,
            0,
          )
          const selected = activePersonId === person.id

          return (
            <article className="person-row" key={person.id}>
              <div className="person-row__number" aria-hidden="true">0{index + 1}</div>
              <header className="person-row__identity">
                <Avatar person={person} size="large" />
                <div>
                  <h2>{person.name}</h2>
                  <span>{selected ? 'Current demo identity' : 'Workspace member'}</span>
                </div>
              </header>

              <div className="person-row__status">
                <span className={`status-label status-label--${status.label.toLowerCase().replaceAll(' ', '-')}`}>
                  {status.label}
                </span>
                <strong>{status.completed} of {status.total}</strong>
                <small>Local demo status · not verified with this person</small>
                <div aria-hidden="true" className="progress-track">
                  <span style={{ width: `${(status.completed / status.total) * 100}%` }} />
                </div>
              </div>

              <div className="person-row__activity">
                <strong>{contributionCount}</strong>
                <span>local {contributionCount === 1 ? 'contribution' : 'contributions'} in this browser</span>
              </div>

              <div className="onboarding-list">
                <h3>Onboarding checklist</h3>
                {person.onboarding.map((item) => (
                  <label className={item.complete ? 'is-complete' : ''} key={item.id}>
                    <input
                      checked={item.complete}
                      disabled={!selected}
                      onChange={() => onToggleOnboarding(person.id, item.id)}
                      type="checkbox"
                    />
                    <span className="check-box"><CheckIcon /></span>
                    <span>{item.label}</span>
                  </label>
                ))}
                {!selected && (
                  <button className="text-button" onClick={() => onSelectPerson(person.id)} type="button">
                    Use {person.name} as demo identity to edit
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
