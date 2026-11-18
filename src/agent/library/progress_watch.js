// Lars, 18.11.: "Fortschritts-Waechter". When 10 minutes pass with a task or action running but no new items,
// hardly any movement and no finished task, everything is stopped and he does one simple fallback: up to the
// surface, home to the village, or fetch wood.
import { journal, recentJournal } from '../journal.js';
import { getHome } from './protection.js';
import { noteLesson } from './tips.js';

export const WINDOW_MS = 10 * 60000;
const SAMPLE_MS = 60000;

const countsOf = bot => {
    const c = {};
    for (const i of bot.inventory?.items?.() || []) c[i.name] = (c[i.name] || 0) + i.count;
    return JSON.stringify(Object.entries(c).sort());
};

/** Pure check over samples [{at, inv, pos:{x,y,z}, busy}] and finished tasks in the window. */
export function noProgress(samples, doneInWindow, now = Date.now()) {
    const win = samples.filter(s => now - s.at <= WINDOW_MS + 5000);
    if (win.length < 10 || now - win[0].at < WINDOW_MS - 5000) return false;
    if (doneInWindow > 0) return false;
    if (win.filter(s => s.busy).length < 8) return false;            // idle on purpose (night in the house, waiting)
    if (new Set(win.map(s => s.inv)).size > 1) return false;         // new items or used items
    const a = win[0].pos;
    return !win.some(s => Math.hypot(s.pos.x - a.x, s.pos.y - a.y, s.pos.z - a.z) > 16);
}

/** The simple fallback for this situation, as an instruction for Brain. */
export function fallbackFor(bot) {
    const me = bot.entity.position;
    const sky = bot.blockAt?.(me.offset(0, 1, 0))?.skyLight ?? 15;
    if (me.y < 60 && sky === 0) return 'goToSurface (it digs stairs up by hand if needed)';
    const home = getHome(bot);
    const ref = home?.bed || home?.bell;
    if (ref && Math.hypot(me.x - ref.x, me.z - ref.z) > 24) return "go home to the village: goToRememberedPlace dorf (or village move_in)";
    return 'collect 4 logs from the nearest tree (collectBlocks *_log 4)';
}

export function installProgressWatch(agent) {
    const bot = agent.bot;
    if (!bot || bot.__progressWatch) return;
    bot.__progressWatch = true;
    let samples = [], lastFire = 0;
    const t = setInterval(async () => {
        try {
            if (!bot.entity || bot.isSleeping) { samples = []; return; }
            // at night at home (watch, waiting for morning) standing still is the plan
            const t = bot.time?.timeOfDay, ref = getHome(bot)?.bed || getHome(bot)?.bell, me = bot.entity.position;
            if (Number.isFinite(t) && t >= 12542 && t < 23460 && ref && Math.hypot(me.x - ref.x, me.z - ref.z) <= 32) { samples = []; return; }
            const now = Date.now();
            const busy = !!(agent.agentSystem?.activeTask || agent.actions?.executing);
            const p = bot.entity.position;
            samples.push({at: now, inv: countsOf(bot), pos: {x: p.x, y: p.y, z: p.z}, busy});
            samples = samples.filter(s => now - s.at <= WINDOW_MS + 5000);
            const done = recentJournal(WINDOW_MS, now).filter(e => e.type === 'task_end' && e.outcome === 'done').length;
            if (now - lastFire < WINDOW_MS || !noProgress(samples, done, now)) return;
            lastFire = now;
            samples = [];
            const what = fallbackFor(bot);
            journal('watchdog', {fallback: what, action: agent.actions?.currentActionLabel || null}, bot);
            try { noteLesson(agent.name, 'Wenn eine Sache lange nicht klappt: frueh aufgeben und einen kleinen sicheren Schritt waehlen'); } catch {}
            console.log(`Progress watch: 10 minutes without progress, stopping everything; fallback: ${what}`);
            try { agent.agentSystem?.cancelTask?.(); } catch {}
            try { await agent.actions?.stop?.(); } catch {}
            agent.agentSystem?.wake?.('system', `Watchdog: 10 minutes without any progress (no new items, hardly moved, nothing finished). Everything was stopped. Do this one simple thing now: ${what}. Then pick a small, reachable next step.`);
        } catch (e) { console.warn('progress watch:', e.message); }
    }, SAMPLE_MS);
    bot.once('end', () => clearInterval(t));
}
