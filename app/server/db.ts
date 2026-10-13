import postgres from 'postgres';
import { readFile } from 'node:fs/promises';

let singleton: ReturnType<typeof postgres> | undefined;
let workspaceSingleton: ReturnType<typeof postgres> | undefined;
const initializations = new WeakMap<ReturnType<typeof postgres>, Promise<void>>();
function connect(max: number): ReturnType<typeof postgres> {
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new Error('DATABASE_URL is required for hosted storage.');
  const hostname = new URL(connection).hostname;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  return postgres(connection, {max, prepare:false, idle_timeout:20, connect_timeout:15, ssl:local ? false : 'require', onnotice:()=>{}});
}
/** Transaction-pooler compatible: a small pool per warm server instance, no prepared statements. */
export function getSql(): ReturnType<typeof postgres> {
  if (singleton) return singleton;
  singleton = connect(3);
  return singleton;
}
/** Keep workspace locks from exhausting connections needed by nested OAuth refresh during sync. */
export function getWorkspaceSql(): ReturnType<typeof postgres> {
  workspaceSingleton ||= connect(1);
  return workspaceSingleton;
}
/** Never auto-seeds private data; schema creation is safe across concurrent cold starts. */
export async function initDatabase(sql = getSql()): Promise<void> {
  const initialized = initializations.get(sql);
  if (initialized) return initialized;
  const run = async () => {
    const migration = await readFile(new URL('./migrations/001_hosted.sql', import.meta.url), 'utf8');
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(17012026)`;
      await tx`CREATE TABLE IF NOT EXISTS applyweave_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      const rows = await tx`SELECT version FROM applyweave_migrations WHERE version = 1`;
      if (!rows.length) {
        await tx.unsafe(migration);
        await tx`INSERT INTO applyweave_migrations(version) VALUES (1)`;
      }
    });
  };
  const pending = run().catch(error => { initializations.delete(sql); throw error; });
  initializations.set(sql, pending);
  return pending;
}
