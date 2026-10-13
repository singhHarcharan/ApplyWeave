import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './model.js';
import { writePrivateJson } from './store.js';
import type {VerifiedUser} from './auth.js';
import type postgres from 'postgres';
import {getSql} from './db.js';
import {isHosted, googleRedirectUri, tokenEncryptionKey, encryptSecret, decryptSecret} from './hosted-config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = 'openid email https://www.googleapis.com/auth/spreadsheets';
const SCRIPT_SCOPE = 'https://www.googleapis.com/auth/script.projects';
export type GoogleConfig = {clientId:string; clientSecret:string; spreadsheetId:string};
type GoogleToken = {accessToken:string; refreshToken:string; expiresAt:number; email:string|null; sub?:string; scopes:string};
type PendingAuth = {state:string; verifier:string; browserBindingHash:string; expiresAt:number; requestedScopes:string};
type Fetcher = typeof fetch;
type AuthSql = postgres.Sql | postgres.TransactionSql;

async function readOptional<T>(filename:string):Promise<T|null> {
  try { return JSON.parse(await readFile(filename,'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export class GoogleOAuth {
  private pending = new Map<string,PendingAuth>();
  private callbackGate:Promise<void> = Promise.resolve();
  constructor(private privateDir:string, private fetcher:Fetcher = fetch) {}
  get configPath() { return path.join(this.privateDir,'google-oauth-client.json'); }
  get tokenPath() { return path.join(this.privateDir,'google-oauth-token.json'); }
  get ownerPath() { return path.join(this.privateDir,'google-owner.json'); }
  get scriptInstallPath() { return path.join(this.privateDir,'google-apps-script-install.json'); }
  async config():Promise<GoogleConfig|null> {
    if(!isHosted())return readOptional<GoogleConfig>(this.configPath);
    googleRedirectUri();tokenEncryptionKey();
    const clientId=process.env.GOOGLE_CLIENT_ID || '', clientSecret=process.env.GOOGLE_CLIENT_SECRET || '', spreadsheetId=process.env.GOOGLE_SPREADSHEET_ID || '';
    if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret || !/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(process.env.OWNER_EMAIL || ''))throw new AppError('Set the hosted Google Web OAuth client, Sheet ID, and OWNER_EMAIL.',503,'HOSTED_CONFIG');
    return {clientId,clientSecret,spreadsheetId};
  }
  private async record(id:string,sql:AuthSql):Promise<string|null> {
    const rows=await sql`SELECT value FROM applyweave_auth_records WHERE id=${id}`;
    return rows[0]?.value ?? null;
  }
  private async saveRecord(id:string,value:string,sql:AuthSql):Promise<void> {
    await sql`INSERT INTO applyweave_auth_records(id,value) VALUES(${id},${value}) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value`;
  }
  async token(sql?:AuthSql):Promise<GoogleToken|null> {
    if(!isHosted())return readOptional<GoogleToken>(this.tokenPath);
    const value=await this.record('token',sql || getSql());
    return value ? decryptSecret<GoogleToken>(value,'google-token') : null;
  }
  private async saveToken(token:GoogleToken,sql?:AuthSql):Promise<void> {
    if(isHosted())await this.saveRecord('token',encryptSecret(token,'google-token'),sql || getSql());
    else await writePrivateJson(this.tokenPath,token);
  }
  async publicState() {
    const [config,token] = await Promise.all([this.config(),this.token()]);
    const install = isHosted()?null:await readOptional<{state:string;spreadsheetId:string}>(this.scriptInstallPath);
    return {googleConfigured:!!config, googleConnected:!!token?.refreshToken, googleEmail:token?.email || null, spreadsheetId:config?.spreadsheetId || '', scriptAuthorized:!!token?.scopes?.split(' ').includes(SCRIPT_SCOPE), scriptInstalled:install?.state === 'installed' && install.spreadsheetId === config?.spreadsheetId};
  }
  async configure(client:unknown, spreadsheetId:unknown):Promise<void> {
    if(isHosted())throw new AppError('Hosted Google credentials are managed in deployment environment variables.',403,'HOSTED_CONFIG');
    if (!client || typeof client !== 'object' || !('installed' in client)) throw new AppError('Import a Google OAuth Desktop client JSON file.');
    const installed = (client as {installed:Record<string,unknown>}).installed;
    if (!installed || typeof installed !== 'object') throw new AppError('Invalid Desktop OAuth client.');
    const clientId = installed.client_id, clientSecret = installed.client_secret;
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || typeof clientSecret !== 'string' || !clientSecret || typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) throw new AppError('Invalid OAuth client ID, secret, or spreadsheet ID.');
    const previous = await this.config();
    await writePrivateJson(this.configPath,{clientId,clientSecret,spreadsheetId});
    await rm(this.tokenPath,{force:true});
    if (previous?.spreadsheetId !== spreadsheetId) await rm(this.scriptInstallPath,{force:true});
  }
  async start(includeScript:boolean,browserBinding:string):Promise<string> {
    const config = await this.config(); if (!config) throw new AppError('Import Google Desktop OAuth credentials first.',400,'GOOGLE_NOT_CONFIGURED');
    if(!/^[A-Za-z0-9_-]{30,128}$/.test(browserBinding))throw new AppError('Browser authorization binding is invalid.',400,'OAUTH_BINDING');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(64).toString('base64url');
    const requestedScopes = includeScript ? `${SCOPES} ${SCRIPT_SCOPE}` : SCOPES;
    for(const [key,pending] of this.pending)if(pending.expiresAt<Date.now())this.pending.delete(key);
    if(this.pending.size>=8)this.pending.delete(this.pending.keys().next().value!);
    const pending={state,verifier,browserBindingHash:createHash('sha256').update(browserBinding).digest('hex'),expiresAt:Date.now()+10*60*1000,requestedScopes};
    if(isHosted()) {
      const sql=getSql(),hash=createHash('sha256').update(state).digest('hex');
      await sql.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(193701,2)`;
        const now=Date.now(),raw=await this.record('oauth-start-limit',tx);
        const stored=raw?JSON.parse(raw) as {start:number;count:number}:null;
        const rate=stored && now-stored.start<60000?stored:{start:now,count:0};
        if(rate.count>=20)throw new AppError('Too many Google sign-in attempts. Wait a minute and try again.',429,'AUTH_RATE_LIMIT');
        await tx`DELETE FROM applyweave_oauth_states WHERE expires_at<=${now}`;
        const count=await tx`SELECT count(*)::int AS count FROM applyweave_oauth_states`;
        if(count[0].count>=64)throw new AppError('Too many pending Google sign-ins. Complete an existing sign-in or try again in ten minutes.',429,'AUTH_RATE_LIMIT');
        await this.saveRecord('oauth-start-limit',JSON.stringify({...rate,count:rate.count+1}),tx);
        await tx`INSERT INTO applyweave_oauth_states(state_hash,encrypted_value,expires_at) VALUES(${hash},${encryptSecret(pending,`oauth-state:${hash}`)},${pending.expiresAt})`;
      });
    } else this.pending.set(state,pending);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const previous=await this.token();
    const hasRequestedGrant=!!previous?.refreshToken && (!includeScript || previous.scopes.split(' ').includes(SCRIPT_SCOPE));
    const params = new URLSearchParams({client_id:config.clientId,redirect_uri:googleRedirectUri(),response_type:'code',scope:requestedScopes,access_type:'offline',prompt:hasRequestedGrant?'select_account':'consent',code_challenge:challenge,code_challenge_method:'S256',state});
    return `${AUTH_URL}?${params.toString()}`;
  }
  async callback(code:unknown, state:unknown, browserBinding:unknown, approvedEmail:unknown):Promise<VerifiedUser> {
    if(isHosted()) {
      const pending=await this.takePending(state);
      this.validatePending(pending,code,browserBinding);
      return await getSql().begin(async sql=>{
        await sql`SELECT pg_advisory_xact_lock(193701,1)`;
        return await this.completeCallback(code,state,browserBinding,approvedEmail,sql,pending);
      }) as VerifiedUser;
    }
    const prior=this.callbackGate;
    let release!:()=>void;
    this.callbackGate=new Promise<void>(resolve=>{release=resolve;});
    await prior;
    try{return await this.completeCallback(code,state,browserBinding,approvedEmail);}
    finally{release();}
  }
  private async takePending(state:unknown):Promise<PendingAuth|undefined> {
    if(typeof state!=='string')return undefined;
    if(isHosted()) {
      if(!/^[A-Za-z0-9_-]{43}$/.test(state))return undefined;
      const sql=getSql(),hash=createHash('sha256').update(state).digest('hex');
      const rows=await sql`DELETE FROM applyweave_oauth_states WHERE state_hash=${hash} RETURNING encrypted_value`;
      return rows.length?decryptSecret<PendingAuth>(rows[0].encrypted_value,`oauth-state:${hash}`):undefined;
    }
    const pending=this.pending.get(state);this.pending.delete(state);return pending;
  }
  private validatePending(pending:PendingAuth|undefined,code:unknown,browserBinding:unknown):asserts pending is PendingAuth {
    const bindingHash=typeof browserBinding==='string'?createHash('sha256').update(browserBinding).digest('hex'):'';
    if (!pending || pending.expiresAt < Date.now() || typeof code !== 'string' || !code || !bindingHash || !timingSafeEqual(Buffer.from(bindingHash),Buffer.from(pending.browserBindingHash))) throw new AppError('Google authorization state is invalid, expired, or from another browser.',400,'OAUTH_STATE');
  }
  private async completeCallback(code:unknown, state:unknown, browserBinding:unknown, approvedEmail:unknown,sql?:AuthSql,consumedPending?:PendingAuth):Promise<VerifiedUser> {
    const pending=consumedPending || await this.takePending(state);
    this.validatePending(pending,code,browserBinding);
    const config = await this.config(); if (!config) throw new AppError('Google credentials disappeared.');
    const body = new URLSearchParams({code:code as string,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:googleRedirectUri(),grant_type:'authorization_code',code_verifier:pending.verifier});
    const response = await this.fetcher(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new AppError('Google rejected the authorization code.',502,'GOOGLE_AUTH');
    const value = await response.json() as Record<string,unknown>;
    if (typeof value.access_token !== 'string' || typeof value.expires_in !== 'number') throw new AppError('Google returned an invalid token response.',502,'GOOGLE_AUTH');
    const info = await this.fetcher(USERINFO_URL,{headers:{Authorization:`Bearer ${value.access_token}`},signal:AbortSignal.timeout(30000)});
    if(!info.ok)throw new AppError('Google could not verify the signed-in account.',502,'GOOGLE_IDENTITY');
    const identity=await info.json() as Record<string,unknown>;
    const sub=typeof identity.sub==='string'?identity.sub.trim():'';
    const email=typeof identity.email==='string'?identity.email.trim().toLowerCase():'';
    if(!sub || !email || identity.email_verified!==true)throw new AppError('Google did not confirm a verified email and account identity.',403,'GOOGLE_IDENTITY');
    const ownerValue=sql?await this.record('owner',sql):null;
    const owner=sql?(ownerValue?JSON.parse(ownerValue) as VerifiedUser:null):await readOptional<VerifiedUser>(this.ownerPath);
    if(owner && (owner.sub!==sub || owner.email!==email))throw new AppError('This ApplyWeave workspace is linked to another Google identity.',403,'OWNER_IDENTITY');
    const expected=isHosted()?process.env.OWNER_EMAIL!.trim().toLowerCase():typeof approvedEmail==='string'?approvedEmail.trim().toLowerCase():'';
    if(isHosted() && email!==expected)throw new AppError('Sign in with the configured workspace owner account.',403,'OWNER_EMAIL');
    if(!owner && expected && email!==expected)throw new AppError('Sign in with the Google account matching the approved application email.',403,'OWNER_EMAIL');
    const oldToken=await this.token(sql);
    const refreshToken=typeof value.refresh_token==='string'&&value.refresh_token?value.refresh_token:oldToken?.email?.toLowerCase()===email && (!oldToken.sub || oldToken.sub===sub)?oldToken.refreshToken:'';
    if(!refreshToken)throw new AppError('Google did not provide an offline refresh token. Reconnect and grant access.',502,'GOOGLE_AUTH');
    if(!owner) {
      if(sql)await this.saveRecord('owner',JSON.stringify({sub,email}),sql);
      else await writePrivateJson(this.ownerPath,{sub,email});
    }
    await this.saveToken({accessToken:value.access_token,refreshToken,expiresAt:Date.now()+value.expires_in*1000,email,sub,scopes:typeof value.scope === 'string' ? value.scope : pending.requestedScopes},sql);
    return {sub,email};
  }
  async accessToken():Promise<string> {
    if(isHosted())return await getSql().begin(async sql=>{
      await sql`SELECT pg_advisory_xact_lock(193701,1)`;
      return this.refreshAccessToken(sql);
    }) as string;
    return this.refreshAccessToken();
  }
  private async refreshAccessToken(sql?:AuthSql):Promise<string> {
    const config = await this.config(), token = await this.token(sql);
    if (!config || !token?.refreshToken) throw new AppError('Connect Google Sheets first.',400,'GOOGLE_NOT_CONNECTED');
    if (token.accessToken && token.expiresAt > Date.now()+60000) return token.accessToken;
    const body = new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:token.refreshToken,grant_type:'refresh_token'});
    const response = await this.fetcher(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new AppError('Google access expired. Reconnect the account.',502,'GOOGLE_AUTH');
    const value = await response.json() as Record<string,unknown>;
    if (typeof value.access_token !== 'string' || typeof value.expires_in !== 'number') throw new AppError('Google returned an invalid token response.',502,'GOOGLE_AUTH');
    const updated = {...token,accessToken:value.access_token,refreshToken:typeof value.refresh_token==='string'&&value.refresh_token?value.refresh_token:token.refreshToken,expiresAt:Date.now()+value.expires_in*1000};
    await this.saveToken(updated,sql);
    return updated.accessToken;
  }
  async disconnect():Promise<void> {
    this.pending.clear();
    if(isHosted())await getSql().begin(async sql=>{
      await sql`SELECT pg_advisory_xact_lock(193701,1)`;
      await sql`DELETE FROM applyweave_auth_records WHERE id='token'`;
      await sql`DELETE FROM applyweave_oauth_states`;
    });
    else await rm(this.tokenPath,{force:true});
  }
}
