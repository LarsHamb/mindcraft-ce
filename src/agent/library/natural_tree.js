// Natural tree detection (ported from Jarvis kern/baum.js).
// A log belongs to a tree only with matching leaves on it and natural soil under the trunk.
// Log walls, cabins and log piles are player-built: they count as building blocks, never as wood to harvest.
import Vec3 from 'vec3';

export const LOG = /^(?!stripped_)(.+)_log$/;
export const SOIL = /^(dirt|grass_block|podzol|moss_block|coarse_dirt|rooted_dirt|mud|mycelium|muddy_mangrove_roots|mangrove_roots)$/;
const RADIUS = 6;          // logs at most this far (horizontally) from the first log
const MAX_LOGS = 60;
const MAX_GIANT = 140;     // 2x2 trunks (spruce, jungle, dark oak)
const LEAF_DIST = 4;
const MIN_LEAVES = 3;      // leaves touching the logs
const CACHE_MS = 30000;
const FELLING_MS = 10 * 60000; // once a tree is recognised, its logs stay harvestable while it is being felled

const key = p => `${p.x},${p.y},${p.z}`;
const p3 = (x, y, z) => ({x, y, z});

function leavesMatch(kind, name) {
    if (name === `${kind}_leaves`) return true;
    return kind === 'oak' && /^(flowering_)?azalea_leaves$/.test(name);
}

function flood(bot, start, name, center, accept = () => true) {
    const seen = new Set([key(start)]);
    const logs = [start];
    for (let i = 0; i < logs.length; i++) {
        const s = logs[i];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const q = p3(s.x + dx, s.y + dy, s.z + dz);
            const kq = key(q);
            if (seen.has(kq)) continue;
            seen.add(kq);
            if (Math.hypot(q.x - center.x, q.z - center.z) > RADIUS) continue;
            const b = bot.blockAt(new Vec3(q.x, q.y, q.z));
            if (!b || b.name !== name || !accept(q)) continue;
            logs.push(q);
            if (logs.length > MAX_GIANT) return null;
        }
    }
    return logs;
}

// visited: filled with every log found, also when it is not a tree (for the cache)
export function detectTree(bot, pos, isBuildingBlock, visited = null) {
    const start = p3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    const b0 = bot.blockAt(new Vec3(start.x, start.y, start.z));
    const m = b0 && LOG.exec(b0.name);
    if (!m) return null;
    const kind = m[1], name = b0.name;
    const first = flood(bot, start, name, start);
    if (!first) return null;
    if (visited) visited.push(...first);
    // Trunk at the bottom: at most 2x2. More logs on the ground means a wall or pile next to it.
    const minY = Math.min(...first.map(s => s.y));
    const bottom = first.filter(s => s.y === minY);
    const span = a => Math.max(...bottom.map(s => s[a])) - Math.min(...bottom.map(s => s[a]));
    if (bottom.length > 4 || span('x') > 1 || span('z') > 1) return null;
    if (!bottom.some(s => SOIL.test(bot.blockAt(new Vec3(s.x, s.y - 1, s.z))?.name || ''))) return null;
    const base = bottom.sort((a, b) => a.x - b.x || a.z - b.z)[0];
    const column = new Set(bottom.map(s => `${s.x},${s.z}`));
    const nearLeaves = q => {
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++)
            if (leavesMatch(kind, bot.blockAt(new Vec3(q.x + dx, q.y + dy, q.z + dz))?.name)) return true;
        return false;
    };
    // A log touching a building block (plank, glass, door ...) is a house beam, not a branch.
    const atBuilding = q => {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const b = bot.blockAt(new Vec3(q.x + dx, q.y + dy, q.z + dz));
            if (b && isBuildingBlock(b.name)) return true;
        }
        return false;
    };
    const logs = flood(bot, base, name, base, q => column.has(`${q.x},${q.z}`)
        ? !atBuilding(q) || q.y <= minY + 1 : nearLeaves(q) && !atBuilding(q));
    if (!logs) return null;
    if (logs.length > MAX_LOGS && bottom.length < 4) return null;
    let touching = 0;
    const lo = p3(Math.min(...logs.map(s => s.x)) - LEAF_DIST, minY, Math.min(...logs.map(s => s.z)) - LEAF_DIST);
    const hi = p3(Math.max(...logs.map(s => s.x)) + LEAF_DIST, Math.max(...logs.map(s => s.y)) + LEAF_DIST, Math.max(...logs.map(s => s.z)) + LEAF_DIST);
    for (let x = lo.x; x <= hi.x && touching < MIN_LEAVES; x++) for (let y = lo.y; y <= hi.y && touching < MIN_LEAVES; y++) for (let z = lo.z; z <= hi.z; z++) {
        if (!leavesMatch(kind, bot.blockAt(new Vec3(x, y, z))?.name)) continue;
        let d = Infinity;
        for (const s of logs) { d = Math.min(d, Math.max(Math.abs(s.x - x), Math.abs(s.y - y), Math.abs(s.z - z))); if (d <= 1) break; }
        if (d <= 1 && ++touching >= MIN_LEAVES) break;
    }
    if (touching < MIN_LEAVES) return null;
    return {kind, name, logs, base};
}

// Cached question for the protection layer; the pathfinder asks often.
export function createTreeCheck(bot, isBuildingBlock, now = Date.now) {
    const cache = new Map();
    const felling = new Map(); // log key -> until
    return function isTreeLog(pos) {
        const k = key(p3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
        if ((felling.get(k) || 0) > now()) return true;
        const e = cache.get(k);
        if (e && now() - e.at < CACHE_MS) return e.yes;
        if (cache.size > 5000) cache.clear();
        if (felling.size > 5000) for (const [fk, until] of felling) if (until < now()) felling.delete(fk);
        const visited = [];
        const tree = detectTree(bot, pos, isBuildingBlock, visited);
        const at = now();
        // a "no" holds for every log found (a cabin: one search, not one per log), a "yes" only for the tree
        for (const s of visited) cache.set(key(s), {yes: false, at});
        if (tree) for (const s of tree.logs) { cache.set(key(s), {yes: true, at}); felling.set(key(s), at + FELLING_MS); }
        const yes = !!(tree && tree.logs.some(s => key(s) === k));
        cache.set(k, {yes, at});
        return yes;
    };
}
