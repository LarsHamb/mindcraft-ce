import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { situation, timeText } from '../src/agent/library/situation.js';

function bot(extra = {}) {
    return {
        username: `SitTest-${process.pid}`, game: {dimension: 'overworld'},
        entity: {position: new Vec3(0, 64, 0)}, health: 6, food: 5, time: {timeOfDay: 11500},
        entities: {1: {name: 'zombie', position: new Vec3(5, 64, 0)}, 2: {name: 'zombie', position: new Vec3(-4, 64, 2)},
            3: {name: 'creeper', position: new Vec3(0, 64, 9)}, 4: {name: 'cow', position: new Vec3(2, 64, 2)}, 5: {name: 'skeleton', position: new Vec3(60, 64, 0)}},
        inventory: {items: () => [{name: 'wooden_sword', count: 1}, {name: 'stone_sword', count: 1}, {name: 'mutton', count: 2}], slots: []},
        registry: {foodsByName: {mutton: {}}},
        players: {HiImCheeZy: {username: 'HiImCheeZy', entity: {position: new Vec3(10, 64, 0)}}},
        blockAt: () => ({skyLight: 15}),
        ...extra,
    };
}

test('the situation line shows health, time, danger, gear, food, place, deaths and people', () => {
    const s = situation({bot: bot(), recentDeaths: [Date.now() - 60000, Date.now() - 1000], actions: {currentActionLabel: 'action:collectBlocks'}});
    assert.match(s, /Leben 6\/20, Hunger 5\/20/);
    assert.match(s, /Abend, Nacht in 1 min/);
    assert.match(s, /2 zombie, 1 creeper/);
    assert.doesNotMatch(s, /cow|skeleton/);
    assert.match(s, /Ruestung: keine, Waffe: stone_sword/);
    assert.match(s, /Essen: 2/);
    assert.match(s, /noch kein Zuhause/);
    assert.match(s, /2x gestorben/);
    assert.match(s, /nah: HiImCheeZy/);
    assert.match(s, /laeuft: collectBlocks/);
    assert.ok(s.length < 400, s);
});

test('dead means plan nothing', () => {
    assert.match(situation({bot: bot({health: 0})}), /TOT/);
});

test('time of day in words', () => {
    assert.match(timeText(1000), /^Tag \(Nacht in 10 min\)/);
    assert.match(timeText(18000), /^Nacht \(Morgen in 5 min\)/);
});
