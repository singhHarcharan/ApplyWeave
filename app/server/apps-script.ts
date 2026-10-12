import {createHash} from 'node:crypto';
import {readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from './model.js';
import {GoogleOAuth} from './google.js';
import {writePrivateJson} from './store.js';

const ROOT = fileURLToPath(new URL('../../',import.meta.url));
type InstallRecord = {state:'creating'|'created'|'installed';spreadsheetId:string;scriptId?:string;sourceHash?:string;updatedAt:string};
type Fetcher = typeof fetch;
export class AppsScriptInstaller {
  constructor(private oauth:GoogleOAuth,private fetcher:Fetcher = fetch) {}
  private async record():Promise<InstallRecord|null> {
    try {return JSON.parse(await readFile(this.oauth.scriptInstallPath,'utf8')) as InstallRecord;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  async install():Promise<{scriptId:string;url:string;installed:true}> {
    const config=await this.oauth.config();
    if(!config)throw new AppError('Configure Google Sheets first.',400,'GOOGLE_NOT_CONFIGURED');
    const connection=await this.oauth.publicState();
    if(!connection.scriptAuthorized)throw new AppError('Reconnect Google with Apps Script permission before installing the Sheet menu.',403,'SCRIPT_SCOPE');
    const code=await readFile(path.join(ROOT,'apps-script','Code.gs'),'utf8');
    const html=await readFile(path.join(ROOT,'apps-script','Sidebar.html'),'utf8');
    const manifest=JSON.stringify({timeZone:'Asia/Kolkata',runtimeVersion:'V8',exceptionLogging:'STACKDRIVER',oauthScopes:['https://www.googleapis.com/auth/spreadsheets.currentonly','https://www.googleapis.com/auth/script.container.ui']});
    const sourceHash=createHash('sha256').update(code).update(html).update(manifest).digest('hex');
    let record=await this.record();
    if(record && record.spreadsheetId!==config.spreadsheetId)throw new AppError('An Apps Script installation record belongs to another Sheet.',409,'SCRIPT_SHEET_MISMATCH');
    if(record?.state==='installed' && record.scriptId)return {scriptId:record.scriptId,url:`https://script.google.com/home/projects/${record.scriptId}/edit`,installed:true};
    if(record?.state==='creating')throw new AppError('Project creation has an unknown outcome. Check the Sheet’s Extensions → Apps Script before retrying; ApplyWeave will not create another project automatically.',409,'SCRIPT_CREATE_AMBIGUOUS');
    if(!record){
      record={state:'creating',spreadsheetId:config.spreadsheetId,updatedAt:new Date().toISOString()};
      await writePrivateJson(this.oauth.scriptInstallPath,record);
      let response:Response;
      try{response=await this.fetcher('https://script.googleapis.com/v1/projects',{method:'POST',headers:{Authorization:`Bearer ${await this.oauth.accessToken()}`,'content-type':'application/json'},body:JSON.stringify({title:'ApplyWeave Tracker',parentId:config.spreadsheetId})});}
      catch{throw new AppError('Could not confirm whether Apps Script created the project. Check Extensions → Apps Script before retrying.',502,'SCRIPT_CREATE_AMBIGUOUS');}
      if(!response.ok){await rm(this.oauth.scriptInstallPath,{force:true});throw new AppError(`Apps Script project creation failed (${response.status}). Enable the Apps Script API in the OAuth client’s Google Cloud project and check Sheet access.`,502,'SCRIPT_API');}
      const created=await response.json() as Record<string,unknown>;
      if(typeof created.scriptId!=='string'||!created.scriptId)throw new AppError('Apps Script returned no project ID. Check the Sheet before retrying.',502,'SCRIPT_CREATE_AMBIGUOUS');
      record={state:'created',spreadsheetId:config.spreadsheetId,scriptId:created.scriptId,updatedAt:new Date().toISOString()};
      await writePrivateJson(this.oauth.scriptInstallPath,record);
    }
    if(!record.scriptId)throw new AppError('Apps Script project ID is missing.',409,'SCRIPT_CREATE_AMBIGUOUS');
    const files=[{name:'Code',type:'SERVER_JS',source:code},{name:'Sidebar',type:'HTML',source:html},{name:'appsscript',type:'JSON',source:manifest}];
    const response=await this.fetcher(`https://script.googleapis.com/v1/projects/${encodeURIComponent(record.scriptId)}/content`,{method:'PUT',headers:{Authorization:`Bearer ${await this.oauth.accessToken()}`,'content-type':'application/json'},body:JSON.stringify({files})});
    if(!response.ok)throw new AppError(`Apps Script source upload failed (${response.status}). The project was created; retry Install to finish the upload.`,502,'SCRIPT_API');
    await writePrivateJson(this.oauth.scriptInstallPath,{...record,state:'installed',sourceHash,updatedAt:new Date().toISOString()});
    return {scriptId:record.scriptId,url:`https://script.google.com/home/projects/${record.scriptId}/edit`,installed:true};
  }
}
