import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { markIllagers, dangerAt, dangerStepCost } from '../src/agent/library/danger.js';
import { dropBelowIfDug } from '../src/agent/library/protection.js';

test('pillagers mark a danger zone; three or more count as an outpost for longer', () => {
    const bot = {};
    const now = Date.now();
    const z = markIllagers(bot, [{name: 'pillager', position: new Vec3(100, 64, 100)}], now);
    assert.equal(z.radius, 48);
    assert.ok(dangerAt(bot, {x: 130, z: 100}, now));
    assert.equal(dangerAt(bot, {x: 200, z: 100}, now), null);
    assert.equal(dangerStepCost(bot, {position: new Vec3(110, 64, 100)}) > 0, true);
    assert.equal(dangerAt(bot, {x: 130, z: 100}, now + 16 * 60000), null); // a patrol zone expires
    const big = markIllagers(bot, [0, 1, 2].map(i => ({name: 'pillager', position: new Vec3(-500 + i, 64, 0)})), now);
    assert.match(big.name, /outpost/);
    assert.ok(dangerAt(bot, {x: -500, z: 10}, now + 50 * 60000));
    assert.equal(markIllagers(bot, [{name: 'zombie', position: new Vec3(0, 64, 0)}], now), null);
});

test('breaking the block under its feet is measured as a fall', () => {
    const blocks = new Map([['0,70,0', 'oak_leaves'], ['0,63,0', 'grass_block']]);
    const bot = {
        entity: {position: new Vec3(0.5, 71, 0.5)},
        blockAt: p => { const name = blocks.get(`${p.x},${p.y},${p.z}`) || 'air'; return {name, boundingBox: name === 'air' ? 'empty' : 'block'}; },
    };
    assert.equal(dropBelowIfDug(bot, {position: new Vec3(0, 70, 0)}), 7); // y 70 .. 64 open: 7 blocks down
    assert.equal(dropBelowIfDug(bot, {position: new Vec3(1, 70, 0)}), 0);  // not under its feet
    blocks.set('0,68,0', 'oak_log');
    assert.equal(dropBelowIfDug(bot, {position: new Vec3(0, 70, 0)}), 2);
});
