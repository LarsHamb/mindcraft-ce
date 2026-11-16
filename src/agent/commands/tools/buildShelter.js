import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import Vec3 from "vec3";

// One tool call builds a whole small shelter (walls, roof, door gap) and verifies it afterwards.
// Before this, the model placed every block with its own placeBlockAt request (~6-7k tokens each).

const BUILD_BLOCKS = [
    /_planks$/, /^cobblestone$/, /^cobbled_deepslate$/, /^stone$/, /^dirt$/, /_log$/, /^sandstone$/,
    /^stone_bricks$/, /^bricks$/, /^deepslate$/, /^andesite$/, /^diorite$/, /^granite$/, /^tuff$/,
];
const SOFT = new Set(['air', 'cave_air', 'water', 'lava', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
    'snow', 'dead_bush', 'leaf_litter', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass']);

export function isSolidName(name) {
    if (!name || SOFT.has(name)) return false;
    return !/(flower|tulip|daisy|poppy|dandelion|orchid|allium|bluet|cornflower|lily|sapling|mushroom|vine|torch|leaves|carpet|button|pressure_plate|_door|sign|rail)/.test(name);
}

function inventoryCounts(bot) {
    const counts = {};
    for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] || 0) + item.count;
    return counts;
}

function pickMaterials(bot, wanted) {
    const counts = inventoryCounts(bot);
    const usable = Object.entries(counts).filter(([name]) => BUILD_BLOCKS.some(re => re.test(name)));
    usable.sort((a, b) => b[1] - a[1]);
    if (wanted && wanted !== 'auto') {
        const first = usable.find(([name]) => name === wanted);
        return [...(first ? [first] : []), ...usable.filter(([name]) => name !== wanted)];
    }
    return usable;
}

// Plan: footprint (w+2) x (d+2) east of the bot, walls `height` tall, flat roof on top, door gap facing the bot.
export function planShelter(origin, width, depth, height) {
    const ox = origin.x + 2, oy = origin.y, oz = origin.z - Math.floor((depth + 2) / 2);
    const doorZ = oz + 1 + Math.floor((depth - 1) / 2);
    const walls = [], roof = [], clear = [];
    for (let y = oy; y < oy + height; y++) {
        for (let x = ox; x <= ox + width + 1; x++) {
            for (let z = oz; z <= oz + depth + 1; z++) {
                const edge = x === ox || x === ox + width + 1 || z === oz || z === oz + depth + 1;
                const door = x === ox && z === doorZ && y < oy + 2;
                if (edge && !door) walls.push({x, y, z});
                else clear.push({x, y, z});
            }
        }
    }
    const cx = ox + (width + 1) / 2, cz = oz + (depth + 1) / 2;
    for (let x = ox; x <= ox + width + 1; x++)
        for (let z = oz; z <= oz + depth + 1; z++) roof.push({x, y: oy + height, z});
    // roof from the edges inward, so every block has a neighbour to build off
    roof.sort((a, b) => (Math.max(Math.abs(b.x - cx), Math.abs(b.z - cz))) - (Math.max(Math.abs(a.x - cx), Math.abs(a.z - cz))));
    return {walls, roof, clear, door: {x: ox, y: oy, z: doorZ}, inside: {x: ox + 1 + Math.floor(width / 2), y: oy, z: doorZ}};
}

class BuildShelterTool extends BaseTool {
    constructor() {
        super(
            "buildShelter",
            "Build a complete small shelter (walls, flat roof, door opening) next to you in ONE call, then verify it. " +
            "Uses building blocks from your inventory (planks, cobblestone, dirt, ...). Inner size 3x3 needs about 41 blocks. " +
            "Use this instead of many placeBlockAt calls. Reports missing blocks or holes if it could not finish.",
            [
                new CommandProperty("material", "Preferred block, e.g. oak_planks or cobblestone. 'auto' uses what you have most of.", "string", false),
                new CommandProperty("width", "Inner width (2-5). Default 3.", "integer", false),
                new CommandProperty("depth", "Inner depth (2-5). Default 3.", "integer", false),
                new CommandProperty("height", "Wall height (2-4). Default 3.", "integer", false),
                new CommandProperty("x", "Optional build origin x (from an earlier buildShelter result, to continue the same shelter).", "integer", false),
                new CommandProperty("y", "Optional build origin y.", "integer", false),
                new CommandProperty("z", "Optional build origin z.", "integer", false),
            ]
        );
    }

