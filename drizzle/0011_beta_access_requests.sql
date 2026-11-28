-- Public access requests for closed beta. Admins approve (allowlist) or deny.
CREATE TABLE beta_access_requests (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX beta_access_requests_status ON beta_access_requests(status, created_at);
CREATE INDEX beta_access_requests_email ON beta_access_requests(email);
