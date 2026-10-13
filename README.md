# ApplyWeave

One workspace for your job search: save a role, prepare grounded answers, review what will be filled, and track the outcome in Google Sheets.

## Current status — 13 October 2026

**Deployed at https://applyweave.vercel.app on Vercel Hobby with Supabase Free.** Production secrets and Google Web OAuth are configured. The database schema, approved profile and six private PDFs have been migrated and verified. Hosted sign-in and Sheets sync still need the browser consent/acceptance check; automated browser sign-in currently reports a fetch error although the sign-in API passes. OpenAI (`gpt-5.4-mini`) is configured, but the API account returned insufficient credits. Codex/ChatGPT subscription billing does not fund API calls. See the [hosted deployment runbook](docs/hosted-deployment.md).

The local version remains available. The Chrome extension is built; manual installation and a real company-portal pilot remain unconfirmed. The optional Sheets sidebar is not installed. Review the FRONTEND and AI resumes before employer uploads. No employer application has been submitted by this system.

- [Complete implementation and operating guide](docs/job-search-system-implementation-plan.html)
- [API contract](docs/app-contract.md)
- [Verification record and pending checks](docs/verification.md)

## Start the local app

On this Mac, double-click **Start ApplyWeave.command**, or run:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4318** in Chrome. Keep the terminal running. Node.js 20.19+ or 22+ is recommended. For development, `npm run dev` starts the API and Vite at `http://127.0.0.1:5173`.

