-- Closed beta invite list. Admins (BETA_ADMIN_EMAILS) may add/remove rows.
CREATE TABLE beta_allowlist (
  email TEXT PRIMARY KEY NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX beta_allowlist_created ON beta_allowlist(created_at);

-- Shareable invite tokens: any Google account that redeems a live invite is allowlisted.
CREATE TABLE beta_invites (
  token_hash TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT,
  expires_at INTEGER,
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX beta_invites_active ON beta_invites(revoked, expires_at);
