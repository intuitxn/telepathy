import { interfaceCatalog } from '../interfaces'

export function InterfacesView() {
  return (
    <section aria-labelledby="interfaces-title" className="view view--interfaces">
      <header className="view-heading">
        <div>
          <span className="eyebrow">Focused tool catalog</span>
          <h1 id="interfaces-title">Interfaces</h1>
          <p>Planned surfaces that prepare reviewable work inside a human-owned process.</p>
        </div>
      </header>

      <aside aria-labelledby="interfaces-guardrail-title" className="interface-guardrail">
        <span id="interfaces-guardrail-title">Focused tools, not teammates</span>
        <p>
          These interfaces do not join People or author Now posts. Every interface requires a named human owner before use; none is assigned yet. Humans retain intent, review, acceptance, publication, and external sending.
        </p>
      </aside>

      <ol aria-label="Planned meta-agent interfaces" className="interface-list">
        {interfaceCatalog.map((item, index) => (
          <li key={item.id}>
            <article aria-labelledby={`interface-${item.id}-title`} className="interface-row">
              <span aria-hidden="true" className="interface-row__number">
                {String(index + 1).padStart(2, '0')}
              </span>

              <div className="interface-row__identity">
                <div className="interface-row__title">
                  <h2 id={`interface-${item.id}-title`}>{item.name}</h2>
                  <span>{item.label}</span>
                </div>
                <p>{item.purpose}</p>
              </div>

              <dl className="interface-row__routing">
                <div>
                  <dt>Intended subdomain</dt>
                  <dd>
                    <code>{item.intendedHost}</code>
                    <small>Not live</small>
                  </dd>
                </div>
                <div>
                  <dt>Path fallback</dt>
                  <dd><code>{item.fallbackPath}</code></dd>
                </div>
              </dl>

              <dl className="interface-row__accountability">
                <div>
                  <dt>Status</dt>
                  <dd><span className="interface-status">{item.status}</span></dd>
                </div>
                <div>
                  <dt>Human owner</dt>
                  <dd>
                    <small>Required</small>
                    <strong>{item.humanOwner}</strong>
                  </dd>
                </div>
              </dl>
            </article>
          </li>
        ))}
      </ol>

      <section aria-labelledby="job-boundary-title" className="interface-boundary">
        <header>
          <span className="eyebrow">Shared Job / artifact boundary</span>
          <h2 id="job-boundary-title">Tools prepare. Humans accept.</h2>
          <p>
            Every interface works through the same review boundary. A tool may prepare a proposal or candidate; only a human may accept the work and close the Job.
          </p>
        </header>

        <ol className="boundary-flow">
          <li><span>01</span><strong>Job proposed</strong><small>Reviewable scope</small></li>
          <li><span>02</span><strong>Job accepted</strong><small>Human decision</small></li>
          <li><span>03</span><strong>Candidate produced</strong><small>Artifact + evidence</small></li>
          <li><span>04</span><strong>Artifact accepted</strong><small>Human decision + receipt</small></li>
        </ol>

        <p className="boundary-rule">
          No interface may activate its own Job, accept its own artifact, resolve a Job, or speak as a person in the feed.
        </p>
      </section>
    </section>
  )
}
