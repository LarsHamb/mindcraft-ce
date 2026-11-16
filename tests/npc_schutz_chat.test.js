import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import settings from '../src/agent/settings.js';
import { parseXaeroWaypoint, handleProtectionChat } from '../src/agent/library/protection_chat.js';
import { protectedAreaAt, breakRefusal } from '../src/agent/library/protection.js';

let n = 0;
function fakeAgent(players = {}) {
    const said = [];
    const bot = {
        username: `ChatTest${++n}-${process.pid}`,
        game: {dimension: 'overworld'},
        players,
        blockAt: p => ({name: 'stone', position: p}),
    };
    return {agent: {bot, openChat: t => said.push(t)}, bot, said};
}

test('parses a shared Xaero waypoint', () => {
    const wp = parseXaeroWaypoint('xaero-waypoint:Base:B:268:64:-160:6:false:0:Internal-overworld-waypoints');
    assert.deepEqual(wp, {name: 'Base', x: 268, y: 64, z: -160, dimension: 'overworld'});
    assert.equal(parseXaeroWaypoint('xaero-waypoint:Portal:P:10:~:20:1:false:0:Internal-the_nether-waypoints').dimension, 'the_nether');
    assert.equal(parseXaeroWaypoint('hallo jarvis'), null);
});

test('a shared waypoint becomes a protected area without a model request', () => {
    settings.protected_areas = [];
    const {agent, bot, said} = fakeAgent();
    assert.equal(handleProtectionChat(agent, 'Tim', 'xaero-waypoint:Haus:H:500:70:500:6:false:0:Internal-overworld-waypoints'), true);
    assert.match(said[0], /Haus/);
    assert.ok(protectedAreaAt(bot, {x: 520, y: 70, z: 510}));
    assert.equal(protectedAreaAt(bot, {x: 600, y: 70, z: 500}), null);
    assert.match(breakRefusal(bot, {name: 'stone', position: new Vec3(510, 60, 500)}) || '', /protected area/);
    // only home-like names are protected; others go to the model
    assert.equal(handleProtectionChat(agent, 'Tim', 'xaero-waypoint:Diamanten:D:900:12:900:6:false:0:Internal-overworld-waypoints'), false);
    assert.equal(protectedAreaAt(bot, {x: 900, y: 12, z: 900}), null);
    assert.equal(handleProtectionChat(agent, 'Ali', 'xaero-waypoint:Alis Base:A:-800:70:-800:6:false:0:Internal-overworld-waypoints'), true);
    assert.ok(protectedAreaAt(bot, {x: -790, y: 70, z: -800}));
    assert.equal(handleProtectionChat(agent, 'Ali', 'xaero-waypoint:Betten:B:300:70:300:6:false:0:Internal-overworld-waypoints'), true);
    assert.ok(protectedAreaAt(bot, {x: 310, y: 70, z: 300}));
    // other dimension is not protected
    bot.game.dimension = 'the_nether';
    assert.equal(protectedAreaAt(bot, {x: 500, y: 70, z: 500}), null);
});

test('!schutz protects around the player and only the owner or an admin removes it', () => {
    settings.protected_areas = [];
    settings.protection_admins = ['Lars'];
    const players = {Tim: {entity: {position: new Vec3(-100, 64, 40)}}, Ali: {entity: {position: new Vec3(-95, 64, 40)}},
        Lars: {entity: {position: new Vec3(-100, 64, 45)}}};
    const {agent, bot, said} = fakeAgent(players);
    assert.equal(handleProtectionChat(agent, 'Tim', '!schutz 20 Turm'), true);
    assert.ok(protectedAreaAt(bot, {x: -90, y: 64, z: 40}));
    assert.equal(handleProtectionChat(agent, 'Ali', '!schutz weg'), true);
    assert.match(said.at(-1), /gehört jemand anderem/);
    assert.ok(protectedAreaAt(bot, {x: -90, y: 64, z: 40}));
    assert.equal(handleProtectionChat(agent, 'Lars', '!schutz weg'), true);
    assert.equal(protectedAreaAt(bot, {x: -90, y: 64, z: 40}), null);
    assert.equal(handleProtectionChat(agent, 'Tim', 'hol mal holz'), false);
});

test('!schutz without seeing the player asks for a waypoint', () => {
    const {agent, said} = fakeAgent({});
    assert.equal(handleProtectionChat(agent, 'Tim', '!schutz'), true);
    assert.match(said[0], /Xaero-Wegpunkt/);
});
