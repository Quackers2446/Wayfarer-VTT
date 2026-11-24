CREATE TABLE account_users (
 id TEXT PRIMARY KEY NOT NULL,
 google_sub TEXT UNIQUE NOT NULL,
 email TEXT NOT NULL,
 display_name TEXT NOT NULL,
 bio TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE account_sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX account_sessions_expiry ON account_sessions(expires_at);
CREATE TABLE account_challenges (
 nonce_hash TEXT PRIMARY KEY NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE account_workspaces (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 data TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE TABLE account_rooms (
 user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 room_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','member')),
 PRIMARY KEY (user_id,room_id)
);
CREATE UNIQUE INDEX account_room_owner ON account_rooms(room_id) WHERE role='owner';
CREATE TABLE account_tokens (
 user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 token_id TEXT NOT NULL,
 content_type TEXT NOT NULL,
 body BLOB NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,token_id)
);
