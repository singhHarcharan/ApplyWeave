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
  answers: Array<{ question: string; answer: string; factIds: string[]; approved: boolean }>;
};

export type FieldMatch = {
  id: string;
  label: string;
  key: string;
  proposedValue: string;
  currentValue: string;
  confidence: 'high' | 'medium';
};

export function parseProfile(input: unknown): ProfileExport {
  if (!input || typeof input !== 'object') throw new Error('Profile JSON must be an object.');
  const p = input as Partial<ProfileExport>;
  if (p.schemaVersion !== 1 || !p.profileVersion || typeof p.profileVersion !== 'string' ||
      !p.personal || typeof p.personal !== 'object' || Array.isArray(p.personal) ||
      Object.values(p.personal).some(value => typeof value !== 'string') ||
      !Array.isArray(p.facts) || p.facts.some(fact => !fact || typeof fact.id !== 'string' || !fact.id || typeof fact.claim !== 'string' || typeof fact.source !== 'string') ||
      (p.standardAnswers !== undefined && !Array.isArray(p.standardAnswers)) ||
      (p.resumeVersions !== undefined && !Array.isArray(p.resumeVersions))) {
    throw new Error('Unsupported profile export. Use the approved Sheet export.');
  }
  return {schemaVersion: 1, profileVersion: p.profileVersion, personal: p.personal as Record<string, string>, facts: p.facts, standardAnswers: p.standardAnswers || [], resumeVersions: p.resumeVersions || []};
}

export function parseAnswerPack(input: unknown, profile: ProfileExport): AnswerPack {
  if (!input || typeof input !== 'object') throw new Error('Answer pack JSON must be an object.');
  const p = input as Partial<AnswerPack>;
  if (p.schemaVersion !== 1 || typeof p.applicationId !== 'string' || !p.applicationId ||
      typeof p.resumeVersionId !== 'string' || !p.resumeVersionId || !Array.isArray(p.answers)) throw new Error('Unsupported answer pack.');
  if (p.profileVersion !== profile.profileVersion) throw new Error('Answer pack and profile versions differ. Re-approve the pack.');
  const approvedIds = new Set(profile.facts.map(f => f.id));
  for (const answer of p.answers) {
    if (!answer || typeof answer.question !== 'string' || !answer.question || typeof answer.answer !== 'string' || !answer.answer ||
        typeof answer.approved !== 'boolean' || !Array.isArray(answer.factIds) || answer.factIds.some(id => typeof id !== 'string')) throw new Error('Answer pack has an incomplete answer.');
    if (answer.approved && !answer.factIds.length) throw new Error('An approved answer needs supporting fact IDs.');
    if (answer.approved && answer.factIds.some(id => !approvedIds.has(id))) throw new Error('An approved answer cites a missing profile fact.');
  }
  return p as AnswerPack;
}
