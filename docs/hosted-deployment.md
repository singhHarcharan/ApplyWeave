# Hosted deployment runbook

Updated 13 October 2026. Production URL: **https://applyweave.vercel.app**. Vercel production secrets, Supabase schema, Google Web OAuth, and migration of the profile and six private PDFs are complete. Public session API returns 200; private APIs return 401 without sign-in; the OAuth start API returns a Google authorization URL and binding cookie. Browser sign-in/consent and live hosted Sheets sync remain pending. OpenAI generation is blocked by exhausted API credits.

## Target and configuration

Use Vercel Hobby for the React/Vite site and Express API, and Supabase Free for Postgres plus a private resume bucket. `vercel.json` builds `app/dist`, routes `/api/*` to `api/index.ts`, includes the SQL migration and allows 120 seconds per API execution. Render Free is supported by `render.yaml` as an alternative; its cold starts and ephemeral disk require the same external storage.

Copy `.env.example` to the ignored `.env.hosted` (mode 600). Populate server-only values through a local editor or the provider's environment-variable settings. Never paste secrets in chat or commit them. `SUPABASE_RESUME_BUCKET` defaults to `applyweave-resumes`. Use a Supabase transaction-pooler `DATABASE_URL`; prepared statements are disabled. The small auth/job and workspace connection pools are separate to avoid sync/refresh lock deadlocks.

`APP_ORIGIN` must be the final HTTPS origin and `GOOGLE_REDIRECT_URI` must exactly equal that origin plus `/api/auth/google/callback`. Preview environments need isolated credentials/data and a stable preview origin. Unconfigured deployments fail closed. Do not disable host validation to make an arbitrary preview URL work.

Use a Google OAuth **Web application** client for hosting. Keep the existing Desktop client for local use. Configure `OWNER_EMAIL` before exposing the app; the first arbitrary visitor cannot claim the workspace. Sign-in pins the verified Google subject and stores session state in Postgres. Tokens and OAuth state are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY` (32 random bytes in base64 or 64 hexadecimal characters). Keep a recovery copy of the key separately from database backups. The OAuth browser session survives cold starts; logout revokes it across instances.

## AI activation

The user switched to OpenAI. Production uses `AI_PROVIDER=openai`, `AI_MODEL=gpt-5.4-mini`, and a server-only `AI_API_KEY`. Key authentication passed, but a minimal Responses request returned `credit_balance_exhausted` / `insufficient_quota`. Add API credits separately from a ChatGPT/Codex subscription before generation can be accepted as working. The app can still support manual preparation once signed in.

Gemini remains an optional adapter. Its paid-service data policy was approved by the user, but no Gemini key was supplied. Switching providers requires explicit configuration; there is no automatic fallback.

The researched starting model is `gemini-3.5-flash-lite`; verify its availability for the account before use. Google's [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [terms](https://ai.google.dev/gemini-api/terms) distinguish unpaid-service data handling from paid-service handling. Unpaid services can use inputs/outputs for improvement and human review and instruct against submitting personal/confidential data. Do not send the real resume profile before resolving this. Hosting on a free tier does not make inference free.

Prompts omit contact details, resume filenames, source file paths, saved standard answers and unrelated preferences. Career facts and the pasted job description are still transmitted. Provider requests have no tools, no automatic retries, a bounded timeout/output and an explicit daily attempt limit (`AI_DAILY_LIMIT`, default 20, resetting midnight UTC). Failed attempts count too. Manual drafting/import remains available. No automatic provider switch or paid upgrade exists.

## Preflight and migration

Run with Node 22 recommended:

```sh
npm ci
npm --prefix extension ci
npm run check
node --env-file=.env.hosted --import tsx scripts/check-hosted.ts --database
node --env-file=.env.hosted --import tsx scripts/migrate-hosted.ts
```

The first migration invocation is a dry run. It validates the local workspace and PDF files without copying them. Before applying:

1. Export a private JSON backup and separately copy the six PDFs. Stop local edits/sync during cutover.
2. Verify the new Supabase project is intended for ApplyWeave and uses the Free plan. Resolve any pending Sheet conflicts.
3. Populate the hosted environment, including the new Web OAuth client. Do not copy Desktop refresh tokens or browser sessions.
4. Apply the migration:

   ```sh
   node --env-file=.env.hosted --import tsx scripts/migrate-hosted.ts --apply
   ```

5. The migration creates the private schema and bucket, uploads PDFs and verifies their bytes. It only imports into an empty or identical workspace, refusing different existing data. Application IDs, packs and sync baselines are preserved.
6. Set the same environment in Vercel Production (server only), deploy and sign in again. Inspect data and perform a controlled sync; verify no duplicate rows.

The API supports authenticated PDF uploads at `POST /api/resumes` with `{id,filename,dataBase64}` (3 MB UI/API cap). It refuses overwriting existing IDs/files. The migration/storage adapter supports PDFs up to 10 MB. Uploaded resume catalogue changes update the profile version and require old packs to be reviewed again.

## Deployment

Push the reviewed source to GitHub and import `singhHarcharan/ApplyWeave` into the user's Vercel Hobby account. Repository root stays `./`; framework is Vite and `vercel.json` supplies the build/output settings. No custom domain purchase is needed. Use the assigned URL to finalize `APP_ORIGIN` and Google callback before completing OAuth.

The server API uses Postgres, so the hosting filesystem contains no personal data. All private APIs, resume downloads and exports require a session. The frontend can be public as a sign-in page; the workspace remains owner-only. Keep environment variables out of client-prefixed `VITE_*` fields.

Optional bound Apps Script installation remains a local/editor action; hosted tracking and sync work without it. The Chrome extension still needs manual Load unpacked and a portal pilot. It imports the same reviewed bundle and never submits forms.

## Launch gates

- Google owner sign-in succeeds; a different account is refused; session survives a new API instance.
- Applications, profile, preferences and packs survive redeployment.
- Private resume upload/download works; anonymous access fails.
- Real Gemini generation succeeds under the accepted data policy. Answers begin unapproved, evidence/length checks pass, and stale results cannot overwrite edits.
- Retrying a lost generation response reuses a request ID; a job and its pack commit atomically. Daily limits and interrupted-job recovery work.
- Google Sheet sync completes with correct IDs and zero unresolved conflicts.
- Chrome bundle imports and passes the non-submitting fixture; actual portal pilot remains manual where needed.
- Backups restore in an isolated environment. JSON exports exclude PDF binaries and credentials; download PDFs separately from the resume catalogue.
- No secret, token, resume or local private file appears in Git or static assets.

## Recovery

Quota errors preserve stored work. A paused Supabase Free project must be resumed in its dashboard; do not generate artificial traffic to evade service limits. Keep independent exports because free tiers do not promise uninterrupted availability. Before a local rollback, reconcile any hosted changes and pause hosted writes so there is only one active writer. Restore compatible code/database versions deliberately; a Vercel code rollback does not restore database contents.

## Test evidence

`npm run check` runs repeatable transport-mocked tests, local API tests and both builds. Additional real Postgres suites use disposable schemas/databases:

- `TEST_DATABASE_URL` → hosted storage concurrency/rollback.
- `TEST_HOSTED_API_DATABASE_URL` → cross-instance API/session, generation atomicity/idempotency/limits.
- `TEST_AUTH_DATABASE_URL` → OAuth replay, owner restrictions and serialized refresh. **Dedicated test database only: this suite truncates auth tables.**

Provider credentials and live deployment results are separate activation gates.
