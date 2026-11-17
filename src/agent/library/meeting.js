// Lars, 17.11.: optional (settings.meet_before_talk, default off): a player can only talk to him or give him
// tasks after meeting him - being near him once, or in his home village. Until then he ignores their chat.
// The list is per world (bots/<name>/met_players.json) and survives restarts.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import settings from '../settings.js';
import { inHomeVillage } from './protection.js';

export const MEET_DISTANCE = 24;
const lists = new WeakMap();
const file = bot => `./bots/${bot.username}/met_players.json`;

function met(bot) {
    let s = lists.get(bot);
    if (s) return s;
    try { s = new Set(existsSync(file(bot)) ? JSON.parse(readFileSync(file(bot), 'utf8')) : []); } catch { s = new Set(); }
    lists.set(bot, s);
    return s;
}

function save(bot) {
    try { mkdirSync(path.dirname(file(bot)), {recursive: true}); writeFileSync(file(bot), JSON.stringify([...met(bot)])); }
    catch (e) { console.warn('meeting: could not save', e.message); }
}

export const hasMet = (bot, name) => met(bot).has(name);

/** Mark players near the bot or inside its home village as met. Returns the newly met names. */
export function notePlayersMet(bot) {
    const me = bot.entity?.position;
    if (!me) return [];
    const s = met(bot), fresh = [];
    for (const [name, p] of Object.entries(bot.players || {})) {
        const pos = p?.entity?.position;
        if (!pos || name === bot.username || s.has(name)) continue;
        if (pos.distanceTo(me) <= MEET_DISTANCE || inHomeVillage(bot, pos)) { s.add(name); fresh.push(name); }
    }
    if (fresh.length) { save(bot); console.log(`Meeting: met ${fresh.join(', ')}`); }
    return fresh;
}

/** Should chat from this player be ignored? Only when the switch is on; admins are never ignored. */
export function ignoreUnmet(bot, name) {
    if (!settings.meet_before_talk) return false;
    if ((settings.protection_admins || []).includes(name)) return false;
    notePlayersMet(bot);
    return !hasMet(bot, name);
}

export function installMeeting(bot) {
    if (bot.__meetingInstalled) return;
    bot.__meetingInstalled = true;
    const t = setInterval(() => { try { if (settings.meet_before_talk) notePlayersMet(bot); } catch {} }, 3000);
    bot.once('end', () => clearInterval(t));
}
