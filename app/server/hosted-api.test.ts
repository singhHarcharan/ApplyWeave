import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {randomBytes} from 'node:crypto';
import postgres from 'postgres';
import {createApp} from './index.js';
import {getSql,getWorkspaceSql} from './db.js';
import type {AnswerPack,ProfileExport} from '../shared/types.js';

const database=process.env.TEST_HOSTED_API_DATABASE_URL;
const host='applyweave-api-test.example';
async function request(server:http.Server,method:string,url:string,body?:unknown,headers:Record<string,string>={}) {
  return new Promise<{status:number;body:any;headers:http.IncomingHttpHeaders}>((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:(server.address() as AddressInfo).port,path:url,method,headers:{Host:host,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>{let parsed:unknown;try{parsed=JSON.parse(raw);}catch{parsed=raw;}resolve({status:res.statusCode||0,body:parsed,headers:res.headers});});
    });
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
async function listen(app:Awaited<ReturnType<typeof createApp>>['app']) {
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));return server;
}

test('hosted API persists sign-in, applications and generation across instances with atomic results and request limits', {skip:!database,timeout:30000},async()=>{
  const before={...process.env};
  const schema=`test_hosted_api_${randomBytes(6).toString('hex')}`;
  const admin=postgres(database!,{max:1,prepare:false,onnotice:()=>{}});
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const url=new URL(database!);url.searchParams.set('search_path',schema);
  Object.assign(process.env,{
    APPLYWEAVE_MODE:'hosted',DATABASE_URL:url.toString(),APP_ORIGIN:`https://${host}`,GOOGLE_REDIRECT_URI:`https://${host}/api/auth/google/callback`,
    GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only-secret',GOOGLE_SPREADSHEET_ID:'testspreadsheet1234567890',
    OWNER_EMAIL:'owner@example.com',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),SUPABASE_URL:'https://private-storage-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only-storage-key',AI_DAILY_LIMIT:'2'
  });
  const servers:http.Server[]=[];
  let releaseGeneration:()=>void=()=>{};
  try {
    const oauthFetcher=(async(input:URL|string,init?:RequestInit)=>{
      if(String(input).includes('/userinfo'))return Response.json({sub:'owner-sub',email:'owner@example.com',email_verified:true});
      assert.equal(new URLSearchParams(String(init?.body)).get('redirect_uri'),`https://${host}/api/auth/google/callback`);
      return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/spreadsheets'});
    }) as typeof fetch;
    let generationCalls=0,announceGeneration:()=>void=()=>{};
    const started=new Promise<void>(resolve=>{announceGeneration=resolve;});
    const generationGate=new Promise<void>(resolve=>{releaseGeneration=resolve;});
    const fakeGenerate:NonNullable<Parameters<typeof createApp>[0]>['generatePack']=async(input,profile)=>{
      generationCalls++;
      if(generationCalls===1){announceGeneration();await generationGate;}
      else {
        // Simulate expiry before completion. A completed pack must not be committed if its job can no longer complete.
        const sql=getSql();await sql`UPDATE applyweave_generation_jobs SET status='failed',data=data || ${sql.json({status:'failed',error:'simulated expiry'})} WHERE application_id=${input.applicationId} AND status='running'`;
      }
      return {schemaVersion:1,applicationId:input.applicationId,profileVersion:profile.profileVersion,resumeVersionId:'SDE',answers:[{question:'Describe your experience',answer:'Built a React interface.',factIds:['F1'],approved:true,maxCharacters:100}]} satisfies AnswerPack;
    };
    const dependencies={privateDir:'/unused-hosted-private-directory',oauthFetcher,aiAvailable:async()=>true,generatePack:fakeGenerate};
    const first=await createApp(dependencies),firstServer=await listen(first.app);servers.push(firstServer);
    const csrf={'X-ApplyWeave-CSRF':first.csrfToken};
    assert.equal((await request(firstServer,'GET','/api/state')).status,401);
    assert.equal((await request(firstServer,'POST','/api/resumes',{},csrf)).status,401);
    const signIn=await request(firstServer,'POST','/api/auth/google/start',{},csrf);
    assert.equal(signIn.status,200);
    const binding=signIn.headers['set-cookie']?.find(cookie=>cookie.startsWith('aw_oauth_bind='));assert.ok(binding);assert.match(binding,/Secure/);
    const state=new URL(signIn.body.url).searchParams.get('state');assert.ok(state);
    const callback=await request(firstServer,'GET',`/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,undefined,{Cookie:binding.split(';')[0],'Sec-Fetch-Site':'cross-site'});
    assert.equal(callback.status,303);assert.equal(callback.headers.location,'/?google=connected');
    const session=callback.headers['set-cookie']?.filter(cookie=>cookie.startsWith('aw_session=')).at(-1);assert.ok(session);assert.match(session,/Secure/);assert.match(session,/HttpOnly/);
    const headers={...csrf,Cookie:session.split(';')[0]};
    const profile:ProfileExport={schemaVersion:1,profileVersion:'api-test',personal:{fullName:'Test Owner',email:'owner@example.com'},facts:[{id:'F1',claim:'Built a React interface.',source:'Approved test fact'}],standardAnswers:[],resumeVersions:[{id:'SDE',filename:'test.pdf'}]};
    assert.equal((await request(firstServer,'POST','/api/profile',{profile},headers)).status,200);
    const created=await request(firstServer,'POST','/api/applications',{company:'Test Company',title:'Frontend Engineer'},headers);
    assert.equal(created.status,201);const applicationId=created.body.application.applicationId;
    const second=await createApp(dependencies),secondServer=await listen(second.app);servers.push(secondServer);
    assert.equal(second.csrfToken,first.csrfToken,'CSRF token survives server instances');
    assert.equal((await request(secondServer,'GET','/api/auth/session',undefined,headers)).body.authenticated,true);
    const persisted=await request(secondServer,'GET','/api/state',undefined,headers);
    assert.equal(persisted.body.applications[0].applicationId,applicationId);assert.equal(persisted.body.hostingMode,'hosted');
    assert.equal((await request(secondServer,'POST','/api/preferences',{preferences:{}},{...headers,Origin:'https://evil.example'})).status,403);
    for(const body of [{id:'!',filename:'valid.pdf',dataBase64:'JVBERi0xLjcg'}, {id:'NEW',filename:'../invalid.pdf',dataBase64:'JVBERi0xLjcg'},{id:'NEW',filename:'new.pdf',dataBase64:Buffer.from('not a pdf').toString('base64')}]) {
      assert.equal((await request(secondServer,'POST','/api/resumes',body,headers)).status,400);
    }
    assert.equal((await request(secondServer,'GET','/api/resumes/UNKNOWN',undefined,headers)).status,404);
    const generationBody={applicationId,jobDescription:'Build React interfaces for a fully remote product team.',questions:[{question:'Describe your experience',maxCharacters:100}],requestId:'test_generation_request_01'};
    let responseCompleted=false;
    const pending=request(firstServer,'POST','/api/generate',generationBody,headers).then(result=>{responseCompleted=true;return result;});
    await started;
    assert.equal(responseCompleted,false,'hosted requests await generation rather than lose background work');
    assert.equal((await request(secondServer,'GET',`/api/generate/${generationBody.requestId}`,undefined,headers)).body.status,'running');
    releaseGeneration();const generated=await pending;assert.equal(generated.status,202);
    const completed=await request(secondServer,'GET',`/api/generate/${generated.body.jobId}`,undefined,headers);
    assert.equal(completed.body.status,'complete');assert.equal(completed.body.pack.answers[0].approved,false);
    const saved=await request(secondServer,'GET','/api/state',undefined,headers);
    assert.deepEqual(saved.body.packs[0],completed.body.pack);assert.equal(saved.body.applications[0].answerPackId,applicationId);
    const replay=await request(secondServer,'POST','/api/generate',generationBody,headers);
    assert.equal(replay.status,202);assert.equal(replay.body.jobId,generated.body.jobId);assert.equal(generationCalls,1);
    const another=await request(secondServer,'POST','/api/applications',{company:'Another Test Company',title:'Backend Engineer'},headers);
    const anotherId=another.body.application.applicationId;
    assert.equal((await request(secondServer,'POST','/api/generate',{...generationBody,applicationId:anotherId},headers)).status,409,'request ID cannot be reused for a different application');
    const failed=await request(secondServer,'POST','/api/generate',{...generationBody,applicationId:anotherId,requestId:'test_generation_request_02'},headers);
    assert.equal(failed.status,202);
    assert.equal((await request(firstServer,'GET',`/api/generate/${failed.body.jobId}`,undefined,headers)).body.status,'failed');
    const afterFailure=(await request(firstServer,'GET','/api/state',undefined,headers)).body;
    assert.equal(afterFailure.packs.length,1,'expired job must not leave a saved pack');
    assert.equal(afterFailure.applications.find((app:{applicationId:string})=>app.applicationId===anotherId).answerPackId,'');
    const limited=await request(secondServer,'POST','/api/generate',{...generationBody,applicationId:anotherId,requestId:'test_generation_request_03'},headers);
    assert.equal(limited.status,429);assert.equal(limited.body.code,'AI_LIMIT');assert.equal(generationCalls,2);
    assert.equal((await request(secondServer,'POST','/api/auth/logout',{},headers)).status,200);
    assert.equal((await request(firstServer,'GET','/api/state',undefined,headers)).status,401,'logout revokes the shared session');
  } finally {
    releaseGeneration();
    await Promise.all(servers.map(server=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));
    await Promise.all([getSql().end(),getWorkspaceSql().end()]);
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
    for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);
  }
});
