# Limpus Dinkus Guild Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Limpus Dinkus site on LoremForever.com: public attendance and per-instance raid pages with loot scores, an admin area behind Discord login, and the LimpusAttendance WoW Forever addon that feeds attendance.

**Architecture:** A single Cloudflare Worker (Hono) renders every page on the server with `hono/jsx`, so there is no frontend build. D1 holds the raw data (characters, nights, kills, awards, items). Standings and scores are computed on each request by pure functions in `src/domain/`. Imports are stateless: the preview re-parses the pasted text and the commit re-parses it again inside one D1 batch. The addon is plain Lua in `addon/LimpusAttendance/`.

**Tech Stack:** TypeScript, Hono 4 (`hono/jsx`), Cloudflare Workers + D1, Wrangler 4, Vitest with `@cloudflare/vitest-pool-workers`, Lua (WoW interface 16001).

**Spec:** `docs/superpowers/specs/2026-11-07-limpus-dinkus-guild-site-design.md` (mockup: `mockups/mockup-v1.html`)

## Global Constraints

- Site language: English. Score uses two decimals and a dot (`1.58`). With 0 raids the score shows `—`.
- Time zone `Europe/Copenhagen`. Night cutoff is 06:00 local, so kills before 06:00 belong to the previous date.
- Week label format: `Wk 46 · Wed 11 Nov` (ISO week).
- Default item points: `1`. `BiS` and `Upgrade` give the item's points. `Offspec` gives `0`.
- Unknown Darklight response strings are treated as `Upgrade` and listed as warnings in the preview.
- Name normalisation: strip everything from the first `-`, trim, collapse whitespace, lowercase. The result is `name_key`.
- Darklight export with `"test": true` is rejected with the message `This is a Darklight test-mode export. Turn off test mode and export again.`
- Score = points from counting nights (main + alts) ÷ counting nights attended (main + alts). Only `member` mains appear in public tables. Guests and people who left are hidden, but their awards still show in loot logs.
- Night `counts` flag defaults to on. Non-counting nights add no attendance and no points, and their loot is shown with a `pug` tag.
- Raid page score table sorts lowest score first, with `—` last. The attendance table sorts by attendance % (highest first), then by raids.
- Warn on the admin page when the last import is more than 7 days old.
- Must work at phone width (no horizontal page scroll; wide tables scroll inside their own container).
- Secrets: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_ID`. Never commit them (use `.dev.vars` locally, which is gitignored).

## Review Focus

1. **The same export pasted twice, or two exports that overlap.** Expect no duplicate awards, kills or kill members, and the preview counts duplicates as "already imported". Test: Task 6 `commit is idempotent`.
2. **Kills after midnight, and the DST weekend.** A kill at 00:30 Thursday belongs to Wednesday's night. On 2026-10-25 (the DST change) a kill at 05:30 local still belongs to the 24th. Test: Task 2 `nightDateFor handles midnight and DST`.
3. **The same character written differently** (`Mankee`, `mankee-Forever`, ` Mankee `). Expect one character. Test: Task 2 `nameKey normalises realm suffix and case`, and Task 6 `import merges name variants`.
4. **Loot on a night with no kills and no instance chosen.** The preview shows an instance dropdown, and the commit rejects with a 400 and a readable message, not a 500. Test: Task 9 `commit without instance for kill-less night is rejected`.
5. **Alt/main linking that would create a chain or a cycle** (setting a main for a character that itself has alts, or setting a character as its own main). Expect a rejection with a message. Scores recompute automatically because they are computed on each request. Test: Task 11 `cannot make a character with alts into an alt`.

---

## File Structure

```
package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, .dev.vars.example, README.md
migrations/0001_init.sql            D1 schema
src/index.tsx                       Hono app, mounts routes, exports default worker
src/env.ts                          Env bindings type
src/config.ts                       TZ, CUTOFF_HOUR, DEFAULT_POINTS, ITEM_URL
src/domain/names.ts                 nameKey()
src/domain/nights.ts                nightDateFor(), isoWeek(), nightLabel()
src/domain/darklight.ts             parseDarklight()
src/domain/limpus.ts                parseLimpus()
src/domain/grouping.ts              groupIntoNights(), assignInstance()
src/domain/standings.ts             pointsFor(), computeStandings()
src/db/read.ts                      loadStandingsInput(), loadRaidLog(), listInstances(), lastImportAt()
src/db/importer.ts                  previewImport(), commitImport()
src/auth/session.ts                 signSession(), verifySession()
src/auth/routes.tsx                 /auth/login, /auth/callback, /auth/logout, requireAdmin middleware
src/views/layout.tsx                Layout, shared CSS (from mockup)
src/views/public.tsx                AttendancePage, RaidPage
src/views/admin.tsx                 Admin pages
src/routes/public.tsx               GET /, GET /raid/:slug
src/routes/admin.tsx                /admin/*
test/*.test.ts(x)                   one file per module
addon/LimpusAttendance/LimpusAttendance.toc
addon/LimpusAttendance/LimpusAttendance.lua
```

## Shared types (defined in the task that first produces them)

```ts
// src/domain/darklight.ts
export type Response = 'BiS' | 'Upgrade' | 'Offspec';
export type AwardInput = { darklightId: string; t: number; nameKey: string; displayName: string;
  itemId: number; itemName: string; response: Response };
export type Parsed<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

// src/domain/limpus.ts
export type KillInput = { t: number; zone: string; boss: string;
  members: { nameKey: string; displayName: string }[] };

// src/domain/grouping.ts
export type NightDraft = { nightDate: string; kills: KillInput[];
  awards: (AwardInput & { instance: string | null })[] };

// src/domain/standings.ts
export type Status = 'member' | 'guest' | 'left';
export type StandingsInput = {
  characters: { nameKey: string; displayName: string; mainKey: string | null; status: Status }[];
  nights: { id: number; nightDate: string; counts: boolean }[];
  killPresence: { nightId: number; nameKey: string }[];
  overrides: { nightId: number; nameKey: string; present: boolean }[];
  awards: { nightId: number; nameKey: string; response: Response; itemPoints: number; deleted: boolean }[];
};
export type Cell = 'main' | 'alt' | 'absent';
export type Standing = { mainKey: string; displayName: string; alts: string[];
  raids: number; points: number; score: number | null; attendancePct: number;
  cells: Record<number, Cell> };
```

---

### Task 1: Scaffold Worker, D1 schema, and a health route

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.dev.vars.example`, `migrations/0001_init.sql`, `src/index.tsx`, `src/env.ts`, `src/config.ts`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Produces: `app` (default export, a Hono app with `fetch`), `Env` type `{ DB: D1Database; DISCORD_CLIENT_ID: string; DISCORD_CLIENT_SECRET: string; SESSION_SECRET: string; BOOTSTRAP_ADMIN_ID: string }`, config constants `TZ = 'Europe/Copenhagen'`, `CUTOFF_HOUR = 6`, `DEFAULT_POINTS = 1`, `STALE_IMPORT_DAYS = 7`, `ITEM_URL = (id: number) => \`https://www.wowhead.com/forever/item=${id}\``.

- [ ] **Step 1: Install dependencies**

```bash
npm init -y
npm i hono
npm i -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

Use the version pairing that the `@cloudflare/vitest-pool-workers` README requires for vitest. Scripts: `"dev": "wrangler dev"`, `"test": "vitest run"`, `"deploy": "wrangler deploy"`, `"db:migrate:local": "wrangler d1 migrations apply limpus --local"`.

- [ ] **Step 2: Write `wrangler.jsonc`**

Settings: `name: "limpus-dinkus"`, `main: "src/index.tsx"`, a recent `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`, and a `d1_databases` binding `DB` with `database_name: "limpus"` and `migrations_dir: "migrations"` (`database_id` is a placeholder until Task 13). Set tsconfig `jsx: "react-jsx"` and `jsxImportSource: "hono/jsx"`.

- [ ] **Step 3: Write `migrations/0001_init.sql`**

```sql
CREATE TABLE character (name_key TEXT PRIMARY KEY, display_name TEXT NOT NULL,
  main_key TEXT REFERENCES character(name_key), status TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL);
CREATE TABLE raid_night (id INTEGER PRIMARY KEY, night_date TEXT NOT NULL UNIQUE,
  counts INTEGER NOT NULL DEFAULT 1, manual INTEGER NOT NULL DEFAULT 0, instances TEXT);
CREATE TABLE kill (id INTEGER PRIMARY KEY, night_id INTEGER NOT NULL REFERENCES raid_night(id) ON DELETE CASCADE,
  t INTEGER NOT NULL, zone TEXT NOT NULL, boss TEXT NOT NULL, UNIQUE(t, boss));
CREATE TABLE kill_member (kill_id INTEGER NOT NULL REFERENCES kill(id) ON DELETE CASCADE,
  name_key TEXT NOT NULL, PRIMARY KEY(kill_id, name_key));
CREATE TABLE night_override (night_id INTEGER NOT NULL REFERENCES raid_night(id) ON DELETE CASCADE,
  name_key TEXT NOT NULL, present INTEGER NOT NULL, PRIMARY KEY(night_id, name_key));
CREATE TABLE item (item_id INTEGER PRIMARY KEY, name TEXT NOT NULL, instance TEXT,
  points REAL NOT NULL DEFAULT 1);
CREATE TABLE award (darklight_id TEXT PRIMARY KEY, night_id INTEGER NOT NULL REFERENCES raid_night(id) ON DELETE CASCADE,
  t INTEGER NOT NULL, name_key TEXT NOT NULL, item_id INTEGER NOT NULL REFERENCES item(item_id),
  response TEXT NOT NULL, instance TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE admin (discord_id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE import_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, by_discord_id TEXT NOT NULL, summary TEXT NOT NULL);
```

`award.instance` is not in the spec's suggested model. It is added so that raid pages can query by instance, and editing an item's instance updates its awards too.

- [ ] **Step 4: Configure `vitest.config.ts`**

Use `defineWorkersConfig`. Read the migrations with `readD1Migrations('migrations')` and pass them as a binding, then apply them in a `test/apply-migrations.ts` setup file with `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`. Set test bindings for the four secrets (`SESSION_SECRET: 'test-secret'`, `BOOTSTRAP_ADMIN_ID: '111'`).

- [ ] **Step 5: Write the failing test** `test/smoke.test.ts`

```ts
it('GET /healthz returns ok', async () => {
  const res = await SELF.fetch('https://x/healthz');
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('ok');
});
it('schema exists', async () => {
  const r = await env.DB.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").first<{n:number}>();
  expect(r!.n).toBeGreaterThanOrEqual(9);
});
```

- [ ] **Step 6: Run `npm test`.** Expected: FAIL (no route).
- [ ] **Step 7: Implement `src/index.tsx`** with `app.get('/healthz', c => c.text('ok'))`.
- [ ] **Step 8: Run `npm test`.** Expected: PASS.
- [ ] **Step 9: Commit** `chore: scaffold worker, D1 schema and test harness`

---

### Task 2: Names and night dates

**Files:**
- Create: `src/domain/names.ts`, `src/domain/nights.ts`
- Test: `test/names.test.ts`, `test/nights.test.ts`

**Interfaces:**
- Produces: `nameKey(name: string): string`, `displayName(name: string): string` (strip the realm and trim, keep the original case), `nightDateFor(t: number): string` (`YYYY-MM-DD`), `isoWeek(date: string): number`, `nightLabel(date: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
it('nameKey normalises realm suffix and case', () => {
  expect(nameKey('Mankee')).toBe('mankee');
  expect(nameKey('mankee-Forever')).toBe('mankee');
  expect(nameKey('  Mankee ')).toBe('mankee');
  expect(displayName('Mankee-Forever')).toBe('Mankee');
});
it('nightDateFor handles midnight and DST', () => {
  // 2026-11-11 21:14 CET
  expect(nightDateFor(Date.UTC(2026,10,11,20,14)/1000)).toBe('2026-11-11');
  // 2026-11-12 00:30 CET -> previous night
  expect(nightDateFor(Date.UTC(2026,10,11,23,30)/1000)).toBe('2026-11-11');
  // 2026-11-12 06:00 CET -> new day
  expect(nightDateFor(Date.UTC(2026,10,12,5,0)/1000)).toBe('2026-11-12');
  // DST end 2026-10-25: 05:30 CET local = 04:30 UTC -> still the 24th
  expect(nightDateFor(Date.UTC(2026,9,25,4,30)/1000)).toBe('2026-10-24');
  // summer: 2026-07-01 23:00 CEST = 21:00 UTC
  expect(nightDateFor(Date.UTC(2026,6,1,21,0)/1000)).toBe('2026-07-01');
});
it('isoWeek and nightLabel', () => {
  expect(isoWeek('2026-11-11')).toBe(46);
  expect(isoWeek('2027-01-01')).toBe(53);
  expect(nightLabel('2026-11-11')).toBe('Wk 46 · Wed 11 Nov');
});
```

- [ ] **Step 2: Run `npx vitest run test/names.test.ts test/nights.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `nightDateFor` gets the local date and hour with `Intl.DateTimeFormat('en-CA', { timeZone: TZ, year, month, day, hour, hourCycle: 'h23' })`. If the hour is below `CUTOFF_HOUR`, subtract one calendar day (do the date arithmetic on a UTC-noon `Date` to avoid DST problems). `nightLabel` formats the weekday and month in English.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: name normalisation and night date grouping`

---

### Task 3: Darklight export parser

**Files:**
- Create: `src/domain/darklight.ts`
- Test: `test/darklight.test.ts`

**Interfaces:**
- Consumes: `nameKey`, `displayName` (Task 2).
- Produces: `parseDarklight(text: string): Parsed<AwardInput[]>`, plus the types `Response`, `AwardInput` and `Parsed<T>` (see Shared types).

- [ ] **Step 1: Write the failing tests** (fixture `test/fixtures/darklight.json` in the spec's format, with 3 records: BiS, Upgrade, Offspec, one of them with player `Zefal-Forever`)

```ts
it('parses records', () => {
  const r = parseDarklight(fixture);
  expect(r.ok && r.value).toHaveLength(3);
  expect(r.ok && r.value[0]).toMatchObject({ darklightId: '1762295000_Mankee_18820_s12', t: 1762295000,
    nameKey: 'mankee', displayName: 'Mankee', itemId: 18820, itemName: 'Talisman of Ephemeral Power', response: 'BiS' });
});
it('strips realm suffix', () => { /* Zefal-Forever -> nameKey 'zefal', displayName 'Zefal' */ });
it('rejects test-mode exports', () => {
  const r = parseDarklight(JSON.stringify({ ...JSON.parse(fixture), test: true }));
  expect(r).toEqual({ ok: false, error: 'This is a Darklight test-mode export. Turn off test mode and export again.' });
});
it('unknown response becomes Upgrade with a warning', () => { /* response "Major Upgrade" -> 'Upgrade', warnings[0] contains 'Major Upgrade' */ });
it('rejects non-JSON and wrong addon', () => {
  expect(parseDarklight('hello').ok).toBe(false);
  expect(parseDarklight('{"addon":"Other","records":[]}').ok).toBe(false);
});
it('empty input is an empty list', () => { expect(parseDarklight('  ')).toEqual({ ok: true, value: [], warnings: [] }); });
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement `parseDarklight`.** Require `addon === 'DarklightLC'` and a `records` array. Skip records that have no `player` or `itemId`, and add a warning for each skipped record.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: parse Darklight loot export`

---

### Task 4: LimpusAttendance parser, night grouping, instance assignment

**Files:**
- Create: `src/domain/limpus.ts`, `src/domain/grouping.ts`
- Test: `test/limpus.test.ts`, `test/grouping.test.ts`

**Interfaces:**
- Consumes: `nameKey`, `displayName`, `nightDateFor` (Task 2), `AwardInput` (Task 3).
- Produces: `parseLimpus(text: string): Parsed<KillInput[]>`, `assignInstance(t: number, kills: KillInput[]): string | null`, `groupIntoNights(kills: KillInput[], awards: AwardInput[]): NightDraft[]` (sorted by `nightDate`).

- [ ] **Step 1: Write the failing tests**

```ts
it('parseLimpus parses kills and dedupes members', () => {
  const r = parseLimpus(JSON.stringify({ addon: 'LimpusAttendance', version: 1, exportedAt: 1,
    kills: [{ t: 100, zone: 'Molten Core', boss: 'Lucifron', raid: ['Ildkule', 'ildkule-Forever', 'Mankee'] }] }));
  expect(r.ok && r.value[0].members.map(m => m.nameKey)).toEqual(['ildkule', 'mankee']);
});
it('parseLimpus rejects other addons and unknown versions', () => { /* addon 'X' -> ok false; version 2 -> ok false */ });
it('assignInstance uses latest kill at or before loot, else earliest kill', () => {
  const kills = [k(100,'Molten Core'), k(500,"Zul'Gurub")];
  expect(assignInstance(300, kills)).toBe('Molten Core');
  expect(assignInstance(500, kills)).toBe("Zul'Gurub");
  expect(assignInstance(50, kills)).toBe('Molten Core');
  expect(assignInstance(50, [])).toBeNull();
});
it('groupIntoNights groups across midnight and assigns instances per night', () => {
  // kills Wed 21:00 MC and Thu 00:30 ZG, loot Thu 00:40 -> one night 2026-11-11, loot instance ZG
  // loot on a date with no kills -> its own NightDraft with instance null
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** `assignInstance` only looks at the kills passed in, which the caller has already limited to that night.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: parse attendance export and group into raid nights`

---

### Task 5: Standings and score

**Files:**
- Create: `src/domain/standings.ts`
- Test: `test/standings.test.ts`

**Interfaces:**
- Produces: `pointsFor(response: Response, itemPoints: number): number`, `computeStandings(input: StandingsInput): Standing[]`, `formatScore(score: number | null): string`, and the types `Status`, `StandingsInput`, `Cell`, `Standing`.

Rules (from the spec). A character's main is `mainKey ?? nameKey`, and its status is the main's status. Effective presence for a night is (killPresence ∪ overrides with present) − overrides with absent. Only nights where `counts` is true count. `raids` is the number of counting nights where the main or any of its alts was present. A cell is `main` if the main was present, `alt` if only an alt was, and `absent` otherwise. `points` is the sum of `pointsFor` over non-deleted awards on counting nights, for the main and its alts. `score` is `points / raids`, or null when raids is 0. `attendancePct` is `round(100 * raids / countingNightsSinceFirstAttended)`, or 0 with no raids. The result contains only `member` mains, sorted by attendancePct desc, then raids desc, then displayName.

- [ ] **Step 1: Write the failing tests**

```ts
it('pointsFor', () => { expect(pointsFor('BiS', 3)).toBe(3); expect(pointsFor('Upgrade', 2)).toBe(2); expect(pointsFor('Offspec', 3)).toBe(0); });
it('alt attendance and loot roll up to main', () => { /* zefalock alt of zefal present night 2 only; award on zefalock 1pt -> zefal raids 2, points 1, cells {1:'main',2:'alt'} */ });
it('non-counting nights add nothing', () => { /* pug night with presence + BiS award -> not in raids, not in points */ });
it('overrides add and remove presence', () => {});
it('deleted awards ignored', () => {});
it('guests and left hidden; score null with 0 raids', () => {});
it('attendancePct counts from first attended night', () => { /* nights 1..4, player attends 3 and 4 -> 100 */ });
it('formatScore', () => { expect(formatScore(1.58333)).toBe('1.58'); expect(formatScore(null)).toBe('—'); });
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement it as a pure function** with no DB access.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: compute attendance standings and loot score`

---

### Task 6: Import preview and commit (DB)

**Files:**
- Create: `src/db/importer.ts`
- Test: `test/importer.test.ts`

**Interfaces:**
- Consumes: `parseDarklight`, `parseLimpus`, `groupIntoNights`, `DEFAULT_POINTS`.
- Produces:
```ts
export type ImportRequest = { lootText: string; attendanceText: string;
  instancePicks: Record<string /*nightDate*/, string>; countsOff: string[] /*nightDates*/ };
export type NightPreview = { nightDate: string; label: string; instances: { zone: string; bosses: number }[];
  players: number; newAwards: number; duplicateAwards: number; needsInstance: boolean; existing: boolean };
export type ImportPreview = { ok: true; nights: NightPreview[]; newCharacters: string[]; warnings: string[] }
  | { ok: false; error: string };
export function previewImport(db: D1Database, req: ImportRequest): Promise<ImportPreview>;
export function commitImport(db: D1Database, req: ImportRequest, byDiscordId: string):
  Promise<{ ok: true; summary: string } | { ok: false; error: string }>;
```

The commit re-runs the preview logic. If any night with new awards still has `needsInstance` and no entry in `instancePicks`, it returns `{ ok:false, error:'Pick an instance for <label>' }`. Otherwise it writes everything in one `db.batch`, upserting nights by `night_date` (existing nights keep their `counts` value, and new nights listed in `countsOff` get `counts=0`). It uses `INSERT OR IGNORE` for characters (`display_name` from the first time a character is seen), items (`points=DEFAULT_POINTS`, `instance` = the first assigned instance), kills (unique `t, boss`), kill members and awards (PK `darklight_id`). Award instance: the assigned instance, else the night pick, else `item.instance`. Finally it writes a row to `import_log`.

- [ ] **Step 1: Write the failing tests**

```ts
it('preview reports nights, new characters and new awards without writing', async () => {});
it('commit is idempotent', async () => {
  await commitImport(env.DB, req, '111'); await commitImport(env.DB, req, '111');
  expect(await count('award')).toBe(3); expect(await count('kill')).toBe(2); expect(await count('kill_member')).toBe(N);
  const p = await previewImport(env.DB, req); expect(p.ok && p.nights[0].duplicateAwards).toBe(3);
});
it('import merges name variants', async () => { /* Mankee in loot, mankee-Forever in kills -> one character row */ });
it('loot-only night needs an instance pick', async () => { /* needsInstance true; commit without pick -> ok false; with pick -> award.instance = pick */ });
it('countsOff marks new nights as not counting but leaves existing nights alone', async () => {});
it('new items default to 1 point', async () => {});
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: idempotent import of loot and attendance`

---

### Task 7: Read queries

**Files:**
- Create: `src/db/read.ts`
- Test: `test/read.test.ts`

**Interfaces:**
- Consumes: `StandingsInput` (Task 5), and data written by `commitImport` (Task 6), which the tests use for setup.
- Produces:
```ts
export function loadStandingsInput(db: D1Database): Promise<StandingsInput>;
export function listInstances(db: D1Database): Promise<{ name: string; slug: string }[]>; // distinct award.instance, slug = lowercase, non-alnum -> '-'
export type LogRow = { nightId: number; nightDate: string; counts: boolean; itemId: number; itemName: string;
  playerDisplay: string; /* main's display name */ altName: string | null; response: Response; points: number };
export function loadRaidLog(db: D1Database, slug: string): Promise<{ instance: string; rows: LogRow[] } | null>; // non-deleted, newest night first
export function lastImportAt(db: D1Database): Promise<number | null>;
```

- [ ] **Step 1: Write the failing tests.** Seed via `commitImport`. Assert that `loadRaidLog('molten-core')` returns the rows newest first, shows the main's name with `altName` filled for alt awards, that `points` uses `pointsFor`, that an unknown slug returns `null`, and that `listInstances` returns `{name:"Zul'Gurub", slug:'zul-gurub'}`.
- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: read queries for standings and raid logs`

---

### Task 8: Public pages

**Files:**
- Create: `src/views/layout.tsx`, `src/views/public.tsx`, `src/routes/public.tsx`
- Modify: `src/index.tsx` (mount the routes)
- Test: `test/public.test.ts`

**Interfaces:**
- Consumes: `loadStandingsInput`, `computeStandings`, `formatScore`, `listInstances`, `loadRaidLog`, `nightLabel`, `ITEM_URL`.
- Produces: `Layout({ title, nav, children, admin?: boolean })`, the routes `GET /` (attendance) and `GET /raid/:slug`, and `GET /raid` (redirects to the first instance, or shows "No raids yet").

Port the CSS and structure from `mockups/mockup-v1.html` (header nav: Attendance, one link per instance, and an admin link on the right). Attendance page: one column per counting night with the `nightLabel` split over 2 lines, cells ● / ◐ / ○, then Raids, Attendance % with a bar, and Score. Raid page: a loot log grouped by night label, with a `pug` tag on non-counting nights. Item names link to `ITEM_URL(id)`, and alt names are shown in small text after the main. Response pills: BiS orange, Upgrade purple, Offspec blue. Next to the log is the score table from `computeStandings`, sorted lowest score first with `—` last.

- [ ] **Step 1: Write the failing tests** (seed via `commitImport`)

```ts
it('attendance page lists members with score', async () => { const html = await (await SELF.fetch('https://x/')).text();
  expect(html).toContain('Mankee'); expect(html).toContain('Wk 46'); expect(html).not.toContain('GuestGuy'); });
it('raid page shows loot log and score table sorted lowest first', async () => {});
it('unknown raid slug is 404', async () => { expect((await SELF.fetch('https://x/raid/nope')).status).toBe(404); });
it('empty database renders without error', async () => { expect((await SELF.fetch('https://x/')).status).toBe(200); });
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test.** Expected: PASS. Then run `npm run db:migrate:local && npm run dev` and check `/` at 375px width in the browser: no page-level horizontal scroll.
- [ ] **Step 5: Commit** `feat: public attendance and raid pages`

---

### Task 9: Discord login and admin guard

**Files:**
- Create: `src/auth/session.ts`, `src/auth/routes.tsx`
- Modify: `src/index.tsx`
- Test: `test/auth.test.ts`

**Interfaces:**
- Produces: `signSession(data: { id: string; name: string }, secret: string, ttlSec = 30*24*3600): Promise<string>`, `verifySession(token: string, secret: string): Promise<{ id: string; name: string } | null>` (HMAC-SHA256 with Web Crypto, payload base64url JSON with `exp`), `requireAdmin` Hono middleware (sets `c.var.admin = { id, name }`, otherwise redirects to `/auth/login`), and the routes `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`.

The login flow redirects to `https://discord.com/oauth2/authorize` with `scope=identify`, `response_type=code`, a `state` that is random and stored in a short-lived cookie, and `redirect_uri` = `<origin>/auth/callback`. The callback checks `state`, exchanges the code at `https://discord.com/api/oauth2/token`, and gets `/api/users/@me`. A user is allowed if their id equals `BOOTSTRAP_ADMIN_ID` or is in the `admin` table. Otherwise they get a 403 page that says "Not an officer". The session cookie `ld_session` is `HttpOnly; Secure; SameSite=Lax; Path=/`.

- [ ] **Step 1: Write the failing tests**

```ts
it('session round-trips and rejects tampering and expiry', async () => {});
it('/admin without cookie redirects to /auth/login', async () => { const r = await SELF.fetch('https://x/admin', { redirect: 'manual' }); expect(r.status).toBe(302); });
it('callback with bad state is 400', async () => {});
it('callback admits bootstrap admin and rejects others', async () => { /* fetchMock Discord token + @me endpoints; id '111' -> 302 /admin with Set-Cookie; id '222' -> 403 */ });
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add a placeholder `GET /admin` behind `requireAdmin` that returns "Admin". Task 10 replaces it.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: Discord login for officers`

---

### Task 10: Admin import screen

**Files:**
- Create: `src/views/admin.tsx`, `src/routes/admin.tsx`
- Modify: `src/index.tsx`
- Test: `test/admin-import.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `previewImport`, `commitImport`, `lastImportAt`, `STALE_IMPORT_DAYS`, `Layout`.
- Produces: `GET /admin` (dashboard with an admin sub-nav: Import, Nights, Characters, Items, Loot, Admins; the import form; "Last import: <date>"; a warning when it is older than 7 days or there has never been an import), `POST /admin/import/preview`, `POST /admin/import/commit`. Tests log in with a helper `adminCookie()` that calls `signSession({id:'111',name:'T'}, 'test-secret')`.

The preview page shows each `NightPreview` as in the mockup, re-sends both texts in hidden textareas, and has a "Counts as guild raid" checkbox per new night (checked by default) and an instance `<select>` (options: known instances plus a free-text "Other") per night that `needsInstance`. The commit redirects to `/admin?imported=<summary>`, or re-renders the preview with the error and a 400 status.

- [ ] **Step 1: Write the failing tests**

```ts
it('preview renders nights without writing', async () => {});
it('commit writes and redirects', async () => {});
it('commit without instance for kill-less night is rejected', async () => { /* status 400, body contains 'Pick an instance for' */ });
it('malformed loot text shows parser error, not 500', async () => {});
it('stale import warning shows after 7 days', async () => {});
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin import screen`

---

### Task 11: Admin management screens

**Files:**
- Modify: `src/views/admin.tsx`, `src/routes/admin.tsx`
- Create: `src/db/admin.ts`
- Test: `test/admin-manage.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `Layout`, `nameKey`, `nightLabel`.
- Produces (all `POST` routes redirect back to their list page and return a 400 page with a message on validation errors):
  - Nights: `GET /admin/nights`, `POST /admin/nights/:id/counts` (toggle), `POST /admin/nights/new` (fields `date`, `instances`, `present[]` name keys of members, creates `manual=1` and override rows with `present=1`), `GET /admin/nights/:id` (effective roster, an add-player field, and remove buttons), `POST /admin/nights/:id/presence` (`nameKey`, `present`, upserts the override, and an unknown name creates a `member` character), `POST /admin/nights/:id/delete`.
  - Characters: `GET /admin/characters` (new = created in the last 14 days, flagged), `POST /admin/characters/:key` (`main` = '' or a name key, and `status`).
  - Items: `GET /admin/items?q=` (with drop count), `POST /admin/items/:id` (`points` ≥ 0, `instance`; changing the instance also updates `award.instance` for that item).
  - Loot: `GET /admin/loot` (latest 100), `POST /admin/loot/:id` (`nameKey`, `deleted`).
  - Admins: `GET /admin/admins`, `POST /admin/admins` (`discordId`, `name`), `POST /admin/admins/:id/delete`. The bootstrap admin is shown but cannot be removed.
- Validation in `setMain(db, key, mainKey|null)`: reject if `mainKey === key`, if `mainKey` is itself an alt, or if `key` has alts (`'Zefal has alts; unlink them first'`).

- [ ] **Step 1: Write the failing tests**

```ts
it('cannot make a character with alts into an alt', async () => {});
it('cannot set a character as its own main or point to an alt', async () => {});
it('toggling counts changes standings', async () => {});
it('manual night with ticked players counts as attendance', async () => {});
it('presence override removes a player from a night', async () => {});
it('item points change updates score; instance change moves awards', async () => {});
it('deleted award no longer counts', async () => {});
it('added admin can pass requireAdmin; bootstrap cannot be deleted', async () => {});
it('all admin routes reject requests without session', async () => {});
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test.** Expected: PASS. Then run `npm test` (full suite). Expected: all PASS.
- [ ] **Step 5: Commit** `feat: admin screens for nights, characters, items, loot and admins`

---

### Task 12: LimpusAttendance addon

**Files:**
- Create: `addon/LimpusAttendance/LimpusAttendance.toc`, `addon/LimpusAttendance/LimpusAttendance.lua`

**Interfaces:**
- Produces: the export JSON that `parseLimpus` reads: `{"addon":"LimpusAttendance","version":1,"exportedAt":<time()>,"kills":[{"t":..,"zone":..,"boss":..,"raid":[names]}]}`.

TOC: `## Interface: 16001`, `## Title: Limpus Attendance`, `## SavedVariables: LimpusAttendanceDB`. Lua behaviour:
- On `ENCOUNTER_END(encounterID, encounterName, difficultyID, groupSize, success)` with `success == 1` and `IsInRaid()`, append `{ t = time(), zone = (GetInstanceInfo()), boss = encounterName, raid = { names from GetRaidRosterInfo(1..GetNumGroupMembers()) } }` and print `Limpus: recorded <boss> (<n> players)`.
- On `ADDON_LOADED` for itself, init `LimpusAttendanceDB = LimpusAttendanceDB or { kills = {} }` and prune kills older than 60 days.
- `/limpus` prints the stored kill count and the date of the last kill. `/limpus export` opens a movable frame with a multiline EditBox holding the JSON, the text selected and focused, and the label "Press Ctrl+C to copy". `/limpus clear` asks for a typed confirmation `clear`, the same pattern Darklight uses.
- JSON string escaping is the same as Darklight's `JStr` (backslash, quote, control characters).
- Reference the Darklight code in `F:\Games\World of Warcraft\_forever_\Interface\AddOns\DarklightLC\Modules\Export.lua` for the frame and EditBox pattern that works on this client. Do not copy or modify the Darklight files.

- [ ] **Step 1: Write the addon files.**
- [ ] **Step 2: Add a Vitest contract test** `test/addon-contract.test.ts`. It reads `test/fixtures/limpus-export.json`, a hand-written sample in the exact format the Lua builds (including a name with `"` escaped and a realm suffix), and asserts that `parseLimpus` accepts it.
- [ ] **Step 3: Run `npx vitest run test/addon-contract.test.ts`.** Expected: PASS.
- [ ] **Step 4: Manual in-game check (the user does this).** Copy the folder to `F:\Games\World of Warcraft\_forever_\Interface\AddOns\`, `/reload`, and confirm that `/limpus` prints `0 kills`, that `/limpus export` shows a valid JSON skeleton, and that after a boss kill in a raid group the kill is recorded. Paste a real export into the local `/admin` import and check that the preview shows it.
- [ ] **Step 5: Commit** `feat: LimpusAttendance addon`

---

### Task 13: Deploy to LoremForever.com

**Files:**
- Modify: `wrangler.jsonc` (real `database_id`, and `routes: [{ pattern: "loremforever.com", custom_domain: true }, { pattern: "www.loremforever.com", custom_domain: true }]`)
- Create: `README.md` (setup, deploy, weekly import routine for officers, addon install)

- [ ] **Step 1:** `npx wrangler d1 create limpus`. Put the id in `wrangler.jsonc`, then run `npx wrangler d1 migrations apply limpus --remote`.
- [ ] **Step 2 (the user does this):** Create a Discord application at discord.com/developers. Add the redirect `https://loremforever.com/auth/callback` (and `http://localhost:8787/auth/callback` for dev). Hand over the client id and secret and your own Discord user id.
- [ ] **Step 3:** For each of the four secrets, run `npx wrangler secret put <NAME>`. `SESSION_SECRET` comes from `openssl rand -hex 32`.
- [ ] **Step 4:** Run `npm test && npm run deploy`.
- [ ] **Step 5: Verify.** `https://loremforever.com/healthz` returns `ok`. Logging in with Discord reaches `/admin`. Import the test fixtures, check the pages, then delete the test nights. Open one item link to confirm that the Wowhead `/forever/item=` URL pattern resolves. If it doesn't, change `ITEM_URL` so items render as plain text.
- [ ] **Step 6: Commit and push** `chore: production deploy config and README`
