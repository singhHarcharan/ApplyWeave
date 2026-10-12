import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './model.js';
import { writePrivateJson } from './store.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REDIRECT_URI = 'http://127.0.0.1:4318/api/auth/google/callback';
const SCOPES = 'openid email https://www.googleapis.com/auth/spreadsheets';
const SCRIPT_SCOPE = 'https://www.googleapis.com/auth/script.projects';
export type GoogleConfig = {clientId:string; clientSecret:string; spreadsheetId:string};
type GoogleToken = {accessToken:string; refreshToken:string; expiresAt:number; email:string|null; scopes:string};
type PendingAuth = {state:string; verifier:string; expiresAt:number; requestedScopes:string};
type Fetcher = typeof fetch;

async function readOptional<T>(filename:string):Promise<T|null> {
  try { return JSON.parse(await readFile(filename,'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export class GoogleOAuth {
  private pending: PendingAuth|null = null;
  constructor(private privateDir:string, private fetcher:Fetcher = fetch) {}
  get configPath() { return path.join(this.privateDir,'google-oauth-client.json'); }
  get tokenPath() { return path.join(this.privateDir,'google-oauth-token.json'); }
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
  async start(includeScript = false):Promise<string> {
    const config = await this.config(); if (!config) throw new AppError('Import Google Desktop OAuth credentials first.',400,'GOOGLE_NOT_CONFIGURED');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(64).toString('base64url');
    const requestedScopes = includeScript ? `${SCOPES} ${SCRIPT_SCOPE}` : SCOPES;
    this.pending = {state,verifier,expiresAt:Date.now()+10*60*1000,requestedScopes};
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({client_id:config.clientId,redirect_uri:REDIRECT_URI,response_type:'code',scope:requestedScopes,access_type:'offline',prompt:'consent',code_challenge:challenge,code_challenge_method:'S256',state});
    return `${AUTH_URL}?${params.toString()}`;
  }
  async callback(code:unknown, state:unknown):Promise<void> {
    const pending = this.pending; this.pending = null;
    if (!pending || pending.expiresAt < Date.now() || typeof state !== 'string' || state !== pending.state || typeof code !== 'string' || !code) throw new AppError('Google authorization state is invalid or expired.',400,'OAUTH_STATE');
    const config = await this.config(); if (!config) throw new AppError('Google credentials disappeared.');
    const body = new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:REDIRECT_URI,grant_type:'authorization_code',code_verifier:pending.verifier});
    const response = await this.fetcher(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
    if (!response.ok) throw new AppError('Google rejected the authorization code.',502,'GOOGLE_AUTH');
    const value = await response.json() as Record<string,unknown>;
    if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string' || typeof value.expires_in !== 'number') throw new AppError('Google did not provide an offline refresh token. Reconnect and grant access.',502,'GOOGLE_AUTH');
    let email:string|null = null;
    const info = await this.fetcher(USERINFO_URL,{headers:{Authorization:`Bearer ${value.access_token}`}});
    if (info.ok) { const user = await info.json() as Record<string,unknown>; if (typeof user.email === 'string') email = user.email; }
    await writePrivateJson(this.tokenPath,{accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt:Date.now()+value.expires_in*1000,email,scopes:typeof value.scope === 'string' ? value.scope : pending.requestedScopes});
  }
  async accessToken():Promise<string> {
    const config = await this.config(), token = await this.token();
    if (!config || !token?.refreshToken) throw new AppError('Connect Google Sheets first.',400,'GOOGLE_NOT_CONNECTED');
    if (token.accessToken && token.expiresAt > Date.now()+60000) return token.accessToken;
    const body = new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:token.refreshToken,grant_type:'refresh_token'});
    const response = await this.fetcher(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
    if (!response.ok) throw new AppError('Google access expired. Reconnect the account.',502,'GOOGLE_AUTH');
    const value = await response.json() as Record<string,unknown>;
    if (typeof value.access_token !== 'string' || typeof value.expires_in !== 'number') throw new AppError('Google returned an invalid token response.',502,'GOOGLE_AUTH');
    const updated = {...token,accessToken:value.access_token,expiresAt:Date.now()+value.expires_in*1000};
    await writePrivateJson(this.tokenPath,updated);
    return updated.accessToken;
  }
  async disconnect():Promise<void> { this.pending = null; await rm(this.tokenPath,{force:true}); }
}
