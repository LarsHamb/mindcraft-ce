import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { voiceInfo, voiceTool } from '../src/agent/library/voice_bridge.js';
import { setCharacter } from '../src/agent/library/characters.js';

const profile = JSON.parse(readFileSync(new URL('../npc/cheesynpc.json', import.meta.url), 'utf8'));

test('voice info follows the character: voice and role switch together', () => {
    const name = `VoiceTest-${process.pid}`;
    rmSync(`./bots/${name}`, {recursive: true, force: true});
    const agent = {name, prompter: {profile}, bot: {entity: {position: {x: 1.25, y: 64, z: -3.5}}}};
    let v = voiceInfo(agent);
    assert.equal(v.character, 'dorfbewohner');
    assert.equal(v.voice, 'Algenib');
    assert.match(v.persona, /Dorfbewohner/);
    assert.deepEqual(v.pos, [1.3, 64, -3.5]);
    setCharacter(agent, 'anja');
    v = voiceInfo(agent);
    assert.equal(v.voice, 'Gacrux');
    assert.match(v.persona, /Anja Momberger/);
});

test('spoken requests become chat requests of that player', () => {
    const got = [];
    const agent = {name: 'x', respondFunc: (u, m) => got.push([u, m]), actions: {currentActionLabel: 'action:village'}, bot: {entity: {}, health: 18, food: 17}};
    assert.match(voiceTool(agent, {name: 'auftrag', args: {text: 'hol mir 16 Holz'}, speaker: 'Lars'}), /weitergegeben/);
    assert.deepEqual(got[0], ['Lars', 'hol mir 16 Holz']);
    assert.match(voiceTool(agent, {name: 'status', speaker: 'Lars'}), /village/);
    assert.match(voiceTool(agent, {name: 'unbekannt'}), /nicht/);
});
