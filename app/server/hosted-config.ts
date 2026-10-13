import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {AppError} from './model.js';

export function isHosted():boolean {
  return process.env.APPLYWEAVE_MODE==='hosted' || !!process.env.VERCEL || (!!process.env.APP_ORIGIN && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.APP_ORIGIN));
}
export function hostedOrigin():string {
  const raw=process.env.APP_ORIGIN || '';
  let origin:URL;
  try {origin=new URL(raw);} catch {throw new AppError('Set APP_ORIGIN to the deployed HTTPS origin.',503,'HOSTED_CONFIG');}
  if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash)throw new AppError('APP_ORIGIN must be an HTTPS origin without a path.',503,'HOSTED_CONFIG');
  return origin.origin;
}
export function googleRedirectUri():string {
  if(!isHosted())return 'http://127.0.0.1:4318/api/auth/google/callback';
  const expected=`${hostedOrigin()}/api/auth/google/callback`;
  if(process.env.GOOGLE_REDIRECT_URI!==expected)throw new AppError('GOOGLE_REDIRECT_URI must match APP_ORIGIN with /api/auth/google/callback.',503,'HOSTED_CONFIG');
  return expected;
}
export function tokenEncryptionKey():Buffer {
  const value=process.env.TOKEN_ENCRYPTION_KEY || '';
  const bytes=/^[a-fA-F0-9]{64}$/.test(value)?Buffer.from(value,'hex'):/^[A-Za-z0-9+/]{43}=$/.test(value)?Buffer.from(value,'base64'):Buffer.alloc(0);
  if(bytes.length!==32)throw new AppError('Set TOKEN_ENCRYPTION_KEY to a random 32-byte key encoded as base64 or hex.',503,'HOSTED_CONFIG');
  return bytes;
}
export function encryptSecret(value:unknown,purpose:string):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',tokenEncryptionKey(),iv);
  cipher.setAAD(Buffer.from(`applyweave:${purpose}:v1`));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptSecret<T>(value:string,purpose:string):T {
  try {
    const [version,iv,tag,body,...rest]=value.split('.');
    if(version!=='v1'||!iv||!tag||!body||rest.length)throw new Error('Invalid ciphertext');
    const decipher=createDecipheriv('aes-256-gcm',tokenEncryptionKey(),Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from(`applyweave:${purpose}:v1`));
    decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8')) as T;
  } catch {throw new AppError('Stored Google credentials could not be decrypted. Check the deployment encryption key.',503,'CREDENTIAL_STORAGE');}
}
