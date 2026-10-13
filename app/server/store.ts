import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Application, AnswerPack, Conflict, Preferences, ProfileExport } from '../shared/types.js';
import { validatePreferences, validateProfile } from './model.js';
import { getWorkspaceSql, initDatabase } from './db.js';
import type { TransactionSql } from 'postgres';

export type Workspace = {
  schemaVersion: 1; applications: Application[]; profile: ProfileExport; preferences: Preferences;
  packs: AnswerPack[]; lastSyncedAt: string|null; conflicts: Conflict[];
  remoteRows: Record<string, string>; profileRemoteHash: string|null; profileLocalHashAtSync: string|null;
};
export interface WorkspaceRepository {
  init(): Promise<void>;
  read(): Workspace | Promise<Workspace>;
  mutate<T>(fn: (workspace: Workspace, transaction?: TransactionSql) => T | Promise<T>): Promise<T>;
  replace(workspace: Workspace): Promise<void>;
}
export function emptyWorkspace(): Workspace {
  return {schemaVersion:1,applications:[],profile:{schemaVersion:1,profileVersion:'',personal:{},facts:[],standardAnswers:[],resumeVersions:[]},preferences:{},packs:[],lastSyncedAt:null,conflicts:[],remoteRows:{},profileRemoteHash:null,profileLocalHashAtSync:null};
}
export function parseWorkspace(input: unknown): Workspace {
  const value = input as Workspace;
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.applications) || !Array.isArray(value.packs) || !value.profile || !value.preferences) throw new Error('Workspace has an unsupported format.');
  return structuredClone({...value,conflicts:value.conflicts || [],remoteRows:value.remoteRows || {},profileRemoteHash:value.profileRemoteHash || null,profileLocalHashAtSync:value.profileLocalHashAtSync || null});
}
export class PostgresWorkspaceStore implements WorkspaceRepository {
  constructor(private readonly sql = getWorkspaceSql()) {}
  async init(): Promise<void> {
    await initDatabase(this.sql);
    // The conflict clause is essential: a cold start must never overwrite existing data.
    await this.sql`INSERT INTO applyweave_workspaces(id,data) VALUES ('owner',${this.sql.json(emptyWorkspace() as any)}) ON CONFLICT(id) DO NOTHING`;
  }
  async read(): Promise<Workspace> {
    const rows = await this.sql`SELECT data FROM applyweave_workspaces WHERE id = 'owner'`;
    if (!rows.length) throw new Error('Hosted workspace has not been initialized.');
    return parseWorkspace(rows[0].data);
  }
  async mutate<T>(fn: (workspace: Workspace, transaction?: TransactionSql) => T | Promise<T>): Promise<T> {
    let result!: T;
    await this.sql.begin(async tx => {
      const rows = await tx`SELECT data FROM applyweave_workspaces WHERE id = 'owner' FOR UPDATE`;
      if (!rows.length) throw new Error('Hosted workspace has not been initialized.');
      const draft = parseWorkspace(rows[0].data);
      result = await fn(draft, tx);
      await tx`UPDATE applyweave_workspaces SET data = ${tx.json(draft as any)}, updated_at = now() WHERE id = 'owner'`;
    });
    return result;
  }
  async replace(workspace: Workspace): Promise<void> {
    const validated = parseWorkspace(workspace);
    await this.mutate(draft => { Object.assign(draft, validated); });
  }
}
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
  async mutate<T>(fn: (workspace: Workspace, transaction?: TransactionSql) => T | Promise<T>): Promise<T> {
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
