import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyInventory } from '../src/agent/library/skills.js';

function fakeBot(items, free) {
    const tossed = [];
    const bot = {
        tossed,
        inventory: {
            items: () => items.filter(i => i.count > 0),
            emptySlotCount: () => free + tossed.length,
        },
        toss: async (type, meta, n) => { const it = items.find(i => i.type === type); it.count -= n; tossed.push([it.name, n]); },
        output: '',
    };
    return bot;
}

test('a nearly full inventory throws away junk and surplus, never ores or tools', async () => {
    const items = [
        {name: 'leaf_litter', type: 1, count: 64}, {name: 'leaf_litter', type: 1, count: 31},
        {name: 'dirt', type: 2, count: 100}, {name: 'iron_ore', type: 3, count: 12},
        {name: 'stone_pickaxe', type: 4, count: 1}, {name: 'sand', type: 5, count: 64}, {name: 'poppy', type: 6, count: 3},
    ];
    const bot = fakeBot(items, 1);
    const n = await tidyInventory(bot);
    assert.ok(n > 0);
    const names = bot.tossed.map(t => t[0]);
    assert.ok(names.includes('leaf_litter'));
    assert.ok(!names.includes('iron_ore') && !names.includes('stone_pickaxe') && !names.includes('sand'));
});

test('enough free slots: nothing is thrown away', async () => {
    const bot = fakeBot([{name: 'leaf_litter', type: 1, count: 64}], 10);
    assert.equal(await tidyInventory(bot), 0);
});
