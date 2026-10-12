import express, {type Express, type Request, type Response, type NextFunction} from 'express';
import {createHash, randomBytes} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Application, AnswerPack, ProfileExport} from '../shared/types.js';
import {AppError, createApplication, patchApplication, validatePack, validatePreferences, validateProfile} from './model.js';
import {WorkspaceStore, type Workspace} from './store.js';
import {GoogleOAuth} from './google.js';
import {AppsScriptInstaller} from './apps-script.js';
import {GoogleSheetsClient, profileContentHash, resolveConflict, resolveProfileConflict, syncWorkspace, type SheetsGateway} from './sheets.js';
import {aiAvailable, generatePack, type GenerationInput} from './generator.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_HOST = '127.0.0.1:4318';
const ORIGINS = new Set(['http://127.0.0.1:4318','http://127.0.0.1:5173']);
type Job = {applicationId:string;status:'running'|'complete'|'failed';pack?:AnswerPack;error?:string};
type Dependencies = {
  privateDir?:string; distDir?:string; allowedHost?:string; gateway?:SheetsGateway;
  aiAvailable?:typeof aiAvailable; generatePack?:typeof generatePack;
};
const wrap = (fn:(req:Request,res:Response)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => { Promise.resolve(fn(req,res)).catch(next); };
const objectBody = (value:unknown):Record<string,unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Request body must be a JSON object.');
  return value as Record<string,unknown>;
};
const validId = (id:string) => /^AW-\d{8}-[A-Z0-9]{6}$/.test(id);
const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const attachment = (res:Response,name:string,value:unknown) => {
  res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
  res.type('json').send(JSON.stringify(value,null,2));
};
function checkBackup(value:unknown):Workspace {
  if (!value || typeof value !== 'object') throw new AppError('Backup must be an object.');
  const b = value as Record<string,unknown>;
  if (b.schemaVersion !== 1 || !Array.isArray(b.applications) || !Array.isArray(b.packs)) throw new AppError('Unsupported ApplyWeave backup.');
  const profile = validateProfile(b.profile);
  if (typeof (b.profile as ProfileExport)?.profileVersion === 'string') profile.profileVersion = (b.profile as ProfileExport).profileVersion;
  const preferences = validatePreferences(b.preferences);
  const applications:Application[] = [], ids = new Set<string>();
  for (const raw of b.applications) {
    const a = objectBody(raw);
    if (typeof a.applicationId !== 'string' || !validId(a.applicationId) || ids.has(a.applicationId)) throw new AppError('Backup has duplicate or invalid Application IDs.');
    const restored = createApplication({...a,allowDuplicate:true},applications);
    if (typeof a.dateSaved !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.dateSaved) || Number.isNaN(Date.parse(`${a.dateSaved}T00:00:00Z`))) throw new AppError('Backup has an invalid saved date.');
    if (typeof a.lastUpdated !== 'string' || Number.isNaN(Date.parse(a.lastUpdated))) throw new AppError('Backup has an invalid update time.');
    restored.applicationId = a.applicationId; restored.dateSaved = a.dateSaved; restored.lastUpdated = a.lastUpdated;
    restored.answerPackId = typeof a.answerPackId === 'string' ? a.answerPackId : '';
    restored.syncStatus = 'pending';
    ids.add(a.applicationId); applications.push(restored);
  }
  const packs:AnswerPack[] = [];
  for (const raw of b.packs) {
    const pack = objectBody(raw);
    if (typeof pack.applicationId !== 'string' || !ids.has(pack.applicationId) || typeof pack.profileVersion !== 'string') throw new AppError('Backup contains an invalid answer pack.');
    // Older packs may be intentionally retained after a profile edit; validate their structure against a temporary version.
    const prior = {...profile,profileVersion:pack.profileVersion};
    packs.push(validatePack(pack,prior,pack.applicationId));
  }
  return {schemaVersion:1,applications,profile,preferences,packs,lastSyncedAt:null,conflicts:[],remoteRows:{},profileRemoteHash:null,profileLocalHashAtSync:null};
}

