> Implementation update (2026-09-08): M1 token foundation is implemented; light/dark element layout and computed visual styles match the existing live alpha. M2 onward remains design work. See [verification](../FOUNDATIONS_AND_LIVE_USE.md).

> Design proposal — not shipped. Prepared by an agent design pass on 2026-09-08.
> Milestones M1–M8 are ordered and testable; M1 is guaranteed pixel-identical to the current alpha.
> Owner review required before any milestone starts.

# Work environments as apps — UX & AX design

**Stack:** telepathy / oc2 · **Status:** design proposal (one deliverable) · **Base:** current alpha at `site/` + nudge typed-Markdown idea + Interfaces catalog (`plugins/telepathy-meta-agents/registry.json`)

## 0. Frame

The product loop this document designs:

```text
env DSL (*.env.md)
  → compile (deterministic, closed schema) → EnvBundle   {theme, icons, shell, copy}
  → render a themed app shell                             rail / header / feed / composer / detail
  → humans act                                            posts, replies, acks, resolutions, jobs
  → local intent signals                                  drafts, repeats, open asks, mentions
  → deliberate delight moments                            rescue, nudge, flourish — never surveillance
```

**Hard rule (from PRODUCT.md / README):** humans are the only visible authors. Agents never appear as feed authors and never become teammates to monitor. Agent traffic stays underneath the surface. This document treats that rule as a type-system and test rule in §5 and §6, not as a guideline.

**What exists today (the base we build on):**

- Screens: **Now** (All / Open questions / Questions / Decisions / Updates / Announcements filters, pinned feed, open-question count), **Share** (composer with kind picker: update / decision / question / announcement), **Post** (replies, acknowledgements, resolution), **People**, **Changelog**, **Interfaces** (catalog of Prime / Build / Steward / Research / Relationships).
- Tokens already in `site/src/styles.css`: `--paper #f2eee6`, `--ink #26231f`, `--accent #bd3b22` (light) / `#ef6849` (dark), `--olive #67704c`, `--question #796331`, `--announcement #6d5578`, serif display + Inter sans.
- Registry data shape: `{id, name, label, purpose, host, path, status, agentFile, runtime, jtbd[], may[], mustNot[]}`.
- Nudge idea to reuse: `+++` TOML frontmatter with a **closed** set of tables, typed `nudge-prompt` fences, deterministic compile to an immutable bundle with a digest.
- Labs board (`oc2-labs.sh`): dark `#0b0d10` page, single column, HTML tables, `ok`/`down` badges, inline `<style>`, no tokens, no rail. It is the clearest candidate for the env-app treatment (§3.4).


## 1. Theme system

### 1.1 Base token set

Extend the existing variables into one complete token set. Keep the current names where they exist so the alpha look does not change on day one. All values below are real and ship as CSS custom properties.

**Color — light**

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#f2eee6` | page background |
| `--paper-raised` | `#faf7f0` | cards, sidebar, composer |
| `--paper-soft` | `#e9e3d8` | hover fills, chips |
| `--paper-deep` | `#ddd4c6` | pressed, wells |
| `--ink` | `#26231f` | primary text |
| `--ink-secondary` | `#625c54` | body copy |
| `--ink-tertiary` | `#6f675e` | meta, captions, icons |
| `--line` | `#d7cec0` | hairline borders |
| `--line-strong` | `#bfb4a4` | structural borders |
| `--accent` | `#bd3b22` | env-mapped brand color (default: telepathy) |
| `--accent-deep` | `#902a18` | hover/pressed accent, error text |
| `--accent-soft` | `#f1d8d0` | accent-tinted fills |
| `--olive` | `#67704c` | semantic: update, resolved, success |
| `--olive-soft` | `#e2e5d5` | resolution strip fill |
| `--question` | `#796331` | semantic: questions, asks |
| `--question-soft` | `#eee5ca` | ask chips |
| `--announcement` | `#6d5578` | semantic: announcements |
| `--announcement-soft` | `#ebe1ee` | announcement chips |
| `--danger` | `#9b3d2b` | destructive, rejected jobs (semantic only, never brand) |
| `--agent` | `#5b7a9d` | agent surfaces: muted slate-blue, demotes machinery |
| `--agent-soft` | `#e3e9f0` | background for agent-prepared cards |

