import test from 'node:test';
import assert from 'node:assert/strict';
import { noteFailure, repeatedFailure } from '../src/agent/agents/task.js';

const agent = (items, pos = {x: 0, z: 0}) => ({bot: {entity: {position: pos}, inventory: {items: () => items}}});
const call = {name: 'craftRecipe', arguments: {recipe_name: 'stick', num: 1}};
const fail = {status: 'failed', text: 'You do not have the resources to craft a stick.'};

test('the same failing call is blocked the third time while nothing changed', () => {
    const a = agent([{name: 'dirt', count: 3}]);
    noteFailure(a, call, fail, 1000);
    assert.equal(repeatedFailure(a, call, 2000), null);
    noteFailure(a, call, fail, 2000);
    assert.equal(repeatedFailure(a, call, 3000)?.code, 'repeated_failure');
});

test('a changed inventory, a new place, success or time allow it again', () => {
    const items = [{name: 'dirt', count: 3}];
    const a = agent(items);
    noteFailure(a, call, fail, 1000); noteFailure(a, call, fail, 2000);
    items.push({name: 'oak_log', count: 2});
    assert.equal(repeatedFailure(a, call, 3000), null);
    const b = agent([], {x: 0, z: 0});
    noteFailure(b, call, fail, 1000); noteFailure(b, call, fail, 2000);
    b.bot.entity.position = {x: 40, z: 0};
    assert.equal(repeatedFailure(b, call, 3000), null);
    b.bot.entity.position = {x: 0, z: 0};
    assert.equal(repeatedFailure(b, call, 2000 + 11 * 60000), null);
    noteFailure(b, call, {status: 'ok', text: 'done'}, 4000);
    assert.equal(repeatedFailure(b, call, 5000), null);
});
