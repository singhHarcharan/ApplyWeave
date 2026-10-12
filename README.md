# ApplyWeave

A single workflow for tracking job applications, preparing fact-grounded answers, and filling repeated fields on selected company portals. You choose jobs on LinkedIn, Wellfound, or company sites; ApplyWeave starts when you save a role.

**Target roles:** SDE, frontend, backend, full stack, AI engineer, and MERN. Personal search preferences live in the ignored `private/` folder. The initial 30-day window begins 12 October 2026.

## What is here

| Module | Source | What it does |
| --- | --- | --- |
| Google Sheets tracker | `apps-script/` | Application IDs, statuses, follow-ups, profile approvals, daily queue, dashboard, and add/update sidebar |
| Codex assistant | `assistant/` | Reusable job-description prompt, answer-pack contract, and fact-reference validation |
| Chrome helper | `extension/` | Click-to-scan, preview, and fill selected text fields on allowlisted company portals |

The Sheet is the application source of truth. One `AW-...` Application ID follows a role into its answer pack and status updates. The first release uses an approved JSON export to move profile facts from Sheets into the Chrome helper. It does not need a server, OAuth app, or AI API key.

## 1. Set up the Google Sheet

Use your existing ApplyWeave Google Sheet. The account editing it needs Editor permission. Sign in as the owner or grant the working account Editor access. Avoid enabling “Anyone with the link can edit.” Restrict link visibility before putting personal application data in the Sheet.

The bound script is ready in `apps-script/Code.gs` and `apps-script/Sidebar.html`. Once editor access is available, open **Extensions → Apps Script** in the Sheet, add the two files with those names, save, run `setupApplyWeave` once, and authorize the requested spreadsheet actions. Reload the Sheet to see the **ApplyWeave** menu. The setup preserves a nonempty unrelated `Sheet1` and refuses to replace tabs with different headers.

The script creates:

- `Applications`: one row per company and role, with a generated ID, dropdowns, duplicate warning, exact resume used, and next action/date.
- `Today`: due or overdue actions and interviews in the next seven days.
- `Profile & Answers`: contact fields, facts, reusable answers, and resume catalogue; only checked rows are exported.
- `Dashboard`: stage counts, this week's submissions, interviews, and overdue actions.

Add a role from the sidebar before applying. Move it to **Applied** only after the actual submission, entering the exact resume filename and application date. The default follow-up is seven days later and can be changed. Rejected and Withdrawn clear the action; Offer remains active until resolved.

### Profile tab row format

`Type` is one of `Contact`, `Fact`, `Standard answer`, `Resume`. `Key / Fact ID` is a contact field name (`fullName`, `email`, `phone`, `location`, `linkedin`, `github`, `portfolio`, `availability`), a stable fact ID (`F001`), an answer key, or a resume ID (`SDE`, `MERN`, `PYTHON`, `STARTUP`). `Value / Approved Wording` is the exact approved text or PDF filename. `Source` records the resume or direct confirmation. Check `Approved` only after review. Standard answers use comma-separated supporting fact IDs in the last column.

The source audit and confirmed export are in `private/`, excluded from Git. After the Sheet is private and editable, import `private/approved-profile.json` from the sidebar into the empty profile tab, then export it again from the Sheet. The Sheet currently has link-based public viewing; keep profile rows empty until visibility is restricted.

## 2. Prepare an application

1. Save the role in the Sheet and copy its Application ID.
2. Use the Sheet menu to export approved profile JSON.
3. In Codex, use `assistant/prepare-application.md` with that JSON, `private/preferences.json`, the full job description, and any application questions.
4. Review the recommendation and answers. Save the resulting JSON under `private/answer-packs/` and mark each answer `approved: true` only after checking it against the cited facts.
5. Check the pack: `node assistant/validate-pack.mjs path/to/approved-profile.json path/to/answer-pack.json`.
6. Record the recommended and, later, actually submitted resume version in the Sheet.

The resume recommendation starts with the four supplied PDFs. A dedicated frontend or applied-AI resume should be written after the fact audit and sample job descriptions show which evidence to emphasize.

## 3. Use the Chrome helper

From `extension/`, run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`. The extension has temporary `activeTab` access after you click it, plus scripting and local storage. It has no blanket host permission.

Import the approved profile JSON. Import a matching answer pack if a form has approved custom questions. Open a company portal, click ApplyWeave, enable that exact hostname after reviewing it, and scan the form. Inspect every proposed value, select fields, and click **Fill selected fields**. Existing values are skipped. The helper never uploads a resume or presses a final submit button. LinkedIn and Wellfound are always blocked for page interaction. The `extension/test-form.html` file is a local, non-submitting test page; serve its directory from localhost to test the helper safely before a real portal.

The first release supports common text fields and exact-match approved questions. Portal-specific forms still need review and may require a small adapter after observing a real application. Keep salary, sponsorship, legal declarations, and self-identification questions manual.

## Verification and privacy

`npm test` verifies domain blocking, field matching, no-overwrite, no-submit behavior, and answer-pack version/fact references. The Google Sheet and bound Apps Script still need live verification once Editor access is available. `private/`, `extension/dist/`, and `node_modules/` are ignored so the public GitHub repo does not include personal profile drafts, approved exports, or application records.

The detailed implementation plan remains in `docs/job-search-system-implementation-plan.html`.
