// Player-set protected areas from chat, handled without any model request.
//  - Xaero's Minimap "share waypoint" posts a chat line like
//      xaero-waypoint:Base:B:268:64:-160:6:false:0:Internal-overworld-waypoints
//    A shared waypoint named like a home (Base, Basis, Haus, Home, Zuhause, Heim ...) becomes a protected
//    area (default radius 40) owned by the sender; other waypoints are left to the model.
//  - Fallback without the mod:  !schutz [radius] [name]   around the sender's position
//                               !schutz weg                removes the area you stand in (owner or admin)
//                               !schutz liste              lists the areas
import { addPlayerArea, removePlayerAreaAt, listAreas, protectedAreaAt } from './protection.js';
import settings from '../settings.js';

const DEFAULT_RADIUS = 40, MIN_RADIUS = 5, MAX_RADIUS = 128;
export const BASE_NAME = /(base|basis|haus|house|home|zuhause|heim|bett|bed)/i;
const WAYPOINT = /xaero-waypoint:([^:]*):([^:]*):(-?\d+|~):(-?\d+|~):(-?\d+|~):(\d+):(true|false):(-?\d+)(?::(\S+))?/i;

export function parseXaeroWaypoint(message) {
    const m = WAYPOINT.exec(String(message || ''));
    if (!m) return null;
    const num = v => (v === '~' ? null : Number(v));
    const x = num(m[3]), y = num(m[4]), z = num(m[5]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const set = (m[9] || '').toLowerCase();
    const dimension = /nether/.test(set) ? 'the_nether' : /end/.test(set) ? 'the_end' : 'overworld';
    return {name: m[1] || m[2] || 'Wegpunkt', x, y: Number.isFinite(y) ? y : null, z, dimension};
}

const isAdmin = username => (settings.protection_admins || []).includes(username);
const clampRadius = r => Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(r)));

function say(agent, text) {
    try { agent.openChat ? agent.openChat(text) : agent.bot.chat(text); } catch (e) { console.warn('protection chat:', e.message); }
}

// Returns true if the message was a protection message and is fully handled.
export function handleProtectionChat(agent, username, message) {
    const bot = agent.bot;
    const wp = parseXaeroWaypoint(message);
    // Only waypoints named like a home become protected areas (Lars, 17.11.); others go to the model as usual.
    if (wp && BASE_NAME.test(wp.name)) {
        const area = addPlayerArea(bot, {name: `${wp.name} (${username})`, x: wp.x, y: wp.y, z: wp.z,
            radius: DEFAULT_RADIUS, dimension: wp.dimension, owner: username});
        say(agent, `Okay ${username}, ich lasse "${wp.name}" bei ${area.x} / ${area.z} in Ruhe (Radius ${area.radius}).`);
        return true;
    }
    const cmd = /^!schutz\b\s*(.*)$/i.exec(String(message || '').trim());
    if (!cmd) return false;
    const args = cmd[1].trim();
    const player = bot.players?.[username]?.entity;
    if (/^(liste|list)$/i.test(args)) {
        const all = listAreas(bot);
        say(agent, all.length ? `Geschützt: ${all.slice(0, 8).map(a => `${a.name} ${a.x}/${a.z} r${a.radius}`).join('; ')}${all.length > 8 ? ' ...' : ''}`
            : 'Noch keine Schutzzonen.');
        return true;
    }
    if (/^(weg|aus|entfernen|remove)$/i.test(args)) {
        if (!player) { say(agent, `${username}, ich sehe dich nicht. Stell dich in die Zone, die weg soll.`); return true; }
        const result = removePlayerAreaAt(bot, player.position, username, isAdmin(username));
        if (result === 'none') say(agent, `${username}, hier ist keine Zone, die ein Spieler gesetzt hat.`);
        else if (result === 'not_allowed') say(agent, `${username}, die Zone gehört jemand anderem.`);
        else say(agent, `Okay, die Zone "${result.name}" ist weg.`);
        return true;
    }
    const m = /^(\d+)?\s*(.*)$/.exec(args);
    const radius = clampRadius(m[1] ? Number(m[1]) : DEFAULT_RADIUS);
    const name = (m[2] || '').trim() || `Base von ${username}`;
    if (!player) {
        say(agent, `${username}, ich sehe dich gerade nicht. Komm näher oder teile deine Base als Xaero-Wegpunkt im Chat.`);
        return true;
    }
    const p = player.position;
    const already = protectedAreaAt(bot, p);
    const area = addPlayerArea(bot, {name, x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), radius,
        dimension: String(bot.game?.dimension || 'overworld').replace('minecraft:', ''), owner: username});
    say(agent, `Okay ${username}, "${area.name}" bei ${area.x} / ${area.z} ist geschützt (Radius ${area.radius})${already ? ', zusätzlich zu ' + already.name : ''}.`);
    return true;
}
