import { useId, useState, type FormEvent } from 'react'
import type { Person, PersonId, Post, Reply } from '../types'
import { createReply } from '../workspace'
import { Avatar } from './Avatar'
import { CheckIcon, PinIcon, ReplyIcon } from './Icons'

const kindLabels: Record<Post['kind'], string> = {
  update: 'Update',
  decision: 'Decision',
  question: 'Question',
  announcement: 'Announcement',
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

interface PostItemProps {
  post: Post
  people: Person[]
  activePerson: Person
  onAddReply: (postId: string, reply: Reply) => void
  onToggleAcknowledgement: (postId: string, personId: PersonId) => void
  onResolve: (postId: string, summary: string) => void
}

export function PostItem({
  post,
  people,
  activePerson,
  onAddReply,
  onToggleAcknowledgement,
  onResolve,
}: PostItemProps) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const [resolutionBody, setResolutionBody] = useState('')
  const [error, setError] = useState('')
  const panelId = useId()
  const author = people.find((person) => person.id === post.authorId) ?? people[0]
  const acknowledged = post.acknowledgements.includes(activePerson.id)
  const ownPost = post.authorId === activePerson.id
  const acknowledgingPeople = post.acknowledgements
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is Person => Boolean(person))

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!replyBody.trim()) {
      setError('Write a reply before adding it.')
      return
    }
    onAddReply(post.id, createReply({ authorId: activePerson.id, body: replyBody }))
    setReplyBody('')
    setError('')
    setReplyOpen(false)
  }

  const submitResolution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!resolutionBody.trim()) {
      setError('Add the answer or outcome that closed this question.')
      return
    }
    onResolve(post.id, resolutionBody)
    setResolutionBody('')
    setError('')
    setResolutionOpen(false)
  }

  return (
    <article className={`post post--${post.kind}${post.pinned ? ' post--pinned' : ''}`}>
      <header className="post__header">
        <Avatar person={author} />
        <div className="post__byline">
          <strong>{author.name}</strong>
          <div className="post__meta">
            <span className={`kind-label kind-label--${post.kind}`}>{kindLabels[post.kind]}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={post.createdAt}>{formatDateTime(post.createdAt)}</time>
            {post.example && <span className="example-label">Example</span>}
          </div>
        </div>
        {post.pinned && (
          <span className="pinned-label"><PinIcon /> Pinned</span>
        )}
      </header>

      <div className="post__content">
        {post.title && <h2>{post.title}</h2>}
        <p>{post.body}</p>
      </div>

      {post.resolution && (
        <div className="resolution-note">
          <span className="resolution-note__icon"><CheckIcon /></span>
          <div>
            <span className="eyebrow">Resolved answer</span>
            <p>{post.resolution.summary}</p>
            <small>
              Resolved by {people.find((person) => person.id === post.resolution?.resolvedBy)?.name}
              {' · '}{formatDateTime(post.resolution.resolvedAt)}
            </small>
          </div>
        </div>
      )}

      {post.replies.length > 0 && (
        <div className="reply-list" aria-label={`${post.replies.length} ${post.replies.length === 1 ? 'reply' : 'replies'}`}>
          {post.replies.map((reply) => {
            const replyAuthor = people.find((person) => person.id === reply.authorId) ?? people[0]
            return (
              <div className="reply" key={reply.id}>
                <Avatar person={replyAuthor} size="small" />
                <div>
                  <div className="reply__meta">
                    <strong>{replyAuthor.name}</strong>
                    <time dateTime={reply.createdAt}>{formatDateTime(reply.createdAt)}</time>
                  </div>
                  <p>{reply.body}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <footer className="post__footer">
        <div className="post-actions">
          <button
            aria-expanded={replyOpen}
            aria-controls={`${panelId}-reply`}
            className="post-action"
            onClick={() => {
              setReplyOpen((value) => !value)
              setResolutionOpen(false)
              setError('')
            }}
            type="button"
          >
            <ReplyIcon />
            {replyOpen
              ? 'Close reply form'
              : post.replies.length
                ? `${post.replies.length} ${post.replies.length === 1 ? 'reply' : 'replies'}`
                : 'Add reply'}
          </button>

          <button
            aria-pressed={acknowledged}
            className={`post-action${acknowledged ? ' is-active' : ''}`}
            disabled={ownPost}
            onClick={() => onToggleAcknowledgement(post.id, activePerson.id)}
            title={ownPost ? 'You cannot acknowledge your own post in this demo.' : undefined}
            type="button"
          >
            <CheckIcon />
            {ownPost ? 'Your post' : acknowledged ? 'Acknowledged' : 'Acknowledge'}
          </button>

          {post.kind === 'question' && !post.resolution && (
              <button
                aria-expanded={resolutionOpen}
                aria-controls={`${panelId}-resolution`}
                className="post-action post-action--resolve"
                onClick={() => {
                  setResolutionOpen((value) => !value)
                  setReplyOpen(false)
                  setError('')
                }}
                type="button"
              >
                Resolve question
              </button>
          )}
        </div>

        {acknowledgingPeople.length > 0 && (
          <div className="acknowledgements" aria-label={`Acknowledged by ${acknowledgingPeople.map((person) => person.name).join(', ')}`}>
            <span className="avatar-stack" aria-hidden="true">
              {acknowledgingPeople.map((person) => <Avatar key={person.id} person={person} size="small" />)}
            </span>
            <span>Acknowledged by {acknowledgingPeople.map((person) => person.name).join(', ')}</span>
          </div>
        )}
      </footer>

      {replyOpen && (
        <form className="inline-form" id={`${panelId}-reply`} onSubmit={submitReply}>
          <label htmlFor={`${panelId}-reply-body`}>Add reply as {activePerson.name}</label>
          <textarea
            autoFocus
            id={`${panelId}-reply-body`}
            maxLength={600}
            onChange={(event) => {
              setReplyBody(event.target.value)
              setError('')
            }}
            placeholder="Keep the reply attached to the context it answers."
            rows={3}
            value={replyBody}
          />
          <div className="inline-form__footer">
            <span className="form-error" role="alert">{error}</span>
            <button className="secondary-button" type="submit">Add reply</button>
          </div>
        </form>
      )}

      {resolutionOpen && (
        <form className="inline-form inline-form--resolution" id={`${panelId}-resolution`} onSubmit={submitResolution}>
          <label htmlFor={`${panelId}-resolution-body`}>What resolved this?</label>
          <textarea
            autoFocus
            id={`${panelId}-resolution-body`}
            maxLength={600}
            onChange={(event) => {
              setResolutionBody(event.target.value)
              setError('')
            }}
            placeholder="Record the answer or outcome that closed the question."
            rows={3}
            value={resolutionBody}
          />
          <div className="inline-form__footer">
            <small>Resolving as {activePerson.name}</small>
            <span className="form-error" role="alert">{error}</span>
            <button className="secondary-button" type="submit">Mark resolved</button>
          </div>
        </form>
      )}
    </article>
  )
}
