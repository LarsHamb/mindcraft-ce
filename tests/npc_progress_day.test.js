import test from 'node:test';
import assert from 'node:assert/strict';
import { noProgress, WINDOW_MS } from '../src/agent/library/progress_watch.js';
import { dayFacts } from '../src/agent/modes.js';
import { playerHealth } from '../src/agent/library/social.js';
import { isHostile } from '../src/utils/mcdata.js';

const samples = (n, f) => Array.from({length: n}, (_, i) => ({at: i * 60000, inv: 'a', pos: {x: 0, y: 64, z: 0}, busy: true, ...f(i)}));

test('progress watch: 10 busy minutes without items, movement or finished tasks', () => {
    const now = WINDOW_MS;
    assert.equal(noProgress(samples(11, () => ({})), 0, now), true);
    assert.equal(noProgress(samples(11, () => ({})), 1, now), false);                      // a task finished
    assert.equal(noProgress(samples(11, i => ({inv: i > 5 ? 'b' : 'a'})), 0, now), false);  // new items
    assert.equal(noProgress(samples(11, i => ({pos: {x: i * 3, y: 64, z: 0}})), 0, now), false); // walked 30 blocks
    assert.equal(noProgress(samples(11, i => ({busy: i < 3})), 0, now), false);           // mostly idle on purpose
    assert.equal(noProgress(samples(5, () => ({})), 0, 4 * 60000), false);                 // not 10 minutes yet
});

test('day report facts from the journal', () => {
    const facts = dayFacts([
        {type: 'task_end', outcome: 'done', objective: 'Eisen abbauen'}, {type: 'task_end', outcome: 'blocked', objective: 'x'},
        {type: 'kill', mob: 'zombie'}, {type: 'kill', mob: 'zombie'}, {type: 'kill', mob: 'skeleton'}, {type: 'death'}]);
    assert.match(facts, /done: Eisen abbauen/);
    assert.match(facts, /2 zombie, 1 skeleton/);
    assert.match(facts, /died 1/);
    assert.equal(dayFacts([]), '');
});

test('player health from metadata; neutral mobs are not hostile unless angry', () => {
    assert.equal(playerHealth({metadata: {9: 6.5}}), 6.5);
    assert.equal(playerHealth({metadata: {}}), null);
    assert.equal(isHostile({name: 'enderman', type: 'hostile'}), false);
    assert.equal(isHostile({name: 'enderman', type: 'hostile', __angryUntil: Date.now() + 1000}), true);
    assert.equal(isHostile({name: 'zombie', type: 'hostile'}), true);
});
