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
if (profile.schemaVersion !== 1 || pack.schemaVersion !== 1) problems.push('Unsupported schema version.');
if (!/^AW-\d{8}-[A-Z0-9]{6}$/.test(pack.applicationId || '')) problems.push('Invalid Application ID.');
if (!profile.profileVersion || profile.profileVersion !== pack.profileVersion) problems.push('Profile versions do not match.');
const factIds = new Set((profile.facts || []).map(f => f.id));
const resumeIds = new Set((profile.resumeVersions || []).map(r => r.id));
if (!resumeIds.has(pack.resumeVersionId)) problems.push('Resume version is not in the approved profile.');
if (!Array.isArray(pack.answers)) problems.push('Answers must be an array.');
else for (const [i, answer] of pack.answers.entries()) {
  if (!answer.question || !answer.answer) problems.push(`Answer ${i + 1} is incomplete.`);
  if (!Array.isArray(answer.factIds)) problems.push(`Answer ${i + 1} has no fact ID list.`);
  else if (answer.factIds.some(id => !factIds.has(id))) problems.push(`Answer ${i + 1} cites an unknown fact.`);
  else if (answer.approved && !answer.factIds.length) problems.push(`Approved answer ${i + 1} needs a supporting fact.`);
  if (typeof answer.approved !== 'boolean') problems.push(`Answer ${i + 1} needs an approved boolean.`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Valid pack ${pack.applicationId}: ${pack.answers.length} answers, ${pack.answers.filter(a => a.approved).length} approved.`);
