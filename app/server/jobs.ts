import {randomBytes} from 'node:crypto';
import {AppError} from './model.js';
import type {AnswerPack} from '../shared/types.js';
import {getSql} from './db.js';
export type GenerationJob = {applicationId:string;status:'running'|'complete'|'failed';pack?:AnswerPack;error?:string};
const EXPIRES_MS=120_000;
export class GenerationJobs {
  private jobs=new Map<string,{data:GenerationJob;created:number}>();
  constructor(private readonly hosted=false){}
  async start(applicationId:string,requestId?:string):Promise<{id:string;existing:boolean}> {
    if(requestId && !/^[A-Za-z0-9_-]{16,80}$/.test(requestId))throw new AppError('Invalid generation request ID.');
    const id=requestId || randomBytes(16).toString('base64url');
    if(!this.hosted){
      const previous=this.jobs.get(id);
      if(previous){if(previous.data.applicationId!==applicationId)throw new AppError('Request ID already used.',409);return {id,existing:true};}
      for(const [key,job] of this.jobs){
        if(Date.now()-job.created>30*60_000)this.jobs.delete(key);
        else if(job.data.applicationId===applicationId && job.data.status==='running' && Date.now()-job.created<EXPIRES_MS)throw new AppError('A draft is already being prepared for this application.',409,'GENERATION_RUNNING');
      }
      this.jobs.set(id,{created:Date.now(),data:{applicationId,status:'running'}});return {id,existing:false};
    }
    const configured=Number(process.env.AI_DAILY_LIMIT || '20');
    if(!Number.isInteger(configured)||configured<1||configured>1000)throw new AppError('Daily generation limit is not configured correctly.',503,'AI_CONFIG');
    const sql=getSql();
    return sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(17012027)`;
      const previous=await tx`SELECT application_id FROM applyweave_generation_jobs WHERE id=${id}`;
      if(previous.length){if(previous[0].application_id!==applicationId)throw new AppError('Request ID already used.',409);return {id,existing:true};}
      await tx`UPDATE applyweave_generation_jobs SET status='failed', data=data || ${tx.json({status:'failed',error:'Generation was interrupted. Please retry.'})}, updated_at=now() WHERE status='running' AND created_at < now()-interval '120 seconds'`;
      const active=await tx`SELECT id FROM applyweave_generation_jobs WHERE application_id=${applicationId} AND status='running'`;
      if(active.length)throw new AppError('A draft is already being prepared for this application.',409,'GENERATION_RUNNING');
      const count=await tx`SELECT count(*)::integer AS total FROM applyweave_generation_jobs WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
      if(count[0].total>=configured)throw new AppError('Daily AI limit reached. You can edit answers manually or try again after midnight UTC.',429,'AI_LIMIT');
      await tx`INSERT INTO applyweave_generation_jobs(id,application_id,status,data) VALUES(${id},${applicationId},'running',${tx.json({applicationId,status:'running'})})`;
      return {id,existing:false};
    });
  }
  async finish(id:string,data:GenerationJob):Promise<void>{
    if(!this.hosted){const job=this.jobs.get(id);if(job?.data.status==='running')this.jobs.set(id,{...job,data});return;}
    const sql=getSql();await sql`UPDATE applyweave_generation_jobs SET status=${data.status},data=${sql.json(data)},updated_at=now() WHERE id=${id} AND status='running'`;
  }
  async get(id:string):Promise<GenerationJob|null>{
    if(!this.hosted)return this.jobs.get(id)?.data || null;
    if(!/^[A-Za-z0-9_-]{16,80}$/.test(id))return null;
    const sql=getSql();const rows=await sql`SELECT data,extract(epoch FROM created_at)*1000 AS created FROM applyweave_generation_jobs WHERE id=${id}`;
    if(!rows.length)return null;
    const data=rows[0].data as GenerationJob;
    if(data.status==='running' && Date.now()-Number(rows[0].created)>EXPIRES_MS){
      const updated=await sql`UPDATE applyweave_generation_jobs SET status='failed',data=data || ${sql.json({status:'failed',error:'Generation was interrupted. Please retry.'})},updated_at=now() WHERE id=${id} AND status='running' AND created_at<now()-interval '120 seconds' RETURNING data`;
      if(updated.length)return updated[0].data as GenerationJob;
      const current=await sql`SELECT data FROM applyweave_generation_jobs WHERE id=${id}`;return current[0]?.data as GenerationJob || null;
    }
    return data;
  }
}
