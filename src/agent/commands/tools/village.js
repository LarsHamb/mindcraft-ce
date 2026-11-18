import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import { getHome, setHome, inHomeVillage, FILL } from "../../library/protection.js";
import { findVillage, bedsAround, villagersAround, chooseFreeBed, isNight, darkSpots, groundHoles, VILLAGE_RADIUS,
    villageWood, towerNeeds, findTowerSite, villageThreats, RANGED, TOWER_HEIGHT } from "../../library/village.js";
import { makeStash, STASH_PLACE } from "../../library/stash.js";
import { ripeCrops, CROPS } from "./harvestField.js";
import { currentCharacter } from "../../library/characters.js";
import settings from "../../settings.js";
import Vec3 from "vec3";
import pf from "mineflayer-pathfinder";

// Lars, 17.11.: "ein Dorfbewohner auf Crack". He moves into a free bed of a village, sleeps there and keeps
// the village nice. Rule "Pflegen, nicht umbauen": harvest and replant, torches, fill holes, own chest only.
const v3 = p => new Vec3(p.x, p.y, p.z);
const count = (bot, re) => bot.inventory.items().filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const fmt = p => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;

/** Walk into the home village; a failure result if it is not reached (its chunks are not even loaded then). */
async function reachVillage(bot, center) {
    if (bot.entity.position.distanceTo(center) > 16) await skills.goToPosition(bot, center.x, center.y, center.z, 4).catch(() => false);
    const d = Math.round(bot.entity.position.distanceTo(center));
    return d > 24 ? toolResult('failed', `Could not reach my village at ${fmt(center)} (still ${d} blocks away). Walk there first: goToRememberedPlace dorf.`, 'move_failed') : null;
}

/** Walk a long way in legs of at most 40 blocks (one long path times out on 26.3). */
async function walkFar(bot, target) {
    for (let leg = 0; leg < 30 && !bot.interrupt_code; leg++) {
        const me = bot.entity.position, far = Math.hypot(target.x - me.x, target.z - me.z);
        if (far <= 12) return true;
        const k = Math.min(1, 36 / far);
        const x = Math.floor(me.x + (target.x - me.x) * k), z = Math.floor(me.z + (target.z - me.z) * k);
        try { await skills.goToGoal(bot, new pf.goals.GoalNearXZ(x, z, 3)); } catch {}
        if (bot.entity.position.distanceTo(me) < 2) return false; // no progress on this leg
    }
    return Math.hypot(target.x - bot.entity.position.x, target.z - bot.entity.position.z) <= 12;
}

