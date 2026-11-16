import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { readFileSync } from 'node:fs';
import settings from '../src/agent/settings.js';
import { detectTree } from '../src/agent/library/natural_tree.js';
import { breakRefusal, harvestRefusal, isHarvestableLog, protectedAreaAt, detectBuiltAreas, detectBeds, pruneBuiltAreas, BUILDING,
    restoreEntryFor, addRestore, dueRestores, restoreList } from '../src/agent/library/protection.js';

let botId = 0;
function world() {
    const blocks = new Map();
    const k = (x, y, z) => `${x},${y},${z}`;
    const set = (x, y, z, name) => blocks.set(k(x, y, z), name);
    const bot = {
        username: `ProtTest${++botId}-${process.pid}`,
        game: {dimension: 'overworld'},
        blockAt(p) {
            const name = blocks.get(k(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) || 'air';
            return {name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), skyLight: 15,
                boundingBox: /^(air|cave_air|short_grass|water)$/.test(name) ? 'empty' : 'block'};
        },
        findBlocks({matching, maxDistance, count}) {
            const out = [];
            for (const [key, name] of blocks) {
                const [x, y, z] = key.split(',').map(Number);
                if (matching({name}) && out.length < count) out.push(new Vec3(x, y, z));
            }
            return out;
        },
    };
    // ground
    for (let x = -10; x <= 20; x++) for (let z = -10; z <= 10; z++) set(x, 0, z, 'grass_block');
    return {bot, set};
}

function oakTree(set, x, z) {
    for (let y = 1; y <= 5; y++) set(x, y, z, 'oak_log');
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 4; y <= 6; y++)
        if (dx || dz || y === 6) set(x + dx, y, z + dz, 'oak_leaves');
}

test('a natural tree is harvestable', () => {
    settings.protected_areas = [];
    const {bot, set} = world();
    oakTree(set, 0, 0);
    assert.ok(detectTree(bot, {x: 0, y: 1, z: 0}, n => BUILDING.test(n)));
    assert.equal(isHarvestableLog(bot, bot.blockAt(new Vec3(0, 3, 0))), true);
});

test('a log wall touching a tree is not part of the tree', () => {
    settings.protected_areas = [];
    const {bot, set} = world();
    oakTree(set, 0, 0);
    // cabin wall of oak logs right next to the trunk: x 1..6 at z 0, height 1..3
    for (let x = 1; x <= 6; x++) for (let y = 1; y <= 3; y++) set(x, y, 0, 'oak_log');
    assert.equal(detectTree(bot, {x: 4, y: 2, z: 0}, n => BUILDING.test(n)), null);
    assert.match(breakRefusal(bot, bot.blockAt(new Vec3(4, 2, 0))) || '', /not part of a natural tree/);
});

test('a log touching planks is a house beam', () => {
    settings.protected_areas = [];
    const {bot, set} = world();
    for (let y = 1; y <= 4; y++) set(10, y, 0, 'oak_log');
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(10 + dx, 5, dz, 'oak_leaves');
    for (let y = 2; y <= 4; y++) set(11, y, 0, 'oak_planks');
    assert.ok(breakRefusal(bot, bot.blockAt(new Vec3(10, 3, 0))));
});

test('foreign building blocks are never broken; protected areas refuse', () => {
    settings.protected_areas = [{name: 'Lars Haus', x: 100, z: 100, radius: 10}];
    const {bot, set} = world();
    set(2, 1, 2, 'oak_planks');
    assert.match(breakRefusal(bot, bot.blockAt(new Vec3(2, 1, 2))) || '', /player-built/);
    assert.equal(protectedAreaAt(bot, {x: 105, y: 64, z: 98})?.name, 'Lars Haus');
    assert.equal(protectedAreaAt(bot, {x: 130, y: 64, z: 98}), null);
    // natural blocks inside a protected area may be broken (and are put back), but never harvested
    assert.equal(breakRefusal(bot, {name: 'stone', position: new Vec3(104, 60, 101)}), null);
    assert.match(harvestRefusal(bot, {name: 'stone', position: new Vec3(104, 60, 101)}) || '', /protected area "Lars Haus"/);
    // way out: trapped inside the area, natural blocks right next to the bot are allowed, planks never
    bot.entity = {position: new Vec3(104.5, 60, 101.5)};
    assert.equal(breakRefusal(bot, {name: 'stone', position: new Vec3(105, 61, 101)}), null);
    assert.match(harvestRefusal(bot, {name: 'stone', position: new Vec3(108, 61, 101)}) || '', /protected area/);
    set(104, 61, 102, 'oak_planks');
    assert.match(breakRefusal(bot, bot.blockAt(new Vec3(104, 61, 102))) || '', /player-built/);
    delete bot.entity;
    assert.equal(breakRefusal(bot, {name: 'stone', position: new Vec3(0, 0, 0)}), null);
});

