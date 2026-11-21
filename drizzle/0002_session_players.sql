CREATE TABLE `session_players` (
  `session_id` text NOT NULL REFERENCES `game_sessions`(`id`) ON DELETE CASCADE,
  `controller` text NOT NULL,
  `username` text NOT NULL,
  `username_key` text NOT NULL,
  `joined_at` integer NOT NULL,
  `last_seen` integer NOT NULL,
  PRIMARY KEY (`session_id`, `controller`),
  UNIQUE (`session_id`, `username_key`)
);
