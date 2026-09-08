#!/usr/bin/env python3
"""Telepathy shared workspace: private discussion, explicit public revisions."""
import argparse, hashlib, html, json, os, re, secrets, sqlite3, time, subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[2]
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def content_digest(title,body): return digest(json.dumps([title,body],ensure_ascii=False,separators=(',',':')))
def now(): return int(time.time())
def iso(value): return datetime.fromtimestamp(value,timezone.utc).isoformat() if value else None
class Failure(Exception):
    def __init__(self, status, message): self.status, self.message = status, message

def connect(path):
    db=sqlite3.connect(path, timeout=15); db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON'); return db

def initialize(path, invites):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with connect(path) as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS invites(token_hash TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,author_id TEXT NOT NULL REFERENCES people(id),type TEXT,title TEXT,body TEXT,created INTEGER,resolved INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY,post_id TEXT REFERENCES posts(id),author_id TEXT REFERENCES people(id),body TEXT,created INTEGER);
        CREATE TABLE IF NOT EXISTS acknowledgements(post_id TEXT REFERENCES posts(id),person_id TEXT REFERENCES people(id),PRIMARY KEY(post_id,person_id));
        CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES people(id),title TEXT,body TEXT,sources TEXT,revision INTEGER,slug TEXT UNIQUE,published_revision INTEGER,public_title TEXT,public_body TEXT,published_by TEXT,published_at INTEGER);
        CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES people(id),title TEXT,body TEXT,sources TEXT,revision INTEGER,status TEXT,accepted_by TEXT,accepted_at INTEGER);
        CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,person_id TEXT,action TEXT,object_id TEXT,revision INTEGER,digest TEXT,created INTEGER);
        ''')
        columns={r[1] for r in db.execute('PRAGMA table_info(posts)')}
        for name,kind in [('summary','TEXT'),('resolved_at','INTEGER'),('resolved_by','TEXT')]:
            if name not in columns: db.execute('ALTER TABLE posts ADD COLUMN '+name+' '+kind)
        lesson_columns={r[1] for r in db.execute('PRAGMA table_info(lessons)')}
        for name in ['program','parent_digest','candidate_digest','candidate_source']:
            if name not in lesson_columns: db.execute('ALTER TABLE lessons ADD COLUMN '+name+' TEXT')
        fresh=db.execute('SELECT count(*) FROM people').fetchone()[0]==0
        if fresh:
            tokens={}
            for pid,name in [('shubham','Shubham'),('om','Om'),('kush','Kush')]:
                db.execute('INSERT INTO people VALUES (?,?)',(pid,name)); token=secrets.token_urlsafe(32)
                db.execute('INSERT INTO invites VALUES (?,?,?)',(digest(token),pid,now()+7*86400)); tokens[name]=token
            target=Path(invites); target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f: json.dump(tokens,f,indent=2)
    os.chmod(path,0o600)

def text_field(data,key,limit,default=None):
    value=data.get(key,default)
    if not isinstance(value,str) or not value.strip() or len(value)>limit: raise Failure(400,'Invalid '+key)
    return value.strip()
def artifact(row,base):
    r=dict(row)
    return {'id':r['id'],'ownerId':r['owner_id'],'title':r['title'],'body':r['body'],'sourceIds':json.loads(r['sources']),'revision':r['revision'],'digest':content_digest(r['title'],r['body']),'slug':r['slug'],'publishedRevision':r['published_revision'],'publicUrl':base+'/p/'+r['slug'] if r['published_revision'] else None}
def lesson(row):
    r=dict(row); return {'id':r['id'],'ownerId':r['owner_id'],'title':r['title'],'body':r['body'],'sourceIds':json.loads(r['sources']),'revision':r['revision'],'status':r['status'],'acceptedBy':r['accepted_by'],'program':r['program'],'parentDigest':r['parent_digest'],'candidateDigest':r['candidate_digest'],'candidateSource':r['candidate_source']}

def render_markdown(value):
    # Escape first. Deliberately small Markdown subset; no raw HTML or embedded media.
    lines=[]; paragraph=[]
    def inline(text):
        text=html.escape(text)
        text=re.sub(r"\*\*([^*]+)\*\*",r"<strong>\1</strong>",text)
        text=re.sub(r"`([^`]+)`",r"<code>\1</code>",text)
        text=re.sub(r'\[([^\]]+)\]\((https?://[^\s()]+)\)',r'<a href="\2" rel="noopener noreferrer">\1</a>',text)
        return text
    def flush():
        if paragraph: lines.append('<p>'+inline(' '.join(paragraph))+'</p>'); paragraph.clear()
    for line in value.splitlines():
        header=re.match(r'^(#{1,4}) (.+)$',line)
        if header:
            flush(); level=len(header[1])+1; lines.append(f'<h{level}>'+inline(header[2])+f'</h{level}>')
        elif not line.strip(): flush()
        elif line.startswith(('- ','* ')):
            flush(); lines.append('<p>• '+inline(line[2:])+'</p>')
        else: paragraph.append(line)
    flush(); return ''.join(lines)

def make_handler(db_path, public_url, static_dir):
    base=public_url.rstrip('/'); origin=urlsplit(base); secure=origin.scheme=='https'
    class Handler(BaseHTTPRequestHandler):
        server_version='Telepathy'
        def log_message(self,*args): pass # URLs can contain invitation fragments; never log credentials.
        def send(self,status,value,kind='application/json',headers=None):
            body=json.dumps(value).encode() if kind=='application/json' else value.encode() if isinstance(value,str) else value
            self.send_response(status); self.send_header('Content-Type',kind); self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Referrer-Policy','no-referrer')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
            for k,v in (headers or {}).items(): self.send_header(k,v)
            self.end_headers(); self.wfile.write(body)
        def person(self,db):
            cookie=SimpleCookie()
            try: cookie.load(self.headers.get('Cookie',''))
            except Exception: return None
            token=cookie.get('telepathy_session')
            if not token: return None
            row=db.execute('SELECT people.* FROM sessions JOIN people ON people.id=sessions.person_id WHERE token_hash=? AND expires>?',(digest(token.value),now())).fetchone()
            return dict(row,canInvite=row['id']=='shubham') if row else None
        def cookie(self,token,age): return 'telepathy_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+str(age)+('; Secure' if secure else '')
        def checked(self):
            if self.headers.get('Host')!=origin.netloc: raise Failure(403,'Host not allowed')
            if self.command!='GET':
                if self.headers.get('Origin')!=base: raise Failure(403,'Origin not allowed')
                if self.headers.get('Content-Type','').split(';')[0]!='application/json': raise Failure(415,'JSON required')
                length=int(self.headers.get('Content-Length','0'))
                if length<0: raise Failure(400,'Invalid request length')
                if length>100000: raise Failure(413,'Request too large')
                try: data=json.loads(self.rfile.read(length))
                except Exception: raise Failure(400,'Invalid JSON')
                if not isinstance(data,dict): raise Failure(400,'Expected object')
                return data
            return {}
        def do_GET(self): self.handle_request()
        def do_POST(self): self.handle_request()
        def do_PATCH(self): self.handle_request()
        def handle_request(self):
            try:
                data=self.checked(); path=urlsplit(self.path).path
                with connect(db_path) as db: self.route(db,path,data)
            except Failure as e: self.send(e.status,{'error':e.message})
            except sqlite3.IntegrityError: self.send(409,{'error':'Conflicting update or URL already in use'})
            except Exception: self.send(500,{'error':'Internal server error'})
        def receipt(self,db,p,action,oid,revision=None,sha=None): db.execute('INSERT INTO receipts VALUES (?,?,?,?,?,?,?)',(secrets.token_hex(12),p['id'],action,oid,revision,sha,now()))
        def sources(self,db,data):
            ids=data.get('sourceIds',[])
            if not isinstance(ids,list) or not ids or len(ids)>30 or any(not isinstance(i,str) for i in ids): raise Failure(400,'Select 1 to 30 source messages')
            output=[]
            for ident in dict.fromkeys(ids):
                row=db.execute('SELECT title,body FROM posts WHERE id=?',(ident,)).fetchone()
                if not row: row=db.execute("SELECT '' AS title,body FROM replies WHERE id=?",(ident,)).fetchone()
                if not row: raise Failure(400,'Unknown source message')
                output.append((ident, row['title'],row['body']))
            return output
        def program_call(self,command,name,inputs=None):
            interpreter=os.environ.get('TELEPATHY_PROGRAM_PYTHON',str(ROOT.parent/'nudge/.venv/bin/python3.12'))
            try:
                run=subprocess.run([interpreter,str(ROOT/'runtime/programs/cli.py'),command,name,'--input','-'],input=json.dumps(inputs or {}),text=True,capture_output=True,timeout=100,cwd=ROOT)
                result=json.loads(run.stdout)
                if run.returncode or result.get('status')=='failed': raise ValueError()
                return result
            except (OSError,ValueError,KeyError,subprocess.TimeoutExpired): raise Failure(502,'Program operation failed validation or is unavailable; no proposal accepted')
        def route(self,db,path,data):
            method=self.command; p=self.person(db)
            if path=='/api/config' and method=='GET': return self.send(200,{'mode':'shared'})
            if path=='/api/health' and method=='GET': return self.send(200,{'ok':True,'service':'telepathy-workspace'})
            if path=='/api/me' and method=='GET': return self.send(200,{'person':p})
            if path=='/api/login' and method=='POST':
                token=text_field(data,'token',200); key=digest(token)
                # Serialized consumption ensures a one-use invite cannot race into multiple sessions.
                db.execute('BEGIN IMMEDIATE')
                row=db.execute('SELECT * FROM invites WHERE token_hash=? AND expires>?',(key,now())).fetchone()
                if not row: raise Failure(401,'Invitation invalid or expired')
                db.execute('DELETE FROM invites WHERE token_hash=?',(key,)); session=secrets.token_urlsafe(32)
                db.execute('INSERT INTO sessions VALUES (?,?,?)',(digest(session),row['person_id'],now()+30*86400))
                person=dict(db.execute('SELECT * FROM people WHERE id=?',(row['person_id'],)).fetchone()); person['canInvite']=person['id']=='shubham'; db.commit()
                return self.send(200,{'person':person},headers={'Set-Cookie':self.cookie(session,30*86400)})
            if path=='/api/logout' and method=='POST':
                if p:
                    cookie=SimpleCookie(self.headers.get('Cookie','')); db.execute('DELETE FROM sessions WHERE token_hash=?',(digest(cookie['telepathy_session'].value),)); db.commit()
                return self.send(200,{'ok':True},headers={'Set-Cookie':self.cookie('',0)})
            preview=re.fullmatch(r'/api/artifacts/([a-f0-9]+)/preview',path)
            if (path.startswith('/p/') or preview) and method=='GET':
                if preview:
                    if not p: raise Failure(401,'Sign in to preview')
                    row=db.execute('SELECT * FROM artifacts WHERE id=?',(preview[1],)).fetchone()
                    if row:
                        row=dict(row); row.update(public_title=row['title'],public_body=row['body'],published_revision=row['revision'])
                else:
                    slug=path[3:]; row=db.execute('SELECT * FROM artifacts WHERE slug=? AND published_revision IS NOT NULL',(slug,)).fetchone()
                if not row: raise Failure(404,'Page not found')
                title=html.escape(row['public_title']); body=render_markdown(row['public_body']); desc=html.escape(row['public_body'][:180],quote=True)
                publisher=db.execute('SELECT name FROM people WHERE id=?',(row['published_by'] or row['owner_id'],)).fetchone()
                byline=html.escape(publisher['name']) if publisher else 'Team'
                label='Draft preview' if preview else 'Published'
                page=f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title} · Telepathy</title><meta name="description" content="{desc}"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:type" content="article"><meta property="og:url" content="{html.escape(base+path,quote=True)}"><meta property="og:image" content="{base}/preview.png"></head><body style="max-width:760px;margin:64px auto;padding:24px;font:18px/1.7 system-ui;background:#faf8f3;color:#252923"><a href="/">Telepathy / Intuitxn</a><h1>{title}</h1><article>{body}</article><footer>{label} revision {row["published_revision"]} · {byline}</footer></body></html>'
                return self.send(200,page,'text/html; charset=utf-8')
            if path=='/preview.png' and method=='GET':
                target=ROOT/'artifacts/assets/telepathy-preview.png'
                if not target.is_file(): raise Failure(404,'Preview not available')
                return self.send(200,target.read_bytes(),'image/png')
            if path=='/preview.svg' and method=='GET': return self.send(200,'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#faf8f3"/><text x="90" y="290" font-size="82" fill="#a95841">Telepathy</text><text x="90" y="380" font-size="40" fill="#252923">Published knowledge · Intuitxn</text></svg>','image/svg+xml')
            if not path.startswith('/api/') and method=='GET':
                import mimetypes
                relative=unquote(path).lstrip('/') or 'index.html'; target=(Path(static_dir)/relative).resolve(); root=Path(static_dir).resolve()
                if not target.is_relative_to(root): raise Failure(404,'Not found')
                if not target.is_file(): target=root/'index.html'
                if not target.is_file(): raise Failure(503,'Build the site first')
                return self.send(200,target.read_bytes(),mimetypes.guess_type(target)[0] or 'application/octet-stream')
            if not p: raise Failure(401,'Sign in with your personal invitation')
            if path=='/api/invitations' and method=='POST':
                if p['id']!='shubham': raise Failure(403,'Only the workspace owner can issue invitations')
                person_id=data.get('personId')
                if person_id not in ['om','kush']: raise Failure(400,'Choose Om or Kush')
                token=secrets.token_urlsafe(32); expires=now()+7*86400
                db.execute('DELETE FROM invites WHERE person_id=?',(person_id,)); db.execute('INSERT INTO invites VALUES (?,?,?)',(digest(token),person_id,expires)); self.receipt(db,p,'invite',person_id); db.commit()
                return self.send(201,{'personId':person_id,'url':base+'/#invite='+token,'expiresAt':iso(expires)})
            if path=='/api/workspace' and method=='GET':
                posts=[]
                for row in db.execute('SELECT * FROM posts ORDER BY created DESC,rowid DESC LIMIT 200'):
                    r=dict(row); replies=[{'id':x['id'],'authorId':x['author_id'],'body':x['body'],'createdAt':iso(x['created'])} for x in db.execute('SELECT * FROM replies WHERE post_id=? ORDER BY created,rowid LIMIT 200',(r['id'],))]
                    posts.append({'id':r['id'],'authorId':r['author_id'],'type':r['type'],'title':r['title'],'body':r['body'],'createdAt':iso(r['created']),'resolved':bool(r['resolved']),'resolution':{'summary':r['summary'] or '', 'resolvedAt':iso(r['resolved_at']),'resolvedBy':r['resolved_by']} if r['resolved'] else None,'replies':replies,'acknowledgedBy':[x[0] for x in db.execute('SELECT person_id FROM acknowledgements WHERE post_id=?',(r['id'],))]})
                return self.send(200,{'people':[dict(x) for x in db.execute('SELECT * FROM people')],'posts':posts,'artifacts':[artifact(x,base) for x in db.execute('SELECT * FROM artifacts ORDER BY rowid DESC LIMIT 100')],'lessons':[lesson(x) for x in db.execute('SELECT * FROM lessons ORDER BY rowid DESC LIMIT 100')]})
            if path=='/api/posts' and method=='POST':
                pid=secrets.token_hex(12); kind=data.get('type','update')
                if kind not in ['update','question','decision','announcement']: raise Failure(400,'Invalid post type')
                title=data.get('title','') if kind=='update' else text_field(data,'title',200)
                if not isinstance(title,str) or len(title)>200: raise Failure(400,'Invalid title')
                db.execute('INSERT INTO posts(id,author_id,type,title,body,created,resolved) VALUES (?,?,?,?,?,?,0)',(pid,p['id'],kind,title.strip(),text_field(data,'body',20000),now())); db.commit(); return self.send(201,{'id':pid})
            match=re.fullmatch(r'/api/posts/([a-f0-9]+)/(?P<action>replies|ack|resolve)',path)
            if match and method=='POST':
                pid=match[1]; row=db.execute('SELECT * FROM posts WHERE id=?',(pid,)).fetchone()
                if not row: raise Failure(404,'Thread not found')
                action=match['action']; rid=secrets.token_hex(12)
                if action=='replies': db.execute('INSERT INTO replies VALUES (?,?,?,?,?)',(rid,pid,p['id'],text_field(data,'body',20000),now()))
                elif action=='ack':
                    if row['author_id']==p['id']: raise Failure(403,'Cannot acknowledge your own post')
                    existing=db.execute('DELETE FROM acknowledgements WHERE post_id=? AND person_id=?',(pid,p['id']))
                    if not existing.rowcount: db.execute('INSERT INTO acknowledgements VALUES (?,?)',(pid,p['id']))
                else:
                    if row['author_id']!=p['id']: raise Failure(403,'Only the thread owner can resolve it')
                    if not isinstance(data.get('resolved'),bool): raise Failure(400,'resolved must be boolean')
                    summary=text_field(data,'summary',2000,'Resolved') if data['resolved'] else None
                    db.execute('UPDATE posts SET resolved=?,summary=?,resolved_at=?,resolved_by=? WHERE id=?',(int(data['resolved']),summary,now() if data['resolved'] else None,p['id'] if data['resolved'] else None,pid))
                db.commit(); return self.send(200,{'ok':True,'id':rid if action=='replies' else pid})
            if path=='/api/lessons/propose' and method=='POST':
                sources=self.sources(db,data); feedback=text_field(data,'feedback',8000)
                program=data.get('program')
                if program!='artifact-design': raise Failure(400,'Only artifact-design learning is enabled')
                parent=self.program_call('inspect',program)
                generated=self.program_call('run','lesson-proposal',{'feedback':feedback,'outcome':'Selected team feedback: '+ '\n'.join(b for _,_,b in sources),'parentDigest':parent['digest'],'source':parent['source']})
                output=generated.get('output',{}); text_field(output,'candidateSource',50000); candidate=output['candidateSource']
                checked=self.program_call('validate-candidate',program,{'source':candidate,'parentDigest':parent['digest']})
                if checked.get('valid') is not True: raise Failure(422,'Candidate failed frozen program validation')
                ident=secrets.token_hex(12); title=text_field(output,'lesson',2000)[:200]; rationale=text_field(output,'rationale',20000)
                db.execute('INSERT INTO lessons(id,owner_id,title,body,sources,revision,status,program,parent_digest,candidate_digest,candidate_source) VALUES (?,?,?,?,?,1,\'proposed\',?,?,?,?)',(ident,p['id'],title,rationale,json.dumps([x[0] for x in sources]),program,parent['digest'],checked['candidateDigest'],candidate))
                self.receipt(db,p,'propose-program',ident,1,checked['candidateDigest']); db.commit()
                return self.send(201,lesson(db.execute('SELECT * FROM lessons WHERE id=?',(ident,)).fetchone()))
            if path in ['/api/artifacts','/api/lessons'] and method=='POST':
                sources=self.sources(db,data); ident=secrets.token_hex(12); title=text_field(data,'title',200)
                if path=='/api/artifacts':
                    body='\n\n'.join((('## '+t+'\n\n') if t else '')+b for _,t,b in sources)
                    db.execute('INSERT INTO artifacts(id,owner_id,title,body,sources,revision) VALUES (?,?,?,?,?,1)',(ident,p['id'],title,body,json.dumps([s[0] for s in sources])))
                    result=artifact(db.execute('SELECT * FROM artifacts WHERE id=?',(ident,)).fetchone(),base)
                else:
                    db.execute('INSERT INTO lessons(id,owner_id,title,body,sources,revision,status,accepted_by,accepted_at) VALUES (?,?,?,?,?,1,\'proposed\',NULL,NULL)',(ident,p['id'],title,text_field(data,'body',20000),json.dumps([s[0] for s in sources])))
                    result=lesson(db.execute('SELECT * FROM lessons WHERE id=?',(ident,)).fetchone())
                self.receipt(db,p,'create',ident,1); db.commit(); return self.send(201,result)
            design=re.fullmatch(r'/api/artifacts/([a-f0-9]+)/design',path)
            if design and method=='POST':
                row=db.execute('SELECT * FROM artifacts WHERE id=?',(design[1],)).fetchone()
                if not row: raise Failure(404,'Artifact not found')
                if row['owner_id']!=p['id']: raise Failure(403,'Only the owner can design this draft')
                if data.get('revision')!=row['revision']: raise Failure(409,'Draft changed; reload')
                model=data.get('model','opencode-go/deepseek-v4-flash')
                if model not in ['opencode-go/deepseek-v4-flash']: raise Failure(400,'Model is not enabled')
                interpreter=os.environ.get('TELEPATHY_PROGRAM_PYTHON',str(ROOT.parent/'nudge/.venv/bin/python3.12'))
                try:
                    run=subprocess.run([interpreter,str(ROOT/'runtime/programs/cli.py'),'run','artifact-design','--input','-','--model',model],input=json.dumps({'title':row['title'],'body':row['body'],'sourceIds':json.loads(row['sources'])}),text=True,capture_output=True,timeout=95,cwd=ROOT)
                    result=json.loads(run.stdout)
                    if run.returncode or result.get('status')!='succeeded': raise ValueError()
                    output=result['output']; title=text_field(output,'title',200); body=text_field(output,'body',50000)
                except (OSError,ValueError,KeyError,subprocess.TimeoutExpired): raise Failure(502,'Design runtime unavailable; your draft is unchanged')
                db.execute('BEGIN IMMEDIATE')
                changed=db.execute('UPDATE artifacts SET title=?,body=?,revision=revision+1 WHERE id=? AND revision=?',(title,body,design[1],row['revision']))
                if not changed.rowcount: raise Failure(409,'Draft changed during design; output was not applied')
                self.receipt(db,p,'design',design[1],row['revision']+1,content_digest(title,body)); db.commit()
                return self.send(200,artifact(db.execute('SELECT * FROM artifacts WHERE id=?',(design[1],)).fetchone(),base))
            match=re.fullmatch(r'/api/artifacts/([a-f0-9]+)(?:/(publish|unpublish))?',path)
            if match:
                ident,action=match.groups(); db.execute('BEGIN IMMEDIATE'); row=db.execute('SELECT * FROM artifacts WHERE id=?',(ident,)).fetchone()
                if not row: raise Failure(404,'Artifact not found')
                if row['owner_id']!=p['id']: raise Failure(403,'Only the artifact owner can change or publish it')
                if method=='PATCH' and action is None:
                    if data.get('revision')!=row['revision']: raise Failure(409,'Draft changed; reload before editing')
                    db.execute('UPDATE artifacts SET title=?,body=?,revision=revision+1 WHERE id=?',(text_field(data,'title',200),text_field(data,'body',50000),ident)); self.receipt(db,p,'edit',ident,row['revision']+1)
                elif method=='POST' and action=='publish':
                    sha=content_digest(row['title'],row['body'])
                    if data.get('digest')!=sha: raise Failure(409,'Draft changed; preview this revision before publishing')
                    slug=text_field(data,'slug',100)
                    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*',slug): raise Failure(400,'Use lowercase letters, numbers and hyphens in the URL')
                    if row['slug'] and slug!=row['slug']: raise Failure(409,'Published URL is permanent; use the existing slug')
                    db.execute('UPDATE artifacts SET slug=?,published_revision=revision,public_title=title,public_body=body,published_by=?,published_at=? WHERE id=?',(slug,p['id'],now(),ident)); self.receipt(db,p,'publish',ident,row['revision'],sha)
                elif method=='POST' and action=='unpublish':
                    db.execute('UPDATE artifacts SET published_revision=NULL,public_title=NULL,public_body=NULL WHERE id=?',(ident,)); self.receipt(db,p,'unpublish',ident,row['revision'])
                else: raise Failure(404,'Not found')
                result=artifact(db.execute('SELECT * FROM artifacts WHERE id=?',(ident,)).fetchone(),base); db.commit(); return self.send(200,result)
            match=re.fullmatch(r'/api/lessons/([a-f0-9]+)/accept',path)
            if match and method=='POST':
                db.execute('BEGIN IMMEDIATE')
                row=db.execute('SELECT * FROM lessons WHERE id=?',(match[1],)).fetchone()
                if not row: raise Failure(404,'Lesson not found')
                if (row['program'] and p['id']!='shubham') or (not row['program'] and row['owner_id']!=p['id']): raise Failure(403,'Only the workspace owner can activate a program; practice notes require their author')
                if data.get('revision')!=row['revision']: raise Failure(409,'Proposal changed')
                if row['status'] not in ['proposed','approved']: raise Failure(409,'Proposal already accepted')
                if row['program']:
                    if data.get('digest')!=row['candidate_digest']: raise Failure(409,'Review the exact candidate before accepting')
                    # Persist the authenticated exact-revision decision BEFORE changing the runtime.
                    if row['status']=='proposed':
                        db.execute("UPDATE lessons SET status='approved',accepted_by=?,accepted_at=? WHERE id=?",(p['id'],now(),match[1])); self.receipt(db,p,'approve-program',match[1],row['revision'],row['candidate_digest']); db.commit()
                    current=self.program_call('inspect',row['program'])
                    if current.get('digest')!=row['candidate_digest']:
                        promoted=self.program_call('promote-candidate',row['program'],{'source':row['candidate_source'],'parentDigest':row['parent_digest'],'candidateDigest':row['candidate_digest']})
                        if promoted.get('status')!='promoted': raise Failure(422,'Program candidate was not promoted')
                db.execute('UPDATE lessons SET status=\'accepted\',accepted_by=?,accepted_at=? WHERE id=?',(p['id'],now(),match[1])); self.receipt(db,p,'accept-lesson',match[1],row['revision']); db.commit()
                return self.send(200,lesson(db.execute('SELECT * FROM lessons WHERE id=?',(match[1],)).fetchone()))
            raise Failure(404,'Not found')
    return Handler

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['init','serve','status','invite']); parser.add_argument('--db',default=str(Path.home()/'.local/share/telepathy-workspace/workspace.db')); parser.add_argument('--invites',default=str(Path.home()/'.local/share/telepathy-workspace/invites.json')); parser.add_argument('--public-url',default=os.environ.get('TELEPATHY_PUBLIC_URL','http://localhost:4110')); parser.add_argument('--port',type=int,default=4110); parser.add_argument('--static-dir',default=str(ROOT/'site/dist')); parser.add_argument('--person',choices=['shubham','om','kush']); args=parser.parse_args()
    initialize(args.db,args.invites)
    if args.command=='serve':
        interpreter=os.environ.get('TELEPATHY_PROGRAM_PYTHON',str(ROOT.parent/'nudge/.venv/bin/python3.12'))
        with connect(args.db) as db:
            for row in db.execute("SELECT * FROM lessons WHERE status='approved' AND program IS NOT NULL").fetchall():
                try:
                    run=subprocess.run([interpreter,str(ROOT/'runtime/programs/cli.py'),'inspect',row['program']],capture_output=True,text=True,timeout=10,cwd=ROOT)
                    if not run.returncode and json.loads(run.stdout).get('digest')==row['candidate_digest']:
                        db.execute("UPDATE lessons SET status='accepted' WHERE id=?",(row['id'],))
                        db.execute('INSERT INTO receipts VALUES (?,?,?,?,?,?,?)',(secrets.token_hex(12),row['accepted_by'],'reconcile-program',row['id'],row['revision'],row['candidate_digest'],now()))
                except (OSError,ValueError,subprocess.TimeoutExpired): pass

        parsed=urlsplit(args.public_url)
        if parsed.scheme not in ['http','https'] or parsed.path not in ['', '/'] or parsed.query or parsed.fragment: parser.error('public URL must be an origin')
        if parsed.scheme=='http' and parsed.hostname not in ['localhost','127.0.0.1']: parser.error('HTTP is only allowed for localhost')
        ThreadingHTTPServer(('127.0.0.1',args.port),make_handler(args.db,args.public_url,args.static_dir)).serve_forever()
    elif args.command=='invite':
        if not args.person: parser.error('--person required')
        token=secrets.token_urlsafe(32)
        with connect(args.db) as db:
            db.execute('DELETE FROM invites WHERE person_id=?',(args.person,)); db.execute('INSERT INTO invites VALUES (?,?,?)',(digest(token),args.person,now()+7*86400))
        target=Path(args.invites); fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600); os.chmod(target,0o600)
        with os.fdopen(fd,'w') as f: json.dump({args.person:token},f)
        print(json.dumps({'ok':True,'invitationFile':str(target)}))
    else:
        with connect(args.db) as db: print(json.dumps({'ok':True,'people':db.execute('SELECT count(*) FROM people').fetchone()[0],'posts':db.execute('SELECT count(*) FROM posts').fetchone()[0],'artifacts':db.execute('SELECT count(*) FROM artifacts').fetchone()[0]}))
if __name__=='__main__': main()
