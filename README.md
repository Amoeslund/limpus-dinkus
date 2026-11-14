# Limpus Dinkus

Guild site for the Limpus Dinkus raid group, served at <https://loremforever.com>. It shows raid attendance, loot awards and each player's EPGP standing (EP, GP and PR = EP ÷ (GP + 100 base GP), shown as 0 below 1000 EP, as in EPGP Forever). Officers feed it by pasting exports after each raid: loot history from the Darklight addon, attendance from the LimpusAttendance addon, and the standings CSV from EPGP Forever. The site does not calculate EPGP; EPGP Forever (decay, base GP, min EP) is the source of truth. It is a Cloudflare Worker (Hono, server-side JSX) with a D1 database.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in the values
npm run db:migrate:local
npm run dev                      # http://localhost:8787
npm test
```

## One-time production setup

1. Create a Cloudflare API token from the "Edit Cloudflare Workers" template and add D1 Edit permission. In the GitHub repo settings (Secrets and variables, Actions) add:
   - `CLOUDFLARE_API_TOKEN`: the token
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account id
2. Create the database: `npx wrangler d1 create limpus`. Paste the returned `database_id` into `wrangler.jsonc` (it currently holds a placeholder) and commit it.
3. Create a Discord application at <https://discord.com/developers>. Add these redirects:
   - `https://loremforever.com/auth/callback`
   - `http://localhost:8787/auth/callback`
4. Store the secrets in the Worker, one command each:
   ```sh
   npx wrangler secret put DISCORD_CLIENT_ID
   npx wrangler secret put DISCORD_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET      # value from: openssl rand -hex 32
   npx wrangler secret put BOOTSTRAP_ADMIN_ID  # your Discord user id
   ```
5. Merge to `main` and push. Check that the GitHub Actions run is green, then open `https://loremforever.com/healthz`. It should return `ok`.

## Auto-deploy

`.github/workflows/deploy.yml` runs on every push to `main` and on pull requests. Tests run first (`npm ci`, `npm test`). Pull requests stop there. On `main`, if the tests pass, the workflow applies D1 migrations (`wrangler d1 migrations apply limpus --remote`) and then runs `wrangler deploy`. A `deploy-production` concurrency group keeps two deploys from running at once.

## Weekly officer routine

After each raid:

1. In game run `/dlc export` and choose "Darklight Web (JSON)". Copy the text with Ctrl+C.
2. Run `/limpus export` and copy that text too.
3. Export the standings from EPGP Forever's CSV tools (standings export, `Name,Class,EP,GP`) and copy the CSV.
4. Log in on `/admin` with Discord and paste the exports into their boxes. Any box can be left empty.
5. Check the preview, pick the instances, untick pug nights (they then count for nothing), and save.

The EPGP standings are a snapshot: each upload replaces the previous standings completely, and the public pages show when they were imported. The CSV lists the whole guild roster, so it never creates characters: standings only show for characters the site already knows from raids or loot. Export the standings at least once a week (after decay) so PR on the site matches the game. Base GP and min EP are set in `src/config.ts` (`EPGP_BASE_GP`, `EPGP_MIN_EP`); change them there if the guild changes its EPGP Forever settings.

Import at least once a week. Darklight keeps only its latest 100 items, so older awards are lost if you wait. The admin page warns when the last import is more than 7 days old.

## LimpusAttendance addon

Download `LimpusAttendance-vX.Y.Z.zip` from the [latest release](https://github.com/Amoeslund/limpus-dinkus/releases/latest) and unzip it into `World of Warcraft\_forever_\Interface\AddOns\`, so you get `AddOns\LimpusAttendance\`. Then `/reload`. Only the person recording attendance needs it.

To publish a new addon version: push a tag, e.g. `git tag v1.0.1 && git push origin v1.0.1`. The release workflow zips `addon/LimpusAttendance` and attaches it to a GitHub release.

Only one person should run LimpusAttendance per raid. Kills recorded by two people are counted twice. Players who are offline at a kill are not recorded; add them on the Nights page if needed. Benched players can be marked there too (or ticked when adding a night by hand); a bench counts as attendance, shown as ◇.

- `/limpus` shows the stored kill count and the date of the last kill.
- `/limpus export` opens a window with the JSON to copy for `/admin`.
- `/limpus clear` deletes stored kills after you type `clear`.

Kills older than 60 days are pruned automatically.

## Guild roster (`/admin/roster`)

Officer-only page for checking that raiders are still levelling. Two sources feed it:

- **Armory poll** (every 3 hours, Worker cron `17 */3 * * *`): level, class and rank for every member, from the Forever armory. Each level change is stored, so the page shows levels gained in the last 7 days and flags members below max level who stopped. There is no public API for Forever guilds, so this uses the armory page's own GraphQL persisted query (`ARMORY` in `src/config.ts`). If Blizzard changes it, the page shows a red "Armory polling failed" banner and the hash must be updated from the armory's `guild-profile.*.js` bundle. "Poll armory now" runs it by hand.
- **Guild Pulse addon** (optional, any officer): in game `/gpulse`, then **Export for site**, and paste the JSON into the box on the roster page. It adds last online, time seen online in the last 7 days and the average per day. Guild Pulse copies share their data over the guild addon channel (prefix `GPulse`), so one report covers everything any of them saw. Playtime only counts while at least one Guild Pulse user was online, so it is a lower bound. Reports from several officers merge: last online keeps the newest value.

- **Gear poll** (every hour, Worker cron `47 * * * *`, `src/db/gear.ts`): fetches the armory character pages of the 15 members (level 10+) whose gear is oldest, so the whole guild cycles every few hours. The page embeds its data as `var characterProfileInitialState = {...}`; the Worker reads equipped items, average item level and the armory's "last updated" time (it changes at logout, so it also feeds Last online). The first fetch per member is the baseline; items seen later count as new. The armory item context tells where an item came from: 1 = dungeon drop, 3-6 = raid, 11 = quest/crafted. "Poll gear now" runs one batch by hand. Click a member's name for their gear page.
- **Dungeon/raid time** (Guild Pulse 1.3+): the addon reads each online member's zone from the guild roster every minute and keeps dungeon and raid minutes the same way as online time. Reports from older versions show dungeon time as unknown.

**Effort score** (0-100, last 7 days, outside raids, `effortScore` in `src/domain/gear.ts`): dungeon time (4 h = 40), new non-raid gear and item level gain (max 25), online time outside raid zones (10 h = 20) and levels gained below max level (max 15). Below level 55 (`EFFORT_GEAR_LEVEL`) only levelling counts: 3 levels in 7 days = 100, blank until there are 7 days of level history. Parts with no data are left out and the rest is scaled to 100. "raid-logger?" marks members with 1 h+ in raids but under 1 h online elsewhere, under 30 min in dungeons and no new gear.

Rank names come from Guild Pulse reports; until one is imported, ranks show as numbers.

### Guild Pulse download

The officer-only `/admin/addons` page offers `public/officer/GuildPulse.zip` with the screenshot `public/officer/guildpulse.webp`. Everything under `public/officer/` is routed through the Worker (`run_worker_first`) and needs an officer login. The addon source is in `addon/GuildPulse` (developed in the Wow Forever project). After changing it, rebuild the zip so the download matches: from `addon/`, zip the `GuildPulse` folder to `public/officer/GuildPulse.zip`.
