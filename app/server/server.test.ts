import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from './index.js';
import {createApplication, patchApplication} from './model.js';
import {GoogleSheetsClient, profileContentHash, remoteToApplication, resolveConflict, resolveProfileConflict, syncWorkspace, type RemoteRow, type SheetsGateway} from './sheets.js';
import type {Application, AnswerPack, ProfileExport} from '../shared/types.js';
import type {Workspace} from './store.js';
import type {GoogleOAuth} from './google.js';
import {GoogleOAuth as RealGoogleOAuth} from './google.js';
import {AppsScriptInstaller} from './apps-script.js';

const profile:ProfileExport = {schemaVersion:1,profileVersion:'2026-10-13-test',personal:{fullName:'Test Candidate'},facts:[{id:'F001',claim:'Built a sample app.',source:'Approved test'}],standardAnswers:[],resumeVersions:[{id:'SDE',filename:'test.pdf'},{id:'AI',filename:'ai-test.pdf'}]};
class FakeGateway implements SheetsGateway {
  rows:RemoteRow[] = [];
  writes = 0;
  readProfile?:()=>Promise<ProfileExport|null>;
  async readRows() { return structuredClone(this.rows); }
  async updateRow(rowNumber:number,values:Array<string|number|boolean>) { const row=this.rows.find(r=>r.rowNumber===rowNumber); assert.ok(row); row.values=structuredClone(values); this.writes++; }
  async appendRow(values:Array<string|number|boolean>) { this.rows.push({rowNumber:Math.max(1,...this.rows.map(r=>r.rowNumber))+1,values:structuredClone(values)}); this.writes++; }
}
function workspace(applications:Application[]):Workspace { return {schemaVersion:1,applications,profile,preferences:{},packs:[],lastSyncedAt:null,conflicts:[],remoteRows:{},profileRemoteHash:null,profileLocalHashAtSync:null}; }
async function request(server:http.Server,method:string,url:string,body?:unknown,headers:Record<string,string>={}) {
  const port=(server.address() as AddressInfo).port;
  return new Promise<{status:number;body:any}>((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{Host:'127.0.0.1:4318',...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode||0,body:JSON.parse(raw)});}catch{resolve({status:res.statusCode||0,body:raw});}});
    });
    req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
test('local API persists applications, rejects duplicates, and enforces lifecycle and CSRF',async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'applyweave-server-'));
  const {app,store,csrfToken}=await createApp({privateDir:dir,aiAvailable:async()=>false});
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    const state=await request(server,'GET','/api/state');
    assert.equal(state.status,200); assert.equal(state.body.csrfToken,csrfToken);
    assert.deepEqual(state.body.applications,[]);
    assert.equal((await request(server,'POST','/api/applications',{company:'Acme',title:'Engineer'})).status,403);
    const headers={'X-ApplyWeave-CSRF':csrfToken};
    const created=await request(server,'POST','/api/applications',{company:'Acme',title:'Engineer',workMode:'Remote',jobUrl:'https://example.test/role'},headers);
    assert.equal(created.status,201); assert.equal(created.body.application.syncStatus,'pending');
    const id=created.body.application.applicationId;
    const duplicate=await request(server,'POST','/api/applications',{company:'Acme',title:'Engineer'},headers);
    assert.equal(duplicate.status,409); assert.equal(duplicate.body.applicationId,id);
    const rejected=await request(server,'PATCH',`/api/applications/${id}`,{status:'Rejected',nextAction:'Ignore',dueDate:'2026-10-31'},headers);
    assert.equal(rejected.status,200); assert.equal(rejected.body.application.nextAction,'');assert.equal(rejected.body.application.dueDate,'');
    const offer=await request(server,'PATCH',`/api/applications/${id}`,{status:'Offer'},headers);
    assert.equal(offer.body.application.nextAction,'Review offer');assert.ok(offer.body.application.dueDate);
    assert.equal((await request(server,'POST','/api/preferences',{preferences:{}},{...headers,Origin:'https://evil.test'})).status,403);
    assert.equal((await request(server,'GET','/api/state',undefined,{Host:'evil.test'})).status,403);
    assert.equal((await request(server,'GET','/api/state',undefined,{Host:'127.0.0.1:5173',Origin:'http://127.0.0.1:5173'})).status,200);
    const callback=await request(server,'GET','/api/auth/google/callback?code=x&state=x',undefined,{'Sec-Fetch-Site':'cross-site'});
    assert.equal(callback.status,400);assert.equal(callback.body.code,'OAUTH_STATE');
    const disk=JSON.parse(await readFile(store.filename,'utf8'));
    assert.equal(disk.applications[0].applicationId,id);
    assert.equal(disk.applications[0].status,'Offer');
    assert.equal(disk.googleOAuthClient,undefined);
  } finally {server.close();await rm(dir,{recursive:true,force:true});}
});

