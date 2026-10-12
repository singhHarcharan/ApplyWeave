import { scanDocument, fillDocument } from './mapper';
import type { AnswerPack, ProfileExport } from './contracts';

declare global { interface Window { __applyWeaveListener?: boolean } }
if (!window.__applyWeaveListener) {
  window.__applyWeaveListener = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'AW_SCAN') {
      try { sendResponse({ok: true, matches: scanDocument(document, message.profile as ProfileExport, message.pack as AnswerPack | undefined)}); }
      catch (error) { sendResponse({ok: false, error: String(error)}); }
    }
    if (message.type === 'AW_FILL') {
      try { sendResponse({ok: true, result: fillDocument(document, message.selected, false)}); }
      catch (error) { sendResponse({ok: false, error: String(error)}); }
    }
    return false;
  });
}
