// Boys test 17.11.: the stairs down to the diamonds (~350 stone) wore out the iron pickaxe (250 uses) before
// the first diamond, so it had to climb back for iron. Mining picks the fastest tool; here a stone tool is
// used whenever it can harvest the block, and better tools are saved for what needs them (iron, diamonds).
export function thriftyTool(bot, block, best) {
    if (!best || !block || best.name.startsWith('stone_') || best.name.startsWith('wooden_')) return best;
    const kind = best.name.slice(best.name.indexOf('_') + 1); // pickaxe, axe, shovel, hoe, sword
    if (!['pickaxe', 'axe', 'shovel'].includes(kind)) return best;
    const stone = bot.inventory.items().find(i => i.name === `stone_${kind}`);
    if (!stone) return best;
    if (block.harvestTools && !block.harvestTools[stone.type]) return best; // stone cannot harvest it
    return stone;
}

export function installToolThrift(bot) {
    const pf = bot.pathfinder;
    if (pf?.bestHarvestTool && !pf.__thrift) {
        const best = pf.bestHarvestTool.bind(pf);
        pf.bestHarvestTool = block => thriftyTool(bot, block, best(block));
        pf.__thrift = true;
    }
    const tool = bot.tool;
    if (tool?.equipForBlock && !tool.__thrift && pf?.bestHarvestTool) {
        const equip = tool.equipForBlock.bind(tool);
        tool.equipForBlock = async (block, options) => {
            const pick = pf.bestHarvestTool(block);
            if (pick && pick.name.startsWith('stone_') && bot.heldItem?.name !== pick.name) return await bot.equip(pick, 'hand');
            if (pick && pick.name.startsWith('stone_')) return;
            return await equip(block, options);
        };
        tool.__thrift = true;
    }
}
