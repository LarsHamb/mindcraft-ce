import test from 'node:test';
import assert from 'node:assert/strict';
import { thriftyTool } from '../src/agent/library/tool_thrift.js';

const items = [{name: 'iron_pickaxe', type: 10}, {name: 'stone_pickaxe', type: 11}];
const bot = {inventory: {items: () => items}};

test('stone and deepslate are dug with the stone pickaxe, diamond ore keeps the iron one', () => {
    const iron = items[0];
    assert.equal(thriftyTool(bot, {name: 'deepslate', harvestTools: {10: true, 11: true}}, iron).name, 'stone_pickaxe');
    assert.equal(thriftyTool(bot, {name: 'diamond_ore', harvestTools: {10: true}}, iron).name, 'iron_pickaxe');
    assert.equal(thriftyTool(bot, {name: 'dirt'}, {name: 'iron_shovel', type: 12}).name, 'iron_shovel');
    assert.equal(thriftyTool({inventory: {items: () => [iron]}}, {name: 'stone', harvestTools: {10: true, 11: true}}, iron).name, 'iron_pickaxe');
});
