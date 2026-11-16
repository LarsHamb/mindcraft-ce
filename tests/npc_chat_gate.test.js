import test from 'node:test';
import assert from 'node:assert/strict';
import settings from '../src/agent/settings.js';
import { germanize } from '../src/agent/npc_phrases.js';
import { realPlayersOnline, waitForPlayers } from '../src/agent/player_gate.js';

test('fixed sentences become German, model text passes unchanged', () => {
    assert.equal(germanize("I'm staying here."), 'Ich bleibe hier.');
    assert.equal(germanize("I'm gathering wood."), 'Ich sammle Holz.');
    assert.equal(germanize('Aaa! A zombie!'), 'Achtung, Zombie!');
    assert.equal(germanize('Hunting cow!'), 'Ich jage: Kuh.');
    assert.equal(germanize('Ich habe 8 Kohle abgebaut.'), 'Ich habe 8 Kohle abgebaut.');
    assert.equal(germanize("I'm heading to the next spot."), '');
});

test('model requests wait while no real player is online', async () => {
    settings.pause_without_players = true;
    settings.ignore_players = ['OtherBot'];
    const bot = {username: 'CheesyNPC', entity: {}, players: {CheesyNPC: {}, OtherBot: {}}};
    assert.deepEqual(realPlayersOnline(bot), []);
    let done = false;
    const waiting = waitForPlayers({bot}, {pollMs: 10}).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(done, false);
    bot.players.Tim = {};
    await waiting;
    assert.equal(done, true);
    settings.pause_without_players = false;
    delete bot.players.Tim;
    await waitForPlayers({bot}); // disabled: returns at once
});
