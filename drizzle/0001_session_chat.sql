CREATE TABLE `session_chat` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT,
  `session_id` text NOT NULL REFERENCES `game_sessions`(`id`) ON DELETE CASCADE,
  `message_id` text NOT NULL,
  `author` text NOT NULL,
  `body` text NOT NULL,
  `sent_at` integer NOT NULL,
  UNIQUE (`session_id`, `message_id`)
);
--> statement-breakpoint
CREATE INDEX `session_chat_order` ON `session_chat` (`session_id`, `sequence`);
