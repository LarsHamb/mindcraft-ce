import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import settings from '../src/agent/settings.js';
import { knowledgeFor, findCharacter, currentCharacterId, setCharacter, autoSwitch, handleCharacterChat, currentCharacter } from '../src/agent/library/characters.js';

const profile = JSON.parse(readFileSync(new URL('../npc/cheesynpc.json', import.meta.url), 'utf8'));
let n = 0;
function agent() {
    const name = `CharTest${++n}-${process.pid}`;
    rmSync(`./bots/${name}`, {recursive: true, force: true});
    const said = [], woke = [];
    return {name, prompter: {profile}, said, woke, openChat: t => said.push(t), agentSystem: {wake: (s, m) => woke.push(m)}};
}

test('the profile has the villager and anja, shared rules without a character', () => {
    assert.deepEqual(Object.keys(profile.characters), ['dorfbewohner', 'anja']);
    assert.ok(!profile.brain_knowledge.some(l => l.startsWith('CHARACTER:')));
    assert.ok(profile.brain_knowledge.some(l => /Pflegen, nicht umbauen/.test(l)));
    assert.equal(profile.characters.anja.guard, false);
});

test('knowledge: the current character first, then the shared rules', () => {
    const a = agent();
    const k = knowledgeFor(profile, a.name, 'brain_knowledge');
    assert.match(k[0], /ordinary Minecraft villager/);
    assert.equal(k.length, profile.characters.dorfbewohner.brain.length + profile.brain_knowledge.length);
    setCharacter(a, 'anja');
    assert.match(knowledgeFor(profile, a.name, 'brain_knowledge')[0], /Anja Momberger/);
    assert.match(knowledgeFor(profile, a.name, 'task_knowledge')[0], /Anja Momberger/);
    assert.equal(currentCharacter(a).guard, false);
});

test('names are matched loosely', () => {
    assert.equal(findCharacter(profile, 'Anja'), 'anja');
    assert.equal(findCharacter(profile, 'anja momberger'), 'anja');
    assert.equal(findCharacter(profile, 'Dorfbewohner'), 'dorfbewohner');
    assert.equal(findCharacter(profile, 'Hmmbert'), 'dorfbewohner');
    assert.equal(findCharacter(profile, 'Kriegsminister'), null);
    assert.equal(findCharacter(profile, 'Bob'), null);
});

test('!charakter: only admins switch, others get a polite no', () => {
    settings.character_admins = ['HiImCheeZy'];
    const a = agent();
    assert.equal(handleCharacterChat(a, 'Fremder', '!charakter anja'), true);
    assert.equal(currentCharacterId(profile, a.name), 'dorfbewohner');
    assert.equal(handleCharacterChat(a, 'HiImCheeZy', '!charakter anja'), true);
    assert.equal(currentCharacterId(profile, a.name), 'anja');
    assert.match(a.woke[0], /Anja Momberger/);
    const saved = JSON.parse(readFileSync(`./bots/${a.name}/character.json`, 'utf8'));
    assert.equal(saved.display, '<light_purple>Anja Momberger</light_purple>');
    assert.equal(handleCharacterChat(a, 'HiImCheeZy', 'hallo'), false);
});

test('daily switch is off by default and rotates once a day when on', () => {
    const a = agent();
    settings.character_auto_switch = 'off';
    assert.equal(autoSwitch(a), null);
    settings.character_auto_switch = 'daily';
    assert.equal(autoSwitch(a, new Date('2026-11-17T10:00:00Z')), null, 'first day keeps the default');
    assert.equal(autoSwitch(a, new Date('2026-11-17T20:00:00Z')), null, 'same day: no switch');
    assert.equal(autoSwitch(a, new Date('2026-11-18T08:00:00Z')), 'anja');
    assert.equal(autoSwitch(a, new Date('2026-11-19T08:00:00Z')), 'dorfbewohner');
    settings.character_auto_switch = 'off';
});

test('an old saved character id (minister) falls back to the villager', () => {
    const a = agent();
    mkdirSync(`./bots/${a.name}`, {recursive: true});
    writeFileSync(`./bots/${a.name}/character.json`, JSON.stringify({id: 'minister'}));
    assert.equal(currentCharacterId(profile, a.name), 'dorfbewohner');
    const text = JSON.stringify(profile.characters.dorfbewohner);
    assert.doesNotMatch(text, /Kriegsminister|Oberbefehlshaber|Truppe|Soldat|Operation/);
});