async function moveIn(agent) {
    const bot = agent.bot;
    let v = findVillage(bot);
    // live 18.11.: "no village" and then walking off the wrong way. A known village (settings.village_hint,
    // set from /locate) is walked to first.
    const hint = settings.village_hint;
    if (!v && hint && Number.isFinite(hint.x) && Number.isFinite(hint.z)) {
        await walkFar(bot, hint);
        v = findVillage(bot, 64);
        if (!v && Math.hypot(hint.x - bot.entity.position.x, hint.z - bot.entity.position.z) <= 24)
            v = {center: new Vec3(Math.floor(hint.x), Math.floor(hint.y ?? bot.entity.position.y), Math.floor(hint.z)), by: 'hint'};
        if (!v) return toolResult('failed', `Walked towards the known village at ${fmt(hint)} but did not get there (now ${fmt(bot.entity.position)}). Try village move_in again; it walks in short legs.`, 'move_failed');
    }
    if (!v) return toolResult('blocked', 'No village within 128 blocks (no bell, no group of beds with villagers). Explore: walk about 200 blocks in one direction (plains, savanna, desert and taiga have villages), then call village move_in again.', 'no_village');
    const center = v.center;
    if (bot.entity.position.distanceTo(center) > 12) await skills.goToPosition(bot, center.x, center.y, center.z, 4);
    // taiga villages are spread out: a bed 66 blocks from the bell (live 18.11.)
    const beds = bedsAround(bot, center, 80), villagers = villagersAround(bot, center, 80);
    let pick = beds.length ? chooseFreeBed(beds, villagers, isNight(bot), center) : null;
    if (!pick) {
        // no (free) bed: bring its own bed into the village, or live there without one for now
        const own = bot.inventory.items().find(i => /_bed$/.test(i.name));
        if (own) {
            // home village first, so the protection rules let him put his own bed there
            setHome(bot, {bell: {x: center.x, y: center.y, z: center.z}, bed: null, radius: VILLAGE_RADIUS, sure: false});
            const me = bot.entity.position.floored();
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
                if (await skills.placeBlock(bot, own.name, me.x + dx, me.y, me.z + dz).catch(() => false)) {
                    const placed = bedsAround(bot, me, 4)[0];
                    if (placed) { pick = {bed: placed, sure: true, note: 'my own bed, placed in the village'}; break; }
                }
            }
        }
        if (!pick) {
            setHome(bot, {bell: {x: center.x, y: center.y, z: center.z}, bed: null, radius: VILLAGE_RADIUS, sure: false});
            agent.memory_bank?.rememberPlace?.('dorf', center.x, center.y, center.z);
            const why = beds.length ? `all ${beds.length} beds are taken` : 'it has no bed';
            return toolResult('partial', `Moved into the village at ${fmt(center)} without a bed (${why}); remembered 'dorf'. Make a bed: 3 wool (shear or kill 3 sheep, or 4 string make 1 wool) + 3 planks at a crafting table, then village move_in again here to place it. Until then stay in the village at night (buildShelter next to the houses), do not walk away.`, 'no_bed');
        }
    }
    const bed = pick.bed.pos;
    if (!await skills.goToPosition(bot, bed.x, bed.y, bed.z, 2))
        return toolResult('failed', `Could not reach the free bed at ${fmt(bed)}.`, 'move_failed');
    setHome(bot, {bell: {x: center.x, y: center.y, z: center.z}, bed: {x: bed.x, y: bed.y, z: bed.z}, radius: VILLAGE_RADIUS, sure: pick.sure});
    agent.memory_bank?.rememberPlace?.('zuhause', bed.x, bed.y, bed.z);
    agent.memory_bank?.rememberPlace?.('dorf', center.x, center.y, center.z);
    let chest = '';
    const lager = agent.memory_bank?.recallPlace?.(STASH_PLACE);
    const chestHere = lager && Math.hypot(lager[0] - bed.x, lager[2] - bed.z) <= 6;
    if (!chestHere && (count(bot, /^chest$/) || count(bot, /_planks$/) >= 8)) {
        const err = await makeStash(bot, agent);
        chest = err ? ` No chest yet: ${err}` : ` Own chest placed in the house ('${STASH_PLACE}').`;
    } else if (!chestHere) chest = ' Bring a chest or 8 planks, then stash make inside the house.';
    return toolResult('ok', `Moved into the house with the bed at ${fmt(bed)} (${pick.note}) in the village at ${fmt(center)}: ${beds.length} beds, ${villagers.length} villagers. Remembered 'zuhause' and 'dorf'.${chest} Sleep here at night (village sleep), keep the village nice (village care). Care only: never change houses, other chests, workstations or villagers.`);
}

