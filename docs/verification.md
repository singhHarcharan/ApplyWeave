# Implementation verification — 13 October 2026

## Passed

- Google Desktop OAuth client is configured. Google Sheets API was enabled in the correct Cloud project and live sync succeeded both through the app API and the Chrome UI (zero conflicts). Test fixtures still use mocked Google transports for repeatability.

- `npm run check`: app and extension TypeScript checks, both production builds, 41 tests (19 backend/generator/Google error handling, 9 Apps Script/portable assistant, 13 extension).
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities.
- Live Codex CLI generation with the existing account sign-in, followed by structured output and evidence validation.
- Browser workflow in an isolated local workspace: add role → generate from sample JD → inspect supporting facts → mark a sample answer reviewed → save → download Chrome bundle. Export preserved its Application ID, matching profile version, and approval. The test workspace is separate from actual application records.
- Production UI renders the actual preferences and approved profile; six local resume PDFs are catalogued. FRONTEND and AI PDFs were rendered and visually checked; both are one page.
- Live Google Sheet reads confirm the Today empty state, stage counts, checked education contacts, and six resumes. Parsing the actual checked Sheet profile with the app adapter matches the local approved content: 17 facts, six resume versions.
- Submitted resume selection survives later answer generation. Edited application/profile/pack data cannot be silently replaced by a generation started earlier. A reordered Sheet profile does not create a false content conflict.
- Local private files, OAuth credentials/tokens, generated PDFs, app data, and QA records are excluded from Git.

## Pending user activation / real-use validation

- Optionally authorize/install the bound Apps Script sidebar and run it in Google Sheets. Source, API installer, and mocked tests are ready. The existing editor link produced a Google “Page not found” error.
- Manually load the built extension into Chrome. Automated navigation to Chrome's internal extension-management page is blocked. Scan/fill a non-submitting test page, then pilot an actual company portal chosen by the user.
- Review the new frontend/applied-AI PDFs before employer uploads. Test the assistant against real job descriptions and refine after actual applications.

Chrome automation could not open the local app URL (`ERR_BLOCKED_BY_CLIENT`); rendered workflow QA used Codex's in-app browser. The app is served over loopback for the user to open directly in Chrome. No real employer application was submitted and no test rows were left in the live tracker.


## Google sign-in and API error fix

- Private API requests without a browser session return `401 AUTH_REQUIRED`, including workspace, profile export, backup export, and resume download; verified against the running server.
- Automated tests cover browser-bound OAuth state, unverified email rejection, wrong-account rejection, immutable owner account pinning, HttpOnly/SameSite cookie settings, authenticated API access, logout invalidation, and same-owner refresh-token reuse. Owner pinning is serialized across concurrent callbacks.
- Public sign-in screen reveals no candidate data. All private React views unmount on logout or session expiration. The Google session is separate from the persisted Sheets grant.
- Disabled Sheets API, denied Sheet access, missing tracker, rate limiting, and temporary failures now have distinct safe messages; raw upstream JSON is not displayed. The disabled-API message provides an official Google Cloud activation link and retry.
- The Google Cloud console confirms Sheets API enabled. Existing tracker sync returned HTTP 200 and zero conflicts; the previous 403 banner cleared in Chrome.
- Live Google sign-in succeeded for the approved owner and persisted the verified account ID. Chrome displayed the authenticated dashboard with account email and Sign out. Chrome blocked the automated redirect page; the user manually opened the normal app URL, where the session was valid.

## Hosted implementation verification — 13 October 2026

- Full check with disposable PostgreSQL integration enabled: **56 tests passed, zero failed, zero skipped** (34 backend/provider/storage/auth, 9 Apps Script/portable assistant, 13 extension). Both TypeScript checks and both builds passed.
- Hosted storage tests verify concurrent transactions, rollback, restart persistence and private database policies.
- Hosted API tests verify sessions across server instances, owner access, origin checks, persistent jobs, awaited provider execution, request replay, atomic job/pack commit and daily caps.
- OAuth tests verify browser binding, encrypted state, replay rejection, immutable owner identity, serialized refresh and persistent session revocation.
- Private resume storage tests verify MIME/magic/size checks, private buckets and refusal to overwrite differing PDFs.
- Isolated browser QA verified the new resume upload form: a synthetic PDF was uploaded, the catalogue and profile version updated, and the success state rendered. The actual candidate profile/tracker was not used.
- `scripts/migrate-hosted.ts` dry run validated the current local workspace and six PDFs; no live migration was performed.
- Vercel and Render deployment configuration and a hosted runbook are provided. Supabase credentials, Google Web OAuth and live Gemini configuration/accepted data policy remain activation gates. Live deployment is not yet verified.

## Live hosted activation — 13 October 2026

- Production deployment: https://applyweave.vercel.app, Vercel Hobby + Supabase Free. All 18 server settings saved as Production Secret variables.
- Google Web OAuth client created with the exact production callback; existing shared Google consent branding remains HireHello.
- Supabase connection and migration verified: 0 applications, 0 packs, approved profile and 6 private PDFs; uploads verified byte-for-byte. Local tokens were not copied.
- Live `/api/auth/session`: HTTP 200, unauthenticated; private state: HTTP 401 AUTH_REQUIRED. OAuth start: HTTP 200, Google authorization URL and binding cookie.
- Automated browser sign-in displayed Failed to fetch; user manual sign-in requested. Hosted authenticated workflow and Sheets sync are not yet verified.
- OpenAI key authenticated; minimal generation failed with credit_balance_exhausted / insufficient_quota. No real resume generation sent to OpenAI.