**Color — dark**

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#1d1b18` | page background |
| `--paper-raised` | `#25221e` | cards, sidebar, composer |
| `--paper-soft` | `#2e2a25` | hover fills |
| `--paper-deep` | `#38322c` | pressed, wells |
| `--ink` | `#f1ece3` | primary text |
| `--ink-secondary` | `#bcb3a8` | body copy |
| `--ink-tertiary` | `#938a80` | meta, captions, icons |
| `--line` | `#3f3932` | hairline borders |
| `--line-strong` | `#5a5147` | structural borders |
| `--accent` | `#ef6849` | env-mapped brand color |
| `--accent-deep` | `#ff896f` | hover accent |
| `--accent-soft` | `#48291f` | accent-tinted fills |
| `--olive` | `#b4c089` | update, resolved, success |
| `--olive-soft` | `#313725` | resolution strip fill |
| `--question` | `#d5b664` | questions, asks |
| `--question-soft` | `#3a321f` | ask chips |
| `--announcement` | `#c7a7d0` | announcements |
| `--announcement-soft` | `#382d3c` | announcement chips |
| `--danger` | `#e07156` | destructive, rejected jobs |
| `--agent` | `#8fb0d4` | agent surfaces |
| `--agent-soft` | `#24303d` | agent-prepared cards |

**Spacing** (4px base): `--space-1 4px`, `--space-2 8px`, `--space-3 12px`, `--space-4 16px`, `--space-5 20px`, `--space-6 24px`, `--space-8 32px`, `--space-10 40px`, `--space-12 48px`, `--space-16 64px`.

**Type**

| Token | Value |
| --- | --- |
| `--sans` | `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| `--serif` | `Georgia, 'Times New Roman', serif` |
| `--text-2xs` | `10px` (labels, countdowns) |
| `--text-xs` | `12px` (meta, buttons, helpers) |
| `--text-sm` | `13px` (nav, chips) |
| `--text-base` | `15px` (body default) |
| `--text-lg` | `18px` (card titles) |
| `--text-xl` | `21px` (composer prompt) |
| `--text-2xl` | `26px` (post titles) |
| `--text-3xl` | `34px` (open-question count) |
| `--text-display` | `clamp(48px, 7vw, 78px)` (view headings, serif, weight 500) |

**Radius:** `--radius-sm 6px`, `--radius-md 8px`, `--radius-lg 12px`, `--radius-xl 14px`, `--radius-pill 999px`.

**Motion**

| Token | Value | Use |
| --- | --- | --- |
| `--ease-enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | view enter, composer open |
| `--ease-hover` | `cubic-bezier(0, 0, 0.2, 1)` | hover transitions |
| `--dur-fast` | `120ms` | hover, focus |
| `--dur-base` | `180ms` | buttons, toggles |
| `--dur-slow` | `260ms` | view transitions, flourishes |

Reduced-motion guard (global, once): `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`.

### 1.2 Per-program accent themes

Each program owns **one accent hue family**, an icon, and a mark glyph. The accent is the only brand color; status colors (`--olive`, `--question`, `--danger`) never change per program.

| Program | Identity | Light accent / deep / soft | Dark accent / deep / soft | Icon (lucide) | Mark |
| --- | --- | --- | --- | --- | --- |
| **telepathy** | warm paper, editorial, human thread | `#bd3b22` / `#902a18` / `#f1d8d0` | `#ef6849` / `#ff896f` / `#48291f` | `waves` (ripples) | italic serif **T** |
| **sansara** | Swiss industrial, hard 1px grid, one green signal (per its DESIGN.md) | `#2f6f4f` / `#1e4635` / `#dce7df` | `#57a97f` / `#79c79b` / `#16301f` | `orbit` (grid-globe) | `§` |
| **iktara** | dusk sky, glass, personal reflection | `#5b6abf` / `#3d4a94` / `#e2e6f6` | `#8f9be0` / `#b3bcf0` / `#232a52` | `sparkles` (four-point star) | `✦` |
| **nudge** | compiler paper, proof, digests | `#b45309` / `#92400e` / `#f6e8d6` | `#fbbf24` / `#fcd34d` / `#3a2c14` | `braces` | `ƒ` |

Sansara keeps its documented substrate (`#f4f4f0` paper, `#0b0c0a` ink, `#11130f` structural lines) as a theme **variant** — a program may set `substrate = "sansara"` to swap the paper/ink set while keeping the accent mapping. No program mixes a second accent.

### 1.3 Declaring a theme in the DSL — one line

In the env file frontmatter:

```toml
[env]
theme = "nudge"
```

Allowed values: `telepathy` (default), `sansara`, `iktara`, `nudge`, or an inline hex override `theme = "iktara|#4a7fd4"` (hex becomes `--accent`; deep/soft are derived at 15% darken / 8% tint). The compiler emits exactly this CSS and sets `data-env` on `<html>`:

```css
:root[data-env='nudge'] {
  --accent: #b45309; --accent-deep: #92400e; --accent-soft: #f6e8d6;
}
:root[data-theme='dark'][data-env='nudge'] {
  --accent: #fbbf24; --accent-deep: #fcd34d; --accent-soft: #3a2c14;
}
```

