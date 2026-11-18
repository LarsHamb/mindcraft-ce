import pf from 'mineflayer-pathfinder';
import { actionContext, assertActionOwner, cancellable } from '../action_context.js';
import { toolResult } from '../tool_result.js';

const failures = new WeakMap();
const counts = bot => Object.fromEntries(bot.inventory.items().map(i => [i.name,
    bot.inventory.items().filter(x => x.name === i.name).reduce((sum, x) => sum + x.count, 0)]));

export function blockTypes(type) {
    const types = new Set([type]);
    if (['coal', 'diamond', 'emerald', 'iron', 'gold', 'lapis_lazuli', 'redstone'].includes(type)) types.add(`${type}_ore`);
    for (const name of [...types]) if (name.endsWith('_ore') && !name.startsWith('deepslate_')) types.add(`deepslate_${name}`);
    if (type === 'dirt') types.add('grass_block');
    if (type === 'cobblestone') types.add('stone');
    return types;
}

// Diamonds sit deep, often beside lava: an ore with lava above or beside it would flood the bot when mined.
export function nextToLava(bot, block) {
    if (typeof bot?.blockAt !== 'function' || !block?.position) return false;
    return [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
        .some(([x, y, z]) => /lava/.test(bot.blockAt(block.position.offset(x, y, z))?.name || ''));
}

// Silent multi-minute loops are worse than an honest blocker: stop after this many failed
// targets in a row, or after this long without a new block.
export const MAX_FAILS_IN_ROW = 3;
export const MAX_NO_PROGRESS_MS = 120000;
export const FAILED_TARGET_MS = 10 * 60000;

export async function collectBlocks(bot, type, requested, {find, pickup, liquid, afterBreak, exclude = [], now = Date.now} = {}) {
    if (!Number.isSafeInteger(requested) || requested < 1) return toolResult('failed', 'Block count must be a positive integer.', 'bad_args');
    const before = counts(bot);
    const types = blockTypes(type);
    const excluded = new Set((exclude || []).map(p => p.toString()));
    const failed = failures.get(bot) || new Map();
    failures.set(bot, failed);
    for (const [key, info] of failed) {
        const current=info.position&&bot.blockAt(info.position);
        // sand test 18.11.: after 30 s the same three sand blocks under water were tried again for 12 minutes;
        // an unreachable target now stays skipped for 10 minutes (unless the block changes)
        if (now()-info.at>FAILED_TARGET_MS || (current&&(current.stateId??current.type)!==info.state)) failed.delete(key);
    }
    let broken = 0, attempts = 0, blocker = '';
    let failsInRow = 0, lastProgress = now();
    const where = () => { const p = bot.entity?.position; return p ? ` (standing at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})` : ''; };
    const confirmed = new Set();
    const attemptedPositions = new Set();
    const perTarget = new Map();
    const interrupt = () => bot.interrupt_code || actionContext(bot)?.signal.aborted;
    const report = message => bot.emit('mining_progress', {message, broken, requested, type});
    const onBlockUpdate = (oldBlock, newBlock) => {
        if (!oldBlock?.position || !types.has(oldBlock.name) || oldBlock.type === newBlock?.type) return;
        const key = oldBlock.position.toString();
        if (!attemptedPositions.has(key)) return;
        if (!confirmed.has(key)) { confirmed.add(key); excluded.add(key); broken++; }
    };
    bot.on('blockUpdate', onBlockUpdate);
    const onDigTarget = block => {
        if (block?.position && types.has(block.name)) attemptedPositions.add(block.position.toString());
    };
    bot.on('action_dig_target', onDigTarget);
    try {
    while (broken < requested && attempts++ < Math.max(6, requested * 4)) {
        if (interrupt()) break;
        assertActionOwner(bot);
        if (failsInRow >= MAX_FAILS_IN_ROW) { blocker = `Gave up after ${failsInRow} failed ${type} targets in a row: ${blocker}${where()}`; break; }
        if (now() - lastProgress > MAX_NO_PROGRESS_MS) { blocker = `No new ${type} for ${Math.round((now() - lastProgress) / 1000)} s: ${blocker || 'no progress'}${where()}`; break; }
        const blocks = find(block => types.has(block.name) && (!block.position || (!excluded.has(block.position.toString()) &&
            !failed.has(block.position.toString()))) && (type !== 'water' && type !== 'lava' || block.metadata === 0))
            .filter(block => block.position && !excluded.has(block.position.toString()) && !failed.has(block.position.toString()))
            .filter(block => type === 'lava' || !nextToLava(bot, block));
        const target = blocks[0];
        if (!target) { blocker ||= `No reachable ${type} found nearby.`; break; }
        const key = target.position.toString();
        perTarget.set(key, (perTarget.get(key) || 0) + 1);
        try {
            report(`Approaching ${type}; collected ${broken} of ${requested}.`);
            if (type === 'water' || type === 'lava') {
                if (!await liquid(target)) throw new Error('A bucket and reachable source block are required.');
            } else {
                // Require a visible face in normal reach. Buried ore first needs a route
                // next to it; retry the visibility goal after tunnelling, never dig blind.
                const goal = new pf.goals.GoalLookAtBlock(target.position, bot.world, {reach: 4.0});
                try {
                    await cancellable(bot, () => bot.pathfinder.goto(goal), 20000, () => bot.pathfinder.setGoal(null));
                } catch (error) {
                    assertActionOwner(bot);
                    if (error.name !== 'NoPath') throw error;
                    await cancellable(bot, () => bot.pathfinder.goto(new pf.goals.GoalGetToBlock(target.position.x, target.position.y, target.position.z)),
                        20000, () => bot.pathfinder.setGoal(null));
                    await cancellable(bot, () => bot.pathfinder.goto(goal), 15000, () => bot.pathfinder.setGoal(null));
                }
                assertActionOwner(bot);
                const block = bot.blockAt(target.position);
                if (!block || !types.has(block.name)) { excluded.add(key); continue; }
                await bot.tool.equipForBlock(block);
                if (bot.game.gameMode !== 'creative' && !block.canHarvest(bot.heldItem?.type)) {
                    blocker = `Missing the required tool to harvest ${block.name}.`;
                    break;
                }
                report(`Mining ${block.name}; collected ${broken} of ${requested}.`);
                // the collected target is wanted material: no surface restore for it (protection.js)
                bot.__intentionalDig = `${block.position.x},${block.position.y},${block.position.z}`;
                try {
                    await cancellable(bot, () => bot.dig(block, true, 'raycast'), Math.min(bot.digTime(block), 300000) + 8000,
                        () => bot.stopDigging());
                } finally { bot.__intentionalDig = null; }
                assertActionOwner(bot);
                // The digging dependency waits for a server update, rather than predicting air.
                if (bot.blockAt(block.position)?.type === block.type) throw new Error('Server did not confirm the block break.');
                excluded.add(key);
            }
            if (!confirmed.has(key)) { confirmed.add(key); broken++; }
            report(`Broke ${broken} of ${requested} ${type}; collecting drops.`);
            await cancellable(bot, () => pickup(), 10000, () => bot.pathfinder.setGoal(null));
            if(afterBreak) await afterBreak();
            blocker = '';
            failsInRow = 0; lastProgress = now();
        } catch (error) {
            if (interrupt()) break;
            failsInRow++;
            blocker = `${type} at ${key}: ${error.message}`;
            // no path or no progress is a clear answer: skip the target at once (other errors get a second try)
            if (perTarget.get(key) >= 2 || /No path|made no progress|Took too long/i.test(error.message)) {
                failed.set(key, {at: now(), reason: error.message,position:target.position,state:target.stateId??target.type});
                report(`Cannot reach ${type} at ${key}; trying another target.`);
            }
        }
    }
    } finally { bot.off('blockUpdate', onBlockUpdate); bot.off('action_dig_target', onDigTarget); }
    const after = counts(bot);
    const gains = Object.fromEntries(Object.entries(after).filter(([name, count]) => count > (before[name] || 0))
        .map(([name, count]) => [name, count - (before[name] || 0)]));
    const acquired = Object.entries(gains).map(([name, n]) => `${n} ${name}`).join(', ') || 'no items';
    const expected=new Set(types);
    const oreDrops={iron:'raw_iron',gold:'raw_gold',copper:'raw_copper',lapis:'lapis_lazuli',nether_quartz:'quartz',nether_gold:'gold_nugget'};
    for(const name of types) {
        const ore=name.replace(/^deepslate_/,'').replace(/_ore$/,'');
        if(name.endsWith('_ore')) expected.add(oreDrops[ore]||ore);
        for(const id of bot.registry?.blocksByName?.[name]?.drops||[]) {
            const item=bot.registry.items?.[id]?.name;if(item) expected.add(item);
        }
    }
    if(type==='cobblestone'||type==='stone') expected.add('cobblestone');
    if(type==='grass_block'||type==='dirt') expected.add('dirt');
    if(type==='water'||type==='lava') expected.add(`${type}_bucket`);
    if(broken&&bot.game.gameMode!=='creative'&&!Object.keys(gains).some(name=>expected.has(name)))
        blocker ||= 'Blocks broke, but their drops were not acquired.';
    const cancelled = interrupt();
    const status = cancelled ? 'cancelled' : broken >= requested && !blocker ? 'ok' : broken ? 'partial' : 'blocked';
    const text = `Broke ${broken}/${requested} ${type}; acquired ${acquired}.${blocker ? ` Blocker: ${blocker}` : ''}`;
    return toolResult(status, text, cancelled ? 'interrupted' : status === 'ok' ? null : 'incomplete', {broken, requested, gains, blocker});
}
