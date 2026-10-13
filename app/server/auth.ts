import {createHash, randomBytes} from 'node:crypto';
import type {Request,Response} from 'express';
import {getSql} from './db.js';
import {isHosted} from './hosted-config.js';

export type VerifiedUser = {sub:string;email:string};
type Session = {user:VerifiedUser;expiresAt:number};
const SESSION_AGE_MS = 7*24*60*60*1000;
export const SESSION_COOKIE = 'aw_session';
export const OAUTH_BIND_COOKIE = 'aw_oauth_bind';
const key = (token:string) => createHash('sha256').update(token).digest('hex');

export function cookieValue(req:Request,name:string):string|null {
  const header=req.get('cookie') || '';
  for(const pair of header.split(';')) {
    const index=pair.indexOf('=');
    if(index<0 || pair.slice(0,index).trim()!==name)continue;
    const value=pair.slice(index+1).trim();
    return /^[A-Za-z0-9_-]{20,128}$/.test(value)?value:null;
  }
  return null;
}
export function clearOAuthBinding(res:Response):void {
  res.clearCookie(OAUTH_BIND_COOKIE,{httpOnly:true,sameSite:'lax',secure:isHosted(),path:'/api/auth/google/callback'});
}
export class Sessions {
  private sessions=new Map<string,Session>();
  async user(req:Request):Promise<VerifiedUser|null> {
    const token=cookieValue(req,SESSION_COOKIE);
    if(!token)return null;
    if(isHosted()) {
      const sql=getSql();
      const rows=await sql`SELECT user_json FROM applyweave_sessions WHERE token_hash=${key(token)} AND expires_at>${Date.now()}`;
      const user=rows.length?rows[0].user_json as VerifiedUser:null;
      return user?.sub && user.email===process.env.OWNER_EMAIL?.trim().toLowerCase()?user:null;
    }
    const session=this.sessions.get(key(token));
    if(!session)return null;
    if(session.expiresAt<=Date.now()){this.sessions.delete(key(token));return null;}
    return session.user;
  }
  async create(res:Response,user:VerifiedUser):Promise<void> {
    const token=randomBytes(32).toString('base64url');
    if(isHosted()) {
      const sql=getSql();
      await sql`DELETE FROM applyweave_sessions WHERE expires_at<=${Date.now()}`;
      await sql`INSERT INTO applyweave_sessions(token_hash,user_json,expires_at) VALUES(${key(token)},${sql.json(user)},${Date.now()+SESSION_AGE_MS})`;
    } else this.sessions.set(key(token),{user,expiresAt:Date.now()+SESSION_AGE_MS});
    res.cookie(SESSION_COOKIE,token,{httpOnly:true,sameSite:'lax',secure:isHosted(),path:'/api',maxAge:SESSION_AGE_MS});
  }
  async destroy(req:Request,res:Response):Promise<void> {
    const token=cookieValue(req,SESSION_COOKIE);
    if(token) {
      if(isHosted()) {const sql=getSql();await sql`DELETE FROM applyweave_sessions WHERE token_hash=${key(token)}`;}
      else this.sessions.delete(key(token));
    }
    res.clearCookie(SESSION_COOKIE,{httpOnly:true,sameSite:'lax',secure:isHosted(),path:'/api'});
  }
}