test('sync is idempotent and flags concurrent Sheet changes before overwrite',async () => {
  const app=createApplication({company:'Example',title:'Engineer',jobUrl:'https://example.test/job'},[]);
  const data=workspace([app]), gateway=new FakeGateway();
  const first=await syncWorkspace(data,gateway);
  assert.equal(first.synced,1);assert.equal(gateway.writes,1);assert.equal(app.syncStatus,'synced');
  await syncWorkspace(data,gateway);
  assert.equal(gateway.writes,1);
  gateway.rows[0].values[21]='External note';
  const edited=patchApplication(app,{notes:'Local note'},data.applications);
  data.applications[0]=edited;
  const result=await syncWorkspace(data,gateway);
  assert.equal(result.conflicts.length,1); assert.equal(edited.syncStatus,'conflict');assert.equal(gateway.writes,1);
  await resolveConflict(data,gateway,app.applicationId,'remote');
  assert.equal(data.applications[0].notes,'External note');assert.equal(data.applications[0].syncStatus,'synced');
  data.applications[0]=patchApplication(data.applications[0],{notes:'My final note'},data.applications);
  const result2=await syncWorkspace(data,gateway);
  assert.equal(result2.conflicts.length,0);assert.equal(gateway.writes,2);
  assert.equal(remoteToApplication(gateway.rows[0]).notes,'My final note');
});

