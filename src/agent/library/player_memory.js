// Memory per player (Lars, 17.11.): what the bot learns about each player from conversations - the name they
// want, likes and dislikes, what it did for whom, running gags, promises. Kept short and per player, and only
// the notes of players who are online go into Brain's request (end of the request, so the cache is not broken).
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

const MAX_NOTES = 12;        // per player; the oldest of the same kind goes first
const MAX_NOTE_CHARS = 160;
const KINDS = new Set(['name', 'likes', 'dislikes', 'done', 'gag', 'promise', 'fact']);

const cache = new Map();
const file = botName => `./bots/${botName}/players.json`;

function load(botName) {
    if (cache.has(botName)) return cache.get(botName);
    let data = {};
    try { if (existsSync(file(botName))) data = JSON.parse(readFileSync(file(botName), 'utf8')); } catch { data = {}; }
    cache.set(botName, data);
    return data;
}

function save(botName) {
    try {
        const f = file(botName);
        mkdirSync(path.dirname(f), {recursive: true});
        writeFileSync(`${f}.tmp`, JSON.stringify(load(botName), null, 1));
        renameSync(`${f}.tmp`, f);
    } catch (e) { console.warn('player memory: could not save', e.message); }
}

export function rememberPlayer(botName, player, note, kind = 'fact', now = Date.now()) {
    player = String(player || '').trim();
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS);
    if (!player || !note) return 'Nothing to remember.';
    if (!KINDS.has(kind)) kind = 'fact';
    const data = load(botName);
    const entry = data[player] ||= {notes: [], firstSeen: now};
    // the same note again only refreshes it
    const same = entry.notes.find(n => n.text.toLowerCase() === note.toLowerCase());
    if (same) { same.at = now; save(botName); return `Already known about ${player}.`; }
    // a new preferred name replaces the old one
    if (kind === 'name') entry.notes = entry.notes.filter(n => n.kind !== 'name');
    entry.notes.push({kind, text: note, at: now});
    while (entry.notes.length > MAX_NOTES) {
        const i = entry.notes.findIndex(n => n.kind === 'done') >= 0 ? entry.notes.findIndex(n => n.kind === 'done') : 0;
        entry.notes.splice(i, 1);
    }
    entry.lastSeen = now;
    save(botName);
    return `Remembered about ${player}: ${note}`;
}

export function forgetPlayerNote(botName, player, text) {
    const entry = load(botName)[player];
    if (!entry) return `Nothing known about ${player}.`;
    const before = entry.notes.length;
    entry.notes = entry.notes.filter(n => !n.text.toLowerCase().includes(String(text || '').toLowerCase()));
    save(botName);
    return before === entry.notes.length ? 'No such note.' : `Forgot ${before - entry.notes.length} note(s) about ${player}.`;
}

// Short block for Brain: only the given (online) players, newest notes first.
export function playerNotes(botName, players) {
    const data = load(botName);
    const lines = [];
    for (const p of players) {
        const e = data[p];
        const trust = trustText(botName, p);
        if (!e?.notes?.length) { if (trust) lines.push(`- ${p}: ${trust}`); continue; }
        // who they are first (name, likes, gags, promises), then at most the last 3 jobs done for them
        const newest = (a, b) => b.at - a.at;
        const personal = e.notes.filter(n => n.kind !== 'done').sort(newest).slice(0, 8);
        const done = e.notes.filter(n => n.kind === 'done').sort(newest).slice(0, 3);
        const notes = [...personal, ...done].map(n => (n.kind === 'fact' ? n.text : `${n.kind}: ${n.text}`));
        lines.push(`- ${p}: ${[trust, ...notes].filter(Boolean).join('; ')}`);
    }
    return lines.join('\n');
}

export function resetPlayerMemoryCache() { cache.clear(); }

// Lars, 18.11.: "wenn ihm jemand etwas gibt ... wenn ihn jemand aergert oder manipuliert merkt er sich das".
// Trust per player from -6 to +6 (start 0) with a few short experiences ("schlug dich 2x"). Lars chose: it
// forgives slowly - negative trust comes back by 1 per real day on its own, a gift or an apology speeds it up -
// and at very low trust (TRUST_REFUSE) he turns down that player's tasks. Never a reason to attack anyone.
export const TRUST_MIN = -6, TRUST_MAX = 6, TRUST_REFUSE = -4;
const DAY = 24 * 3600 * 1000;
const MAX_EVENTS = 5;

function healed(entry, now) {
    // slow forgiveness: +1 per full day since the last change, only up to 0
    if ((entry.trust || 0) < 0 && entry.trustAt) {
        const days = Math.floor((now - entry.trustAt) / DAY);
        if (days > 0) { entry.trust = Math.min(0, entry.trust + days); entry.trustAt += days * DAY; }
    }
    return entry.trust || 0;
}

export function trustOf(botName, player, now = Date.now()) {
    const entry = load(botName)[player];
    return entry ? healed(entry, now) : 0;
}

export const refusesTasks = (botName, player, now = Date.now()) => trustOf(botName, player, now) <= TRUST_REFUSE;

/** Record an experience with a player and change trust by delta. The same text again counts up ("2x"). */
export function noteExperience(botName, player, text, delta, now = Date.now()) {
    player = String(player || '').trim();
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!player || !text) return 0;
    const data = load(botName);
    const entry = data[player] ||= {notes: [], firstSeen: now};
    healed(entry, now);
    entry.trust = Math.max(TRUST_MIN, Math.min(TRUST_MAX, (entry.trust || 0) + delta));
    entry.trustAt = now;
    entry.events ||= [];
    const same = entry.events.find(e => e.text === text);
    if (same) { same.n = (same.n || 1) + 1; same.at = now; }
    else entry.events.push({text, n: 1, at: now, good: delta > 0});
    entry.events.sort((a, b) => b.at - a.at);
    entry.events = entry.events.slice(0, MAX_EVENTS);
    save(botName);
    return entry.trust;
}

export function trustWord(t) {
    if (t >= 4) return 'Freund';
    if (t >= 1) return 'mag ihn';
    if (t === 0) return 'neutral';
    if (t > TRUST_REFUSE) return 'vorsichtig';
    return 'misstraut ihm: lehnt seine Auftraege ab, verleiht und schenkt ihm nichts';
}

/** One short part for the prompt, e.g. "Vertrauen -2 vorsichtig (schlug dich 2x, nahm 5 iron_ingot aus deiner Kiste)". */
export function trustText(botName, player, now = Date.now()) {
    const entry = load(botName)[player];
    if (!entry || (!entry.events?.length && !entry.trust)) return '';
    const t = healed(entry, now);
    const ev = (entry.events || []).slice(0, 3).map(e => e.n > 1 ? `${e.text} ${e.n}x` : e.text);
    return `Vertrauen ${t > 0 ? '+' : ''}${t} ${trustWord(t)}${ev.length ? ` (${ev.join(', ')})` : ''}`;
}
