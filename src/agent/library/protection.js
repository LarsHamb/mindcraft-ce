// Respect for other players' builds (ported from Jarvis kern/schutz.js).
// - Building blocks (planks, glass, doors, ...) that the bot did not place itself are never broken.
// - Logs that are not part of a natural tree (log walls, cabins, piles) count as building blocks.
// - Protected areas: settings.protected_areas [{"name","x","z","radius"}] plus areas the bot detects
//   itself around clusters of foreign building blocks. Inside, nothing is broken or placed.
// Enforced at the lowest level (bot.dig, bot._genericPlace), so every skill, tool and the pathfinder's
// own digging/scaffolding respect it; the pathfinder also plans around it.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import Vec3 from 'vec3';
import settings from '../settings.js';
import { LOG, createTreeCheck } from './natural_tree.js';

export const BUILDING = new RegExp([
    '_planks$', '_stairs$', '_slab$', '(^|_)glass$', 'glass_pane$', '_wool$', '_carpet$', '_concrete$',
    'bricks$', '^polished_', '^cut_', '^smooth_(stone|sandstone|red_sandstone|quartz)', '_wall$', '_fence$', '_fence_gate$', '_door$', '_trapdoor$',
    '^ladder$', 'torch$', 'lantern$', '_sign$', '_bed$', '^crafting_table$', 'chest$', '^barrel$', 'furnace$',
    '^smoker$', 'anvil$', 'shulker_box$', '^farmland$',
    '^stripped_', '_wood$', '_hyphae$', '^bookshelf$', '^chiseled_bookshelf$', '^hopper$', '^lectern$', '^enchanting_table$',
    '^brewing_stand$', 'cauldron$', '^composter$', '^beehive$', 'campfire$', '^hay_block$', '^iron_bars$', '^chain$',
    '^scaffolding$', '_button$', '_pressure_plate$', '^lever$', '^dropper$', '^dispenser$', '^observer$', '^piston$', '^sticky_piston$',
    '^repeater$', '^comparator$', '^redstone_lamp$', '^jukebox$', '^note_block$', '^loom$', '^smithing_table$', '^fletching_table$',
    '^cartography_table$', '^grindstone$', '^stonecutter$', '^bell$', '_banner$', '^flower_pot$', '^potted_', '^item_frame$',
].join('|'));
const LADDER = /^(ladder|scaffolding)$/;
const BUILT_RADIUS = 12, BUILT_MIN = 6, BUILT_CUBE = 3, BUILT_SEARCH = 16, BUILT_HEIGHT = 6;
const DEPTH = 8;         // a detected area reaches this far below its center (a deep mine below stays allowed)
const MAX_OWN = 5000;

const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const states = new WeakMap();

function manualAreas() {
    const list = settings.protected_areas;
    return Array.isArray(list) ? list.filter(a => [a?.x, a?.z, a?.radius].every(Number.isFinite)) : [];
}

function loadJson(file, fallback) {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
}
function saveJson(file, data) {
    try { mkdirSync(path.dirname(file), {recursive: true}); const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(data)); renameSync(tmp, file); }
    catch (e) { console.warn('protection: could not save', file, e.message); }
}

function state(bot) {
    let s = states.get(bot);
    if (s) return s;
    const dir = `./bots/${bot.username}`;
    const own = new Map(Object.entries(loadJson(`${dir}/own_blocks.json`, {})));
    const built = loadJson(`${dir}/built_areas.json`, []);
    const players = loadJson(`${dir}/player_areas.json`, []);
    s = {
        own, built, players, dir,
        savePlayers() { saveJson(`${dir}/player_areas.json`, s.players); },
        saveOwn() { while (own.size > MAX_OWN) own.delete(own.keys().next().value); saveJson(`${dir}/own_blocks.json`, Object.fromEntries(own)); },
        saveBuilt() { saveJson(`${dir}/built_areas.json`, built); },
    };
    // own building blocks next to a log also make it a beam: a log touching any plank is not a tree
    s.isTreeLog = createTreeCheck(bot, name => BUILDING.test(name));
    states.set(bot, s);
    return s;
}

export function protectedAreaAt(bot, pos) {
    if (!pos) return null;
    const dim = String(bot?.game?.dimension || 'overworld').replace('minecraft:', '');
    for (const a of manualAreas()) {
        if (a.dimension && String(a.dimension).replace('minecraft:', '') !== dim) continue;
        const dx = pos.x - a.x, dz = pos.z - a.z;
        if (dx * dx + dz * dz <= a.radius * a.radius) return a;
    }
    for (const a of (states.get(bot)?.players || [])) {
        if (a.dimension && String(a.dimension).replace('minecraft:', '') !== dim) continue;
        const dx = pos.x - a.x, dz = pos.z - a.z;
        if (dx * dx + dz * dz <= a.radius * a.radius) return a;
    }
    for (const a of (states.get(bot)?.built || [])) {
        const dx = pos.x - a.x, dz = pos.z - a.z;
        if (dx * dx + dz * dz <= a.radius * a.radius && pos.y >= a.y - DEPTH) return a;
    }
    return null;
}

