#!/usr/bin/env python3
"""Host integration for canonical Nudge leaf programs; never a DSL interpreter."""
import argparse
import asyncio
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import sys
import tempfile
import uuid
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
NUDGE = Path(os.environ.get('NUDGE_ROOT', str(ROOT.parent / 'nudge')))
sys.path.insert(0, str(NUDGE / 'src'))
from nudge.program_dsl import (compile_program, run_program, AdapterCapabilities,
    AdapterRunResult, Usage, bundle_to_dict)

REGISTRY = {'artifact-design': 'artifact-designer', 'lesson-proposal': 'learning-proposer',
            'lesson-review': 'learning-reviewer'}
DEFAULT_MODEL = 'opencode-go/deepseek-v4-flash'
LIMITATIONS = ['CLI prompt roles use ordered framing, not native role equivalence',
    'Observed steps are checked; provider retries and billing calls are not observable or hard capped',
    'Typed success is not an evaluation or human approval']

def now():
    return datetime.now(timezone.utc).isoformat()

def state_root():
    return Path(os.environ.get('TELEPATHY_PROGRAM_STATE_ROOT', str(Path.home() / '.local/share/telepathy/programs')))

def source_named(name):
    if name not in REGISTRY:
        raise ValueError('unknown_program')
    pointer = state_root() / (name + '.active.json')
    if pointer.exists():
        active = json.loads(pointer.read_text())
        digest = active['digest']
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise ValueError('invalid_active_digest')
        source = (state_root() / 'sources' / (digest[7:] + '.nudge.md')).read_text()
        bundle = compile_program(source)
        if bundle.package_digest != digest or bundle.name != name:
            raise ValueError('active_source_integrity_failure')
        return source
    return (ROOT / 'programs' / (name + '.nudge.md')).read_text()

def compile_named(name):
    bundle = compile_program(source_named(name))
    if bundle.steps or bundle.delegation:
        raise ValueError('only_leaf_programs_supported')
    return bundle

# Only contents of existing recognized prompt fences may change. Everything
# else including documentation, frontmatter, roles and order stays exact.
PROMPT_FENCE = re.compile(r'(^```nudge-prompt (?:system|user|assistant)[ \t]*\n)(.*?)(^```[ \t]*$)', re.M | re.S)
def frozen_source(source):
    return PROMPT_FENCE.sub(lambda match: match[1] + '<PROMPT-CONTENT>\n' + match[3], source)

def validate_candidate(name, data):
    if set(data) != {'source', 'parentDigest'} or not isinstance(data['source'], str):
        raise ValueError('invalid_candidate_input')
    parent_source = source_named(name)
    parent = compile_program(parent_source)
    if data['parentDigest'] != parent.package_digest:
        raise ValueError('stale_parent_digest')
    source = data['source']
    if len(source) > 50000 or frozen_source(source) != frozen_source(parent_source):
        raise ValueError('frozen_source_changed')
    candidate = compile_program(source)
    if candidate.package_digest == parent.package_digest:
        raise ValueError('candidate_unchanged')
    if candidate.steps or candidate.delegation or candidate.name != name:
        raise ValueError('candidate_contract_changed')
    return {'valid': True, 'parentDigest': parent.package_digest, 'candidateDigest': candidate.package_digest}

def promote_candidate(name, data):
    # Caller authority is local filesystem access. A remote application MUST
    # authenticate its reviewer before calling; strings cannot prove identity.
    if set(data) != {'source', 'parentDigest', 'candidateDigest'}:
        raise ValueError('invalid_promotion_input')
    root = state_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / '.promotion.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validation = validate_candidate(name, {'source': data['source'], 'parentDigest': data['parentDigest']})
        if data['candidateDigest'] != validation['candidateDigest']:
            raise ValueError('candidate_digest_mismatch')
        sources = root / 'sources'
        sources.mkdir(exist_ok=True, mode=0o700)
        # Retain both immutable versions before moving the active pointer.
        for digest, source in [(data['parentDigest'], source_named(name)), (data['candidateDigest'], data['source'])]:
            target = sources / (digest[7:] + '.nudge.md')
            try:
                with target.open('x') as stream:
                    os.chmod(target, 0o600)
                    stream.write(source)
            except FileExistsError:
                if target.read_text() != source:
                    raise ValueError('immutable_source_collision')
        receipt = {'status': 'promoted', 'program': name, 'digest': data['candidateDigest'],
            'parentDigest': data['parentDigest'], 'promotedAt': now(), 'scoreStatus': 'not_evaluated'}
        with tempfile.NamedTemporaryFile(mode='w', dir=root, delete=False) as stream:
            json.dump(receipt, stream)
            stream.flush()
            os.fsync(stream.fileno())
            pending = stream.name
        os.replace(pending, root / (name + '.active.json'))
        return receipt

