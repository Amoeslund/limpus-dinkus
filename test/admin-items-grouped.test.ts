import { expect, it } from 'vitest';
import type { ItemRow } from '../src/db/admin';
import { ItemsPage } from '../src/views/admin-manage';

const item = (itemId: number, name: string, instance: string): ItemRow => ({ itemId, name, instance, drops: 1 });

it('groups items under one heading per instance, alphabetical, with unassigned items last', () => {
  const html = ItemsPage({ q: '', items: [
    item(1, 'Talisman of Ephemeral Power', 'Molten Core'),
    item(2, 'Bloodcaller', "Zul'Gurub"),
    item(3, 'Mystery Ring', ''),
    item(4, "Neltharion's Tear", 'Blackwing Lair'),
    item(5, 'Choker of the Fire Lord', 'Molten Core'),
  ] }).toString();
  const at = (s: string) => html.indexOf(s);
  const heads = ['<h3>Blackwing Lair <span class="alt">1 item</span></h3>', '<h3>Molten Core <span class="alt">2 items</span></h3>',
    '<h3>Zul&#39;Gurub <span class="alt">1 item</span></h3>', '<h3>No instance <span class="alt">1 item</span></h3>'];
  heads.forEach((h) => expect(at(h)).toBeGreaterThan(-1));
  expect(at(heads[0])).toBeLessThan(at(heads[1]));
  expect(at(heads[1])).toBeLessThan(at(heads[2]));
  expect(at(heads[2])).toBeLessThan(at(heads[3]));
  // Items sit under their own instance.
  expect(at('Choker of the Fire Lord')).toBeGreaterThan(at(heads[1]));
  expect(at('Choker of the Fire Lord')).toBeLessThan(at(heads[2]));
  expect(at('Mystery Ring')).toBeGreaterThan(at(heads[3]));
});
