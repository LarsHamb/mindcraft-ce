// Respect for other players' builds (ported from Jarvis kern/schutz.js).
// - Building blocks (planks, glass, doors, ...) that the bot did not place itself are never broken.
// - Logs that are not part of a natural tree (log walls, cabins, piles) count as building blocks.
// - Protected areas: settings.protected_areas [{"name","x","z","radius"}], chat areas, every bed (r 40) and
//   clusters of foreign building blocks. Inside, natural blocks may be broken to get through but are put
//   back afterwards (restore list); nothing is harvested and nothing new is placed there.
// - At the surface, holes the bot made by the way are filled again (top layer, soil with dirt), and a
//   sapling is planted where it felled a tree. See modes.js restore_blocks.
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
    const restore = loadJson(`${dir}/restore.json`, []);
    s = {
        own, built, players, restore, dir,
        saveRestore() { saveJson(`${dir}/restore.json`, s.restore); },
        savePlayers() { saveJson(`${dir}/player_areas.json`, s.players); },
        saveOwn() { while (own.size > MAX_OWN) own.delete(own.keys().next().value); saveJson(`${dir}/own_blocks.json`, Object.fromEntries(own)); },
        // s.built is replaced when areas are pruned: always save the current list
        saveBuilt() { saveJson(`${dir}/built_areas.json`, s.built); },
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
    // Inside protected areas natural blocks may be broken to get through (Lars, 17.11.): they are written to
    // the restore list and put back afterwards. Building blocks and log walls stay refused above.
    return null;
}

// Harvesting (collectBlocks targets, mine entrances) is not allowed inside protected areas at all.
export function harvestRefusal(bot, block) {
    const reason = breakRefusal(bot, block);
    if (reason) return reason;
    const area = block?.position && protectedAreaAt(bot, block.position);
    return area ? `protected area "${area.name || 'player base'}": do not harvest or dig mines there` : null;
}

// ---- Restore list: put back what was broken in protected areas or at the surface, replant saplings ----
const SOIL = /^(grass_block|dirt|podzol|mycelium|coarse_dirt|rooted_dirt|dirt_path|moss_block|mud)$/;
const NO_RESTORE = /(_leaves$|^snow$|^air$|^cave_air$|^water$|^lava$|grass$|fern$|flower|tulip|daisy|poppy|dandelion|orchid|allium|bluet|sapling|mushroom|vine|leaf_litter|bush|sugar_cane|kelp|seagrass|^ice$)/;
const MAX_RESTORE = 400;
const SAPLING_MS = 20 * 60000;

export function restoreItems(name) {
    if (SOIL.test(name)) return ['dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block']; // never cobblestone on a meadow
    if (name === 'stone') return ['stone', 'cobblestone'];
    if (name === 'deepslate') return ['deepslate', 'cobbled_deepslate'];
    if (/^deepslate_.+_ore$/.test(name)) return ['deepslate', 'cobbled_deepslate', 'stone', 'cobblestone'];
    if (/_ore$/.test(name)) return ['stone', 'cobblestone'];
    if (name === 'sandstone') return ['sandstone', 'sand'];
    if (name === 'clay') return ['clay', 'dirt'];
    return [name];
}

function saplingFor(logName) {
    const kind = LOG.exec(logName)?.[1];
    if (!kind) return null;
    return kind === 'mangrove' ? 'mangrove_propagule' : `${kind}_sapling`;
}

function isSurfaceBlock(bot, pos) {
    const above = bot.blockAt(new Vec3(pos.x, pos.y + 1, pos.z));
    return !!above && above.boundingBox === 'empty' && !/^(water|lava)$/.test(above.name) && (above.skyLight ?? 0) >= 12;
}

// Called before a dig: what to write to the restore list if the dig succeeds (or null).
export function restoreEntryFor(bot, block) {
    if (!block?.position || bot.__noRestore) return null;
    const p = block.position, name = block.name;
    const s = state(bot);
    // tree base on soil: replant (only natural trees get this far, log walls are refused)
    if (LOG.test(name)) {
        const below = bot.blockAt(new Vec3(p.x, p.y - 1, p.z));
        const sapling = saplingFor(name);
        return below && SOIL.test(below.name) && sapling ? {kind: 'sapling', x: p.x, y: p.y, z: p.z, name: sapling, items: [sapling]} : null;
    }
    if (BUILDING.test(name) || NO_RESTORE.test(name) || block.boundingBox === 'empty' || s.own.get(key(p)) === name) return null;
    const zone = protectedAreaAt(bot, p);
    if (!zone) {
        if (bot.__intentionalDig === key(p)) return null; // material it set out to collect
        if (!isSurfaceBlock(bot, p)) return null;
        // only the top layer: a deeper block under an already listed surface block is not listed again
        if (s.restore.some(e => e.kind === 'surface' && e.x === p.x && e.z === p.z && e.y > p.y)) return null;
    }
    return {kind: zone ? 'zone' : 'surface', x: p.x, y: p.y, z: p.z, name, items: restoreItems(name)};
}

export function addRestore(bot, entry) {
    const s = state(bot);
    s.restore = s.restore.filter(e => !(e.x === entry.x && e.y === entry.y && e.z === entry.z));
    s.restore.push({...entry, at: Date.now(), tries: 0});
    while (s.restore.length > MAX_RESTORE) s.restore.shift();
    s.saveRestore();
    console.log(`Restore list: ${entry.kind} ${entry.name} at ${entry.x} ${entry.y} ${entry.z} (${s.restore.length} open)`);
}

