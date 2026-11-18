// Lars, 18.11.: "stärker beim Kämpfen". A melee routine that fights like a player instead of mineflayer-pvp's
// plain follow-and-hit: waits for the weapon cooldown (full damage), jumps and hits while falling (critical hit,
// 1.5x), holds a shield up between hits against arrows and creepers, hits a creeper once and steps back before
// it blows, and backs off to eat when health is low. settings.combat_style: 'smart' (default) or 'basic'.
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';

const RANGED = /^(skeleton|stray|bogged|pillager|witch|blaze|ghast|evoker|illusioner)$/;
const COOLDOWN = [
    [/_sword$/, 625], [/^(wooden|stone)_axe$/, 1250], [/^(iron)_axe$/, 1110], [/^(golden|diamond|netherite)_axe$/, 1000],
    [/_pickaxe$/, 830], [/_shovel$/, 1000], [/^trident$/, 910], [/^mace$/, 1670],
];
export function cooldownMs(itemName) {
    for (const [re, ms] of COOLDOWN) if (re.test(itemName || '')) return ms;
    return 260; // hand or other items
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Strong enough to stand and fight these mobs instead of fleeing? (Lars, 18.11.: fight, do not just run) */
export function canFight(bot, mobs = []) {
    const slots = bot.inventory?.slots || [];
    const armor = [5, 6, 7, 8].filter(i => slots[i]).length;
    const shield = slots[45]?.name === 'shield' || bot.inventory.items().some(i => i.name === 'shield');
    const weapon = bot.inventory.items().some(i => /_(sword|axe)$/.test(i.name) && !/^wooden_/.test(i.name));
    const illagers = mobs.filter(m => /^(pillager|vindicator|evoker|ravager|illusioner)$/.test(m.name)).length;
    const ranged = mobs.filter(m => RANGED.test(m.name)).length;
    if (bot.health < 12 || !weapon) return false;
    if (illagers > 2 || (illagers && armor < 4)) return false;
    return (armor >= 2 || shield) && ranged <= 3;
}
const eyes = e => e.position.offset(0, (e.height || 1.8) * 0.8, 0);

/** Put the best shield in the off-hand if there is one. */
export async function equipShield(bot) {
    const off = bot.inventory.slots[45];
    if (off?.name === 'shield') return true;
    const shield = bot.inventory.items().find(i => i.name === 'shield');
    if (!shield) return false;
    try { await bot.equip(shield, 'off-hand'); return true; } catch { return false; }
}

function raiseShield(bot, on) {
    if (bot.inventory.slots[45]?.name !== 'shield') return;
    if (on && !bot.__shieldUp) { try { bot.activateItem(true); bot.__shieldUp = true; } catch {} }
    if (!on && bot.__shieldUp) { try { bot.deactivateItem(); } catch {} bot.__shieldUp = false; }
}

/** A creeper about to blow (fuse state metadata), or simply very close. */
function creeperDanger(bot, e) {
    if (e?.name !== 'creeper') return false;
    const d = e.position.distanceTo(bot.entity.position);
    const fuse = Object.values(e.metadata || {}).some(v => v === 1) && d < 4;
    return d < 2.2 || fuse;
}

/**
 * Fight one target until it is dead or gone, the bot is too hurt, or interrupted.
 * Returns 'killed' | 'gone' | 'retreat' | 'interrupted'.
 */
export async function fight(bot, target, {lowHealth = 6, maxMs = 45000, isAlive = () => true, shield = false, crit = false, kite = true} = {}) {
    const melee = bot.heldItem && bot.heldItem.name !== 'bow' ? bot.heldItem : null;
    const weapon = melee?.name || '';
    const cd = cooldownMs(weapon);
    let lastHit = 0, stepBack = 0, shotWithBow = false, closest = Infinity, closerAt = Date.now();
    const start = Date.now();
    bot.pathfinder.setMovements(new pf.Movements(bot));
    try {
        while (Date.now() - start < maxMs) {
            if (bot.interrupt_code) return 'interrupted';
            if (!target?.isValid || !bot.entities[target.id] || !isAlive(target)) return 'killed';
            const me = bot.entity.position;
            const d = target.position.distanceTo(me);
            if (d > 24) return 'gone';
            // no way to it (behind stone, across a gap): give up instead of standing there
            if (d < closest - 0.5) { closest = d; closerAt = Date.now(); }
            else if (d > 3.2 && Date.now() - closerAt > 6000) return 'gone';
            if (bot.health <= lowHealth) return 'retreat';

            // bow first where it is the better weapon (creeper at range, skeletons, flyers)
            if (bowTarget(bot, target) && !creeperDanger(bot, target)) {
                bot.pathfinder.setGoal(null);
                raiseShield(bot, false);
                await shootBow(bot, target);
                shotWithBow = true;
                continue;
            }
            if (shotWithBow) { shotWithBow = false; if (melee) await bot.equip(melee, 'hand').catch(() => {}); }
            // creeper: one hit for knockback, then back off until it calms down
            if (target.name === 'creeper' && (creeperDanger(bot, target) || Date.now() < stepBack)) {
                raiseShield(bot, true);
                const away = me.minus(target.position).normalize().scaled(5).plus(me);
                bot.pathfinder.setGoal(new pf.goals.GoalNear(away.x, me.y, away.z, 1), true);
                if (Date.now() >= stepBack) stepBack = Date.now() + 1800;
                await sleep(100);
                continue;
            }
            // keep at sword range. Close and on the same level: sprint straight at it (skeletons back off faster
            // than the pathfinder re-plans; test 18.11.: 0 hits in 20 s); otherwise let the pathfinder find the way.
            if (d > 2.8) {
                const level = Math.abs(target.position.y - me.y) < 1.5;
                if (level && d < 16) {
                    bot.pathfinder.setGoal(null);
                    await bot.lookAt(eyes(target), true).catch(() => {});
                    bot.setControlState('forward', true);
                    bot.setControlState('sprint', true);
                    bot.setControlState('jump', !!bot.entity.isCollidedHorizontally);
                } else {
                    bot.setControlState('forward', false);
                    bot.setControlState('sprint', false);
                    bot.pathfinder.setGoal(new pf.goals.GoalFollow(target, 2), true);
                }
                raiseShield(bot, shield && RANGED.test(target.name));
            } else {
                bot.setControlState('forward', false);
                bot.setControlState('sprint', false);
                bot.setControlState('jump', false);
                bot.pathfinder.setGoal(null);
            }
            await bot.lookAt(eyes(target), true).catch(() => {});
            const ready = Date.now() - lastHit >= cd;
            if (d <= 3.2 && ready) {
                // critical hit: jump, hit while falling
                if (crit && bot.entity.onGround && !bot.entity.isInWater && cd >= 500) {
                    bot.setControlState('jump', true);
                    await sleep(60);
                    bot.setControlState('jump', false);
                    for (let i = 0; i < 12 && !(bot.entity.velocity.y < -0.05); i++) await sleep(25);
                }
                raiseShield(bot, false);
                if (bot.entities[target.id] && target.position.distanceTo(bot.entity.position) <= 3.5) {
                    await bot.lookAt(eyes(target), true).catch(() => {});
                    bot.attack(target);
                    lastHit = Date.now();
                    if (target.name === 'creeper') stepBack = Date.now() + 1500;
                }
            } else if (!ready && d <= 3.2) {
                // test 18.11.: raising the shield between hits made the hits weak (0 kills); instead step back while
                // the weapon recovers, so a group cannot hit all at once
                if (shield) raiseShield(bot, true);
                const crowd = Object.values(bot.entities).filter(e => e !== target && e.type === 'hostile' && e.position.distanceTo(bot.entity.position) < 4).length;
                if (kite && (crowd > 0 || d < 1.8)) {
                    bot.setControlState('back', true);
                    await sleep(120);
                    bot.setControlState('back', false);
                }
            }
            await sleep(50);
        }
        return 'gone';
    } finally {
        raiseShield(bot, false);
        bot.pathfinder.setGoal(null);
        bot.clearControlStates?.();
    }
}

/** Walk away from the enemies and eat if there is food; used when health is low. */
export async function retreatAndEat(bot, enemies, eat) {
    const me = bot.entity.position;
    let push = new Vec3(0, 0, 0);
    for (const e of enemies) push = push.plus(me.minus(e.position).normalize());
    if (push.norm() < 0.1) push = new Vec3(1, 0, 0);
    const to = me.plus(push.normalize().scaled(12));
    raiseShield(bot, true);
    try {
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await Promise.race([bot.pathfinder.goto(new pf.goals.GoalNear(to.x, to.y, to.z, 2)).catch(() => {}), sleep(5000)]);
    } finally { raiseShield(bot, false); bot.pathfinder.setGoal(null); }
    if (eat) await eat().catch(() => {});
}

// ---- Bow (Lars, 18.11.): creepers from a distance, shoot back at skeletons, reach mobs across gaps ----
const ARROW_SPEED = 3.0, ARROW_DRAG = 0.99, ARROW_GRAVITY = 0.05;

/** Pitch (radians, up positive) that lands an arrow at horizontal distance h and height dy, or null. */
export function bowPitch(h, dy, speed = ARROW_SPEED) {
    let best = null, bestErr = Infinity;
    for (let deg = -40; deg <= 50; deg += 0.25) {
        const a = deg * Math.PI / 180;
        let x = 0, y = 0, vx = speed * Math.cos(a), vy = speed * Math.sin(a);
        for (let t = 0; t < 120 && x < h; t++) {
            x += vx; y += vy; vx *= ARROW_DRAG; vy = vy * ARROW_DRAG - ARROW_GRAVITY;
        }
        if (x < h) continue;
        const err = Math.abs(y - dy);
        if (err < bestErr) { bestErr = err; best = a; }
        if (err < 0.05) break;
    }
    return bestErr < 1 ? best : null;
}

export function hasBow(bot) {
    if (bot.__bowBroken) return false;
    const items = bot.inventory.items();
    return items.some(i => i.name === 'bow') && items.some(i => /^(arrow|tipped_arrow|spectral_arrow)$/.test(i.name));
}

/** Draw, aim with lead and release one arrow at the target. true if shot. */
export async function shootBow(bot, target) {
    const bow = bot.inventory.items().find(i => i.name === 'bow');
    if (!bow || !hasBow(bot)) return false;
    if (bot.heldItem?.name !== 'bow') { try { await bot.equip(bow, 'hand'); } catch { return false; } }
    const aim = () => {
        const eye = bot.entity.position.offset(0, 1.62, 0);
        const flightTicks = Math.min(40, target.position.distanceTo(eye) / 2.5);
        const v = target.velocity || {x: 0, y: 0, z: 0};
        const tx = target.position.x + v.x * flightTicks, tz = target.position.z + v.z * flightTicks;
        const ty = target.position.y + (target.height || 1.8) * 0.6;
        const dx = tx - eye.x, dz = tz - eye.z, h = Math.hypot(dx, dz);
        const pitch = bowPitch(h, ty - eye.y);
        if (pitch === null) return false;
        bot.look(Math.atan2(-dx, -dz), pitch, true);
        return true;
    };
    if (!aim()) return false;
    const arrows = () => bot.inventory.items().filter(i => /arrow$/.test(i.name)).reduce((n, i) => n + i.count, 0);
    const before = arrows();
    bot.activateItem();
    for (let i = 0; i < 22; i++) { await sleep(50); if (!bot.entities[target.id]) break; aim(); }
    aim();
    bot.deactivateItem();
    await sleep(300);
    // 26.3 test 18.11.: the server saw draw and release but no arrow left the bow. Two dry shots in a row turn
    // the bow off for this session, so fights go on with the sword instead of standing there drawing.
    if (arrows() >= before) { bot.__dryShots = (bot.__dryShots || 0) + 1; if (bot.__dryShots >= 2) { bot.__bowBroken = true; console.log('bow: no arrows leave the bow, using the sword'); } }
    else bot.__dryShots = 0;
    return true;
}

/** Should this target be shot rather than fought hand to hand? */
export function bowTarget(bot, target) {
    if (!hasBow(bot) || !target?.position) return false;
    const d = target.position.distanceTo(bot.entity.position);
    if (target.name === 'creeper') return d >= 5 && d <= 20;
    if (target.name === 'phantom' || target.name === 'ghast' || target.name === 'blaze') return d <= 30;
    if (RANGED.test(target.name)) return d >= 6 && d <= 24;
    return d >= 8 && d <= 20 && Math.abs(target.position.y - bot.entity.position.y) > 2; // across a gap or ledge
}
