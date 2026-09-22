#!/usr/bin/env python3
"""Host integration for canonical Nudge leaf programs; never a DSL interpreter.

Single-run: ``nudge.transaction/v1.1`` only, compiled and run through the
stdlib-only ``v11`` module. ``nudge.prompt/v1`` sources are rejected with a
recompile directive — no legacy fallback, no external package.
"""
import argparse
import asyncio
import shutil
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
from types import SimpleNamespace
import uuid
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import v11

REGISTRY = {'artifact-design': 'artifact-designer', 'lesson-proposal': 'learning-proposer',
            'lesson-review': 'learning-reviewer'}
DEFAULT_MODEL = os.environ.get('TELEPATHY_PROGRAM_MODEL', 'opencode-go/deepseek-v4-flash')
LIMITATIONS = ['CLI prompt roles use ordered framing, not native role equivalence',
    'Observed steps are checked; provider retries and billing calls are not observable or hard capped',
    'Typed success is not an evaluation or human approval']

def _schema_of(source):
    """Frontmatter ``schema`` string, or None when the source has no parseable frontmatter."""
    if isinstance(source, (bytes, bytearray)):
        try:
            text = bytes(source).decode('utf-8-sig')
        except UnicodeDecodeError:
            return None
    elif isinstance(source, str):
        text = source
    else:
        return None
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    if not lines or lines[0] != '+++':
        return None
    try:
        close = lines.index('+++', 1)
    except ValueError:
        return None
    for line in lines[1:close]:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        match = re.fullmatch(r'schema\s*=\s*"([^"]*)"', stripped)
        if match:
            return match.group(1)
    return None

def _is_v11_source(source):
    return _schema_of(source) == v11.SCHEMA

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
        if not _is_v11_source(source):
            raise ValueError('legacy_source_recompile_as_v11')
        bundle = v11.compile_v11(source)
        if bundle.package_digest != digest or bundle.name != name:
            raise ValueError('active_source_integrity_failure')
        return source
    return (ROOT / 'programs' / (name + '.nudge.md')).read_text()

def compile_named(name):
    source = source_named(name)
    if not _is_v11_source(source):
        raise ValueError('legacy_source_recompile_as_v11')
    return v11.compile_v11(source, expected_name=name)

# Only contents of existing recognized prompt fences may change. Everything
# else including documentation, frontmatter, roles and order stays exact.
# v1.1 projection lives in v11.frozen_source_v11.

def _validate_candidate_v11(name, parent_source, data):
    # No silent cross-schema promotion: a v1.0 parent must be recompiled as
    # v1.1 first (new digest, clean lineage), never semantically compared.
    if not (_is_v11_source(parent_source) and _is_v11_source(data['source'])):
        raise ValueError('cross_schema_candidate: recompile parent as nudge.transaction/v1.1 first')
    parent = v11.compile_v11(parent_source)
    if data['parentDigest'] != parent.package_digest:
        raise ValueError('stale_parent_digest')
    source = data['source']
    if len(source) > 50000 or v11.frozen_source_v11(source) != v11.frozen_source_v11(parent_source):
        raise ValueError('frozen_source_changed')
    candidate = v11.compile_v11(source)
    if candidate.package_digest == parent.package_digest:
        raise ValueError('candidate_unchanged')
    if candidate.name != name:
        raise ValueError('candidate_contract_changed')
    return {'valid': True, 'parentDigest': parent.package_digest, 'candidateDigest': candidate.package_digest,
        'frozenDigest': candidate.frozen_digest}

def validate_candidate(name, data):
    if set(data) != {'source', 'parentDigest'} or not isinstance(data['source'], str):
        raise ValueError('invalid_candidate_input')
    parent_source = source_named(name)
    return _validate_candidate_v11(name, parent_source, data)

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
        if 'frozenDigest' in validation:
            receipt['frozenDigest'] = validation['frozenDigest']
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

