import { scanDocument, fillDocument } from './mapper';
import { isBlockedHost } from './policy';
import type { AnswerPack, ProfileExport } from './contracts';

declare global { interface Window { __applyWeaveListener?: boolean } }
if (!window.__applyWeaveListener) {
  window.__applyWeaveListener = true;
  let scannedUrl = '';
  let scannedFields = new Map<string, {element: HTMLInputElement | HTMLTextAreaElement; value: string; label: string}>();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isBlockedHost(location.hostname)) {
      sendResponse({ok: false, error: 'This site is blocked.'});
      return false;
    }
    if (message.type === 'AW_SCAN') {
      try {
        scannedFields = new Map();
        scannedUrl = location.href;
        const result = scanDocument(document, message.profile as ProfileExport, message.pack as AnswerPack | undefined,
          (match, element) => scannedFields.set(match.id, {element, value: match.proposedValue, label: match.label}));
        sendResponse({ok: true, ...result});
      }
      catch (error) { sendResponse({ok: false, error: String(error)}); }
    }
    if (message.type === 'AW_FILL') {
      try {
        if (!scannedUrl || location.href !== scannedUrl) throw new Error('The page changed. Scan the form again.');
        if (!Array.isArray(message.selected)) throw new Error('Invalid field selection.');
        const result = fillDocument(document, message.selected, scannedFields);
        scannedFields.clear();
        scannedUrl = '';
        sendResponse({ok: true, result});
      }
      catch (error) { sendResponse({ok: false, error: String(error)}); }
    }
    return false;
  });
}
