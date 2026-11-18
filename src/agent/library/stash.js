// Lars, 17.11.: after a death it should fetch its things back instead of starting from zero, and keep a
// supply chest ("Lager") with food and spare tools for the case that they are lost.
import * as skills from './skills.js';
import { protectedAreaAt } from './protection.js';
import Vec3 from 'vec3';
import { readFileSync, writeFileSync, rmSync } from 'fs';

export const STASH_PLACE = 'lager';
const TOOL_KINDS = ['pickaxe', 'axe', 'sword', 'shovel', 'hoe'];
const TIERS = ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'];
const KEEP_FOOD = 8;
const LOST = /lava|out of the world|left the confines|burn|fire|flames|went off with a bang.*fire|withered|magma/i;

// The open recovery survives a process restart (a kick right after death would otherwise lose it).
const recoveryFile = name => `./bots/${name}/death_recovery.json`;
export function saveRecovery(name, r) {
    try { if (r) writeFileSync(recoveryFile(name), JSON.stringify(r)); else rmSync(recoveryFile(name), {force: true}); } catch {}
}
export function loadRecovery(name, now = Date.now()) {
    try { const r = JSON.parse(readFileSync(recoveryFile(name), 'utf8')); return r && r.until > now ? r : null; } catch { return null; }
}

/** Can the dropped items still be picked up? Lava, fire and the void destroy them. */
export function deathRecoverable(message, dimension = 'overworld', y = 64) {
    if (LOST.test(String(message || ''))) return false;
    if (y < (String(dimension).includes('end') ? 0 : -64)) return false;
    return true;
}

const tier = name => { const i = TIERS.findIndex(t => name.startsWith(t + '_')); return i < 0 ? TIERS.length : i; };
const kindOf = name => TOOL_KINDS.find(k => name.endsWith('_' + k) && !(k === 'axe' && name.endsWith('_pickaxe')));

function isFood(bot, name) {
    const foods = bot.registry?.foodsByName || {};
    return Boolean(foods[name]) && !/rotten_flesh|spider_eye|poisonous_potato|pufferfish/.test(name);
}

/** What to put into the stash: food beyond KEEP_FOOD (raw first) and every tool that is not the best of its kind. */
export function stashSurplus(bot) {
    const items = bot.inventory.items();
    const out = [];
    const food = items.filter(i => isFood(bot, i.name)).sort((a, b) => (/^cooked_|bread|baked/.test(a.name) ? 1 : 0) - (/^cooked_|bread|baked/.test(b.name) ? 1 : 0));
    let total = food.reduce((n, i) => n + i.count, 0);
    for (const i of food) {
        if (total <= KEEP_FOOD) break;
        const n = Math.min(i.count, total - KEEP_FOOD);
        out.push({name: i.name, count: n}); total -= n;
    }
    for (const kind of TOOL_KINDS) {
        const tools = items.filter(i => kindOf(i.name) === kind).sort((a, b) => tier(a.name) - tier(b.name));
        for (const t of tools.slice(1)) out.push({name: t.name, count: t.count});
    }
    // Lars, 18.11.: a base with chests. Bulk blocks and loot beyond what he works with go in too (full inventory)
    for (const [re, keep] of BULK) {
        const have = items.filter(i => re.test(i.name));
        let total = have.reduce((n, i) => n + i.count, 0);
        for (const i of have) {
            if (total <= keep) break;
            const n = Math.min(i.count, total - keep);
            out.push({name: i.name, count: n}); total -= n;
        }
    }
    return out;
}

const BULK = [
    [/^cobblestone$/, 32], [/^(cobbled_deepslate|andesite|diorite|granite|tuff|calcite|netherrack|gravel|sand|red_sand|sandstone|red_sandstone|terracotta|clay_ball|flint)$/, 0],
    [/^(dirt|coarse_dirt)$/, 8], [/_log$/, 16], [/_planks$/, 16], [/^(rotten_flesh|bone|gunpowder|spider_eye|ink_sac|kelp)$/, 0],
    [/^(raw_iron|raw_copper|raw_gold|copper_ingot)$/, 32], [/^(wheat_seeds|beetroot_seeds|pumpkin_seeds|melon_seeds)$/, 16],
    [/_sapling$/, 4], [/^(white|.*)_wool$/, 3], [/^(lapis_lazuli|redstone|emerald|quartz|amethyst_shard)$/, 0],
];

/** What to take from the stash after a loss: food up to KEEP_FOOD and one tool of each kind that is missing. */
export function stashNeeds(bot, chestItems) {
    const items = bot.inventory.items();
    const take = [];
    let food = items.filter(i => isFood(bot, i.name)).reduce((n, i) => n + i.count, 0);
    for (const c of chestItems.filter(i => isFood(bot, i.name)).sort((a, b) => (/^cooked_|bread|baked/.test(b.name) ? 1 : 0) - (/^cooked_|bread|baked/.test(a.name) ? 1 : 0))) {
        if (food >= KEEP_FOOD) break;
        const n = Math.min(c.count, KEEP_FOOD - food);
        take.push({name: c.name, count: n}); food += n;
    }
    for (const kind of TOOL_KINDS) {
        if (items.some(i => kindOf(i.name) === kind)) continue;
        const best = chestItems.filter(i => kindOf(i.name) === kind).sort((a, b) => tier(a.name) - tier(b.name))[0];
        if (best) take.push({name: best.name, count: 1});
    }
    return take;
}

function stashChest(bot, agent) {
    const p = agent.memory_bank?.recallPlace?.(STASH_PLACE);
    if (!p) return null;
    const pos = new Vec3(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));
    return {pos, block: bot.blockAt(pos)};
}

