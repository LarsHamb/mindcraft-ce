// Lars, 17.11.: CheesyNPC has several characters that take turns ("!charakter anja", "!charakter minister").
// The profile holds the shared rules in brain_knowledge and each character in profile.characters:
//   {id: {display, brain: [...], task_chat, guard, hello}}
// Memory per player stays shared; only role and speech change. The current one is saved per bot
// (bots/<name>/character.json); a host script (npc/nick-watch.sh) sets the styled nickname from it.
// Optional automatic switch: settings.character_auto_switch = 'daily' (default 'off').
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import settings from '../settings.js';

const file = name => `./bots/${name}/character.json`;

export function characterIds(profile) {
    return Object.keys(profile?.characters || {});
}

export function loadCharacterState(name) {
    try { return existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : null; } catch { return null; }
}

function saveCharacterState(name, s) {
    try { mkdirSync(path.dirname(file(name)), {recursive: true}); writeFileSync(file(name), JSON.stringify(s)); }
    catch (e) { console.warn('characters: could not save', e.message); }
}

/** The current character id: saved choice, else profile.character_default, else the first one. */
export function currentCharacterId(profile, name) {
    const ids = characterIds(profile);
    if (!ids.length) return null;
    const saved = loadCharacterState(name)?.id;
    if (ids.includes(saved)) return saved;
    return ids.includes(profile.character_default) ? profile.character_default : ids[0];
}

export function currentCharacter(agent) {
    const profile = agent?.prompter?.profile;
    const id = currentCharacterId(profile, agent?.name);
    return id ? {id, ...profile.characters[id]} : null;
}

/** Knowledge lines for the prompt: the character's own lines first, then the shared rules. */
export function knowledgeFor(profile, name, field) {
    const shared = profile?.[field];
    const id = currentCharacterId(profile, name);
    const c = id && profile.characters[id];
    if (!c) return shared;
    const list = Array.isArray(shared) ? shared : (shared ? [shared] : []);
    if (field === 'brain_knowledge') return [...(c.brain || []), ...list];
    if (field === 'task_knowledge') return [...(c.task_chat ? [c.task_chat] : []), ...list];
    return shared;
}

/** Match a typed name ("anja", "Anja Momberger", "minister") to a character id. */
export function findCharacter(profile, text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    for (const [id, c] of Object.entries(profile?.characters || {})) {
        const names = [id, ...(c.aliases || []), String(c.display || '').replace(/<[^>]+>/g, '')].map(s => String(s).toLowerCase().trim());
        if (names.some(n => n && (n === t || n.split(/\s+/).includes(t)))) return id;
    }
    return null;
}

export function setCharacter(agent, id, by = 'chat', day = today()) {
    const profile = agent.prompter.profile;
    if (!profile?.characters?.[id]) return false;
    saveCharacterState(agent.name, {id, display: profile.characters[id].display || id, at: Date.now(), day, by});
    console.log(`Character: now ${id} (${by})`);
    return true;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Daily rotation (switch off by default). Returns the new id or null. */
export function autoSwitch(agent, now = new Date()) {
    if (settings.character_auto_switch !== 'daily') return null;
    const profile = agent?.prompter?.profile;
    const ids = characterIds(profile);
    if (ids.length < 2) return null;
    const s = loadCharacterState(agent.name);
    const day = now.toISOString().slice(0, 10);
    if (s?.day === day) return null;
    const cur = currentCharacterId(profile, agent.name);
    const next = s ? ids[(ids.indexOf(cur) + 1) % ids.length] : cur;
    setCharacter(agent, next, 'auto', day);
    return next === cur ? null : next;
}

function say(agent, text) {
    try { agent.openChat ? agent.openChat(text) : agent.bot.chat(text); } catch (e) { console.warn('characters chat:', e.message); }
}

const allowed = name => [...(settings.character_admins || ['HiImCheeZy']), ...(settings.protection_admins || [])].includes(name);

/** "!charakter <name>" from an admin switches; "!charakter" lists. Handled locally (no model request). */
export function handleCharacterChat(agent, username, message) {
    const m = /^!(charakter|character)\b\s*(.*)$/i.exec(String(message || '').trim());
    if (!m) return false;
    const profile = agent.prompter?.profile;
    const ids = characterIds(profile);
    if (!ids.length) return true;
    const cur = currentCharacterId(profile, agent.name);
    if (!m[2].trim()) { say(agent, `Charaktere: ${ids.join(', ')} (gerade: ${cur}).`); return true; }
    if (!allowed(username)) { say(agent, `${username}, den Charakter wechselt nur ${(settings.character_admins || ['HiImCheeZy'])[0]}.`); return true; }
    const id = findCharacter(profile, m[2]);
    if (!id) { say(agent, `Kenne ich nicht. Charaktere: ${ids.join(', ')}.`); return true; }
    if (id === cur) { say(agent, `Ist schon ${id}.`); return true; }
    setCharacter(agent, id, username);
    announceSwitch(agent, id);
    return true;
}

/** Tell the planner who it is now; it greets in the new role. */
export function announceSwitch(agent, id) {
    const c = agent.prompter.profile.characters[id];
    agent.agentSystem?.wake?.('system', `Character switch: from now on you are ${String(c.display || id).replace(/<[^>]+>/g, '')}. ` +
        `Speak and act only as this character (see CHARACTER in your knowledge); your memory of players stays. ${c.hello || 'Greet the players briefly in your new role.'}`);
}
