CREATE TABLE epgp_standing (name_key TEXT PRIMARY KEY, class TEXT, ep REAL NOT NULL, gp REAL NOT NULL);
CREATE TABLE epgp_meta (id INTEGER PRIMARY KEY CHECK (id = 1), imported_at INTEGER NOT NULL);
