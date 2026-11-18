import { pickaxes } from '../../library/situation.js';
import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import { harvestRefusal } from "../../library/protection.js";
import Vec3 from "vec3";

// Lars' mine (Vorspiel 15.11.): a straight staircase at 45 degrees, 3 blocks of headroom so you never
// bump the ceiling, torches along the way, and stop at water, lava or caves instead of walking into them.

const DIRS = {north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0]};
const LIQUID = /^(water|lava|bubble_column)$/;
const OPEN = /^(air|cave_air)$/;
const FILLER = /^(cobblestone|cobbled_deepslate|dirt|stone|deepslate|andesite|diorite|granite|tuff|netherrack|gravel)$/;

function fillerBlock(bot) {
    const items = bot.inventory.items().filter(i => FILLER.test(i.name)).sort((a, b) => b.count - a.count);
    return items[0]?.name || null;
}

class DigStairsTool extends BaseTool {
    constructor() {
        super(
            "digStairs",
            "Dig a straight 45-degree mine staircase down (3 high, torches, walls off water). Use for mines instead of digDown.",
            [
                new CommandProperty("direction", "north/south/east/west, default facing.", "string", false),
                new CommandProperty("steps", "1-40.", "integer", false),
            ]
        );
    }

    async execute(agent, direction = null, steps = 16) {
        steps = Number.isFinite(steps) ? Math.max(1, Math.min(40, Math.round(steps))) : 16;
        const actionFn = async () => {
            const bot = agent.bot;
            // the way back up: the top of the staircase is remembered as 'mineneingang' (only above ground)
            const top = bot.entity.position;
            const old = agent.memory_bank?.recallPlace?.('mineneingang');
            if (top.y > 50 && (!old || Math.hypot(old[0] - top.x, old[2] - top.z) > 30)) agent.memory_bank?.rememberPlace?.('mineneingang', top.x, top.y, top.z);
            if (!DIRS[direction]) {
                const yaw = bot.entity.yaw; // mineflayer: 0 = north (-z), PI/2 = west
                const a = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                direction = a < Math.PI / 4 || a >= 7 * Math.PI / 4 ? 'north' : a < 3 * Math.PI / 4 ? 'west' : a < 5 * Math.PI / 4 ? 'south' : 'east';
            }
            const at = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
            let walled = 0, bridged = 0;
            const tryDir = async direction => {
            const [dx, dz] = DIRS[direction];
            const start = bot.entity.position.floored();
            let done = 0;
            for (let i = 1; i <= steps; i++) {
                if (bot.interrupt_code) return toolResult('cancelled', `Stopped after ${done} steps.`, 'interrupted');
                // never dig on with the last pickaxe almost broken: the way back up needs one (test 18.11.)
                const picks = pickaxes(bot);
                if (!picks.length || (picks.length === 1 && picks[0].left < 0.12))
                    return toolResult(done ? 'partial' : 'blocked', `Stopped after ${done} steps: ${picks.length ? `last pickaxe (${picks[0].name}) almost broken` : 'no pickaxe left'}. Go back up the staircase (goToRememberedPlace mineneingang) and craft new pickaxes (2 stone ones for the stone, keep the iron one for ores).`, 'tool_worn');
                const x = start.x + dx * i, y = start.y - i, z = start.z + dz * i;
                // the step: feet at y, 3 blocks of air y..y+2, plus the block above the previous step for headroom
                const cells = [[x, y, z], [x, y + 1, z], [x, y + 2, z], [x - dx, y + 2, z - dz]];
                const floor = at(x, y - 1, z);
                // look around the new cells for liquids before opening them. Liquid beside the stairs is walled off
                // with filler blocks (Lars: "Wasser zubauen"); liquid inside the stairs' own path still stops.
                const own = new Set([...cells, [x, y - 1, z]].map(c => c.join(',')));
                for (const [cx, cy, cz] of [...cells, [x, y - 1, z]]) {
                    for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]) {
                        const p = [cx + ox, cy + oy, cz + oz];
                        const n = at(...p);
                        if (!n || !LIQUID.test(n.name)) continue;
                        // also inside the stairs' path: fill it, the dig below opens it again with its neighbours sealed
                        const filler = fillerBlock(bot);
                        const sealed = filler && await skills.placeBlock(bot, filler, ...p, 'bottom', true).catch(() => false)
                            && !LIQUID.test(at(...p)?.name || '');
                        if (sealed) { walled++; continue; }
                        return toolResult(done ? 'partial' : 'blocked',
                            `Stopped after ${done} steps at y=${y + 1}: ${n.name} at ${p.join(',')}${own.has(p.join(',')) ? ' in the way of the stairs' : filler ? ' could not be walled off' : ' and no filler blocks (cobblestone, dirt) to wall it off'}. Turn or bring blocks.`, 'liquid');
                    }
                }
                if (floor && (OPEN.test(floor.name) || LIQUID.test(floor.name))) {
                    // a small pocket (solid ground right below it) gets a floor block; a real cave or drop stops
                    const below = at(x, y - 2, z), filler = fillerBlock(bot);
                    const pocket = OPEN.test(floor.name) && below && !OPEN.test(below.name) && !LIQUID.test(below.name);
                    const filled = pocket && filler && bridged < 6 && await skills.placeBlock(bot, filler, x, y - 1, z, 'bottom', true).catch(() => false)
                        && !OPEN.test(at(x, y - 1, z)?.name || 'air');
                    if (filled) bridged++;
                    else return toolResult(done ? 'partial' : 'blocked', `Stopped after ${done} steps at y=${y + 1}: open cave or drop below the next step. Avoid caves; turn and continue.`, 'cave');
                }
                for (const [cx, cy, cz] of cells) {
                    const b = at(cx, cy, cz);
                    if (!b || OPEN.test(b.name)) continue;
                    const why = harvestRefusal(bot, b);
                    if (why) return toolResult(done ? 'partial' : 'blocked', `Stopped after ${done} steps: ${why}.`, 'protected');
                    if (!await skills.breakBlockAt(bot, cx, cy, cz)) return toolResult(done ? 'partial' : 'failed', `Could not dig ${b.name} at ${cx},${cy},${cz} after ${done} steps.`, 'dig_failed');
                }
                if (!await skills.goToPosition(bot, x + 0.5, y, z + 0.5, 0.6)) return toolResult(done ? 'partial' : 'failed', `Could not step down to ${x},${y},${z} after ${done} steps.`, 'move_failed');
                done = i;
                bot.emit('mining_progress', {message: `Dug ${done} of ${steps} stair steps.`});
                if (i % 6 === 0 && bot.inventory.findInventoryItem('torch')) {
                    // torch high on the side wall of this step (y+2): the next step digs (x, y+1, z) for headroom,
                    // but never y+2 here, so the torch stays
                    const [sx, sz] = dz ? [x + 1, z] : [x, z + 1];
                    const side = at(sx, y + 2, sz);
                    if (side && !OPEN.test(side.name)) await skills.placeBlock(bot, 'torch', x, y + 2, z, 'side', true).catch(() => false);
                }
            }
            const p = bot.entity.position.floored();
            return toolResult('ok', `Dug ${done} stair steps ${direction}${walled ? `, walled off ${walled} water/lava blocks` : ''}${bridged ? `, filled ${bridged} small holes` : ''}; now at ${p.x},${p.y},${p.z}. The way back up is the staircase (its top is the place 'mineneingang': goToRememberedPlace).`);
            };
            // Boys tests 17.11.: right at a cave it stopped after 0 steps, and the model asked the same direction
            // again. At 0 steps the other directions are tried here first (sideways before back).
            let result = await tryDir(direction);
            if (result.code === 'cave' && result.status === 'blocked') {
                const order = {north: ['east', 'west', 'south'], south: ['west', 'east', 'north'], east: ['south', 'north', 'west'], west: ['north', 'south', 'east']}[direction];
                for (const other of order) {
                    if (bot.interrupt_code) break;
                    const next = await tryDir(other);
                    if (!(next.code === 'cave' && next.status === 'blocked')) { result = next; break; }
                }
            }
            return result;
        };
        // a mine entrance is meant to stay open: no surface restore for its cells
        const guarded = async () => { agent.bot.__noRestore = true; try { return await actionFn(); } finally { agent.bot.__noRestore = false; } };
        return await agent.actions.runAction('action:digStairs', guarded, {timeout: 8});
    }
}

export default DigStairsTool;
