/** Run with server environment variables loaded, never pass secrets as CLI arguments. */
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {getSql} from '../app/server/db.js';
import {emptyWorkspace,parseWorkspace,PostgresWorkspaceStore} from '../app/server/store.js';
import {safeResumeFilename,SupabaseResumeStorage,validateResumePdf} from '../app/server/resume-storage.js';
import {validatePreferences,validateProfile} from '../app/server/model.js';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const source = args.find(arg=>!arg.startsWith('--')) || 'private';
  if (args.some(arg=>arg.startsWith('--') && arg !== '--apply')) throw new Error('Usage: tsx scripts/migrate-hosted.ts [private-directory] [--apply]');
  const privateDir = await realpath(source);
  const filename = path.join(privateDir,'workspace.json');
  if (((await stat(filename)).mode & 0o077) !== 0) throw new Error('Local workspace must have owner-only permissions (600).');
  const workspace = parseWorkspace(JSON.parse(await readFile(filename,'utf8')));
  validateProfile(workspace.profile); validatePreferences(workspace.preferences);
  const resumeDir = await realpath(path.join(privateDir,'resumes'));
  const files: Array<{filename:string;data:Buffer}> = [];
  const names = new Set<string>();
  for (const resume of workspace.profile.resumeVersions) {
    const name = safeResumeFilename(resume.filename);
    if (names.has(name)) continue;
    names.add(name);
    const resolved = await realpath(path.join(resumeDir,name));
    if (path.dirname(resolved) !== resumeDir) throw new Error('Resume resolves outside the private resume directory.');
    const data = await readFile(resolved); validateResumePdf(data); files.push({filename:name,data});
  }
  console.log(`Validated ${workspace.applications.length} applications, ${workspace.packs.length} answer packs and ${files.length} private PDFs.`);
  if (!apply) { console.log('Dry run only. Add --apply to copy to hosted storage. Local files and OAuth credentials remain unchanged.'); return; }
  const sql = getSql();
  try {
    const store = new PostgresWorkspaceStore(sql); await store.init();
    const canImport = (current:unknown) => isDeepStrictEqual(current,emptyWorkspace()) || isDeepStrictEqual(current,workspace);
    if (!canImport(await store.read())) throw new Error('Hosted workspace already contains different data. Export and reconcile it before importing.');
    const storage = SupabaseResumeStorage.fromEnv(); await storage.ensurePrivateBucket();
    for (const file of files) {
      await storage.upload(file.filename,file.data);
      const uploaded = await storage.download(file.filename);
      if (!uploaded.equals(file.data)) throw new Error('Uploaded PDF failed byte verification. Workspace was not imported.');
    }
    await store.mutate(current => {
      if (!canImport(current)) throw new Error('Hosted workspace changed during migration. Import stopped to preserve it.');
      Object.assign(current,workspace);
    });
    if (!isDeepStrictEqual(await store.read(),workspace)) throw new Error('Hosted workspace verification failed. Keep the original local backup.');
    console.log('Migration verified: application IDs, profile, answers, sync metadata and private PDFs preserved. Sign in again on the hosted URL; local OAuth tokens and sessions were not copied.');
  } finally { await sql.end({timeout:5}); }
}
main().catch(() => { console.error('Migration stopped. Check local file validity, server environment and hosted storage access. Existing hosted data is never overwritten when different. No credentials were printed.'); process.exitCode=1; });