Components read **only** `--accent*` and the semantic tokens. No component ever references a program color directly. With no `[env]` block, the app renders today's alpha unchanged — this is the M1 acceptance test.


## 2. Intelligent icon & component placement

### 2.1 Icon semantic map (icon name → meaning)

One map, closed. The picker resolves a **semantic key**, never a free-form prompt. Stroke 1.7, 24×24 grid, `currentColor`, `aria-hidden`. Missing keys compile with a warning and fall back to `circle`.

| Semantic key | Icon (lucide name) | Meaning / where it appears |
| --- | --- | --- |
| `post.update` | `arrow-up-right` | motion, change · kind chip + composer tab |
| `post.decision` | `scale` | a call was made · kind chip |
| `post.question` | `circle-help` | open ask · kind chip + Open questions filter |
| `post.announcement` | `megaphone` | must-not-miss · kind chip |
| `post.pinned` | `pin` | pinned feed item |
| `post.reply` | `reply` | reply action + count |
| `post.acknowledge` | `check` | context landed |
| `post.resolved` | `circle-check-big` | resolution strip |
| `job.proposed` | `clipboard-pen` | Prime draft |
| `job.accepted` | `clipboard-check` | human accepted scope |
| `job.candidate` | `hammer` | Build candidate + evidence |
| `job.artifact` | `package-check` | reviewed artifact |
| `job.receipt` | `badge-check` | Steward receipt |
| `job.rejected` | `circle-x` | human rejected (danger color) |
| `artifact.report` | `file-text` | report |
| `artifact.blog` | `pen-line` | blog |
| `artifact.proposal` | `file-search` | proposal |
| `artifact.announcement` | `megaphone` | announcement artifact |
| `interface.prime` | `compass` | steer intent → proposal |
| `interface.build` | `hammer` | build candidates |
| `interface.steward` | `scroll-text` | receipts + changelog |
| `interface.research` | `microscope` | evidence dossiers |
| `interface.relationships` | `send` | external drafts |
| `env.feed` | `list` | rail: feed (today's NowIcon) |
| `env.people` | `users` | rail: people |
| `env.interfaces` | `blocks` | rail: interfaces (today's InterfacesIcon) |
| `env.changelog` | `list-checks` | rail: changelog |
| `env.release-radar` | `radar` | env identity (example) |
| `env.labs` | `cpu` | labs status env (example) |
| `status.planned` | none — hollow dot via CSS | planned, not live |
| `status.live` | none — filled dot via CSS | live, current |
| `person.*` | **never an icon** | humans render as initials avatars only |

**Picker rules (the "AI picks an icon" contract):**

1. Semantic key first. If the object has a typed kind (`post.kind`, `job.state`, `artifact.type`, `interface.id`), use its key. No other lookup.
2. Fallback chain: `semantic key → category → default circle`. Never a model-chosen arbitrary glyph.
3. One icon per object. A second visual signal is a **dot or a color**, not a second icon.
4. Noun over verb: `scale` for a decision, not a "checkmark pencil".
5. Icon color: `--ink-tertiary` by default; kind color only inside kind chips; `--danger` only for rejected.
6. If no key matches, compile emits a warning listing the unmatched string — the author fixes the key, they do not paste an SVG.

### 2.2 Component placement heuristics (the shell)

Regions: **rail** (left, fixed 248px), **header** (sticky 76px), **feed** (main column, max 940px), **composer** (invite → expanded form), **detail** (post thread or job thread, right column on ≥1200px, stacked below on mobile).

| Component | Region | Placement rule |
| --- | --- | --- |
| Env brand lockup | rail top | mark glyph + env name + alpha label |
| Nav items | rail | human surfaces first (feed, people), tools last (interfaces, jobs, changelog) |
| Theme toggle + identity | header right | always present, 42px round, `--line` border |
| Env status chip | header left | only if env has a live/planned status; never in the feed |
| Open-ask count | header right of title | render only when count > 0; serif, `--accent` |
| Composer invite | feed top, above pinned | always; one line: plus + "Add to <env name>" + kind hint |
| Pinned posts | feed, between composer and toolbar | at most `limits.maxPinned` (default 3); overflow folds into a "Pinned (n)" disclosure |
| Filter toolbar | feed, under pinned | one row of pills; max 6 filters, then an overflow menu |
| Posts | feed | kind chip + avatar + time + title/body; one action row: Reply, Acknowledge, Resolve (questions only) |
| Resolution strip | inside post, above footer | olive strip, `circle-check-big`, "Resolved by {name} · {date}" |
| Acknowledgements | post footer | avatar stack + "Acknowledged by {names}" |
| Job objects | detail only (never feed) | job thread page or detail card under Interfaces |
| Receipts | detail only | muted `--agent-soft` card, "Prepared by {interface} · accepted by {human}" |
| Empty states | feed / catalog | one sentence + one action; never a mascot |
| Error states | inline | `--danger` text + retry; form errors stay in the form |

**Heuristics that must hold:** agent-prepared objects always carry `--agent-soft` background, the "Prepared" label, and **no avatar** (avatars are human-only). Human-authored objects always carry an avatar. Status dots live in header/detail only — never per feed row. A row shows at most 2 badges.

### 2.3 Anti-patterns to avoid

| Anti-pattern | Symptom | Rule | Enforcement |
| --- | --- | --- | --- |
| Badge flood | 4+ chips per row | max 2 badges/row (`limits.maxBadgesPerRow`) | renderer truncates + lint warns |
| Icon soup | icon + emoji + color all saying one thing | one icon, then color only | code review + iconMap test |
| Agent-noise | job logs, receipts, statuses inside Now | jobs/receipts render only in detail/Interfaces | feed renderer filter (§5.3 test) |
| Fake activity | "Build is working…" live tickers | no liveness streams; status is Planned/Live only | no timestamps in Interfaces test |
| Accent misuse | blue button in a nudge env | components read `--accent*` only | CSS lint: program colors banned in components |
| Empty-state blandness | "Nothing here." | one sentence + one action | copy review in each view |
| Surveillance feel | "We noticed you…" toasts, read receipts, streak counters | all cues local, dismissible, never about other people (§4.3) | signals never leave localStorage (test) |
| Auto-posting | draft self-publishes | only a human press publishes | dispatch surface: `add-post` only from composer submit |


## 3. DSL → app mapping

### 3.1 The work environment DSL — `telepathy.env/v1`

Built on nudge's idea: typed Markdown, `+++` TOML frontmatter, a **closed** set of tables, ordered `env-prompt` fences, deterministic compile to an immutable `EnvBundle` with a digest. A file named `release-radar.env.md` is the entire definition of that work app.

**Closed frontmatter set** (unknown tables and fields are compile errors, exactly like nudge):

```text
schema, name, version                          required
[env]       name, theme, icon, mark?, audience?
[shell]     layout, rails[], defaultView
[composer]  enabled, kinds[]
[[feed]]    id, label, kinds[], sort, pinnedMax?
[[jobs]]    id, label, source
[signals]   features[]
[limits]    maxPinned?, maxBadgesPerRow?
```

- `[env]`: `name` (shown in rail + header), `theme` (one line, §1.3), `icon` (semantic key from §2.1 or `env.*`), `mark` (optional glyph), `audience` (`all` | `me` — `me` removes People/Interfaces rails).
- `[shell]`: `layout` from a fixed set (`rail-header-feed`, `rail-header-feed-detail`, `rail-header-board`); `rails` lists which rail items exist and their order; `defaultView` names the first view.
- `[composer]`: `enabled` + `kinds` subset of `update | decision | question | announcement`.
- `[[feed]]`: typed feed sections. `kinds` filters post types; `sort` is `newest` | `pinned-first`.
- `[[jobs]]`: read-only receipt projections (`source: "steward"`), rendered as job detail cards, never feed rows.
- `[signals]`: which intent signals are on for this env (§4.1).
- `[limits]`: placement ceilings enforced by the renderer.

**Prompt fences** provide composer copy per kind:

````text
```env-prompt update
What changed in the last release?
```
````

The compiler validates: declared kinds match composer kinds, `env.icon` resolves to a known key, exactly one `layout`, at least one `[[feed]]`, no fence for an undeclared kind, no undeclared kind in `[composer]`. Ordinary Markdown outside frontmatter and fences is documentation only (never UI), same rule as nudge.

**Compile contract:**

```text
release-radar.env.md
  → compileEnv(markdown) → EnvBundle {digest, env, shell, composer, feeds, jobs, signals}
  → renderEnv(bundle, workspace) → React tree
```

Identical source bytes → identical bundle digest. A `--changed` flag in the digest computation is the only thing allowed to differ between UI runs.

### 3.2 Full example: `release-radar.env.md`

````markdown
+++
schema = "telepathy.env/v1"
name = "release-radar"
version = "0.1.0"

[env]
name = "Release Radar"
theme = "nudge"
icon = "env.release-radar"
audience = "all"

[shell]
layout = "rail-header-feed-detail"
rails = ["feed", "jobs", "interfaces"]
defaultView = "feed"

[composer]
enabled = true
kinds = ["update", "decision", "announcement"]

[[feed]]
id = "radar"
label = "Radar"
kinds = ["update", "announcement", "decision"]
sort = "newest"
pinnedMax = 2

[[jobs]]
id = "ships"
label = "Ships"
source = "steward"

[signals]
features = ["draft-rescue", "ask-aging", "repeated-view-pin"]

[limits]
maxPinned = 2
maxBadgesPerRow = 2
+++

# Release Radar

A focused surface for release work. Questions stay in Telepathy Now;
this env only accepts what moves the release forward.

```env-prompt update
What changed in the last release?
```

```env-prompt decision
What was decided, and why does it matter for the next release?
```

```env-prompt announcement
What should every builder not miss before the next ship?
```
````

### 3.3 What UI this generates

- **Theme:** nudge identity — amber accent `#b45309` on warm paper (dark: `#fbbf24`), `ƒ` mark in the rail lockup, `data-env="nudge"` on `<html>`.
- **Rail:** "Release Radar" + `ƒ` mark · items in declared order: **Radar** (`list`), **Ships** (`job.receipt`), **Interfaces** (`blocks`); theme toggle + identity at bottom.
- **Header:** "Release Radar" in display serif; "2 open asks" only if open questions exist (there are none by composer config, so the chip never shows — config-driven, not hardcoded).
- **Composer invite:** "Add to Release Radar — update, decision, or announcement". Expanding shows only those three tabs, with the DSL prompts: update tab asks *"What changed in the last release?"*.
- **Feed:** pinned posts (max 2) → filter pills for Update / Decision / Announcement → posts with kind chips, avatars, replies, acks. Questions cannot be composed here and do not appear.
- **Detail (Ships):** Steward receipt cards — "Release v0.3.0 shipped · accepted by Shubham" with revision link and changelog projection — on `--agent-soft` backgrounds, "Prepared by Steward" label, no avatar.
- **Signals on:** draft-rescue, ask-aging, repeated-view-pin (§4.2 moments 1, 3, 8).

Compiled `EnvBundle` (excerpt):

```json
{
  "schema": "telepathy.env/v1",
  "digest": "sha256:9f2c…",
  "env": {"name": "Release Radar", "theme": "nudge", "icon": "env.release-radar"},
  "shell": {"layout": "rail-header-feed-detail", "rails": ["feed", "jobs", "interfaces"], "defaultView": "feed"},
  "composer": {"kinds": ["update", "decision", "announcement"], "prompts": {
    "update": "What changed in the last release?",
    "decision": "What was decided, and why does it matter for the next release?",
    "announcement": "What should every builder not miss before the next ship?"}},
  "feeds": [{"id": "radar", "label": "Radar", "kinds": ["update", "announcement", "decision"], "sort": "newest", "pinnedMax": 2}],
  "jobs": [{"id": "ships", "label": "Ships", "source": "steward"}],
  "signals": ["draft-rescue", "ask-aging", "repeated-view-pin"]
}
```

### 3.4 The labs board as the second env

`oc2-labs.sh` today: dark `#0b0d10`, one column, tables, `ok`/`down` badges, inline styles, no tokens, no mobile rail. Express it as `labs.env.md` with `theme = "sansara"` (its own design language already matches: hard grid, one green signal `#2f6f4f`), `icon = "env.labs"`, one `[[feed]]`-like **board** section, and the node-status row rendered as a header chip (`status.live` dot, green = healthy, `--danger` = down) instead of a table row. The page's copy stays; only the skin changes. This is the cheapest proof the DSL covers the whole oc2 surface, not just telepathy.


## 4. Intent hunting → delight

### 4.1 Signal taxonomy

Signals are **local, typed, capped, expiring**. Storage key `tp.signal.<id>` under localStorage; ring buffer max 200 events; every signal expires. They are never uploaded, never shared across demo identities, and cleared by "Reset local demo". A "Local cues" toggle in the header settings disables all of them.

| Signal id | Capture point (exact) | Meaning | Expiry |
| --- | --- | --- | --- |
| `draft.abandoned` | composer closed/cancelled with kind, title, or body non-empty and never submitted | unfinished intent worth rescuing | 72h |
| `draft.mention-pending` | abandoned draft contains `@<person>` text | the author planned to ask someone | 72h |
| `ask.open-age` | `post.kind === 'question' && !post.resolution && now - createdAt > 72h` | a human ask is stalled | until resolved |
| `ask.directed` | open question whose body or title contains `@me` | someone needs me | until resolved |
| `view.repeated` | same post detail opened ≥3 times in 7 days, by the post's own author, not pinned | author keeps returning to their own post | 7 days |
| `search.empty` | search/filter returns 0 results | unmet question the env could host | 24h |
| `onboarding.first-complete` | all onboarding items for the active person just flipped to complete | first full loop done | one-shot, never repeats |
| `composer.hesitate` | composer open > 120s with < 20 chars typed, per kind | author stuck on phrasing | once per kind per session |

### 4.2 Delight moments (8)

Each moment names its **exact trigger**, **exact response**, and the **guardrail** that keeps it from becoming surveillance. None of these post, reply, acknowledge, or resolve anything on the author's behalf.

**M1 — Draft rescue.** Trigger: `draft.abandoned` on next visit to the env. Response: one quiet line above the composer invite — *"Finish your update?"* with **[Restore]** (refills kind, title, body, keeps cursor at end) and **[Discard]**. Guardrail: never autosends; restores once per draft; shows only to the author who typed it.

**M2 — Mention reminder.** Trigger: restoring a draft with `draft.mention-pending`. Response: inside the restored composer, one chip above the body — *"You were going to mention Om — keep it in?"* with a ✓ toggle (on by default). Guardrail: mentions are the author's call; the chip never edits text.

**M3 — Stalled-ask nudge.** Trigger: `ask.open-age` on a question in the Questions / Open questions view. Response: an amber `--question` chip appended to that post's meta row — *"Open 3 days — still need an answer?"* linking to its **Resolve question** action. Guardrail: never reposts, never pings anyone, disappears the moment the question resolves.

**M4 — Empty search becomes a question.** Trigger: `search.empty`. Response: empty state — *"No matches. Ask it as a Question?"* with **[Ask]** that opens the composer prefilled: kind = question, title = the query. Guardrail: a draft, not a post; the human presses Add.

**M5 — Acknowledgement flourish.** Trigger: pressing **Acknowledge** on someone else's post. Response: single 400ms ink ring ripple from the button + the count bumping, once; static afterwards. Guardrail: skipped under `prefers-reduced-motion`; no confetti, no streaks.

**M6 — First full loop.** Trigger: `onboarding.first-complete`. Response: one dismissible "You're set" card at the top of Now — three next actions (Post an update, Resolve an open question, Acknowledge one teammate) with direct links. Guardrail: appears once, ever; never a progress percentage on other people.

**M7 — Resolution receipt.** Trigger: a question resolves. Response: the existing olive resolution strip + a one-time 500ms underline sweep; then it is static furniture with *"Resolved by {name} · {date}"*. Guardrail: the receipt belongs to the human who resolved it; no agent is credited for it.

**M8 — Revisit → pin.** Trigger: `view.repeated` (the author returned to their own post ≥3 times). Response: a quiet footer hint on that post, author-only — *"Revisiting this? Pin it so the team sees it."* with **[Pin]**. Guardrail: max once per post; only the author sees it; pinning is still a manual act.

### 4.3 Delight ≠ surveillance

Banned by construction: read receipts on other people, "X is typing", streak counters, "We noticed you viewed…" toasts, cross-person intent inference, pre-filled feed posts, auto-acknowledgements, and any signal about another person's behavior shown to a third person. All cues above render from the **local** signal store, show at most once per trigger, are dismissible, and never travel with the workspace state. The system voice that writes cue copy ("Finish your update?") is product chrome — it is not an agent, and it never appears as an author anywhere. Agents remain under the surface (§5), even when a cue saves a human time.


## 5. AX — agent experience principles

Agents and humans co-experience the same design language, but **not the same surface**. Agent-facing objects (job threads, candidates, receipts) render as detail objects in the same tokens — never as feed rows, never as authors, never as a teammate to monitor.

### 5.1 Job objects in the design language

A job has states: `proposed → accepted → building → candidate → review → resolved | rejected`. Each state is a chip: `--agent-soft` background, `--agent` text, state icon from §2.1 (`job.*`), plus one status dot. Every card that contains agent-prepared content carries the label **"Prepared by {interface}"** and **no avatar** — avatars are reserved for humans.

Job thread (detail page) layout, top to bottom:

1. **Intent** — the human ask, quoted, with the human's avatar, name, date.
2. **Proposal card** (`job.proposed`, `clipboard-pen`) — scope, owner, reviewer, acceptance criteria; buttons **Accept** / **Edit** / **Reject** (human-only).
3. **Candidate cards** (`job.candidate`, `hammer`) — exact revision, evidence chips (checks passed/failed), diff link; label "Prepared by Build".
4. **Receipt** (`job.receipt`, `badge-check`) — "Accepted by {human name} · {date} · {link}"; label "Prepared by Steward".
5. **Rejected** (`job.rejected`, `circle-x`, `--danger`) — human rejection note only.

The same tokens, type scale, radius, and motion as a post — so the machinery feels like the product, but `--agent` + no avatar + "Prepared by" demote it visually one step below human content. Agent liveness never renders: no "running…" spinners, no log tails, no live transcript. Per PRODUCT.md, harness events and session IDs are internal metadata and never reach the UI.

### 5.2 What the agent sees vs what the human sees

| Surface | Human sees | Agent sees (underneath) |
| --- | --- | --- |
| Feed | posts, replies, acks, resolutions | **never the feed** — only job-scoped context the human attached |
| Job proposal | scope + acceptance criteria + Accept/Edit/Reject | full intent text, repo context, limits, review contract |
| Candidate | revision + evidence summary + diff link | full build log, failing checks, worktree state |
| Receipt | outcome + who accepted + link | job trace, digests, changelog projection |
| Interfaces | catalog cards, Can/Cannot, human owner | its own charter (`may` / `mustNot`), job queue |
| Delight cues | local cue text ("Finish your update?") | none — cues are product chrome, not agent output |

The rule in one line: **the agent works in the job thread; the human projects to the feed.** An agent may draft a post, but only the human publishes it as the author (Steward's `mustNot: "Author or publish posts"` already encodes this).

### 5.3 Interfaces catalog rendered beautifully

Restyle `InterfacesView` from rows into **interface cards**, reading the full registry shape (`jtbd`, `may`, `mustNot` — today the view hardcodes a subset). Spec:

- **Grid:** 2 columns on ≥900px, 1 column below; gap `--space-6`.
- **Card:** `--paper-raised`, `--radius-xl`, 1px `--line` border; hover lifts 2px with `--ease-hover`/`--dur-base`.
- **Top row:** 48px glyph tile (`env.interfaces` style tile, `--accent-soft` background, interface icon from §2.1) + name (serif `--text-2xl`) + label (eyebrow).
- **Body:** purpose line (`--text-base`, `--ink-secondary`), then **JTBD chips** (`--radius-pill`, `--paper-soft`).
- **Status + ownership:** `status.planned` hollow dot + "Planned" · "Human owner: **Required**" in `--question` until one is assigned.
- **Expanding "Can / Cannot":** two-column list from `may` (prefixed ✓, `--olive`) and `mustNot` (prefixed ✕, `--danger`) — the registry's contract becomes the UI's contract.
- **Boundary strip:** the existing "Tools prepare. Humans accept." 4-step flow stays, restyled with the same cards.
- **Hard rules, enforced:** no timestamps, no activity streams, no live endpoints, no feed rows in this view (test: the catalog render tree contains zero `PostItem` instances and zero `<time>` elements).

Sketch of the card component:

```tsx
<article className="interface-card" aria-labelledby={`iface-${item.id}`}>
  <div className="interface-card__glyph"><Icon /></div>
  <div className="interface-card__head">
    <h2 id={`iface-${item.id}`}>{item.name}</h2>
    <span className="eyebrow">{item.label}</span>
  </div>
  <p className="interface-card__purpose">{item.purpose}</p>
  <ul className="chip-list">{item.jtbd.map((t) => <li className="chip">{t}</li>)}</ul>
  <dl className="interface-card__status">
    <div><dt>Status</dt><dd><span className="dot dot--planned" />{item.status}</dd></div>
    <div><dt>Human owner</dt><dd className={item.humanOwner === 'Unassigned' ? 'is-missing' : ''}>{item.humanOwner}</dd></div>
  </dl>
  <details className="interface-card__contract">
    <summary>Can / Cannot</summary>
    <ul className="may-list">{item.may.map((m) => <li>✓ {m}</li>)}</ul>
    <ul className="mustnot-list">{item.mustNot.map((m) => <li>✕ {m}</li>)}</ul>
  </details>
</article>
```

### 5.4 The hard rule as code

- `types.ts`: post/reply authors are typed `PersonId` only; a new `authorKind: 'human'` field is **not** optional — `Post.authorId` must resolve to a `Person`. There is no `AgentId` union member.
- Feed renderer filter: `posts.filter((p) => people.some((person) => person.id === p.authorId))` — an agent-authored fixture cannot render in the feed.
- Tests (`hardRules.test.ts`): (1) a crafted agent-authored post is rejected by the feed filter; (2) Interfaces view contains no `<time>` and no `PostItem`; (3) job cards never contain `Avatar`; (4) the app never renders transcript/prompt/tool-call text.
- Compile check: `telepathy.env/v1` has no table that can declare an author; authorship is workspace data, not DSL data.


## 6. Implementation milestones (ordered, testable)

All steps land in the existing `site/` alpha; each has files and a verification command. M1 must leave the current alpha visually unchanged.

### M1 — Token foundation
- **Change:** split `site/src/styles.css` into `tokens.css` (§1.1 full set) + component CSS; add `data-env` mapping block (§1.3) with telepathy as default; add `prefers-reduced-motion` guard.
- **Files:** `site/src/tokens.css` (new), `site/src/styles.css` (import tokens), `site/src/theme.ts` (new: `setEnvTheme(env, theme)` helper).
- **Verify:** `cd site && npm run build && npm test`; open the live preview — screenshot-identical to today in light and dark; DevTools shows every §1.1 token resolved; `data-env="telepathy"` on `<html>`.

### M2 — Env DSL compiler
- **Change:** implement `compileEnv(markdown) → EnvBundle` with the closed §3.1 schema, validation errors, and sha256 digest (mirror nudge's discipline: unknown table = compile error, no silent defaults).
- **Files:** `site/src/env/schema.ts`, `site/src/env/compileEnv.ts`, `site/src/env/compileEnv.test.ts`.
- **Verify:** `npx vitest run src/env` — the §3.2 example compiles to the §3.3 bundle; a file with an unknown table, an undeclared kind, or a bad icon key fails with a named error; identical bytes → identical digest.

### M3 — Shell renderer + first env
- **Change:** `AppShell` (rail/header/feed/composer/detail regions from §2.2) and `EnvView` rendering an `EnvBundle`; route `/#/envs/release-radar`; ship `release-radar.env.md` under `site/src/env/examples/`.
- **Files:** `site/src/components/AppShell.tsx`, `site/src/views/EnvView.tsx`, `site/src/App.tsx` (route + env registry), `site/src/env/examples/release-radar.env.md`.
- **Verify:** `npm run dev` → Release Radar renders with nudge amber, `ƒ` mark, Radar/Ships/Interfaces rail, 3-kind composer with DSL prompts, Ships detail cards; dark toggle works; 320px mobile works. Stretch: `labs.env.md` renders the labs board look (§3.4).

### M4 — Icon engine
- **Change:** the §2.1 semantic map as data + `IconPicker(key)` with the fallback chain and warning for unknown keys; swap the four existing nav icons and kind chips onto it.
- **Files:** `site/src/iconMap.ts`, `site/src/components/IconPicker.tsx`, `site/src/iconMap.test.ts`, `site/src/components/Icons.tsx` (lucide equivalents).
- **Verify:** test iterates every semantic key → resolves to a component; unknown key falls back to `circle` and logs one warning; existing screens unchanged.

### M5 — Intent signal store
- **Change:** local ring buffer (cap 200, per-signal expiry, cleared on reset, off-switch) implementing §4.1 capture points.
- **Files:** `site/src/lib/signals.ts`, `site/src/lib/signals.test.ts`, settings toggle in `App.tsx`.
- **Verify:** unit tests for cap/expiry/clear/toggle; with DevTools open, firing all signals produces **zero network requests**; switching demo identity isolates signal keys.

### M6 — Delight moments
- **Change:** `DelightLayer` wiring the 8 moments from §4.2 onto the signals; composer restore path in `Composer.tsx`.
- **Files:** `site/src/components/DelightLayer.tsx`, `site/src/delights/*.ts` (one module per moment), `site/src/components/Composer.tsx` (restore), `site/src/delights/delights.test.tsx`.
- **Verify:** one component test per moment asserts the exact trigger and exact response copy; reduced-motion test asserts M5/M7 animations collapse; manual script: draft → leave → return → "Finish your update?" appears exactly once.

### M7 — Interfaces catalog + Job view
- **Change:** restyle Interfaces to cards (§5.3) reading the full registry shape (`jtbd`, `may`, `mustNot`); add `JobThreadView` for the §5.1 job states; job fixtures in seed.
- **Files:** `site/src/interfaces.ts` (full registry fields), `site/src/views/InterfacesView.tsx`, `site/src/views/JobThreadView.tsx`, `site/src/jobs.ts` (state model).
- **Verify:** catalog renders JTBD chips, Can/Cannot lists, Planned dots, "Human owner: Required"; JobThreadView shows proposal→candidate→receipt in `--agent` styling with no avatars; axe scan on both views reports no violations.

### M8 — Hard-rule tests, a11y, ship
- **Change:** the §5.4 hard-rule test suite; one axe pass over every view (empty/failure/mobile states included); build and deploy to GitHub Pages.
- **Files:** `site/src/hardRules.test.ts`, `site/src/test/a11y.test.tsx`, GitHub Pages workflow touch-up.
- **Verify:** `cd site && npm test && npm run build`; live smoke on `https://intuitxn.github.io/telepathy/` — Now/Share/Post/People/Changelog unchanged, `/#/envs/release-radar` live, no agent-authored text visible in any feed, no transcript/prompt/tool text anywhere in the DOM.

### Ordering rationale

M1 → M2 → M3 deliver the DSL-to-app spine; M4 and M5 are independent of each other and can run in parallel after M3; M6 depends on M5; M7 and M8 can run in parallel after M3 and close the AX story. The alpha acceptance rules in PRODUCT.md (every post has a visible human author, no agent transcript exposed, empty/failure/mobile usable) are regression-tested at M1 and re-checked at M8.

---

**Bottom line:** one DSL file themes an app (one line), the icon engine keeps surfaces legible, placement rules keep agent machinery out of the feed, eight deliberate delights reward intent without surveillance, and the AX layer renders jobs and receipts in the same language one step below humans — enforced by types and tests, not by convention.