test('Sheet transport writes RAW values and never interprets leading equals as a formula',async () => {
  const calls:Array<{url:string;init:RequestInit}> = [];
  const fakeFetch = (async (url:URL|string,init:RequestInit={}) => {
    calls.push({url:String(url),init});
    return new Response(JSON.stringify({updatedCells:22}),{status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  const oauth={config:async()=>({clientId:'a.apps.googleusercontent.com',clientSecret:'x',spreadsheetId:'12345678901234567890'}),accessToken:async()=> 'test-token'} as GoogleOAuth;
  const client=new GoogleSheetsClient(oauth,fakeFetch);
  await client.updateRow(2,['AW-20261013-ABC123','=HYPERLINK("bad")']);
  assert.match(calls[0].url,/valueInputOption=RAW/);
  assert.equal(calls[0].init.method,'PUT');
  assert.equal(JSON.parse(String(calls[0].init.body)).values[0][1],'=HYPERLINK("bad")');
  await client.appendRow(['AW-20261013-ABC124']);
  assert.match(calls[1].url,/:append\?/);
  assert.match(calls[1].url,/valueInputOption=RAW/);
});

test('approved Sheet profile pulls only when local profile is unchanged',async () => {
  const data=workspace([]), gateway=new FakeGateway();
  let sheetProfile:ProfileExport=structuredClone(profile);
  gateway.readProfile=async()=>structuredClone(sheetProfile);
  await syncWorkspace(data,gateway);
  assert.equal(data.conflicts.length,0);
  sheetProfile.facts[0].claim='Built a changed sample app.';
  await syncWorkspace(data,gateway);
  assert.equal(data.profile.facts[0].claim,'Built a changed sample app.');
  data.profile.facts[0].claim='Local edit';
  sheetProfile.facts[0].claim='Another Sheet edit';
  await syncWorkspace(data,gateway);
  assert.equal(data.conflicts[0].applicationId,'PROFILE');
  await assert.rejects(resolveProfileConflict(data,gateway,'local'),/Export the local approved profile/);
  await resolveProfileConflict(data,gateway,'remote');
  assert.equal(data.profile.facts[0].claim,'Another Sheet edit');
  assert.equal(data.conflicts.length,0);
});

test('profile comparison ignores order of approved Sheet rows and supporting fact IDs',()=>{
  const first:ProfileExport={...profile,personal:{fullName:'Test Candidate',email:'test@example.com'},facts:[...profile.facts,{id:'F002',claim:'Shipped a tool.',source:'Approved test'}],standardAnswers:[{key:'pitch',text:'I built two projects.',factIds:['F001','F002']}],resumeVersions:[...profile.resumeVersions]};
  const reordered:ProfileExport={...first,personal:{email:'test@example.com',fullName:'Test Candidate'},facts:[...first.facts].reverse(),standardAnswers:[{...first.standardAnswers[0],factIds:['F002','F001']}],resumeVersions:[...first.resumeVersions].reverse()};
  assert.equal(profileContentHash(first),profileContentHash(reordered));
});

test('generation cannot overwrite application edits made while a draft is running',async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'applyweave-generation-'));
  await writeFile(path.join(dir,'approved-profile.json'),JSON.stringify(profile),{mode:0o600});
  let release!: (pack:AnswerPack)=>void;
  const generated=new Promise<AnswerPack>(resolve=>{release=resolve;});
  const {app,csrfToken}=await createApp({privateDir:dir,aiAvailable:async()=>true,generatePack:async()=>generated});
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    const headers={'X-ApplyWeave-CSRF':csrfToken};
    const created=await request(server,'POST','/api/applications',{company:'Acme',title:'Engineer'},headers);
    const id=created.body.application.applicationId;
    const input={applicationId:id,jobDescription:'Build and maintain a React application for users.',questions:[{question:'What have you built?'}]};
    const started=await request(server,'POST','/api/generate',input,headers);
    assert.equal(started.status,202);
    assert.equal((await request(server,'POST','/api/generate',input,headers)).status,409);
    await request(server,'PATCH',`/api/applications/${id}`,{notes:'Edited while generating'},headers);
    release({schemaVersion:1,applicationId:id,profileVersion:profile.profileVersion,resumeVersionId:'SDE',answers:[{question:'What have you built?',answer:'A sample app.',factIds:['F001'],approved:true}]});
    let result;
    for (let i=0;i<50;i++) { result=await request(server,'GET',`/api/generate/${started.body.jobId}`); if (result.body.status!=='running') break; await new Promise(resolve=>setTimeout(resolve,5)); }
    assert.equal(result?.body.status,'failed'); assert.match(result.body.error,/changed during generation/);
    const state=await request(server,'GET','/api/state');
    assert.equal(state.body.packs.length,0); assert.equal(state.body.applications[0].notes,'Edited while generating');
  } finally {server.close();await rm(dir,{recursive:true,force:true});}
});

test('answer pack recommendations preserve the resume already used for a submitted application',async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'applyweave-resume-used-'));
  await writeFile(path.join(dir,'approved-profile.json'),JSON.stringify(profile),{mode:0o600});
  const generated=async (input:{applicationId:string})=>({schemaVersion:1 as const,applicationId:input.applicationId,profileVersion:profile.profileVersion,resumeVersionId:'AI',answers:[{question:'What have you built?',answer:'A sample app.',factIds:['F001'],approved:false}]});
  const {app,csrfToken}=await createApp({privateDir:dir,aiAvailable:async()=>true,generatePack:generated});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    const headers={'X-ApplyWeave-CSRF':csrfToken};
    const created=await request(server,'POST','/api/applications',{company:'Acme',title:'Engineer',resumeVersion:'SDE',status:'Applied',dateApplied:'2026-10-12'},headers);
    assert.equal(created.status,201);const id=created.body.application.applicationId;
    const pack={schemaVersion:1,applicationId:id,profileVersion:profile.profileVersion,resumeVersionId:'AI',answers:[{question:'What have you built?',answer:'A sample app.',factIds:['F001'],approved:false}]};
    assert.equal((await request(server,'POST','/api/packs',{pack},headers)).status,200);
    let state=await request(server,'GET','/api/state');
    assert.equal(state.body.applications[0].resumeVersion,'SDE');assert.equal(state.body.packs[0].resumeVersionId,'AI');
    const started=await request(server,'POST','/api/generate',{applicationId:id,jobDescription:'Build and maintain a React application for users.',questions:[{question:'What have you built?'}]},headers);
    assert.equal(started.status,202);
    let result;
    for(let i=0;i<50;i++){result=await request(server,'GET',`/api/generate/${started.body.jobId}`);if(result.body.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(result?.body.status,'complete');
    state=await request(server,'GET','/api/state');
    assert.equal(state.body.applications[0].resumeVersion,'SDE');assert.equal(state.body.packs[0].resumeVersionId,'AI');
  } finally {server.close();await rm(dir,{recursive:true,force:true});}
});

