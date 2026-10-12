import type { AnswerPack, FieldMatch, ProfileExport, ScanResult } from './contracts';

const excluded = /password|captcha|salary|compensation|ctc|pay|visa|sponsor|work authorization|gender|race|ethnic|disabil|veteran|social security|government id|aadhaar|pan number|consent|agree to|terms/i;
const patterns: Array<[string, RegExp]> = [
  ['fullName', /^(full name|your name|candidate name|applicant name|name)$/i],
  ['firstName', /^(first name|given name)$/i],
  ['lastName', /^(last name|surname|family name)$/i],
  ['email', /^(e.?mail( address)?|contact email)$/i],
  ['phone', /^(phone( number)?|mobile( number)?|contact number)$/i],
  ['location', /^(location|city|current location)$/i],
  ['linkedin', /linkedin/i],
  ['github', /github/i],
  ['portfolio', /portfolio|personal website/i],
  ['availability', /^(available (from|date)|start date|notice period end date)$/i],
  ['educationInstitution', /^(university|college|institution|university name|college name|institution name|college\s*\/\s*university)$/i],
  ['educationDegree', /^(degree|degree type|highest degree|qualification|education level)$/i],
  ['educationField', /^(field of study|major|specialization|discipline)$/i],
  ['graduationYear', /^(graduation year|year of graduation|graduated in)$/i]
];

function normalize(text: string): string { return text.replace(/\s+/g, ' ').replace(/[?*:]+$/g, '').trim(); }
type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function isEligible(element: FormElement): boolean {
  if (element.disabled || ('readOnly' in element && element.readOnly) || element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const view = element.ownerDocument.defaultView;
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = view?.getComputedStyle(parent);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}
function labelOf(element: FormElement): string {
  const labels = Array.from(element.labels || []).map(label => label.textContent || '').join(' ');
  const aria = element.getAttribute('aria-label') || '';
  const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent || '').join(' ');
  const parent = element.parentElement;
  const nearby = element.closest('label')?.textContent ||
    (parent?.querySelectorAll('input, textarea, select').length === 1 ? parent.querySelector('label')?.textContent : '') || '';
  return normalize(labels || aria || labelledBy || nearby || element.getAttribute('placeholder') || element.getAttribute('name') || element.id || '');
}
function valueFor(key: string, personal: Record<string, string>): string {
  if (key === 'firstName' && !personal.firstName) return (personal.fullName || '').split(/\s+/)[0] || '';
  if (key === 'lastName' && !personal.lastName) return (personal.fullName || '').split(/\s+/).slice(1).join(' ');
  return personal[key] || '';
}
export function scanDocument(doc: Document, profile: ProfileExport, pack?: AnswerPack, onMatch?: (match: FieldMatch, element: HTMLInputElement | HTMLTextAreaElement) => void): ScanResult {
  const matches: FieldMatch[] = [];
  const manualFields: ScanResult['manualFields'] = [];
  const elements = Array.from(doc.querySelectorAll<FormElement>('input, textarea, select'));
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const type = element instanceof doc.defaultView!.HTMLInputElement ? element.type.toLowerCase() : element instanceof doc.defaultView!.HTMLSelectElement ? 'select' : 'textarea';
    if (['hidden', 'button', 'submit', 'reset', 'image'].includes(type) || !isEligible(element)) continue;
    const label = labelOf(element) || 'Unlabelled field';
    const id = 'aw-' + i;
    const manual = (reason: string) => manualFields.push({id, label, reason});
    if (excluded.test(label)) { manual('Requires your review'); continue; }
    if (!['text', 'email', 'tel', 'url', 'date', 'number', 'textarea'].includes(type)) {
      manual(type === 'file' ? 'Upload the file manually' : 'Choose or enter manually (' + type + ')');
      continue;
    }
    if (label === 'Unlabelled field') { manual('No accessible label'); continue; }
    let key = '';
    let proposedValue = '';
    let confidence: 'high' | 'medium' = 'high';
    for (const [candidate, regex] of patterns) {
      if (regex.test(label)) { key = candidate; proposedValue = valueFor(candidate, profile.personal); break; }
    }
    if (!key && pack) {
      const normalized = normalize(label).toLowerCase();
      const answerIndex = pack.answers.findIndex(a => a.approved && normalize(a.question).toLowerCase() === normalized);
      if (answerIndex >= 0) { key = 'answer:' + answerIndex; proposedValue = pack.answers[answerIndex].answer; }
      else if (pack.answers.some(a => normalize(a.question).toLowerCase() === normalized)) { manual('Answer needs approval'); continue; }
    }
    if (!key) {
      const normalized = normalize(label).toLowerCase();
      const standardIndex = profile.standardAnswers.findIndex(a => normalize(a.key).toLowerCase() === normalized);
      if (standardIndex >= 0) { key = 'standard:' + standardIndex; proposedValue = profile.standardAnswers[standardIndex].text; confidence = 'medium'; }
    }
    if (!key) { manual('No approved match'); continue; }
    if (!proposedValue) { manual('No approved value for ' + key); continue; }
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(proposedValue)) { manual('Date needs YYYY-MM-DD format'); continue; }
    if (type === 'number' && (key !== 'graduationYear' || !/^\d{4}$/.test(proposedValue))) { manual('Numeric field needs manual review'); continue; }
    if (type === 'email' && !proposedValue.includes('@')) { manual('Email needs manual review'); continue; }
    if (label.toLowerCase() !== key.toLowerCase() && key.startsWith('answer:')) confidence = 'medium';
    const match = {id, label, key, proposedValue, currentValue: element.value, confidence};
    matches.push(match);
    onMatch?.(match, element as HTMLInputElement | HTMLTextAreaElement);
  }
  return {matches, manualFields};
}

export function fillDocument(doc: Document, selected: Array<{id: string; value: string}>, expected: Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>): {filled: number; skipped: string[]} {
  let filled = 0;
  const skipped: string[] = [];
  for (const item of selected) {
    const scanned = expected.get(item.id);
    const element = scanned?.element;
    if (!element || !element.isConnected || !isEligible(element) || element.value || scanned.value !== item.value || scanned.label !== labelOf(element)) { skipped.push(item.id); continue; }
    if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || (element instanceof doc.defaultView!.HTMLInputElement && !['text', 'email', 'tel', 'url', 'date', 'number'].includes(element.type.toLowerCase()))) { skipped.push(item.id); continue; }
    const setter = Object.getOwnPropertyDescriptor(element instanceof doc.defaultView!.HTMLInputElement ? doc.defaultView!.HTMLInputElement.prototype : doc.defaultView!.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) { skipped.push(item.id); continue; }
    setter.call(element, item.value);
    element.dispatchEvent(new doc.defaultView!.Event('input', {bubbles: true}));
    element.dispatchEvent(new doc.defaultView!.Event('change', {bubbles: true}));
    filled++;
  }
  return {filled, skipped};
}
