// Lars, 17.11.: CheesyNPC lives in a village ("Dorf-Kriegsminister"): he moves into a free bed, sleeps there
// at night and keeps the village nice (harvest and replant its fields, torches, fill holes, own chest).
// Pure helpers here (testable); the tool is commands/tools/village.js.
import Vec3 from 'vec3';
import { isGroundHole, inHomeVillage, BUILDING } from './protection.js';

export const VILLAGE_SEARCH = 128;
export const VILLAGE_RADIUS = 48;
const VILLAGER = /^(villager)$/;
const LIGHT = /(torch|lantern|glowstone|sea_lantern|shroomlight|campfire|jack_o_lantern|froglight|redstone_lamp|lava)$/;

export const isNight = bot => {
    const t = bot.time?.timeOfDay;
    return (Number.isFinite(t) && t >= 12542 && t <= 23460) || !!bot.thunderState;
};

const props = b => b?.getProperties?.() || b?._properties || {};
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Bed heads around center: [{pos, occupied}] (a bed is two blocks; the head carries the state). */
export function bedsAround(bot, center, radius = VILLAGE_RADIUS) {
    const found = bot.findBlocks({matching: b => !!b && /_bed$/.test(b.name), maxDistance: radius + 16, count: 128}) || [];
    const out = [];
    for (const p of found) {
        if (flat(p, center) > radius) continue;
        const b = bot.blockAt(p);
        if (!b || !/_bed$/.test(b.name)) continue;
        const pr = props(b);
        if (pr.part && pr.part !== 'head') continue;
        out.push({pos: new Vec3(p.x, p.y, p.z), occupied: pr.occupied === true || pr.occupied === 'true', name: b.name});
    }
    return out;
}

export function villagersAround(bot, center, radius = VILLAGE_RADIUS) {
    return Object.values(bot.entities || {}).filter(e => e && VILLAGER.test(e.name || '') && e.position && flat(e.position, center) <= radius)
        .map(e => ({pos: e.position, sleeping: e.metadata?.[6] === 2 || e.pose === 2}));
}

/**
 * Choose a free bed. At night a bed is free when nobody sleeps in it; by day (guess) when no villager is right
 * at it, preferring spare beds near the village center. Returns {bed, sure, note} or null.
 */
export function chooseFreeBed(beds, villagers, night, center, avoid = []) {
    const notAvoided = beds.filter(b => !avoid.some(a => a && flat(a, b.pos) < 1 && Math.abs(a.y - b.pos.y) < 2));
    const free = notAvoided.filter(b => !b.occupied && !villagers.some(v => v.sleeping && v.pos.distanceTo?.(b.pos) < 1.6));
    if (!free.length) return null;
    const crowd = b => villagers.filter(v => v.pos.distanceTo?.(b.pos) < 3).length;
    free.sort((a, b) => crowd(a) - crowd(b) || flat(a.pos, center) - flat(b.pos, center));
    const spare = beds.length - villagers.length;
    const note = night ? 'nobody sleeps in it tonight'
        : spare > 0 ? `${spare} bed(s) more than villagers: probably free; check at night`
        : 'as many villagers as beds: maybe taken, check at night';
    return {bed: free[0], sure: night, note};
}

/** The village center: its bell, else the middle of a cluster of at least 3 beds with villagers. */
export function findVillage(bot, radius = VILLAGE_SEARCH) {
    const me = bot.entity.position;
    const bells = (bot.findBlocks({matching: b => !!b && b.name === 'bell', maxDistance: radius, count: 8}) || [])
        .sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
    if (bells.length) return {center: new Vec3(bells[0].x, bells[0].y, bells[0].z), by: 'bell'};
    const beds = bedsAround(bot, me, radius);
    if (beds.length >= 3) {
        const c = beds.reduce((m, b) => m.plus(b.pos), new Vec3(0, 0, 0)).scaled(1 / beds.length).floored();
        if (villagersAround(bot, c, VILLAGE_RADIUS).length >= 2) return {center: c, by: 'beds'};
    }
    return null;
}

/** Ground spots in the village that are dark: no light source within 7 blocks, open sky, solid natural ground. */
export function darkSpots(bot, center, radius = 32, max = 8) {
    const lights = (bot.findBlocks({matching: b => !!b && LIGHT.test(b.name), maxDistance: radius + 24, count: 512}) || []);
    const lit = p => lights.some(l => Math.abs(l.x - p.x) <= 7 && Math.abs(l.z - p.z) <= 7 && Math.abs(l.y - p.y) <= 4);
    const out = [];
    for (let dx = -radius; dx <= radius && out.length < max * 3; dx += 4) for (let dz = -radius; dz <= radius; dz += 4) {
        if (Math.hypot(dx, dz) > radius) continue;
        const p = surfaceAt(bot, center.x + dx, center.z + dz, center.y);
        if (!p || lit(p) || out.some(o => flat(o, p) < 8)) continue;
        const ground = bot.blockAt(p.offset(0, -1, 0));
        if (!ground || !/^(grass_block|dirt|coarse_dirt|podzol|stone|cobblestone|sand|gravel|dirt_path|andesite|diorite|granite|moss_block)$/.test(ground.name)) continue;
        if (light(bot, p) > 7) continue;
        out.push(p);
    }
    return out.sort((a, b) => flat(a, center) - flat(b, center)).slice(0, max);
}

