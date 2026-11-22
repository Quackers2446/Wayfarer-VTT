CREATE TABLE session_images (
  asset_key TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  chunk_count INTEGER NOT NULL
);
CREATE TABLE session_image_chunks (
  asset_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  body BLOB NOT NULL,
  PRIMARY KEY (asset_id, part)
);
