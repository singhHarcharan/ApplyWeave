# ApplyWeave

One workspace for your job search: save a role, prepare grounded answers, review what will be filled, and track the outcome in Google Sheets.

## Start the app

On this Mac, double-click **Start ApplyWeave.command**, or run:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4318** in Chrome. Keep the terminal running. Node.js 20.19+ or 22+ is recommended. For development, `npm run dev` starts the API and Vite at `http://127.0.0.1:5173`.

The app is local to your computer. Personal information, application records, answer packs, credentials, and resumes are stored under the Git-ignored `private/` directory. A fresh clone starts with an empty profile; import an approved profile in **Profile & resumes**, or restore a private backup in **Settings**. Keep private backups somewhere safe outside the repository.

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
4. In ApplyWeave **Settings → Google Sheets**, import that JSON and enter the tracker spreadsheet ID. Save the configuration, click **Connect Google**, and select the Sheet's owner account. Complete Google's consent yourself.
5. Return to ApplyWeave and click **Sync Google Sheets**. The header and individual records show the actual result. Resolve any conflicts before continuing.

The scopes are `openid`, `email`, and `spreadsheets`; the last permits reading/writing spreadsheets accessible to your account. ApplyWeave's code targets only the configured spreadsheet. Tokens and the client file are stored locally with restricted file permissions. Disconnect removes the local token; revoke the app separately in your Google Account if desired.

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

A non-submitting pilot page is included at `extension/test-form.html`. Serve that directory on localhost, explicitly enable its hostname in the helper, and test with sample data before a real application. Automated access to Chrome's extension-management page is blocked in this environment, so installation must be done by you.

## Profiles and resumes

The private profile contains the approved facts and contact details. Six resume versions are available on this computer: the original SDE, MERN, PYTHON and STARTUP PDFs, plus FRONTEND and AI variants derived only from approved facts. Review the two new PDFs before uploading them to an employer. The app offers their downloads under **Profile & resumes**.

To add a resume, put its PDF under `private/resumes/` and add its ID and exact filename to the profile catalogue. Keep filenames as plain basenames. The app serves only catalogued PDF files inside that directory.

Every generated answer starts unapproved. Editing wording or supporting facts resets its approval. Profile changes invalidate old packs. The assistant uses the installed, signed-in **Codex CLI**, without a separate API key; run `codex login` if needed. Set `CODEX_BIN` in the shell before starting the app if Codex is installed at a different location. Model requests use your Codex account and its usage limits. The supplied job description is treated as untrusted data; generation runs with browser, shell, plugins, and other tools disabled.

## Development and verification

```sh
npm run check
```

This runs full app TypeScript checking, server/assistant/Sheets tests, extension tests, and both production builds. Tests cover persistence, CSRF and origin checks, duplicate handling, conflicts, plain-value Sheet writes, profile approvals, generation races, optional installation, field mapping, changed-page protection, no-overwrite/no-submit, and pack validation.

See `docs/verification.md` for the current verification record. Google API tests use mocked transports. Live Google synchronization and the installed extension need a final pilot after their authorization/install steps. A signed-in Codex generation was tested live; browser workflow checks use an isolated local workspace so no test applications enter the actual tracker.

| Folder | Purpose |
| --- | --- |
| `app/client` | React UI and styles |
| `app/server` | Express API, local store, Google OAuth/Sheets sync, Codex generation |
| `app/shared` | Shared contracts |
| `apps-script` | Optional Sheet menu/sidebar and tests |
| `extension` | Manifest V3 Chrome side panel, field mapper, tests |
| `assistant` | Portable prompts, answer-pack schema and validator |
| `docs` | Original plan, API contract, implementation notes |
| `private` | Personal data and local credentials; never committed |
