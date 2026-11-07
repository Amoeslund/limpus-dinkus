# Limpus Dinkus guild site: design

Date: 2026-11-07
Domain: LoremForever.com (bought, DNS in Cloudflare)
Game: World of Warcraft: Forever (Blizzard's "Classic+", launched 2026-11-04, realmless, addon interface 16001)

## Intent

Limpus Dinkus currently tracks raid attendance and loot by hand in a Google Sheet (screenshot: items × players, cells hold the date an item was received, split into "BIS MS" and "OS / NotBis" columns, with a per-player "items per raid" figure). The officers want a website that replaces the sheet.

The core principle: **regular raiders do nothing extra.** They barely sign up on time. Only the person who exports after a raid (raid leader / master looter) and the officers ever touch the site's admin side. Everyone else just reads public pages.

Success: after a raid, one person pastes two exports into the admin page and the public attendance page, raid pages and loot scores update. No more hand-typed dates in a spreadsheet.

## Goals

- Public **Attendance** page.
- Public **raid page per instance** (Molten Core, Blackwing Lair, Zul'Gurub, new Forever raids...) listing every drop: who got what, in which week.
- A **loot score** per player, shown on every raid page.
- **Admin** page for officers: import, link alts to mains, exclude pug raids, edit attendance by hand, set item point values.
- Use week numbers instead of dates when showing raids (Kruse's request).

## Non-goals (for now)

- Guild bank request feature (maybe later, not in this build).
- Raid sign-ups, DKP bidding, or anything raiders have to log in to.
- Automatic Warcraft Logs import. WCL does not support WoW Forever yet. The design keeps attendance import behind a small interface so WCL can be added later, but nothing WCL-specific gets built now.
- Modifying the Darklight LootCouncil addon (All Rights Reserved; we only read its export).

## Anti-goals

- Anything that requires regular raiders to visit the site or install something new to be counted. (The attendance addon is installed only by whoever records attendance, normally the raid leader.)
- Double-counting loot when the same export is pasted twice or exports overlap.
- Losing loot because the Darklight history (capped at 100 records, oldest dropped first) rolled over. The site should make it obvious when the last import was.

## Data sources

### Loot: Darklight LootCouncil (existing addon, already used with master loot)

Raid leader runs `/dlc export` and picks "Darklight Web (JSON)", then copies the text with Ctrl+C. Format (read from `Modules/Export.lua`, v2.1.13):

```json
{
  "guild": "Darklight", "addon": "DarklightLC", "version": "2.1.13",
  "realm": "", "exportedAt": 1762297200, "test": false,
  "records": [
    {
      "id": "1762295000_Mankee_18820_s12",
      "distributionId": "s12",
      "timestamp": 1762295000,
      "date": "2026-11-11 21:14",
      "player": "Mankee",
      "itemId": 18820,
      "itemName": "Talisman of Ephemeral Power",
      "response": "BiS",
      "votes": 3
    }
  ]
}
```

- `"guild":"Darklight"` is hard-coded by the addon. Ignore it.
- `response` values: `BiS`, `Upgrade`, `Offspec` (`Pass` is never awarded). Older records may have other strings; treat unknown values as `Upgrade` and flag them in the import preview.
- `player` may carry a `-Realm` suffix. Normalise names by stripping everything after the first `-`, trimming, and comparing case-insensitively (the same rule the addon's own `NameKey` uses).
- `id` is stable per award. It is the dedup key: importing the same record twice is a no-op.
- Reject exports with `"test": true` (Darklight test mode), with a clear message.
- The export has no zone or instance info (see "Assigning loot to instances").

### Attendance: new addon "LimpusAttendance" (we build it)

Small addon, installed by whoever records attendance. Targets interface 16001 (WoW Forever). Behaviour:

- On every successful boss kill (`ENCOUNTER_END` with success = 1), snapshot: unix timestamp, zone name (`GetInstanceInfo()`), encounter name, and the names of everyone in the raid group (`GetRaidRosterInfo`).
- Stored in SavedVariables (`LimpusAttendanceDB`). Keep the last ~60 days, then prune.
- `/limpus export` opens a window with a JSON string (selected, ready for Ctrl+C), same UX as Darklight's export.
- `/limpus` alone prints the number of stored kills and the date of the last one.

Export format (builder may refine field names, keep it versioned):

```json
{
  "addon": "LimpusAttendance", "version": 1, "exportedAt": 1762297200,
  "kills": [
    { "t": 1762290100, "zone": "Molten Core", "boss": "Lucifron",
      "raid": ["Ildkule", "Mankee", "Zefalock"] }
  ]
}
```

Dedup key on import: `(t, boss)`.

## Core concepts and rules (decided with the user)

- **Raid night** = the unit of attendance. All boss kills that belong to the same night form one raid night, no matter how many instances were cleared. A player who appears in at least one kill of a night attended that night. *(Builder's call: a night is grouped by date in Europe/Copenhagen time with a 06:00 cutoff, so kills after midnight belong to the previous evening.)*
- **Week number**: ISO week of the raid night, displayed as "Wk 46 · Wed 11 Nov".
- **Mains and alts**: every character either is a main or points to one main. Attendance and loot on an alt count toward the main. Public pages show the main's name, with alt names in small text.
- **Character status**: each main has a status: `member` (default for new characters), `guest`, or `left`. Guests and people who left are hidden from the public attendance and score tables and have no score. Their awards still appear in raid loot logs. Alts inherit their main's status.
- **Manual raid nights**: officers can create a raid night by hand (date, instances, tick who was present). Loot from Darklight that falls on that date attaches to it. This covers nights before the attendance addon was installed, and nights where it wasn't running. Tracking starts from the first night recorded either way; there is no import of the old Google Sheet.
- **Time zone**: all night grouping and display use `Europe/Copenhagen` *(builder's call: Danish guild, realmless game has no server clock)*. Keep it as one config value.
- **Pug raids**: every raid night has a "counts" flag, default on. Officers switch it off for pug/off-night raids. A night that doesn't count adds neither attendance nor loot points. Its loot still shows on raid pages, marked "pug" *(builder's call)*.
- **Item points**: every item has a point value, default **1** the first time it is seen. Officers can change it.
- **Points per award**: `BiS` and `Upgrade` give the item's point value. `Offspec` gives 0.
- **Score** = (sum of points from counting nights, including alts) ÷ (number of counting raid nights attended, including alts). One global score across all instances. It is the same number on every raid page. A player with 0 attended nights shows "—". Shown with two decimals and a dot as the decimal separator, since the site is in **English**.

## Assigning loot to instances

Raid pages are per instance, but Darklight records have no zone. Rule *(builder's call)*: for each loot record, find the latest boss kill from the attendance data on the same raid night with `kill.t <= loot.timestamp`. That kill's zone is the item's instance. If there is none (loot before the first kill, or no attendance imported), use the earliest kill that night. If the night has no kills at all, the import preview asks the officer to pick the instance from a dropdown.

Once an item ID has been assigned an instance, remember it on the item. Later drops of the same item default to that instance.

## Pages

The approved mockup is `mockups/mockup-v1.html`. Dark, WoW-flavoured theme with gold accents. Must work on a phone.

### Attendance (public, `/`)

- A table with one row per main and one column per counting raid night (newest on the right, horizontally scrollable). Cells: present / present on alt / absent.
- Per player: counting raids attended, attendance % (of counting nights since the player's first attended night *(builder's call)*), score.
- Sorted by attendance, highest first.

### Raid pages (public, `/raid/<instance-slug>`)

- Tabs or links for each instance that has had drops.
- Left: **loot log** grouped by raid night ("Week 46 · Wed 11 Nov"). Rows show the item (colored, linked to Wowhead for WoW Forever if a URL pattern exists; otherwise plain), the player (main name), a response pill (BiS / Upgrade / Offspec), and points.
- Right: the **score table** for all mains: raids, points, score. Sorted **lowest score first**, so the players who are "owed" loot are at the top.
- The user chose the loot log view. The items × players grid from the old sheet is not built.

### Admin (`/admin`, Discord login required)

1. **Import**: two text boxes (Darklight JSON, LimpusAttendance JSON), either one can be empty. "Preview" shows the detected raid nights with week, instances and boss counts, the number of players, new characters to link, new items vs. already-imported items skipped, and any unknown responses. "Save" commits it. Show "last import: <date>" and a warning if it's been more than 7 days.
2. **Raid nights**: list with the "counts" toggle and a "New raid night" button (manual night: date, instances, roster checkboxes from known members). Click a night to add or remove a player by hand (e.g. someone was there but disconnected during kills) or to delete the whole night.
3. **Characters**: list of characters. New ones are flagged. A dropdown sets the main ("is a main" or pick one), and mains get a status dropdown (member / guest / left).
4. **Item points**: searchable list of items with instance, point value (editable), and times dropped. Officers can also correct an item's instance.
5. **Loot record edit**: fix or delete a single award (wrong player, should not count).
6. **Admins**: list of Discord user IDs allowed in. The first admin (the user) is set via config/env. Admins can add others.

## Tech (builder's calls, stated to the user)

- **Cloudflare Workers** with static assets for the site, **D1** (SQLite) for data, on LoremForever.com. Everything runs on the free tier.
- **Discord OAuth2** login for admin. The allowlist is stored in D1, and the bootstrap admin's Discord ID comes from an env var. Session is a signed HTTP-only cookie.
- Public pages are server-rendered or a light client. The builder chooses, but they should load fast and need no JS framework build if avoidable.
- Score and attendance are computed from raw tables at query time (data is tiny: ~40 players, ~2 nights/week). No caching layer is needed.
- Import is idempotent and transactional: parse, preview (no writes), then commit in one D1 batch.
- The attendance import goes through a source-agnostic shape `{night, zone, boss, t, characters[]}`, so a WCL source can be added later.
- The addon lives in this repo (`addon/LimpusAttendance/`) and the user installs it by copying the folder to `F:\Games\World of Warcraft\_forever_\Interface\AddOns\`.

## Suggested data model (builder may adjust)

- `character(name_key PK, display_name, main_key NULL -> character, status TEXT DEFAULT 'member')`
- `raid_night(id PK, night_date UNIQUE, iso_week, counts BOOL, manual BOOL, instances TEXT NULL)`
- `kill(id PK, night_id, t, zone, boss, UNIQUE(t, boss))`
- `kill_member(kill_id, name_key)`
- `night_override(night_id, name_key, present BOOL)`: manual add/remove
- `item(item_id PK, name, instance NULL, points REAL DEFAULT 1)`
- `award(darklight_id PK, night_id, t, name_key, item_id, response, deleted BOOL)`
- `admin(discord_id PK, name)`
- `import_log(id, at, by_discord_id, summary)`

## Left to the builder

- Exact visual polish beyond the mockup, the URL scheme, and how item colors and quality are shown (the export has no quality; default to epic purple, or look it up from the item link if a later Darklight version includes it).
- Whether public pages are SSR from the Worker or static HTML + JSON API.
- Test strategy. At minimum: unit tests for the import parser (dedup, name normalisation, test-mode rejection, night grouping and 06:00 cutoff, instance assignment) and for the score math.
