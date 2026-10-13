-- ApplyWeave private single-owner state. Only the server DB role may access these tables.
CREATE TABLE IF NOT EXISTS applyweave_workspaces (
  id text PRIMARY KEY CHECK (id = 'owner'),
  data jsonb NOT NULL CHECK (data->>'schemaVersion' = '1'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE applyweave_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON applyweave_workspaces FROM PUBLIC;
CREATE TABLE IF NOT EXISTS applyweave_auth_records (
  id text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS applyweave_sessions (
  token_hash text PRIMARY KEY,
  user_json jsonb NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS applyweave_sessions_expiry ON applyweave_sessions(expires_at);
CREATE TABLE IF NOT EXISTS applyweave_oauth_states (
  state_hash text PRIMARY KEY,
  encrypted_value text NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS applyweave_oauth_states_expiry ON applyweave_oauth_states(expires_at);
ALTER TABLE applyweave_auth_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE applyweave_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE applyweave_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON applyweave_auth_records, applyweave_sessions, applyweave_oauth_states FROM PUBLIC;
-- Supabase may assign default privileges to its public API roles. RLS also denies
-- all requests from those roles (no policies); explicit revocation is defense in depth.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON applyweave_workspaces, applyweave_auth_records, applyweave_sessions, applyweave_oauth_states FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON applyweave_workspaces, applyweave_auth_records, applyweave_sessions, applyweave_oauth_states FROM authenticated;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS applyweave_generation_jobs (
  id text PRIMARY KEY,
  application_id text NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS applyweave_generation_jobs_application_status ON applyweave_generation_jobs(application_id, status);
CREATE INDEX IF NOT EXISTS applyweave_generation_jobs_created ON applyweave_generation_jobs(created_at);
ALTER TABLE applyweave_generation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON applyweave_generation_jobs FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON applyweave_generation_jobs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON applyweave_generation_jobs FROM authenticated;
  END IF;
END $$;
