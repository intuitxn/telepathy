#!/bin/sh
# Compatibility entrypoint for jj recovery. No Git worktree/index mutations.
set -eu
exec "${PYTHON:-python3}" - "$@" <<'PY'
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import uuid

os.umask(0o077)
mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
jj = os.environ.get('JJ', 'jj')

def run(*args, cwd=None, binary=False):
    p = subprocess.run([jj, '--no-pager', *args], cwd=cwd, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors='replace').strip() or 'jj command failed')
    return p.stdout if binary else p.stdout.decode()

def verify(directory):
    root = Path(directory).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError('snapshot must be a directory')
    print('snapshot:', root)
    manifest = root / 'MANIFEST'
    if manifest.exists():
        print(manifest.read_text())
    for name in ('files.tar.gz', 'untracked.tar.gz'):
        archive = root / name
        if archive.exists():
            with tarfile.open(archive, 'r:gz') as source:
                print(name + ':')
                for member in source.getmembers():
                    print(' ', repr(member.name))
    for name in ('tracked.patch', 'diff.patch'):
        path = root / name
        if path.exists():
            print(name + ': ' + str(path.stat().st_size) + ' bytes')

def main():
    if mode in ('help', '-h', '--help'):
        print('usage: durability-guard.sh [check | snapshot | verify SNAPSHOT_DIR]')
        print('jj @ is automatically snapshotted; snapshot finalizes @ with a private recovery tag and continues in a child change.')
        return 0
    if mode == 'verify':
        if len(sys.argv) != 3:
            raise ValueError('verify needs one snapshot directory')
        verify(sys.argv[2])
        return 0
    if mode not in ('check', 'snapshot'):
        raise ValueError('unknown mode: ' + mode)
    root = Path(run('root').strip()).resolve()
    status = run('status', cwd=root)  # capture current disk state into jj first
    summary = run('diff', '--summary', cwd=root)
    if mode == 'check':
        if summary.strip():
            print('durability-guard: @ contains candidate changes; preserve or finish this change.', file=sys.stderr)
            print(summary, end='', file=sys.stderr)
            return 1
        print('durability-guard: @ is empty relative to its parents; ignored private files are outside this check.')
        return 0
    snapshot_root = Path(os.environ.get('MUNDUS_SNAPSHOT_DIR', str(Path.home() / '.local/share/mundus-snapshots'))).expanduser().resolve()
    if snapshot_root == root or root in snapshot_root.parents:
        raise ValueError('snapshot directory must be outside the workspace')
    snapshot_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:12]
    snapshot = snapshot_root / (root.name + '-' + name)
    snapshot.mkdir(mode=0o700)
    revision = run('log', '-r', '@', '--no-graph', '-T', 'commit_id', cwd=root).strip()
    change = run('log', '-r', '@', '--no-graph', '-T', 'change_id', cwd=root).strip()
    tag = 'recovery/' + name
    run('tag', 'set', tag, '-r', revision, cwd=root)
    manifest = {'format': 'jj-recovery/v1', 'workspace': str(root), 'change_id': change,
                'commit_id': revision, 'tag': tag,
                'scope': 'Private filesystem backup, including ignored files; .git and .jj excluded.'}
    (snapshot / 'MANIFEST').write_text(json.dumps(manifest, indent=2) + '\n')
    (snapshot / 'status.txt').write_text(status)
    (snapshot / 'diff.patch').write_text(run('diff', '--git', '-r', revision, cwd=root))
    # Preserve ignored files too, without parsing CLI filenames or following links.
    # Repository metadata is retained by jj; the archive is private filesystem evidence.
    with tarfile.open(snapshot / 'files.tar.gz', 'w:gz', dereference=False) as archive:
        for directory, children, files in os.walk(root, followlinks=False):
            children[:] = [name for name in children if name not in ('.git', '.jj')]
            for name in children + files:
                if name in ('.git', '.jj'):
                    continue
                source = Path(directory) / name
                if source.is_file() or source.is_dir() or source.is_symlink():
                    archive.add(source, arcname=str(source.relative_to(root)), recursive=False)
    run('status', cwd=root)
    changed = run('diff', '--from', revision, '--to', '@', '--summary', cwd=root)
    if changed.strip():
        raise RuntimeError('Workspace changed during snapshot; archive is not verified. Initial revision remains at tag ' + tag)
    (snapshot / 'README.txt').write_text('Inspect MANIFEST and archive with durability-guard.sh verify.\n'
        'Recovery tag retains the exact original revision; @ continues as a new child change. Archive contains ignored private files too; do not publish it.\n'
        'Restore only into an explicitly owned workspace after reviewing the candidate; never overwrite another writer.\n'
        'Keep this local recovery tag private; never publish recovery tags or push all refs.\n')
    print(snapshot)
    print('durability-guard: recovery tag ' + tag + '; current change finalized, continuing in a child change', file=sys.stderr)
    return 0

try:
    raise SystemExit(main())
except (OSError, ValueError, RuntimeError, tarfile.TarError) as exc:
    print('durability-guard: ' + str(exc), file=sys.stderr)
    raise SystemExit(2)
PY
