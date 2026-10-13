import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import postgres from 'postgres';
import {emptyWorkspace,PostgresWorkspaceStore} from './store.js';

const connection = process.env.TEST_DATABASE_URL;
test('hosted workspace survives restarts, serializes concurrent mutations and rolls back failures', {skip:!connection}, async()=>{
  const schema = `test_storage_${randomBytes(6).toString('hex')}`;
  const admin=postgres(connection!,{prepare:false,max:1,onnotice:()=>{}});
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const options={prepare:false,max:3,connection:{search_path:schema},onnotice:()=>{}};
  const first=postgres(connection!,options),second=postgres(connection!,options);
  try {
    const one=new PostgresWorkspaceStore(first),two=new PostgresWorkspaceStore(second);
    await Promise.all([one.init(),two.init()]);
    const seed=emptyWorkspace(); seed.profile.personal.email='test@example.test';seed.preferences.counter=0;
    await one.replace(seed);
    await two.init();
    assert.deepEqual(await two.read(),seed,'cold starts never reset an existing workspace');
    await Promise.all(Array.from({length:12},(_,i)=>(i%2?one:two).mutate(async draft=>{
      const count=Number(draft.preferences.counter);
      await new Promise(resolve=>setTimeout(resolve,5));
      draft.preferences.counter=count+1;
    })));
    assert.equal((await one.read()).preferences.counter,12,'row lock prevents lost updates across separate instances');
    await assert.rejects(one.mutate(draft=>{draft.preferences.counter=999;throw new Error('simulated failure');}),/simulated failure/);
    assert.equal((await two.read()).preferences.counter,12,'failed mutation rolls back');
    await assert.rejects(one.mutate(async(draft,tx)=>{
      assert.ok(tx);
      await tx`INSERT INTO applyweave_generation_jobs(id,application_id,status,data) VALUES ('atomic-test','application','complete','{}')`;
      draft.preferences.counter=999;
      throw new Error('failure after job write');
    }),/failure after job write/);
    assert.equal((await first`SELECT id FROM applyweave_generation_jobs WHERE id='atomic-test'`).length,0,'job and workspace changes share rollback');
    assert.equal((await two.read()).preferences.counter,12);
    const detached=await one.read();detached.profile.personal.email='modified';
    assert.equal((await two.read()).profile.personal.email,'test@example.test');
    const migrations=await first`SELECT version FROM applyweave_migrations`;
    assert.equal(migrations.length,1);
    const tables=await first`SELECT relname,relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=pg_class.relnamespace WHERE nspname=${schema} AND relname IN ('applyweave_workspaces','applyweave_auth_records','applyweave_sessions','applyweave_oauth_states','applyweave_generation_jobs')`;
    assert.equal(tables.length,5);assert.ok(tables.every(row=>row.relrowsecurity));
  } finally {
    await Promise.all([first.end(),second.end()]);
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
