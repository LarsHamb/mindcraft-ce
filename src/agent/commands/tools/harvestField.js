import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import Vec3 from "vec3";

// Lars, 17.11.: the field from makeField should feed him for good: harvest what is ripe and sow again.
export const CROPS = {wheat: {ripe: 7, seed: 'wheat_seeds'}, carrots: {ripe: 7, seed: 'carrot'}, potatoes: {ripe: 7, seed: 'potato'}, beetroots: {ripe: 3, seed: 'beetroot_seeds'}};

export function cropAge(block) {
    const age = block?.getProperties?.().age ?? block?._properties?.age ?? block?.metadata;
    return Number.isFinite(Number(age)) ? Number(age) : -1;
}

export function ripeCrops(bot, center, radius = 8) {
    const out = [];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -2; dy <= 2; dy++) {
        const b = bot.blockAt(center.offset(dx, dy, dz));
        const crop = b && CROPS[b.name];
        if (crop && cropAge(b) >= crop.ripe) out.push(b);
    }
    return out.sort((a, b) => a.position.distanceTo(center) - b.position.distanceTo(center));
}

class HarvestFieldTool extends BaseTool {
    constructor() {
        super(
            "harvestField",
            "Go to your field (place 'feld'), harvest every ripe crop, pick up the harvest and sow again. Unripe crops are left. Wheat: 3 make bread (craftRecipe bread).",
            [new CommandProperty("radius", "Field radius around 'feld', 3-12, default 8.", "integer", false)]
        );
    }

    async execute(agent, radius = 8) {
        radius = Number.isFinite(radius) ? Math.max(3, Math.min(12, Math.round(radius))) : 8;
        const actionFn = async () => {
            const bot = agent.bot;
            const p = agent.memory_bank?.recallPlace?.('feld');
            if (!p) return toolResult('blocked', "No field yet (place 'feld'). Make one with makeField first.", 'no_field');
            const center = new Vec3(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));
            if (bot.entity.position.distanceTo(center) > 6 && !await skills.goToPosition(bot, center.x, center.y, center.z, 3))
                return toolResult('failed', `Could not reach the field at ${center.x},${center.y},${center.z}.`, 'move_failed');
            const ripe = ripeCrops(bot, center, radius);
            if (!ripe.length)
                return toolResult('ok', `Nothing ripe yet on the field at ${center.x},${center.y},${center.z}. Crops need about 20-30 minutes; come back later.`);
            const count = name => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
            const before = {wheat: count('wheat'), carrot: count('carrot'), potato: count('potato'), beetroot: count('beetroot')};
            let harvested = 0, replanted = 0;
            for (const b of ripe) {
                if (bot.interrupt_code) break;
                const crop = CROPS[b.name], pos = b.position;
                if (!await skills.breakBlockAt(bot, pos.x, pos.y, pos.z)) continue;
                harvested++;
                bot.emit('mining_progress', {message: `Harvesting: ${harvested} of ${ripe.length}.`});
                if (count(crop.seed) || harvested % 4 === 0) await skills.pickupNearbyItems(bot).catch(() => {});
                if (count(crop.seed) && await skills.tillAndSow(bot, pos.x, pos.y - 1, pos.z, crop.seed)) replanted++;
            }
            await skills.pickupNearbyItems(bot).catch(() => {});
            const got = Object.entries(before).map(([k, v]) => [k, count(k) - v]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
            if (bot.interrupt_code) return toolResult('cancelled', `Stopped after ${harvested} crops.`, 'interrupted');
            return toolResult(harvested ? 'ok' : 'failed', `Harvested ${harvested} ripe crops${got ? ` (${got})` : ''} and sowed ${replanted} again.${count('wheat') >= 3 ? ' Enough wheat for bread: craftRecipe bread.' : ''}`);
        };
        // harvested crops are not "broken landscape": no restore entries for them
        const guarded = async () => { agent.bot.__noRestore = true; try { return await actionFn(); } finally { agent.bot.__noRestore = false; } };
        return await agent.actions.runAction('action:harvestField', guarded, {timeout: 5});
    }
}

export default HarvestFieldTool;
