import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { visibleValuables } from '../src/agent/modes.js';

function world(blocks, items) {
    const at = p => blocks.find(b => b.position.equals(p)) || {name: 'stone', position: p};
    return {
        entity: {position: new Vec3(0, -58, 0)},
        registry: {blocksByName: {diamond_ore: {id: 1}, deepslate_diamond_ore: {id: 2}, emerald_ore: {id: 3}, deepslate_emerald_ore: {id: 4}, ancient_debris: {id: 5}}},
        inventory: {items: () => items},
        game: {dimension: 'overworld'},
        findBlocks: () => blocks.filter(b => /ore|debris/.test(b.name)).map(b => b.position),
        blockAt: p => at(p),
        canSeeBlock: b => !b.hidden,
    };
}

test('visible diamond ore is found with an iron pickaxe, not beside lava, not hidden, not with a stone pickaxe', () => {
    const blocks = [
        {name: 'deepslate_diamond_ore', position: new Vec3(2, -58, 0)},
        {name: 'deepslate_diamond_ore', position: new Vec3(-3, -58, 0)},
        {name: 'lava', position: new Vec3(-3, -57, 0)},
        {name: 'diamond_ore', position: new Vec3(0, -58, 3), hidden: true},
    ];
    const iron = world(blocks, [{name: 'iron_pickaxe', count: 1}]);
    assert.deepEqual(visibleValuables(iron).map(b => b.position.x), [2]);
    const stone = world(blocks, [{name: 'stone_pickaxe', count: 1}]);
    assert.equal(visibleValuables(stone).length, 0);
});
