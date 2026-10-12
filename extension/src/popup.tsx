import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseAnswerPack, parseProfile, type AnswerPack, type FieldMatch, type ProfileExport } from './contracts';
import { isAllowedUrl, isBlockedHost } from './policy';
import './style.css';

type Stored = { profile?: ProfileExport; pack?: AnswerPack; approvedHosts?: string[] };
type ScanResponse = {ok: boolean; matches?: FieldMatch[]; error?: string};
type FillResponse = {ok: boolean; result?: {filled: number; skipped: string[]}; error?: string};

function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [store, setStore] = useState<Stored>({approvedHosts: []});
  const [matches, setMatches] = useState<FieldMatch[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([chrome.tabs.query({active: true, currentWindow: true}), chrome.storage.local.get(['profile', 'pack', 'approvedHosts'])])
      .then(([tabs, saved]) => {
        setTab(tabs[0]);
        const profile = saved.profile ? parseProfile(saved.profile) : undefined;
        const pack = saved.pack && profile ? parseAnswerPack(saved.pack, profile) : undefined;
        const approvedHosts = Array.isArray(saved.approvedHosts) ? saved.approvedHosts.filter((host: unknown): host is string => typeof host === 'string') : [];
        setStore({profile, pack, approvedHosts});
      })
      .catch(error => setMessage(String(error)));
  }, []);
  const host = (() => { try { return tab?.url ? new URL(tab.url).hostname.toLowerCase() : ''; } catch { return ''; } })();
  const blocked = host ? isBlockedHost(host) : true;
  const allowed = tab?.url ? isAllowedUrl(tab.url, store.approvedHosts || []) : false;

  async function importJson(event: React.ChangeEvent<HTMLInputElement>, kind: 'profile' | 'pack') {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const json: unknown = JSON.parse(await file.text());
      if (kind === 'profile') {
        const profile = parseProfile(json);
        await chrome.storage.local.set({profile, pack: null});
        setStore(previous => ({...previous, profile, pack:undefined}));
        setMessage('Approved profile imported. Import the matching answer pack if needed.');
      } else {
        if (!store.profile) throw new Error('Import the approved profile first.');
        const pack = parseAnswerPack(json, store.profile);
        await chrome.storage.local.set({pack});
        setStore(previous => ({...previous, pack}));
        setMessage('Answer pack ' + pack.applicationId + ' imported.');
      }
      setMatches([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    event.target.value = '';
  }

  async function allowCurrentHost() {
    if (!host || blocked || !/^https?:/.test(tab?.url || '')) return;
    const hosts = Array.from(new Set([...(store.approvedHosts || []), host]));
    await chrome.storage.local.set({approvedHosts: hosts});
    setStore(previous => ({...previous, approvedHosts: hosts}));
    setMessage('Enabled for ' + host + '. Review the portal before filling.');
  }

  async function scan() {
    if (!tab?.id || !allowed || !store.profile) return;
    setBusy(true); setMessage('');
    try {
      await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['content.js']});
      const response = await chrome.tabs.sendMessage<unknown, ScanResponse>(tab.id, {type:'AW_SCAN', profile:store.profile, pack:store.pack});
      if (!response?.ok) throw new Error(response?.error || 'The form could not be scanned.');
      const found = response.matches || [];
      setMatches(found);
      setChosen(found.filter(match => !match.currentValue).map(match => match.id));
      setMessage(found.length ? 'Review each match before filling.' : 'No supported text fields found. Use the form manually.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function fill() {
    if (!tab?.id || !allowed || !matches.length) return;
    setBusy(true);
    try {
      const selected = matches.filter(match => chosen.includes(match.id) && !match.currentValue).map(match => ({id:match.id, value:match.proposedValue}));
      const response = await chrome.tabs.sendMessage<unknown, FillResponse>(tab.id, {type:'AW_FILL', selected});
      if (!response?.ok) throw new Error(response?.error || 'Filling failed.');
      setMessage('Filled ' + (response.result?.filled || 0) + ' field(s). Review the form and submit it yourself.' + (response.result?.skipped?.length ? ' Some fields were skipped because they changed or already had values.' : ''));
      setMatches([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function clearData() {
    await chrome.storage.local.remove(['profile','pack','approvedHosts']);
    setStore({approvedHosts: []}); setMatches([]); setMessage('Local profile, answer pack, and portal list cleared.');
  }

  return <main>
    <header><div className="eyebrow">APPLYWEAVE</div><h1>Form helper</h1><p>Review approved values, then fill selected fields.</p></header>
    <section className="domain"><strong>Current page</strong><div>{host || 'No supported page selected'}</div>
      {blocked ? <p className="warning">Page interaction is disabled here.</p> : allowed ? <p className="success">Enabled for this portal.</p> : <><p>Enable this company portal after reviewing its form.</p><button onClick={allowCurrentHost}>Enable this hostname</button></>}
    </section>
    <section><h2>Approved data</h2>
      <label className="file">Profile export <input type="file" accept="application/json,.json" onChange={event => importJson(event,'profile')}/></label>
      <div className="hint">{store.profile ? 'Version ' + store.profile.profileVersion + ' · ' + store.profile.facts.length + ' approved facts' : 'Import JSON from the Sheet'}</div>
      <label className="file">Answer pack <input type="file" accept="application/json,.json" onChange={event => importJson(event,'pack')}/></label>
      <div className="hint">{store.pack ? store.pack.applicationId + ' · ' + store.pack.answers.filter(a=>a.approved).length + ' approved answers' : 'Optional for standard contact fields'}</div>
    </section>
    <section><button className="primary" disabled={!allowed || !store.profile || busy} onClick={scan}>Scan this form</button>
      {matches.length > 0 && <><h2>Field preview</h2><div className="matches">{matches.map(match => <label className="match" key={match.id}>
        <input type="checkbox" checked={chosen.includes(match.id)} disabled={!!match.currentValue} onChange={event => setChosen(previous => event.target.checked ? [...previous, match.id] : previous.filter(id => id !== match.id))}/>
        <span><strong>{match.label}</strong><small>{match.confidence} confidence · {match.key}</small><em>{match.currentValue ? 'Already filled — skipped' : match.proposedValue}</em></span>
      </label>)}</div><button className="primary" disabled={!chosen.length || busy} onClick={fill}>Fill selected fields</button></>}
      <p className="hint">Resume uploads, salary, sponsorship, self-identification, and final submission stay manual.</p>
    </section>
    {message && <p role="status" className="message">{message}</p>}
    <button className="quiet" onClick={clearData}>Clear local data</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
