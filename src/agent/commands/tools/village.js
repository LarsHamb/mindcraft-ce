import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import { getHome, setHome, inHomeVillage, FILL } from "../../library/protection.js";
import { findVillage, bedsAround, villagersAround, chooseFreeBed, isNight, darkSpots, groundHoles, VILLAGE_RADIUS } from "../../library/village.js";
import { makeStash, STASH_PLACE } from "../../library/stash.js";
import { ripeCrops, CROPS } from "./harvestField.js";
import Vec3 from "vec3";

// Lars, 17.11.: "ein Dorfbewohner auf Crack". He moves into a free bed of a village, sleeps there and keeps
// the village nice. Rule "Pflegen, nicht umbauen": harvest and replant, torches, fill holes, own chest only.
const v3 = p => new Vec3(p.x, p.y, p.z);
const count = (bot, re) => bot.inventory.items().filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const fmt = p => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;

async function moveIn(agent) {
    const bot = agent.bot;
    const v = findVillage(bot);
    if (!v) return toolResult('blocked', 'No village within 128 blocks (no bell, no group of beds with villagers). Explore: walk about 200 blocks in one direction (plains, savanna, desert and taiga have villages), then call village move_in again.', 'no_village');
    const center = v.center;
    if (bot.entity.position.distanceTo(center) > 12) await skills.goToPosition(bot, center.x, center.y, center.z, 4);
    const beds = bedsAround(bot, center), villagers = villagersAround(bot, center);
    if (!beds.length) return toolResult('blocked', `Village at ${fmt(center)} found, but no bed in it.`, 'no_bed');
    const pick = chooseFreeBed(beds, villagers, isNight(bot), center);
    if (!pick) return toolResult('blocked', `All ${beds.length} beds in the village at ${fmt(center)} are taken tonight. Try again later or another village.`, 'no_free_bed');
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
    while (bot.isSleeping && !bot.interrupt_code) await new Promise(r => setTimeout(r, 500));
    return toolResult('ok', `Slept in my bed at ${fmt(bed)}; the respawn point is here.${moved}`);
}

async function care(agent) {
    const bot = agent.bot;
    const home = getHome(bot);
    if (!home?.bell) return toolResult('blocked', 'No home village yet: village move_in first.', 'no_home');
    const center = v3(home.bell);
    if (bot.entity.position.distanceTo(center) > 16) await skills.goToPosition(bot, center.x, center.y, center.z, 4);
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
            "Your village home. move_in: find a village nearby (bell, beds, villagers), move into a free bed and remember it ('zuhause', 'dorf'), with your own chest there. sleep: at night sleep in your bed (respawn point). care: keep the village nice - harvest and replant its fields, torches where it is dark, fill holes. Care only: never break or change houses, other chests, workstations, beds or villagers.",
            [new CommandProperty("mode", "move_in, sleep or care (default).", "string", false)]
        );
    }

    async execute(agent, mode = 'care') {
        mode = ['move_in', 'sleep', 'care'].includes(mode) ? mode : 'care';
        const run = {move_in: moveIn, sleep, care}[mode];
        return await agent.actions.runAction(`action:village`, () => run(agent), {timeout: mode === 'sleep' ? 10 : 8});
    }
}

export default VillageTool;