The app is local to your computer. Personal information, application records, answer packs, credentials, and resumes are stored under the Git-ignored `private/` directory. A fresh clone starts with an empty profile; import an approved profile in **Profile & resumes**, or restore a private backup in **Settings**. Keep private backups somewhere safe outside the repository. See [Backup and recovery](#backup-and-recovery) for what an export includes.

## Architecture and technology

| Layer | Current implementation |
| --- | --- |
| Web UI | React 19, TypeScript, Vite, custom CSS and Lucide icons |
| API | Node.js, Express, Zod; exact configured host/origin and CSRF checks; Vercel function when hosted |
| Persistence | Local: atomic JSON and private PDFs. Hosted: Supabase Postgres and private Storage bucket |
| Identity and tracker | Desktop OAuth locally, Web OAuth when hosted; PKCE and verified owner; direct Sheets API sync |
| Answer generation | Local Codex CLI or hosted OpenAI/Gemini API; validated output, fact references and explicit approvals |
| Browser helper | Chrome Manifest V3 extension with a persistent side panel and imported application bundle |
| Optional Sheet UI | Bound Google Apps Script menu/sidebar and API installer |

The React app calls the API at the same origin. The API persists workspace data, generates drafts through the configured provider, and syncs tracker rows with Google Sheets. A reviewed JSON bundle transfers one application to the extension; the extension does not directly connect to the backend or Google account.

## Sign in with Google

The app now requires Google sign-in before loading your profile, applications, answer packs, or resumes. Click **Sign in with Google** on the welcome screen and use the workspace owner's account. Google identity is verified on the server; another Google account cannot open this private workspace. The existing profile email identifies the owner, then the Google account ID is pinned locally.

An HttpOnly, SameSite session cookie keeps the browser signed in for up to seven days. Local server restarts end local sessions; hosted sessions persist in Postgres across cold starts. **Sign out** locks the app and clears private data from the current UI; it preserves your Google Sheets grant for your next sign-in. **Disconnect Google** in Settings removes the stored Sheets token. Both local and hosted modes are single-owner workspaces; this is not a multi-user service.

## The complete workflow

| Part | What is implemented |
| --- | --- |
| Web workspace | Dashboard, daily action queue, stage counts, searchable/filterable applications, add/edit forms, preferences, profile editor, resume catalogue, backup export/restore |
| Application assistant | Signed-in Codex generation from a pasted job description, fit assessment, resume recommendation, cited evidence, character limits, editable answers, explicit approval, version checks |
| Google Sheets tracker | Four prepared tabs, statuses, duplicate warnings, follow-ups/interviews, dashboard, direct app sync with conflict review, checked profile import, optional bound Apps Script sidebar |
| Chrome side panel | Import one application bundle, approve exact portal hostname, scan, preview, select fields, fill supported empty text fields, explain manual fields |

Target roles are SDE, frontend, backend, full stack, AI engineer, and MERN. The configured search is Remote/Hybrid, at least ₹12 LPA, from 13 October through 12 November 2026. These settings are editable.

### Daily use

1. Find a role yourself on LinkedIn, Wellfound, or a company website. Click **Add application** and save the URL, role, work arrangement, salary when known, and job description.
2. Open **Prepare**, paste the questions and their character limits, then generate a draft. Review the resume choice, the cited facts, and every answer. Approve each answer only when it accurately represents you.
3. Save the reviewed pack and download **Chrome bundle**. Import that file into the Chrome side panel. It contains the approved profile and the answer pack for that Application ID.
4. Open the company portal, click the ApplyWeave extension, enable that exact host, scan, and review proposed values. Fill selected fields. Upload the resume and submit the application yourself.
5. Edit the application to **Applied** after submission. Record the actual submitted resume and date. Set the next action and due date, then click **Sync Google Sheets**.

LinkedIn and Wellfound pages are blocked in the extension. The app still helps prepare and track those applications; paste answers yourself on those sites. Salary, sponsorship, legal declarations, self-identification, unsupported controls, resume upload, and final submission remain manual.

## Connect Google Sheets once

The existing tracker is prepared and private. Its owner account can edit it; public edit sharing is unnecessary. Signing into Chrome or connecting Drive in Codex does not authorize this separate local application.

The app uses [Google's installed-application OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app) with PKCE and a loopback callback. To configure it:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and enable **Google Sheets API**. Enable **Apps Script API** too if you want the optional Sheet sidebar installer.
2. Configure the OAuth consent screen for your own use. If its audience is External and its publishing status is Testing, add your tracker owner email as a test user. Google may require reconnecting after a testing refresh token expires.
3. Create an OAuth client with application type **Desktop app** and download its JSON. Do not choose Web application and do not commit the file.
4. For a fresh installation, configure the client locally before signing in:

   ```sh
   npm run configure-google -- /path/to/desktop-client.json YOUR_SPREADSHEET_ID
   ```

   On this computer the client is already configured. Open ApplyWeave, click **Sign in with Google**, and select the Sheet's owner account. Complete Google's consent. Signed-in users can update configuration under **Settings → Google Sheets**.
5. Return to ApplyWeave and click **Sync Google Sheets**. The header and individual records show the actual result. Resolve any conflicts before continuing.

The scopes are `openid`, `email`, and `spreadsheets`; the last permits reading/writing spreadsheets accessible to your account. ApplyWeave's code targets only the configured spreadsheet. Tokens and the client file are stored locally with restricted file permissions. Disconnect removes the local token; revoke the app separately in your Google Account if desired.

### Fixing a disabled Sheets API

A successful Google login does not automatically enable Cloud APIs. If **Google Sheets API is disabled** appears, use the error's **Enable Sheets API** link, select the same Cloud project as the OAuth client, enable the API, wait briefly for activation, then retry Sync. There is no need to recreate the OAuth client. ApplyWeave preserves local changes and shows an actionable message instead of raw Google JSON.

### What sync does

- Application rows share stable `AW-...` IDs. Local changes are visibly **pending** until a successful sync. Google Sheets remains the shared tracker; local persistence allows working while disconnected.
- Sync reads before writing, detects duplicate IDs and conflicting edits, and writes plain values so job text cannot become spreadsheet formulas. Retrying after a partial failure does not deliberately append another copy.
- Checked **Profile & Answers** rows can be pulled from the Sheet. Concurrent local changes produce a profile conflict. Local profile edits are not silently published to the Sheet: use the reviewed export/import workflow. Answer-pack text stays local; the Sheet stores its ID.
- There is no background scraping, scheduled submission, inbox access, or automatic job application.

### Optional Sheet sidebar

The tracker works without the sidebar. In Settings, **Authorize sidebar installation** adds the `script.projects` scope; **Install Sheet sidebar** creates a bound Apps Script project and uploads the reviewed source from this repository. This needs Apps Script API enabled, API access enabled in [Apps Script settings](https://script.google.com/home/usersettings), and Google authorization. See Google's [project management API guide](https://developers.google.com/apps-script/api/how-tos/manage-projects). Reload the Sheet afterward. Running its menu actions may request the script's current-spreadsheet and container-UI permissions.

Manual alternative: in the Sheet, open **Extensions → Apps Script**, replace `Code.gs` with `apps-script/Code.gs`, add an HTML file named `Sidebar` from `apps-script/Sidebar.html`, save, run `setupApplyWeave`, and reload the Sheet. Setup preserves matching existing tabs and refuses mismatched headers. Google's editor link previously returned “Page not found” in this Chrome account; the optional API installer avoids relying on that editor link. Installation itself is still pending authorization.

## Install the Chrome side panel once

```sh
npm --prefix extension ci
npm --prefix extension run build
```

1. Open `chrome://extensions` yourself.
2. Enable Developer mode, choose **Load unpacked**, and select the repository's `extension/dist` directory.
3. Pin ApplyWeave, open a company portal, and click its toolbar icon to open the persistent side panel.
4. Import a Chrome bundle from the web app. Enable only the exact hostname you intend to fill, then scan and review.

The helper uses temporary active-tab access, scripting, local storage, and the side-panel API. It has no blanket website host permission. It never overwrites existing values or clicks Submit. A changed page or profile requires a fresh scan/review. Dropdowns, file inputs, iframes, shadow DOM, and unusual custom controls may require manual entry. Portal-specific adapters should be added after observing a real form.

A non-submitting pilot page is included at `extension/test-form.html`. From the repository root, run `python3 -m http.server 4320 --bind 127.0.0.1 --directory extension`, open `http://127.0.0.1:4320/test-form.html`, explicitly enable its hostname in the helper, and test with sample data before a real application. Automated access to Chrome's extension-management page is blocked in this environment, so installation must be done by you.

## Profiles and resumes

The private profile contains the approved facts and contact details. Six resume versions are available on this computer: the original SDE, MERN, PYTHON and STARTUP PDFs, plus FRONTEND and AI variants derived only from approved facts. Review the two new PDFs before uploading them to an employer. The app offers their downloads under **Profile & resumes**.

To add a resume, put its PDF under `private/resumes/` and add its ID and exact filename to the profile catalogue. Keep filenames as plain basenames. The app serves only catalogued PDF files inside that directory.

Every generated answer starts unapproved. Editing wording or supporting facts resets its approval. Profile changes invalidate old packs. The assistant uses the installed, signed-in **Codex CLI**, without a separate API key; run `codex login` if needed. Set `CODEX_BIN` in the shell before starting the app if Codex is installed at a different location. Model requests use your Codex account and its usage limits. The supplied job description is treated as untrusted data; generation runs with browser, shell, plugins, and other tools disabled.

## Backup and recovery

In **Settings**, export a workspace backup before substantial edits or moving computers. The JSON contains the profile, preferences, applications and answer packs. It does **not** include PDF files, OAuth credentials, OAuth tokens, or browser sessions. Separately copy catalogued PDFs from `private/resumes/` to your own secure backup location.

On a new machine, install dependencies, configure your Desktop OAuth client and tracker ID, sign in, and restore the workspace JSON in Settings. Restore the PDFs into `private/resumes/` with their original catalogue filenames. Inspect the restored records before syncing: restored applications start pending. Restoration replaces workspace contents, so export the destination's current data first. Reinstall the Chrome extension and import a fresh reviewed bundle.

Private files have local access restrictions; they are not an encrypted vault. Downloaded backups and Chrome bundles contain personal data too. Keep them out of public repositories and shared folders.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| App does not load | Start the server and keep its terminal open; use `http://127.0.0.1:4318`, not an alternate hostname. |
| Sign-in screen after a restart | Sign in again; browser sessions are held in server memory. This does not erase applications. |
| Wrong Google account | Choose the verified workspace owner; Chrome's default account can be different. |
| Google Sheets API disabled | Follow the setup link, enable Sheets API in the OAuth client's Cloud project, then retry Sync. |
| Sheet access denied | Check the configured spreadsheet ID and that the signed-in owner can edit it. Public sharing is unnecessary. |
| Expired/revoked Google grant | Reconnect Google. A test-mode OAuth grant may expire independently of the browser session. |
| Sync conflict | Review the local and Sheet versions and deliberately choose the correct one. Pending does not mean synced. |
| Generation unavailable | Check that Codex is installed and signed in; set `CODEX_BIN` before starting if needed. Manual drafting remains available. |
| Bundle rejected or answer missing | Review changed profile/answers, save the pack, and export/import a fresh bundle; approvals are version checked. |
| Fields skipped | Use an approved company hostname, scan again after page changes, and fill unsupported or sensitive fields manually. |
| Automated Chrome redirect blocked | Open the normal app URL manually in Chrome; verify sign-in there. This environment has blocked automated loopback navigation. |

## Free hosting deployment — required next release

**Target: use the app through HTTPS with this Mac switched off.** The [hosting implementation plan](docs/job-search-system-implementation-plan.html#deployment) specifies the architecture, migration phases, configuration and launch gates. A Git import into Vercel alone is not a working deployment. The current backend depends on local files, local Codex authentication, loopback OAuth, and process memory. Building the React frontend alone does not provide those services.

Vercel supports Express, so retaining Express is an option; a Next.js rewrite is not required. Adapt the entry point and static asset routing to the supported deployment model. See [Vercel's Express guide](https://vercel.com/docs/frameworks/backend/express). The cloud adapters below are implemented; activate and verify them using the [deployment runbook](docs/hosted-deployment.md):

| Area | Required change |
| --- | --- |
| Workspace data | Replace local JSON storage with a persistent database; retain stable IDs, version checks, transactional updates and conflict handling. |
| Resume files | Use private object storage and authenticated downloads; never put personal PDFs in public build assets. |
| Google authentication | Create a **Web application** OAuth client with an exact HTTPS callback, following [Google's web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server); retain owner verification and browser-bound state. |
| Sessions and tokens | Persist sessions, owner identity, OAuth state and refresh tokens appropriately; use Secure/HttpOnly cookies, encrypted token storage and managed server secrets. |
| Host and CSRF controls | Configure the deployed origin/callback explicitly and retain CSRF protection; replace hard-coded loopback assumptions. |
| AI generation | Integrate a hosted model API with explicit credentials, quotas and any approved billing. Retain the signed-in CLI adapter for local development only; the deployed app must not depend on this Mac. |
| Generation jobs | Persist job state and results; begin with a bounded provider call and explicit timeout/retry recovery. Add a durable runner only if needed and its free allowance is verified. |
| Google Sheets sync | Preserve conflict checks and serialize concurrent writes for the workspace; configure the same private tracker deliberately. |
| Deployment operations | Separate preview/production secrets and data, add migrations, backup/restore, redacted logs and rollback checks. |
| Chrome extension | Still installed separately in Chrome. Bundle import can stay; direct hosted-account integration would be additional work. |

Recommended infrastructure: **Vercel Hobby + Supabase Free** (Postgres and private resume storage). **Render Free + Supabase** is the alternative. Vercel Hobby is limited to personal, non-commercial use ([terms](https://vercel.com/docs/plans/hobby)); Supabase Free has storage/egress limits and pauses inactive projects ([quotas](https://supabase.com/pricing)). Render Free sleeps on idle and has ephemeral local storage ([limits](https://render.com/docs/free)).

Delivery order: cloud/local adapters → durable data and Web OAuth → hosted AI and feature parity → isolated preview checks → backup/import/cutover → full hosted workflow and recovery verification. Keep Google Sheets IDs stable and avoid running the local and hosted app as competing writers. The proposed first hosted release stays single-owner; supporting other users requires separate tenant isolation work.

Hosting/storage should remain within free allowances, with no automatic paid upgrades. Hosted AI generation needs a separate provider credential; a free hosting tier does not include the existing local Codex runtime. Choose its data policy, quota and any permitted inference budget before activation. Manual drafting remains a fallback; the full release requires live hosted generation to pass.

Execution requires the hosting/Supabase accounts, a stable deployment URL, Google Web OAuth configuration and the chosen AI credential. No paid subscription has been activated. Account setup, migration and live deployment must be verified separately.

## Development and verification

```sh
npm ci
npm --prefix extension ci
npm run check
```

This runs full app TypeScript checking, server/assistant/Sheets tests, extension tests, and both production builds. Tests cover persistence, CSRF and origin checks, duplicate handling, conflicts, plain-value Sheet writes, profile approvals, generation races, optional installation, field mapping, changed-page protection, no-overwrite/no-submit, and pack validation.

See [the verification record](docs/verification.md) for the 13 October 2026 result: the original 41-test baseline passed. Hosted adapter/API tests have since been added, including disposable PostgreSQL verification; see the deployment runbook for commands. These are recorded implementation checks, not a claim that every employer portal is supported. Google API tests use mocked transports. The Sheets API has been enabled and a live sync of the current tracker completed successfully. Extension installation is not yet confirmed; a non-submitting form test and real portal pilot remain pending. A signed-in Codex generation was tested live; browser workflow checks use an isolated local workspace so no test applications enter the actual tracker.

| Folder | Purpose |
| --- | --- |
| `app/client` | React UI and styles |
| `app/server` | Express API, local store, Google OAuth/Sheets sync, Codex generation |
| `app/shared` | Shared contracts |
| `apps-script` | Optional Sheet menu/sidebar and tests |
| `extension` | Manifest V3 Chrome side panel, field mapper, tests |
| `assistant` | Portable prompts, answer-pack schema and validator |
| `docs` | Current implementation/operating guide, API contract, verification record |
| `private` | Personal data and local credentials; never committed |
