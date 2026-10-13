import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Download,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Upload,
  UserRound,
  X,
  AlertCircle,
  Link2,
  Copy,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import "./style.css";

type Application = {
  applicationId: string;
  company: string;
  title: string;
  roleFamily: string;
  source: string;
  jobUrl: string;
  location: string;
  workMode: string;
  compensationLpa: number | null;
  dateSaved: string;
  dateApplied: string;
  status: string;
  resumeVersion: string;
  answerPackId: string;
  nextAction: string;
  dueDate: string;
  lastUpdated: string;
  recruiter: string;
  responseDate: string;
  interviewDate: string;
  outcome: string;
  notes: string;
  jobDescription: string;
  syncStatus: string;
};
type Profile = {
  schemaVersion: 1;
  profileVersion: string;
  personal: Record<string, string>;
  facts: { id: string; claim: string; source: string }[];
  standardAnswers: { key: string; text: string; factIds: string[] }[];
  resumeVersions: { id: string; filename: string }[];
};
type Answer = {
  question: string;
  answer: string;
  factIds: string[];
  approved: boolean;
  maxCharacters?: number | null;
};
type Pack = {
  schemaVersion: 1;
  applicationId: string;
  profileVersion: string;
  resumeVersionId: string;
  answers: Answer[];
  analysis?: {
    fit: string;
    summary: string;
    resumeReason: string;
    proofPoints: { text: string; factIds: string[] }[];
    unknowns: string[];
    workModeCheck: string;
    compensationCheck: string;
  };
};
const localBrowser = ["127.0.0.1", "localhost"].includes(window.location.hostname);
type State = {
  hostingMode?: "local" | "hosted";
  applications: Application[];
  profile: Profile;
  preferences: Record<string, any>;
  packs: Pack[];
  connection: {
    googleConfigured: boolean;
    googleConnected: boolean;
    googleEmail: string | null;
    spreadsheetId: string;
    aiAvailable: boolean;
    aiProvider?: string;
    aiModel?: string | null;
    scriptAuthorized?: boolean;
    scriptInstalled?: boolean;
  };
  lastSyncedAt: string | null;
  profileSyncStatus?: "local" | "synced" | "conflict";
  conflicts: { applicationId: string; message: string }[];
  csrfToken: string;
};
type AuthSession = {
  authenticated: boolean;
  user: { email: string } | null;
  configured: boolean;
  csrfToken: string;
};
class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public setupUrl?: string,
  ) {
    super(message);
  }
}
function GoogleMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 14a6 6 0 0 1 0-4V7.4H3a10 10 0 0 0 0 9.2L6.4 14Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.4L6.4 10c.8-2.3 3-4.1 5.6-4.1Z"
      />
    </svg>
  );
}
function Login({
  configured,
  error,
  busy,
  signIn,
  retry,
}: {
  configured: boolean;
  error: string;
  busy: boolean;
  signIn: () => void;
  retry: () => void;
}) {
  return (
    <main className="login-page">
      <div className="login-story">
        <a className="brand" href="/">
          <span className="brand-mark">w</span>ApplyWeave
        </a>
        <div className="login-story-content">
          <div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>
            Bring your next <br />
            opportunity <br />
            <em>into focus.</em>
          </h1>
          <p>
            A thoughtful workspace for your job search.
            <br />
            From the first saved role to the next offer.
          </p>
          <div className="login-benefits">
            <span>
              <BriefcaseBusiness size={18} />
              Every application, connected.
            </span>
            <span>
              <Sparkles size={18} />
              Answers grounded in your experience.
            </span>
            <span>
              <CalendarDays size={18} />A clear next step, every day.
            </span>
          </div>
        </div>
        <div className="login-story-footer">
          Built for the work of finding your next role.
        </div>
        <div className="login-weave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="login-entry">
        <div className="login-card">
          <span className="login-welcome-icon">
            <ArrowUpRight size={24} />
          </span>
          <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
          <h2>Welcome to ApplyWeave.</h2>
          <p className="login-description">
            Sign in with the Google account connected to your tracker to open
            your applications, profile, and answers.
          </p>
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          <button
            className="google-signin"
            disabled={!configured || busy}
            onClick={signIn}
          >
            {busy ? (
              <LoaderCircle className="spin" size={19} />
            ) : (
              <GoogleMark />
            )}
            {busy ? "Opening Google…" : "Sign in with Google"}
            <ArrowRight size={17} />
          </button>
          <p className="login-browser-hint">
            Use Chrome for Google sign-in. If Google blocks an embedded browser,
            open <code>{window.location.origin}</code> in Chrome.
          </p>
          {!configured && (
            <div className="login-setup">
              <strong>{localBrowser ? "Connect Google on this computer first" : "Google sign-in is being configured"}</strong>
              {localBrowser ? <><p>Download your Google Desktop OAuth client JSON, then run this command from the ApplyWeave project folder:</p><code>npm run configure-google -- /path/client.json spreadsheet-id</code></> : <p>The workspace owner needs to complete the hosted Google connection. Check again once setup is complete.</p>}
              <p>
                Keep the client file private. Once configured, check again to
                continue.
              </p>
              <button className="text-button" onClick={retry}>
                <RefreshCw size={14} />
                Check configuration
              </button>
            </div>
          )}
          <div className="login-privacy">
            <ShieldCheck size={18} />
            <p>
              Your applications stay private. Signing out locks this workspace
              and keeps your Google Sheets connection ready for next time.
            </p>
          </div>
        </div>
        <div className="login-footer">A little clarity. A little momentum.</div>
      </div>
    </main>
  );
}
type View =
  | "Dashboard"
  | "Applications"
  | "Prepare"
  | "Profile & resumes"
  | "Settings";
const statuses = [
  "Saved",
  "Preparing",
  "Applied",
  "Assessment",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];
const roles = [
  "Software Development Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Developer",
  "AI Engineer",
  "MERN Developer",
];
const today = () => new Date().toLocaleDateString("en-CA");
const dateLabel = (value: string) =>
  value
    ? new Date(
        value.length === 10 ? value + "T12:00:00" : value,
      ).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "—";
const active = (a: Application) =>
  !["Rejected", "Withdrawn"].includes(a.status);
