import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberPlayer, forgetPlayerNote, playerNotes, resetPlayerMemoryCache } from '../src/agent/library/player_memory.js';

test('notes per player: names replace, duplicates refresh, only online players are listed', () => {
    const bot = `PMTest-${process.pid}-${Date.now()}`;
    resetPlayerMemoryCache();
    rememberPlayer(bot, 'HiImCheeZy', 'will Lars genannt werden', 'name', 1);
    rememberPlayer(bot, 'HiImCheeZy', 'mag keine Creeper', 'dislikes', 2);
    rememberPlayer(bot, 'HiImCheeZy', 'mag keine Creeper', 'dislikes', 3); // duplicate
    rememberPlayer(bot, 'HiImCheeZy', 'heisst Chef', 'name', 4);           // replaces the name
    rememberPlayer(bot, 'Tim', 'Running Gag: verliert immer seine Spitzhacke', 'gag', 5);
    const text = playerNotes(bot, ['HiImCheeZy']);
    assert.match(text, /heisst Chef/);
    assert.doesNotMatch(text, /Lars genannt/);
    assert.equal((text.match(/Creeper/g) || []).length, 1);
    assert.doesNotMatch(text, /Spitzhacke/); // Tim is not online
    assert.match(playerNotes(bot, ['Tim']), /Spitzhacke/);
    assert.match(forgetPlayerNote(bot, 'Tim', 'Spitzhacke'), /Forgot 1/);
    assert.equal(playerNotes(bot, ['Tim']), '');
    // saved across a restart (cache cleared)
    resetPlayerMemoryCache();
    assert.match(playerNotes(bot, ['HiImCheeZy']), /Chef/);
});

test('at most 12 notes per player, old "done" notes go first', () => {
    const bot = `PMTest2-${process.pid}-${Date.now()}`;
    resetPlayerMemoryCache();
    rememberPlayer(bot, 'Ali', 'mag Birkenholz', 'likes', 1);
    for (let i = 0; i < 15; i++) rememberPlayer(bot, 'Ali', `Auftrag ${i}`, 'done', 10 + i);
    const text = playerNotes(bot, ['Ali']);
    assert.match(text, /Birkenholz/);
});
