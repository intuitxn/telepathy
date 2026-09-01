import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { STORAGE_KEY } from './workspace'

function getPostByHeading(name: string | RegExp) {
  const heading = screen.getByRole('heading', { name })
  const article = heading.closest('article')
  if (!article) throw new Error('Expected the heading to be inside a post')
  return article
}

describe('Telepathy workspace', () => {
  it('starts with one pinned example explainer and three clearly labelled demo identities', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Now' })).toBeInTheDocument()
    expect(screen.getAllByText('Start here: how we use Telepathy')).toHaveLength(1)
    const pinned = getPostByHeading('Start here: how we use Telepathy')
    expect(within(pinned).getByText('Pinned')).toBeInTheDocument()
    expect(within(pinned).getByText('Example')).toBeInTheDocument()

    const identity = screen.getByRole('combobox', { name: 'Demo identity' })
    expect(within(identity).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Shubham Attri',
      'Om',
      'Kush',
    ])
    expect(screen.getByText(/Switching identity does not sign you in/)).toBeInTheDocument()
  })

  it('composes a question under the selected demo identity and restores it from storage', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Demo identity' }), 'om')
    await user.click(screen.getByRole('button', { name: /Add to Now/ }))
    await user.click(screen.getByRole('radio', { name: 'Question' }))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Which details belong in Now?')
    await user.type(
      screen.getByRole('textbox', { name: 'Details' }),
      'Should routine progress stay here or only changes that need attention?',
    )
    await user.click(screen.getByRole('button', { name: 'Add question' }))

    const newPost = getPostByHeading('Which details belong in Now?')
    expect(within(newPost).getByText('Om')).toBeInTheDocument()
    expect(within(newPost).getByText(/routine progress/)).toBeInTheDocument()

    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('Which details belong in Now?')
    })

    firstRender.unmount()
    render(<App />)
    expect(getPostByHeading('Which details belong in Now?')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Demo identity' })).toHaveValue('om')
  })

  it('offers and creates every post type', async () => {
    const user = userEvent.setup()
    render(<App />)
    const cases = [
      { kind: 'Update', title: '', body: 'A useful progress update.', action: 'Add update' },
      { kind: 'Decision', title: 'A settled direction', body: 'The reasoning stays with the call.', action: 'Add decision' },
      { kind: 'Question', title: 'A direct uncertainty', body: 'This needs a closing answer.', action: 'Add question' },
      { kind: 'Announcement', title: 'Something not to miss', body: 'The whole team should know this.', action: 'Add announcement' },
    ]

    for (const item of cases) {
      await user.click(screen.getByRole('button', { name: /Add to Now/ }))
      await user.click(screen.getByRole('radio', { name: item.kind }))
      if (item.title) {
        await user.type(screen.getByRole('textbox', { name: 'Title' }), item.title)
      }
      await user.type(screen.getByRole('textbox', { name: 'Details' }), item.body)
      await user.click(screen.getByRole('button', { name: item.action }))

      const article = screen.getByText(item.body).closest('article')
      expect(article).not.toBeNull()
      expect(within(article!).getByText(item.kind)).toBeInTheDocument()
    }
  })

  it('adds replies, keeps acknowledgements unique, and persists both', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)
    const decision = getPostByHeading('One written weekly direction, then async follow-through')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Demo identity' }), 'kush')
    await user.click(within(decision).getByRole('button', { name: /Add reply/ }))
    await user.type(within(decision).getByRole('textbox', { name: 'Add reply as Kush' }), 'I will keep implementation notes attached here.')
    await user.click(within(decision).getByRole('button', { name: 'Add reply' }))
    await user.click(within(decision).getByRole('button', { name: 'Acknowledge' }))

    expect(within(decision).getByText('I will keep implementation notes attached here.')).toBeInTheDocument()
    expect(within(decision).getByRole('button', { name: 'Acknowledged' })).toHaveAttribute('aria-pressed', 'true')

    firstRender.unmount()
    render(<App />)
    const restored = getPostByHeading('One written weekly direction, then async follow-through')
    expect(within(restored).getByText('I will keep implementation notes attached here.')).toBeInTheDocument()
    expect(within(restored).getByRole('button', { name: 'Acknowledged' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('resolves a question with a closing answer and exposes resolution nowhere else', async () => {
    const user = userEvent.setup()
    render(<App />)
    const question = getPostByHeading('What belongs in the Friday review?')
    const decision = getPostByHeading('One written weekly direction, then async follow-through')

    expect(within(decision).queryByRole('button', { name: 'Resolve question' })).not.toBeInTheDocument()
    await user.click(within(question).getByRole('button', { name: 'Resolve question' }))
    await user.type(
      within(question).getByRole('textbox', { name: 'What resolved this?' }),
      'The recap will include decisions, open questions, and direction changes.',
    )
    await user.click(within(question).getByRole('button', { name: 'Mark resolved' }))

    expect(within(question).getByText('Resolved answer')).toBeInTheDocument()
    expect(within(question).getByText(/The recap will include decisions/)).toBeInTheDocument()
    expect(within(question).queryByRole('button', { name: 'Resolve question' })).not.toBeInTheDocument()
  })

  it('filters only the latest posts while keeping the pinned explainer separate', async () => {
    const user = userEvent.setup()
    render(<App />)
    const latestFeed = screen.getByLabelText('Team posts')

    await user.click(screen.getByRole('button', { name: 'Updates' }))
    expect(within(latestFeed).getAllByRole('article')).toHaveLength(1)
    expect(within(latestFeed).queryByText('Start here: how we use Telepathy')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Pinned start here')).toHaveTextContent('Start here: how we use Telepathy')

    await user.click(screen.getByRole('button', { name: 'Questions' }))
    expect(within(latestFeed).getByRole('heading', { name: 'What belongs in the Friday review?' })).toBeInTheDocument()
  })

  it('navigates every product view, edits local onboarding, and persists the theme', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)

    await user.click(screen.getByRole('button', { name: 'People' }))
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(screen.getAllByText(/Local demo status/)).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Shubham Attri' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Om' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kush' })).toBeInTheDocument()

    const editableQuestionStep = screen
      .getAllByRole('checkbox', { name: 'Ask or resolve a question' })
      .find((checkbox) => !checkbox.hasAttribute('disabled'))
    expect(editableQuestionStep).toBeDefined()
    await user.click(editableQuestionStep!)
    expect(editableQuestionStep).not.toBeChecked()
    expect(screen.getAllByText('Getting set up')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Changelog' }))
    expect(screen.getByRole('heading', { name: 'Changelog' })).toBeInTheDocument()
    expect(screen.getByText(/there is no account sync or delivery yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use dark theme' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    firstRender.unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Use light theme' })).toBeInTheDocument()
  })

  it('presents planned interfaces as focused tools behind explicit human gates', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Interfaces' }))

    expect(screen.getByRole('heading', { name: 'Interfaces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Interfaces' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    expect(screen.getByText('Focused tools, not teammates')).toBeInTheDocument()
    expect(screen.getByText(/do not join People or author Now posts/)).toBeInTheDocument()
    expect(screen.getByText(/Humans retain intent, review, acceptance, publication, and external sending/)).toBeInTheDocument()

    const catalog = screen.getByRole('list', { name: 'Planned meta-agent interfaces' })
    const expectedInterfaces = [
      ['Prime', 'Project steward', 'prime.telepathy.intuitxn.com', '/agents/prime'],
      ['Build', 'Builder', 'build.telepathy.intuitxn.com', '/agents/build'],
      ['Steward', 'Release keeper', 'steward.telepathy.intuitxn.com', '/agents/steward'],
      ['Research', 'Research scout', 'research.telepathy.intuitxn.com', '/agents/research'],
      ['Relationships', 'Relationship desk', 'relationships.telepathy.intuitxn.com', '/agents/relationships'],
    ]

    expect(within(catalog).getAllByRole('article')).toHaveLength(5)
    for (const [name, label, host, path] of expectedInterfaces) {
      expect(within(catalog).getByRole('heading', { name })).toBeInTheDocument()
      expect(within(catalog).getByText(label)).toBeInTheDocument()
      expect(within(catalog).getByText(host)).toBeInTheDocument()
      expect(within(catalog).getByText(path)).toBeInTheDocument()
    }
    expect(within(catalog).getAllByText('Planned')).toHaveLength(5)
    expect(within(catalog).getAllByText('Not live')).toHaveLength(5)
    expect(within(catalog).getAllByText('Required')).toHaveLength(5)
    expect(within(catalog).getAllByText('Unassigned')).toHaveLength(5)
    expect(within(catalog).queryAllByRole('link')).toHaveLength(0)

    expect(screen.getByRole('heading', { name: 'Tools prepare. Humans accept.' })).toBeInTheDocument()
    expect(screen.getByText(/only a human may accept the work and close the Job/)).toBeInTheDocument()
    expect(screen.getByText(/No interface may activate its own Job/)).toBeInTheDocument()

    const interfaceView = screen.getByRole('heading', { name: 'Interfaces' }).closest('section')
    expect(interfaceView).not.toBeNull()
    expect(within(interfaceView!).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(interfaceView!).queryByRole('button', { name: /chat|send|launch|run|open/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Now' }))
    expect(screen.getByRole('heading', { name: 'Now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders user-entered markup as plain text', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: /Add to Now/ }))
    await user.type(screen.getByRole('textbox', { name: 'Details' }), '<script>unsafe()</script>')
    await user.click(screen.getByRole('button', { name: 'Add update' }))

    expect(screen.getByText('<script>unsafe()</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).not.toBeInTheDocument()
  })
})
