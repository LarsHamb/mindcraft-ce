import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import settings from '../src/agent/settings.js';
import { setHome, getHome, inHomeVillage, inHomeHouse, villageCare, isGroundHole, protectedAreaAt, detectBeds } from '../src/agent/library/protection.js';
import { chooseFreeBed, findVillage, bedsAround, groundHoles, darkSpots, isNight } from '../src/agent/library/village.js';

let botId = 0;
function world() {
    const blocks = new Map(), propsOf = new Map();
    const k = (x, y, z) => `${x},${y},${z}`;
    const set = (x, y, z, name, props) => { blocks.set(k(x, y, z), name); if (props) propsOf.set(k(x, y, z), props); };
    const bot = {
        username: `VillTest${++botId}-${process.pid}`,
        game: {dimension: 'overworld'},
        entity: {position: new Vec3(0, 1, 0)},
        entities: {},
        time: {timeOfDay: 6000},
        blockAt(p) {
            const kk = k(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
            const name = blocks.get(kk) || 'air';
            const pr = propsOf.get(kk) || {};
            return {name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), skyLight: 15, light: 0,
                getProperties: () => pr,
                boundingBox: /^(air|cave_air|short_grass|water|wheat|torch)$/.test(name) || /_bed$/.test(name) ? 'empty' : 'block'};
        },
        findBlocks({matching, count}) {
            const out = [];
            for (const [key, name] of blocks) {
                const [x, y, z] = key.split(',').map(Number);
                if (matching({name}) && out.length < count) out.push(new Vec3(x, y, z));
            }
            return out;
        },
    };
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) set(x, 0, z, 'grass_block');
    return {bot, set, blocks};
}
const villager = (x, z, sleeping = false) => ({pos: new Vec3(x, 1, z), sleeping});

test('at night a bed nobody sleeps in is chosen, an occupied one never', () => {
    const beds = [{pos: new Vec3(5, 1, 0), occupied: true}, {pos: new Vec3(-5, 1, 0), occupied: false}];
    const pick = chooseFreeBed(beds, [villager(5, 0, true)], true, new Vec3(0, 1, 0));
    assert.deepEqual(pick.bed.pos, new Vec3(-5, 1, 0));
    assert.equal(pick.sure, true);
    assert.equal(chooseFreeBed([beds[0]], [], true, new Vec3(0, 1, 0)), null);
});

test('by day it guesses: spare bed away from villagers, and says to check at night', () => {
    const beds = [{pos: new Vec3(2, 1, 0), occupied: false}, {pos: new Vec3(10, 1, 0), occupied: false}, {pos: new Vec3(20, 1, 0), occupied: false}];
    const pick = chooseFreeBed(beds, [villager(2, 1), villager(3, 0)], false, new Vec3(0, 1, 0));
    assert.deepEqual(pick.bed.pos, new Vec3(10, 1, 0));
    assert.equal(pick.sure, false);
    assert.match(pick.note, /more than villagers/);
    const full = chooseFreeBed(beds, [villager(30, 0), villager(31, 0), villager(32, 0)], false, new Vec3(0, 1, 0));
    assert.match(full.note, /maybe taken/);
});

test('the old bed is avoided when re-choosing', () => {
    const beds = [{pos: new Vec3(5, 1, 0), occupied: false}, {pos: new Vec3(9, 1, 0), occupied: false}];
    const pick = chooseFreeBed(beds, [], true, new Vec3(0, 1, 0), [new Vec3(5, 1, 0)]);
    assert.deepEqual(pick.bed.pos, new Vec3(9, 1, 0));
});

test('village found by its bell, bed heads only', () => {
    const {bot, set} = world();
    set(12, 1, 3, 'bell');
    set(15, 1, 3, 'red_bed', {part: 'head', occupied: false});
    set(16, 1, 3, 'red_bed', {part: 'foot', occupied: false});
    const v = findVillage(bot);
    assert.equal(v.by, 'bell');
    assert.deepEqual(v.center, new Vec3(12, 1, 3));
    assert.equal(bedsAround(bot, v.center).length, 1);
});

test('home village allows care work but not building', () => {
    settings.protected_areas = [];
    const {bot, set} = world();
    set(0, 1, 0, 'bell');
    set(6, 1, 0, 'white_bed', {part: 'head'});
    set(10, 0, 10, 'farmland');
    set(-4, 1, 4, 'oak_planks');
    detectBeds(bot);
    assert.ok(protectedAreaAt(bot, new Vec3(3, 1, 3)), 'the village is protected');
    // not its home yet: nothing allowed
    assert.equal(villageCare(bot, new Vec3(3, 1, 3), 'torch'), null);
    setHome(bot, {bell: {x: 0, y: 1, z: 0}, bed: {x: 6, y: 1, z: 0}});
    assert.ok(getHome(bot)?.bed);
    assert.ok(inHomeVillage(bot, new Vec3(30, 1, 30)));
    assert.equal(inHomeVillage(bot, new Vec3(60, 1, 0)), false);
    assert.equal(villageCare(bot, new Vec3(3, 1, 3), 'torch'), 'torch');
    assert.equal(villageCare(bot, new Vec3(10, 1, 10), 'wheat_seeds'), 'sowing');
    assert.equal(villageCare(bot, new Vec3(3, 1, 3), 'wheat_seeds'), null, 'seeds only on farmland');
    assert.equal(villageCare(bot, new Vec3(3, 1, 3), 'oak_planks'), null, 'no building');
    assert.equal(villageCare(bot, new Vec3(3, 1, 3), 'dirt'), null, 'flat ground is no hole');
    assert.ok(inHomeHouse(bot, new Vec3(8, 1, 2)));
    assert.equal(villageCare(bot, new Vec3(8, 1, 2), 'chest'), 'own chest');
    assert.equal(villageCare(bot, new Vec3(20, 1, 20), 'chest'), null, 'chest only in its house');
    setHome(bot, null);
});

test('holes in the ground are found and may be filled; not next to houses', () => {
    settings.protected_areas = [];
    const {bot, set, blocks} = world();
    setHome(bot, {bell: {x: 0, y: 1, z: 0}, bed: {x: 6, y: 1, z: 0}});
    // ground level is y 0; make the surface y 1 dirt so a missing block is a hole
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) set(x, 1, z, 'dirt');
    blocks.delete('4,1,4');
    blocks.delete('-3,1,-3');
    set(-2, 1, -3, 'oak_planks');
    assert.equal(isGroundHole(bot, new Vec3(4, 1, 4)), true);
    assert.equal(isGroundHole(bot, new Vec3(-3, 1, -3)), false, 'next to a house wall it is part of the house');
    assert.equal(villageCare(bot, new Vec3(4, 1, 4), 'dirt'), 'hole');
    const holes = groundHoles(bot, new Vec3(0, 1, 0), 8);
    assert.ok(holes.some(p => p.x === 4 && p.y === 1 && p.z === 4));
    setHome(bot, null);
});

test('dark spots skip places near light', () => {
    const {bot, set} = world();
    set(0, 1, 0, 'torch');
    const spots = darkSpots(bot, new Vec3(0, 1, 0), 16, 8);
    assert.ok(spots.length > 0);
    assert.ok(spots.every(p => Math.abs(p.x) > 7 || Math.abs(p.z) > 7));
});

test('night detection', () => {
    assert.equal(isNight({time: {timeOfDay: 13000}}), true);
    assert.equal(isNight({time: {timeOfDay: 6000}}), false);
    assert.equal(isNight({time: {timeOfDay: 6000}, thunderState: 1}), true);
});
