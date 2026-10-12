import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

function makeTracker() {
  const rows = [Array(23).fill(''), Array(22).fill('').concat('FORMULA')];
  const sheet = {
    getLastRow() { return rows.length; },
    getMaxRows() { return Math.max(rows.length, 20); },
    insertRowsAfter(index, count) { rows.splice(index, 0, ...Array.from({length:count}, () => Array(23).fill(''))); },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues() { return Array.from({length: height}, (_, i) => Array.from({length: width}, (_, j) => rows[row + i - 1]?.[column + j - 1] ?? '')); },
        setValues(values) { values.forEach((valueRow, i) => { const destination = row + i - 1; rows[destination] ||= Array(23).fill(''); valueRow.forEach((value, j) => { rows[destination][column + j - 1] = value; }); }); return this; },
        setRichTextValue(value) { rows[row - 1][column - 1] = value.text; return this; }
      };
    }
  };
  const lockState = {acquired:0, released:0};
  const lock = {waitLock(){lockState.acquired++;},releaseLock(){lockState.released++;}};
  const context = {SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}), newRichTextValue:()=>({setText(text){this.text=text;return this;},setLinkUrl(){return this;},build(){return this;}})}, LockService:{getDocumentLock:()=>lock}, Utilities:{formatDate:()=> '20261013', getUuid:()=> 'abcdef12-1234'}, Session:{getScriptTimeZone:()=> 'Asia/Kolkata'}, Date, Set, Number, String, Error};
  return {rows, context, lockState};
}

const source = await readFile(new URL('./Code.gs', import.meta.url), 'utf8');
test('application lifecycle keeps stable ID, prevents duplicates, and preserves active offers', () => {
  const {rows, context, lockState} = makeTracker();
  const api = vm.runInNewContext(source + '\n({addApplication, updateApplication, getDueActions, listApplications})', context);
  const saved = api.addApplication({company:'Example Co', title:'Backend Engineer', jobUrl:'https://example.test/job/1', roleFamily:'Backend Engineer'});
  assert.match(saved.applicationId, /^AW-20261013-ABCDEF12$/);
  assert.equal(rows[1][11], 'Saved');
  assert.equal(rows[1][14], 'Review JD and prepare application');
  assert.equal(api.getDueActions().length, 1);
  assert.throws(() => api.addApplication({company:'Example Co', title:'Backend Engineer', jobUrl:'https://example.test/job/1'}), /Possible duplicate/);
  api.updateApplication({applicationId:saved.applicationId, status:'Applied', resumeVersion:'resume.pdf'});
  assert.equal(rows[1][11], 'Applied');
  assert.equal(rows[1][14], 'Follow up');
  assert.ok(rows[1][10] instanceof Date);
  assert.ok(rows[1][15] > rows[1][10]);
  api.updateApplication({applicationId:saved.applicationId, status:'Offer'});
  assert.equal(rows[1][14], 'Review offer');
  assert.ok(rows[1][15] instanceof Date);
  api.updateApplication({applicationId:saved.applicationId, status:'Rejected', outcome:'Position closed'});
  assert.equal(rows[1][14], '');
  assert.equal(rows[1][15], '');
  assert.equal(api.getDueActions().length, 0);
  assert.equal(api.listApplications()[0].id, saved.applicationId);
  assert.equal(lockState.acquired, lockState.released);
});

test('approved profile imports only into an empty tab and exports a versioned contract', () => {
  const rows = [Array(7).fill(''), ['', '', '', '', false, '', '']];
  const sheet = {
    getLastRow: () => rows.length,
    getRange(row, column, height = 1, width = 1) { return {
      getValues: () => Array.from({length:height}, (_, i) => Array.from({length:width}, (_, j) => rows[row + i - 1]?.[column + j - 1] ?? '')),
      setValues: values => { values.forEach((entry, i) => { rows[row + i - 1] = entry; }); }
    }; }
  };
  const context = {SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_algorithm,text)=>Array.from(createHash('sha256').update(text).digest()),base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),formatDate:()=> '2026-10-13'},Session:{getScriptTimeZone:()=> 'Asia/Kolkata'},Date,Set,Number,String,Error,Object};
  const api = vm.runInNewContext(source + '\n({importApprovedProfile, exportApprovedProfile})', context);
  const input = {schemaVersion:1, personal:{fullName:'Example Candidate'}, facts:[{id:'F1',claim:'Built a project',source:'candidate'}],standardAnswers:[],resumeVersions:[{id:'SDE',filename:'resume.pdf'}]};
  assert.equal(api.importApprovedProfile(input).importedRows, 3);
  assert.throws(() => api.importApprovedProfile(input), /already has rows/);
  const output = api.exportApprovedProfile();
  assert.equal(output.personal.fullName, 'Example Candidate');
  assert.equal(output.facts[0].id, 'F1');
  assert.match(output.profileVersion, /^AW-[A-Za-z0-9_-]{12}$/);
  assert.equal(api.exportApprovedProfile().profileVersion, output.profileVersion);
});

test('preparing without a due date remains actionable and response details can be edited', () => {
  const {rows, context, lockState} = makeTracker();
  const api = vm.runInNewContext(source + '\n({addApplication, updateApplication, getDueActions})', context);
  const saved = api.addApplication({company:'Example Co', title:'Frontend Engineer'});
  api.updateApplication({applicationId:saved.applicationId, status:'Preparing', recruiterContact:'Recruiter Name', responseDate:'2026-10-13', outcome:'Recruiter replied'});
  assert.equal(rows[1][17], 'Recruiter Name');
  assert.ok(rows[1][18] instanceof Date);
  assert.equal(rows[1][20], 'Recruiter replied');
  rows[1][15] = '';
  assert.equal(api.getDueActions()[0].applicationId, saved.applicationId);
  assert.equal(lockState.acquired, lockState.released);
});

test('formula-like application text is escaped and duplicate failures release the lock', () => {
  const {rows, context, lockState} = makeTracker();
  const api = vm.runInNewContext(source + '\n({addApplication, updateApplication})', context);
  const saved = api.addApplication({company:'=IMPORTXML("bad")', title:'Backend Engineer', notes:'@SUM(A1)'});
  assert.equal(rows[1][1], '\'=IMPORTXML("bad")');
  assert.equal(rows[1][21], '\'@SUM(A1)');
  assert.throws(() => api.addApplication({company:'=IMPORTXML("bad")', title:'Backend Engineer'}), /Possible duplicate/);
  api.updateApplication({applicationId:saved.applicationId, status:'Applied', recruiterContact:'=NOW()'});
  assert.equal(rows[1][17], "'=NOW()");
  assert.equal(lockState.acquired, lockState.released);
});

test('editing approved profile wording clears its approval and review date', () => {
  const cells = [];
  const sheet = {getName:()=> 'Profile & Answers', getRange(row,column,height,width){return {setValue(value){cells.push({row,column,height,width,value});},clearContent(){cells.push({row,column,height,width,cleared:true});}};}};
  const range = {getSheet:()=>sheet,getRow:()=>3,getColumn:()=>3,getNumRows:()=>2,getNumColumns:()=>1};
  const api = vm.runInNewContext(source + '\n({onEdit})', {Date,Set,Number,String,Error});
  api.onEdit({range});
  assert.deepEqual(cells, [
    {row:3,column:5,height:2,width:1,value:false},
    {row:3,column:6,height:2,width:1,cleared:true}
  ]);
});
