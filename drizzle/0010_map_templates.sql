-- Shared per-map studio defaults (spawns, walls/fog, actors, features, grid).
CREATE TABLE map_templates (
  module TEXT NOT NULL,
  map_key TEXT NOT NULL,
  data TEXT NOT NULL,
  artwork_id TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (module, map_key)
);
CREATE INDEX map_templates_updated ON map_templates(updated_at);

CREATE TABLE map_template_assets (
  artwork_id TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  body BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
