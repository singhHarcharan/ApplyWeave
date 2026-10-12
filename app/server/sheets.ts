import { createHash } from 'node:crypto';
import type { Application, ProfileExport } from '../shared/types.js';
import { AppError, validateProfile } from './model.js';
import type { Workspace } from './store.js';
import { GoogleOAuth } from './google.js';

export const APPLICATION_HEADERS = [
  'Application ID','Company','Job Title','Role Family','Source','Job URL','Location','Work Mode',
  'Compensation (LPA)','Date Saved','Date Applied','Status','Resume Version','Answer Pack ID',
  'Next Action','Due Date','Last Updated','Recruiter / Contact','Response Date','Interview Date',
  'Outcome / Reason','Notes'
];
type Cell = string|number|boolean;
export type RemoteRow = {rowNumber:number; values:Cell[]};
export interface SheetsGateway {
  readRows():Promise<RemoteRow[]>;
  updateRow(rowNumber:number,values:Cell[]):Promise<void>;
  appendRow(values:Cell[]):Promise<void>;
  readProfile?():Promise<ProfileExport|null>;
}
type Fetcher = typeof fetch;
export class GoogleSheetsClient implements SheetsGateway {
  constructor(private oauth:GoogleOAuth, private fetcher:Fetcher = fetch) {}
  private async request(method:string,range:string,query:Record<string,string> = {},body?:unknown):Promise<Record<string,unknown>> {
    const config = await this.oauth.config(); if (!config) throw new AppError('Google Sheets is not configured.',400,'GOOGLE_NOT_CONFIGURED');
    const append = range.endsWith(':append');
    const encodedRange = encodeURIComponent(append ? range.slice(0,-7) : range);
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodedRange}${append ? ':append' : ''}`);
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
    const response = await this.fetcher(url,{method,headers:{Authorization:`Bearer ${await this.oauth.accessToken()}`,...(body ? {'content-type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
    if (!response.ok) {
      const raw = await response.text();
      throw new AppError(`Google Sheets request failed (${response.status}): ${raw.slice(0,300)}`,502,'GOOGLE_SHEETS');
    }
    return response.json() as Promise<Record<string,unknown>>;
  }
  async readRows():Promise<RemoteRow[]> {
    const body = await this.request('GET',"'Applications'!A1:W",{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
    const values = Array.isArray(body.values) ? body.values as Cell[][] : [];
    if (APPLICATION_HEADERS.some((header,i) => values[0]?.[i] !== header)) throw new AppError('Applications sheet headers differ from ApplyWeave. Run the tracker setup or select the correct spreadsheet.',409,'SHEET_HEADERS');
    return values.slice(1).map((row,i) => ({rowNumber:i+2,values:row.slice(0,22)})).filter(row => String(row.values[0] || '').trim());
  }
  async updateRow(rowNumber:number,values:Cell[]):Promise<void> {
    const range = `'Applications'!A${rowNumber}:V${rowNumber}`;
    await this.request('PUT',range,{valueInputOption:'RAW'},{range,majorDimension:'ROWS',values:[values]});
  }
  async appendRow(values:Cell[]):Promise<void> {
    const range = "'Applications'!A:V:append";
    await this.request('POST',range,{valueInputOption:'RAW',insertDataOption:'INSERT_ROWS'},{majorDimension:'ROWS',values:[values]});
  }
  async readProfile():Promise<ProfileExport|null> {
    const body = await this.request('GET',"'Profile & Answers'!A1:G",{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
    const values = Array.isArray(body.values) ? body.values as Cell[][] : [];
    const header = ['Type','Key / Fact ID','Value / Approved Wording','Source','Approved','Last Reviewed','Supporting Fact IDs'];
    if (header.some((cell,i) => values[0]?.[i] !== cell)) throw new AppError('Profile & Answers sheet headers differ from ApplyWeave.',409,'SHEET_HEADERS');
    const profile:ProfileExport = {schemaVersion:1,profileVersion:'',personal:{},facts:[],standardAnswers:[],resumeVersions:[]};
    let count = 0;
    for (const row of values.slice(1)) {
      if (row[4] !== true || !row[1] || !row[2]) continue;
      count++;
      const type=row[0], key=row[1], value=row[2], source=row[3], factIds=row[6];
      if (type === 'Contact') profile.personal[String(key)] = String(value);
      else if (type === 'Fact') profile.facts.push({id:String(key),claim:String(value),source:String(source || 'Approved Sheet row')});
      else if (type === 'Standard answer') profile.standardAnswers.push({key:String(key),text:String(value),factIds:String(factIds || '').split(',').map(s=>s.trim()).filter(Boolean)});
      else if (type === 'Resume') profile.resumeVersions.push({id:String(key),filename:String(value)});
      else throw new AppError(`Unknown approved profile row type ${type}.`,409,'SHEET_DATA');
    }
    return count ? validateProfile(profile) : null;
  }
}

const EPOCH = Date.UTC(1899,11,30);
const DAY = 86400000;
function serialDate(iso:string):number|string { return iso ? (Date.parse(`${iso}T00:00:00Z`)-EPOCH)/DAY : ''; }
function serialTimestamp(iso:string):number|string { return iso ? (Date.parse(iso)-EPOCH)/DAY : ''; }
function isoDate(value:Cell|undefined):string {
  if (typeof value === 'number') {
    const date = new Date(EPOCH+Math.round(value)*DAY);
    if (Number.isNaN(date.getTime())) throw new AppError('Sheet contains an invalid date.',409,'SHEET_DATA');
    return date.toISOString().slice(0,10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0,10);
  return '';
}
function isoTimestamp(value:Cell|undefined):string {
  if (typeof value === 'number') {
    const date = new Date(EPOCH+Math.round(value*DAY));
    if (Number.isNaN(date.getTime())) throw new AppError('Sheet contains an invalid timestamp.',409,'SHEET_DATA');
    return date.toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date(0).toISOString();
}
const str = (v:Cell|undefined) => v === undefined || v === null ? '' : String(v);
export function remoteToApplication(row:RemoteRow):Application {
  const r = row.values;
  const status = str(r[11]);
  if (!/^AW-\d{8}-[A-Z0-9]{6}$/.test(str(r[0]))) throw new AppError(`Invalid Application ID in Sheet row ${row.rowNumber}.`,409,'SHEET_DATA');
  if (!str(r[1]).trim() || !str(r[2]).trim()) throw new AppError(`Company and title are missing in Sheet row ${row.rowNumber}.`,409,'SHEET_DATA');
  if (!['Saved','Preparing','Applied','Assessment','Interview','Offer','Rejected','Withdrawn'].includes(status)) throw new AppError(`Invalid status in Sheet row ${row.rowNumber}.`,409,'SHEET_DATA');
  const compensation = r[8] === undefined || r[8] === '' ? null : Number(r[8]);
  if (compensation !== null && (!Number.isFinite(compensation) || compensation < 0)) throw new AppError(`Invalid compensation in Sheet row ${row.rowNumber}.`,409,'SHEET_DATA');
  if (!isoDate(r[9])) throw new AppError(`Date saved is missing in Sheet row ${row.rowNumber}.`,409,'SHEET_DATA');
  return {
    applicationId:str(r[0]),company:str(r[1]),title:str(r[2]),roleFamily:str(r[3]),source:str(r[4]),jobUrl:str(r[5]),
    location:str(r[6]),workMode:str(r[7]) || 'Unknown',compensationLpa:compensation,
    dateSaved:isoDate(r[9]),dateApplied:isoDate(r[10]),status:status as Application['status'],resumeVersion:str(r[12]),
    answerPackId:str(r[13]),nextAction:str(r[14]),dueDate:isoDate(r[15]),lastUpdated:isoTimestamp(r[16]),
    recruiter:str(r[17]),responseDate:isoDate(r[18]),interviewDate:isoDate(r[19]),outcome:str(r[20]),notes:str(r[21]),
    jobDescription:'',syncStatus:'synced'
  };
}
export function applicationToRow(a:Application):Cell[] {
  return [a.applicationId,a.company,a.title,a.roleFamily,a.source,a.jobUrl,a.location,a.workMode,a.compensationLpa ?? '',
    serialDate(a.dateSaved),serialDate(a.dateApplied),a.status,a.resumeVersion,a.answerPackId,a.nextAction,serialDate(a.dueDate),
    serialTimestamp(a.lastUpdated),a.recruiter,serialDate(a.responseDate),serialDate(a.interviewDate),a.outcome,a.notes];
}
const normalizedRow = (values:Cell[]) => Array.from({length:22},(_,i) => values[i] === undefined || values[i] === null ? '' : values[i]);
export const rowHash = (values:Cell[]) => createHash('sha256').update(JSON.stringify(normalizedRow(values))).digest('hex');
export const profileContentHash = (profile:ProfileExport|null) => {
  if (!profile) return null;
  const personal = Object.fromEntries(Object.entries(profile.personal).sort(([a],[b])=>a.localeCompare(b)));
  const facts = profile.facts.map(f=>({id:f.id,claim:f.claim,source:f.source})).sort((a,b)=>a.id.localeCompare(b.id));
  const standardAnswers = profile.standardAnswers.map(a=>({key:a.key,text:a.text,factIds:[...a.factIds].sort()})).sort((a,b)=>a.key.localeCompare(b.key));
  const resumeVersions = profile.resumeVersions.map(r=>({id:r.id,filename:r.filename})).sort((a,b)=>a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify({personal,facts,standardAnswers,resumeVersions})).digest('hex');
};
function sameApplication(local:Application, remote:Application):boolean {
  const keys: Array<keyof Application> = ['applicationId','company','title','roleFamily','source','jobUrl','location','workMode','compensationLpa','dateSaved','dateApplied','status','resumeVersion','answerPackId','nextAction','dueDate','recruiter','responseDate','interviewDate','outcome','notes'];
  return keys.every(key => local[key] === remote[key]);
}

/** Synchronize in place under the store lock. A pending row is written only if the remote row still matches its last read baseline. */
export async function syncWorkspace(workspace:Workspace,gateway:SheetsGateway):Promise<{synced:number;conflicts:Array<{applicationId:string;message:string}>;lastSyncedAt:string}> {
  let rows = await gateway.readRows();
  const remoteById = new Map<string,RemoteRow>();
  for (const row of rows) {
    const id = String(row.values[0]);
    if (remoteById.has(id)) throw new AppError(`Sheet contains duplicate Application ID ${id}. Resolve it before syncing.`,409,'SHEET_DUPLICATE');
    remoteById.set(id,row);
  }
  const conflicts: Array<{applicationId:string;message:string}> = [];
  let synced = 0;
  for (const app of workspace.applications) {
    const remote = remoteById.get(app.applicationId);
    const baseline = workspace.remoteRows[app.applicationId];
    if (app.syncStatus === 'conflict') { conflicts.push({applicationId:app.applicationId,message:'Choose local or remote before syncing this role.'}); continue; }
    if (app.syncStatus === 'pending') {
      if (remote) {
        const remoteApp = remoteToApplication(remote);
        if (sameApplication(app,remoteApp)) { app.syncStatus = 'synced'; workspace.remoteRows[app.applicationId] = rowHash(remote.values); synced++; continue; }
        if (!baseline || rowHash(remote.values) !== baseline) { app.syncStatus = 'conflict'; conflicts.push({applicationId:app.applicationId,message:'This role changed in Google Sheets while local edits were pending.'}); continue; }
        // Re-read immediately before the write; a changed row is a conflict, not a blind overwrite.
        rows = await gateway.readRows();
        const fresh = rows.find(r => String(r.values[0]) === app.applicationId);
        if (!fresh || rowHash(fresh.values) !== baseline) { app.syncStatus = 'conflict'; conflicts.push({applicationId:app.applicationId,message:'This role changed in Google Sheets before upload.'}); continue; }
        await gateway.updateRow(fresh.rowNumber,applicationToRow(app));
      } else {
        if (baseline) { app.syncStatus = 'conflict'; conflicts.push({applicationId:app.applicationId,message:'This role was removed from Google Sheets.'}); continue; }
        rows = await gateway.readRows();
        if (rows.some(r => String(r.values[0]) === app.applicationId)) { app.syncStatus = 'conflict'; conflicts.push({applicationId:app.applicationId,message:'This role appeared in Google Sheets before upload.'}); continue; }
        await gateway.appendRow(applicationToRow(app));
      }
      const verified = (await gateway.readRows()).find(r => String(r.values[0]) === app.applicationId);
      if (!verified || !sameApplication(app,remoteToApplication(verified))) throw new AppError(`Could not verify sync for ${app.applicationId}; local changes remain pending.`,502,'SYNC_VERIFY');
      app.syncStatus = 'synced'; workspace.remoteRows[app.applicationId] = rowHash(verified.values); synced++;
    } else if (remote) {
      const hash = rowHash(remote.values);
      if (hash !== baseline) {
        const preservedDescription = app.jobDescription;
        Object.assign(app,remoteToApplication(remote),{jobDescription:preservedDescription});
        workspace.remoteRows[app.applicationId] = hash;
        synced++;
      }
    } else if (baseline) {
      app.syncStatus = 'conflict'; conflicts.push({applicationId:app.applicationId,message:'This role was removed from Google Sheets.'});
    }
  }
  const localIds = new Set(workspace.applications.map(a => a.applicationId));
  rows = await gateway.readRows();
  for (const row of rows) {
    const id = String(row.values[0]);
    if (localIds.has(id)) continue;
    workspace.applications.push(remoteToApplication(row));
    workspace.remoteRows[id] = rowHash(row.values);
    localIds.add(id); synced++;
  }
  if (gateway.readProfile) {
    const remoteProfile = await gateway.readProfile();
    const remoteHash = profileContentHash(remoteProfile);
    const localHash = profileContentHash(workspace.profile);
    const localEmpty = !workspace.profile.facts.length && !workspace.profile.resumeVersions.length && !Object.keys(workspace.profile.personal).length;
    const localChanged = workspace.profileLocalHashAtSync !== null && localHash !== workspace.profileLocalHashAtSync;
    const remoteChanged = remoteHash !== workspace.profileRemoteHash;
    if (!remoteProfile && localEmpty) {
      workspace.profileLocalHashAtSync = localHash;
    } else if (remoteProfile && (localEmpty || (workspace.profileRemoteHash !== null && remoteChanged && !localChanged))) {
      workspace.profile = validateProfile(remoteProfile,workspace.profile);
      workspace.profileRemoteHash = remoteHash;
      workspace.profileLocalHashAtSync = profileContentHash(workspace.profile);
      synced++;
    } else if (remoteHash === localHash) {
      workspace.profileRemoteHash = remoteHash;
      workspace.profileLocalHashAtSync = localHash;
    } else if (remoteChanged || localChanged || workspace.profileRemoteHash === null) {
      conflicts.push({applicationId:'PROFILE',message:remoteProfile ? 'Approved profile differs between this computer and Google Sheets. Review both before choosing the Sheet version or importing the local export into the Sheet.' : 'Approved profile is local but missing from the Sheet. Import the local export into Profile & Answers before syncing.'});
    }
  }
  workspace.conflicts = conflicts;
  workspace.lastSyncedAt = new Date().toISOString();
  return {synced,conflicts,lastSyncedAt:workspace.lastSyncedAt};
}

export async function resolveProfileConflict(workspace:Workspace,gateway:SheetsGateway,resolution:'local'|'remote'):Promise<ProfileExport> {
  if (!workspace.conflicts.some(c => c.applicationId === 'PROFILE')) throw new AppError('No profile conflict to resolve.',404,'NOT_FOUND');
  if (resolution === 'local') throw new AppError('Export the local approved profile, import it through the Sheet sidebar after checking Sheet access, then Sync again. ApplyWeave does not publish profile data to a configured Sheet automatically.',409,'PROFILE_MANUAL_IMPORT');
  if (!gateway.readProfile) throw new AppError('Profile reading is unavailable.',503,'PROFILE_UNAVAILABLE');
  const remote = await gateway.readProfile();
  if (!remote) throw new AppError('No approved profile is present in Google Sheets.',409,'PROFILE_MISSING');
  workspace.profile = validateProfile(remote,workspace.profile);
  workspace.profileRemoteHash = profileContentHash(remote);
  workspace.profileLocalHashAtSync = profileContentHash(workspace.profile);
  workspace.conflicts = workspace.conflicts.filter(c => c.applicationId !== 'PROFILE');
  return workspace.profile;
}

export async function resolveConflict(workspace:Workspace,gateway:SheetsGateway,id:string,resolution:'local'|'remote'):Promise<Application> {
  const app = workspace.applications.find(a => a.applicationId === id);
  if (!app || app.syncStatus !== 'conflict') throw new AppError('No conflict for that application.',404,'NOT_FOUND');
  const row = (await gateway.readRows()).find(r => String(r.values[0]) === id);
  if (resolution === 'remote') {
    if (!row) throw new AppError('The remote row is missing; choose local to restore it.',409,'SHEET_MISSING');
    const description = app.jobDescription;
    Object.assign(app,remoteToApplication(row),{jobDescription:description});
    workspace.remoteRows[id] = rowHash(row.values);
  } else {
    // Record the exact remote version reviewed by the user; next sync performs another read-before-write.
    if (row) workspace.remoteRows[id] = rowHash(row.values);
    else delete workspace.remoteRows[id];
    app.syncStatus = 'pending';
  }
  workspace.conflicts = workspace.conflicts.filter(c => c.applicationId !== id);
  return app;
}
