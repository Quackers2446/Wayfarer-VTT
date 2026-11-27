CREATE TABLE `session_voice` (
  `session_id` text NOT NULL REFERENCES `game_sessions`(`id`) ON DELETE CASCADE,
  `controller` text NOT NULL,
  `muted` integer NOT NULL DEFAULT 0,
  `deafened` integer NOT NULL DEFAULT 0,
  `joined_at` integer NOT NULL,
  `last_seen` integer NOT NULL,
  PRIMARY KEY (`session_id`, `controller`)
);
--> statement-breakpoint
CREATE TABLE `session_voice_signals` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT,
  `session_id` text NOT NULL REFERENCES `game_sessions`(`id`) ON DELETE CASCADE,
  `signal_id` text NOT NULL,
  `from_controller` text NOT NULL,
  `to_controller` text NOT NULL,
  `kind` text NOT NULL,
  `payload` text NOT NULL,
  `sent_at` integer NOT NULL,
  UNIQUE (`session_id`, `signal_id`)
);
--> statement-breakpoint
CREATE INDEX `session_voice_signals_inbox` ON `session_voice_signals` (`session_id`, `to_controller`, `sequence`);
