import {hostedOrigin,googleRedirectUri,tokenEncryptionKey,isHosted} from '../app/server/hosted-config.js';
import {GoogleOAuth} from '../app/server/google.js';
import {SupabaseResumeStorage} from '../app/server/resume-storage.js';
import {aiProviderStatus} from '../app/server/generator.js';
import {getSql} from '../app/server/db.js';
async function main(){
  if(!isHosted())throw new Error('Set APPLYWEAVE_MODE=hosted.');
  hostedOrigin();googleRedirectUri();tokenEncryptionKey();
  await new GoogleOAuth('/unused').config();
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is missing.');
  const storage=SupabaseResumeStorage.fromEnv();
  void storage;
  const ai=aiProviderStatus();
  console.log('Hosted configuration shape validated. No secret values printed.');
  console.log(ai.configured?'Hosted AI configured; provider authorization and data policy still require live verification.':'Hosted AI disabled or incomplete; manual answer editing remains available.');
  if(process.argv.includes('--full')&&!ai.configured)throw new Error('Full hosted release requires configured AI.');
  if(process.argv.includes('--database')){
    const sql=getSql();try{await sql`SELECT 1`;console.log('Database connection verified. No schema or data changed.');}finally{await sql.end({timeout:5});}
  }
}
main().catch(error=>{console.error(error instanceof Error && !error.message.includes('://')?error.message:'Hosted preflight failed. Check private environment configuration.');process.exitCode=1;});