async function sleep(agent) {
    const bot = agent.bot;
    const home = getHome(bot);
    if (!home?.bed) return toolResult('blocked', 'No home yet: village move_in first.', 'no_home');
    // the dusk hint comes about a minute early: wait for the night instead of giving up
    for (let i = 0; i < 100 && !isNight(bot) && !bot.interrupt_code && bot.time?.timeOfDay >= 11000; i++) await new Promise(r => setTimeout(r, 1000));
    if (!isNight(bot)) return toolResult('blocked', `Not night yet (time ${bot.time?.timeOfDay}). Sleep after dusk; work until then.`, 'not_night');
    // test 18.11.: when the night does not pass he went to bed 37 times in 20 minutes. Once per night is enough.
    if ((agent.__sleptAt || bot.__sleptAt) && Date.now() - Math.max(agent.__sleptAt || 0, bot.__sleptAt || 0) < 5 * 60000)
        return toolResult('blocked', 'I already lay down this night and it did not pass (others awake or time stands still). Do not try to sleep again tonight: stay safe in the house, keep watch (village watch) or do indoor work until morning.', 'night_continues');
    let bed = v3(home.bed);
    if (bot.entity.position.distanceTo(bed) > 3 && !await skills.goToPosition(bot, bed.x, bed.y, bed.z, 2))
        return toolResult('failed', `Could not reach my bed at ${fmt(bed)}.`, 'move_failed');
    let block = bot.blockAt(bed);
    const occupied = b => { const p = b?.getProperties?.() || {}; return p.occupied === true || p.occupied === 'true'; };
    let moved = '';
    if (!block || !/_bed$/.test(block.name) || occupied(block)) {
        const center = v3(home.bell);
        const pick = chooseFreeBed(bedsAround(bot, center), villagersAround(bot, center), true, center, [bed]);
        if (!pick) return toolResult('blocked', 'My bed is taken and no other bed in the village is free tonight. Dig in or sleep in the shelter.', 'no_free_bed');
        bed = pick.bed.pos;
        if (!await skills.goToPosition(bot, bed.x, bed.y, bed.z, 2)) return toolResult('failed', `Could not reach the free bed at ${fmt(bed)}.`, 'move_failed');
        setHome(bot, {...home, bed: {x: bed.x, y: bed.y, z: bed.z}, sure: true});
        agent.memory_bank?.rememberPlace?.('zuhause', bed.x, bed.y, bed.z);
        block = bot.blockAt(bed);
        moved = ` A villager sleeps in my old bed: moved to the free bed at ${fmt(bed)}.`;
    }
    try { await bot.sleep(block); }
    catch (e) { return toolResult('failed', `Could not sleep: ${e.message}.${moved}`, 'sleep_failed'); }
    if (!home.sure) setHome(bot, {...getHome(bot), sure: true});
    bot.modes?.pause?.('unstuck');
    // Lars, 17.11.: if the night is not skipped (not enough players asleep), get up and keep watch
    const lay = Date.now();
    while (bot.isSleeping && !bot.interrupt_code) {
        await sleepMs(500);
        // a character that does not guard (guard: false) just stays in bed
        if (Date.now() - lay > 15000 && isNight(bot) && currentCharacter(agent)?.guard !== false) {
            try { await bot.wake(); } catch {}
            const w = await watch(agent);
            return toolResult(w.outcome || 'ok', `Respawn point set at my bed ${fmt(bed)}. Not enough players asleep, so I got up and kept watch: ${w.message || w.reason || ''}${moved}`);
        }
    }
    agent.__sleptAt = bot.__sleptAt = Date.now();
    if (isNight(bot)) return toolResult('ok', `Lay in my bed at ${fmt(bed)} (respawn point set), but the night goes on. Do not sleep again tonight: stay in the house or keep watch until morning.${moved}`);
    return toolResult('ok', `Slept in my bed at ${fmt(bed)}; the respawn point is here.${moved}`);
}

const sleepMs = ms => new Promise(r => setTimeout(r, ms));

/** Night watch (and raids): wait at the tower or the bell, fight mobs that come into the village. */
async function watch(agent) {
    const bot = agent.bot;
    const home = getHome(bot);
    if (!home?.bell) return toolResult('blocked', 'No home village yet: village move_in first.', 'no_home');
    const center = v3(home.bell);
    const t = agent.memory_bank?.recallPlace?.('wachturm');
    const post = t ? new Vec3(Math.floor(t[0]), Math.floor(t[1]), Math.floor(t[2])) : center;
    const far = await reachVillage(bot, center);
    if (far) return far;
    bot.modes?.pause?.('unstuck');
    const toPost = () => bot.entity.position.distanceTo(post) > 3 ? skills.goToPosition(bot, post.x, post.y, post.z, t ? 0 : 3).catch(() => false) : true;
    await toPost();
    const start = Date.now();
    let kills = 0;
    while (!bot.interrupt_code && Date.now() - start < 7 * 60000) {
        const threats = villageThreats(bot, center);
        if (!isNight(bot) && !threats.length) break;
        if (bot.health <= 8) { await toPost(); await sleepMs(3000); continue; }
        const me = bot.entity.position;
        // ranged mobs only when they are close; never walk out to them
        const target = threats.filter(e => !RANGED.test(e.name) || e.position.distanceTo(me) < 6)
            .sort((a, b) => (a.name === 'creeper') - (b.name === 'creeper') || a.position.distanceTo(me) - b.position.distanceTo(me))[0];
        if (!target) { await sleepMs(2000); continue; }
        if (await skills.attackEntity(bot, target, true)) kills++;
        if (bot.entity.position.distanceTo(post) > 12) await toPost();
    }
    if (bot.interrupt_code) return toolResult('cancelled', `Watch stopped after ${kills} kills.`, 'interrupted');
    const why = isNight(bot) ? 'watch time is up, call village watch again if the night goes on' : 'the night is over';
    return toolResult('ok', `Kept watch at ${t ? 'the watchtower' : 'the bell'}: ${kills} mobs defeated, ${why}.`);
}