async function openStash(bot, agent) {
    const s = stashChest(bot, agent);
    if (!s) return {error: `No stash yet (place '${STASH_PLACE}').`};
    if (!await skills.goToPosition(bot, s.pos.x, s.pos.y, s.pos.z, 2)) return {error: `Could not reach the stash at ${s.pos.x},${s.pos.y},${s.pos.z}.`};
    const block = bot.blockAt(s.pos);
    if (!block || !/chest|barrel/.test(block.name)) return {error: `The stash chest at ${s.pos.x},${s.pos.y},${s.pos.z} is gone.`, gone: true};
    const container = await skills.openChest(bot, block);
    if (!container) return {error: `The stash chest at ${s.pos.x},${s.pos.y},${s.pos.z} is blocked from above.`};
    return {container, pos: s.pos};
}

/** Place a stash chest near the bot (not in a player's area), crafting one from planks if needed. */
export async function makeStash(bot, agent) {
    const have = () => bot.inventory.items().some(i => i.name === 'chest');
    if (!have()) {
        const planks = bot.inventory.items().filter(i => i.name.endsWith('_planks')).reduce((n, i) => n + i.count, 0);
        if (planks < 8) return `Need a chest or 8 planks to make the stash (have ${planks} planks).`;
        await skills.craftRecipe(bot, 'chest', 1);
        if (!have()) return 'Could not craft a chest for the stash.';
    }
    const me = bot.entity.position.floored();
    const area = protectedAreaAt(bot, me);
    if (area && area.owner) return `This is ${area.owner}'s area "${area.name || 'base'}": put the stash at your own place, not here.`;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
        const p = me.offset(dx, 0, dz);
        const at = bot.blockAt(p), below = bot.blockAt(p.offset(0, -1, 0)), above = bot.blockAt(p.offset(0, 1, 0));
        if (!at || !below || !above || at.boundingBox !== 'empty' || below.boundingBox !== 'block' || /water|lava/.test(at.name) || above.boundingBox !== 'empty') continue;
        if (await skills.placeBlock(bot, 'chest', p.x, p.y, p.z)) {
            const placed = bot.blockAt(p);
            if (placed && /chest/.test(placed.name)) {
                agent.memory_bank.rememberPlace(STASH_PLACE, p.x, p.y, p.z);
                return null;
            }
        }
    }
    return 'No free spot next to me for the stash chest. Move to open flat ground and try again.';
}

/** Place a chest next to the stash chest so they join into a double chest. */
async function growStash(bot, pos) {
    const have = () => bot.inventory.items().some(i => i.name === 'chest');
    if (!have()) {
        const planks = bot.inventory.items().filter(i => i.name.endsWith('_planks')).reduce((n, i) => n + i.count, 0);
        if (planks < 8) return false;
        await skills.craftRecipe(bot, 'chest', 1).catch(() => {});
        if (!have()) return false;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = pos.offset(dx, 0, dz);
        const at = bot.blockAt(p), below = bot.blockAt(p.offset(0, -1, 0)), above = bot.blockAt(p.offset(0, 1, 0));
        if (!at || at.boundingBox !== 'empty' || !below || below.boundingBox !== 'block' || above?.boundingBox !== 'empty') continue;
        if (await skills.placeBlock(bot, 'chest', p.x, p.y, p.z).catch(() => false)) return true;
    }
    return false;
}

export async function storeInStash(bot, agent) {
    const surplus = stashSurplus(bot);
    if (!surplus.length) return {stored: [], note: `Nothing spare: I keep ${KEEP_FOOD} food and my best tool of each kind.`};
    let s = await openStash(bot, agent);
    if (s.error && (s.gone || /No stash/.test(s.error))) {
        const err = await makeStash(bot, agent);
        if (err) return {error: err};
        s = await openStash(bot, agent);
    }
    if (s.error) return {error: s.error};
    const stored = [];
    try {
        for (const it of surplus) {
            const item = bot.inventory.items().find(i => i.name === it.name);
            if (!item) continue;
            try { await s.container.deposit(item.type, null, Math.min(it.count, item.count)); stored.push(`${Math.min(it.count, item.count)} ${it.name}`); }
            catch (e) {
                if (!/full/i.test(String(e?.message))) continue;
                // full: put a second chest beside it (becomes a double chest) and go on once
                if (s.grown || !await growStash(bot, s.pos)) { stored.push('(chest full)'); break; }
                s.container.close();
                const again = await openStash(bot, agent);
                if (again.error) break;
                s.container = again.container; s.grown = true;
            }
        }
    } finally { s.container.close(); }
    return {stored, pos: s.pos};
}

export async function takeFromStash(bot, agent) {
    const s = await openStash(bot, agent);
    if (s.error) return {error: s.error};
    const taken = [];
    try {
        const inChest = s.container.containerItems();
        for (const it of stashNeeds(bot, inChest)) {
            const item = inChest.find(i => i.name === it.name);
            if (!item) continue;
            try { await s.container.withdraw(item.type, null, it.count); taken.push(`${it.count} ${it.name}`); } catch {}
        }
    } finally { s.container.close(); }
    return {taken, pos: s.pos};
}

/** Walk back to the death spot and pick up what is lying there. Returns a short report. */
export async function recoverDrops(bot, target) {
    const before = bot.inventory.items().reduce((n, i) => n + i.count, 0);
    const reached = await skills.goToPosition(bot, target.x, target.y, target.z, 2);
    for (let i = 0; i < 4 && !bot.interrupt_code; i++) {
        const left = Object.values(bot.entities).some(e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 8);
        if (!left) break;
        await skills.pickupNearbyItems(bot);
    }
    const after = bot.inventory.items().reduce((n, i) => n + i.count, 0);
    const near = bot.entity.position.distanceTo(new Vec3(target.x, target.y, target.z)) < 6;
    return {picked: Math.max(0, after - before), reached: reached || near};
}
