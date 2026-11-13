export const TZ = 'Europe/Copenhagen';
export const CUTOFF_HOUR = 6;
export const STALE_IMPORT_DAYS = 7;
/** EPGP Forever settings. These must match the guild's EPGP Forever settings, or PR on the site differs from the game. */
export const EPGP_BASE_GP = 100;
export const EPGP_MIN_EP = 1000;
/**
 * Forever armory roster. There is no public API for Forever guilds, so this uses the armory page's own GraphQL
 * persisted query (GetGuildRoster). The hash comes from the armory's guild-profile JS bundle; if Blizzard changes
 * the query, polling fails with PersistedQueryNotFound and the hash must be updated from the new bundle.
 */
export const ARMORY = {
  url: 'https://worldofwarcraft.blizzard.com/en-us/graphql',
  referer: 'https://worldofwarcraft.blizzard.com/en-us/forever/eu/armory/guild/lorem-forever',
  nameSlug: 'lorem-forever',
  region: 'eu',
  rosterHash: '5f32b85faa248d321a08645d470fb38b82be64b9abd8b5b5fd2816620546794b',
};
/** Max character level on WoW Forever; the roster marks members below it who stopped levelling. */
export const MAX_LEVEL = 60;
export const ITEM_URL = (id: number) => `https://www.wowhead.com/forever/item=${id}`;