function light(bot, p) {
    const b = bot.blockAt(p);
    return Number.isFinite(b?.light) ? b.light : 0;
}

/** First air block above solid ground on column x,z (open to the sky), searched around y. */
export function surfaceAt(bot, x, z, y) {
    for (let yy = y + 10; yy >= y - 10; yy--) {
        const b = bot.blockAt(new Vec3(x, yy, z));
        if (!b) return null;
        if (b.boundingBox !== 'block') continue;
        if (/_leaves$|water|lava/.test(b.name) || BUILDING.test(b.name)) return null;
        const above = new Vec3(x, yy + 1, z);
        const a = bot.blockAt(above);
        if (!a || !/^(air|cave_air|short_grass|tall_grass|fern)$/.test(a.name)) return null;
        return above;
    }
    return null;
}

/** Holes in the village ground (creeper craters, dug spots): the lowest air block of each, deepest first. */
export function groundHoles(bot, center, radius = 32, max = 12) {
    const out = [];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (Math.hypot(dx, dz) > radius) continue;
        const p = surfaceAt(bot, center.x + dx, center.z + dz, center.y);
        if (p && inHomeVillage(bot, p) && isGroundHole(bot, p)) out.push(p);
    }
    return out.sort((a, b) => a.y - b.y || flat(a, center) - flat(b, center)).slice(0, max);
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo'];
/** The wood the village houses are built of (most planks/logs around the bell); oak if unclear. */
export function villageWood(bot, center, radius = VILLAGE_RADIUS) {
    const n = {};
    const found = bot.findBlocks({matching: b => !!b && /_(planks|log|stairs|fence)$/.test(b.name), maxDistance: radius, count: 400}) || [];
    for (const p of found) {
        if (flat(p, center) > radius) continue;
        const name = bot.blockAt(p)?.name || '';
        const w = WOODS.filter(w => name.startsWith(w + '_')).sort((a, b) => b.length - a.length)[0];
        if (w) n[w] = (n[w] || 0) + 1;
    }
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'oak';
}

export const TOWER_HEIGHT = 6;
/** What a watchtower needs: solid 3x3 column of planks, a ladder outside, fences and torches on top. */
export function towerNeeds(wood, h = TOWER_HEIGHT) {
    return {[`${wood}_planks`]: 9 * h, [`${wood}_fence`]: 7, ladder: h, torch: 4};
}

/** A tower site at the village edge: flat 5x5 natural ground, nothing built within 3 blocks. */
export function findTowerSite(bot, center, near) {
    const sites = [];
    for (let r = 16; r <= 28; r += 4) for (let a = 0; a < 16; a++) {
        const x = Math.round(center.x + r * Math.cos(a * Math.PI / 8)), z = Math.round(center.z + r * Math.sin(a * Math.PI / 8));
        const p = surfaceAt(bot, x, z, center.y);
        if (!p || !inHomeVillage(bot, p)) continue;
        let ok = true;
        for (let dx = -2; dx <= 2 && ok; dx++) for (let dz = -2; dz <= 2 && ok; dz++) {
            const q = surfaceAt(bot, x + dx, z + dz, p.y);
            const g = q && bot.blockAt(q.offset(0, -1, 0));
            if (!q || q.y !== p.y || !g || /^(dirt_path|farmland)$|water/.test(g.name)) ok = false;
        }
        if (!ok) continue;
        const built = bot.findBlocks({matching: b => !!b && BUILDING.test(b.name) && !/torch$/.test(b.name), maxDistance: 3, point: p, count: 1}) || [];
        if (built.some(q => Math.abs(q.x - p.x) <= 3 && Math.abs(q.z - p.z) <= 3 && Math.abs(q.y - p.y) <= 4)) continue;
        sites.push(p);
    }
    const ref = near || center;
    return sites.sort((a, b) => flat(a, ref) - flat(b, ref))[0] || null;
}

const HOSTILE = /^(zombie|husk|drowned|zombie_villager|spider|cave_spider|vindicator|evoker|ravager|witch|pillager|skeleton|stray|bogged|creeper|slime|phantom|vex|illusioner)$/;
export const RANGED = /^(pillager|skeleton|stray|bogged|witch|evoker|illusioner)$/;
/** Hostile mobs inside the village, nearest to the center first. */
export function villageThreats(bot, center, radius = VILLAGE_RADIUS) {
    return Object.values(bot.entities || {}).filter(e => e?.position && HOSTILE.test(e.name || '') && flat(e.position, center) <= radius
        && Math.abs(e.position.y - center.y) <= 16).sort((a, b) => flat(a.position, center) - flat(b.position, center));
}
