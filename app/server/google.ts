import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './model.js';
import { writePrivateJson } from './store.js';
import type {VerifiedUser} from './auth.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REDIRECT_URI = 'http://127.0.0.1:4318/api/auth/google/callback';
const SCOPES = 'openid email https://www.googleapis.com/auth/spreadsheets';
const SCRIPT_SCOPE = 'https://www.googleapis.com/auth/script.projects';
export type GoogleConfig = {clientId:string; clientSecret:string; spreadsheetId:string};
type GoogleToken = {accessToken:string; refreshToken:string; expiresAt:number; email:string|null; sub?:string; scopes:string};
type PendingAuth = {state:string; verifier:string; browserBindingHash:string; expiresAt:number; requestedScopes:string};
type Fetcher = typeof fetch;

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
  async config():Promise<GoogleConfig|null> { return readOptional<GoogleConfig>(this.configPath); }
  async token():Promise<GoogleToken|null> { return readOptional<GoogleToken>(this.tokenPath); }
  async publicState() {
    const [config,token] = await Promise.all([this.config(),this.token()]);
    const install = await readOptional<{state:string;spreadsheetId:string}>(this.scriptInstallPath);
    return {googleConfigured:!!config, googleConnected:!!token?.refreshToken, googleEmail:token?.email || null, spreadsheetId:config?.spreadsheetId || '', scriptAuthorized:!!token?.scopes?.split(' ').includes(SCRIPT_SCOPE), scriptInstalled:install?.state === 'installed' && install.spreadsheetId === config?.spreadsheetId};
  }
  async configure(client:unknown, spreadsheetId:unknown):Promise<void> {
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
    this.pending.set(state,{state,verifier,browserBindingHash:createHash('sha256').update(browserBinding).digest('hex'),expiresAt:Date.now()+10*60*1000,requestedScopes});
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const previous=await this.token();
    const hasRequestedGrant=!!previous?.refreshToken && (!includeScript || previous.scopes.split(' ').includes(SCRIPT_SCOPE));
    const params = new URLSearchParams({client_id:config.clientId,redirect_uri:REDIRECT_URI,response_type:'code',scope:requestedScopes,access_type:'offline',prompt:hasRequestedGrant?'select_account':'consent',code_challenge:challenge,code_challenge_method:'S256',state});
    return `${AUTH_URL}?${params.toString()}`;
  }
  async callback(code:unknown, state:unknown, browserBinding:unknown, approvedEmail:unknown):Promise<VerifiedUser> {
    const prior=this.callbackGate;
    let release!:()=>void;
    this.callbackGate=new Promise<void>(resolve=>{release=resolve;});
    await prior;
    try{return await this.completeCallback(code,state,browserBinding,approvedEmail);}
    finally{release();}
  }
  private async completeCallback(code:unknown, state:unknown, browserBinding:unknown, approvedEmail:unknown):Promise<VerifiedUser> {
    const pending=typeof state==='string'?this.pending.get(state):undefined;
    if(typeof state==='string')this.pending.delete(state);
    const bindingHash=typeof browserBinding==='string'?createHash('sha256').update(browserBinding).digest('hex'):'';
    if (!pending || pending.expiresAt < Date.now() || typeof code !== 'string' || !code || !bindingHash || !timingSafeEqual(Buffer.from(bindingHash),Buffer.from(pending.browserBindingHash))) throw new AppError('Google authorization state is invalid, expired, or from another browser.',400,'OAUTH_STATE');
    const config = await this.config(); if (!config) throw new AppError('Google credentials disappeared.');
    const body = new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:REDIRECT_URI,grant_type:'authorization_code',code_verifier:pending.verifier});
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
    const owner=await readOptional<VerifiedUser>(this.ownerPath);
    if(owner && (owner.sub!==sub || owner.email!==email))throw new AppError('This ApplyWeave workspace is linked to another Google identity.',403,'OWNER_IDENTITY');
    const expected=typeof approvedEmail==='string'?approvedEmail.trim().toLowerCase():'';
    if(!owner && expected && email!==expected)throw new AppError('Sign in with the Google account matching the approved application email.',403,'OWNER_EMAIL');
    const oldToken=await this.token();
    const refreshToken=typeof value.refresh_token==='string'&&value.refresh_token?value.refresh_token:oldToken?.email?.toLowerCase()===email && (!oldToken.sub || oldToken.sub===sub)?oldToken.refreshToken:'';
    if(!refreshToken)throw new AppError('Google did not provide an offline refresh token. Reconnect and grant access.',502,'GOOGLE_AUTH');
    if(!owner)await writePrivateJson(this.ownerPath,{sub,email});
    await writePrivateJson(this.tokenPath,{accessToken:value.access_token,refreshToken,expiresAt:Date.now()+value.expires_in*1000,email,sub,scopes:typeof value.scope === 'string' ? value.scope : pending.requestedScopes});
    return {sub,email};
  }
  async accessToken():Promise<string> {
    const config = await this.config(), token = await this.token();
    if (!config || !token?.refreshToken) throw new AppError('Connect Google Sheets first.',400,'GOOGLE_NOT_CONNECTED');
    if (token.accessToken && token.expiresAt > Date.now()+60000) return token.accessToken;
    const body = new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:token.refreshToken,grant_type:'refresh_token'});
    const response = await this.fetcher(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new AppError('Google access expired. Reconnect the account.',502,'GOOGLE_AUTH');
    const value = await response.json() as Record<string,unknown>;
    if (typeof value.access_token !== 'string' || typeof value.expires_in !== 'number') throw new AppError('Google returned an invalid token response.',502,'GOOGLE_AUTH');
    const updated = {...token,accessToken:value.access_token,expiresAt:Date.now()+value.expires_in*1000};
    await writePrivateJson(this.tokenPath,updated);
    return updated.accessToken;
  }
  async disconnect():Promise<void> { this.pending.clear(); await rm(this.tokenPath,{force:true}); }
}