/** Jump and put a block under the feet (tower up one block). */
async function jumpPlace(bot, name) {
    const item = bot.inventory.items().find(i => i.name === name);
    if (!item) return false;
    await bot.equip(item, 'hand');
    const p = bot.entity.position.floored();
    const ref = bot.blockAt(p.offset(0, -1, 0));
    if (!ref || ref.boundingBox !== 'block') return false;
    await bot.look(bot.entity.yaw, -Math.PI / 2, true);
    bot.setControlState('jump', true);
    const t0 = Date.now();
    while (bot.entity.position.y < p.y + 1.1 && Date.now() - t0 < 1200) await sleepMs(30);
    try { await bot.placeBlock(ref, new Vec3(0, 1, 0)); } catch {}
    bot.setControlState('jump', false);
    await sleepMs(400);
    return bot.blockAt(p)?.name === name;
}

async function haveOrCraft(bot, name, want, per) {
    const have = () => count(bot, new RegExp(`^${name}$`));
    if (have() < want) await skills.craftRecipe(bot, name, Math.ceil((want - have()) / per)).catch(() => {});
    return have();
}

/** A watchtower in the village style at the village edge (Lars, 17.11.: village chief, safety). */
async function tower(agent) {
    const bot = agent.bot;
    const home = getHome(bot);
    if (!home?.bell) return toolResult('blocked', 'No home village yet: village move_in first.', 'no_home');
    // climbing up while building does not work on 26.3 yet (test 17.11.): off unless settings.village_tower
    if (!settings.village_tower) return toolResult('blocked', 'Building the watchtower is not ready yet. Guard the village from the bell instead (village watch) and keep it lit (village care).', 'tower_off');
    const old = agent.memory_bank?.recallPlace?.('wachturm');
    if (old) return toolResult('ok', `The village already has my watchtower at ${old.map(Math.round).join(',')}. Keep watch there at night (village watch).`);
    const center = v3(home.bell), wood = villageWood(bot, center), need = towerNeeds(wood);
    const planks = `${wood}_planks`, fence = `${wood}_fence`;
    await haveOrCraft(bot, planks, need[planks] + 2, 4);
    await haveOrCraft(bot, fence, need[fence], 3);
    await haveOrCraft(bot, 'ladder', need.ladder, 3);
    await haveOrCraft(bot, 'torch', need.torch, 4);
    const short = ([n, c]) => count(bot, new RegExp(`^${n}$`)) < c;
    const missing = Object.entries(need).filter(short).map(([n, c]) => `${c - count(bot, new RegExp(`^${n}$`))} ${n}`);
    if (missing.length) return toolResult('blocked', `For a watchtower in the village style (${wood}) I still need ${missing.join(', ')} (about ${Math.ceil((need[planks] + 20) / 4)} ${wood}_log in all). Get them, then village tower again.`, 'materials');
    const far = await reachVillage(bot, center);
    if (far) return far;
    const site = findTowerSite(bot, center, bot.entity.position);
    if (!site) return toolResult('blocked', 'No flat free spot at the village edge for a tower (5x5, away from houses, paths and fields).', 'no_site');
    await skills.goToPosition(bot, site.x + 0.5, site.y, site.z + 0.5, 0);
    if (!bot.entity.position.floored().equals(site))
        return toolResult('failed', `Could not stand on the tower spot ${fmt(site)}.`, 'move_failed');
    bot.modes?.pause?.('unstuck');
    const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let levels = 0;
    for (let l = 0; l < TOWER_HEIGHT && !bot.interrupt_code; l++) {
        const y = site.y + l;
        for (const [dx, dz] of ring) await skills.placeBlock(bot, planks, site.x + dx, y, site.z + dz);
        await skills.placeBlock(bot, 'ladder', site.x, y, site.z + 2, 'north');
        if (!await jumpPlace(bot, planks)) break;
        levels++;
    }
    if (levels < TOWER_HEIGHT) return toolResult('failed', `Tower stopped at level ${levels}/${TOWER_HEIGHT} at ${fmt(site)} (could not climb). Its blocks are mine; finish or remove it.`, 'tower_failed');
    const top = site.y + TOWER_HEIGHT;
    for (const [dx, dz] of ring) if (!(dx === 0 && dz === 1)) await skills.placeBlock(bot, fence, site.x + dx, top, site.z + dz);
    for (const [dx, dz] of ring.slice(4)) await skills.placeBlock(bot, 'torch', site.x + dx, top + 1, site.z + dz);
    agent.memory_bank?.rememberPlace?.('wachturm', site.x, top, site.z);
    return toolResult('ok', `Watchtower built at ${fmt(site)} (${wood}, ${TOWER_HEIGHT} high, ladder on the south side, fence and torches on top). Remembered 'wachturm'. Keep watch there at night (village watch).`);
}

