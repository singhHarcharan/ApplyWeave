import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Application, AnswerPack, Preferences, ProfileExport, Status } from '../shared/types.js';
import { ROLE_FAMILIES, SOURCES, STATUSES, WORK_MODES } from '../shared/types.js';

export class AppError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_INPUT', public details: Record<string, unknown> = {}) { super(message); }
}
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const text = (v: unknown, label: string, max = 10000): string => {
  if (typeof v !== 'string' || v.length > max) throw new AppError(`${label} must be text under ${max} characters.`);
  return v.trim();
};
const optionalText = (v: unknown, label: string, max = 10000) => v === undefined || v === null ? '' : text(v, label, max);
const date = (v: unknown, label: string, optional = true): string => {
  const value = optionalText(v, label, 10);
  if (!value && optional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new AppError(`${label} needs YYYY-MM-DD.`);
  return value;
};
const choice = (v: unknown, label: string, choices: readonly string[], fallback = '') => {
  const value = v === undefined || v === null || v === '' ? fallback : text(v, label, 100);
  if (value && !choices.includes(value)) throw new AppError(`Unknown ${label}.`);
  return value;
};
const compensation = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100000) throw new AppError('Compensation must be a non-negative LPA number.');
  return v;
};
const url = (v: unknown) => {
  const value = optionalText(v, 'Job URL', 2048);
  if (!value) return '';
  try { const parsed = new URL(value); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(); }
  catch { throw new AppError('Job URL must be an http or https URL.'); }
  return value;
};
export const applicationId = () => `AW-${today().replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
export const normalizeDuplicateUrl = (value: string) => {
  if (!value) return '';
  try { const parsed = new URL(value); parsed.hash = ''; return parsed.toString().replace(/\/$/, '').toLowerCase(); }
  catch { return value.trim().toLowerCase(); }
};
export function duplicateOf(apps: Application[], candidate: Pick<Application, 'company'|'title'|'jobUrl'>, exceptId = ''): Application | undefined {
  const normalizedUrl = normalizeDuplicateUrl(candidate.jobUrl);
  const name = candidate.company.trim().toLocaleLowerCase();
  const title = candidate.title.trim().toLocaleLowerCase();
  return apps.find(app => app.applicationId !== exceptId && ((normalizedUrl && normalizeDuplicateUrl(app.jobUrl) === normalizedUrl) || (app.company.trim().toLocaleLowerCase() === name && app.title.trim().toLocaleLowerCase() === title)));
}
const defaultsForStatus = (status: Status): {action:string; days:number} => ({
  Saved: {action:'Review JD and prepare application', days:0}, Preparing: {action:'Complete application', days:1},
  Applied: {action:'Follow up', days:7}, Assessment: {action:'Complete assessment', days:1},
  Interview: {action:'Prepare for interview', days:1}, Offer: {action:'Review offer', days:1},
  Rejected: {action:'', days:0}, Withdrawn: {action:'', days:0}
})[status];
const afterDays = (days: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); };

export function createApplication(input: Record<string, unknown>, apps: Application[]): Application {
  const company = text(input.company, 'Company', 200), title = text(input.title, 'Job title', 200);
  if (!company || !title) throw new AppError('Company and job title are required.');
  const status = choice(input.status, 'status', STATUSES, 'Saved') as Status;
  const workMode = choice(input.workMode, 'work mode', WORK_MODES, 'Unknown');
  const jobUrl = url(input.jobUrl);
  const next = defaultsForStatus(status);
  const app: Application = {
    applicationId: applicationId(), company, title, roleFamily: choice(input.roleFamily, 'role family', ROLE_FAMILIES),
    source: choice(input.source, 'source', SOURCES), jobUrl, location: optionalText(input.location, 'Location', 200), workMode,
    compensationLpa: compensation(input.compensationLpa), dateSaved: date(input.dateSaved, 'Date saved') || today(), dateApplied: date(input.dateApplied, 'Date applied'), status,
    resumeVersion: optionalText(input.resumeVersion, 'Resume version', 100), answerPackId: '',
    nextAction: status === 'Rejected' || status === 'Withdrawn' ? '' : optionalText(input.nextAction, 'Next action', 500) || next.action,
    dueDate: status === 'Rejected' || status === 'Withdrawn' ? '' : date(input.dueDate, 'Due date') || afterDays(next.days),
    lastUpdated: new Date().toISOString(), recruiter: optionalText(input.recruiter, 'Recruiter', 200),
    responseDate: date(input.responseDate, 'Response date'), interviewDate: date(input.interviewDate, 'Interview date'),
    outcome: optionalText(input.outcome, 'Outcome', 500), notes: optionalText(input.notes, 'Notes', 20000),
    jobDescription: optionalText(input.jobDescription, 'Job description', 100000), syncStatus: 'pending'
  };
  if (app.dateSaved > today()) throw new AppError('Date saved cannot be in the future.');
  if (status === 'Applied' && !app.dateApplied) app.dateApplied = today();
  const duplicate = duplicateOf(apps, app);
  if (duplicate && input.allowDuplicate !== true) throw new AppError('Possible duplicate application.', 409, 'DUPLICATE', { applicationId: duplicate.applicationId });
  return app;
}

export function patchApplication(original: Application, input: Record<string, unknown>, apps: Application[]): Application {
  const app = { ...original };
  const setText = (key: keyof Application, label: string, max: number) => { if (input[key] !== undefined) (app as unknown as Record<string, unknown>)[key] = optionalText(input[key], label, max); };
  setText('company', 'Company', 200); setText('title', 'Job title', 200);
  if (!app.company || !app.title) throw new AppError('Company and job title are required.');
  if (input.roleFamily !== undefined) app.roleFamily = choice(input.roleFamily, 'role family', ROLE_FAMILIES);
  if (input.source !== undefined) app.source = choice(input.source, 'source', SOURCES);
  if (input.workMode !== undefined) app.workMode = choice(input.workMode, 'work mode', WORK_MODES, 'Unknown');
  if (input.status !== undefined) app.status = choice(input.status, 'status', STATUSES) as Status;
  if (input.jobUrl !== undefined) app.jobUrl = url(input.jobUrl);
  if (input.compensationLpa !== undefined) app.compensationLpa = compensation(input.compensationLpa);
  if (input.dateSaved !== undefined) app.dateSaved = date(input.dateSaved, 'Date saved', false);
  if (app.dateSaved > today()) throw new AppError('Date saved cannot be in the future.');
  for (const key of ['location','resumeVersion','nextAction','recruiter','outcome'] as const) setText(key, key, key === 'nextAction' || key === 'outcome' ? 500 : 200);
  for (const key of ['notes','jobDescription'] as const) setText(key, key, key === 'notes' ? 20000 : 100000);
  for (const key of ['dateApplied','dueDate','responseDate','interviewDate'] as const) if (input[key] !== undefined) app[key] = date(input[key], key);
  if (app.status === 'Applied' && original.status !== 'Applied' && !app.dateApplied) app.dateApplied = today();
  if (app.status === 'Rejected' || app.status === 'Withdrawn') { app.nextAction = ''; app.dueDate = ''; }
  else if (app.status !== original.status) {
    const defaults = defaultsForStatus(app.status);
    // The drawer sends every field. Unchanged old action/date are not deliberate overrides of new-stage defaults.
    if (input.nextAction === undefined || optionalText(input.nextAction,'Next action',500) === original.nextAction) app.nextAction = defaults.action;
    if (input.dueDate === undefined || date(input.dueDate,'Due date') === original.dueDate) app.dueDate = afterDays(defaults.days);
  }
  const duplicate = duplicateOf(apps, app, app.applicationId);
  if (duplicate && input.allowDuplicate !== true) throw new AppError('Possible duplicate application.', 409, 'DUPLICATE', { applicationId: duplicate.applicationId });
  app.lastUpdated = new Date().toISOString();
  const syncedKeys = Object.keys(input).filter(key => !['jobDescription','allowDuplicate'].includes(key));
  if (syncedKeys.length) app.syncStatus = 'pending';
  return app;
}

export function validateProfile(input: unknown, previous?: ProfileExport): ProfileExport {
  if (!input || typeof input !== 'object') throw new AppError('Profile must be an object.');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || !value.personal || typeof value.personal !== 'object' || Array.isArray(value.personal) || !Array.isArray(value.facts) || !Array.isArray(value.standardAnswers) || !Array.isArray(value.resumeVersions)) throw new AppError('Unsupported profile format.');
  const personal: Record<string,string> = {};
  for (const [key, raw] of Object.entries(value.personal)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key) || /password|token|cookie|secret|government/i.test(key)) throw new AppError('Unsupported profile contact field.');
    const field = text(raw, `Contact ${key}`, 1000); if (field) personal[key] = field;
  }
  const ids = new Set<string>();
  const facts = value.facts.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new AppError('Invalid profile fact.');
    const f = raw as Record<string, unknown>; const id = text(f.id, 'Fact ID', 50), claim = text(f.claim, 'Fact claim', 5000), source = text(f.source, 'Fact source', 500);
    if (!id || !claim || !source || ids.has(id)) throw new AppError('Facts need unique IDs, claims, and sources.');
    ids.add(id); return {id, claim, source};
  });
  const answerKeys = new Set<string>();
  const standardAnswers = value.standardAnswers.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new AppError('Invalid standard answer.');
    const a = raw as Record<string, unknown>; const key = text(a.key, 'Answer key', 100), answerText = text(a.text, 'Answer text', 5000);
    if (!key || !answerText || answerKeys.has(key) || !Array.isArray(a.factIds) || !a.factIds.length || a.factIds.some((id: unknown) => !ids.has(id as string))) throw new AppError('Standard answers need a unique key and approved supporting facts.');
    answerKeys.add(key); return {key, text:answerText, factIds:a.factIds as string[]};
  });
  const resumeIds = new Set<string>();
  const resumeVersions = value.resumeVersions.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new AppError('Invalid resume version.');
    const r = raw as Record<string, unknown>; const id = text(r.id, 'Resume ID', 50), filename = text(r.filename, 'Resume filename', 255);
    if (!id || !filename || !filename.toLowerCase().endsWith('.pdf') || filename !== path.basename(filename) || resumeIds.has(id)) throw new AppError('Resume catalogue needs unique IDs and PDF basenames.');
    resumeIds.add(id); return {id, filename};
  });
  const content = {schemaVersion:1 as const, personal, facts, standardAnswers, resumeVersions};
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('base64url').slice(0,8);
  const unchanged = previous && JSON.stringify({schemaVersion:1,personal:previous.personal,facts:previous.facts,standardAnswers:previous.standardAnswers,resumeVersions:previous.resumeVersions}) === JSON.stringify(content);
  return {...content, profileVersion: unchanged ? previous.profileVersion : `${today()}-${hash}`};
}

export function validatePack(input: unknown, profile: ProfileExport, applicationIdExpected: string): AnswerPack {
  if (!input || typeof input !== 'object') throw new AppError('Answer pack must be an object.');
  const p = input as Record<string, unknown>;
  if (p.schemaVersion !== 1 || p.applicationId !== applicationIdExpected || p.profileVersion !== profile.profileVersion || !Array.isArray(p.answers)) throw new AppError('Pack needs the matching application and profile version.', 409, 'STALE_PACK');
  const resumeVersionId = text(p.resumeVersionId, 'Resume version', 50);
  if (!profile.resumeVersions.some(r => r.id === resumeVersionId)) throw new AppError('Resume version is not in the approved profile.');
  const factIds = new Set(profile.facts.map(f => f.id));
  const seen = new Set<string>();
  const answers = p.answers.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new AppError('Invalid answer.');
    const a = raw as Record<string, unknown>; const question = text(a.question, 'Question', 1000), answer = text(a.answer, 'Answer', 10000);
    if (!question || !answer || seen.has(question.toLowerCase().replace(/\s+/g, ' '))) throw new AppError('Answers need unique questions and non-empty text.');
    seen.add(question.toLowerCase().replace(/\s+/g, ' '));
    if (!Array.isArray(a.factIds) || !a.factIds.length || a.factIds.some((id: unknown) => !factIds.has(id as string))) throw new AppError('Each answer needs approved supporting fact IDs.');
    if (typeof a.approved !== 'boolean') throw new AppError('Each answer needs an approval state.');
    const maxCharacters = a.maxCharacters === undefined || a.maxCharacters === null ? null : a.maxCharacters;
    if (maxCharacters !== null && (!Number.isInteger(maxCharacters) || (maxCharacters as number) < 1 || (maxCharacters as number) > 100000)) throw new AppError('Invalid character limit.');
    if (maxCharacters !== null && answer.length > (maxCharacters as number)) throw new AppError('Answer exceeds its character limit.');
    return {question, answer, factIds:a.factIds as string[], approved:a.approved, maxCharacters:maxCharacters as number|null};
  });
  let analysis: AnswerPack['analysis'];
  if (p.analysis && typeof p.analysis === 'object') {
    const a = p.analysis as Record<string, unknown>;
    analysis = {
      fit:optionalText(a.fit,'Fit',100), summary:optionalText(a.summary,'Summary',5000), resumeReason:optionalText(a.resumeReason,'Resume reason',2000),
      proofPoints:Array.isArray(a.proofPoints) ? a.proofPoints.map((point: unknown) => { const q = point as Record<string,unknown>; const ids = Array.isArray(q?.factIds) ? q.factIds : []; const proof = optionalText(q?.text,'Proof point',2000); if (!proof || !ids.length || ids.some(id => !factIds.has(id as string))) throw new AppError('Proof point needs wording and approved supporting facts.'); return {text:proof, factIds:ids as string[]}; }) : [],
      unknowns:Array.isArray(a.unknowns) ? a.unknowns.map((value: unknown) => text(value,'Unknown',1000)) : [],
      workModeCheck:optionalText(a.workModeCheck,'Work mode check',500), compensationCheck:optionalText(a.compensationCheck,'Compensation check',500)
    };
  }
  return {schemaVersion:1, applicationId:applicationIdExpected, profileVersion:profile.profileVersion, resumeVersionId, ...(analysis ? {analysis} : {}), answers};
}

export function validatePreferences(input: unknown): Preferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Preferences must be an object.');
  const value = input as Record<string,unknown>;
  const clean: Preferences = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) throw new AppError('Invalid preference key.');
    if (typeof raw === 'string') clean[key] = text(raw,key,2000);
    else if (typeof raw === 'number' && Number.isFinite(raw)) clean[key] = raw;
    else if (typeof raw === 'boolean' || raw === null) clean[key] = raw;
    else if (Array.isArray(raw) && raw.length <= 100 && raw.every(item => typeof item === 'string' && item.length <= 200)) clean[key] = raw.map(item => item.trim());
    else throw new AppError(`Invalid ${key} preference.`);
  }
  return clean;
}
