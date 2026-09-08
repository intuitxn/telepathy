#!/usr/bin/env python3
"""Install/check the shared Telepathy service without printing invitation secrets."""
import argparse
import json
import hashlib
import shutil
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.intuitxn.telepathy-workspace'
STATE = Path.home() / '.local/share/telepathy-workspace'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
PUBLIC = 'https://telepathy.intuitxn.com'
PORT = 4110

def config():
    python = Path(os.environ.get('TELEPATHY_PYTHON', str(ROOT.parent / 'nudge/.venv/bin/python')))
    if not python.is_file():
        raise SystemExit('Set TELEPATHY_PYTHON to a Python 3.11+ interpreter with Nudge available.')
    return [str(python.resolve()), str(ROOT / 'runtime/workspace/server.py')]

def args(command):
    return [command, '--db', str(STATE / 'workspace.db'), '--invites', str(STATE / 'invites.json'), '--port', str(PORT), '--public-url', PUBLIC, '--static-dir', str(ROOT / 'site/dist')]

def health():
    request = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/health', headers={'Host':'telepathy.intuitxn.com'})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            print(json.dumps({'service': LABEL, 'url': PUBLIC, 'health': json.load(response)}))
    except Exception as error:
        raise SystemExit('Workspace health unavailable: ' + str(error))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install','status','restart'])
    command = parser.parse_args().command
    if command == 'status':
        health()
        return
    domain = f'gui/{os.getuid()}'
    if command == 'restart':
        subprocess.run(['launchctl','kickstart','-k',domain+'/'+LABEL],check=True)
        return
    if not (ROOT/'site/dist/index.html').is_file():
        raise SystemExit('Build the existing site before installing: npm --prefix site run build')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE, 0o700)
    subprocess.run(config()+args('init'),check=True)
    env = {
        'HOME':str(Path.home()),
        'PATH':str(Path.home()/'.local/bin')+':'+str(Path.home()/'.hermes/node/bin')+':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        'INTUITXN_NETWORK':os.environ.get('INTUITXN_NETWORK','https://intuitxn.communities.buzz.xyz'),
        'TELEPATHY_PROGRAM_PYTHON':config()[0],
    }
    # Launchd must not depend on Desktop's protected paths or mutable checkouts.
    digest = hashlib.sha256()
    sources = ['runtime/workspace', 'runtime/programs', 'programs', 'site/dist', 'artifacts/assets']
    for source in sources:
        for file in sorted((ROOT/source).rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts:
                digest.update(str(file.relative_to(ROOT)).encode()); digest.update(file.read_bytes())
    for file in sorted((ROOT.parent/'nudge/src').rglob('*.py')):
        digest.update(str(file.relative_to(ROOT.parent/'nudge')).encode()); digest.update(file.read_bytes())
    release = STATE/'releases'/digest.hexdigest()[:16]
    for source in sources:
        shutil.copytree(ROOT/source, release/source, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT.parent/'nudge/src', release/'nudge/src', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    env['NUDGE_ROOT'] = str(release/'nudge')
    env['TELEPATHY_PROGRAM_PYTHON'] = config()[0]
    command = ['/usr/bin/env','-i'] + [k+'='+v for k,v in env.items()] + [config()[0], str(release/'runtime/workspace/server.py')] + args('serve')
    command[-1] = str(release/'site/dist')
    (STATE/'current-release').write_text(str(release)+'\n')
    (STATE/'interpreter').write_text(config()[0]+'\n')
    launcher = Path.home()/'.local/bin/telepathy-program'
    if launcher.is_symlink(): launcher.unlink()
    launcher.write_bytes((ROOT/'scripts/telepathy-program').read_bytes())
    os.chmod(launcher,0o755)
    payload = {'Label':LABEL, 'ProgramArguments':command, 'WorkingDirectory':str(release), 'RunAtLoad':True, 'KeepAlive':True, 'ThrottleInterval':10, 'EnvironmentVariables':env, 'StandardOutPath':str(STATE/'service.log'), 'StandardErrorPath':str(STATE/'service.log')}
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    PLIST.write_bytes(plistlib.dumps(payload))
    os.chmod(PLIST,0o600)
    subprocess.run(['launchctl','bootout',domain+'/'+LABEL],capture_output=True)
    # bootout is asynchronous; bounded retries only for the known launchd race.
    import time
    for attempt in range(6):
        result=subprocess.run(['launchctl','bootstrap',domain,str(PLIST)],capture_output=True)
        if result.returncode==0:
            print(json.dumps({'installed':LABEL,'url':PUBLIC,'privateInvitations':str(STATE/'invites.json')}))
            return
        time.sleep(1)
    raise SystemExit('launchd bootstrap failed; inspect '+str(STATE/'service.log'))

if __name__=='__main__':
    main()
