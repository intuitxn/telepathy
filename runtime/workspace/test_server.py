import http.client, json, tempfile, threading, unittest, os
from unittest.mock import patch
from pathlib import Path
from server import initialize, make_handler, ThreadingHTTPServer, connect, Failure, content_digest

class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); root=Path(self.temp.name); self.db=root/'workspace.db'; self.invites=root/'invites.json'; initialize(self.db,self.invites)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.db,'http://localhost:4110',root)); self.thread=threading.Thread(target=self.server.serve_forever,daemon=True); self.thread.start(); self.cookies={}
        self.tokens=json.loads(self.invites.read_text())
        for name in ['Shubham','Om']:
            status,body,headers=self.call('POST','/api/login',{'token':self.tokens[name]}); self.assertEqual(status,200); self.cookies[name]=headers['Set-Cookie'].split(';')[0]
    def tearDown(self): self.server.shutdown(); self.server.server_close(); self.temp.cleanup()
    def call(self,method,path,data=None,person=None,extra=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port); headers={'Host':'localhost:4110','Origin':'http://localhost:4110','Content-Type':'application/json'}
        if person: headers['Cookie']=self.cookies[person]
        headers.update(extra or {}); c.request(method,path,json.dumps(data) if data is not None else None,headers); r=c.getresponse(); raw=r.read(); h=dict(r.getheaders()); c.close()
        return r.status,json.loads(raw) if h.get('Content-Type')=='application/json' else raw.decode(),h
    def post(self,body='A private source'):
        s,b,_=self.call('POST','/api/posts',{'title':'Build together','body':body},'Shubham'); self.assertEqual(s,201); return b['id']
    def test_real_people_threads_persist_and_identity_is_session_bound(self):
        pid=self.post(); s,r,_=self.call('POST',f'/api/posts/{pid}/replies',{'body':'Om sees this','authorId':'shubham'},'Om'); self.assertEqual(s,200)
        s,w,_=self.call('GET','/api/workspace',person='Om'); self.assertEqual(w['posts'][0]['replies'][0]['authorId'],'om')
        with connect(self.db) as db: self.assertEqual(db.execute('SELECT count(*) FROM replies').fetchone()[0],1)
        self.assertEqual(self.call('POST',f'/api/posts/{pid}/resolve',{'resolved':True},'Om')[0],403)
        self.assertEqual(self.call('GET','/api/workspace')[0],401)
        self.assertEqual(self.call('POST','/api/login',{'token':self.tokens['Shubham']})[0],401)
    def test_publication_exact_revision_selected_sources_and_withdrawal(self):
        pid=self.post('<script>alert(1)</script>'); secret=self.post('DO_NOT_PUBLISH_UNSELECTED')
        s,a,_=self.call('POST','/api/artifacts',{'title':'A report','sourceIds':[pid]},'Shubham'); self.assertEqual(s,201); url='/api/artifacts/'+a['id']
        self.assertNotIn('DO_NOT_PUBLISH',a['body']); self.assertEqual(self.call('POST',url+'/publish',{'digest':a['digest'],'slug':'report'},'Om')[0],403)
        self.assertEqual(self.call('POST',url+'/publish',{'digest':'bad','slug':'report'},'Shubham')[0],409)
        self.assertEqual(self.call('POST',url+'/publish',{'digest':a['digest'],'slug':'report'},'Shubham')[0],200)
        s,public,_=self.call('GET','/p/report'); self.assertEqual(s,200); self.assertNotIn('<script>',public); self.assertNotIn(secret,public); self.assertNotIn('DO_NOT_PUBLISH',public)
        s,b,_=self.call('PATCH',url,{'title':'Revised','body':'UNPUBLISHED_DRAFT','revision':1},'Shubham'); self.assertEqual(s,200)
        self.assertNotIn('UNPUBLISHED_DRAFT',self.call('GET','/p/report')[1]); self.assertIn('UNPUBLISHED_DRAFT',self.call('GET',url+'/preview',person='Om')[1])
        self.assertEqual(self.call('PATCH',url,{'title':'Stale','body':'No','revision':1},'Shubham')[0],409)
        self.assertEqual(self.call('POST',url+'/publish',{'digest':b['digest'],'slug':'report'},'Shubham')[0],200)
        self.assertIn('UNPUBLISHED_DRAFT',self.call('GET','/p/report')[1]); self.assertEqual(self.call('POST',url+'/unpublish',{},'Shubham')[0],200); self.assertEqual(self.call('GET','/p/report')[0],404)
    def test_origin_host_and_learning_authority(self):
        self.assertEqual(self.call('POST','/api/posts',{},'Shubham',{'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.call('GET','/api/me',person='Shubham',extra={'Host':'evil.example'})[0],403)
        pid=self.post(); s,l,_=self.call('POST','/api/lessons',{'title':'Design lesson','body':'Use a clear heading','sourceIds':[pid]},'Shubham'); self.assertEqual(s,201)
        url='/api/lessons/'+l['id']+'/accept'; self.assertEqual(self.call('POST',url,{'revision':1},'Om')[0],403); self.assertEqual(self.call('POST',url,{'revision':1},'Shubham')[1]['status'],'accepted')
    def test_composer_kinds_and_unambiguous_publication_digest(self):
        self.assertNotEqual(content_digest('A','B\nC'),content_digest('A\nB','C'))
        self.assertEqual(self.call('POST','/api/posts',{'type':'update','body':'No title needed'},'Shubham')[0],201)
        self.assertEqual(self.call('POST','/api/posts',{'type':'announcement','title':'Announcement','body':'Team announcement'},'Shubham')[0],201)
        pid=self.post(); self.assertEqual(self.call('POST',f'/api/posts/{pid}/ack',{},'Shubham')[0],403)
        for expected in [['om'],[]]:
            self.assertEqual(self.call('POST',f'/api/posts/{pid}/ack',{},'Om')[0],200)
            posts=self.call('GET','/api/workspace',person='Om')[1]['posts']; self.assertEqual(next(x for x in posts if x['id']==pid)['acknowledgedBy'],expected)
    def test_owner_can_invite_without_identity_switching(self):
        self.assertEqual(self.call('POST','/api/invitations',{'personId':'kush'},'Om')[0],403)
        status,inv,_=self.call('POST','/api/invitations',{'personId':'kush'},'Shubham'); self.assertEqual(status,201)
        token=inv['url'].split('#invite=')[1]
        status,person,_=self.call('POST','/api/login',{'token':token}); self.assertEqual(status,200); self.assertEqual(person['person']['id'],'kush')
        self.assertEqual(self.call('POST','/api/login',{'token':token})[0],401)
    def test_program_candidate_review_promotes_exact_private_revision(self):
        interpreter=Path(__file__).resolve().parents[3]/'nudge/.venv/bin/python3.12'
        if not interpreter.is_file(): self.skipTest('Nudge interpreter unavailable')
        original=self.server.RequestHandlerClass.program_call
        fail_after_promotion=[True]
        def controlled_model(handler,command,name,inputs=None):
            if command=='run' and name=='lesson-proposal':
                source=inputs['source'].replace('Keep output concise.','Keep output concise. Use descriptive headings for longer reports.')
                return {'status':'succeeded','output':{'lesson':'Headings help','rationale':'Selected feedback asks for clearer sections.','candidateSource':source}}
            result=original(handler,command,name,inputs)
            if command=='promote-candidate' and fail_after_promotion[0]:
                fail_after_promotion[0]=False
                raise Failure(502,'Simulated interruption after activation')
            return result
        with patch.dict(os.environ,{'TELEPATHY_PROGRAM_STATE_ROOT':self.temp.name+'/program-state','TELEPATHY_PROGRAM_PYTHON':str(interpreter)}), patch.object(self.server.RequestHandlerClass,'program_call',controlled_model):
            pid=self.post('The report is difficult to scan; use headings.')
            status,l,_=self.call('POST','/api/lessons/propose',{'program':'artifact-design','feedback':'Use headings','sourceIds':[pid]},'Shubham'); self.assertEqual(status,201,l)
            url='/api/lessons/'+l['id']+'/accept'
            self.assertEqual(self.call('POST',url,{'revision':1,'digest':l['candidateDigest']},'Om')[0],403)
            self.assertEqual(self.call('POST',url,{'revision':1,'digest':'wrong'},'Shubham')[0],409)
            self.assertEqual(self.call('POST',url,{'revision':1,'digest':l['candidateDigest']},'Shubham')[0],502)
            with connect(self.db) as db:
                self.assertEqual(db.execute('SELECT status FROM lessons WHERE id=?',(l['id'],)).fetchone()[0],'approved')
                self.assertEqual(db.execute("SELECT person_id FROM receipts WHERE action='approve-program'").fetchone()[0],'shubham')
            status,result,_=self.call('POST',url,{'revision':1,'digest':l['candidateDigest']},'Shubham'); self.assertEqual(status,200,result); self.assertEqual(result['status'],'accepted')
            pointer=Path(self.temp.name)/'program-state/artifact-design.active.json'; self.assertEqual(json.loads(pointer.read_text())['digest'],l['candidateDigest'])
            self.assertEqual(self.call('POST',url,{'revision':1,'digest':l['candidateDigest']},'Shubham')[0],409)
    def test_invites_private_and_preview_private(self):
        self.assertEqual(self.invites.stat().st_mode & 0o777,0o600); self.assertEqual(self.db.stat().st_mode & 0o777,0o600)
        self.assertEqual(self.call('GET','/api/artifacts/aaa/preview')[0],401)
if __name__=='__main__': unittest.main()
