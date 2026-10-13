# ApplyWeave local application contract

The app runs only on 127.0.0.1:4318. Production serves React assets and a Node API from the same origin. Vite development uses 127.0.0.1:5173 with /api proxied. Data is ignored private/workspace.json; approved-profile.json and preferences.json seed a fresh workspace. Google Sheets remains the canonical synced record; offline edits are explicit pending changes. No pretending a pending save reached Sheets. Google OAuth credentials/tokens stay server-side in ignored private files. No hosted deployment or connector credential copying.

## Shared JSON
Application: { applicationId, company, title, roleFamily, source, jobUrl, location, workMode, compensationLpa:number|null, dateSaved:ISO-date, dateApplied:ISO-date|'', status, resumeVersion, answerPackId, nextAction, dueDate:ISO-date|'', lastUpdated:ISO-timestamp, recruiter, responseDate:ISO-date|'', interviewDate:ISO-date|'', outcome, notes, jobDescription, syncStatus:'pending'|'synced'|'conflict' }. All absent strings default ''. Statuses Saved, Preparing, Applied, Assessment, Interview, Offer, Rejected, Withdrawn. Existing profile/answer contracts remain compatible. AnswerPack additionally has optional analysis:{fit,summary,resumeReason,proofPoints:[{text,factIds}],unknowns:string[],workModeCheck,compensationCheck}, answers optionally maxCharacters:number|null. Approval always a deliberate user action.

GET /api/state -> {applications:Application[],profile:ProfileExport,preferences:object,packs:AnswerPack[],connection:{googleConfigured:boolean,googleConnected:boolean,googleEmail:string|null,spreadsheetId:string,aiAvailable:boolean},lastSyncedAt:string|null,conflicts:Array<{applicationId,message}>,csrfToken:string}. Every mutating fetch sends X-ApplyWeave-CSRF from state. Errors -> {error:string,code?:string} with non-2xx. Keep endpoint results below consistent.
POST /api/applications {company,title,...,allowDuplicate?:boolean} -> {application}; 409 duplicate includes existing applicationId. PATCH /api/applications/:id {status,...} -> {application}. Preserve IDs and dates, rejected/withdrawn clear actions, offer stays actionable.
POST /api/preferences -> {preferences}; POST /api/profile {profile} -> {profile}; GET /api/profile/export -> JSON attachment. Profile edits change profileVersion; older packs invalid for export until reviewed again.
POST /api/packs {pack} -> {pack}; GET /api/packs/:applicationId/export -> validated JSON attachment. POST /api/sync {} -> {synced:number,conflicts:Array<{applicationId,message}>,lastSyncedAt}. Pull merges external changes; pending conflicting rows flagged, never overwrite silently. POST /api/conflicts/:id {resolution:'local'|'remote'} -> {application} explicit resolution.
POST /api/auth/google/config {client:GoogleDesktopOAuthClientJSON,spreadsheetId:string} -> {configured:true}; POST /api/auth/google/start {} -> {url:string}; GET /api/auth/google/callback completes OAuth redirects /?google=connected; POST /api/auth/google/disconnect {}. OAuth state/PKCE/scope are server-owned, callback fixed loopback. Sync button triggers access, not page rendering. UI must explain the existing ChatGPT Drive connection cannot be directly borrowed by a standalone app.
GET /api/resumes/:id -> PDF attachment only from server-owned catalogue allowlist. GET /api/backups/export -> local full JSON attachment; POST /api/backups/import {backup} with explicit UI confirmation and validation. No delete applications; Withdrawn instead.
POST /api/generate {applicationId,jobDescription,questions:[{question,maxCharacters?:number|null}]} -> {jobId}; GET /api/generate/:jobId -> {status:'running'|'complete'|'failed',pack?:AnswerPack,error?:string}. Root agent owns generator.ts exporting generatePack(input,profile,preferences,application):Promise<AnswerPack> and aiAvailable():Promise<boolean>. Agent server imports this. Generation result is persisted draft with all approved:false. Manual draft/edit/import path remains available.
GET /api/extension/export/:applicationId -> {profile,pack} JSON bundle for importing helper. Same CSRF protection for sensitive exports? GET is same-origin only, no CORS. Extension supports file import bundle. No arbitrary network bridge.

## Client views
Dashboard / Applications / Prepare / Profile & Resumes / Settings. Live data, no fixture claims. Today action queue, searchable and filterable table, add/edit drawer, status lifecycle, per-role prepare workspace with JD/questions/generation and evidence/approval editor, downloads/copy, profile catalogue, settings OAuth import/connect/disconnect/sync plus backup. Responsive accessible warm-white/ink/teal visual style, useful empty states. Show local pending and connection statuses clearly.


## Authentication update

`GET /api/auth/session` is public and returns `{authenticated,user:{email}|null,configured,csrfToken}` without profile/application data. Call it before loading `/api/state`. `POST /api/auth/google/start` requires CSRF and binds state/PKCE to an HttpOnly browser cookie. The callback verifies the owner with Google, pins the account ID locally, sets a seven-day HttpOnly SameSite=Lax loopback session cookie, and redirects to `/`. Errors redirect to `/?authError=CODE` for the UI to explain.

All other private API routes, including state, profile, resume downloads, packs, exports, configuration, and sync, return `401 AUTH_REQUIRED` without a session. `POST /api/auth/logout` invalidates the browser session while retaining the Google grant. Sessions are in memory and end on server restart. Fresh installations configure credentials through `npm run configure-google -- /path/client.json SPREADSHEET_ID` before using the login screen.

A disabled Sheets API returns `503` with `{code:"SHEETS_API_DISABLED",error,setupUrl}`. The UI offers the official Cloud setup link and retry. A Sheets permission error is distinct from an app session expiration.


## Hosted mode

`APPLYWEAVE_MODE=hosted` (or Vercel) selects Postgres persistence, configured HTTPS origin and Web OAuth. See [hosted-deployment.md](hosted-deployment.md). Local mode remains available. `/api/state` adds `hostingMode` and safe AI provider/model metadata in `connection`.

All session methods are asynchronous; PostgreSQL sessions and browser-bound OAuth state survive instances. Google credentials are environment-owned and token data is encrypted. In hosted mode configuration mutation and the optional Apps Script installer are unavailable; ordinary Sheets sync is supported.

`POST /api/resumes {id,filename,dataBase64}` requires authentication/CSRF, safe PDF filename and a maximum 3 MB decoded file. New catalogue IDs/filenames only; profile version advances. PDF downloads still require owner authentication.

`POST /api/generate` accepts optional `requestId` for retry idempotency. Hosted calls await bounded provider execution; polling uses persisted job state. Pack save and successful job completion share a database transaction. `AI_DAILY_LIMIT` includes failed attempts; manual draft/approval/export does not consume provider quota. Stale application, profile, preferences or saved pack changes reject the result.