export const isOwnBlock = (bot, pos, name) => state(bot).own.get(key(pos)) === name;

// Returns null if the bot may break this block, otherwise the reason.
export function breakRefusal(bot, block) {
    if (!block?.position) return null;
    const s = state(bot);
    if (s.own.get(key(block.position)) === block.name) return null;
    if (BUILDING.test(block.name)) return `${block.name} is player-built`;
    if (LOG.test(block.name) && !s.isTreeLog(block.position)) return `${block.name} is not part of a natural tree (log wall or building)`;
    const area = protectedAreaAt(bot, block.position);
    if (area) {
        // Way out: standing inside the area, natural blocks right next to the bot may be broken so it can
        // climb or dig out (it got trapped in a pit once). Building blocks and log walls stay refused above.
        const me = bot.entity?.position;
        if (me && protectedAreaAt(bot, me) === area && Math.abs(block.position.x + 0.5 - me.x) <= 2.5
            && Math.abs(block.position.z + 0.5 - me.z) <= 2.5 && block.position.y >= Math.floor(me.y) - 1
            && block.position.y <= Math.floor(me.y) + 3) return null;
        return `protected area "${area.name || 'player base'}" (if you are inside it, walk out; natural blocks right next to you may be dug to get out)`;
    }
    return null;
}

export function isHarvestableLog(bot, block) {
    return !!block?.position && LOG.test(block.name) && breakRefusal(bot, block) === null;
}

function refusal(what, pos, reason) {
    const err = new Error(`${what} at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)} refused: ${reason}. Leave other players' builds alone and work elsewhere.`);
    err.code = 'protected';
    return err;
}

function guardMovements(bot, movements) {
    if (!movements || movements.__protected) return movements;
    movements.exclusionAreasBreak?.push(block => (breakRefusal(bot, block) ? 100000 : 0));
    movements.exclusionAreasPlace?.push(block => (block?.position && protectedAreaAt(bot, block.position) ? 100000 : 0));
    movements.__protected = true;
    return movements;
}

// Detect clusters of foreign building blocks above ground and protect them (Jarvis: erkenneBebauung).
export function detectBuiltAreas(bot) {
    const s = state(bot);
    const found = (bot.findBlocks({matching: b => !!b && BUILDING.test(b.name), maxDistance: BUILT_SEARCH, count: 256}) || [])
        .filter(p => { const b = bot.blockAt(p); return b && s.own.get(key(p)) !== b.name; });
    for (const p of found) {
        if (protectedAreaAt(bot, p)) continue;
        const near = found.filter(q => Math.abs(q.x - p.x) <= BUILT_CUBE && Math.abs(q.y - p.y) <= BUILT_CUBE && Math.abs(q.z - p.z) <= BUILT_CUBE);
        if (near.length < BUILT_MIN) continue;
        const all = found.filter(q => Math.abs(q.x - p.x) <= BUILT_SEARCH && Math.abs(q.z - p.z) <= BUILT_SEARCH);
        const noLadder = all.filter(q => !LADDER.test(bot.blockAt(q)?.name || ''));
        const pile = noLadder.length ? noLadder : all;
        // underground (mineshaft, ancient city): no sky light above any block
        if (pile.every(q => bot.blockAt(new Vec3(q.x, q.y + 1, q.z))?.skyLight === 0)) continue;
        const c = ['x', 'y', 'z'].reduce((m, a) => ({...m, [a]: Math.round(pile.reduce((n, q) => n + q[a], 0) / pile.length)}), {});
        if (protectedAreaAt(bot, c)) continue;
        const area = {name: `built ${c.x},${c.z}`, x: c.x, y: c.y, z: c.z, radius: BUILT_RADIUS, at: Date.now()};
        s.built.push(area);
        s.saveBuilt();
        console.log(`Protection: detected a build at ${c.x} ${c.y} ${c.z}, protected with radius ${BUILT_RADIUS}`);
        return area;
    }
    return null;
}

