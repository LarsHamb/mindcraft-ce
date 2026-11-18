import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installLastSeen, lastSeen, noteSeen } from '../src/agent/library/last_seen.js';

test('remembers where a player was last seen; old sightings expire', () => {
    const bot = new EventEmitter();
    bot.username = 'Bot';
    bot.players = {};
    installLastSeen(bot);
    assert.equal(lastSeen(bot, 'Tester'), null);
    noteSeen(bot, 'Tester', {x: 1400.5, y: 79, z: -1596.5});
    assert.deepEqual({...lastSeen(bot, 'Tester'), at: 0}, {x: 1400, y: 79, z: -1597, at: 0});
    noteSeen(bot, 'Alt', {x: 0, y: 64, z: 0}, Date.now() - 31 * 60000);
    assert.equal(lastSeen(bot, 'Alt'), null);
    bot.emit('end');
});
