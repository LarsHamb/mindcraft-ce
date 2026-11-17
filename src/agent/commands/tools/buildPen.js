import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import { protectedAreaAt } from "../../library/protection.js";
import { BREED_FOOD } from "./breedAnimals.js";
import Vec3 from "vec3";

// Lars, 17.11.: bred animals should stay: a fenced pen with a gate, and the animals led in with their food.
export function planPen(origin, size) {
    const x0 = origin.x + 2, z0 = origin.z - Math.floor(size / 2), y = origin.y;
    const ring = [];
    for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++)
        if (x === x0 || x === x0 + size - 1 || z === z0 || z === z0 + size - 1) ring.push({x, y, z});
    const gate = {x: x0, y, z: z0 + Math.floor(size / 2)};
    return {fences: ring.filter(q => !(q.x === gate.x && q.z === gate.z)), gate, center: {x: x0 + Math.floor(size / 2), y, z: z0 + Math.floor(size / 2)}};
}

// Lars, 17.11.: a pen on uneven ground had steps in its fence. Find the flattest spot nearby, then level it:
// dig what sticks out, fill what is missing (dirt/cobblestone), so the whole pen is on one height.
const SOFT = /^(air|cave_air|short_grass|tall_grass|grass|fern|large_fern|leaf_litter|snow|dandelion|poppy|.*_tulip|cornflower|azure_bluet|oxeye_daisy|allium|bush|short_dry_grass|tall_dry_grass|firefly_bush|wildflowers|dead_bush|sweet_berry_bush|pink_petals)$/;
const FILL = /^(dirt|coarse_dirt|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|gravel|sand)$/;

/** Height a mob stands at on column x,z (first solid ground below), or null over water, trees or unknown. */
export function standY(bot, x, z, hint) {
    for (let y = hint + 6; y >= hint - 8; y--) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b) return null;
        if (SOFT.test(b.name)) continue;
        if (/water|lava|_leaves$|_log$|_wood$/.test(b.name) || b.boundingBox !== 'block') return null;
        return y + 1;
    }
    return null;
}

export function footprint(origin, size) {
    const x0 = origin.x + 2, z0 = origin.z - Math.floor(size / 2), cells = [];
    for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) cells.push({x, z});
    return cells;
}

/** The nearby spot that needs the least digging and filling for a flat size x size pen. */
export function findPenSite(bot, size, radius = 16) {
    const me = bot.entity.position.floored();
    let best = null;
    for (let dx = -radius; dx <= radius; dx += 3) for (let dz = -radius; dz <= radius; dz += 3) {
        const origin = {x: me.x + dx, y: me.y, z: me.z + dz};
        const cells = footprint(origin, size);
        const hs = [];
        let bad = false;
        for (const c of cells) {
            const h = standY(bot, c.x, c.z, me.y);
            if (h === null || protectedAreaAt(bot, new Vec3(c.x, h, c.z))?.owner) { bad = true; break; }
            hs.push(h);
        }
        if (bad) continue;
        const target = [...hs].sort((a, b) => a - b)[Math.floor(hs.length / 2)];
        const work = hs.reduce((n, h) => n + Math.abs(h - target), 0);
        const score = work + Math.hypot(dx, dz) * 0.3;
        if (!best || score < best.score) best = {origin: {...origin, y: target}, target, work, score, cells: cells.map((c, i) => ({...c, h: hs[i]}))};
    }
    return best;
}

const count = (bot, re) => bot.inventory.items().filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);

class BuildPenTool extends BaseTool {
    constructor() {
        super(
            "buildPen",
            "Build a fenced animal pen with a gate on the flattest ground nearby (levels it; fences and a gate are crafted from planks and sticks if missing), then lead nearby animals of a type in by holding their food. Use size 9 or more for a herd you want to breed. Remembers it as 'weide'.",
            [
                new CommandProperty("animal", "Animal to lead in (cow, sheep, pig, chicken), optional.", "string", false),
                new CommandProperty("size", "Side length 5-15, default 9 (room for a growing herd).", "integer", false),
            ]
        );
    }

