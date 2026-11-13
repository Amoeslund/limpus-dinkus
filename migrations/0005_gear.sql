-- Gear from the armory character pages, and dungeon/raid time from Guild Pulse, for the outside-raid effort score.
ALTER TABLE roster_member ADD COLUMN slug TEXT;
-- NULL = the report came from a Guild Pulse version without zone tracking.
ALTER TABLE roster_activity ADD COLUMN dungeon7d INTEGER;
ALTER TABLE roster_activity ADD COLUMN raid7d INTEGER;
-- Last armory character fetch. armory_updated is the armory's own "last updated" time (it changes at logout).
CREATE TABLE roster_profile (name_key TEXT PRIMARY KEY, ilvl INTEGER, armory_updated INTEGER, polled_at INTEGER NOT NULL, error TEXT);
-- Currently equipped items. source is the armory item context: 1 = dungeon drop, 3-6 = raid, 11 = quest/crafted, 0 = other.
CREATE TABLE roster_gear (name_key TEXT NOT NULL, slot TEXT NOT NULL, item_id INTEGER NOT NULL, name TEXT NOT NULL,
  ilvl INTEGER, quality TEXT, source INTEGER, PRIMARY KEY (name_key, slot));
-- Every item a member has been seen wearing. first_seen = 0 for the items found on the first fetch (baseline, not "new").
CREATE TABLE roster_item (name_key TEXT NOT NULL, item_id INTEGER NOT NULL, first_seen INTEGER NOT NULL, name TEXT NOT NULL,
  ilvl INTEGER, source INTEGER, PRIMARY KEY (name_key, item_id));
CREATE TABLE roster_ilvl (name_key TEXT NOT NULL, at INTEGER NOT NULL, ilvl INTEGER NOT NULL, PRIMARY KEY (name_key, at));
