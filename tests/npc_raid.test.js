import test from 'node:test';
import assert from 'node:assert/strict';
import { illagerResponse, fleePoint, leaveAt, walkTicks, wildShelterAllowed } from '../src/agent/library/raid.js';
import { kitMissing, stashNeeds, stashSurplus } from '../src/agent/library/stash.js';
import { bowTarget } from '../src/agent/library/combat.js';

const P = (d, name = 'pillager') => ({name, d});

test('illagers: armored and armed fights, naked flees once, then leaves the patrol alone', () => {
    const strong = {armor: 4, weapon: true, shield: true, health: 20};
    assert.equal(illagerResponse({...strong, illagers: [P(20), P(25)]}), 'fight');
    assert.equal(illagerResponse({...strong, illagers: [P(40)]}), 'ignore');            // far: no need to run at them
    assert.equal(illagerResponse({...strong, illagers: [P(20, 'ravager')]}), 'flee');    // a ravager is too much
    assert.equal(illagerResponse({...strong, health: 10, illagers: [P(20)]}), 'flee');
    const naked = {armor: 0, weapon: false, shield: false, health: 20};
    assert.equal(illagerResponse({...naked, illagers: [P(30)]}), 'flee');
    assert.equal(illagerResponse({...naked, illagers: [P(30)], fledRecently: true}), 'ignore'); // no flee loop
    assert.equal(illagerResponse({...naked, illagers: [P(12)], fledRecently: true}), 'flee');   // they came close
    assert.equal(illagerResponse({...naked, illagers: [P(30)], homeDist: 30}), 'flee_home');
    assert.equal(illagerResponse({...naked, illagers: []}), 'ignore');
});

test('flee point: far away from the patrol, home when home lies away from it', () => {
    const me = {x: 0, y: 64, z: 0};
    const p = fleePoint(me, [{x: 10, z: 0}]);
    assert.equal(p.home, false);
    assert.ok(p.x <= -60 && Math.abs(p.z) < 2);
    assert.equal(fleePoint(me, [{x: 10, z: 0}], {x: -90, y: 70, z: 20}).home, true);
    assert.equal(fleePoint(me, [{x: 10, z: 0}], {x: 90, y: 70, z: 0}).home, false); // home is behind the patrol
});

test('evening: leave time counts the walk; far away he leaves at noon at the latest', () => {
    assert.equal(walkTicks(100), 1000);
    assert.equal(leaveAt(0), 11200);
    assert.equal(leaveAt(200), 9200);
    assert.equal(leaveAt(2000), 6000);
});

test('no bunker in the wild with a home, except in a real emergency', () => {
    const base = {hasHome: true, homeDist: 150, time: 11000, health: 20, hostileNear: false, armored: false};
    assert.equal(wildShelterAllowed(base), false);
    assert.equal(wildShelterAllowed({...base, hasHome: false}), true);
    assert.equal(wildShelterAllowed({...base, homeDist: 10}), true);         // next to the house
    assert.equal(wildShelterAllowed({...base, health: 6}), true);
    assert.equal(wildShelterAllowed({...base, hostileNear: true}), true);
    assert.equal(wildShelterAllowed({...base, time: 15000}), true);          // night, far, no armor
    assert.equal(wildShelterAllowed({...base, time: 15000, armored: true}), false);
});

test('spare kit: what the village chest lacks', () => {
    assert.deepEqual(kitMissing([]), ['pickaxe', 'weapon', 'food', 'armor']);
    assert.deepEqual(kitMissing([{name: 'stone_pickaxe', count: 1}, {name: 'iron_axe', count: 1}, {name: 'bread', count: 6}, {name: 'leather_boots', count: 1}]), []);
    assert.deepEqual(kitMissing([{name: 'stone_pickaxe', count: 1}, {name: 'bread', count: 2}]), ['weapon', 'food', 'armor']);
});

const mockBot = (items, worn = {}) => {
    const slots = []; for (const [i, n] of Object.entries(worn)) slots[i] = {name: n};
    return {inventory: {items: () => items, slots}, registry: {foodsByName: {bread: {}, cooked_beef: {}}}};
};

test('after a death the chest gives armor for empty slots and the tools that are missing', () => {
    const bot = mockBot([]);
    const take = stashNeeds(bot, [{name: 'iron_chestplate', count: 1}, {name: 'leather_chestplate', count: 1}, {name: 'stone_sword', count: 1}, {name: 'bread', count: 10}]);
    assert.ok(take.some(t => t.name === 'iron_chestplate' && t.wear));
    assert.ok(!take.some(t => t.name === 'leather_chestplate'));
    assert.ok(take.some(t => t.name === 'stone_sword'));
    assert.ok(take.some(t => t.name === 'bread' && t.count === 8));
    const worn = mockBot([], {6: 'iron_chestplate'});
    assert.ok(!stashNeeds(worn, [{name: 'iron_chestplate', count: 1}]).length);
});

test('spare armor in the inventory goes into the chest, worn armor stays', () => {
    const bot = mockBot([{name: 'iron_helmet', count: 1}, {name: 'leather_boots', count: 1}], {5: 'iron_helmet'});
    const out = stashSurplus(bot).map(o => o.name);
    assert.ok(out.includes('iron_helmet'));
    assert.ok(!out.includes('leather_boots'));
});

test('bow against pillagers only from outside crossbow range', () => {
    const bot = {inventory: {items: () => [{name: 'bow'}, {name: 'arrow'}]}, entity: {position: {x: 0, y: 64, z: 0}}};
    const at = d => ({name: 'pillager', position: {x: d, y: 64, z: 0, distanceTo: o => Math.hypot(d - o.x, 64 - o.y, 0 - o.z)}});
    assert.equal(bowTarget(bot, at(10)), false);
    assert.equal(bowTarget(bot, at(20)), true);
});

import { dangerStepCost, markIllagers } from '../src/agent/library/danger.js';
import { parseTip, ruleText } from '../src/agent/library/tips.js';

test('danger zone: from inside only steps further in cost, so the path search finds the way out', () => {
    const bot = {entity: {position: {x: 20, y: 64, z: 0}}};
    markIllagers(bot, [{name: 'pillager', position: {x: 0, y: 64, z: 0}}], 1000);
    const at = (x, z) => ({position: {x, y: 64, z}});
    assert.equal(dangerStepCost(bot, at(25, 0), 2000), 0);    // away from the center: free
    assert.equal(dangerStepCost(bot, at(10, 0), 2000), 200);  // deeper in: expensive
    bot.entity.position = {x: 100, y: 64, z: 0};               // outside: the zone is avoided
    assert.equal(dangerStepCost(bot, at(40, 0), 2000), 200);
    assert.equal(dangerStepCost(bot, at(60, 0), 2000), 0);
});

test('tips: "kannst du dir merken dass" and "merk dir dabei dass" (HiImCheeZy, 18.11.)', () => {
    assert.deepEqual(parseTip('kannst du dir merken dass du den ganzen Baum abbaust'), {kind: 'tip', text: 'dass du den ganzen Baum abbaust'});
    assert.equal(ruleText(parseTip('Merk dir dabei dass du die Blätter nicht abbauen musst.').text), 'du die Blätter nicht abbauen musst.');
});

test('tips: "kannst du das nächste mal ..." inside a longer line', () => {
    const p = parseTip('perfekt, aber kannst du das nächste mal wenn du Bäume fällst die Erde wieder entfernen?');
    assert.equal(p.kind, 'tip');
    assert.equal(p.text, 'wenn du Bäume fällst die Erde wieder entfernen');
    assert.equal(parseTip('bis zum nächsten mal'), null);
});