    async execute(agent, animal = null, size = 9) {
        size = Number.isFinite(size) ? Math.max(5, Math.min(15, Math.round(size))) : 9;
        const actionFn = async () => {
            const bot = agent.bot;
            // a pen it already started close by is finished, not started again elsewhere (Boys test: 4 half pens)
            const old = agent.memory_bank?.recallPlace?.('weide');
            const me = bot.entity.position.floored();
            const reuse = old && Math.hypot(old[0] - me.x, old[2] - me.z) < 20;
            let plan, levelled = 0;
            if (reuse) plan = planPen(new Vec3(Math.floor(old[0]) - 2 - Math.floor(size / 2), Math.floor(old[1]), Math.floor(old[2])), size);
            else {
                const site = findPenSite(bot, size);
                if (!site) return toolResult('blocked', `No spot of ${size}x${size} on firm ground nearby (water, trees or player areas). Go to open grassland and try again, or a smaller size.`, 'no_site');
                if (site.work > size * size * 1.5) return toolResult('blocked', `The flattest spot nearby still needs ${site.work} blocks dug or filled. Go to flatter ground (a meadow) and try again.`, 'uneven');
                plan = planPen(new Vec3(site.origin.x, site.target, site.origin.z), size);
                // level: dig what sticks out above the target height, fill holes below it
                const T = site.target;
                // first dig (that yields dirt for filling), then fill
                for (const c of site.cells) {
                    if (bot.interrupt_code) break;
                    for (let y = c.h - 1; y >= T; y--) {
                        const b = bot.blockAt(new Vec3(c.x, y, c.z));
                        if (b && !SOFT.test(b.name) && await skills.breakBlockAt(bot, c.x, y, c.z)) levelled++;
                    }
                    if (c.h > T) bot.emit('mining_progress', {message: `Levelling the pen: ${levelled} blocks.`});
                }
                await skills.pickupNearbyItems(bot).catch(() => {});
                for (const c of site.cells) {
                    if (bot.interrupt_code) break;
                    for (let y = c.h; y < T; y++) {
                        const filler = bot.inventory.items().filter(i => FILL.test(i.name)).sort((a, b) => b.count - a.count)[0]?.name;
                        if (!filler) break;
                        if (await skills.placeBlock(bot, filler, c.x, y, c.z, 'bottom', true)) levelled++;
                    }
                    bot.emit('mining_progress', {message: `Levelling the pen: ${levelled} blocks.`});
                }
                await skills.pickupNearbyItems(bot).catch(() => {});
            }
            const groundY = q => { const below = bot.blockAt(new Vec3(q.x, q.y - 1, q.z)); return below && below.boundingBox !== 'block' ? q.y - 1 : q.y; };
            if ([...plan.fences, plan.gate].some(q => protectedAreaAt(bot, q)?.owner)) return toolResult('blocked', 'That is inside a player\'s area. Build the pen at your own place.', 'protected_area');
            const need = plan.fences.length;
            // craft what is missing: fence = 4 planks + 2 sticks -> 3, gate = 2 planks + 4 sticks
            const fences = () => count(bot, /_fence$/), gates = () => count(bot, /_fence_gate$/);
            const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'))?.name;
            const wood = planks ? planks.replace('_planks', '') : 'oak';
            for (let i = 0; fences() < need && i < 12; i++) if (!await skills.craftRecipe(bot, `${wood}_fence`, Math.ceil((need - fences()) / 3))) break;
            if (!gates()) await skills.craftRecipe(bot, `${wood}_fence_gate`, 1);
            if (fences() < need) return toolResult('blocked', `Need ${need} fences, have ${fences()}. Fences: 4 planks + 2 sticks make 3 (about ${Math.ceil((need - fences()) / 3) * 4} planks more).`, 'no_material');
            let placed = 0;
            for (const q of plan.fences) {
                if (bot.interrupt_code) break;
                const name = bot.inventory.items().find(i => i.name.endsWith('_fence'))?.name;
                if (!name) break;
                const y = groundY(q); // follow the ground one block down
                const here = bot.blockAt(new Vec3(q.x, y, q.z));
                if (here && /_fence$/.test(here.name)) { placed++; continue; }
                if (await skills.placeBlock(bot, name, q.x, y, q.z, 'bottom', true)) placed++;
                bot.emit('mining_progress', {message: `Pen: ${placed} fences placed.`});
            }
            const gateName = bot.inventory.items().find(i => i.name.endsWith('_fence_gate'))?.name;
            const gy = groundY(plan.gate), gateHere = bot.blockAt(new Vec3(plan.gate.x, gy, plan.gate.z));
            const gateOk = /_fence_gate$/.test(gateHere?.name || '') || (gateName ? await skills.placeBlock(bot, gateName, plan.gate.x, gy, plan.gate.z, 'bottom', true) : false);
            agent.memory_bank?.rememberPlace?.('weide', plan.center.x, plan.center.y, plan.center.z);
            let led = 0;
            const food = animal && (BREED_FOOD[animal] || []).find(f => count(bot, new RegExp(`^${f}$`)));
            if (food && gateOk && !bot.interrupt_code) {
                // animals follow a player holding their food within ~8 blocks: walk to them, then into the pen
                const herd = Object.values(bot.entities).filter(e => e.name === animal && e.position.distanceTo(bot.entity.position) < 48).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
                if (herd.length) {
                    // animals keep up only at walking pace: short legs with pauses, holding the food
                    const lureTo = async (tx, ty, tz) => {
                        for (let i = 0; i < 20 && !bot.interrupt_code; i++) {
                            const me = bot.entity.position, d = Math.hypot(tx - me.x, tz - me.z);
                            if (d < 1.5) break;
                            const k = Math.min(1, 3 / d);
                            await skills.equip(bot, food);
                            await skills.goToPosition(bot, me.x + (tx - me.x) * k, ty, me.z + (tz - me.z) * k, 1);
                            await new Promise(r => setTimeout(r, 900));
                        }
                    };
                    await skills.goToPosition(bot, herd[0].position.x, herd[0].position.y, herd[0].position.z, 3);
                    await lureTo(plan.gate.x - 2, gy, plan.gate.z);   // in front of the gate
                    await lureTo(plan.gate.x + 2, gy, plan.gate.z);   // through it
                    await lureTo(plan.center.x, plan.center.y, plan.center.z);
                    await new Promise(r => setTimeout(r, 5000));
                    const inPen = e => Math.abs(e.position.x - plan.center.x - 0.5) < size / 2 - 0.5 && Math.abs(e.position.z - plan.center.z - 0.5) < size / 2 - 0.5;
                    led = Object.values(bot.entities).filter(e => e.name === animal && inPen(e)).length;
                    // step out through the gate and close it behind
                    await skills.goToPosition(bot, plan.gate.x - 2, gy, plan.gate.z, 1);
                    const g = bot.blockAt(new Vec3(plan.gate.x, gy, plan.gate.z));
                    if (g && /_fence_gate$/.test(g.name) && g.getProperties?.().open === true) await bot.activateBlock(g).catch(() => {});
                }
            }
            if (bot.interrupt_code) return toolResult('cancelled', `Stopped: ${placed} fences placed.`, 'interrupted');
            const text = `Pen ${size}x${size} at ${plan.center.x},${plan.center.y},${plan.center.z} (place 'weide')${levelled ? `, ground levelled (${levelled} blocks)` : ''}: ${placed}/${need} fences${gateOk ? ', gate set' : ', no gate'}` +
                (animal ? `; ${led} ${animal} inside${food ? '' : ` (no ${(BREED_FOOD[animal] || ['food']).join('/')} to lure them)`}.` : '.') + ' Breed them there with breedAnimals.';
            return toolResult(placed >= need - 2 && gateOk ? 'ok' : 'partial', text);
        };
        // levelled ground is meant to stay so: no restore entries while building the pen
        const guarded = async () => { agent.bot.__noRestore = true; try { return await actionFn(); } finally { agent.bot.__noRestore = false; } };
        return await agent.actions.runAction('action:buildPen', guarded, {timeout: 10});
    }
}

export default BuildPenTool;
