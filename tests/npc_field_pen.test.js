import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { ripeCrops, cropAge } from '../src/agent/commands/tools/harvestField.js';
import { planPen } from '../src/agent/commands/tools/buildPen.js';

test('only ripe crops are harvested', () => {
    const crops = new Map([['1,64,0', {name: 'wheat', metadata: 7}], ['2,64,0', {name: 'wheat', metadata: 3}], ['0,64,1', {name: 'beetroots', metadata: 3}], ['0,64,2', {name: 'carrots', metadata: 6}]]);
    const bot = {blockAt: p => { const c = crops.get(`${p.x},${p.y},${p.z}`); return c ? {...c, position: p} : {name: 'air', position: p}; }};
    const ripe = ripeCrops(bot, new Vec3(0, 64, 0), 3).map(b => `${b.name}@${b.position.x},${b.position.z}`);
    assert.deepEqual(ripe.sort(), ['beetroots@0,1', 'wheat@1,0']);
    assert.equal(cropAge({getProperties: () => ({age: 5})}), 5);
});

test('a pen is a closed fence ring with one gate', () => {
    const plan = planPen(new Vec3(0, 64, 0), 6);
    assert.equal(plan.fences.length + 1, 20);
    assert.ok(!plan.fences.some(q => q.x === plan.gate.x && q.z === plan.gate.z));
});

test('pen site: a flat meadow needs no work, a step is levelled to the middle height', async () => {
    const { findPenSite, standY } = await import('../src/agent/commands/tools/buildPen.js');
    const ground = (x, z) => (x >= 20 ? 65 : 64); // a one-block step at x = 20
    const bot = {
        entity: {position: new Vec3(0, 65, 0)},
        game: {dimension: 'overworld'},
        blockAt: p => p.y < ground(p.x, p.z) ? {name: 'grass_block', boundingBox: 'block', position: p} : {name: 'air', boundingBox: 'empty', position: p},
    };
    assert.equal(standY(bot, 0, 0, 65), 64);
    const site = findPenSite(bot, 9, 6);
    assert.equal(site.work, 0);
    const step = findPenSite({...bot, entity: {position: new Vec3(17, 65, 0)}}, 9, 0);
    assert.ok(step.work > 0);
});
