# Live run evidence, 2026-09-08

One actual invocation of the oc2 fork completed successfully through this host
adapter, using existing authenticated `opencode-go/deepseek-v4-flash`.

- Program: `artifact-design`
- Bundle: `sha256:5f7e66730287dd608466f52f8312a1a35a4d66c0547e6948623311f1eb0c6ef4`
- Receipt: `f1118e30-d99e-41c1-a2dc-356f3ba701b1`
- Start: `2026-09-08T11:02:09.210036+00:00`
- Finish: `2026-09-08T11:02:22.529704+00:00`
- Observed steps: 1; framed input: 639 characters; returned output: 107 characters
- Network binding: `https://intuitxn.communities.buzz.xyz`

Benign fixture input:

```json
{"title":"Team notes","body":"We met on Tuesday. We decided to test shared pages next.","sourceIds":["smoke-fixture"]}
```

Accepted output:

```json
{"title":"Team notes","body":"We met on Tuesday. We decided to test shared pages next. [smoke-fixture]"}
```

This establishes that one real invocation returned contract-valid JSON. It does
not establish model quality, source fidelity in general, provider-level hard
call budgets, paired improvement, automatic learning, cross-node execution or
human approval. `scoreStatus` is `not_evaluated`.

A second actual model invocation exercised `lesson-proposal` with synthetic
feedback asking for shorter paragraphs and an explicit outcome string stating
that no evaluated outcome exists. It produced a complete candidate source that
passed the frozen-source and parent-digest validator. It was **not activated**.

- Receipt: `64c50da3-26ca-4cc0-a70f-3898eb56a128`
- Program bundle: `sha256:235a62311394084480204f57973ccfd79208ad1fab3af5e4dc1022bae60c6720`
- Start: `2026-09-08T11:06:37.363024+00:00`
- Finish: `2026-09-08T11:07:11.866746+00:00`
- Model: `opencode-go/deepseek-v4-flash`
- Observed steps: 1; framed input: 2086 characters; output: 1821 characters
- Candidate parent: `sha256:5f7e66730287dd608466f52f8312a1a35a4d66c0547e6948623311f1eb0c6ef4`
- Candidate: `sha256:4938a5d1e40b050ae955ae2d8e1c43e016ff3723a40254399cdca3ef0a36f237`

This validates one real generated candidate's source contract. No learning score,
quality improvement or production promotion is asserted. Separate temporary-state
unit tests exercised exact-digest promotion, immutable parent retention and
stale-review rejection without changing the real active program.

## Private source-reference correction

The first artifact result above included the fixture's opaque source ID. That
historical invocation passed the old type-only contract, but its citation marker
is not acceptable public artifact content. The corrected artifact program now
explicitly excludes opaque source IDs/private references/runtime metadata and
the host rejects output containing any supplied nonempty source ID.

Corrected baseline digest:
`sha256:572d0c80230d8118dc96b4af47489176fea7ac19585c572e72bee82369c3e1c0`.

Two additional live invocations were made, each without an automatic retry:

1. Receipt `a7caaef8-85c2-4a92-97b4-a894b607fe81`,
   `2026-09-08T11:18:42.397439+00:00`–`11:18:55.724945+00:00`: failed with
   `JSONDecodeError`. No output was accepted or exposed. This failure remains
   part of the observed record.
2. Receipt `139369e6-20df-4cda-8ad2-ab3e9ac1809d`,
   `2026-09-08T11:19:19.662770+00:00`–`11:19:25.109895+00:00`: succeeded with
   one observed step, 883 framed input characters and 85 output characters.

The second input was:

```json
{"title":"Shared pages test","body":"The team will test shared pages on Tuesday.","sourceIds":["smoke-fixture","579b903e92ca00e7"]}
```

Its accepted output contained neither supplied source ID:

```json
{"body":"The team will test shared pages on Tuesday.","title":"Shared pages test"}
```

The run used `opencode-go/deepseek-v4-flash` and adapter source digest
`sha256:435180b688a00c4c5e01b2d4c75132ab0f08abe52b3e8b827b77fddea6e91ac5`.
Twelve focused unit tests passed after the correction, including rejection of
source IDs in either title or body and absence of leaked output in failure
receipts. No production publication or activation was performed by this test.
