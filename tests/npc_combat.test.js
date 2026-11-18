import test from 'node:test';
import assert from 'node:assert/strict';
import { cooldownMs, bowPitch } from '../src/agent/library/combat.js';

test('weapon cooldowns follow Minecraft attack speeds', () => {
    assert.equal(cooldownMs('iron_sword'), 625);
    assert.equal(cooldownMs('stone_axe'), 1250);
    assert.equal(cooldownMs(''), 260);
});

test('bow pitch: flat shot a little upwards, higher target steeper, far target lobbed', () => {
    const flat = bowPitch(10, 0) * 180 / Math.PI;
    assert.ok(flat > 0 && flat < 6, `flat ${flat}`);
    const up = bowPitch(10, 5) * 180 / Math.PI;
    assert.ok(up > flat + 15, `up ${up}`);
    const far = bowPitch(40, 0) * 180 / Math.PI;
    assert.ok(far > flat, `far ${far}`);
    const down = bowPitch(10, -6) * 180 / Math.PI;
    assert.ok(down < 0, `down ${down}`);
});

import { deathOf } from '../src/agent/library/social.js';
test('player deaths are recognised in server messages, not his own', () => {
    assert.deepEqual(deathOf('HiImCheeZy was slain by Zombie', 'CheesyNPC'), {player: 'HiImCheeZy', how: 'was slain by Zombie'});
    assert.equal(deathOf('CheesyNPC drowned', 'CheesyNPC'), null);
    assert.equal(deathOf('HiImCheeZy joined the game', 'CheesyNPC'), null);
});
