// Lars, 17.11.: "mehr Bewusstsein". The planner (Brain) only saw the message, its goals and the task: it planned
// while dead, walked out naked at night and ate during fights. Every Brain request now carries one short line
// with the live situation (about 60 tokens): health, hunger, time of day, danger, gear, food, place, deaths, people.
import { getHome } from './protection.js';

const HOSTILE = /^(zombie|husk|drowned|zombie_villager|spider|cave_spider|vindicator|evoker|ravager|witch|pillager|skeleton|stray|bogged|creeper|slime|magma_cube|phantom|vex|blaze|ghast|wither_skeleton|piglin_brute|hoglin|zoglin|warden|silverfish|endermite|breeze|guardian|elder_guardian|shulker)$/;
const ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'];

/** Pickaxes with the share of durability left, best first: [{name, left}] (left 0..1). */
export function pickaxes(bot) {
    const tier = n => ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'].findIndex(x => n.startsWith(x + '_'));
    return (bot.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name)).map(i => {
        const max = i.maxDurability || bot.registry?.itemsByName?.[i.name]?.maxDurability || 0;
        const used = i.durabilityUsed ?? 0;
        return {name: i.name, left: max ? Math.max(0, (max - used) / max) : 1};
    }).sort((a, b) => tier(a.name) - tier(b.name));
}
export const freeSlots = bot => 36 - (bot.inventory?.items?.() || []).filter(i => i.slot >= 9 && i.slot <= 44).length;

/** Minecraft time as words: day / evening (minutes to night) / night (minutes to morning). */
export function timeText(t) {
    if (!Number.isFinite(t)) return null;
    const min = ticks => Math.max(1, Math.round(ticks / 1200));
    if (t < 11000) return `Tag (Nacht in ${min(12542 - t)} min)`;
    if (t < 12542) return `Abend, Nacht in ${min(12542 - t)} min`;
    if (t < 23460) return `Nacht (Morgen in ${min(23460 - t)} min)`;
    return 'Morgengrauen';
}

const short = name => name.replace(/_(sword|axe|pickaxe|shovel|helmet|chestplate|leggings|boots)$/, '').replace(/^golden$/, 'gold');

export function situation(agent) {
    const bot = agent?.bot;
    if (!bot?.entity) return 'nicht im Spiel';
    const parts = [];
    if (bot.health <= 0 || bot.isAlive === false) parts.push('TOT, wartet auf Respawn: nichts planen');
    else parts.push(`Leben ${Math.round(bot.health)}/20, Hunger ${bot.food}/20`);
    const time = timeText(bot.time?.timeOfDay);
    if (time) parts.push(bot.thunderState ? `${time}, Gewitter` : time);

    const me = bot.entity.position;
    const threats = {};
    for (const e of Object.values(bot.entities || {})) {
        if (!e?.position || !HOSTILE.test(e.name || '') || e.position.distanceTo(me) > 16) continue;
        threats[e.name] = (threats[e.name] || 0) + 1;
    }
    const t = Object.entries(threats).map(([n, c]) => `${c} ${n}`);
    parts.push(t.length ? `Gefahr in 16 Bloecken: ${t.join(', ')}` : 'keine Monster nah');

    const items = bot.inventory?.items?.() || [];
    const slots = bot.inventory?.slots || [];
    const armor = ARMOR.map((a, i) => slots[5 + i]?.name).filter(Boolean);
    const tierOf = n => { const i = ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'].findIndex(x => n.startsWith(x + '_')); return i < 0 ? 9 : i; };
    const best = items.filter(i => /_(sword|axe)$/.test(i.name) && !/pickaxe$/.test(i.name)).sort((a, b) => tierOf(a.name) - tierOf(b.name))[0]?.name;
    parts.push(`Ruestung: ${armor.length ? armor.map(short).join('/') : 'keine'}, Waffe: ${best || 'keine'}`);
    const foods = bot.registry?.foodsByName || {};
    const food = items.filter(i => foods[i.name] && !/rotten_flesh|spider_eye|poisonous_potato|pufferfish/.test(i.name)).reduce((n, i) => n + i.count, 0);
    parts.push(`Essen: ${food}`);
    // test 18.11.: both pickaxes wore out deep down and it was stuck at y 11 for 17 minutes
    const picks = pickaxes(bot);
    parts.push(picks.length ? `Spitzhacken: ${picks.map(p => `${p.name.replace('_pickaxe', '')} ${Math.round(p.left * 100)}%`).join(', ')}` : 'keine Spitzhacke');
    const free = freeSlots(bot);
    if (free <= 3) parts.push(`Inventar fast voll (${free} frei): erst einlagern (stash store)`);

    const home = getHome(bot);
    const dim = String(bot.game?.dimension || 'overworld').replace('minecraft:', '');
    let place = dim === 'overworld' ? '' : `${dim}, `;
    if (home?.bed) {
        const d = Math.round(Math.hypot(me.x - home.bed.x, me.z - home.bed.z));
        place += d <= 6 ? 'zu Hause' : `Zuhause ${d} Bloecke weg`;
    } else place += 'noch kein Zuhause';
    const sky = bot.blockAt?.(me.offset(0, 1, 0))?.skyLight;
    if (me.y < 50 && sky === 0) place += `, unter Tage (y ${Math.round(me.y)})`;
    parts.push(place);

    const deaths = (agent.recentDeaths || []).filter(x => Date.now() - x < 10 * 60000).length;
    if (deaths) parts.push(`${deaths}x gestorben in 10 min`);
    const people = Object.values(bot.players || {}).filter(p => p?.entity && p.username !== bot.username && p.entity.position.distanceTo(me) <= 32).map(p => p.username);
    if (people.length) parts.push(`nah: ${people.slice(0, 4).join(', ')}`);
    const action = agent.actions?.currentActionLabel;
    if (action) parts.push(`laeuft: ${action.replace(/^action:/, '')}`);
    return parts.join('; ');
}
