import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validator = new URL('./validate-pack.mjs', import.meta.url).pathname;
const profile = {
  schemaVersion: 1,
  profileVersion: '2026-10-13-test1234',
  facts: [{ id: 'F001', claim: 'Built a sample project.', source: 'Candidate-confirmed resume' }],
  resumeVersions: [{ id: 'SDE', filename: 'sample.pdf' }]
};
const pack = {
  schemaVersion: 1,
  applicationId: 'AW-20261013-ABC123',
  profileVersion: profile.profileVersion,
  resumeVersionId: 'SDE',
  answers: [{ question: 'What did you build?', answer: 'A sample project.', maxCharacters: 50, factIds: ['F001'], approved: false }]
};

function validate(candidateProfile, candidatePack) {
  const dir = mkdtempSync(join(tmpdir(), 'applyweave-validator-'));
  try {
    const profilePath = join(dir, 'profile.json');
    const packPath = join(dir, 'pack.json');
    writeFileSync(profilePath, JSON.stringify(candidateProfile));
    writeFileSync(packPath, JSON.stringify(candidatePack));
    return spawnSync(process.execPath, [validator, profilePath, packPath], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('validates a candidate-approved answer against its exact profile version', () => {
  const result = validate(profile, { ...pack, answers: [{ ...pack.answers[0], approved: true }] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 approved/);
});

test('blocks unknown facts and profile-version mismatches', () => {
  const result = validate(profile, { ...pack, profileVersion: 'stale', answers: [{ ...pack.answers[0], factIds: ['F999'] }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Profile versions do not match/);
  assert.match(result.stderr, /unknown fact/);
});

test('blocks answers that exceed a portal character limit', () => {
  const result = validate(profile, { ...pack, answers: [{ ...pack.answers[0], maxCharacters: 8 }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds its character limit/);
});

test('blocks missing supporting facts and duplicate questions', () => {
  const answer = { ...pack.answers[0], factIds: [] };
  const result = validate(profile, { ...pack, answers: [answer, { ...answer }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /supporting fact IDs/);
  assert.match(result.stderr, /repeats a question/);
});