    async execute(agent, material = 'auto', width = 3, depth = 3, height = 3, x = null, y = null, z = null) {
        const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
        width = clamp(width, 2, 5, 3); depth = clamp(depth, 2, 5, 3); height = clamp(height, 2, 4, 3);
        const actionFn = async () => {
            const bot = agent.bot;
            const p = [x, y, z].every(Number.isFinite) ? new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)) : bot.entity.position.floored();
            const plan = planShelter(p, width, depth, height);
            const targets = [...plan.walls, ...plan.roof];
            const at = (q) => bot.blockAt(new Vec3(q.x, q.y, q.z));
            const missing = targets.filter(q => !isSolidName(at(q)?.name));
            const materials = pickMaterials(bot, material);
            const have = materials.reduce((n, [, c]) => n + c, 0);
            if (have === 0) return toolResult('blocked', `No building blocks in inventory. Need about ${missing.length}.`, 'no_material');
            skills.log(bot, `Building shelter ${width}x${depth}x${height} at ${plan.walls[0].x},${plan.walls[0].y},${plan.walls[0].z}: ${missing.length} blocks needed, have ${have}.`);

            // clear the inside (terrain, plants) so you can stand in it
            for (const q of plan.clear) {
                if (bot.interrupt_code) return toolResult('cancelled', 'Stopped while clearing.', 'interrupted');
                const b = at(q);
                if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'water') await skills.breakBlockAt(bot, q.x, q.y, q.z);
            }
            let placed = 0, failed = 0;
            for (const q of [...plan.walls, ...plan.roof]) {
                if (bot.interrupt_code) break;
                if (isSolidName(at(q)?.name)) continue;
                const left = pickMaterials(bot, material);
                if (!left.length) break;
                const ok = await skills.placeBlock(bot, left[0][0], q.x, q.y, q.z, 'bottom', true);
                if (ok) placed++; else failed++;
                if (failed >= 12 && placed === 0) break;
            }
            // door if we have one
            const door = bot.inventory.items().find(i => i.name.endsWith('_door'));
            if (door && !bot.interrupt_code) await skills.placeBlock(bot, door.name, plan.door.x, plan.door.y, plan.door.z, 'bottom', true);

            // verify against the world, not against what we think we did
            const holes = targets.filter(q => !isSolidName(at(q)?.name));
            const roofHoles = holes.filter(q => q.y === plan.roof[0].y).length;
            const where = `origin x=${p.x} y=${p.y} z=${p.z}, door at ${plan.door.x},${plan.door.y},${plan.door.z}, inside ${plan.inside.x},${plan.inside.y},${plan.inside.z}`;
            if (bot.interrupt_code) return toolResult('cancelled', `Stopped. Placed ${placed}, ${holes.length} holes left.`, 'interrupted');
            if (holes.length === 0) return toolResult('ok', `Shelter finished and verified: walls and roof closed (${placed} blocks placed). ${where}.`);
            const sample = holes.slice(0, 6).map(q => `${q.x},${q.y},${q.z}`).join(' ');
            const reason = pickMaterials(bot, material).length ? 'some placements failed' : 'ran out of building blocks';
            return toolResult(placed > 0 ? 'partial' : 'failed',
                `Shelter not closed: ${holes.length} holes (${roofHoles} in roof), ${reason}. Placed ${placed}. Holes e.g. ${sample}. ${where}. ` +
                `Get more blocks and call buildShelter again with the same origin and size, or fill holes with placeBlocks.`,
                reason === 'ran out of building blocks' ? 'no_material' : 'holes');
        };
        return await agent.actions.runAction('action:buildShelter', actionFn, {timeout: 6});
    }
}

export default BuildShelterTool;
