import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseAnswerPack, parseExportBundle, parseProfile, resetChangedApprovals, type AnswerPack, type FieldMatch, type ManualField, type ProfileExport } from './contracts';
import { isAllowedUrl, isBlockedHost } from './policy';
import './style.css';

type Stored = { profile?: ProfileExport; pack?: AnswerPack; approvedHosts: string[] };
type ScanResponse = {ok: boolean; matches?: FieldMatch[]; manualFields?: ManualField[]; error?: string};
type FillResponse = {ok: boolean; result?: {filled: number; skipped: string[]}; error?: string};
type Target = {tabId: number; url: string};

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({active: true, currentWindow: true}))[0];
}
function hostname(url?: string): string {
  try { return url ? new URL(url).hostname.toLowerCase() : ''; } catch { return ''; }
}
async function readJson(event: React.ChangeEvent<HTMLInputElement>): Promise<unknown | undefined> {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return undefined;
  if (file.size > 1024 * 1024) throw new Error('Choose a JSON file smaller than 1 MB.');
  return JSON.parse(await file.text()) as unknown;
}

function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [store, setStore] = useState<Stored>({approvedHosts: []});
  const [matches, setMatches] = useState<FieldMatch[]>([]);
  const [manualFields, setManualFields] = useState<ManualField[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [scannedTarget, setScannedTarget] = useState<Target>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function clearPreview() { setMatches([]); setManualFields([]); setChosen([]); setScannedTarget(undefined); }
  useEffect(() => {
    const refresh = () => { activeTab().then(setTab).catch(error => setMessage(String(error))); clearPreview(); };
    const changed = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.url || info.status === 'loading') activeTab().then(current => { if (current?.id === id) refresh(); });
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(changed);
    chrome.windows.onFocusChanged.addListener(refresh);
    Promise.all([activeTab(), chrome.storage.local.get(['profile', 'pack', 'approvedHosts'])])
      .then(([current, saved]) => {
        setTab(current);
        const profile = saved.profile ? parseProfile(saved.profile) : undefined;
        const pack = saved.pack && profile ? parseAnswerPack(saved.pack, profile) : undefined;
        const approvedHosts = Array.isArray(saved.approvedHosts) ? saved.approvedHosts.filter((host: unknown): host is string => typeof host === 'string') : [];
        setStore({profile, pack, approvedHosts});
      })
      .catch(error => setMessage(error instanceof Error ? error.message : String(error)));
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(changed);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);

  const host = hostname(tab?.url);
  const blocked = !host || isBlockedHost(host);
  const allowed = !!tab?.url && isAllowedUrl(tab.url, store.approvedHosts);

  async function importJson(event: React.ChangeEvent<HTMLInputElement>, kind: 'bundle' | 'profile' | 'pack') {
    try {
      const json = await readJson(event);
      if (json === undefined) return;
      if (kind === 'bundle') {
        const bundle = parseExportBundle(json);
        const pack = bundle.pack ? resetChangedApprovals(bundle.pack, store.pack, store.profile, bundle.profile) : null;
        await chrome.storage.local.set({profile:bundle.profile, pack});
        setStore(previous => ({...previous, profile:bundle.profile, pack:pack || undefined}));
        const resetCount = bundle.pack && pack ? bundle.pack.answers.filter((answer, i) => answer.approved && !pack.answers[i].approved).length : 0;
        setMessage(pack ? 'Imported ' + pack.applicationId + '.' + (resetCount ? ' ' + resetCount + ' changed answer approval(s) reset.' : ' Review all values before filling.') : 'Profile imported. This application has no answer pack yet.');
      } else if (kind === 'profile') {
        const profile = parseProfile(json);
        const same = JSON.stringify(profile) === JSON.stringify(store.profile);
        await chrome.storage.local.set({profile, pack: same ? store.pack || null : null});
        setStore(previous => ({...previous, profile, pack: same ? previous.pack : undefined}));
        setMessage(same ? 'Profile reimported.' : 'Profile changed. Import the matching answer pack again.');
      } else {
        if (!store.profile) throw new Error('Import the approved profile first.');
        const incoming = parseAnswerPack(json, store.profile);
        const pack = resetChangedApprovals(incoming, store.pack, store.profile, store.profile);
        await chrome.storage.local.set({pack});
        setStore(previous => ({...previous, pack}));
        setMessage('Answer pack ' + pack.applicationId + ' imported. Review every value before filling.');
      }
      clearPreview();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function allowCurrentHost() {
    try {
      const current = await activeTab();
      setTab(current);
      const currentHost = hostname(current?.url);
      if (!current?.url || !currentHost || !isAllowedUrl(current.url, [currentHost])) throw new Error('This page cannot be enabled. Use a secure company portal or the local test form.');
      const approvedHosts = Array.from(new Set([...store.approvedHosts, currentHost]));
      await chrome.storage.local.set({approvedHosts});
      setStore(previous => ({...previous, approvedHosts}));
      clearPreview();
      setMessage('Enabled for ' + currentHost + '. Review the form before filling.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function scan() {
    setBusy(true); setMessage(''); clearPreview();
    try {
      const current = await activeTab();
      setTab(current);
      if (!current?.id || !current.url || !isAllowedUrl(current.url, store.approvedHosts)) throw new Error('Enable this company portal before scanning.');
      if (!store.profile) throw new Error('Import an approved profile first.');
      try { await chrome.scripting.executeScript({target:{tabId:current.id}, files:['content.js']}); }
      catch { throw new Error('Chrome has no temporary access to this page. Click the ApplyWeave toolbar button on this tab, then scan again.'); }
      const response = await chrome.tabs.sendMessage<unknown, ScanResponse>(current.id, {type:'AW_SCAN', profile:store.profile, pack:store.pack});
      if (!response?.ok) throw new Error(response?.error || 'The form could not be scanned.');
      const found = response.matches || [];
      setMatches(found);
      setManualFields(response.manualFields || []);
      setChosen(found.filter(match => !match.currentValue).map(match => match.id));
      setScannedTarget({tabId:current.id, url:current.url});
      setMessage(found.length ? 'Review each suggested value before filling.' : 'No approved text values matched. Complete the listed fields manually.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function fill() {
    if (!scannedTarget || !matches.length) return;
    setBusy(true);
    try {
      const current = await activeTab();
      setTab(current);
      if (current?.id !== scannedTarget.tabId || current?.url !== scannedTarget.url || !isAllowedUrl(current.url || '', store.approvedHosts)) {
        clearPreview();
        throw new Error('The active page changed. Scan the form again.');
      }
      const selected = matches.filter(match => chosen.includes(match.id) && !match.currentValue).map(match => ({id:match.id, value:match.proposedValue}));
      const response = await chrome.tabs.sendMessage<unknown, FillResponse>(current.id, {type:'AW_FILL', selected});
      if (!response?.ok) throw new Error(response?.error || 'Filling failed. Scan again before retrying.');
      setMessage('Filled ' + (response.result?.filled || 0) + ' field(s). Review the form and submit it yourself.' + (response.result?.skipped?.length ? ' Some fields changed and were skipped.' : ''));
      clearPreview();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function clearData() {
    if (!window.confirm('Clear the local profile, answer pack, and approved portal list?')) return;
    await chrome.storage.local.remove(['profile', 'pack', 'approvedHosts']);
    setStore({approvedHosts: []}); clearPreview(); setMessage('Local data cleared.');
  }

  return <main>
    <header><div className="eyebrow">APPLYWEAVE</div><h1>Form helper</h1><p>Choose a company form, review each value, then fill selected fields.</p></header>
    <section className="domain"><strong>Active page</strong><div>{host || 'No supported page selected'}</div>
      {blocked ? <p className="warning">Page interaction is disabled here.</p> : allowed ? <p className="success">Enabled for this portal.</p> : <><p>Enable this company portal after reviewing its form.</p><button onClick={allowCurrentHost}>Enable this hostname</button></>}
      <p className="hint">After switching tabs, click the ApplyWeave toolbar button on that tab to grant temporary access, then scan again.</p>
    </section>
    <section><h2>Approved data</h2>
      <label className="file">Application export bundle <input type="file" accept="application/json,.json" onChange={event => importJson(event, 'bundle')}/></label>
      <div className="hint">Download JSON from /api/extension/export/:applicationId in ApplyWeave, then import it here.</div>
      <details><summary>Import separate files</summary>
        <label className="file">Profile export <input type="file" accept="application/json,.json" onChange={event => importJson(event, 'profile')}/></label>
        <label className="file">Answer pack <input type="file" accept="application/json,.json" onChange={event => importJson(event, 'pack')}/></label>
      </details>
      <div className="hint">{store.profile ? 'Profile ' + store.profile.profileVersion + ' · ' + store.profile.facts.length + ' facts' : 'No profile imported'}</div>
      <div className="hint">{store.pack ? 'Application ' + store.pack.applicationId + ' · ' + store.pack.answers.filter(a => a.approved).length + ' approved answers' : 'No answer pack imported'}</div>
    </section>
    <section><button className="primary" disabled={!allowed || !store.profile || busy} onClick={scan}>Scan active form</button>
      {matches.length > 0 && <><h2>Suggested fields</h2><div className="matches">{matches.map(match => <label className="match" key={match.id}>
        <input type="checkbox" checked={chosen.includes(match.id)} disabled={!!match.currentValue} onChange={event => setChosen(previous => event.target.checked ? [...previous, match.id] : previous.filter(id => id !== match.id))}/>
        <span><strong>{match.label}</strong><small>{match.confidence} confidence · {match.key}</small><em>{match.currentValue ? 'Already filled — skipped' : match.proposedValue}</em></span>
      </label>)}</div><button className="primary" disabled={!chosen.length || busy} onClick={fill}>Fill selected fields</button></>}
      {manualFields.length > 0 && <details open><summary>Manual fields ({manualFields.length})</summary><ul className="manual">{manualFields.map(field => <li key={field.id}><strong>{field.label}</strong><small>{field.reason}</small></li>)}</ul></details>}
      <p className="hint">Resume uploads, salary, sponsorship, self-identification, and final submission stay manual.</p>
    </section>
    {message && <p role="status" className="message">{message}</p>}
    <button className="quiet" onClick={clearData}>Clear local data</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
