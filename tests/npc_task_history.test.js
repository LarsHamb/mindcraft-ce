import test from 'node:test';
import assert from 'node:assert/strict';
import { compactTaskHistory, TASK_HISTORY_TAIL } from '../src/agent/agents/task.js';

function longHistory(pairs) {
    const h = [{role: 'user', content: 'Objective: build a base'}];
    for (let i = 0; i < pairs; i++) {
        h.push({role: 'assistant', content: '', tool_calls: [{id: `c${i}`, name: 'collectBlocks'}]});
        h.push({role: 'tool', name: 'collectBlocks', tool_call_id: `c${i}`, content: `result ${i}`});
    }
    return h;
}

test('short task histories are sent unchanged', () => {
    const h = longHistory(3);
    assert.equal(compactTaskHistory(h), h);
});

test('long task histories keep the objective, a note and a tail without orphan tool results', () => {
    const h = longHistory(30);
    const c = compactTaskHistory(h, [{name: 'collectBlocks', status: 'ok', text: 'Broke 4/4 oak_log'}]);
    assert.ok(c.length <= TASK_HISTORY_TAIL + 2);
    assert.equal(c[0].content, 'Objective: build a base');
    assert.match(c[1].content, /earlier messages of this task omitted/);
    assert.match(c[1].content, /Broke 4\/4/);
    assert.notEqual(c[2].role, 'tool');
    // every tool result in the tail has its call in the tail
    const calls = new Set(c.flatMap(m => (m.tool_calls || []).map(t => t.id)));
    for (const m of c.filter(m => m.role === 'tool')) assert.ok(calls.has(m.tool_call_id));
    assert.equal(h.length, 61); // the loop's own history is not modified
});
