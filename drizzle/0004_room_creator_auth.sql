-- Kept outside shared room state. NULL deliberately disables deletion of legacy rooms.
ALTER TABLE game_sessions ADD COLUMN owner_key_hash TEXT;
