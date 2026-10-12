export type ProfileExport = {
  schemaVersion: 1;
  profileVersion: string;
  personal: Record<string, string>;
  facts: Array<{ id: string; claim: string; source: string }>;
  standardAnswers: Array<{ key: string; text: string; factIds: string[] }>;
  resumeVersions: Array<{ id: string; filename: string }>;
};

export type AnswerPack = {
  schemaVersion: 1;
  applicationId: string;
  profileVersion: string;
  resumeVersionId: string;
  answers: Array<{ question: string; answer: string; factIds: string[]; approved: boolean; maxCharacters?: number | null }>;
};

export type FieldMatch = {
  id: string;
  label: string;
  key: string;
  proposedValue: string;
  currentValue: string;
  confidence: 'high' | 'medium';
};

export type ManualField = { id: string; label: string; reason: string };
export type ScanResult = { matches: FieldMatch[]; manualFields: ManualField[] };
export type ExportBundle = { profile: ProfileExport; pack: AnswerPack | null };

const MAX_TEXT = 5000;
const MAX_ANSWER = 10000;
const nonEmpty = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const unique = (values: string[]) => new Set(values.map(value => value.trim().toLowerCase())).size === values.length;

export function parseProfile(input: unknown): ProfileExport {
  if (!input || typeof input !== 'object') throw new Error('Profile JSON must be an object.');
  const p = input as Partial<ProfileExport>;
  if (p.schemaVersion !== 1 || !nonEmpty(p.profileVersion, 120) ||
      !p.personal || typeof p.personal !== 'object' || Array.isArray(p.personal) ||
      Object.entries(p.personal).length > 50 || Object.entries(p.personal).some(([key, value]) => !nonEmpty(key, 100) || typeof value !== 'string' || value.length > MAX_TEXT) ||
      !Array.isArray(p.facts) || p.facts.length > 500 || p.facts.some(fact => !fact || !nonEmpty(fact.id, 100) || !nonEmpty(fact.claim) || typeof fact.source !== 'string' || fact.source.length > 1000) ||
      !unique(p.facts.map(fact => fact.id)) ||
      (p.standardAnswers !== undefined && !Array.isArray(p.standardAnswers)) ||
      (p.resumeVersions !== undefined && !Array.isArray(p.resumeVersions))) {
    throw new Error('Unsupported profile export. Use the approved Sheet export.');
  }
  const standardAnswers = p.standardAnswers || [];
  const resumeVersions = p.resumeVersions || [];
  const factIds = new Set(p.facts.map(fact => fact.id));
  if (standardAnswers.length > 200 || standardAnswers.some(answer => !answer || !nonEmpty(answer.key, 200) || !nonEmpty(answer.text) ||
      !Array.isArray(answer.factIds) || !answer.factIds.length || answer.factIds.some(id => !factIds.has(id))) ||
      !unique(standardAnswers.map(answer => answer.key)) ||
      resumeVersions.length > 50 || resumeVersions.some(resume => !resume || !nonEmpty(resume.id, 100) || !nonEmpty(resume.filename, 300)) ||
      !unique(resumeVersions.map(resume => resume.id))) {
    throw new Error('Profile export has invalid or duplicate answers, facts, or resumes.');
  }
  return {schemaVersion: 1, profileVersion: p.profileVersion, personal: p.personal as Record<string, string>, facts: p.facts, standardAnswers, resumeVersions};
}

export function parseAnswerPack(input: unknown, profile: ProfileExport): AnswerPack {
  if (!input || typeof input !== 'object') throw new Error('Answer pack JSON must be an object.');
  const p = input as Partial<AnswerPack>;
  if (p.schemaVersion !== 1 || !nonEmpty(p.applicationId, 100) ||
      !nonEmpty(p.resumeVersionId, 100) || !Array.isArray(p.answers) || p.answers.length > 100) throw new Error('Unsupported answer pack.');
  if (p.profileVersion !== profile.profileVersion) throw new Error('Answer pack and profile versions differ. Re-approve the pack.');
  if (!profile.resumeVersions.some(resume => resume.id === p.resumeVersionId)) throw new Error('Answer pack references a resume that is not in the approved profile.');
  const approvedIds = new Set(profile.facts.map(f => f.id));
  if (!unique(p.answers.map(answer => String(answer?.question || '')))) throw new Error('Answer pack has duplicate questions.');
  for (const answer of p.answers) {
    if (!answer || !nonEmpty(answer.question, 1000) || !nonEmpty(answer.answer, MAX_ANSWER) ||
        typeof answer.approved !== 'boolean' || !Array.isArray(answer.factIds) || answer.factIds.some(id => !nonEmpty(id, 100))) throw new Error('Answer pack has an incomplete answer.');
    if (answer.maxCharacters != null && (!Number.isInteger(answer.maxCharacters) || answer.maxCharacters < 1 || answer.maxCharacters > 100000 ||
        answer.answer.length > answer.maxCharacters)) throw new Error('Answer exceeds its character limit.');
    if (answer.approved && !answer.factIds.length) throw new Error('An approved answer needs supporting fact IDs.');
    if (answer.approved && answer.factIds.some(id => !approvedIds.has(id))) throw new Error('An approved answer cites a missing profile fact.');
  }
  return p as AnswerPack;
}

export function parseExportBundle(input: unknown): ExportBundle {
  if (!input || typeof input !== 'object') throw new Error('Export bundle must contain a profile and answer pack.');
  const bundle = input as Partial<ExportBundle>;
  const profile = parseProfile(bundle.profile);
  if (!('pack' in bundle)) throw new Error('Export bundle has no answer pack field.');
  const pack = bundle.pack == null ? null : parseAnswerPack(bundle.pack, profile);
  return {profile, pack};
}

export function resetChangedApprovals(next: AnswerPack, previousPack?: AnswerPack, previousProfile?: ProfileExport, nextProfile?: ProfileExport): AnswerPack {
  if (!previousPack || !previousProfile || !nextProfile || previousPack.applicationId !== next.applicationId) return next;
  const profileChanged = JSON.stringify(previousProfile) !== JSON.stringify(nextProfile);
  const oldAnswers = new Map(previousPack.answers.map(answer => [answer.question.trim().toLowerCase(), answer]));
  const resumeChanged = previousPack.resumeVersionId !== next.resumeVersionId;
  return {...next, answers: next.answers.map(answer => {
    const old = oldAnswers.get(answer.question.trim().toLowerCase());
    const changed = profileChanged || resumeChanged || !old || old.answer !== answer.answer || JSON.stringify(old.factIds) !== JSON.stringify(answer.factIds);
    return changed ? {...answer, approved: false} : answer;
  })};
}
