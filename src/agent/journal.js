// Journal for the evening report (Lars, 17.11.: "dass er sich nicht immer wieder aufhängt und auch dinge
// geschafft bekommt"). One JSON line per event in bots/<name>/journal.jsonl, kept across restarts
// (docker logs are lost when the container is recreated). Read by npc/abendbericht.py.
import { appendFileSync, mkdirSync } from 'node:fs';

let botName = null;
export function initJournal(name) { botName = name; try { mkdirSync(`./bots/${name}`, {recursive: true}); } catch {} }

export function journal(type, data = {}, bot = null) {
    if (!botName) return;
    const p = bot?.entity?.position;
    const line = {at: Date.now(), type, ...(p ? {pos: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]} : {}), ...data};
    for (const k of Object.keys(line)) if (typeof line[k] === 'string' && line[k].length > 200) line[k] = line[k].slice(0, 200);
    try { appendFileSync(`./bots/${botName}/journal.jsonl`, JSON.stringify(line) + '\n'); } catch {}
    recent.push(line);
    if (recent.length > 2000) recent.splice(0, recent.length - 1500);
}

// the last entries in memory (day report, progress watch); not persisted
const recent = [];
export const recentJournal = (sinceMs = 20 * 60000, now = Date.now()) => recent.filter(e => now - e.at <= sinceMs);
