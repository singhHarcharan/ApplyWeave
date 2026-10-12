import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Application, AnswerPack, Conflict, Preferences, ProfileExport } from '../shared/types.js';
import { validatePreferences, validateProfile } from './model.js';

export type Workspace = {
  schemaVersion: 1; applications: Application[]; profile: ProfileExport; preferences: Preferences;
  packs: AnswerPack[]; lastSyncedAt: string|null; conflicts: Conflict[];
  remoteRows: Record<string, string>; profileRemoteHash: string|null; profileLocalHashAtSync: string|null;
};
export async function writePrivateJson(filename: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filename), {recursive:true, mode:0o700});
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', {mode:0o600, flag:'wx'});
  await rename(temp, filename);
}
async function readJson(filename: string): Promise<unknown> { return JSON.parse(await readFile(filename,'utf8')); }
export class WorkspaceStore {
  private data!: Workspace;
  private tail: Promise<void> = Promise.resolve();
  constructor(readonly privateDir: string) {}
  get filename() { return path.join(this.privateDir, 'workspace.json'); }
  async init(): Promise<void> {
    await mkdir(this.privateDir,{recursive:true,mode:0o700});
    try {
      const existing = await readJson(this.filename) as Workspace;
      if (existing?.schemaVersion !== 1 || !Array.isArray(existing.applications) || !Array.isArray(existing.packs) || !existing.profile || !existing.preferences) throw new Error('Workspace has an unsupported format; restore a backup before continuing.');
      this.data = { ...existing, conflicts:existing.conflicts || [], remoteRows:existing.remoteRows || {}, profileRemoteHash:existing.profileRemoteHash || null, profileLocalHashAtSync:existing.profileLocalHashAtSync || null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let profile: ProfileExport;
      let preferences: Preferences;
      try {
        const seed = await readJson(path.join(this.privateDir,'approved-profile.json')) as ProfileExport;
        profile = validateProfile(seed);
        if (typeof seed.profileVersion === 'string' && seed.profileVersion) profile.profileVersion = seed.profileVersion;
      }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; profile = {schemaVersion:1,profileVersion:'',personal:{},facts:[],standardAnswers:[],resumeVersions:[]}; }
      try { preferences = validatePreferences(await readJson(path.join(this.privateDir,'preferences.json'))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; preferences = {}; }
      this.data = {schemaVersion:1,applications:[],profile,preferences,packs:[],lastSyncedAt:null,conflicts:[],remoteRows:{},profileRemoteHash:null,profileLocalHashAtSync:null};
      await writePrivateJson(this.filename,this.data);
    }
    const mode = (await stat(this.filename)).mode & 0o777;
    if (mode & 0o077) throw new Error('Private workspace permissions are too open. Set workspace.json to mode 600.');
  }
  read(): Workspace { return structuredClone(this.data); }
  async mutate<T>(fn: (workspace: Workspace) => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const draft = this.read();
      const result = await fn(draft);
      await writePrivateJson(this.filename,draft);
      this.data = draft;
      return result;
    } finally { release(); }
  }
  async replace(workspace: Workspace): Promise<void> { await this.mutate(draft => { Object.assign(draft,workspace); }); }
}
