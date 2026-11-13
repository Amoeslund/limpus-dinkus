-- Guild roster tracking: armory snapshots (level, rank) plus Guild Pulse addon reports (last online, playtime seen).
CREATE TABLE roster_member (name_key TEXT PRIMARY KEY, display_name TEXT NOT NULL, class TEXT,
  level INTEGER NOT NULL, rank_id INTEGER, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, left_at INTEGER);
CREATE TABLE roster_level (name_key TEXT NOT NULL, at INTEGER NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (name_key, at));
CREATE TABLE roster_activity (name_key TEXT PRIMARY KEY, last_online INTEGER, seen7d INTEGER NOT NULL DEFAULT 0,
  avg_day INTEGER NOT NULL DEFAULT 0, share REAL NOT NULL DEFAULT 0, reported_at INTEGER NOT NULL);
CREATE TABLE roster_rank (rank_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE roster_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