const due = (a: Application) =>
  active(a) &&
  ((!!a.dueDate && a.dueDate <= today()) ||
    a.status === "Preparing" ||
    (!!a.interviewDate &&
      a.interviewDate >= today() &&
      a.interviewDate <=
        new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA")));
const blankApp = (): Partial<Application> => ({
  company: "",
  title: "",
  roleFamily: roles[0],
  source: "LinkedIn",
  jobUrl: "",
  location: "",
  workMode: "Remote",
  compensationLpa: null,
  status: "Saved",
  dateSaved: today(),
  dateApplied: "",
  resumeVersion: "",
  nextAction: "Prepare application",
  dueDate: today(),
  recruiter: "",
  responseDate: "",
  interviewDate: "",
  outcome: "",
  notes: "",
  jobDescription: "",
});
function Badge({
  children,
  kind = "",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return <span className={"badge " + kind.toLowerCase()}>{children}</span>;
}
function Empty({
  icon: Icon = BriefcaseBusiness,
  title,
  children,
  action,
}: {
  icon?: any;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={"field " + (wide ? "wide" : "")}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [view, setView] = useState<View>("Dashboard"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [drawer, setDrawer] = useState<Partial<Application> | null>(null),
    [selected, setSelected] = useState("");
  const token = useRef("");
  const epoch = useRef(0);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [syncSetup, setSyncSetup] = useState("");
  function clearPrivate() {
    epoch.current += 1;
    setState(null);
    setDrawer(null);
    setSelected("");
    setView("Dashboard");
    setError("");
    setNotice("");
    setSyncSetup("");
    setBusy("");
    setSession((current) =>
      current ? { ...current, authenticated: false, user: null } : null,
    );
  }
  async function loadSession() {
    const r = await fetch("/api/auth/session", { cache: "no-store" });
    if (!r.ok) {
      const problem=await r.json().catch(()=>null);
      throw new Error(typeof problem?.error === "string" ? problem.error : "Could not check sign-in. The workspace may be starting or temporarily unavailable; try again.");
    }
    const current: AuthSession = await r.json();
    token.current = current.csrfToken;
    setSession(current);
    if (current.authenticated) await refresh();
    else {
      setState(null);
    }
  }
  function requireSignIn() {
    clearPrivate();
    setAuthError(
      "Your session has ended. Sign in with Google to reopen your workspace.",
    );
  }
  async function signIn() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await request("/auth/google/start", {});
      window.location.assign(result.url);
    } catch (e) {
      setAuthError((e as Error).message);
      setAuthBusy(false);
    }
  }
  async function signOut() {
    setAuthBusy(true);
    try {
      await request("/auth/logout", {});
      clearPrivate();
      setAuthError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function request(path: string, body?: any, method = "POST") {
    const requestEpoch = epoch.current;
    const r = await fetch(
      "/api" + path,
      body === undefined
        ? { cache: "no-store" }
        : {
            method,
            headers: {
              "Content-Type": "application/json",
              "X-ApplyWeave-CSRF": token.current,
            },
            body: JSON.stringify(body),
          },
    );
    const j = await r
      .json()
      .catch(() => ({ error: "The server returned an unreadable response." }));
    if (r.status === 401) {
      requireSignIn();
      throw new ApiError("Sign in to continue.", "AUTH_REQUIRED");
    }
    if (!r.ok) {
      if (
        j.code === "SHEETS_API_DISABLED" &&
        typeof j.setupUrl === "string" &&
        j.setupUrl.startsWith("https://console.cloud.google.com/")
      )
        setSyncSetup(j.setupUrl);
      throw new ApiError(
        j.error || "The request could not be completed.",
        j.code,
        j.setupUrl,
      );
    }
    if (requestEpoch !== epoch.current)
      throw new ApiError("This session has ended.", "AUTH_REQUIRED");
    return j;
  }
  async function refresh() {
    const s = await request("/state");
    token.current = s.csrfToken;
    setState(s);
    return s;
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const failure = params.get("authError");
    if (failure) {
      const friendly: Record<string, string> = {
        access_denied:
          "Google sign-in was cancelled. You can try again when ready.",
        wrong_account:
          "Use the Google account connected to this ApplyWeave workspace.",
        invalid_state: "This sign-in link expired. Start a new sign-in below.",
        oauth_failed: "Google could not complete sign-in. Please try again.",
      };
      const message =
        friendly[failure] ||
        "Google sign-in did not complete. Please try again using the account connected to your tracker.";
      setAuthError(message);
      setError(message);
      params.delete("authError");
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (params.size ? "?" + params.toString() : ""),
      );
    }
    loadSession().catch((e) => setAuthError(e.message));
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);
  async function run(name: string, fn: () => Promise<any>, message = "") {
    setBusy(name);
    setError("");
    if (name === "sync") {
      setSyncSetup("");
      setNotice("");
    }
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function download(path: string, filename: string) {
    const downloadEpoch = epoch.current;
    try {
      setError("");
      const r = await fetch("/api" + path, { cache: "no-store" });
      if (r.status === 401) {
        requireSignIn();
        throw new ApiError("Sign in to download your files.", "AUTH_REQUIRED");
      }
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Download failed.");
      }
      const blob = await r.blob();
      if (downloadEpoch !== epoch.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const prepare = (a: Application) => {
    setSelected(a.applicationId);
    setView("Prepare");
  };
  const sync = () =>
    run(
      "sync",
      () => request("/sync", {}),
      "Sync finished. Check any conflicts below.",
    );
  if (!session)
    return (
      <main className="boot">
        <div className="brand">
          <span className="brand-mark">w</span>ApplyWeave
        </div>
        {authError ? (
          <>
            <p role="alert">{authError}</p>
            <button
              onClick={() => {
                setAuthError("");
                loadSession().catch((e) => setAuthError(e.message));
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Checking your sign-in…</p>
          </>
        )}
      </main>
    );
  if (!session.authenticated)
    return (
      <Login
        configured={session.configured}
        error={authError}
        busy={authBusy}
        signIn={signIn}
        retry={() => {
          setAuthError("");
          loadSession().catch((e) => setAuthError(e.message));
        }}
      />
    );
  if (!state)
    return (
      <main className="boot">
        <div className="brand">
          <span className="brand-mark">w</span>ApplyWeave
        </div>
        {error || authError ? (
          <>
            <p role="alert">{error || authError}</p>
            <button onClick={() => refresh().catch((e) => setError(e.message))}>
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Opening your workspace…</p>
          </>
        )}
      </main>
    );
  const pending = state.applications.filter(
    (a) => a.syncStatus === "pending",
  ).length;
  const nav = [
    ["Dashboard", LayoutDashboard],
    ["Applications", BriefcaseBusiness],
    ["Prepare", Sparkles],
    ["Profile & resumes", UserRound],
    ["Settings", SettingsIcon],
  ] as const;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("Dashboard");
          }}
        >
          <span className="brand-mark">w</span>ApplyWeave
        </a>
        <div className="sidebar-caption">YOUR NEXT CHAPTER</div>
        <nav aria-label="Main navigation">
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              aria-label={name}
              title={name}
              className={view === name ? "nav-item selected" : "nav-item"}
              onClick={() => setView(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Applications" && (
                <small>{state.applications.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="small-label">YOUR SEARCH</span>
          <strong>
            {state.preferences.workModes?.join(" + ") || "Remote + Hybrid"}
          </strong>
          <span>
            ₹{state.preferences.minimumCompensationLpa ?? 12} LPA minimum
          </span>
          <div className="sidebar-rule" />
          <span className="account-avatar">
            {(state.profile.personal.fullName || "Your workspace")
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </span>
          <strong>{state.profile.personal.fullName || "Your workspace"}</strong>
          <span className="account-email">{state.profile.personal.email}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} /> <b>{view}</b>
          </span>
          <div className="top-actions">
            <span className="signed-in-email" title={session.user?.email}>
              {session.user?.email}
            </span>
            <button
              className="icon-button signout"
              aria-label="Sign out of ApplyWeave"
              title="Sign out"
              disabled={authBusy}
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
            <span
              className={
                "connection-dot " +
                (state.connection.googleConnected ? "connected" : "")
              }
            />
            <span className="sync-label">
              {state.connection.googleConnected
                ? pending
                  ? `${pending} pending sync`
                  : "Google Sheets connected"
                : "Saved on this computer"}
            </span>
            <button
              className="icon-button"
              aria-label="Sync Google Sheets"
              disabled={!!busy || !state.connection.googleConnected}
              onClick={sync}
            >
              <RefreshCw size={17} className={busy === "sync" ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {syncSetup && (
            <div className="alert warning sync-setup">
              <AlertCircle size={18} />
              <div>
                <strong>Enable Google Sheets access</strong>
                <p>
                  The Google Sheets API is disabled for this connection's Google
                  Cloud project. Enable it, allow a moment for the change to
                  apply, then retry. Your workspace changes are still pending.
                </p>
                <div className="button-row">
                  <a
                    className="button secondary"
                    href={syncSetup}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Enable Sheets API <ArrowUpRight size={15} />
                  </a>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={sync}
                  >
                    <RefreshCw size={15} />
                    Retry sync
                  </button>
                </div>
              </div>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "Dashboard" && (
            <Dashboard
              state={state}
              add={() => setDrawer(blankApp())}
              edit={setDrawer}
              prepare={prepare}
              go={setView}
            />
          )}
          {view === "Applications" && (
            <Applications
              state={state}
              add={() => setDrawer(blankApp())}
              edit={setDrawer}
              prepare={prepare}
            />
          )}
          <div hidden={view !== "Prepare"}>
            <Prepare
              key={
                selected || state.applications[0]?.applicationId || "initial"
              }
              state={state}
              selected={selected}
              onSelect={setSelected}
              request={request}
              refresh={refresh}
              download={download}
              report={setError}
              notify={setNotice}
              add={() => setDrawer(blankApp())}
            />
          </div>
          {view === "Profile & resumes" && (
            <ProfileView
              state={state}
              run={run}
              request={request}
              busy={busy}
              download={download}
            />
          )}
          {view === "Settings" && (
            <SettingsView
              state={state}
              run={run}
              request={request}
              busy={busy}
              download={download}
              sync={sync}
            />
          )}
          <footer className="footer">
            ApplyWeave{" "}
            <span>One role. One record. A little more momentum.</span>
            <span>
              {state.lastSyncedAt
                ? `Last synced ${new Date(state.lastSyncedAt).toLocaleString("en-IN")}`
                : "Your changes stay in this workspace until you sync."}
            </span>
          </footer>
        </main>
      </div>
      {drawer && (
        <ApplicationDrawer
          initial={drawer}
          state={state}
          close={() => setDrawer(null)}
          save={async (values) => {
            setError("");
            await request(
              values.applicationId
                ? "/applications/" + encodeURIComponent(values.applicationId)
                : "/applications",
              values,
              values.applicationId ? "PATCH" : "POST",
            );
            await refresh();
            setDrawer(null);
            setNotice("Application saved. Sync to update your Sheet.");
          }}
        />
      )}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Dashboard({
  state,
  add,
  edit,
  prepare,
  go,
}: {
  state: State;
  add: () => void;
  edit: (a: Application) => void;
  prepare: (a: Application) => void;
  go: (v: View) => void;
}) {
  const list = state.applications,
    queue = list
      .filter(due)
      .sort((a, b) =>
        (a.dueDate || a.interviewDate).localeCompare(
          b.dueDate || b.interviewDate,
        ),
      );
  const metrics = [
    ["Total applications", list.length, "Every opportunity in one place"],
    [
      "In progress",
      list.filter((a) => active(a) && !["Saved", "Offer"].includes(a.status))
        .length,
      "Moving toward your next role",
    ],
    [
      "Interviews",
      list.filter((a) => a.status === "Interview").length,
      "Conversations that count",
    ],
    [
      "Offers",
      list.filter((a) => a.status === "Offer").length,
      "The next chapter is close",
    ],
  ];
  return (
    <>
      <Heading
        eyebrow={new Date().toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        title="Make your next move."
        description="A clear view of your search, and what deserves your attention today."
        action={
          <button className="primary" onClick={add}>
            <Plus size={18} />
            Add application
          </button>
        }
      />
      <div className="metrics">
        {metrics.map(([label, note, description], i) => (
          <div className={"metric metric-" + i} key={label}>
            <span>{label}</span>
            <strong>
              {note}
              <span className="metric-icon">
                {i === 0 ? (
                  <BriefcaseBusiness />
                ) : i === 1 ? (
                  <ArrowUpRight />
                ) : i === 2 ? (
                  <CalendarDays />
                ) : (
                  <CheckCheck />
                )}
              </span>
            </strong>
            <small>{description}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                Your next actions <Badge>{queue.length}</Badge>
              </h2>
              <p>Due, overdue, preparing, and interviews this week.</p>
            </div>
            <CalendarDays size={20} />
          </div>
          {queue.length ? (
            <div className="action-list">
              {queue.map((a) => (
                <div className="action-row" key={a.applicationId}>
                  <button
                    className="company-symbol"
                    onClick={() => edit(a)}
                    aria-label={"Edit " + a.company}
                  >
                    {a.company.slice(0, 1).toUpperCase()}
                  </button>
                  <div className="action-detail">
                    <strong>
                      {a.nextAction ||
                        (a.status === "Preparing" && "Prepare application") ||
                        "Upcoming interview"}
                    </strong>
                    <span>
                      {a.company} <span className="dot-separator">·</span>{" "}
                      {a.title}
                    </span>
                    <small
                      className={
                        a.dueDate && a.dueDate < today() ? "overdue" : ""
                      }
                    >
                      {a.dueDate
                        ? `${a.dueDate < today() ? "Overdue · " : a.dueDate === today() ? "Today · " : ""}${dateLabel(a.dueDate)}`
                        : a.interviewDate
                          ? `Interview · ${dateLabel(a.interviewDate)}`
                          : "Ready to prepare"}
                    </small>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      a.status === "Preparing" ? prepare(a) : edit(a)
                    }
                  >
                    Open <ArrowRight size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={CheckCheck}
              title="Room for your next opportunity"
              action={
                <button className="secondary" onClick={add}>
                  Save a role <Plus size={16} />
                </button>
              }
            >
              Your follow-ups and interview prep will appear here. Save a role
              to get started.
            </Empty>
          )}
        </section>
        <section className="panel pipeline">
          <div className="panel-heading">
            <div>
              <h2>Your pipeline</h2>
              <p>One step closer, at every stage.</p>
            </div>
          </div>
          <div className="stage-list">
            {statuses.slice(0, 6).map((s, i) => {
              const count = list.filter((a) => a.status === s).length;
              return (
                <div className="stage" key={s}>
                  <span className={"stage-dot stage-" + i} />
                  <span>{s}</span>
                  <div className="stage-bar">
                    <i
                      style={{
                        width: `${list.length ? (count / list.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <b>{count}</b>
                </div>
              );
            })}
          </div>
          <button
            className="text-button full"
            onClick={() => go("Applications")}
          >
            View all applications <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <section className="preparation-banner">
        <div className="banner-icon">
          <Sparkles size={25} />
        </div>
        <div>
          <div className="eyebrow">MAKE EACH APPLICATION YOURS</div>
          <h2>Your experience, matched to the role.</h2>
          <p>
            Turn a job description into grounded answers and the right resume.
          </p>
        </div>
        <button className="secondary" onClick={() => go("Prepare")}>
          Prepare an application <ArrowUpRight size={17} />
        </button>
      </section>
    </>
  );
}
function Applications({
  state,
  add,
  edit,
  prepare,
}: {
  state: State;
  add: () => void;
  edit: (a: Application) => void;
  prepare: (a: Application) => void;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("All stages"),
    [role, setRole] = useState("All roles");
  const rows = state.applications
    .filter(
      (a) =>
        (status === "All stages" || a.status === status) &&
        (role === "All roles" || a.roleFamily === role) &&
        `${a.company} ${a.title} ${a.location} ${a.applicationId}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  return (
    <>
      <Heading
        eyebrow="YOUR OPPORTUNITIES"
        title="Every application, connected."
        description="Keep the role, the answers, and the next step in one place."
        action={
          <button className="primary" onClick={add}>
            <Plus size={18} />
            Add application
          </button>
        }
      />
      <section className="panel">
        <div className="filters">
          <label className="search-box">
            <Search size={18} />
            <input
              aria-label="Search applications"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, role, or location…"
            />
          </label>
          <select
            aria-label="Filter by stage"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {["All stages", ...statuses].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Filter by role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {["All roles", ...roles].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Company & role</th>
                  <th>Stage</th>
                  <th>Details</th>
                  <th>Next action</th>
                  <th>Saved</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.applicationId}>
                    <td>
                      <button className="table-title" onClick={() => edit(a)}>
                        {a.company}
                      </button>
                      <span className="table-sub">{a.title}</span>
                      <small className="record-id">
                        {a.applicationId}{" "}
                        <span className={"sync-state " + a.syncStatus}>
                          {a.syncStatus}
                        </span>
                      </small>
                    </td>
                    <td>
                      <Badge kind={a.status}>{a.status}</Badge>
                    </td>
                    <td>
                      {a.workMode || "—"}
                      <span className="table-sub">
                        {a.compensationLpa
                          ? `₹${a.compensationLpa} LPA`
                          : a.location || "Salary not specified"}
                      </span>
                    </td>
                    <td>
                      {a.nextAction || "—"}
                      <span
                        className={
                          "table-sub " +
                          (active(a) && a.dueDate < today() && a.dueDate
                            ? "overdue"
                            : "")
                        }
                      >
                        {dateLabel(a.dueDate)}
                      </span>
                    </td>
                    <td>{dateLabel(a.dateSaved)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => prepare(a)}
                      >
                        Prepare <ArrowUpRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              state.applications.length
                ? "No matching applications"
                : "Your search starts here"
            }
            action={
              !state.applications.length ? (
                <button className="primary" onClick={add}>
                  <Plus size={16} />
                  Add your first role
                </button>
              ) : (
                <button
                  onClick={() => {
                    setSearch("");
                    setStatus("All stages");
                    setRole("All roles");
                  }}
                >
                  Clear filters
                </button>
              )
            }
          >
            {state.applications.length
              ? "Try another company, role, or stage."
              : "Found something promising? Save the role and build your application from there."}
          </Empty>
        )}
        <div className="table-footer">
          {rows.length} of {state.applications.length} applications
          <span>Changes are saved to your workspace; sync when you are ready.</span>
        </div>
      </section>
    </>
  );
}
function ApplicationDrawer({
  initial,
  state,
  close,
  save,
}: {
  initial: Partial<Application>;
  state: State;
  close: () => void;
  save: (a: any) => Promise<void>;
}) {
  const [data, setData] = useState<any>({ ...blankApp(), ...initial }),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [duplicate, setDuplicate] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) close();
      if (e.key === "Tab") {
        const els = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      last?.focus();
    };
  }, []);
  const input = (key: string, label: string, type = "text", wide = false) => (
    <Field label={label} wide={wide}>
      <input
        type={type}
        required={["company", "title"].includes(key)}
        value={data[key] ?? ""}
        onChange={(e) =>
          setData({
            ...data,
            [key]:
              key === "compensationLpa"
                ? e.target.value
                  ? Number(e.target.value)
                  : null
                : e.target.value,
          })
        }
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.1" : undefined}
      />
    </Field>
  );
  const select = (key: string, label: string, options: string[]) => (
    <Field label={label}>
      <select
        value={data[key]}
        onChange={(e) => setData({ ...data, [key]: e.target.value })}
      >
        {options.map((s) => (
          <option value={s} key={s}>
            {s || "Choose a resume"}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="modal-backdrop">
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={dialog}
        tabIndex={-1}
      >
        <header className="drawer-header">
          <div>
            <div className="eyebrow">
              {initial.applicationId || "A NEW OPPORTUNITY"}
            </div>
            <h2 id="drawer-title">
              {initial.applicationId
                ? "Edit application"
                : "Save an application"}
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close application form"
          >
            <X />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              await save({ ...data, allowDuplicate: duplicate });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="drawer-body">
            <h3>The opportunity</h3>
            <div className="form-grid">
              {input("company", "Company *")}
              {input("title", "Job title *")}
              {select("roleFamily", "Role family", roles)}
              {select("source", "Found on", [
                "LinkedIn",
                "Wellfound",
                "Company portal",
                "Referral",
                "Other",
              ])}
              {input("jobUrl", "Job URL", "url", true)}
              {input("location", "Location")}
              {select("workMode", "Work arrangement", [
                "Remote",
                "Hybrid",
                "On-site",
                "Unknown",
              ])}
              {input(
                "compensationLpa",
                "Annual compensation (₹ LPA)",
                "number",
              )}
              {select("status", "Application stage", statuses)}
            </div>
            <h3>Progress & next steps</h3>
            <div className="form-grid">
              {input("dateSaved", "Date saved", "date")}
              {input("dateApplied", "Date submitted", "date")}
              {select(
                "resumeVersion",
                ["Saved", "Preparing"].includes(data.status)
                  ? "Resume to use"
                  : "Resume used",
                ["", ...state.profile.resumeVersions.map((r) => r.id)],
              )}
              {input("recruiter", "Recruiter / contact")}
              {input("nextAction", "Next action", "text", true)}
              {input("dueDate", "Action due", "date")}
              {input("interviewDate", "Interview date", "date")}
              {input("responseDate", "Response date", "date")}
              {input("outcome", "Outcome / reason")}
            </div>
            <div className="form-grid">
              <Field label="Job description" wide>
                <textarea
                  rows={7}
                  value={data.jobDescription}
                  onChange={(e) =>
                    setData({ ...data, jobDescription: e.target.value })
                  }
                />
              </Field>
              <Field label="Notes" wide>
                <textarea
                  rows={3}
                  value={data.notes}
                  onChange={(e) => setData({ ...data, notes: e.target.value })}
                />
              </Field>
            </div>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {error.toLowerCase().includes("duplicate") && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={duplicate}
                  onChange={(e) => setDuplicate(e.target.checked)}
                />
                This is a separate application. Save it anyway.
              </label>
            )}
          </div>
          <div className="drawer-footer">
            <span>Saved to your workspace. Sync to update Sheets.</span>
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={saving}>
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              Save application
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Prepare({
  state,
  selected,
  onSelect,
  request,
  refresh,
  download,
  report,
  notify,
  add,
}: {
  state: State;
  selected: string;
  onSelect: (id: string) => void;
  request: (path: string, body?: any, method?: string) => Promise<any>;
  refresh: () => Promise<any>;
  download: (path: string, name: string) => Promise<void>;
  report: (s: string) => void;
  notify: (s: string) => void;
  add: () => void;
}) {
  const initial =
    state.applications.find((a) => a.applicationId === selected) ||
    state.applications[0];
  const [id, setId] = useState(initial?.applicationId || ""),
    [jd, setJd] = useState(initial?.jobDescription || ""),
    [questions, setQuestions] = useState<
      { question: string; maxCharacters: number | null }[]
    >([
      { question: "Why are you a good fit for this role?", maxCharacters: 500 },
    ]),
    [pack, setPack] = useState<Pack | null>(
      state.packs.find((p) => p.applicationId === initial?.applicationId) ||
        null,
    ),
    [working, setWorking] = useState(""),
    [dirty, setDirty] = useState(false),
    [localError, setLocalError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const application = state.applications.find((a) => a.applicationId === id);
  const emptyPack = (): Pack => ({
    schemaVersion: 1,
    applicationId: id,
    profileVersion: state.profile.profileVersion,
    resumeVersionId:
      application?.resumeVersion || state.profile.resumeVersions[0]?.id || "",
    answers: questions
      .filter((q) => q.question.trim())
      .map((q) => ({ ...q, answer: "", factIds: [], approved: false })),
  });
  const changePack = (p: Pack) => {
    setPack(p);
    setDirty(true);
  };
  async function savePack() {
    if (!pack) return;
    setWorking("save");
    setLocalError("");
    try {
      const result = await request("/packs", { pack });
      setPack(result.pack);
      setDirty(false);
      await refresh();
      notify("Answer pack saved.");
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setWorking("");
    }
  }
  const generationAttempt = useRef<{signature:string;requestId:string}|null>(null);
  async function generate() {
    setWorking("generate");
    setLocalError("");
    try {
      const signature=JSON.stringify({applicationId:id,jobDescription:jd,questions,profileVersion:state.profile.profileVersion,preferences:state.preferences});
      if(generationAttempt.current?.signature!==signature){
        await request("/applications/" + encodeURIComponent(id),{jobDescription:jd,status:application?.status === "Saved" ? "Preparing" : application?.status},"PATCH");
        generationAttempt.current={signature,requestId:crypto.randomUUID()};
      }
      const { jobId } = await request("/generate", {
        requestId:generationAttempt.current.requestId,
        applicationId: id,
        jobDescription: jd,
        questions: questions.filter((q) => q.question.trim()),
      });
      while (alive.current) {
        await new Promise((r) => setTimeout(r, 2000));
        const result = await request("/generate/" + encodeURIComponent(jobId));
        if(result.status !== "running")generationAttempt.current=null;
        if (!alive.current) return;
        if (result.status === "failed")
          throw new Error(result.error || "Preparation failed.");
        if (result.status === "complete") {
          setPack(result.pack);
          setDirty(false);
          await refresh();
          notify(
            "Draft ready. Review each answer and its evidence before approving.",
          );
          break;
        }
      }
    } catch (e) {
      if (alive.current) setLocalError((e as Error).message);
    } finally {
      if (alive.current) setWorking("");
    }
  }
  async function importPack(file: File) {
    setLocalError("");
    try {
      const value = JSON.parse(await file.text());
      const p = value.pack || value;
      if (p.applicationId !== id)
        throw new Error(
          "This answer pack belongs to a different application. Select that application first.",
        );
      if (!Array.isArray(p.answers))
        throw new Error("Choose an answer pack JSON file.");
      setPack({
        ...p,
        answers: p.answers.map((a: Answer) => ({ ...a, approved: false })),
      });
      setDirty(true);
      notify("Imported as a draft. Review and approve answers before export.");
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  const setAnswer = (
    index: number,
    patch: Partial<Answer>,
    approval = false,
  ) => {
    if (!pack) return;
    changePack({
      ...pack,
      answers: pack.answers.map((a, i) =>
        i === index
          ? { ...a, ...patch, ...(!approval ? { approved: false } : {}) }
          : a,
      ),
    });
  };
  if (!state.applications.length)
    return (
      <>
        <Heading
          eyebrow="APPLICATION ASSISTANT"
          title="Let your experience speak."
          description="Grounded answers, thoughtful resume choices, and a clear review before you apply."
        />
        <section className="panel">
          <Empty
            icon={Sparkles}
            title="Start with an opportunity"
            action={
              <button className="primary" onClick={add}>
                <Plus size={16} />
                Add an application
              </button>
            }
          >
            Save the company and role first. Then paste its job description to
            prepare your application.
          </Empty>
        </section>
      </>
    );
  const stale = !!pack && pack.profileVersion !== state.profile.profileVersion;
  return (
    <>
      <Heading
        eyebrow="APPLICATION ASSISTANT"
        title="Prepare with purpose."
        description="Match your experience to the role. Review the evidence. Make it yours."
      />
      <div className="prepare-selector">
        <BriefcaseBusiness size={20} />
        <select
          aria-label="Application to prepare"
          value={id}
          disabled={!!working}
          onChange={(e) => {
            if (
              dirty &&
              !confirm(
                "You have unsaved answer edits. Switch applications and discard them?",
              )
            )
              return;
            const a = state.applications.find(
              (a) => a.applicationId === e.target.value,
            )!;
            onSelect(a.applicationId);
            setId(a.applicationId);
            setJd(a.jobDescription);
            setPack(
              state.packs.find((p) => p.applicationId === a.applicationId) ||
                null,
            );
            setDirty(false);
            setLocalError("");
          }}
        >
          {state.applications.map((a) => (
            <option key={a.applicationId} value={a.applicationId}>
              {a.company} · {a.title}
            </option>
          ))}
        </select>
        {application && (
          <Badge kind={application.status}>{application.status}</Badge>
        )}
        {application?.jobUrl && (
          <a
            className="text-button"
            href={application.jobUrl}
            target="_blank"
            rel="noreferrer"
          >
            View role <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      {localError && (
        <div className="alert error" role="alert">
          <AlertCircle size={17} />
          {localError}
        </div>
      )}
      <div className="prepare-grid">
        <section className="panel prepare-input">
          <div className="panel-heading">
            <div>
              <div className="step-label">01 / THE ROLE</div>
              <h2>Start with the details</h2>
            </div>
            <FileText size={20} />
          </div>
          <div className="panel-body">
            <Field label="Job description">
              <textarea
                rows={12}
                value={jd}
                disabled={!!working}
                onChange={(e) => setJd(e.target.value)}
                placeholder="Paste the full description, responsibilities, and requirements…"
              />
            </Field>
            <div className="section-title">
              <h3>Application questions</h3>
              <button
                className="text-button"
                disabled={!!working}
                onClick={() =>
                  setQuestions([
                    ...questions,
                    { question: "", maxCharacters: null },
                  ])
                }
              >
                <Plus size={15} />
                Add
              </button>
            </div>
            {questions.map((q, i) => (
              <div className="question-input" key={i}>
                <label className="sr-only" htmlFor={"question-" + i}>
                  Question {i + 1}
                </label>
                <textarea
                  id={"question-" + i}
                  rows={2}
                  value={q.question}
                  disabled={!!working}
                  onChange={(e) =>
                    setQuestions(
                      questions.map((x, n) =>
                        n === i ? { ...x, question: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Paste a question from the application"
                />
                <div>
                  <label>
                    Character limit{" "}
                    <input
                      type="number"
                      min="1"
                      placeholder="None"
                      disabled={!!working}
                      value={q.maxCharacters ?? ""}
                      onChange={(e) =>
                        setQuestions(
                          questions.map((x, n) =>
                            n === i
                              ? {
                                  ...x,
                                  maxCharacters: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="icon-button"
                    disabled={questions.length < 2 || !!working}
                    aria-label={`Remove question ${i + 1}`}
                    onClick={() =>
                      setQuestions(questions.filter((_, n) => n !== i))
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
            <button
              className="primary full"
              disabled={
                !!working || !jd.trim() || !state.connection.aiAvailable
              }
              onClick={() => {
                if (
                  dirty &&
                  !confirm(
                    "Generate a new draft and replace your unsaved answer edits?",
                  )
                )
                  return;
                generate();
              }}
            >
              {working === "generate" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}{" "}
              {working === "generate"
                ? "Preparing your application…"
                : "Generate answer draft"}
            </button>
            <p className="helper">
              {state.connection.aiAvailable
                ? "Uses your verified profile. Every answer starts unapproved."
                : "Answer generation is unavailable. You can still write or import an answer pack below. Check Settings for setup."}
            </p>
            <div className="button-row">
              <button
                className="secondary"
                disabled={!!working}
                onClick={() => {
                  if (
                    dirty &&
                    !confirm("Replace unsaved edits with a blank draft?")
                  )
                    return;
                  changePack(emptyPack());
                }}
              >
                Write manually
              </button>
              <label className="button secondary">
                <Upload size={15} />
                Import pack
                <input
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  disabled={!!working}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importPack(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        </section>
        <section className="answers-column">
          {!pack ? (
            <div className="panel answer-empty">
              <Empty
                icon={Sparkles}
                title={
                  working === "generate"
                    ? "Finding your strongest evidence…"
                    : "A stronger application starts here"
                }
              >
                Your resume recommendation, matching experience, and draft
                answers will appear here. You decide what is approved.
              </Empty>
            </div>
          ) : (
            <>
              {stale && (
                <div className="alert warning">
                  <AlertCircle size={18} />
                  <div>
                    <strong>Your profile has changed.</strong>
                    <p>
                      Review this draft against your current facts before
                      approving again.
                    </p>
                    <button
                      className="text-button"
                      onClick={() =>
                        changePack({
                          ...pack,
                          profileVersion: state.profile.profileVersion,
                          answers: pack.answers.map((a) => ({
                            ...a,
                            approved: false,
                          })),
                        })
                      }
                    >
                      Use current profile & reset approvals{" "}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              )}
              {pack.analysis && (
                <div className="panel analysis-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="step-label">02 / YOUR MATCH</div>
                      <h2>Lead with your experience</h2>
                    </div>
                    <Badge kind="preparing">
                      {pack.analysis.fit || "Review fit"}
                    </Badge>
                  </div>
                  <div className="panel-body">
                    <p>{pack.analysis.summary}</p>
                    <div className="fit-checks">
                      {pack.analysis.workModeCheck && (
                        <span>
                          <Check size={14} />
                          {pack.analysis.workModeCheck}
                        </span>
                      )}
                      {pack.analysis.compensationCheck && (
                        <span>
                          <Check size={14} />
                          {pack.analysis.compensationCheck}
                        </span>
                      )}
                    </div>
                    {pack.analysis.proofPoints?.map((p, i) => (
                      <div className="proof-point" key={i}>
                        <ShieldCheck size={17} />
                        <div>
                          {p.text}
                          <small>{p.factIds.join(" · ")}</small>
                        </div>
                      </div>
                    ))}
                    {!!pack.analysis.unknowns?.length && (
                      <div className="unknowns">
                        <strong>Needs your input</strong>
                        <ul>
                          {pack.analysis.unknowns.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="panel resume-choice">
                <FileText size={23} />
                <div>
                  <span className="small-label">RECOMMENDED RESUME</span>
                  <select
                    aria-label="Resume for answer pack"
                    value={pack.resumeVersionId}
                    onChange={(e) =>
                      changePack({ ...pack, resumeVersionId: e.target.value })
                    }
                  >
                    {state.profile.resumeVersions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}
                      </option>
                    ))}
                  </select>
                  {pack.analysis?.resumeReason && (
                    <p>{pack.analysis.resumeReason}</p>
                  )}
                </div>
                <button
                  className="icon-button"
                  aria-label="Download recommended resume"
                  onClick={() =>
                    download(
                      "/resumes/" + encodeURIComponent(pack.resumeVersionId),
                      pack.resumeVersionId + ".pdf",
                    )
                  }
                >
                  <Download size={19} />
                </button>
              </div>
              <div className="answers-heading">
                <div>
                  <div className="step-label">03 / REVIEW & APPROVE</div>
                  <h2>
                    Your answers{" "}
                    <Badge>
                      {pack.answers.filter((a) => a.approved).length}/
                      {pack.answers.length} approved
                    </Badge>
                  </h2>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    changePack({
                      ...pack,
                      answers: [
                        ...pack.answers,
                        {
                          question: "",
                          answer: "",
                          factIds: [],
                          approved: false,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  Add answer
                </button>
              </div>
              {pack.answers.map((answer, index) => {
                const over =
                  !!answer.maxCharacters &&
                  answer.answer.length > answer.maxCharacters;
                const validEvidence =
                  answer.factIds.length > 0 &&
                  answer.factIds.every((id) =>
                    state.profile.facts.some((f) => f.id === id),
                  );
                return (
                  <div
                    className={
                      "panel answer-card " + (answer.approved ? "approved" : "")
                    }
                    key={index}
                  >
                    <div className="answer-top">
                      <span className="answer-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <input
                        aria-label={`Answer ${index + 1} question`}
                        value={answer.question}
                        onChange={(e) =>
                          setAnswer(index, { question: e.target.value })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={"Remove answer " + (index + 1)}
                        onClick={() =>
                          changePack({
                            ...pack,
                            answers: pack.answers.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <textarea
                      aria-label={`Answer ${index + 1} text`}
                      rows={Math.max(
                        4,
                        Math.min(10, Math.ceil(answer.answer.length / 90)),
                      )}
                      value={answer.answer}
                      placeholder="Write a truthful answer supported by your profile facts…"
                      onChange={(e) =>
                        setAnswer(index, { answer: e.target.value })
                      }
                    />
                    <div className="answer-meta">
                      <label>
                        Limit{" "}
                        <input
                          aria-label={`Character limit for answer ${index + 1}`}
                          type="number"
                          min="1"
                          placeholder="None"
                          value={answer.maxCharacters ?? ""}
                          onChange={(e) =>
                            setAnswer(index, {
                              maxCharacters: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                      </label>
                      <span className={over ? "overdue" : ""}>
                        {answer.answer.length}
                        {answer.maxCharacters
                          ? ` / ${answer.maxCharacters}`
                          : ""}{" "}
                        characters
                      </span>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(answer.answer);
                            notify("Answer copied.");
                          } catch {
                            report(
                              "Could not access your clipboard. Select and copy the answer manually.",
                            );
                          }
                        }}
                      >
                        <Copy size={14} />
                        Copy
                      </button>
                    </div>
                    <details className="evidence">
                      <summary>
                        <ShieldCheck size={15} />
                        {answer.factIds.length} supporting facts{" "}
                        <span>Review evidence</span>
                      </summary>
                      <div className="evidence-options">
                        {state.profile.facts.map((f) => (
                          <label className="evidence-fact" key={f.id}>
                            <input
                              type="checkbox"
                              checked={answer.factIds.includes(f.id)}
                              onChange={(e) =>
                                setAnswer(index, {
                                  factIds: e.target.checked
                                    ? [...answer.factIds, f.id]
                                    : answer.factIds.filter(
                                        (id) => id !== f.id,
                                      ),
                                })
                              }
                            />
                            <span>
                              <b>{f.id}</b> {f.claim}
                              <small>{f.source}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                    <label className="approval">
                      <input
                        type="checkbox"
                        checked={answer.approved}
                        disabled={
                          stale ||
                          over ||
                          !validEvidence ||
                          !answer.answer.trim() ||
                          !answer.question.trim()
                        }
                        onChange={(e) =>
                          setAnswer(index, { approved: e.target.checked }, true)
                        }
                      />
                      <span>
                        I reviewed this answer and its supporting facts.
                      </span>
                      {answer.approved && <CheckCheck size={17} />}
                    </label>
                    {!validEvidence && (
                      <p className="helper">
                        Select supporting facts before approving this answer.
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="pack-actions">
                <div>
                  <strong>
                    {dirty ? "Unsaved changes" : "Answer pack saved"}
                  </strong>
                  <span>Export uses your saved, validated pack.</span>
                </div>
                <button
                  className="primary"
                  disabled={!!working}
                  onClick={savePack}
                >
                  {working === "save" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  Save pack
                </button>
                <button
                  className="secondary"
                  disabled={dirty || stale || !!working}
                  onClick={() =>
                    download(
                      "/packs/" + encodeURIComponent(id) + "/export",
                      id + "-answers.json",
                    )
                  }
                >
                  <Download size={16} />
                  Answers
                </button>
                <button
                  className="secondary"
                  disabled={dirty || stale || !!working}
                  onClick={() =>
                    download(
                      "/extension/export/" + encodeURIComponent(id),
                      id + "-helper.json",
                    )
                  }
                >
                  <Download size={16} />
                  Chrome bundle
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function ProfileView({
  state,
  run,
  request,
  busy,
  download,
}: {
  state: State;
  run: (
    name: string,
    fn: () => Promise<any>,
    message?: string,
  ) => Promise<void>;
  request: (path: string, body?: any, method?: string) => Promise<any>;
  busy: string;
  download: (path: string, name: string) => Promise<void>;
}) {
  const [profile, setProfile] = useState<Profile>(
      structuredClone(state.profile),
    ),
    [verified, setVerified] = useState<string[]>([]),
    [editing, setEditing] = useState(false),
    [personalReviewed, setPersonalReviewed] = useState(false),
    [answersReviewed, setAnswersReviewed] = useState(false);
  const [resumeId,setResumeId] = useState("");
  const [resumeFile,setResumeFile] = useState<File|null>(null);
  const changedFacts = profile.facts.filter(
    (f) =>
      JSON.stringify(f) !==
      JSON.stringify(state.profile.facts.find((x) => x.id === f.id)),
  );
  const contactChanged =
    JSON.stringify(profile.personal) !== JSON.stringify(state.profile.personal);
  const answersChanged =
    JSON.stringify(profile.standardAnswers) !==
    JSON.stringify(state.profile.standardAnswers);
  const canSave =
    changedFacts.every((f) => verified.includes(f.id)) &&
    (!contactChanged || personalReviewed) &&
    (!answersChanged || answersReviewed);
  return (
    <>
      <Heading
        eyebrow="YOUR FOUNDATION"
        title="Experience you can stand behind."
        description="Your verified career facts power every answer. Profile changes stay in this workspace until explicitly shared with Sheets."
        action={
          <button
            className="secondary"
            onClick={() =>
              download("/profile/export", "applyweave-profile.json")
            }
          >
            <Download size={16} />
            Export profile
          </button>
        }
      />
      <div className="profile-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Personal details</h2>
              <p>Used for application answers and form filling.</p>
            </div>
            <button
              className="text-button"
              onClick={() => {
                if (editing) {
                  setProfile(structuredClone(state.profile));
                  setVerified([]);
                  setPersonalReviewed(false);
                  setAnswersReviewed(false);
                }
                setEditing(!editing);
              }}
            >
              {editing ? "Cancel edits" : "Edit profile"}
            </button>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              {Object.entries(profile.personal).map(([key, value]) => (
                <Field
                  label={key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (s) => s.toUpperCase())}
                  key={key}
                >
                  <input
                    readOnly={!editing}
                    value={value}
                    onChange={(e) => {
                      setProfile({
                        ...profile,
                        personal: {
                          ...profile.personal,
                          [key]: e.target.value,
                        },
                      });
                      setPersonalReviewed(false);
                    }}
                  />
                </Field>
              ))}
            </div>
            {editing && contactChanged && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={personalReviewed}
                  onChange={(e) => setPersonalReviewed(e.target.checked)}
                />
                I verified these contact and availability details.
              </label>
            )}
            <div className="version-label">
              <Badge
                kind={state.profileSyncStatus === "synced" ? "offer" : "saved"}
              >
                {state.profileSyncStatus === "synced"
                  ? "Matches Sheet"
                  : state.profileSyncStatus === "conflict"
                    ? "Review sync conflict"
                    : "Workspace profile"}
              </Badge>
              <ShieldCheck size={15} />
              Profile version <code>{state.profile.profileVersion}</code>
            </div>
          </div>
        </section>
        <section className="panel resume-catalogue">
          <div className="panel-heading">
            <div>
              <h2>Your resume library</h2>
              <p>Choose the strongest starting point for each role.</p>
            </div>
            <FileText size={20} />
          </div>
          <div className="panel-body">
            <Field label="New resume version ID"><input value={resumeId} onChange={e=>setResumeId(e.target.value)} placeholder="e.g. FRONTEND_V2" /></Field>
            <Field label="Reviewed resume PDF (up to 3 MB)"><input type="file" accept="application/pdf,.pdf" onChange={e=>setResumeFile(e.target.files?.[0] || null)} /></Field>
            <p className="helper">Use a new ID and filename. Adding a version updates your profile; review older answer packs again.</p>
            <button className="secondary" disabled={!!busy || !resumeFile || !resumeId.trim() || editing} onClick={()=>run("resume-upload",async()=>{
              if(!resumeFile || resumeFile.size>3*1024*1024)throw new Error("Choose a PDF up to 3 MB.");
              const dataBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Could not read PDF."));reader.readAsDataURL(resumeFile);});
              const result=await request("/resumes",{id:resumeId,filename:resumeFile.name,dataBase64});
              setProfile(result.profile);setResumeId("");setResumeFile(null);
            },"Resume uploaded to your private library.")}><Upload size={16}/>Upload resume</button>
          </div>
          {profile.resumeVersions.map((r) => (
            <div className="resume-row" key={r.id}>
              <span className="pdf-icon">
                <FileText size={19} />
              </span>
              <div>
                <strong>{r.id}</strong>
                <small>{r.filename}</small>
              </div>
              <button
                className="icon-button"
                aria-label={"Download " + r.id + " resume"}
                onClick={() =>
                  download("/resumes/" + encodeURIComponent(r.id), r.filename)
                }
              >
                <Download size={17} />
              </button>
            </div>
          ))}
        </section>
      </div>
      <section className="panel facts-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Verified fact bank <Badge>{profile.facts.length}</Badge>
            </h2>
            <p>
              Changes require your explicit review and make older answer packs
              due for review.
            </p>
          </div>
          {editing && (
            <button
              className="secondary"
              onClick={() => {
                let n = profile.facts.length + 1;
                while (
                  profile.facts.some(
                    (f) => f.id === "F" + String(n).padStart(3, "0"),
                  )
                )
                  n++;
                setProfile({
                  ...profile,
                  facts: [
                    ...profile.facts,
                    {
                      id: "F" + String(n).padStart(3, "0"),
                      claim: "",
                      source: "",
                    },
                  ],
                });
              }}
            >
              <Plus size={16} />
              Add fact
            </button>
          )}
        </div>
        {profile.facts.map((f, index) => (
          <div className="fact-row" key={f.id}>
            <span className="fact-id">{f.id}</span>
            <div>
              {editing ? (
                <>
                  <Field label="Claim">
                    <textarea
                      rows={2}
                      value={f.claim}
                      onChange={(e) => {
                        setProfile({
                          ...profile,
                          facts: profile.facts.map((x, i) =>
                            i === index ? { ...x, claim: e.target.value } : x,
                          ),
                        });
                        setVerified(verified.filter((id) => id !== f.id));
                      }}
                    />
                  </Field>
                  <Field label="Source / evidence">
                    <input
                      value={f.source}
                      onChange={(e) => {
                        setProfile({
                          ...profile,
                          facts: profile.facts.map((x, i) =>
                            i === index ? { ...x, source: e.target.value } : x,
                          ),
                        });
                        setVerified(verified.filter((id) => id !== f.id));
                      }}
                    />
                  </Field>
                  {changedFacts.some((x) => x.id === f.id) && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={verified.includes(f.id)}
                        disabled={!f.claim.trim() || !f.source.trim()}
                        onChange={(e) =>
                          setVerified(
                            e.target.checked
                              ? [...verified, f.id]
                              : verified.filter((id) => id !== f.id),
                          )
                        }
                      />
                      I verified this claim and approve it for applications.
                    </label>
                  )}
                </>
              ) : (
                <>
                  <p>{f.claim}</p>
                  <small>{f.source}</small>
                </>
              )}
            </div>
            {!editing && <ShieldCheck size={18} />}
          </div>
        ))}
        <div className="panel-heading">
          <div>
            <h2>
              Reusable answers <Badge>{profile.standardAnswers.length}</Badge>
            </h2>
            <p>
              Approved wording for recurring questions, with supporting facts.
            </p>
          </div>
          {editing && (
            <button
              className="secondary"
              onClick={() => {
                setProfile({
                  ...profile,
                  standardAnswers: [
                    ...profile.standardAnswers,
                    { key: "", text: "", factIds: [] },
                  ],
                });
                setAnswersReviewed(false);
              }}
            >
              <Plus size={16} />
              Add answer
            </button>
          )}
        </div>
        {!profile.standardAnswers.length && (
          <div className="panel-body">
            <p className="helper">
              No reusable answers yet. Use Edit profile to add verified wording
              for a recurring question.
            </p>
          </div>
        )}
        {profile.standardAnswers.map((a, i) => (
          <div className="fact-row" key={i}>
            <span className="fact-id">{String(i + 1).padStart(2, "0")}</span>
            <div>
              {editing ? (
                <>
                  <Field label="Question / answer key">
                    <input
                      value={a.key}
                      onChange={(e) => {
                        setProfile({
                          ...profile,
                          standardAnswers: profile.standardAnswers.map(
                            (x, n) =>
                              n === i ? { ...x, key: e.target.value } : x,
                          ),
                        });
                        setAnswersReviewed(false);
                      }}
                    />
                  </Field>
                  <Field label="Approved answer wording">
                    <textarea
                      rows={3}
                      value={a.text}
                      onChange={(e) => {
                        setProfile({
                          ...profile,
                          standardAnswers: profile.standardAnswers.map(
                            (x, n) =>
                              n === i ? { ...x, text: e.target.value } : x,
                          ),
                        });
                        setAnswersReviewed(false);
                      }}
                    />
                  </Field>
                  <details className="evidence">
                    <summary>
                      <ShieldCheck size={15} />
                      {a.factIds.length} supporting facts
                    </summary>
                    {profile.facts.map((f) => (
                      <label className="evidence-fact" key={f.id}>
                        <input
                          type="checkbox"
                          checked={a.factIds.includes(f.id)}
                          onChange={(e) => {
                            setProfile({
                              ...profile,
                              standardAnswers: profile.standardAnswers.map(
                                (x, n) =>
                                  n === i
                                    ? {
                                        ...x,
                                        factIds: e.target.checked
                                          ? [...x.factIds, f.id]
                                          : x.factIds.filter(
                                              (id) => id !== f.id,
                                            ),
                                      }
                                    : x,
                              ),
                            });
                            setAnswersReviewed(false);
                          }}
                        />
                        <span>
                          <b>{f.id}</b> {f.claim}
                        </span>
                      </label>
                    ))}
                  </details>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      setProfile({
                        ...profile,
                        standardAnswers: profile.standardAnswers.filter(
                          (_, n) => n !== i,
                        ),
                      });
                      setAnswersReviewed(false);
                    }}
                  >
                    Remove answer
                  </button>
                </>
              ) : (
                <>
                  <h3>{a.key}</h3>
                  <p>{a.text}</p>
                  <small>{a.factIds.join(" · ")}</small>
                </>
              )}
            </div>
          </div>
        ))}
        {editing && answersChanged && (
          <div className="panel-body">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={answersReviewed}
                disabled={profile.standardAnswers.some(
                  (a) => !a.key.trim() || !a.text.trim() || !a.factIds.length,
                )}
                onChange={(e) => setAnswersReviewed(e.target.checked)}
              />
              I reviewed the reusable answers and their supporting facts, and
              approve this wording for applications.
            </label>
          </div>
        )}
        {editing && (
          <div className="profile-save">
            <p>
              Each changed fact must be reviewed before it becomes part of your
              approved profile.
            </p>
            <button
              className="primary"
              disabled={!!busy || !canSave}
              onClick={() =>
                run(
                  "profile",
                  async () => {
                    const result = await request("/profile", { profile });
                    setProfile(result.profile);
                    setEditing(false);
                    setVerified([]);
                    setPersonalReviewed(false);
                    setAnswersReviewed(false);
                  },
                  "Profile updated. Review older answer packs before exporting.",
                )
              }
            >
              <Check size={16} />
              Save verified profile
            </button>
          </div>
        )}
      </section>
    </>
  );
}
function SettingsView({
  state,
  run,
  request,
  busy,
  download,
  sync,
}: {
  state: State;
  run: (
    name: string,
    fn: () => Promise<any>,
    message?: string,
  ) => Promise<void>;
  request: (path: string, body?: any, method?: string) => Promise<any>;
  busy: string;
  download: (path: string, name: string) => Promise<void>;
  sync: () => void;
}) {
  const [client, setClient] = useState<any>(null),
    [clientName, setClientName] = useState(""),
    [sheet, setSheet] = useState(
      state.connection.spreadsheetId ||
        String(state.preferences.spreadsheetId || ""),
    ),
    [prefs, setPrefs] = useState(structuredClone(state.preferences)),
    [restore, setRestore] = useState<any>(null),
    [restoreName, setRestoreName] = useState(""),
    [restoreConfirmed, setRestoreConfirmed] = useState(false),
    [fileError, setFileError] = useState("");
  async function readFile(file: File, kind: "client" | "backup") {
    setFileError("");
    try {
      const j = JSON.parse(await file.text());
      if (kind === "client") {
        setClient(j);
        setClientName(file.name);
      } else {
        setRestore(j);
        setRestoreName(file.name);
        setRestoreConfirmed(false);
      }
    } catch {
      setFileError(
        "This file is not valid JSON. Choose the original exported file.",
      );
    }
  }
  return (
    <>
      <Heading
        eyebrow="WORKSPACE SETTINGS"
        title="Set yourself up for a good search."
        description="Connect your tracker, choose your preferences, and keep a backup of your work."
      />
      {fileError && (
        <div className="alert error" role="alert">
          {fileError}
        </div>
      )}
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Google Sheets</h2>
              <p>Your shared application record.</p>
            </div>
            <Badge kind={state.connection.googleConnected ? "offer" : "saved"}>
              {state.connection.googleConnected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <div className="panel-body">
            {state.connection.googleConnected ? (
              <>
                <div className="connected-account">
                  <span className="google-icon">G</span>
                  <div>
                    <strong>
                      {state.connection.googleEmail ||
                        "Google account connected"}
                    </strong>
                    <p>Applications sync when you choose Sync.</p>
                  </div>
                </div>
                <div className="button-row">
                  <button className="primary" disabled={!!busy} onClick={sync}>
                    <RefreshCw
                      size={16}
                      className={busy === "sync" ? "spin" : ""}
                    />
                    Sync now
                  </button>
                  <a
                    className="button secondary"
                    href={
                      "https://docs.google.com/spreadsheets/d/" +
                      encodeURIComponent(state.connection.spreadsheetId) +
                      "/edit"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Sheet <ArrowUpRight size={16} />
                  </a>
                  <button
                    className="text-button danger"
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        "disconnect",
                        () => request("/auth/google/disconnect", {}),
                        "Google account disconnected. Your saved applications are still available.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Connect ApplyWeave directly to your Google account to sync
                  this workspace with your Sheet.
                </p>
                <div className="note">
                  Your ChatGPT Google Drive connection works inside ChatGPT.
                  ApplyWeave needs its own Google authorization.
                </div>
                {state.hostingMode !== "hosted" && <><details
                  className="setup-details"
                  open={!state.connection.googleConfigured}
                >
                  <summary>Set up Google access</summary>
                  <ol>
                    <li>
                      In{" "}
                      <a
                        href="https://console.cloud.google.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Google Cloud Console <ArrowUpRight size={12} />
                      </a>
                      , select or create a project and enable the Google Sheets
                      API.
                    </li>
                    <li>
                      Configure the OAuth consent screen. If the app is in
                      testing, add your Google account as a test user.
                    </li>
                    <li>
                      Create an OAuth client with application type{" "}
                      <strong>Desktop app</strong>, then download its JSON file.
                    </li>
                    <li>
                      Choose that file below, save the connection, and select
                      Connect Google.
                    </li>
                  </ol>
                </details>
                <Field label="Google OAuth client file">
                  <label className="upload-zone">
                    <Upload size={20} />
                    <span>
                      {clientName || "Choose the Desktop app JSON file"}
                    </span>
                    <input
                      className="sr-only"
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) readFile(f, "client");
                        e.target.value = "";
                      }}
                    />
                  </label>
                </Field>
                <Field label="Spreadsheet ID or Google Sheets link">
                  <input
                    value={sheet}
                    onChange={(e) => setSheet(e.target.value)}
                    placeholder="Paste your tracker link or spreadsheet ID"
                  />
                </Field>
                </>}
                <div className="button-row">
                  {state.hostingMode !== "hosted" && <button
                    className="secondary"
                    disabled={!client || !sheet.trim() || !!busy}
                    onClick={() =>
                      run(
                        "configure",
                        () =>
                          request("/auth/google/config", {
                            client,
                            spreadsheetId:
                              sheet.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] ||
                              sheet.trim(),
                          }),
                        "Google configuration saved. Connect your account next.",
                      )
                    }
                  >
                    <Check size={16} />
                    Save configuration
                  </button>}
                  <button
                    className="primary"
                    disabled={!state.connection.googleConfigured || !!busy}
                    onClick={() =>
                      run("connect", async () => {
                        const r = await request("/auth/google/start", {});
                        window.location.assign(r.url);
                      })
                    }
                  >
                    <Link2 size={16} />
                    Connect Google
                  </button>
                </div>
              </>
            )}
            <p className="helper">
              Applications sync with Google Sheets. Full answer packs and search
              preferences stay in your private workspace.
            </p>
            <p className="helper">
              {state.lastSyncedAt
                ? "Last synced " +
                  new Date(state.lastSyncedAt).toLocaleString("en-IN")
                : "No sync yet. Your changes are saved in your private workspace."}
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Search preferences</h2>
              <p>A guide for matching roles to your goals.</p>
            </div>
            <BriefcaseBusiness size={19} />
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <Field label="Minimum annual compensation (₹ LPA)">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={prefs.minimumCompensationLpa ?? 12}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      minimumCompensationLpa: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Planned availability">
                <input
                  type="date"
                  value={prefs.plannedAvailabilityDate || ""}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      plannedAvailabilityDate: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Search begins">
                <input
                  type="date"
                  value={prefs.searchStartDate || ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, searchStartDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Search through">
                <input
                  type="date"
                  value={prefs.searchEndDate || ""}
                  onChange={(e) =>
                    setPrefs({ ...prefs, searchEndDate: e.target.value })
                  }
                />
              </Field>
            </div>
            <fieldset>
              <legend>Work arrangements</legend>
              <div className="choice-row">
                {["Remote", "Hybrid", "On-site"].map((s) => (
                  <label className="checkbox" key={s}>
                    <input
                      type="checkbox"
                      checked={prefs.workModes?.includes(s) || false}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          workModes: e.target.checked
                            ? [...(prefs.workModes || []), s]
                            : prefs.workModes.filter((x: string) => x !== s),
                        })
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Target roles</legend>
              {roles.map((s) => (
                <label className="checkbox" key={s}>
                  <input
                    type="checkbox"
                    checked={prefs.targetRoleFamilies?.includes(s) || false}
                    onChange={(e) =>
                      setPrefs({
                        ...prefs,
                        targetRoleFamilies: e.target.checked
                          ? [...(prefs.targetRoleFamilies || []), s]
                          : prefs.targetRoleFamilies.filter(
                              (x: string) => x !== s,
                            ),
                      })
                    }
                  />
                  {s}
                </label>
              ))}
            </fieldset>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                run(
                  "preferences",
                  () => request("/preferences", prefs),
                  "Search preferences saved.",
                )
              }
            >
              <Check size={16} />
              Save preferences
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Application assistant</h2>
              <p>Draft answers using your verified profile.</p>
            </div>
            <Sparkles size={20} />
          </div>
          <div className="panel-body">
            <div className="status-line">
              <span
                className={
                  "connection-dot " +
                  (state.connection.aiAvailable ? "connected" : "")
                }
              />
              <strong>
                {state.connection.aiAvailable
                  ? `${state.connection.aiProvider === "codex" ? "Codex" : "AI assistant"} is configured`
                  : "Answer generation is not configured"}
              </strong>
            </div>
            <p>
              {state.connection.aiAvailable
                ? `Drafting uses ${state.connection.aiProvider || "your configured provider"}${state.connection.aiModel ? " · " + state.connection.aiModel : ""}. Review every answer before using it.`
                : state.hostingMode === "hosted" ? "The owner needs to configure a hosted AI provider. You can write and import answer packs while setup is completed." : "Install Codex CLI and sign in on this computer, then restart ApplyWeave. You can write and import answer packs while setting it up."}
            </p>
            <p className="helper">
              Only the selected job description, questions, and approved profile
              are used to prepare an answer pack.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Backup & restore</h2>
              <p>Keep a portable copy of your workspace.</p>
            </div>
            <Download size={20} />
          </div>
          <div className="panel-body">
            <p>
              Backups include your applications, profile, preferences, and
              answer packs. PDFs and Google credentials are excluded. Download your resume PDFs separately from Profile &amp; resumes and keep both backups private.
            </p>
            <button
              className="secondary"
              onClick={() =>
                download(
                  "/backups/export",
                  "applyweave-backup-" + today() + ".json",
                )
              }
            >
              <Download size={16} />
              Download backup
            </button>
            <div className="divider" />
            <label className="button secondary">
              <Upload size={16} />
              Choose backup
              <input
                className="sr-only"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFile(f, "backup");
                  e.target.value = "";
                }}
              />
            </label>
            {restore && (
              <div className="restore-confirm">
                <strong>{restoreName}</strong>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={restoreConfirmed}
                    onChange={(e) => setRestoreConfirmed(e.target.checked)}
                  />
                  Replace my workspace with this backup. I have saved a
                  current copy.
                </label>
                <button
                  className="secondary danger"
                  disabled={!restoreConfirmed || !!busy}
                  onClick={() =>
                    run(
                      "restore",
                      async () => {
                        await request("/backups/import", { backup: restore });
                        setRestore(null);
                        setRestoreConfirmed(false);
                        const restored = await request("/state");
                        setPrefs(structuredClone(restored.preferences));
                      },
                      "Backup restored. Review your workspace before syncing.",
                    )
                  }
                >
                  Restore this backup
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
      {state.conflicts.length > 0 && (
        <section className="panel conflict-panel">
          <div className="panel-heading">
            <div>
              <h2>Changes that need your decision</h2>
              <p>
                The workspace record and Sheet both changed. Choose which record to
                keep.
              </p>
            </div>
            <Badge kind="conflict">{state.conflicts.length} conflicts</Badge>
          </div>
          {state.conflicts.map((c) => (
            <div className="conflict-row" key={c.applicationId}>
              <div>
                <strong>
                  {c.applicationId === "PROFILE"
                    ? "Approved profile"
                    : state.applications.find(
                        (a) => a.applicationId === c.applicationId,
                      )?.company || c.applicationId}
                </strong>
                <p>{c.message}</p>
                <small>{c.applicationId}</small>
              </div>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "conflict",
                    () =>
                      request(
                        "/conflicts/" + encodeURIComponent(c.applicationId),
                        { resolution: "local" },
                      ),
                    "Local record kept. Sync to send it to Sheets.",
                  )
                }
              >
                Keep workspace version
              </button>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "conflict",
                    () =>
                      request(
                        "/conflicts/" + encodeURIComponent(c.applicationId),
                        { resolution: "remote" },
                      ),
                    "Sheet record kept.",
                  )
                }
              >
                Use Sheet version
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Google Sheets sidebar</h2>
            <p>Add and update applications directly from your tracker.</p>
          </div>
          <Badge kind={state.connection.scriptInstalled ? "offer" : "saved"}>
            {state.connection.scriptInstalled ? "Installed" : "Optional setup"}
          </Badge>
        </div>
        <div className="panel-body">
          <p>
            ApplyWeave already handles your full application workflow.
            Install the companion sidebar to use the same controls inside Google
            Sheets.
          </p>
          {state.hostingMode !== "hosted" && !state.connection.scriptInstalled && (
            <div className="note">
              Enable the Google Apps Script API in your Google Cloud project and
              enable API access in{" "}
              <a
                href="https://script.google.com/home/usersettings"
                target="_blank"
                rel="noreferrer"
              >
                Apps Script settings
              </a>
              . Google will ask for additional permission to create and install
              your tracker script.
            </div>
          )}
          {state.hostingMode === "hosted" && <p className="note">The optional sidebar can be installed through the local companion or Google Apps Script editor. Tracking and syncing already work here.</p>}
          <div className="button-row">
            {state.hostingMode !== "hosted" && !state.connection.scriptAuthorized && (
              <button
                className="secondary"
                disabled={!state.connection.googleConfigured || !!busy}
                onClick={() =>
                  run("script-authorize", async () => {
                    const result = await request("/auth/google/start", {
                      includeScript: true,
                    });
                    window.location.assign(result.url);
                  })
                }
              >
                <Link2 size={16} />
                Authorize sidebar setup
              </button>
            )}
            {state.hostingMode !== "hosted" && state.connection.scriptAuthorized &&
              !state.connection.scriptInstalled && (
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      "script-install",
                      () => request("/apps-script/install", {}),
                      "Sidebar installed. Reopen your Google Sheet to see the ApplyWeave menu.",
                    )
                  }
                >
                  <Plus size={16} />
                  Install Sheet sidebar
                </button>
              )}
            {state.connection.scriptInstalled && (
              <a
                className="button secondary"
                href={
                  "https://docs.google.com/spreadsheets/d/" +
                  encodeURIComponent(state.connection.spreadsheetId) +
                  "/edit"
                }
                target="_blank"
                rel="noreferrer"
              >
                Open tracker <ArrowUpRight size={16} />
              </a>
            )}
          </div>
          {!state.connection.googleConfigured && (
            <p className="helper">
              Save your Google connection configuration above first.
            </p>
          )}
        </div>
      </section>
      <section className="helper-install">
        <div>
          <h2>Chrome form helper</h2>
          <p>
            Open <code>chrome://extensions</code>, enable Developer mode, and
            load the <code>extension/dist</code> folder. Import a Chrome bundle
            from Prepare, review the field matches, then fill selected fields.
          </p>
          <p className="helper">
            The helper supports approved company portals. On LinkedIn and
            Wellfound, copy reviewed answers manually. You always submit the
            application yourself.
          </p>
        </div>
        <ShieldCheck size={32} />
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
