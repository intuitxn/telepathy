# Telepathy prompt programs

This host wrapper compiles the existing Nudge `nudge.prompt/v1` source files in
`programs/` and executes one typed transaction with the real oc2 binary. It uses
`compile_program -> PromptBundle -> HarnessAdapter -> run_program -> ProgramResult`.
There is no new DSL, VM, scheduler or model-based compiler here.

```sh
runtime/programs/telepathy-program list
runtime/programs/telepathy-program compile artifact-design
printf '%s' '{"title":"Notes","body":"We will test shared pages.","sourceIds":[]}' | runtime/programs/telepathy-program run artifact-design --input -
```

The executable defaults to sibling `../nudge/.venv/bin/python3.12`; `NUDGE_ROOT`
overrides that checkout. `OC2_BINARY` overrides the installed fork binary path.
The explicit host model defaults to `opencode-go/deepseek-v4-flash`; override with
`--model` or `TELEPATHY_PROGRAM_MODEL`. Authentication stays in the existing work
profile; no credentials are copied into bundles, results or receipts.
`INTUITXN_NETWORK` defaults to `https://intuitxn.communities.buzz.xyz`. This records
the shared network identity and passes it to the process; it is not cross-node
scheduling or proof of relay synchronization.

`compile` returns the immutable bundle and digest, without model invocation.
`run` reads JSON from stdin (or `--input PATH`) and emits one JSON envelope:

```json
{"status":"succeeded","output":{"title":"...","body":"..."},"receipt":{"id":"...","bundleDigest":"sha256:...","adapter":"telepathy-oc2-cli/v1","model":"opencode-go/deepseek-v4-flash","network":"https://intuitxn.communities.buzz.xyz","usage":{},"scoreStatus":"not_evaluated"}}
```

Failures return a sanitized `failure` and exit nonzero. Receipts omit inputs and
raw model transcripts. The caller owns private receipt persistence. oc2 itself
may keep private session data in its local authenticated profile. Do not place
receipts, profile data or source conversations into a public artifact implicitly.

## Host and harness boundary

Registry roles are labels for the bounded programs, not claims about launched
agent personas. The oc2 primary agent is configured per invocation with tools
and permissions denied, project config disabled, and a temporary working
directory. Explicit model selection has no host fallback or retry. Input,
accepted output, event-stream bytes and a 90-second deadline are checked. A
process group is killed on timeout or failure, and excess observed steps fail.

The CLI uses ordered prompt framing rather than native system/user channels.
`structured-output` means JSON parsing followed by Nudge field/type validation;
it does not mean provider-native constrained decoding. The fork's internal
provider retries are not exposed by JSON step events. `usage.model_calls` is the
observed model-step count, not a verified billing-call count or hard provider
budget. This adapter does not claim complete canonical harness conformance.

The current Nudge implementation additionally supports pipelines/delegation and
has a smaller capability/result ABI than `docs/PROGRAM_DSL.md` describes. These
programs use only the documented leaf format; host receipts add adapter/model
identity and timestamps missing from the current implementation. No Nudge core
files are modified.

## Learning is a proposal, not automatic rule mutation

`lesson-proposal` takes explicit feedback, an observed outcome, parent digest and
complete source. It proposes a lesson and candidate source. `lesson-review`
returns advisory analysis. Neither is an evaluator, authenticated reviewer,
promotion operation or permission to publish. Candidate source is untrusted
output: the application must compile it, verify parent digest and allowed prompt
surfaces, preserve immutable lineage and require a real authenticated reviewer
for adoption. Model text claiming approval is not evidence. The shared backend
owns feedback and review persistence; these programs cannot modify their source.

Run focused contract tests:

```sh
../nudge/.venv/bin/python3.12 -m unittest discover -s runtime/programs -p 'test_*.py'
```

Fixture-adapter tests verify wiring and rejection only. See `LIVE_RUN.md` for the
separate actual model invocation. No external evaluator or score was run.

## Reviewed candidate activation

The host also exposes:

- `inspect NAME` → `{source,digest}` for the currently active source.
- `validate-candidate NAME --input -` accepts `{source,parentDigest}` and returns
  `{valid:true,parentDigest,candidateDigest}`. Only existing prompt-fence contents
  may differ; all frontmatter, role boundaries, source documentation, input and
  output contracts remain byte-identical. Unchanged candidates are refused.
- `promote-candidate NAME --input -` accepts
  `{source,parentDigest,candidateDigest}`. It revalidates under a file lock,
  requires both exact digests, retains immutable parent/candidate source files,
  and atomically changes the private active pointer. Stale reviews fail.

Private state defaults to `~/.local/share/telepathy/programs`; set
`TELEPATHY_PROGRAM_STATE_ROOT` for isolated tests or a service-specific store.
Repository baseline files remain untouched. Subsequent inspect/compile/run reads
and verifies the active digest. Local CLI filesystem access is operator
capability. An HTTP backend **must** authenticate its reviewer and authorize the
exact reviewed revision before calling promotion, and persist that identity in
its own review record. This CLI deliberately accepts no reviewer name or model
approval string as proof. Promotion here is an explicit operational adoption;
it does not assert the paired evaluator-based optimization promotion described
by Nudge's evaluation protocol.

The artifact-design host also rejects output containing any supplied nonempty
source ID in its title or body. These opaque IDs are private provenance, retained
by the workspace's source association rather than copied into public writing.
A contract-valid JSON response that contains such metadata becomes a failed run
with no accepted output. The prompt explicitly asks for the same separation.
This is an exact supplied-ID guard, not a general detector of arbitrary private
information; the human still reviews the selected text before publication.
