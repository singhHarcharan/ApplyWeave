#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const [profilePath, packPath] = process.argv.slice(2);
if (!profilePath || !packPath) {
  console.error('Usage: node assistant/validate-pack.mjs approved-profile.json answer-pack.json');
  process.exit(2);
}
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
const pack = JSON.parse(await readFile(packPath, 'utf8'));
const problems = [];
if (profile?.schemaVersion !== 1 || pack?.schemaVersion !== 1) problems.push('Unsupported schema version.');
if (!/^AW-\d{8}-[A-Z0-9]{6}$/.test(pack?.applicationId || '')) problems.push('Invalid Application ID.');
if (!profile?.profileVersion || profile.profileVersion !== pack?.profileVersion) problems.push('Profile versions do not match.');
const profileFacts = Array.isArray(profile?.facts) ? profile.facts : [];
const profileResumes = Array.isArray(profile?.resumeVersions) ? profile.resumeVersions : [];
if (!profileFacts.length) problems.push('Profile needs approved facts.');
if (!profileResumes.length) problems.push('Profile needs resume versions.');
const factIds = new Set();
for (const fact of profileFacts) {
  if (!fact || typeof fact.id !== 'string' || !fact.id.trim() || typeof fact.claim !== 'string' || !fact.claim.trim()) {
    problems.push('Profile contains an incomplete fact.');
    continue;
  }
  if (factIds.has(fact.id)) problems.push(`Profile contains duplicate fact ID ${fact.id}.`);
  factIds.add(fact.id);
}
const resumeIds = new Set();
for (const resume of profileResumes) {
  if (!resume || typeof resume.id !== 'string' || !resume.id.trim() || typeof resume.filename !== 'string' || !resume.filename.trim()) {
    problems.push('Profile contains an incomplete resume version.');
    continue;
  }
  if (resumeIds.has(resume.id)) problems.push(`Profile contains duplicate resume ID ${resume.id}.`);
  resumeIds.add(resume.id);
}
if (!resumeIds.has(pack?.resumeVersionId)) problems.push('Resume version is not in the approved profile.');
if (!Array.isArray(pack?.answers)) problems.push('Answers must be an array.');
else {
  const questions = new Set();
  for (const [i, answer] of pack.answers.entries()) {
    const number = i + 1;
    if (!answer || typeof answer !== 'object' || typeof answer.question !== 'string' || !answer.question.trim() || typeof answer.answer !== 'string' || !answer.answer.trim()) {
      problems.push(`Answer ${number} is incomplete.`);
      continue;
    }
    const normalizedQuestion = answer.question.trim().toLowerCase().replace(/\s+/g, ' ');
    if (questions.has(normalizedQuestion)) problems.push(`Answer ${number} repeats a question.`);
    questions.add(normalizedQuestion);
    if (!Array.isArray(answer.factIds) || !answer.factIds.length) problems.push(`Answer ${number} needs supporting fact IDs.`);
    else {
      if (answer.factIds.some(id => !factIds.has(id))) problems.push(`Answer ${number} cites an unknown fact.`);
      if (new Set(answer.factIds).size !== answer.factIds.length) problems.push(`Answer ${number} repeats a fact ID.`);
    }
    if (typeof answer.approved !== 'boolean') problems.push(`Answer ${number} needs an approved boolean.`);
    if (answer.maxCharacters !== undefined) {
      if (!Number.isInteger(answer.maxCharacters) || answer.maxCharacters < 1) problems.push(`Answer ${number} has an invalid character limit.`);
      else if (answer.answer.length > answer.maxCharacters) problems.push(`Answer ${number} exceeds its character limit of ${answer.maxCharacters}.`);
    }
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Valid pack ${pack.applicationId}: ${pack.answers.length} answers, ${pack.answers.filter(a => a.approved).length} approved.`);
