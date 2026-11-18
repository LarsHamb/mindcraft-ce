// Lars, 18.11. ("ja bitte die lernings umsetzten"), from the live day at the gravel pit: a pillager patrol made
// him flee every 14 s for a long time ("reflex flee mob:pillager"), and he never got to the village.
// - Armored and armed: fight the pillagers on purpose; close the crossbow distance fast with the shield up,
//   never stand and trade shots in crossbow range.
// - Without armor: flee ONCE far away (or into the house when the village is near), then leave that patrol alone
//   for a few minutes instead of fleeing and coming back in a loop.
// - A patrol or a raid near the home village: ring the village bell and warn in chat (the villager's job).
// Also the evening walk home (leave in time, the walk counted in) and the "no bunker in the wild" rule.
import Vec3 from 'vec3';
import { ILLAGERS } from './danger.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const FLEE_FAR = 64;          // blocks away from the patrol
export const FLEE_QUIET_MS = 4 * 60000; // after fleeing: no new flee unless they come close
export const CROSSBOW_RANGE = 16;    // inside this a pillager shoots; outside it only follows
export const VILLAGE_ALARM = 96;     // a patrol this close to the bell is a threat for the village
export const ALARM_MS = 5 * 60000;

const armorCount = bot => [5, 6, 7, 8].filter(i => bot.inventory?.slots?.[i]).length;
const hasWeapon = bot => (bot.inventory?.items?.() || []).some(i => /_(sword|axe)$/.test(i.name) && !/^wooden_|_pickaxe$/.test(i.name));
const hasShield = bot => bot.inventory?.slots?.[45]?.name === 'shield' || (bot.inventory?.items?.() || []).some(i => i.name === 'shield');

/**
 * What to do about illagers: 'fight' | 'flee_home' | 'flee' | 'ignore'.
 * s = {armor, weapon, shield, health, illagers:[{name, d}], fledRecently, homeDist, nearVillage}
 */
export function illagerResponse(s) {
    const list = s.illagers || [];
    if (!list.length) return 'ignore';
    const closest = Math.min(...list.map(i => i.d));
    const heavy = list.some(i => /^(ravager|evoker)$/.test(i.name));
    const strong = s.weapon && s.armor >= 2 && s.health >= 14 && !heavy && list.length <= 3 && (s.armor >= 3 || s.shield || list.length <= 2);
    if (strong) return closest <= 32 ? 'fight' : 'ignore';
    // already fled from this patrol: only react again when they really come close
    if (s.fledRecently && closest > 20) return 'ignore';
    if (closest > 40) return 'ignore';
    if (Number.isFinite(s.homeDist) && s.homeDist <= 48) return 'flee_home';
    return 'flee';
}

/** A point FLEE_FAR blocks away from the threats; towards home when home lies away from them. */
export function fleePoint(me, threats, home = null, far = FLEE_FAR) {
    let ax = 0, az = 0;
    for (const t of threats) { const dx = me.x - t.x, dz = me.z - t.z, n = Math.hypot(dx, dz) || 1; ax += dx / n; az += dz / n; }
    let n = Math.hypot(ax, az);
    if (n < 0.1) { ax = 1; az = 0; n = 1; }
    ax /= n; az /= n;
    if (home) {
        const hx = home.x - me.x, hz = home.z - me.z, hn = Math.hypot(hx, hz) || 1;
        // home is roughly away from the patrol (less than ~70 degrees off): run home instead
        if ((hx / hn) * ax + (hz / hn) * az > 0.35) return {x: home.x, y: home.y, z: home.z, home: true};
    }
    return {x: Math.round(me.x + ax * far), y: Math.round(me.y), z: Math.round(me.z + az * far), home: false};
}

/** Ticks (1/20 s) the walk home takes, with the pathfinder's detours: about 2 blocks per second. */
export const walkTicks = dist => Math.round(dist / 2 * 20);
/** Time of day to start walking home so he is there before dusk (12000), with a margin. Never before noon. */
export const leaveAt = dist => Math.max(6000, 12000 - walkTicks(dist) - 800);

/**
 * May he build a bunker or dig in out here? With a home only in a real emergency.
 * s = {hasHome, homeDist, time, health, hostileNear, armored}
 */
export function wildShelterAllowed(s) {
    if (!s.hasHome || !(s.homeDist > 24)) return true;
    if (s.health < 10 || s.hostileNear) return true;
    const night = s.time >= 12542 && s.time <= 23460;
    // at night without armor and far away the walk is the bigger danger
    if (night && !s.armored && s.homeDist > 100) return true;
    return false;
}

/** The home village bell block, or null. */
export function findBell(bot, home) {
    if (!home?.bell) return null;
    const at = bot.blockAt?.(new Vec3(home.bell.x, home.bell.y, home.bell.z));
    if (at?.name === 'bell') return at;
    const found = bot.findBlocks?.({point: new Vec3(home.bell.x, home.bell.y, home.bell.z), matching: b => b?.name === 'bell', maxDistance: 24, count: 1}) || [];
    return found.length ? bot.blockAt(found[0]) : null;
}

/** Walk to the bell (if close enough and not right next to the illagers) and ring it a few times. */
export async function ringBell(bot, skills, bell, illagers) {
    if (!bell) return false;
    const me = bot.entity.position;
    if (bell.position.distanceTo(me) > 48) return false;
    if (illagers.some(e => e.position.distanceTo(bell.position) < 10)) return false;
    if (bell.position.distanceTo(me) > 3.5) {
        const ok = await Promise.race([skills.goToPosition(bot, bell.position.x, bell.position.y, bell.position.z, 2).catch(() => false), sleep(30000).then(() => false)]);
        if (!ok && bell.position.distanceTo(bot.entity.position) > 4) return false;
    }
    for (let i = 0; i < 3; i++) { try { await bot.activateBlock(bot.blockAt(bell.position)); } catch {} await sleep(600); }
    return true;
}

/** The state for illagerResponse from the bot. */
export function illagerState(bot, illagers, home, fledUntil = 0, now = Date.now()) {
    const me = bot.entity.position;
    const ref = home?.bed || home?.bell;
    return {
        armor: armorCount(bot), weapon: hasWeapon(bot), shield: hasShield(bot), health: bot.health,
        illagers: illagers.map(e => ({name: e.name, d: e.position.distanceTo(me)})),
        fledRecently: fledUntil > now,
        homeDist: ref ? Math.hypot(me.x - ref.x, me.z - ref.z) : Infinity,
        nearVillage: !!home?.bell && illagers.some(e => Math.hypot(e.position.x - home.bell.x, e.position.z - home.bell.z) <= VILLAGE_ALARM),
    };
}

export const illagersIn = (entities, me, r = 48) => Object.values(entities || {}).filter(e => e?.position && ILLAGERS.has(e.name) && e.position.distanceTo(me) <= r);
