import { changelog } from '../seed'

export function ChangelogView() {
  return (
    <section aria-labelledby="changelog-title" className="view view--changelog">
      <header className="view-heading">
        <div>
          <span className="eyebrow">Product notes</span>
          <h1 id="changelog-title">Changelog</h1>
          <p>What changed in Telepathy, in plain language.</p>
        </div>
      </header>

      <div className="known-limit">
        <span>Known limit</span>
        <p>Activity and settings stay in this browser; there is no account sync or delivery yet.</p>
      </div>

      <div className="change-list">
        {changelog.map((entry, index) => (
          <article className="change-entry" key={entry.version}>
            <div className="change-entry__rail">
              <span>{entry.version}</span>
              {index < changelog.length - 1 && <i aria-hidden="true" />}
            </div>
            <div className="change-entry__content">
              <time>{entry.date}</time>
              <h2>{entry.title}</h2>
              <p>{entry.summary}</p>
              <ul>
                {entry.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
