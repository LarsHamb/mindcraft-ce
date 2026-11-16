import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";
import Vec3 from "vec3";

// Places many blocks with ONE model request instead of one placeBlockAt request per block.

const MAX_BLOCKS = 128;

export function parsePositions(text) {
    const out = [];
    for (const part of String(text || '').split(/[;\n|]+/)) {
        const nums = part.trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (nums.length !== 3 || !nums.every(Number.isFinite)) continue;
        out.push({x: Math.floor(nums[0]), y: Math.floor(nums[1]), z: Math.floor(nums[2])});
    }
    return out;
}

class PlaceBlocksTool extends BaseTool {
    constructor() {
        super(
            "placeBlocks",
            "Place one block type at MANY coordinates in ONE call (up to 128). Order them bottom-up so each block has support. " +
            "Use this instead of repeated placeBlockAt calls. Returns how many were placed and which failed.",
            [
                new CommandProperty("type", "The block type to place, e.g. oak_planks.", "string", true),
                new CommandProperty("positions", "Coordinates as 'x,y,z; x,y,z; ...'.", "string", true),
            ]
        );
    }

    async execute(agent, type, positions) {
        const list = parsePositions(positions).slice(0, MAX_BLOCKS);
        if (!list.length) return toolResult('failed', "No valid positions. Use 'x,y,z; x,y,z'.", 'invalid_arguments');
        const actionFn = async () => {
            const bot = agent.bot;
            let placed = 0;
            const failed = [];
            for (const q of list) {
                if (bot.interrupt_code) return toolResult('cancelled', `Stopped after ${placed}/${list.length}.`, 'interrupted');
                if (!bot.inventory.findInventoryItem(type)) {
                    failed.push(...list.slice(list.indexOf(q)));
                    return toolResult(placed ? 'partial' : 'blocked', `Placed ${placed}/${list.length} ${type}, then ran out of ${type}.`, 'no_material');
                }
                const ok = await skills.placeBlock(bot, type, q.x, q.y, q.z, 'bottom', true);
                const now = bot.blockAt(new Vec3(q.x, q.y, q.z));
                if (ok && now && now.name !== 'air') placed++; else failed.push(q);
            }
            if (!failed.length) return toolResult('ok', `Placed all ${placed} ${type}.`);
            const sample = failed.slice(0, 8).map(q => `${q.x},${q.y},${q.z}`).join('; ');
            return toolResult(placed ? 'partial' : 'failed', `Placed ${placed}/${list.length} ${type}. Failed: ${sample}${failed.length > 8 ? ' ...' : ''}.`, 'placement_failed');
        };
        return await agent.actions.runAction('action:placeBlocks', actionFn, {timeout: 6});
    }
}

export default PlaceBlocksTool;
