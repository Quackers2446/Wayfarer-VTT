CREATE TABLE `game_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `map` text NOT NULL,
  `state` text NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `artwork_type` text
);
