CREATE TABLE account_photos (
  user_id TEXT PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
  image_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  body BLOB NOT NULL
);

ALTER TABLE session_chat ADD COLUMN profile_id TEXT REFERENCES account_users(id) ON DELETE SET NULL;
