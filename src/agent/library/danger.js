// Danger zones (Boys server, 17.11.): pillagers shot the bot twice, once although it "knew" to avoid them.
// Ranged mobs are recognised early and fled from; where pillagers (or other illagers) were seen, an area
// becomes a no-go zone for a while (a patrol or an outpost), and the pathfinder routes around it.

export const RANGED = new Set(['pillager', 'skeleton', 'stray', 'bogged', 'parched', 'witch', 'blaze', 'ghast', 'evoker', 'illusioner']);
export const ILLAGERS = new Set(['pillager', 'vindicator', 'evoker', 'ravager', 'illusioner']);
const ZONE_RADIUS = 48;
const PATROL_MS = 15 * 60000;
const OUTPOST_MS = 60 * 60000; // three or more illagers together: an outpost or a big patrol

const zones = new WeakMap();
const list = bot => { let z = zones.get(bot); if (!z) { z = []; zones.set(bot, z); } return z; };

export function dangerZones(bot, now = Date.now()) {
    const z = list(bot).filter(a => a.until > now);
    zones.set(bot, z);
    return z;
}

export function dangerAt(bot, pos, now = Date.now()) {
    if (!pos) return null;
    return dangerZones(bot, now).find(a => (pos.x - a.x) ** 2 + (pos.z - a.z) ** 2 <= a.radius ** 2) || null;
}

// Mark the area around seen illagers. Returns the zone if a new one was made.
export function markIllagers(bot, entities, now = Date.now()) {
    const seen = entities.filter(e => ILLAGERS.has(e.name) && e.position);
    if (!seen.length) return null;
    const c = {x: Math.round(seen.reduce((n, e) => n + e.position.x, 0) / seen.length), z: Math.round(seen.reduce((n, e) => n + e.position.z, 0) / seen.length)};
    const until = now + (seen.length >= 3 ? OUTPOST_MS : PATROL_MS);
    const old = dangerAt(bot, c, now);
    if (old) { old.until = Math.max(old.until, until); return null; }
    const zone = {name: seen.length >= 3 ? 'pillager outpost or patrol' : 'pillagers', x: c.x, z: c.z, radius: ZONE_RADIUS, until};
    list(bot).push(zone);
    console.log(`Danger zone: ${zone.name} at ${c.x} ${c.z} (r${ZONE_RADIUS}) for ${Math.round((until - now) / 60000)} min`);
    return zone;
}

// Pathfinder: walking into a danger zone is very expensive, so routes go around it.
// Test 18.11.: standing INSIDE a zone, every step cost 200, the path search timed out ("No path to the goal")
// and he stood still under crossbow fire until he died (likely also the live hang at the gravel pit). Inside a
// zone only steps further in cost; steps that keep or grow the distance to its center are free, so he gets out.
export function dangerStepCost(bot, block, now = Date.now()) {
    const p = block?.position;
    if (!p) return 0;
    const me = bot?.entity?.position;
    for (const a of dangerZones(bot, now)) {
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        if (d > a.radius) continue;
        const mine = me ? Math.hypot(me.x - a.x, me.z - a.z) : Infinity;
        if (mine <= a.radius && d >= mine - 1) continue;
        return 200;
    }
    return 0;
}
