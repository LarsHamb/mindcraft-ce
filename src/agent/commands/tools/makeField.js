import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import * as world from "../../library/world.js";
import { toolResult } from "../../tool_result.js";
import { protectedAreaAt } from "../../library/protection.js";
import Vec3 from "vec3";

// Lars, 17.11.: "ein Feld anlegen". Farmland must have water within 4 blocks at the same level, so the
// field is laid out around a still water block; the bot tills with a hoe and sows what it has.

const SEEDS = {wheat: 'wheat_seeds', wheat_seeds: 'wheat_seeds', seeds: 'wheat_seeds', carrot: 'carrot', carrots: 'carrot',
    potato: 'potato', potatoes: 'potato', beetroot: 'beetroot_seeds', beetroot_seeds: 'beetroot_seeds'};
const SOIL = /^(grass_block|dirt|dirt_path|farmland)$/;
const CLEARABLE = /^(air|cave_air|short_grass|grass|tall_grass|fern|large_fern|leaf_litter|snow|dandelion|poppy|cornflower|azure_bluet|oxeye_daisy|allium|.*_tulip|bush|short_dry_grass|tall_dry_grass|firefly_bush|wildflowers)$/;

export function seedItem(name) {
    return SEEDS[String(name || 'wheat').toLowerCase()] || null;
}

/** Soil blocks next to still water that can become a hydrated field, nearest to the water first. */
export function fieldPlan(bot, cells, {waterRange = 24} = {}) {
    const waters = world.getNearestBlocksWhere(bot, b => b.name === 'water' && b.metadata === 0, waterRange, 60);
    let best = [];
    for (const w of waters) {
        if (protectedAreaAt(bot, w.position)) continue;
        const spots = [];
        for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
            if (!dx && !dz) continue;
            const p = w.position.offset(dx, 0, dz);
            const soil = bot.blockAt(p), above = bot.blockAt(p.offset(0, 1, 0));
            if (!soil || !above || !SOIL.test(soil.name) || !CLEARABLE.test(above.name)) continue;
            if (protectedAreaAt(bot, p)) continue;
            spots.push({pos: p, soil: soil.name, d: Math.max(Math.abs(dx), Math.abs(dz)) + Math.hypot(dx, dz) / 10});
        }
        spots.sort((a, b) => a.d - b.d);
        if (spots.length > best.length) best = spots.map(s => ({...s, water: w.position}));
        if (best.length >= cells) break;
    }
    return best.slice(0, cells);
}

function count(bot, name) {
    return bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
}

class MakeFieldTool extends BaseTool {
    constructor() {
        super(
            "makeField",
            "Lay out a farm field beside still water: till with a hoe and sow seeds (wheat_seeds, carrot, potato, beetroot_seeds). Needs a hoe and the seeds in inventory; remembers the place as 'feld'.",
            [
                new CommandProperty("seed", "wheat (default), carrot, potato or beetroot.", "string", false),
                new CommandProperty("cells", "Number of farmland blocks, 4-40, default 16.", "integer", false),
            ]
        );
    }

    async execute(agent, seed = 'wheat', cells = 16) {
        cells = Number.isFinite(cells) ? Math.max(4, Math.min(40, Math.round(cells))) : 16;
        const actionFn = async () => {
            const bot = agent.bot;
            const seedName = seedItem(seed);
            if (!seedName) return toolResult('failed', `Unknown seed "${seed}". Use wheat, carrot, potato or beetroot.`, 'bad_seed');
            if (!bot.inventory.items().some(i => i.name.endsWith('_hoe')))
                return toolResult('blocked', 'No hoe in inventory. Craft one first (wooden_hoe: 2 planks + 2 sticks), then call makeField again.', 'no_hoe');
            const seeds = count(bot, seedName);
            if (!seeds) return toolResult('blocked', `No ${seedName}. ${seedName === 'wheat_seeds' ? 'Break short_grass or tall_grass to get wheat_seeds (collectBlocks short_grass), then call makeField again.' : `Get ${seedName} first.`}`, 'no_seeds');
            const plan = fieldPlan(bot, Math.min(cells, seeds));
            if (!plan.length) return toolResult('blocked', 'No still water with free grass or dirt beside it within 24 blocks. Go to a river or pond (searchForBlock water), or bring a water_bucket.', 'no_water');
            let tilled = 0, sown = 0, failed = 0;
            for (const spot of plan) {
                if (bot.interrupt_code) break;
                if (!count(bot, seedName)) break;
                const before = bot.blockAt(spot.pos);
                const ok = await skills.tillAndSow(bot, spot.pos.x, spot.pos.y, spot.pos.z, seedName);
                const now = bot.blockAt(spot.pos), crop = bot.blockAt(spot.pos.offset(0, 1, 0));
                if (now?.name === 'farmland' && before?.name !== 'farmland') tilled++;
                if (crop && !/air/.test(crop.name)) sown++;
                else if (!ok) failed++;
                if (failed >= 4 && !sown) break;
            }
            const w = plan[0].water;
            if (sown) agent.memory_bank?.rememberPlace?.('feld', w.x, w.y + 1, w.z);
            if (bot.interrupt_code) return toolResult('cancelled', `Stopped: ${tilled} tilled, ${sown} sown.`, 'interrupted');
            if (!sown) return toolResult('failed', `Could not sow (${tilled} tilled, ${failed} failed). Check hoe and seeds, or try another water spot.`, 'sow_failed');
            return toolResult(sown < plan.length ? 'partial' : 'ok',
                `Field beside water at ${w.x},${w.y},${w.z}: ${tilled} newly tilled, ${sown} sown with ${seedName} (${count(bot, seedName)} left). Saved as place 'feld'. Crops are ripe in about 20-30 minutes; harvest with collectBlocks on the grown crop.`);
        };
        return await agent.actions.runAction('action:makeField', actionFn, {timeout: 6});
    }
}

export default MakeFieldTool;
