import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAvailable, aiProviderStatus, generatePack, buildPrompt } from './generator.js';
import type { Application, ProfileExport } from '../shared/types.js';

const profile:ProfileExport={schemaVersion:1,profileVersion:'v1',personal:{fullName:'Test'},facts:[{id:'F1',claim:'Built a React interface.',source:'Confirmed'}],standardAnswers:[],resumeVersions:[{id:'MERN',filename:'resume.pdf'}]};
const input={applicationId:'AW-1',jobDescription:'A React frontend role with a remote team.',questions:[{question:'Describe your React experience',maxCharacters:100}]};
const application={applicationId:'AW-1'} as Application;
const valid=()=>({resumeVersionId:'MERN',analysis:{fit:'partial',summary:'React experience',resumeReason:'Relevant',proofPoints:[{text:'Built a React interface.',factIds:['F1']}],unknowns:[],workModeCheck:'Remote',compensationCheck:'Unknown'},answers:[{question:input.questions[0].question,answer:'Built a React interface.',factIds:['F1']}]});
const keys=['APP_ORIGIN','AI_PROVIDER','AI_MODEL','AI_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','APPLYWEAVE_MODE','APPLYWEAVE_HOSTED','VERCEL','AI_MAX_OUTPUT_TOKENS','AI_TIMEOUT_MS'];
async function configured(env:Record<string,string>,fn:()=>Promise<void>) {
 const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];
 Object.assign(process.env,env);
 try{await fn();}finally{for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}}
}
const env={APPLYWEAVE_MODE:'hosted',AI_PROVIDER:'gemini',AI_MODEL:'test-model',AI_API_KEY:'test-only-secret'};
const gemini=(output:unknown=valid(),finishReason='STOP')=>Response.json({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(output)}]}}]});

test('hosted AI requires an explicit provider, model and credential; Codex never runs hosted',async()=>{
 const cases:Record<string,string>[]=[{APP_ORIGIN:'https://applyweave.example',AI_PROVIDER:'codex'},{APPLYWEAVE_MODE:'hosted',OPENAI_API_KEY:'unused'},{...env,AI_PROVIDER:'codex'},{...env,AI_MODEL:''},{...env,AI_API_KEY:''},{...env,AI_MODEL:'bad/path'}];
 for(const settings of cases){
  await configured(settings,async()=>{assert.equal(await aiAvailable(),false);assert.equal(aiProviderStatus().configured,false);await assert.rejects(generatePack(input,profile,{},application),/not configured/);});
 }
});

test('Gemini uses isolated instructions, fixed HTTPS endpoint, header key, strict schema and bounded output',async(t)=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url:string,options:RequestInit)=>{
  calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
  assert.equal((options.headers as Record<string,string>)['x-goog-api-key'],'test-only-secret');
  assert.equal(options.redirect,'error');assert.ok(options.signal);
  const body=JSON.parse(options.body as string);assert.deepEqual(body.tools,[]);assert.equal(body.generationConfig.maxOutputTokens,4096);
  assert.equal(body.generationConfig.responseJsonSchema.additionalProperties,false);assert.match(body.systemInstruction.parts[0].text,/untrusted source material/);
  assert.equal(JSON.parse(body.contents[0].parts[0].text).jobDescription,input.jobDescription);
  return gemini();
 });
 await configured({...env,AI_MAX_OUTPUT_TOKENS:'999999'},async()=>{
  assert.equal(await aiAvailable(),true);assert.equal(calls,0);
  assert.ok(!JSON.stringify(aiProviderStatus()).includes('test-only-secret'));
  const result=await generatePack(input,profile,{},application);assert.equal(result.answers[0].approved,false);assert.equal(result.profileVersion,'v1');assert.equal(calls,1);
 });
});

test('OpenAI Responses is non-stored, has no tools, and parses only completed text',async(t)=>{
 t.mock.method(globalThis,'fetch',async(url:string,options:RequestInit)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  assert.equal((options.headers as Record<string,string>).Authorization,'Bearer test-only-secret');
  const body=JSON.parse(options.body as string);assert.equal(body.store,false);assert.equal(body.tool_choice,'none');assert.deepEqual(body.tools,[]);assert.equal(body.text.format.strict,true);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(valid())}]}]});
 });
 await configured({...env,AI_PROVIDER:'openai'},async()=>{const result=await generatePack(input,profile,{},application);assert.equal(result.answers[0].approved,false);});
});

test('provider error responses never leak bodies or retry quota failures',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('test-only-secret provider error',{status:429});});
 await configured(env,async()=>{await assert.rejects(generatePack(input,profile,{},application),error=>error instanceof Error && /quota/.test(error.message) && !error.message.includes('test-only-secret'));assert.equal(calls,1);});
});

test('hosted outputs retain approved fact validation and reject truncated content',async(t)=>{
 const raw=valid();raw.answers[0].factIds=['invented'];let response=gemini(raw);
 t.mock.method(globalThis,'fetch',async()=>response);
 await configured(env,async()=>{
  await assert.rejects(generatePack(input,profile,{},application),/unapproved fact/);
  response=gemini(valid(),'MAX_TOKENS');await assert.rejects(generatePack(input,profile,{},application),/incomplete draft/);
  response=new Response('x'.repeat(512001));await assert.rejects(generatePack(input,profile,{},application),/too large/);
 });
});

test('large prompt and invalid input fail before sending private data',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return gemini();});
 await configured(env,async()=>{
  await assert.rejects(generatePack(input,{...profile,facts:[{id:'F1',claim:'x'.repeat(120001),source:'Confirmed'}]}, {},application),/too large/);
  await assert.rejects(generatePack({...input,questions:[input.questions[0],input.questions[0]]},profile,{},application),/duplicate questions/);
  assert.equal(calls,0);
 });
});


test('draft prompts exclude contact fields, source paths, filenames, saved answers and unrelated preferences',()=>{
 const privateProfile={...profile,personal:{email:'private@example.test',phone:'+910000000000'},facts:[{id:'F1',claim:'Built a React interface.',source:'/private/candidate-source.pdf'}],standardAnswers:[{key:'anything',text:'private-saved-answer',factIds:['F1']}],resumeVersions:[{id:'MERN',filename:'private-candidate-resume.pdf'}]};
 const prompt=buildPrompt(input,privateProfile,{minimumCompensationLpa:12,workModes:['Remote'],privateNote:'private-preference'},application);
 for(const value of ['private@example.test','+910000000000','/private/candidate-source.pdf','private-saved-answer','private-candidate-resume.pdf','private-preference'])assert.ok(!prompt.includes(value));
 assert.match(prompt,/Built a React interface/);assert.match(prompt,/minimumCompensationLpa/);assert.match(prompt,/MERN/);
});
