import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
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
  const context = {SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}), newRichTextValue:()=>({setText(text){this.text=text;return this;},setLinkUrl(){return this;},build(){return this;}})}, Utilities:{formatDate:()=> '20261013', getUuid:()=> 'abcdef-1234'}, Session:{getScriptTimeZone:()=> 'Asia/Kolkata'}, Date, Set, Number, String, Error};
  return {rows, context};
}

const source = await readFile(new URL('./Code.gs', import.meta.url), 'utf8');
test('application lifecycle keeps stable ID, prevents duplicates, and preserves active offers', () => {
  const {rows, context} = makeTracker();
  const api = vm.runInNewContext(source + '\n({addApplication, updateApplication, getDueActions, listApplications})', context);
  const saved = api.addApplication({company:'Example Co', title:'Backend Engineer', jobUrl:'https://example.test/job/1', roleFamily:'Backend Engineer'});
  assert.match(saved.applicationId, /^AW-20261013-ABCDEF$/);
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
});
