import type { AnswerPack, FieldMatch, ProfileExport } from './contracts';

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
  ['availability', /^(available (from|date)|start date|notice period end date)$/i]
];

function normalize(text: string): string { return text.replace(/\s+/g, ' ').replace(/[?*:]+$/g, '').trim(); }
function labelOf(element: HTMLInputElement | HTMLTextAreaElement): string {
  const labels = Array.from(element.labels || []).map(label => label.textContent || '').join(' ');
  const aria = element.getAttribute('aria-label') || '';
  const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent || '').join(' ');
  const nearby = element.closest('label')?.textContent || element.parentElement?.querySelector('label')?.textContent || '';
  return normalize(labels || aria || labelledBy || nearby || element.getAttribute('placeholder') || element.getAttribute('name') || element.id || '');
}
function valueFor(key: string, personal: Record<string, string>): string {
  if (key === 'firstName' && !personal.firstName) return (personal.fullName || '').split(/\s+/)[0] || '';
  if (key === 'lastName' && !personal.lastName) return (personal.fullName || '').split(/\s+/).slice(1).join(' ');
  return personal[key] || '';
}
export function scanDocument(doc: Document, profile: ProfileExport, pack?: AnswerPack): FieldMatch[] {
  const matches: FieldMatch[] = [];
  const elements = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const type = element instanceof doc.defaultView!.HTMLInputElement ? element.type.toLowerCase() : 'textarea';
    if (!['text', 'email', 'tel', 'url', 'date', 'textarea'].includes(type) || element.disabled || element.readOnly || element.hidden) continue;
    const label = labelOf(element);
    if (!label || excluded.test(label)) continue;
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
    }
    if (!key || !proposedValue) continue;
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(proposedValue)) continue;
    if (type === 'email' && !proposedValue.includes('@')) continue;
    if (label.toLowerCase() !== key.toLowerCase() && key.startsWith('answer:')) confidence = 'medium';
    const id = 'aw-' + i;
    element.dataset.applyWeaveField = id;
    matches.push({id, label, key, proposedValue, currentValue: element.value, confidence});
  }
  return matches;
}

export function fillDocument(doc: Document, selected: Array<{id: string; value: string}>, overwrite = false): {filled: number; skipped: string[]} {
  let filled = 0;
  const skipped: string[] = [];
  for (const item of selected) {
    const element = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-apply-weave-field="' + item.id + '"]');
    if (!element || element.disabled || element.readOnly || (element.value && !overwrite)) { skipped.push(item.id); continue; }
    if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || (element instanceof doc.defaultView!.HTMLInputElement && !['text', 'email', 'tel', 'url', 'date'].includes(element.type.toLowerCase()))) { skipped.push(item.id); continue; }
    const setter = Object.getOwnPropertyDescriptor(element instanceof doc.defaultView!.HTMLInputElement ? doc.defaultView!.HTMLInputElement.prototype : doc.defaultView!.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) { skipped.push(item.id); continue; }
    setter.call(element, item.value);
    element.dispatchEvent(new doc.defaultView!.Event('input', {bubbles: true}));
    element.dispatchEvent(new doc.defaultView!.Event('change', {bubbles: true}));
    filled++;
  }
  return {filled, skipped};
}