export async function createApp(deps:Dependencies = {}):Promise<{app:Express;store:WorkspaceStore;oauth:GoogleOAuth;csrfToken:string}> {
  const privateDir = deps.privateDir || path.join(ROOT,'private');
  const store = new WorkspaceStore(privateDir); await store.init();
  const oauth = new GoogleOAuth(privateDir);
  const scriptInstaller = new AppsScriptInstaller(oauth);
  const gateway = deps.gateway || new GoogleSheetsClient(oauth);
  const csrfToken = randomBytes(32).toString('base64url');
  const jobs = new Map<string,Job>();
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
    const host = req.headers.host;
    if (host !== (deps.allowedHost || DEFAULT_HOST) && host !== '127.0.0.1:5173') return res.status(403).json({error:'This local app accepts only its 127.0.0.1 address.',code:'HOST'});
    const oauthCallback = req.method === 'GET' && req.path === '/api/auth/google/callback';
    const origin = req.get('origin');
    if (!oauthCallback && origin && !ORIGINS.has(origin)) return res.status(403).json({error:'Cross-origin request blocked.',code:'ORIGIN'});
    if (!oauthCallback && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'Cross-site request blocked.',code:'ORIGIN'});
    next();
  });
  app.use('/api',express.json({limit:'12mb',type:'application/json'}));
  app.use('/api',(req,res,next) => {
    if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.get('x-applyweave-csrf') !== csrfToken) return res.status(403).json({error:'Refresh ApplyWeave and try again.',code:'CSRF'});
    next();
  });

  app.get('/api/state',wrap(async (_req,res) => {
    const workspace = store.read();
    const connection = {...await oauth.publicState(),aiAvailable:await (deps.aiAvailable || aiAvailable)()};
    const profileSyncStatus = workspace.conflicts.some(c => c.applicationId === 'PROFILE') ? 'conflict' : workspace.profileLocalHashAtSync && workspace.profileLocalHashAtSync === profileContentHash(workspace.profile) ? 'synced' : 'local';
    res.json({applications:workspace.applications,profile:workspace.profile,preferences:workspace.preferences,packs:workspace.packs,connection,lastSyncedAt:workspace.lastSyncedAt,conflicts:workspace.conflicts,profileSyncStatus,csrfToken});
  }));
  app.post('/api/applications',wrap(async (req,res) => {
    const input = objectBody(req.body);
    const application = await store.mutate(workspace => {
      const created = createApplication(input,workspace.applications);
      if (created.resumeVersion && !workspace.profile.resumeVersions.some(r => r.id === created.resumeVersion)) throw new AppError('Resume version is not in the approved profile.');
      workspace.applications.push(created); return created;
    });
    res.status(201).json({application});
  }));
  app.patch('/api/applications/:id',wrap(async (req,res) => {
    const input = objectBody(req.body), id = String(req.params.id);
    const application = await store.mutate(workspace => {
      const index = workspace.applications.findIndex(a => a.applicationId === id);
      if (index < 0) throw new AppError('Application not found.',404,'NOT_FOUND');
      const updated = patchApplication(workspace.applications[index],input,workspace.applications);
      if (updated.resumeVersion && !workspace.profile.resumeVersions.some(r => r.id === updated.resumeVersion)) throw new AppError('Resume version is not in the approved profile.');
      workspace.applications[index] = updated; return updated;
    });
    res.json({application});
  }));
  app.post('/api/preferences',wrap(async (req,res) => {
    const body = objectBody(req.body), preferences = validatePreferences(body.preferences ?? body);
    await store.mutate(workspace => { workspace.preferences = preferences; });
    res.json({preferences});
  }));
  app.post('/api/profile',wrap(async (req,res) => {
    const body = objectBody(req.body);
    const profile = await store.mutate(workspace => { workspace.profile = validateProfile(body.profile,workspace.profile); return workspace.profile; });
    res.json({profile});
  }));
  app.get('/api/profile/export',wrap(async (_req,res) => attachment(res,`applyweave-profile-${store.read().profile.profileVersion}.json`,store.read().profile)));
  app.post('/api/packs',wrap(async (req,res) => {
    const body = objectBody(req.body);
    const pack = await store.mutate(workspace => {
      const raw = objectBody(body.pack);
      const id = String(raw.applicationId || '');
      const application = workspace.applications.find(a => a.applicationId === id);
      if (!application) throw new AppError('Application not found.',404,'NOT_FOUND');
      const checked = validatePack(raw,workspace.profile,id);
      workspace.packs = workspace.packs.filter(p => p.applicationId !== id).concat(checked);
      application.answerPackId = id;
      if (!application.resumeVersion && ['Saved','Preparing'].includes(application.status)) application.resumeVersion = checked.resumeVersionId;
      application.syncStatus = 'pending'; application.lastUpdated = new Date().toISOString();
      return checked;
    });
    res.json({pack});
  }));
  app.get('/api/packs/:applicationId/export',wrap(async (req,res) => {
    const workspace = store.read(); const id = String(req.params.applicationId);
    const pack = workspace.packs.find(p => p.applicationId === id);
    if (!pack) throw new AppError('Answer pack not found.',404,'NOT_FOUND');
    attachment(res,`applyweave-pack-${id}.json`,validatePack(pack,workspace.profile,id));
  }));
  app.post('/api/sync',wrap(async (_req,res) => {
    if (!(await oauth.publicState()).googleConnected && !deps.gateway) throw new AppError('Connect Google Sheets first.',400,'GOOGLE_NOT_CONNECTED');
    const result = await store.mutate(workspace => syncWorkspace(workspace,gateway));
    res.json(result);
  }));
  app.post('/api/conflicts/:id',wrap(async (req,res) => {
    const body = objectBody(req.body);
    if (body.resolution !== 'local' && body.resolution !== 'remote') throw new AppError('Choose local or remote.');
    if (req.params.id === 'PROFILE') {
      const profile = await store.mutate(workspace => resolveProfileConflict(workspace,gateway,body.resolution as 'local'|'remote'));
      return res.json({profile});
    }
    const application = await store.mutate(workspace => resolveConflict(workspace,gateway,String(req.params.id),body.resolution as 'local'|'remote'));
    res.json({application});
  }));
  app.post('/api/auth/google/config',wrap(async (req,res) => {
    const body = objectBody(req.body);
    await oauth.configure(body.client,body.spreadsheetId);
    res.json({configured:true});
  }));
  app.post('/api/auth/google/start',wrap(async (req,res) => res.json({url:await oauth.start(req.body?.includeScript === true)})));
  app.get('/api/auth/google/callback',wrap(async (req,res) => {
    await oauth.callback(req.query.code,req.query.state);
    res.redirect(303,'/?google=connected');
  }));
  app.post('/api/auth/google/disconnect',wrap(async (_req,res) => { await oauth.disconnect(); res.json({disconnected:true}); }));
  app.post('/api/apps-script/install',wrap(async (_req,res) => res.json(await scriptInstaller.install())));
  app.get('/api/resumes/:id',wrap(async (req,res) => {
    const resume = store.read().profile.resumeVersions.find(r => r.id === req.params.id);
    if (!resume || path.basename(resume.filename) !== resume.filename || !resume.filename.toLowerCase().endsWith('.pdf')) throw new AppError('Resume not found.',404,'NOT_FOUND');
    const resumeDir = path.join(privateDir,'resumes');
    let resolved:string;
    try { resolved = await realpath(path.join(resumeDir,resume.filename)); }
    catch { throw new AppError('Resume PDF is not available on this computer.',404,'NOT_FOUND'); }
    const actualDir = await realpath(resumeDir);
    if (path.dirname(resolved) !== actualDir) throw new AppError('Resume path is outside the private catalogue.',403,'RESUME_PATH');
    res.download(resolved,resume.filename);
  }));
  app.get('/api/backups/export',wrap(async (_req,res) => {
    const workspace = store.read();
    attachment(res,`applyweave-backup-${new Date().toISOString().slice(0,10)}.json`,workspace);
  }));
  app.post('/api/backups/import',wrap(async (req,res) => {
    const body = objectBody(req.body), workspace = checkBackup(body.backup);
    await store.replace(workspace);
    res.json({imported:workspace.applications.length});
  }));
  app.post('/api/generate',wrap(async (req,res) => {
    const body = objectBody(req.body), id = String(body.applicationId || '');
    const snapshot = store.read(), application = snapshot.applications.find(a => a.applicationId === id);
    if (!application) throw new AppError('Application not found.',404,'NOT_FOUND');
    if ([...jobs.values()].some(job => job.applicationId === id && job.status === 'running')) throw new AppError('A draft is already being prepared for this application.',409,'GENERATION_RUNNING');
    if (!(await (deps.aiAvailable || aiAvailable)())) throw new AppError('Codex CLI is not signed in. You can prepare answers manually.',503,'AI_UNAVAILABLE');
    const input = {applicationId:id,jobDescription:body.jobDescription,questions:body.questions} as GenerationInput;
    if (typeof input.jobDescription !== 'string' || input.jobDescription.trim().length < 30 || input.jobDescription.length > 60000 || !Array.isArray(input.questions) || input.questions.length > 30) throw new AppError('Provide a job description and up to 30 application questions.');
    const baselineApplication = digest(application);
    const baselinePack = digest(snapshot.packs.find(pack => pack.applicationId === id) || null);
    const jobId = randomBytes(16).toString('base64url'); jobs.set(jobId,{applicationId:id,status:'running'});
    const cleanup = setTimeout(() => jobs.delete(jobId),30*60*1000); cleanup.unref();
    void (async () => {
      try {
        const raw = await (deps.generatePack || generatePack)(input,snapshot.profile,snapshot.preferences,application);
        const pack = await store.mutate(workspace => {
          const currentApp = workspace.applications.find(a => a.applicationId === id);
          if (workspace.profile.profileVersion !== snapshot.profile.profileVersion || !currentApp || digest(currentApp) !== baselineApplication || digest(workspace.packs.find(pack => pack.applicationId === id) || null) !== baselinePack) throw new AppError('Profile, application, or saved answers changed during generation; run it again.',409,'STALE_PACK');
          const checked = validatePack({...raw,answers:raw.answers.map(a => ({...a,approved:false}))},workspace.profile,id);
          workspace.packs = workspace.packs.filter(p => p.applicationId !== id).concat(checked);
          const app = workspace.applications.find(a => a.applicationId === id)!;
          app.answerPackId = id;
          if (!app.resumeVersion && ['Saved','Preparing'].includes(app.status)) app.resumeVersion = checked.resumeVersionId;
          app.jobDescription = input.jobDescription; app.syncStatus = 'pending'; app.lastUpdated = new Date().toISOString();
          return checked;
        });
        jobs.set(jobId,{applicationId:id,status:'complete',pack});
      } catch (error) { jobs.set(jobId,{applicationId:id,status:'failed',error:error instanceof Error ? error.message : 'Generation failed.'}); }
    })();
    res.status(202).json({jobId});
  }));
  app.get('/api/generate/:jobId',wrap(async (req,res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) throw new AppError('Generation job not found.',404,'NOT_FOUND');
    res.json(job);
  }));
  app.get('/api/extension/export/:applicationId',wrap(async (req,res) => {
    const workspace = store.read(), id = String(req.params.applicationId);
    if (!workspace.applications.some(a => a.applicationId === id)) throw new AppError('Application not found.',404,'NOT_FOUND');
    const pack = workspace.packs.find(p => p.applicationId === id);
    if (pack) validatePack(pack,workspace.profile,id);
    attachment(res,`applyweave-extension-${id}.json`,{profile:workspace.profile,pack:pack || null});
  }));

  app.use('/api',(_req,res) => res.status(404).json({error:'API route not found.',code:'NOT_FOUND'}));
  const distDir = deps.distDir || path.join(ROOT,'app','dist');
  app.use(express.static(distDir,{index:false}));
  app.get('*',wrap(async (_req,res) => {
    try { res.type('html').send(await readFile(path.join(distDir,'index.html'),'utf8')); }
    catch { res.status(503).type('text').send('ApplyWeave frontend is not built. Run npm run build or npm run dev.'); }
  }));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction) => {
    if (res.headersSent) return;
    const parseError = typeof error === 'object' && error !== null && 'type' in error && ['entity.parse.failed','entity.too.large'].includes(String((error as {type:unknown}).type));
    const status = error instanceof AppError ? error.status : parseError ? (error as {status?:number}).status || 400 : 500;
    const code = error instanceof AppError ? error.code : parseError ? 'INVALID_JSON' : 'INTERNAL';
    const message = error instanceof AppError ? error.message : parseError ? 'Request JSON is invalid or too large.' : 'An unexpected local error occurred.';
    const details = error instanceof AppError ? error.details : {};
    res.status(status).json({error:message,code,...details});
  });
  return {app,store,oauth,csrfToken};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().then(({app}) => {
    app.listen(4318,'127.0.0.1',() => { console.log('ApplyWeave: http://127.0.0.1:4318'); });
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