// A detected area disappears when no foreign building block is left there (unloaded = unknown, keep it).
export function pruneBuiltAreas(bot) {
    const s = state(bot);
    const gone = s.built.filter(a => {
        let unknown = false;
        for (let dx = -a.radius; dx <= a.radius; dx++) for (let dz = -a.radius; dz <= a.radius; dz++) for (let dy = -BUILT_HEIGHT; dy <= BUILT_HEIGHT; dy++) {
            const p = new Vec3(a.x + dx, a.y + dy, a.z + dz);
            const b = bot.blockAt(p);
            if (!b) { unknown = true; continue; }
            if (BUILDING.test(b.name) && s.own.get(key(p)) !== b.name) return false;
        }
        return !unknown;
    });
    if (!gone.length) return 0;
    s.built = s.built.filter(a => !gone.includes(a));
    s.saveBuilt();
    return gone.length;
}

export function installProtection(bot) {
    if (bot.__protectionInstalled) return;
    bot.__protectionInstalled = true;
    const s = state(bot);
    const dig = bot.dig;
    if (typeof dig === 'function') {
        bot.dig = async function (block, ...rest) {
            const reason = breakRefusal(bot, block);
            if (reason) throw refusal(`Breaking ${block.name}`, block.position, reason);
            const result = await dig.call(this, block, ...rest);
            if (s.own.delete(key(block.position))) s.saveOwn();
            return result;
        };
    }
    const place = bot._genericPlace;
    if (typeof place === 'function') {
        bot._genericPlace = async function (referenceBlock, faceVector, ...rest) {
            const target = referenceBlock?.position && faceVector ? referenceBlock.position.plus(faceVector) : null;
            const area = protectedAreaAt(bot, target);
            if (area) throw refusal('Placing a block', target, `protected area "${area.name || 'player base'}"`);
            const result = await place.call(this, referenceBlock, faceVector, ...rest);
            if (target) {
                // the server update can arrive after the place call resolves: wait briefly for it
                let now = bot.blockAt(target);
                for (let i = 0; i < 10 && (!now || now.name === 'air' || now.name === 'cave_air'); i++) {
                    await new Promise(r => setTimeout(r, 100));
                    now = bot.blockAt(target);
                }
                if (now && now.name !== 'air' && now.name !== 'cave_air') { s.own.set(key(target), now.name); s.saveOwn(); }
            }
            return result;
        };
    }
    const setMovements = bot.pathfinder?.setMovements;
    if (typeof setMovements === 'function') {
        bot.pathfinder.setMovements = function (movements, ...rest) {
            return setMovements.call(this, guardMovements(bot, movements), ...rest);
        };
        if (bot.pathfinder.movements) guardMovements(bot, bot.pathfinder.movements);
    }
    const scan = setInterval(() => {
        try { if (bot.entity) { detectBuiltAreas(bot); pruneBuiltAreas(bot); } } catch (e) { console.warn('protection scan:', e.message); }
    }, 20000);
    bot.once('end', () => clearInterval(scan));
    const manual = manualAreas();
    console.log(`Protection active: ${manual.length} manual area(s)${manual.length ? ' (' + manual.map(a => `${a.name || '?'} ${a.x},${a.z} r${a.radius}`).join('; ') + ')' : ''}, ${s.built.length} detected build(s), ${s.own.size} own blocks.`);
}

// Areas set by players in chat (Xaero waypoint or !schutz). Same name and owner replaces the old one.
export function addPlayerArea(bot, {name, x, y = null, z, radius, dimension = 'overworld', owner}) {
    const s = state(bot);
    const area = {name: String(name).slice(0, 48), x: Math.round(x), y: y == null ? null : Math.round(y), z: Math.round(z),
        radius, dimension, owner, at: Date.now()};
    s.players = s.players.filter(a => !(a.owner === owner && a.name === area.name));
    s.players.push(area);
    s.savePlayers();
    console.log(`Protection: ${owner} protected "${area.name}" at ${area.x} ${area.z} r${radius} (${dimension})`);
    return area;
}

// Removes the player area at pos. Returns the area, 'none' or 'not_allowed'.
export function removePlayerAreaAt(bot, pos, username, admin = false) {
    const s = state(bot);
    const hit = s.players.filter(a => (pos.x - a.x) ** 2 + (pos.z - a.z) ** 2 <= a.radius ** 2);
    if (!hit.length) return 'none';
    const mine = hit.find(a => a.owner === username) || (admin ? hit[0] : null);
    if (!mine) return 'not_allowed';
    s.players = s.players.filter(a => a !== mine);
    s.savePlayers();
    return mine;
}

export function listAreas(bot) {
    const s = state(bot);
    return [...manualAreas().map(a => ({...a, kind: 'manual'})), ...s.players.map(a => ({...a, kind: 'player'})),
        ...s.built.map(a => ({...a, kind: 'built'}))];
}
