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
        if (!e?.notes?.length) continue;
        // who they are first (name, likes, gags, promises), then at most the last 3 jobs done for them
        const newest = (a, b) => b.at - a.at;
        const personal = e.notes.filter(n => n.kind !== 'done').sort(newest).slice(0, 8);
        const done = e.notes.filter(n => n.kind === 'done').sort(newest).slice(0, 3);
        const notes = [...personal, ...done].map(n => (n.kind === 'fact' ? n.text : `${n.kind}: ${n.text}`));
        lines.push(`- ${p}: ${notes.join('; ')}`);
    }
    return lines.join('\n');
}

export function resetPlayerMemoryCache() { cache.clear(); }