def network_url():
    value = os.environ.get('INTUITXN_NETWORK', 'https://intuitxn.communities.buzz.xyz')
    url = urlparse(value)
    if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('invalid_network')
    return value.rstrip('/')

class Oc2Adapter:
    """Real CLI harness, host JSON validation, no host retries. See limitations."""
    def __init__(self, model, network):
        if not re.fullmatch(r'[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.:-]+', model):
            raise ValueError('invalid_model_binding')
        self.model, self.network = model, network

    def capabilities(self):
        return AdapterCapabilities(protocol='nudge.harness/v1', features=('structured-output',))

    async def run(self, request):
        if request.bindings.get(request.model) != self.model:
            raise ValueError('model_binding_mismatch')
        prompt = '\n\n'.join(f'<{m.role}>\n{m.content}\n</{m.role}>' for m in request.messages)
        prompt += '\nReturn only a JSON object with exactly these field types: ' + json.dumps(dict(request.output_schema))
        if len(prompt) > request.limits.max_input_chars:
            raise ValueError('input_limit_exceeded')
        binary = Path(os.environ.get('OC2_BINARY', str(Path.home() / 'opencode2/packages/opencode/dist/opencode-darwin-arm64/bin/opencode')))
        if not binary.is_file():
            raise ValueError('oc2_binary_missing')
        state = Path.home() / '.opencode2-profiles/work'
        # Fresh config/cache/state avoid plugin, repository and session context.
        # Only the existing provider auth data directory is shared with oc2.
        with tempfile.TemporaryDirectory(prefix='telepathy-program-') as scratch:
            env = {k: v for k, v in os.environ.items() if k in ('HOME', 'PATH', 'TMPDIR', 'LANG', 'SSL_CERT_FILE')}
            env.update(INTUITXN_NETWORK=self.network, XDG_CONFIG_HOME=scratch + '/config',
                XDG_DATA_HOME=str(state / 'data'), XDG_STATE_HOME=scratch + '/state',
                XDG_CACHE_HOME=scratch + '/cache', OPENCODE_DISABLE_DEFAULT_PLUGINS='1',
                OPENCODE_DISABLE_PROJECT_CONFIG='1', OPENCODE_CONFIG_CONTENT=json.dumps({
                'share': 'disabled', 'permission': {'*': 'deny'},
                'agent': {'telepathy-program': {'mode': 'primary', 'steps': 1,
                    'tools': {'*': False}, 'permission': {'*': 'deny'},
                    'prompt': 'Perform one supplied prompt transaction. No tools. Return JSON only.'}}}))
            process = await asyncio.create_subprocess_exec(str(binary), 'run', '--format', 'json',
                '--agent', 'telepathy-program', '--model', self.model, '--dir', scratch,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, env=env, cwd=scratch, start_new_session=True)
            async def consume():
                process.stdin.write(prompt.encode())
                await process.stdin.drain()
                process.stdin.close()
                text, steps, total = '', 0, 0
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    total += len(line)
                    if total > 262144:
                        raise ValueError('event_stream_limit_exceeded')
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    kind = event.get('type')
                    if kind == 'error':
                        raise ValueError('provider_or_runtime_failed')
                    if kind == 'step_start':
                        steps += 1
                        if steps > min(request.limits.max_turns, request.limits.max_model_calls):
                            raise ValueError('observed_step_limit_exceeded')
                    if kind == 'tool_use':
                        raise ValueError('unexpected_tool_use')
                    if kind == 'text':
                        text += event.get('part', {}).get('text', '')
                        if len(text) > request.limits.max_output_chars:
                            raise ValueError('output_limit_exceeded')
                if await process.wait() != 0 or steps != 1:
                    raise ValueError('runtime_incomplete')
                parsed = json.loads(text.strip())
                if not isinstance(parsed, dict):
                    raise ValueError('output_not_object')
                return AdapterRunResult(output=parsed, usage=Usage(turns=steps, model_calls=steps,
                    input_chars=len(prompt), output_chars=len(text)))
            try:
                return await asyncio.wait_for(consume(), timeout=90)
            finally:
                if process.returncode is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()

