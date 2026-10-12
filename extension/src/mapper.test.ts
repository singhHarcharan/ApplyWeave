import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { scanDocument, fillDocument } from './mapper';
import { parseAnswerPack, parseExportBundle, parseProfile, resetChangedApprovals, type AnswerPack, type ProfileExport } from './contracts';
import { isAllowedUrl, isBlockedHost } from './policy';

const profile: ProfileExport = {schemaVersion:1, profileVersion:'2026-10-12', personal:{fullName:'Example Candidate', email:'candidate@example.test', phone:'1234567890'}, facts:[{id:'F1', claim:'Built a project', source:'resume'}], standardAnswers:[], resumeVersions:[{id:'SDE', filename:'resume.pdf'}]};

test('domain policy blocks job boards even if allowlisted', () => {
  assert.equal(isBlockedHost('apply.linkedin.com'), true);
  assert.equal(isBlockedHost('wellfound.com'), true);
  assert.equal(isAllowedUrl('https://apply.linkedin.com/jobs', ['apply.linkedin.com']), false);
  assert.equal(isAllowedUrl('https://jobs.example.test/apply', ['jobs.example.test']), true);
  assert.equal(isAllowedUrl('https://other.example.test/apply', ['jobs.example.test']), false);
  assert.equal(isAllowedUrl('http://localhost:8000/test-form.html', []), false);
  assert.equal(isAllowedUrl('http://localhost:8000/test-form.html', ['localhost']), true);
  assert.equal(isAllowedUrl('http://jobs.example.test/apply', ['jobs.example.test']), false);
});

test('scan uses labels and skips sensitive or unsupported inputs', () => {
  const dom = new JSDOM(`<form><label>Full name<input></label><label>Email address<input type="email"></label><label>Expected salary<input></label><label>Password<input type="password"></label><button type="submit">Apply</button></form>`);
  const {matches, manualFields} = scanDocument(dom.window.document, profile);
  assert.deepEqual(matches.map(match => match.key), ['fullName', 'email']);
  assert.equal(matches[0].proposedValue, 'Example Candidate');
  assert.deepEqual(manualFields.map(field => field.label), ['Expected salary', 'Password']);
});

test('fill never overwrites an existing field or submits the form', () => {
  const dom = new JSDOM(`<form><label>Full name<input value="Existing Name"></label><label>Email address<input type="email"></label><button type="submit">Apply</button></form>`);
  let submissions = 0;
  dom.window.document.querySelector('form')!.addEventListener('submit', () => submissions++);
  const scanned = new Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>();
  const {matches} = scanDocument(dom.window.document, profile, undefined,
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
  const {matches} = scanDocument(dom.window.document, profile, undefined,
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
  const {matches} = scanDocument(dom.window.document, profile, undefined,
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

test('education fields use approved values and unsupported fields explain manual work', () => {
  const educated = {...profile, personal:{...profile.personal, educationInstitution:'Example University', educationDegree:'B.Tech', educationField:'Computer Science', graduationYear:'2024'}};
  const dom = new JSDOM(`<form><label>University<input></label><label>Degree<input></label><label>Field of study<input></label><label>Graduation year<input type="number"></label><label>Resume<input type="file"></label><label>Current salary<input></label><label>Unknown question<textarea></textarea></label></form>`);
  const result = scanDocument(dom.window.document, educated);
  assert.deepEqual(result.matches.map(match => match.proposedValue), ['Example University', 'B.Tech', 'Computer Science', '2024']);
  assert.deepEqual(result.manualFields.map(field => field.reason), ['Upload the file manually', 'Requires your review', 'No approved match']);
});

test('an exact approved standard answer can fill a matching question', () => {
  const withAnswer = {...profile, standardAnswers:[{key:'Why this role', text:'My work matches the role.', factIds:['F1']}]};
  const dom = new JSDOM(`<label>Why this role<textarea></textarea></label>`);
  const result = scanDocument(dom.window.document, withAnswer);
  assert.equal(result.matches[0].proposedValue, 'My work matches the role.');
  assert.equal(result.matches[0].confidence, 'medium');
});

test('a nearby label is not reused for several unrelated inputs', () => {
  const dom = new JSDOM(`<form><div><label>Email address</label><input><input></div></form>`);
  const result = scanDocument(dom.window.document, profile);
  assert.equal(result.matches.length, 0);
  assert.equal(result.manualFields.length, 2);
});

test('local sample company form previews approved fields and leaves salary manual', () => {
  const html = readFileSync(new URL('../test-form.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const scanned = new Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>();
  const result = scanDocument(dom.window.document, profile, undefined,
    (match, element) => scanned.set(match.id, {element, value: match.proposedValue, label: match.label}));
  assert.deepEqual(result.matches.map(match => match.key), ['fullName', 'email', 'phone']);
  assert.ok(result.manualFields.some(field => field.label === 'Expected salary' && field.reason === 'Requires your review'));
  const fill = fillDocument(dom.window.document, result.matches.map(match => ({id:match.id, value:match.proposedValue})), scanned);
  assert.equal(fill.filled, 3);
  assert.equal((dom.window.document.querySelector('input[name="salary"]') as HTMLInputElement).value, '');
});

test('bundle import validates resume, unique questions, length, and changed approvals', () => {
  const original: AnswerPack = {schemaVersion:1, applicationId:'AW-1', profileVersion:profile.profileVersion, resumeVersionId:'SDE', answers:[{question:'Why this role?', answer:'Built a project', factIds:['F1'], approved:true, maxCharacters:100}]};
  const parsed = parseExportBundle({profile, pack:original});
  assert.equal(parsed.pack?.answers[0].approved, true);
  assert.equal(parseExportBundle({profile, pack:null}).pack, null);
  assert.equal(parseAnswerPack({...original, answers:[{...original.answers[0], maxCharacters:null}]}, profile).answers[0].approved, true);
  assert.throws(() => parseAnswerPack({...original, resumeVersionId:'missing'}, profile), /resume that is not/);
  assert.throws(() => parseAnswerPack({...original, answers:[...original.answers, {...original.answers[0], question:'why THIS role?'}]}, profile), /duplicate questions/);
  assert.throws(() => parseAnswerPack({...original, answers:[{...original.answers[0], maxCharacters:3}]}, profile), /character limit/);
  const changed = resetChangedApprovals({...original, answers:[{...original.answers[0], answer:'A different claim'}]}, original, profile, profile);
  assert.equal(changed.answers[0].approved, false);
  const changedProfile = {...profile, personal:{...profile.personal, phone:'9876543210'}};
  assert.equal(resetChangedApprovals(original, original, profile, changedProfile).answers[0].approved, false);
});