test('every bed protects radius 40, also in villages', () => {
    settings.protected_areas = [];
    const {bot, set} = world();
    set(5, 1, 5, 'red_bed'); set(5, 1, 6, 'red_bed');
    bot.entities = {};
    const area = detectBeds(bot);
    assert.equal(area?.radius, 40);
    assert.ok(protectedAreaAt(bot, {x: 40, y: 1, z: 5}));
    // bed gone -> area gone
    set(5, 1, 5, 'air'); set(5, 1, 6, 'air');
    assert.equal(pruneBuiltAreas(bot), 1);
    assert.equal(protectedAreaAt(bot, {x: 40, y: 1, z: 5}), null);
    // the saved file follows (a pruned area must not come back after a restart)
    assert.deepEqual(JSON.parse(readFileSync(`./bots/${bot.username}/built_areas.json`, 'utf8')), []);

    const v = world();
    v.set(-5, 1, -5, 'white_bed'); v.set(-5, 1, -4, 'white_bed'); v.set(-2, 1, -8, 'bell');
    v.bot.entities = {};
    assert.ok(detectBeds(v.bot)); // village beds count too (Lars, 17.11.)
    const w = world();
    w.set(-5, 1, -5, 'white_bed');
    w.bot.entities = {1: {name: 'villager', position: new Vec3(-10, 1, -3)}};
    assert.ok(detectBeds(w.bot));
});

test('a cluster of foreign building blocks becomes a protected area', () => {
    settings.protected_areas = [];
    const {bot, set} = world();
    for (let x = 0; x < 3; x++) for (let y = 1; y <= 3; y++) set(x, y, 5, 'cobblestone_wall');
    const area = detectBuiltAreas(bot);
    assert.ok(area);
    assert.ok(protectedAreaAt(bot, {x: 1, y: 2, z: 7}));
});

test('restore list: surface holes (top layer), zone blocks and saplings, not wanted material', () => {
    settings.protected_areas = [{name: 'Zone', x: 100, z: 100, radius: 10}];
    const {bot, set} = world();
    // surface dirt broken by the way -> listed, filled with dirt; the block below it is not listed again
    const top = restoreEntryFor(bot, {name: 'grass_block', position: new Vec3(3, 0, 3), boundingBox: 'block'});
    assert.equal(top.kind, 'surface');
    assert.equal(top.items[0], 'dirt');
    assert.ok(!top.items.includes('cobblestone'));
    addRestore(bot, top);
    set(3, 0, 3, 'air');
    assert.equal(restoreEntryFor(bot, {name: 'dirt', position: new Vec3(3, -1, 3), boundingBox: 'block'}), null);
    // underground (no sky above) -> not listed
    set(6, 1, 6, 'stone');
    assert.equal(restoreEntryFor(bot, {name: 'dirt', position: new Vec3(6, 0, 6), boundingBox: 'block'}), null);
    // material it set out to collect -> not listed
    bot.__intentionalDig = '8,0,8';
    assert.equal(restoreEntryFor(bot, {name: 'grass_block', position: new Vec3(8, 0, 8), boundingBox: 'block'}), null);
    bot.__intentionalDig = null;
    // stairs/shelter in progress -> not listed
    bot.__noRestore = true;
    assert.equal(restoreEntryFor(bot, {name: 'grass_block', position: new Vec3(9, 0, 9), boundingBox: 'block'}), null);
    bot.__noRestore = false;
    // inside a protected area, also underground
    const z = restoreEntryFor(bot, {name: 'stone', position: new Vec3(101, 40, 100), boundingBox: 'block'});
    assert.equal(z.kind, 'zone');
    // tree base on soil -> sapling
    const sap = restoreEntryFor(bot, {name: 'birch_log', position: new Vec3(-3, 1, -3), boundingBox: 'block'});
    assert.equal(sap.kind, 'sapling');
    assert.equal(sap.name, 'birch_sapling');
    // due: hole open, item in inventory, bot not standing in it
    bot.entity = {position: new Vec3(0.5, 1, 0.5)};
    bot.inventory = {findInventoryItem: n => (n === 'dirt' ? {name: 'dirt'} : null)};
    assert.deepEqual(dueRestores(bot).map(e => e.kind), ['surface']);
    bot.entity = {position: new Vec3(3.5, 0, 3.5)}; // standing in the hole
    assert.equal(dueRestores(bot).length, 0);
    // filled by someone else -> dropped from the list
    set(3, 0, 3, 'dirt');
    dueRestores(bot);
    assert.equal(restoreList(bot).length, 0);
});
