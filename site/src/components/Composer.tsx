import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Person, PostKind } from '../types'
import { createPost } from '../workspace'
import { ArrowIcon, PlusIcon } from './Icons'

const composerCopy: Record<
  PostKind,
  { label: string; prompt: string; helper: string; action: string }
> = {
  update: {
    label: 'Update',
    prompt: 'What changed?',
    helper: 'Progress, context, or a handoff.',
    action: 'Add update',
  },
  decision: {
    label: 'Decision',
    prompt: 'What was decided?',
    helper: 'State the call and why it matters.',
    action: 'Add decision',
  },
  question: {
    label: 'Question',
    prompt: 'What needs an answer?',
    helper: 'Name the uncertainty clearly enough for someone to close it.',
    action: 'Add question',
  },
  announcement: {
    label: 'Announcement',
    prompt: 'What should everyone know?',
    helper: 'Use for something the whole team should not miss.',
    action: 'Add announcement',
  },
}

const kinds = Object.keys(composerCopy) as PostKind[]

interface ComposerProps {
  activePerson: Person
  onAddPost: (post: ReturnType<typeof createPost>) => void
}

export function Composer({ activePerson, onAddPost }: ComposerProps) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<PostKind>('update')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) bodyRef.current?.focus()
  }, [open])

  const reset = () => {
    setKind('update')
    setTitle('')
    setBody('')
    setError('')
  }

  const close = () => {
    setOpen(false)
    reset()
    requestAnimationFrame(() => openButtonRef.current?.focus())
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedBody = body.trim()
    const needsTitle = kind !== 'update'
    if (!trimmedBody || (needsTitle && !title.trim())) {
      setError(needsTitle && !title.trim() ? 'Add a short title before sharing.' : 'Add a few words before sharing.')
      return
    }

    onAddPost(
      createPost({
        kind,
        authorId: activePerson.id,
        title,
        body: trimmedBody,
      }),
    )
    close()
  }

  if (!open) {
    return (
      <button
        className="composer-invite"
        onClick={() => setOpen(true)}
        ref={openButtonRef}
        type="button"
      >
        <span className="composer-invite__plus"><PlusIcon /></span>
        <span>
          <strong>Add to Now</strong>
          <small>Create a local update, decision, question, or announcement</small>
        </span>
        <ArrowIcon className="composer-invite__arrow" />
      </button>
    )
  }

  const selected = composerCopy[kind]

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer__header">
        <div>
          <span className="eyebrow">Posting as {activePerson.name}</span>
          <h2>Add to Now</h2>
        </div>
        <button className="text-button" onClick={close} type="button">Cancel</button>
      </div>

      <fieldset className="kind-picker">
        <legend>Choose a post type</legend>
        <div className="kind-picker__options">
          {kinds.map((option) => (
            <label className={kind === option ? 'is-selected' : ''} key={option}>
              <input
                checked={kind === option}
                name="post-kind"
                onChange={() => {
                  setKind(option)
                  setError('')
                }}
                type="radio"
                value={option}
              />
              {composerCopy[option].label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="composer__prompt">
        <strong>{selected.prompt}</strong>
        <span>{selected.helper}</span>
      </div>

      {kind !== 'update' && (
        <label className="field">
          <span>Title</span>
          <input
            aria-describedby={error ? 'composer-error' : undefined}
            maxLength={100}
            onChange={(event) => {
              setTitle(event.target.value)
              setError('')
            }}
            placeholder="A clear one-line summary"
            required
            value={title}
          />
          <small aria-hidden="true">{title.length}/100</small>
        </label>
      )}

      <label className="field">
        <span>Details</span>
        <textarea
          aria-describedby={error ? 'composer-error' : undefined}
          maxLength={1200}
          onChange={(event) => {
            setBody(event.target.value)
            setError('')
          }}
          placeholder="Write the context someone needs to understand or respond."
          ref={bodyRef}
          required
          rows={5}
          value={body}
        />
        <small aria-hidden="true">{body.length}/1200</small>
      </label>

      <div className="composer__footer">
        <span className="form-error" id="composer-error" role="alert">{error}</span>
        <button className="primary-button" type="submit">
          {selected.action}
          <ArrowIcon />
        </button>
      </div>
    </form>
  )
}
