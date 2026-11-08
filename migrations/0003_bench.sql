-- A benched override (present = 1, benched = 1) counts as attendance; presence on a kill wins over it.
ALTER TABLE night_override ADD COLUMN benched INTEGER NOT NULL DEFAULT 0;
