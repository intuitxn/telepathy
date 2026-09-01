import { useMemo, useState } from 'react'
import type { Person, PersonId, Post, PostKind, Reply } from '../types'
import { Composer } from '../components/Composer'
import { PostItem } from '../components/PostItem'

type FeedFilter = 'all' | 'open-questions' | PostKind

const filters: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open-questions', label: 'Open questions' },
  { id: 'question', label: 'Questions' },
  { id: 'decision', label: 'Decisions' },
  { id: 'update', label: 'Updates' },
  { id: 'announcement', label: 'Announcements' },
]

interface NowViewProps {
  posts: Post[]
  people: Person[]
  activePerson: Person
  onAddPost: (post: Post) => void
  onAddReply: (postId: string, reply: Reply) => void
  onToggleAcknowledgement: (postId: string, personId: PersonId) => void
  onResolve: (postId: string, summary: string) => void
}

export function NowView({
  posts,
  people,
  activePerson,
  onAddPost,
  onAddReply,
  onToggleAcknowledgement,
  onResolve,
}: NowViewProps) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const openQuestionCount = posts.filter(
    (post) => post.kind === 'question' && !post.resolution,
  ).length
  const pinnedPosts = posts.filter((post) => post.pinned)
  const visiblePosts = useMemo(() => {
    return posts
      .filter((post) => !post.pinned)
      .filter((post) => {
        if (filter === 'all') return true
        if (filter === 'open-questions') {
          return post.kind === 'question' && !post.resolution
        }
        return post.kind === filter
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [filter, posts])

  return (
    <section aria-labelledby="now-title" className="view view--now">
      <header className="view-heading">
        <div>
          <span className="eyebrow">Local demo feed</span>
          <h1 id="now-title">Now</h1>
          <p>What changed, what needs an answer, and what the team should not miss.</p>
        </div>
        <div className="open-question-count">
          <strong>{openQuestionCount}</strong>
          <span>open {openQuestionCount === 1 ? 'question' : 'questions'}</span>
        </div>
      </header>

      <Composer activePerson={activePerson} onAddPost={onAddPost} />

      <div aria-label="Pinned start here" className="pinned-feed">
        {pinnedPosts.map((post) => (
          <PostItem
            activePerson={activePerson}
            key={post.id}
            onAddReply={onAddReply}
            onResolve={onResolve}
            onToggleAcknowledgement={onToggleAcknowledgement}
            people={people}
            post={post}
          />
        ))}
      </div>

      <div className="feed-toolbar">
        <h2>Latest</h2>
        <div aria-label="Filter posts" className="filter-list" role="group">
          {filters.map((item) => (
            <button
              aria-pressed={filter === item.id}
              className={filter === item.id ? 'is-active' : ''}
              key={item.id}
              onClick={() => setFilter(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="feed" aria-label="Team posts">
        {visiblePosts.map((post) => (
          <PostItem
            activePerson={activePerson}
            key={post.id}
            onAddReply={onAddReply}
            onResolve={onResolve}
            onToggleAcknowledgement={onToggleAcknowledgement}
            people={people}
            post={post}
          />
        ))}
      </div>

      {visiblePosts.length === 0 && filter !== 'all' && (
        <div className="empty-state">
          <p>Nothing else here yet.</p>
          <button onClick={() => setFilter('all')} type="button">Show every post</button>
        </div>
      )}
    </section>
  )
}