export const restoreList = bot => state(bot).restore.slice();
const restoreAt = (bot, pos) => state(bot).restore.find(e => e.x === Math.floor(pos.x) && e.y === Math.floor(pos.y) && e.z === Math.floor(pos.z));

export function finishRestore(bot, entry) {
    const s = state(bot);
    s.restore = s.restore.filter(e => e !== entry && !(e.x === entry.x && e.y === entry.y && e.z === entry.z));
    s.saveRestore();
}

// Entries that can be done now: the spot is open again, the bot is not standing in it, an item is at hand.
export function dueRestores(bot) {
    const s = state(bot);
    const me = bot.entity?.position;
    if (!me) return [];
    // open again: air, liquids and anything without a hitbox (leaf litter from the felled tree, grass, flowers)
    const open = b => !b || /^(air|cave_air|water|lava)$/.test(b.name) || b.boundingBox === 'empty';
    let changed = false;
    const due = [];
    for (const e of s.restore.slice()) {
        const b = bot.blockAt(new Vec3(e.x, e.y, e.z));
        if (!b) continue; // not loaded
        const done = e.items.includes(b.name) || (e.kind !== 'sapling' && !open(b));
        if (done || (e.kind === 'sapling' && !open(b))) { s.restore = s.restore.filter(x => x !== e); changed = true; continue; } // filled already
        if (e.kind === 'sapling' && Date.now() - e.at > SAPLING_MS) { s.restore = s.restore.filter(x => x !== e); changed = true; continue; }
        if ((e.tries || 0) >= 4) continue;
        const d = Math.hypot(e.x + 0.5 - me.x, e.y - me.y, e.z + 0.5 - me.z);
        const inside = Math.abs(e.x + 0.5 - me.x) < 0.9 && Math.abs(e.z + 0.5 - me.z) < 0.9 && e.y >= Math.floor(me.y) - 0 && e.y <= Math.floor(me.y) + 1;
        if (d > 32 || inside) continue;
        if (e.kind === 'sapling' && !SOIL.test(bot.blockAt(new Vec3(e.x, e.y - 1, e.z))?.name || '')) continue;
        if (!e.items.some(n => bot.inventory?.findInventoryItem?.(n))) continue;
        due.push({e, d});
    }
    if (changed) s.saveRestore();
    return due.sort((a, b) => a.d - b.d).map(x => x.e);
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
    // building blocks: never; natural blocks inside a protected area: allowed but expensive (prefer a detour)
    movements.exclusionAreasBreak?.push(block => (breakRefusal(bot, block) ? 100000 : block?.position && protectedAreaAt(bot, block.position) ? 40 : 0));
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

// Fallback without a waypoint (Lars, 17.11.): every bed the bot did not place itself protects radius
// BED_RADIUS around it, village beds included (villages are not to be touched either).
export const BED_RADIUS = 40;
const isBed = name => /_bed$/.test(name || '');

export function detectBeds(bot) {
    const s = state(bot);
    const beds = (bot.findBlocks({matching: b => !!b && isBed(b.name), maxDistance: 32, count: 32}) || []);
    for (const p of beds) {
        // a bed is two blocks; only one of them was recorded when the bot placed it itself
        const own = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isBed(s.own.get(key({x: p.x + dx, y: p.y, z: p.z + dz}))));
        if (own || protectedAreaAt(bot, p)) continue;
        const area = {name: `bed ${p.x},${p.z}`, kind: 'bed', bed: {x: p.x, y: p.y, z: p.z}, x: p.x, y: p.y, z: p.z, radius: BED_RADIUS, at: Date.now()};
        s.built.push(area);
        s.saveBuilt();
        console.log(`Protection: player bed at ${p.x} ${p.y} ${p.z}, protected with radius ${BED_RADIUS}`);
        return area;
    }
    return null;
}

// A detected area disappears when no foreign building block is left there (unloaded = unknown, keep it).
// A bed area disappears when its bed is gone.
export function pruneBuiltAreas(bot) {
    const s = state(bot);
    const gone = s.built.filter(a => {
        if (a.kind === 'bed') {
            const b = bot.blockAt(new Vec3(a.bed.x, a.bed.y, a.bed.z));
            return !!b && !isBed(b.name);
        }
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
            const entry = restoreEntryFor(bot, block);
            const result = await dig.call(this, block, ...rest);
            if (s.own.delete(key(block.position))) s.saveOwn();
            if (entry) addRestore(bot, entry);
            return result;
        };
    }
    const place = bot._genericPlace;
    if (typeof place === 'function') {
        bot._genericPlace = async function (referenceBlock, faceVector, ...rest) {
            const target = referenceBlock?.position && faceVector ? referenceBlock.position.plus(faceVector) : null;
            const area = protectedAreaAt(bot, target);
            // putting back what it broke there is allowed (restore list); anything else is refused
            const restoring = target && restoreAt(bot, target);
            if (area && !restoring) throw refusal('Placing a block', target, `protected area "${area.name || 'player base'}"`);
            const result = await place.call(this, referenceBlock, faceVector, ...rest);
            if (target && !restoring) {
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
        try { if (bot.entity) { detectBeds(bot); detectBuiltAreas(bot); pruneBuiltAreas(bot); } } catch (e) { console.warn('protection scan:', e.message); }
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