async def _oc2_call(prompt, *, model, network, limits, timeout_s, max_event_bytes):
    """Run one prompt transaction through the oc2 CLI; return ``(text, steps)``.

    ``limits`` supplies ``max_input_chars`` / ``max_output_chars`` /
    ``max_turns`` / ``max_model_calls`` as attributes. Raises ValueError on
    any contract, IO, or runtime violation. Standard library only.
    """
    if len(prompt) > limits.max_input_chars:
        raise ValueError('input_limit_exceeded')
    binary = Path(os.environ.get('OC2_BINARY') or shutil.which('opencode') or '')
    if not binary.is_file():
        raise ValueError('oc2_binary_missing')
    state = Path.home() / '.opencode2-profiles/work'
    # Fresh config/cache/state avoid plugin, repository and session context.
    # Only the existing provider auth data directory is shared with oc2.
    with tempfile.TemporaryDirectory(prefix='telepathy-program-') as scratch:
        env = {k: v for k, v in os.environ.items() if k in ('HOME', 'PATH', 'TMPDIR', 'LANG', 'SSL_CERT_FILE')}
        env.update(INTUITXN_NETWORK=network, XDG_CONFIG_HOME=scratch + '/config',
            XDG_DATA_HOME=str(state / 'data'), XDG_STATE_HOME=scratch + '/state',
            XDG_CACHE_HOME=scratch + '/cache', OPENCODE_DISABLE_DEFAULT_PLUGINS='1',
            OPENCODE_DISABLE_PROJECT_CONFIG='1', OPENCODE_CONFIG_CONTENT=json.dumps({
            'share': 'disabled', 'permission': {'*': 'deny'},
            'agent': {'telepathy-program': {'mode': 'primary', 'steps': 1,
                'tools': {'*': False}, 'permission': {'*': 'deny'},
                'prompt': 'Perform one supplied prompt transaction. No tools. Return JSON only.'}}}))
        process = await asyncio.create_subprocess_exec(str(binary), 'run', '--format', 'json',
            '--agent', 'telepathy-program', '--model', model, '--dir', scratch,
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
                if total > max_event_bytes:
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
                    if steps > min(limits.max_turns, limits.max_model_calls):
                        raise ValueError('observed_step_limit_exceeded')
                if kind == 'tool_use':
                    raise ValueError('unexpected_tool_use')
                if kind == 'text':
                    text += event.get('part', {}).get('text', '')
                    if len(text) > limits.max_output_chars:
                        raise ValueError('output_limit_exceeded')
            if await process.wait() != 0 or steps != 1:
                raise ValueError('runtime_incomplete')
            return text, steps
        try:
            return await asyncio.wait_for(consume(), timeout=timeout_s)
        finally:
            if process.returncode is None:
                os.killpg(process.pid, signal.SIGKILL)
                await process.wait()

class Oc2Adapter:
    """Real CLI harness, host JSON validation, no host retries. See limitations."""
    def __init__(self, model, network):
        if not re.fullmatch(r'[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.:-]+', model):
            raise ValueError('invalid_model_binding')
        self.model, self.network = model, network

    def capabilities(self):
        return {'protocol': 'nudge.harness/v1', 'features': ('structured-output',)}

    async def run_v11(self, bundle, rendered):
        """v1.1 transaction: rendered fences through the oc2 CLI.

        Returns ``(output, usage)`` with plain stdlib types; the caller
        validates the output against the bundle. Model/protocol binding is
        host-owned (constructor args); v1.1 sources declare neither.
        """
        prompt = '<system>\n' + rendered['system'] + '\n</system>\n\n<user>\n' + rendered['user'] + '\n</user>'
        prompt += '\nReturn only a JSON object with exactly these field types: ' + json.dumps(dict(bundle.outputs))
        text, steps = await _oc2_call(prompt, model=self.model, network=self.network,
            limits=SimpleNamespace(**bundle.limits), timeout_s=bundle.limits['timeout_s'],
            max_event_bytes=bundle.limits['max_event_bytes'])
        parsed = json.loads(text.strip())
        if not isinstance(parsed, dict):
            raise ValueError('output_not_object')
        return parsed, {'turns': steps, 'model_calls': steps,
            'input_chars': len(prompt), 'output_chars': len(text)}

def validate_public_artifact(inputs, output):
    # Provenance belongs in the private application record, not model prose.
    public_text = output['title'] + '\n' + output['body']
    for source_id in inputs.get('sourceIds', []):
        if isinstance(source_id, str) and source_id and source_id in public_text:
            raise ValueError('private_source_reference_in_public_output')

def _receipt(name, bundle_digest, model):
    return {'id': str(uuid.uuid4()), 'bundleDigest': bundle_digest,
        'program': name, 'role': REGISTRY[name], 'adapter': 'telepathy-oc2-cli/v1',
        'adapterSourceDigest': 'sha256:' + hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'model': model, 'network': network_url(), 'startedAt': now(),
        'scoreStatus': 'not_evaluated', 'limitations': LIMITATIONS}

async def _invoke_v11(name, bundle, inputs, model):
    receipt = _receipt(name, bundle.package_digest, model)
    try:
        data = v11.validate_inputs(bundle, inputs)
        rendered = v11.render_prompt(bundle, data)
        output, usage = await Oc2Adapter(model, receipt['network']).run_v11(bundle, rendered)
        v11.validate_outputs(bundle, output)
        if name == 'artifact-design':
            validate_public_artifact(data, output)
        receipt.update(finishedAt=now(), usage=usage)
        return {'status': 'succeeded', 'output': dict(output), 'receipt': receipt}
    except Exception as error:
        receipt['finishedAt'] = now()
        # Never forward provider stderr, raw output, inputs, auth paths or exceptions.
        return {'status': 'failed', 'failure': {'code': type(error).__name__,
            'message': 'Program execution or contract validation failed; no output accepted.'}, 'receipt': receipt}

async def invoke(name, inputs, model=DEFAULT_MODEL):
    source = source_named(name)
    if not _is_v11_source(source):
        raise ValueError('legacy_source_recompile_as_v11')
    return await _invoke_v11(name, v11.compile_v11(source, expected_name=name), inputs, model)

def _bundle_dict_v11(bundle):
    result = {'name': bundle.name, 'version': bundle.version, 'description': bundle.description,
        'inputs': dict(bundle.inputs), 'outputs': dict(bundle.outputs), 'limits': dict(bundle.limits),
        'package_digest': bundle.package_digest, 'frozen_digest': bundle.frozen_digest}
    if bundle.law is not None:
        result['lawDigest'] = 'sha256:' + hashlib.sha256(bundle.law.encode('utf-8')).hexdigest()
    if bundle.proof is not None:
        result['proofDigest'] = 'sha256:' + hashlib.sha256(bundle.proof.encode('utf-8')).hexdigest()
    return result

def _bend_binary():
    override = os.environ.get('BEND_BINARY')
    if override:
        return Path(override)
    return Path.home() / '.bend/bin/bend'

def gate_blocks(law, proof, timeout_s=120):
    """Run the Bend gate over extracted program-law blocks (stdlib only).

    Returns a dict with ``status``: ``proven`` (``All terms check.``),
    ``open`` (no law, or TODOs remain), ``failed`` (checker error), or
    ``needs-toolchain`` (no Bend binary). Proofs use the ``Laws.``
    qualifier; the gate synthesizes ``PROOF.bend`` accordingly.
    """
    if law is None:
        return {'status': 'open', 'reason': 'no_law'}
    binary = _bend_binary()
    if not binary.is_file():
        return {'status': 'needs-toolchain', 'reason': f'no Bend binary at {binary}'}
    import subprocess
    with tempfile.TemporaryDirectory(prefix='bend-gate-') as scratch:
        Path(scratch, 'LAWS.bend').write_text(law)
        target = 'LAWS.bend'
        if proof is not None:
            Path(scratch, 'PROOF.bend').write_text('import ./LAWS.bend as Laws\n\n' + proof)
            target = 'PROOF.bend'
        env = dict(os.environ, BEND_NO_TELEMETRY='1')
        try:
            completed = subprocess.run([str(binary), target], cwd=scratch, env=env,
                capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            return {'status': 'failed', 'reason': 'gate_timeout'}
        output = (completed.stdout + completed.stderr).strip()
        if completed.returncode == 0 and 'All terms check.' in output:
            return {'status': 'proven', 'output': output[-2000:]}
        if 'TODO' in output:
            return {'status': 'open', 'reason': 'open_laws', 'output': output[-2000:]}
        return {'status': 'failed', 'reason': 'checker_error', 'output': output[-2000:]}

def bend_gate(name):
    """Gate a program's inline laws: digests plus the Bend verdict."""
    bundle = compile_named(name)
    blocks = v11.extract_bend(source_named(name))
    result = {'program': name, 'packageDigest': bundle.package_digest,
        'frozenDigest': bundle.frozen_digest}
    result.update(_bundle_dict_v11(bundle))
    result['gate'] = gate_blocks(blocks['law'], blocks['proof'])
    result['status'] = result['gate']['status']
    return result

RUNNER_TEMPLATE = '''#!/usr/bin/env python3
"""Generated runner for '{name}' — pinned to {pin}.

Regenerate after promotion: ``telepathy-program gen-runner {name}``.
Refuses to run when the compiled source digest has drifted.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, "{clidir}")
import cli

PIN = "{pin}"

def main() -> int:
    bundle = cli.compile_named("{name}")
    if bundle.package_digest != PIN:
        print(json.dumps({{"status": "failed", "failure": {{"code": "digest_drift",
            "message": "Runner pinned to {pin}; source drifted. Regenerate after promotion."}}}}))
        return 1
    data = json.load(sys.stdin)
    print(json.dumps(asyncio.run(cli.invoke("{name}", data)), ensure_ascii=False))
    return 0

if __name__ == "__main__":
    sys.exit(main())
'''

def gen_runner(name, out_dir=None):
    """Write a digest-pinned per-program runner; return its path."""
    if name not in REGISTRY:
        raise ValueError('unknown_program')
    bundle = compile_named(name)
    target = Path(out_dir) if out_dir else Path(__file__).resolve().parent / 'runners'
    target.mkdir(parents=True, exist_ok=True)
    path = target / (name + '.py')
    path.write_text(RUNNER_TEMPLATE.format(name=name, pin=bundle.package_digest,
        clidir=Path(__file__).resolve().parent))
    os.chmod(path, 0o755)
    return path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['list', 'inspect', 'compile', 'run', 'validate-candidate', 'promote-candidate',
        'bend-gate', 'gen-runner'])
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
        bundle = compile_named(args.name)
        result = {'source': source_named(args.name), 'digest': bundle.package_digest,
            'frozenDigest': bundle.frozen_digest}
    elif args.command == 'compile':
        bundle = compile_named(args.name)
        result = {'status': 'compiled', 'bundleDigest': bundle.package_digest,
            'frozenDigest': bundle.frozen_digest, 'bundle': _bundle_dict_v11(bundle),
            'scoreStatus': 'not_evaluated'}
    else:
        if args.command in ('validate-candidate', 'promote-candidate', 'run'):
            text = sys.stdin.read(100001) if args.input == '-' else Path(args.input).read_text()
            if len(text) > 100000:
                raise ValueError('input_too_large')
            data = json.loads(text)
        if args.command == 'validate-candidate':
            result = validate_candidate(args.name, data)
        elif args.command == 'promote-candidate':
            result = promote_candidate(args.name, data)
        elif args.command == 'bend-gate':
            result = bend_gate(args.name)
        elif args.command == 'gen-runner':
            result = {'status': 'generated', 'runner': str(gen_runner(args.name))}
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