test('Applied stage uses follow-up defaults when full drawer payload carries unchanged preparation action',()=>{
  const saved=createApplication({company:'Acme',title:'Engineer',status:'Preparing',nextAction:'Finish application',dueDate:'2026-10-13',dateSaved:'2026-10-12'},[]);
  const applied=patchApplication(saved,{status:'Applied',nextAction:saved.nextAction,dueDate:saved.dueDate,dateSaved:saved.dateSaved},[saved]);
  assert.equal(applied.nextAction,'Follow up');
  assert.notEqual(applied.dueDate,saved.dueDate);
  assert.equal(applied.dateSaved,'2026-10-12');
  const custom=patchApplication(saved,{status:'Applied',nextAction:'Email recruiter on Friday',dueDate:'2026-10-20'},[saved]);
  assert.equal(custom.nextAction,'Email recruiter on Friday');assert.equal(custom.dueDate,'2026-10-20');
  const interview=createApplication({company:'Beta',title:'Engineer',status:'Interview'},[]);
  assert.equal(interview.dateApplied,'');
});

test('Desktop OAuth asks for Apps Script scope only on explicit request',async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'applyweave-oauth-'));
  try {
    const oauth=new RealGoogleOAuth(dir);
    await oauth.configure({installed:{client_id:'12345.apps.googleusercontent.com',client_secret:'test'}},'12345678901234567890');
    const normal=new URL(await oauth.start());
    assert.equal(normal.searchParams.get('scope')?.includes('script.projects'),false);
    const install=new URL(await oauth.start(true));
    assert.equal(install.searchParams.get('scope')?.includes('script.projects'),true);
    assert.equal(install.searchParams.get('redirect_uri'),'http://127.0.0.1:4318/api/auth/google/callback');
    assert.equal(install.searchParams.get('code_challenge_method'),'S256');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('Apps Script installer creates one bound project and uploads reviewed source',async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'applyweave-script-'));
  const calls:Array<{url:string;init:RequestInit}>=[];
  const fetcher=(async (url:string|URL,init:RequestInit={})=>{
    calls.push({url:String(url),init});
    return new Response(JSON.stringify(calls.length===1?{scriptId:'script-123'}:{files:[]}),{status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  const oauth={scriptInstallPath:path.join(dir,'install.json'),config:async()=>({spreadsheetId:'12345678901234567890'}),publicState:async()=>({scriptAuthorized:true}),accessToken:async()=> 'test-token'} as GoogleOAuth;
  try {
    const installer=new AppsScriptInstaller(oauth,fetcher);
    const result=await installer.install();
    assert.equal(result.scriptId,'script-123');assert.equal(calls.length,2);
    assert.equal(JSON.parse(String(calls[0].init.body)).parentId,'12345678901234567890');
    const files=JSON.parse(String(calls[1].init.body)).files;
    assert.deepEqual(files.map((f:{name:string})=>f.name),['Code','Sidebar','appsscript']);
    assert.equal(JSON.parse(files[2].source).timeZone,'Asia/Kolkata');
    await installer.install();assert.equal(calls.length,2);
  } finally {await rm(dir,{recursive:true,force:true});}
});
