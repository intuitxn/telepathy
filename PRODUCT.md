# Telepathy product contract

## Thesis

Telepathy is the shared working context for a small team. It helps people understand what changed, why it matters, and what another person needs from them. Automation may organize, route, remember, and prepare work, but humans remain the visible participants.

## Personas

For the internal alpha, a persona is a real team member with an accountable identity:

- Shubham
- Om
- Kush

Synthetic publishing identities are outside the first-product boundary. If they are introduced later, the accountable human sponsor must remain visible.

## Core journey

1. Join the Intuitxn workspace through a personal invitation.
2. Add role, responsibility, timezone, and notification preference.
3. Read and acknowledge the pinned first post.
4. Publish a first update: what is in motion, what changed, and what is needed.
5. Reply to a teammate or acknowledge context without creating feed noise.
6. Resolve questions and asks with an owner and a clear outcome.

## Visible screens

- **Now:** a prioritized human-authored feed with All, Needs me, Decisions, and Questions views.
- **Share:** a focused composer for Update, Decision, Question, or Announcement.
- **Post:** context, explicit ask, owners, replies, acknowledgements, and resolution.
- **People:** role, responsibility, timezone, and onboarding state.
- **Changelog:** dated Added, Improved, and Fixed entries in plain language.

## First post

### Telepathy starts here

Telepathy is where we share the decisions, updates, questions, and context that other people need to know.

You communicate with your teammates. The system quietly organizes, routes, and remembers what matters underneath.

When you post, include:

- what changed;
- why it matters;
- what you need from the team.

Mention someone only when they need to act. Acknowledge important posts so the author knows the context landed.

**Your first post:** What are you working on, what changed recently, and what do you need from us?

## Data boundary

The durable model is Workspace, Person, Membership, Invite, Post, Audience, Owner, Reply, Acknowledgement, Resolution, NotificationPreference, and ChangelogEntry.

Derived summaries may reference human content but never become an author. Agent Manager session IDs and harness events are internal metadata.

## Internal-alpha acceptance

- The interface supports all four post types.
- Every post and reply has a visible human author.
- Acknowledgements and resolutions are explicit.
- Shubham, Om, and Kush have honest onboarding states.
- Refreshing a browser preserves the local workspace.
- Empty, failure, and mobile states remain usable.
- The interface exposes no agent transcript, prompt, or tool call.

## Production gates

Authentication, shared persistence, authorization, notifications, privacy/retention policy, edit history, and invite-to-resolution end-to-end coverage must land before this can be called a secure production workspace.