def validate_public_artifact(inputs, output):
    # Provenance belongs in the private application record, not model prose.
    public_text = output['title'] + '\n' + output['body']
    for source_id in inputs.get('sourceIds', []):
        if isinstance(source_id, str) and source_id and source_id in public_text:
            raise ValueError('private_source_reference_in_public_output')

async def invoke(name, inputs, model=DEFAULT_MODEL):
    bundle = compile_named(name)
    receipt = {'id': str(uuid.uuid4()), 'bundleDigest': bundle.package_digest,
        'program': name, 'role': REGISTRY[name], 'adapter': 'telepathy-oc2-cli/v1',
        'adapterSourceDigest': 'sha256:' + hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'model': model, 'network': network_url(), 'startedAt': now(),
        'scoreStatus': 'not_evaluated', 'limitations': LIMITATIONS}
    try:
        result = await run_program(bundle, inputs, Oc2Adapter(model, receipt['network']), bindings={bundle.model: model})
        if name == 'artifact-design':
            validate_public_artifact(inputs, result.output)
        receipt.update(finishedAt=now(), usage=asdict(result.usage))
        return {'status': 'succeeded', 'output': dict(result.output), 'receipt': receipt}
    except Exception as error:
        receipt['finishedAt'] = now()
        # Never forward provider stderr, raw output, inputs, auth paths or exceptions.
        return {'status': 'failed', 'failure': {'code': type(error).__name__,
            'message': 'Program execution or contract validation failed; no output accepted.'}, 'receipt': receipt}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['list', 'inspect', 'compile', 'run', 'validate-candidate', 'promote-candidate'])
    parser.add_argument('name', nargs='?', choices=list(REGISTRY))
    parser.add_argument('--input', default='-')
    parser.add_argument('--model', default=os.environ.get('TELEPATHY_PROGRAM_MODEL', DEFAULT_MODEL))
    args = parser.parse_args()
    if args.command == 'list':
        result = {'programs': [{'name': n, 'role': r, 'inputs': dict(compile_named(n).inputs),
            'outputs': dict(compile_named(n).outputs)} for n, r in REGISTRY.items()]}
    elif not args.name:
        parser.error('program name required')
    elif args.command == 'inspect':
        result = {'source': source_named(args.name), 'digest': compile_named(args.name).package_digest}
    elif args.command == 'compile':
        bundle = compile_named(args.name)
        result = {'status': 'compiled', 'bundleDigest': bundle.package_digest,
            'bundle': bundle_to_dict(bundle), 'scoreStatus': 'not_evaluated'}
    else:
        text = sys.stdin.read(100001) if args.input == '-' else Path(args.input).read_text()
        if len(text) > 100000:
            raise ValueError('input_too_large')
        data = json.loads(text)
        if args.command == 'validate-candidate':
            result = validate_candidate(args.name, data)
        elif args.command == 'promote-candidate':
            result = promote_candidate(args.name, data)
        else:
            result = asyncio.run(invoke(args.name, data, args.model))
    print(json.dumps(result, ensure_ascii=False))
    return 1 if result.get('status') == 'failed' else 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'failed', 'failure': {'code': type(error).__name__, 'message': 'Invalid program request.'}}))
        sys.exit(1)
