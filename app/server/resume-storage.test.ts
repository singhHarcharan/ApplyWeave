import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseResumeStorage,MAX_RESUME_BYTES,safeResumeFilename,validateResumePdf} from './resume-storage.js';
const pdf = Buffer.from('%PDF-1.7\nprivate resume\n%%EOF');
const pdfResponse = (bytes = pdf) => new Response(bytes,{headers:{'content-type':'application/pdf'}});

test('private resume filenames reject traversal and PDFs enforce type/size',()=>{
  for(const name of ['../resume.pdf','resume/one.pdf','resume\\two.pdf','.secret.pdf','file.pdf?x=1','file.txt','resume..pdf']) assert.throws(()=>safeResumeFilename(name));
  assert.equal(safeResumeFilename('Harcharan_Resume_Frontend_2026.pdf'),'Harcharan_Resume_Frontend_2026.pdf');
  assert.throws(()=>validateResumePdf(Buffer.from('fake.pdf')));
  assert.throws(()=>validateResumePdf(Buffer.alloc(MAX_RESUME_BYTES+1)));
  validateResumePdf(pdf);
});
test('resume storage authenticates privately, refuses public buckets and does not return URLs',async()=>{
  const storage = new SupabaseResumeStorage('https://example.supabase.co','private-test-key','applyweave-resumes',async(input,init)=>{
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private-test-key');
    assert.equal(new Headers(init?.headers).get('apikey'),'private-test-key');
    if(String(input).includes('/bucket/')) return Response.json({public:true});
    return pdfResponse();
  });
  await assert.rejects(storage.ensurePrivateBucket(),/must be private/);
  assert.deepEqual(await storage.download('resume.pdf'),pdf);
});
test('upload is idempotent only for equal bytes and refuses overwrite conflicts',async()=>{
  let existing=pdf;
  const storage = new SupabaseResumeStorage('https://example.supabase.co','key','applyweave-resumes',async(_input,init)=>{
    if(init?.method==='POST') {
      assert.equal(new Headers(init.headers).get('x-upsert'),'false');
      return new Response('',{status:409});
    }
    return pdfResponse(existing);
  });
  await storage.upload('resume.pdf',pdf);
  existing=Buffer.from('%PDF-1.7\ndifferent\n%%EOF');
  await assert.rejects(storage.upload('resume.pdf',pdf),/different resume already exists/);
});
test('download rejects disguised files and oversized streaming responses',async()=>{
  const badType = new SupabaseResumeStorage('https://example.supabase.co','key','applyweave-resumes',async()=>new Response(pdf,{headers:{'content-type':'text/html'}}));
  await assert.rejects(badType.download('resume.pdf'),/not a valid PDF/);
  const tooBig = new SupabaseResumeStorage('https://example.supabase.co','key','applyweave-resumes',async()=>pdfResponse(Buffer.alloc(MAX_RESUME_BYTES+1)));
  await assert.rejects(tooBig.download('resume.pdf'),/exceeds/);
});
