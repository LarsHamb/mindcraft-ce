import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { deathRecoverable, stashSurplus, stashNeeds } from '../src/agent/library/stash.js';
import { seedItem, fieldPlan } from '../src/agent/commands/tools/makeField.js';
import { BREED_FOOD } from '../src/agent/commands/tools/breedAnimals.js';

const foods = {bread: {}, cooked_beef: {}, beef: {}, apple: {}, rotten_flesh: {}};
const inv = items => ({registry: {foodsByName: foods}, inventory: {items: () => items}});

test('death causes: creeper, fall and mobs are recoverable; lava, fire and the void are not', () => {
    assert.equal(deathRecoverable('CheesyNPC was blown up by Creeper'), true);
    assert.equal(deathRecoverable('CheesyNPC fell from a high place'), true);
    assert.equal(deathRecoverable('CheesyNPC was slain by Zombie'), true);
    assert.equal(deathRecoverable('CheesyNPC tried to swim in lava'), false);
    assert.equal(deathRecoverable('CheesyNPC burned to death'), false);
    assert.equal(deathRecoverable('CheesyNPC fell out of the world'), false);
    assert.equal(deathRecoverable('CheesyNPC died', 'overworld', -80), false);
});

test('stash store keeps 8 food (raw goes first) and the best tool of each kind', () => {
    const bot = inv([{name: 'beef', count: 6}, {name: 'bread', count: 6}, {name: 'stone_pickaxe', count: 1},
        {name: 'iron_pickaxe', count: 1}, {name: 'wooden_axe', count: 1}, {name: 'rotten_flesh', count: 9}]);
    const out = stashSurplus(bot);
    assert.deepEqual(out.find(o => o.name === 'beef'), {name: 'beef', count: 4});
    assert.ok(!out.some(o => o.name === 'bread'));
    assert.ok(out.some(o => o.name === 'stone_pickaxe'));
    assert.ok(!out.some(o => o.name === 'iron_pickaxe' || o.name === 'wooden_axe'));
    // loot like rotten flesh goes into the base chest too (18.11.)
    assert.deepEqual(out.find(o => o.name === 'rotten_flesh'), {name: 'rotten_flesh', count: 9});
});

test('stash take refills food to 8 (cooked first) and brings only missing tool kinds', () => {
    const bot = inv([{name: 'apple', count: 2}, {name: 'wooden_sword', count: 1}]);
    const chest = [{name: 'beef', count: 10}, {name: 'bread', count: 4}, {name: 'stone_pickaxe', count: 1},
        {name: 'iron_pickaxe', count: 1}, {name: 'iron_sword', count: 1}];
    const take = stashNeeds(bot, chest);
    assert.deepEqual(take.find(t => t.name === 'bread'), {name: 'bread', count: 4});
    assert.deepEqual(take.find(t => t.name === 'beef'), {name: 'beef', count: 2});
    assert.deepEqual(take.find(t => t.name.endsWith('pickaxe')), {name: 'iron_pickaxe', count: 1});
    assert.ok(!take.some(t => t.name.endsWith('sword')));
});

test('seeds and breeding food', () => {
    assert.equal(seedItem('wheat'), 'wheat_seeds');
    assert.equal(seedItem('Kartoffel'), null);
    assert.equal(seedItem('potatoes'), 'potato');
    assert.deepEqual(BREED_FOOD.cow, ['wheat']);
    assert.ok(BREED_FOOD.chicken.includes('wheat_seeds'));
});

test('field plan: grass beside still water, not in protected areas, nearest to the water first', () => {
    const water = new Vec3(10, 63, 10);
    const blocks = new Map();
    const at = (x, y, z) => blocks.get(`${x},${y},${z}`);
    for (let x = 4; x <= 16; x++) for (let z = 4; z <= 16; z++) {
        blocks.set(`${x},63,${z}`, {name: 'grass_block'});
        blocks.set(`${x},64,${z}`, {name: x === 11 && z === 10 ? 'oak_log' : 'short_grass'});
    }
    blocks.set('10,63,10', {name: 'water', metadata: 0, position: water});
    const bot = {
        game: {dimension: 'overworld'},
        entity: {position: new Vec3(10, 64, 14)},
        blockAt: p => at(p.x, p.y, p.z) ? {...at(p.x, p.y, p.z), position: p} : {name: 'air', position: p},
    };
    // world.getNearestBlocksWhere walks the area around the bot; give it a tiny fake via bot.findBlocks
    bot.findBlocks = ({matching, maxDistance, count}) => [water].filter(p => matching(bot.blockAt(p)));
    const plan = fieldPlan(bot, 7);
    assert.equal(plan.length, 7);
    assert.ok(plan.every(s => Math.max(Math.abs(s.pos.x - 10), Math.abs(s.pos.z - 10)) <= 1));
    assert.ok(!plan.some(s => s.pos.x === 11 && s.pos.z === 10), 'a log above blocks the spot');
});
