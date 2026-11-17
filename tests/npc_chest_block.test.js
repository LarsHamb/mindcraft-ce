import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { chestBlockedBy } from '../src/agent/library/skills.js';

const bot = above => ({blockAt: () => above});
const chest = {name: 'chest', position: new Vec3(0, 64, 0)};

test('a solid block on top keeps a chest shut; glass, slabs, leaves and air do not', () => {
    assert.equal(chestBlockedBy(bot({name: 'cobblestone', boundingBox: 'block', transparent: false}), chest)?.name, 'cobblestone');
    assert.equal(chestBlockedBy(bot({name: 'oak_planks', boundingBox: 'block', transparent: false}), chest)?.name, 'oak_planks');
    for (const b of [{name: 'air', boundingBox: 'empty'}, {name: 'glass', boundingBox: 'block', transparent: true},
        {name: 'oak_slab', boundingBox: 'block', transparent: true}, {name: 'oak_leaves', boundingBox: 'block', transparent: true},
        {name: 'chest', boundingBox: 'block', transparent: true}])
        assert.equal(chestBlockedBy(bot(b), chest), null, b.name);
});
