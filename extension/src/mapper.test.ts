import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { scanDocument, fillDocument } from './mapper';
import { parseAnswerPack, parseProfile, type ProfileExport } from './contracts';
import { isAllowedUrl, isBlockedHost } from './policy';

const profile: ProfileExport = {schemaVersion:1, profileVersion:'2026-10-12', personal:{fullName:'Example Candidate', email:'candidate@example.test', phone:'1234567890'}, facts:[{id:'F1', claim:'Built a project', source:'resume'}], standardAnswers:[], resumeVersions:[]};

test('domain policy blocks job boards even if allowlisted', () => {
  assert.equal(isBlockedHost('apply.linkedin.com'), true);
  assert.equal(isBlockedHost('wellfound.com'), true);
  assert.equal(isAllowedUrl('https://apply.linkedin.com/jobs', ['apply.linkedin.com']), false);
  assert.equal(isAllowedUrl('https://jobs.example.test/apply', ['jobs.example.test']), true);
  assert.equal(isAllowedUrl('https://other.example.test/apply', ['jobs.example.test']), false);
});

test('scan uses labels and skips sensitive or unsupported inputs', () => {
  const dom = new JSDOM(`<form><label>Full name<input></label><label>Email address<input type="email"></label><label>Expected salary<input></label><label>Password<input type="password"></label><button type="submit">Apply</button></form>`);
  const matches = scanDocument(dom.window.document, profile);
  assert.deepEqual(matches.map(match => match.key), ['fullName', 'email']);
  assert.equal(matches[0].proposedValue, 'Example Candidate');
});

test('fill never overwrites an existing field or submits the form', () => {
  const dom = new JSDOM(`<form><label>Full name<input value="Existing Name"></label><label>Email address<input type="email"></label><button type="submit">Apply</button></form>`);
  let submissions = 0;
  dom.window.document.querySelector('form')!.addEventListener('submit', () => submissions++);
  const scanned = new Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>();
  const matches = scanDocument(dom.window.document, profile, undefined,
    (match, element) => scanned.set(match.id, {element, value: match.proposedValue, label: match.label}));
  const result = fillDocument(dom.window.document, matches.map(match => ({id: match.id, value: match.proposedValue})), scanned);
  assert.equal(result.filled, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(dom.window.document.querySelector('input')!.value, 'Existing Name');
  assert.equal(dom.window.document.querySelectorAll('input')[1].value, 'candidate@example.test');
  assert.equal(submissions, 0);
});

test('hidden fields are not suggested, and a changed field is skipped after preview', () => {
  const dom = new JSDOM(`<form><label hidden>Full name<input></label><label>Email address<input type="email"></label></form>`);
  const scanned = new Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>();
  const matches = scanDocument(dom.window.document, profile, undefined,
    (match, element) => scanned.set(match.id, {element, value: match.proposedValue, label: match.label}));
  assert.deepEqual(matches.map(match => match.key), ['email']);
  const email = dom.window.document.querySelectorAll('input')[1];
  email.closest('label')!.firstChild!.textContent = 'Expected salary';
  assert.equal(fillDocument(dom.window.document, [{id: matches[0].id, value: matches[0].proposedValue}], scanned).filled, 0);
  assert.equal(email.value, '');
});

test('fill rejects a changed proposal and a replaced field after preview', () => {
  const dom = new JSDOM(`<form><label>Email address<input type="email"></label></form>`);
  const scanned = new Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>();
  const matches = scanDocument(dom.window.document, profile, undefined,
    (match, element) => scanned.set(match.id, {element, value: match.proposedValue, label: match.label}));
  assert.equal(fillDocument(dom.window.document, [{id: matches[0].id, value: 'other@example.test'}], scanned).filled, 0);
  const old = scanned.get(matches[0].id)!.element;
  old.replaceWith(old.cloneNode(true));
  assert.equal(fillDocument(dom.window.document, [{id: matches[0].id, value: matches[0].proposedValue}], scanned).filled, 0);
});

test('answer pack requires matching profile version and supporting facts', () => {
  const pack = {schemaVersion:1, applicationId:'AW-1', profileVersion:'old', resumeVersionId:'SDE', answers:[{question:'What did you build?',answer:'A project',factIds:['F1'],approved:true}]};
  assert.throws(() => parseAnswerPack(pack, profile), /versions differ/);
  pack.profileVersion = profile.profileVersion;
  pack.answers[0].factIds = ['missing'];
  assert.throws(() => parseAnswerPack(pack, profile), /missing profile fact/);
});

test('malformed imported profile and answer data are rejected', () => {
  assert.throws(() => parseProfile({...profile, personal: {email: 10}}), /Unsupported profile export/);
  const pack = {schemaVersion:1, applicationId:'AW-1', profileVersion:profile.profileVersion, resumeVersionId:'SDE', answers:[{question:'Why?', answer:'A project', factIds:['F1'], approved:'yes'}]};
  assert.throws(() => parseAnswerPack(pack, profile), /incomplete answer/);
});
