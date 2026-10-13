import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import type {Request,Response} from 'express';
import {encryptSecret,decryptSecret,googleRedirectUri,isHosted} from './hosted-config.js';
import {GoogleOAuth} from './google.js';
import {Sessions} from './auth.js';
import {getSql,initDatabase} from './db.js';

function configure():()=>void {
  const before={...process.env};
  Object.assign(process.env,{APPLYWEAVE_MODE:'hosted',APP_ORIGIN:'https://applyweave.example.com',GOOGLE_REDIRECT_URI:'https://applyweave.example.com/api/auth/google/callback',GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only-secret',GOOGLE_SPREADSHEET_ID:'testspreadsheet1234567890',OWNER_EMAIL:'owner@example.com',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
  return ()=>{for(const name of Object.keys(process.env))if(!(name in before))delete process.env[name];Object.assign(process.env,before);};
}
test('hosted credentials use authenticated encryption and fail closed for malformed deployment configuration',async()=>{
  const restore=configure();
  try {
    assert.equal(isHosted(),true);
    const secret={refreshToken:'refresh-token-that-must-not-be-stored-in-plaintext'};
    const encrypted=encryptSecret(secret,'google-token');
    assert.equal(encrypted.includes(secret.refreshToken),false);
    assert.deepEqual(decryptSecret(encrypted,'google-token'),secret);
    assert.notEqual(encrypted,encryptSecret(secret,'google-token'));
    assert.throws(()=>decryptSecret(encrypted,'oauth-state'),/could not be decrypted/);
    const parts=encrypted.split('.');parts[3]=Buffer.from('tampered').toString('base64url');
    assert.throws(()=>decryptSecret(parts.join('.'),'google-token'),/could not be decrypted/);
    process.env.GOOGLE_REDIRECT_URI='https://evil.example/api/auth/google/callback';
    assert.throws(googleRedirectUri,/must match/);
    process.env.GOOGLE_REDIRECT_URI='https://applyweave.example.com/api/auth/google/callback';
    process.env.APP_ORIGIN='http://applyweave.example.com';
    assert.throws(googleRedirectUri,/HTTPS/);
    process.env.APP_ORIGIN='https://applyweave.example.com';
    delete process.env.OWNER_EMAIL;
    await assert.rejects(new GoogleOAuth('/unavailable-filesystem').config(),/OWNER_EMAIL/);
    process.env.OWNER_EMAIL='owner@example.com';
    await assert.rejects(new GoogleOAuth('/unavailable-filesystem').configure({},''),/environment variables/);
  } finally {restore();}
});

test('hosted OAuth and sessions survive instances, reject replay and wrong owners, and serialize refresh', {skip:!process.env.TEST_AUTH_DATABASE_URL},async()=>{
  const restore=configure();
  process.env.DATABASE_URL=process.env.TEST_AUTH_DATABASE_URL!;
  const sql=getSql();
  try {
    await initDatabase();
    await sql`TRUNCATE applyweave_auth_records,applyweave_sessions,applyweave_oauth_states`;
    let identity={sub:'owner-sub',email:'owner@example.com',email_verified:true};
    let refreshCount=0;
    const fetcher=(async(url:URL|string,init?:RequestInit)=>{
      if(String(url).includes('/userinfo'))return new Response(JSON.stringify(identity));
      const params=new URLSearchParams(String(init?.body));
      assert.equal(params.get('redirect_uri') || 'https://applyweave.example.com/api/auth/google/callback','https://applyweave.example.com/api/auth/google/callback');
      if(params.get('grant_type')==='refresh_token'){
        refreshCount++;
        await new Promise(resolve=>setTimeout(resolve,30));
        return new Response(JSON.stringify({access_token:'renewed-access',expires_in:3600}));
      }
      return new Response(JSON.stringify({access_token:'initial-access',refresh_token:'private-refresh-token',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/spreadsheets'}));
    }) as typeof fetch;
    const first=new GoogleOAuth('/unavailable-filesystem',fetcher),second=new GoogleOAuth('/unavailable-filesystem',fetcher);
    const binding=randomBytes(32).toString('base64url');
    const start=async()=>new URL(await first.start(false,binding)).searchParams.get('state')!;
    let state=await start();
    const pending=await sql`SELECT encrypted_value FROM applyweave_oauth_states`;
    assert.equal(pending[0].encrypted_value.includes('verifier'),false);
    await assert.rejects(second.callback('code',state,'wrong-binding','owner@example.com'),/another browser/);
    await assert.rejects(second.callback('code',state,binding,'owner@example.com'),/invalid/);
    state=await start();
    identity={sub:'wrong-sub',email:'wrong@example.com',email_verified:true};
    await assert.rejects(second.callback('code',state,binding,'wrong@example.com'),/owner account/);
    assert.equal(await first.token(),null);
    identity={sub:'owner-sub',email:'owner@example.com',email_verified:true};
    state=await start();
    const replay=await Promise.allSettled([first.callback('code',state,binding,''),second.callback('code',state,binding,'')]);
    assert.equal(replay.filter(v=>v.status==='fulfilled').length,1);
    const records=await sql`SELECT id,value FROM applyweave_auth_records`;
    assert.equal(records.find(r=>r.id==='token')!.value.includes('private-refresh-token'),false);
    const token=await second.token();assert.equal(token?.refreshToken,'private-refresh-token');
    await sql`UPDATE applyweave_auth_records SET value=${encryptSecret({...token,expiresAt:0},'google-token')} WHERE id='token'`;
    assert.deepEqual(await Promise.all([first.accessToken(),second.accessToken()]),['renewed-access','renewed-access']);
    assert.equal(refreshCount,1);
    identity={sub:'different-sub',email:'owner@example.com',email_verified:true};
    state=await start();
    await assert.rejects(second.callback('code',state,binding,''),/another Google identity/);
    let cookie='',options:Record<string,unknown>={};
    const response={cookie:(name:string,value:string,opts:Record<string,unknown>)=>{cookie=`${name}=${value}`;options=opts;},clearCookie:()=>{}} as unknown as Response;
    const a=new Sessions(),b=new Sessions();
    await a.create(response,{sub:'owner-sub',email:'owner@example.com'});
    assert.equal(options.secure,true);assert.equal(options.httpOnly,true);
    const request={get:(name:string)=>name==='cookie'?cookie:undefined} as unknown as Request;
    assert.deepEqual(await b.user(request),{sub:'owner-sub',email:'owner@example.com'});
    process.env.OWNER_EMAIL='changed-owner@example.com';
    assert.equal(await b.user(request),null);
    process.env.OWNER_EMAIL='owner@example.com';
    const sessions=await sql`SELECT token_hash FROM applyweave_sessions`;
    assert.equal(sessions[0].token_hash,createHash('sha256').update(cookie.split('=')[1]).digest('hex'));
    await b.destroy(request,response);assert.equal(await a.user(request),null);
    await first.disconnect();assert.equal(await second.token(),null);
    assert.equal((await sql`SELECT value FROM applyweave_auth_records WHERE id='owner'`).length,1);
    await sql`DELETE FROM applyweave_auth_records WHERE id='oauth-start-limit'`;
    const attempts=await Promise.allSettled(Array.from({length:21},()=>first.start(false,binding)));
    assert.equal(attempts.filter(a=>a.status==='fulfilled').length,20);
    const limited=attempts.find(a=>a.status==='rejected') as PromiseRejectedResult;
    assert.equal(limited.reason.code,'AUTH_RATE_LIMIT');
    assert.equal(Number((await sql`SELECT count(*) AS count FROM applyweave_oauth_states`)[0].count),20);
  } finally {await sql.end();restore();}
});
