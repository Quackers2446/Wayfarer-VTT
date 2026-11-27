CREATE TABLE `session_player_auth` (
  `session_id` text NOT NULL REFERENCES `game_sessions`(`id`) ON DELETE CASCADE,
  `controller` text NOT NULL,
  `credential_hash` text NOT NULL,
  PRIMARY KEY (`session_id`, `controller`)
);