async function care(agent) {
    const bot = agent.bot;
    const home = getHome(bot);
    if (!home?.bell) return toolResult('blocked', 'No home village yet: village move_in first.', 'no_home');
    const center = v3(home.bell);
    const far = await reachVillage(bot, center);
    if (far) return far;
    // scanning and short walks look like standing still: no unstuck reflex during care
    bot.modes?.pause?.('unstuck');
    const done = [];
    // 1. fields: harvest what is ripe and sow again
    const ripe = ripeCrops(bot, center, 40).filter(b => inHomeVillage(bot, b.position)).slice(0, 32);
    let harvested = 0, sown = 0;
    for (const b of ripe) {
        if (bot.interrupt_code) break;
        const crop = CROPS[b.name], pos = b.position;
        // harvested crops are not broken landscape: no restore entry for them (walking there still restores)
        bot.__noRestore = true;
        let broke;
        try { broke = await skills.breakBlockAt(bot, pos.x, pos.y, pos.z); } finally { bot.__noRestore = false; }
        if (!broke) continue;
        harvested++;
        if (harvested % 4 === 0 || !count(bot, new RegExp(`^${crop.seed}$`))) await skills.pickupNearbyItems(bot).catch(() => {});
        if (count(bot, new RegExp(`^${crop.seed}$`)) && await skills.tillAndSow(bot, pos.x, pos.y - 1, pos.z, crop.seed)) sown++;
    }
    if (harvested) { await skills.pickupNearbyItems(bot).catch(() => {}); done.push(`harvested ${harvested} crops, sowed ${sown}`); }
    // 2. torches where it is dark
    if (count(bot, /^torch$/) < 4 && count(bot, /^(coal|charcoal)$/) && count(bot, /^stick$/)) await skills.craftRecipe(bot, 'torch', 2).catch(() => {});
    let torches = 0;
    const spots = darkSpots(bot, center, 32, Math.min(8, count(bot, /^torch$/)));
    for (const p of spots) {
        if (bot.interrupt_code || !count(bot, /^torch$/)) break;
        if (bot.entity.position.distanceTo(p) > 4 && !await skills.goToPosition(bot, p.x, p.y, p.z, 3)) continue;
        if (await skills.placeBlock(bot, 'torch', p.x, p.y, p.z)) torches++;
    }
    if (torches) done.push(`placed ${torches} torches`);
    else if (spots.length === 0) done.push('no dark spots');
    // 3. holes in the ground
    let filled = 0;
    for (const p of groundHoles(bot, center, 24, 12)) {
        if (bot.interrupt_code) break;
        const item = bot.inventory.items().find(i => /^(dirt|coarse_dirt)$/.test(i.name)) || bot.inventory.items().find(i => FILL.test(i.name));
        if (!item) { done.push('no dirt or cobblestone left for holes'); break; }
        if (bot.entity.position.distanceTo(p) > 4 && !await skills.goToPosition(bot, p.x, p.y, p.z, 3)) continue;
        if (await skills.placeBlock(bot, item.name, p.x, p.y, p.z)) filled++;
    }
    if (filled) done.push(`filled ${filled} holes`);
    if (bot.interrupt_code) return toolResult('cancelled', `Stopped: ${done.join(', ') || 'nothing yet'}.`, 'interrupted');
    const torchHint = count(bot, /^torch$/) ? '' : ' Out of torches: get coal and sticks.';
    return toolResult('ok', `Village care at ${fmt(center)}: ${done.join(', ') || 'nothing to do'}.${torchHint}`);
}

class VillageTool extends BaseTool {
    constructor() {
        super(
            "village",
            "Your village home; you are its chief and its guard. move_in: find a village nearby (bell, beds, villagers), move into a free bed and remember it ('zuhause', 'dorf'), with your own chest there. sleep: at night sleep in your bed (respawn point); if the night is not skipped you get up and keep watch. care: harvest and replant its fields, torches where it is dark, fill holes. tower: build a watchtower in the village wood style at the village edge. watch: guard the village from the tower or the bell and fight mobs coming in (night, raids). Never break or change existing houses, other chests, workstations, beds, villagers or golems.",
            [new CommandProperty("mode", "move_in, sleep, care (default), tower or watch.", "string", false)]
        );
    }

    async execute(agent, mode = 'care') {
        mode = ['move_in', 'sleep', 'care', 'tower', 'watch'].includes(mode) ? mode : 'care';
        const run = {move_in: moveIn, sleep, care, tower, watch}[mode];
        return await agent.actions.runAction(`action:village`, () => run(agent), {timeout: mode === 'sleep' ? 10 : 8});
    }
}

export default VillageTool;
