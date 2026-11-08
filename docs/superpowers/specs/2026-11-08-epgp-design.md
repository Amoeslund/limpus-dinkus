# Switch loot score to EPGP: design

Date: 2026-11-08. Approved by the user in chat.

## Intent

The guild is replacing its own loot score (item points ÷ raids attended) with EPGP. The in-game addon **EPGP Forever** (CurseForge, Interface 16001, by Haldon) is the source of truth for EP and GP. It awards attendance EP on a timer, officers award GP when they hand out loot, and it handles decay (10% a week), base GP (100) and min EP. Values live in guild officer notes. The site only **displays** the addon's standings next to attendance and loot history, so the PR you see on the site is the same as in game.

## Decisions (the user's)

- EP and GP come from EPGP Forever. The site does not calculate them, and there are no item GP values or response multipliers on the site.
- The old score is removed: item points, `pointsFor`, the Points/Score columns, and the "pt" column in the loot log.
- The attendance addon (LimpusAttendance) and the Darklight loot log stay as they are.

## EPGP Forever standings export

The addon exports a standings CSV through its CSV tools, documented as `Name,Class,EP,GP` (export). Its import also accepts `Name,EP,GP`. The site accepts both:

- Optional header row: skip the first line when it doesn't parse as data, i.e. EP or GP isn't a number. Header names are case-insensitive.
- Columns: 3 (`Name,EP,GP`) or 4 (`Name,Class,EP,GP`).
- Separator: comma. Fields may be wrapped in double quotes, and whitespace is trimmed. Accept both CRLF and LF line endings, and ignore empty lines.
- EP and GP are non-negative numbers, integer or decimal. A row with a non-numeric EP or GP is skipped and a warning is added.
- Names are normalised with `nameKey`/`displayName` (strip the realm suffix).
- Duplicate names: the last row wins, with a warning.
- A file with zero valid rows is an error.

## Behaviour

- **Import:** the admin import page gets a third textarea, "EPGP Forever standings (CSV)". Any of the three can be empty, but at least one must be filled. The preview shows the number of standings rows, how many match known characters, and any warnings. On commit, the uploaded standings **replace** the previous standings completely (snapshot), and the time is stored as the standings date. Every row is stored, keyed by name key. The EPGP import **does not create characters**: EPGP Forever's export lists the whole guild roster (it loops over all guild members and skips only `Main:` alts), so standings only show for characters the site already knows from raids or loot. (Changed 2026-11-08 by controller ruling; earlier draft created `member` mains.)
- **Alts:** EPGP Forever leaves `Main:` alts out of its export and shares the main's balance. Rows for characters linked on the site as alts are stored like any other row, but the tables only show mains, so they never duplicate the main's balance.
- **PR** = EP / GP. If GP ≤ 0, PR is null (shown as `—`). Display: EP and GP as integers when whole (otherwise 1 decimal), PR with 2 decimals.
- **Public tables:** only `member` mains are shown, as before.
  - Attendance page: pinned columns are Player and **PR**, followed by EP, GP, Raids, Attendance, then the nights, newest first.
  - Raid page: the right card becomes "EPGP standings" with the columns Player, EP, GP, PR.
  - Default sort is **PR highest first**. Sort buttons: name, pr, ep, gp, raids, pct. PR descending puts null PR last, and the same applies to EP and GP. The first click on PR, EP, GP, Raids or Attendance sorts high to low.
  - Members with no standings row show `—` for EP, GP and PR.
  - Under the table: "EPGP standings as of <Europe/Copenhagen date-time> (from EPGP Forever)", or "No EPGP standings imported yet."
- **Loot log:** the points column is removed. It shows item, player and response pill only.
- **Admin Items:** the points input and column are removed. Items keep the instance grouping and instance editing, plus the drop count.
- **Admin stale warning:** unchanged (it is based on the last import of any kind).
- The GM guide and README mention the weekly standings export.

## Data

New migration `0002_epgp.sql`:

```sql
CREATE TABLE epgp_standing (name_key TEXT PRIMARY KEY, class TEXT, ep REAL NOT NULL, gp REAL NOT NULL);
CREATE TABLE epgp_meta (id INTEGER PRIMARY KEY CHECK (id = 1), imported_at INTEGER NOT NULL);
```

Leave `item.points` in place in the schema (no destructive migration), but nothing reads it any more.

## Non-goals

- Calculating EP or GP, decay, or min EP on the site.
- Importing the EPGP Forever loot or audit history.
- Changing the Darklight or LimpusAttendance parsers.
