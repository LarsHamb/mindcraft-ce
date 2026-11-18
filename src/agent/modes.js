import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';
import { protectedAreaAt, dueRestores, finishRestore, harvestRefusal, getHome } from './library/protection.js';
import { nextToLava } from './library/mining.js';
import Vec3 from 'vec3';
import { journal } from './journal.js';
import pf from 'mineflayer-pathfinder';
import { RANGED, ILLAGERS, markIllagers, dangerAt } from './library/danger.js';
import * as stashLib from './library/stash.js';
import { isNight } from './library/village.js';
import { canFight } from './library/combat.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
/** Dig 2 blocks down where it stands and close the hole above its head with the dug dirt or stone. */
export async function digIn(bot) {
    const start = bot.entity.position.floored();
    const below = bot.blockAt(start.offset(0, -1, 0));
    if (!below || !/dirt|grass_block|stone|deepslate|sand|gravel|podzol|andesite|diorite|granite|tuff|clay|mud/.test(below.name)) return false;
    try { await skills.digDown(bot, 2); } catch { return false; }
    await skills.pickupNearbyItems(bot).catch(() => {});
    const feet = bot.entity.position.floored();
    if (feet.y > start.y - 2) return false;
    const fill = bot.inventory.items().find(i => /^(dirt|cobblestone|cobbled_deepslate|sand|gravel|andesite|diorite|granite|tuff|coarse_dirt)$/.test(i.name));
    if (!fill) return false;
    const top = feet.offset(0, 2, 0);
    try { return await skills.placeBlock(bot, fill.name, top.x, top.y, top.z, 'side'); } catch { return false; }
}

const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        update: async function (agent) {
            const bot = agent.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            const oxygen = Number.isFinite(bot.oxygenLevel) ? bot.oxygenLevel : 20;
            // head under water (also in kelp, seagrass, bubble columns): count the time as well, in case the air value is stale
            const headWet = isWaterish(blockAbove);
            if (headWet) this.underwaterSince ||= Date.now(); else this.underwaterSince = 0;
            const underwaterMs = this.underwaterSince ? Date.now() - this.underwaterSince : 0;
            if (headWet && (oxygen < 14 || underwaterMs > 4000) && !this.surfacing) {
                // Drowned once during a task although this fired: the pvp plugin kept pulling it to a pig under
                // water and the emergency window ran out. Now: stop fighting and walking, keep the window open
                // while under water, and swim to the nearest air above water if going straight up does not work.
                say(agent, 'I need air!');
                journal('reflex', {kind: 'air'}, bot);
                agent.emergencyUntil = Date.now() + 15000;
                this.surfacing = true;
                execute(this, agent, async () => {
                    try { bot.pvp?.stop?.(); } catch {}
                    bot.pathfinder.setGoal(null);
                    bot.setControlState('forward', false);
                    bot.setControlState('jump', true);
                    await bot.look(bot.entity.yaw, Math.PI / 2, true).catch(() => {});
                    const start = Date.now(), until = start + 25000;
                    let target = null, lastY = bot.entity.position.y, stillSince = Date.now();
                    while (Date.now() < until && isWaterish(bot.blockAt(bot.entity.position.offset(0, 1, 0)))) {
                        agent.emergencyUntil = Date.now() + 3000;
                        const pos = bot.entity.position;
                        if (pos.y > lastY + 0.3) { lastY = pos.y; stillSince = Date.now(); }
                        // not rising for 1.5 s: ceiling or current. Swim (no pathfinder: it cannot plan under water
                        // and lets go of jump, so the bot sank) towards the nearest air above water.
                        if (!target && Date.now() - stillSince > 1500) {
                            target = nearestAirAboveWater(bot, 16);
                            // no reachable air: dig through the ceiling above the head (slow under water, last resort)
                            if (!target) {
                                const ceiling = bot.blockAt(pos.floored().offset(0, 2, 0));
                                if (ceiling && ceiling.boundingBox === 'block' && !/bedrock|obsidian/.test(ceiling.name)) await bot.dig(ceiling, true).catch(() => {});
                                stillSince = Date.now();
                                continue;
                            }
                        }
                        if (target) {
                            // follow the water path node by node (head height), then rise at the open spot
                            const path = target.path;
                            while (path.length > 1 && Math.hypot(path[0].x + 0.5 - pos.x, path[0].z + 0.5 - pos.z) < 0.6) path.shift();
                            const next = path[0];
                            const dx = next.x + 0.5 - pos.x, dz = next.z + 0.5 - pos.z;
                            const far = Math.hypot(dx, dz) > 0.5;
                            if (far) await bot.look(Math.atan2(-dx, -dz), 0, true).catch(() => {});
                            bot.setControlState('forward', far);
                            bot.setControlState('sprint', false);
                        }
                        bot.setControlState('jump', true);
                        await new Promise(r => setTimeout(r, 150));
                    }
                    bot.setControlState('forward', false);
                    bot.setControlState('sprint', false);
                    bot.setControlState('jump', false);
                }).finally(() => { this.surfacing = false; agent.emergencyUntil = Date.now() + 2000; });
            }
            else if (headWet) {
                // does not call execute so does not interrupt other actions
                if (!bot.pathfinder.goal) {
                    bot.setControlState('jump', true);
                }
            }
            else if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (block.name === 'lava' || block.name === 'fire' ||
                blockAbove.name === 'lava' || blockAbove.name === 'fire') {
                say(agent, 'I\'m on fire!');
                // if you have a water bucket, use it
                let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                if (waterBucket) {
                    execute(this, agent, async () => {
                        let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                        if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                    });
                }
                else {
                    execute(this, agent, async () => {
                        let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                        if (waterBucket) {
                            let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                            if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                            return;
                        }
                        let nearestWater = world.getNearestBlock(bot, 'water', 20);
                        if (nearestWater) {
                            const pos = nearestWater.position;
                            let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                            if (success) say(agent, 'Found some water, ahhhh that\'s better!');
                            return;
                        }
                        await skills.moveAway(bot, 5);
                    });
                }
            }
            else if (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                say(agent, 'I\'m dying!');
                agent.emergencyUntil = Date.now() + 8000;
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (agent.isIdle()) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        // Shot twice by pillagers (Boys server, 17.11.): ranged mobs are fled from early instead of fought,
        // and where illagers are, a danger zone keeps the pathfinder (and the bot) away for a while.
        name: 'ranged_threat',
        description: 'Flee early from ranged mobs (pillagers, skeletons, witches) and mark pillager areas as danger zones. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        lastFlee: 0,
        update: async function (agent) {
            const bot = agent.bot;
            const me = bot.entity.position;
            // creepers too (character: creeper paranoia; and self_defense used to walk it straight into them)
            const near = Object.values(bot.entities).filter(e => e !== bot.entity && e.position && e.position.distanceTo(me) <= 40
                && (RANGED.has(e.name) || ILLAGERS.has(e.name) || (e.name === 'creeper' && e.position.distanceTo(me) <= 10)));
            if (!near.length) return;
            const zone = markIllagers(bot, near);
            if (zone) say(agent, `Achtung, ${zone.name === 'pillagers' ? 'Pillager' : 'ein Pillager-Lager'} bei ${zone.x} / ${zone.z}. Ich halte Abstand.`);
            const closest = near.reduce((a, b) => (a.position.distanceTo(me) <= b.position.distanceTo(me) ? a : b));
            const d = closest.position.distanceTo(me);
            // skeletons are everywhere at night: flee from them only when close; illagers always
            const flee = ILLAGERS.has(closest.name) ? d <= 40 : closest.name === 'creeper' ? d <= 10 : d <= 20;
            if (!flee || Date.now() - this.lastFlee < 3000) return;
            // well armed: stand and fight (self_defense), do not run from every skeleton (Lars, 18.11.)
            if (settings.combat_style !== 'basic' && canFight(bot, near)) return;
            this.lastFlee = Date.now();
            say(agent, `Aaa! A ${closest.name}!`);
            journal('reflex', {kind: 'flee', mob: closest.name}, bot);
            agent.emergencyUntil = Date.now() + 15000;
            execute(this, agent, async () => {
                try { bot.pvp?.stop?.(); } catch {}
                const goal = new pf.goals.GoalInvert(new pf.goals.GoalFollow(closest, 48));
                bot.pathfinder.setMovements(new pf.Movements(bot));
                bot.pathfinder.setGoal(goal, true);
                const until = Date.now() + 14000;
                while (Date.now() < until && !bot.interrupt_code) {
                    agent.emergencyUntil = Date.now() + 3000;
                    if (!closest.isValid || closest.position.distanceTo(bot.entity.position) > 48) break;
                    await new Promise(r => setTimeout(r, 300));
                }
                bot.pathfinder.setGoal(null);
            }).finally(() => { agent.emergencyUntil = Date.now() + 1000; });
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        max_stuck_time: 30,
        update: async function (agent) {
            if (agent.isIdle() || !agent.actions.executing) return;
            const bot = agent.bot;
            agent.actions.progress?.observe(bot);
            // long walks and searches compute paths while standing (Boys 17.11.: 38 interruptions): give them longer
            const slow = /search|goTo|recover|follow|village/i.test(agent.actions.currentActionLabel || '');
            const limit = (slow ? 45 : this.max_stuck_time) * 1000;
            if (!agent.actions.progress || agent.actions.progress.healthy(limit)) return;
            say(agent, 'I\'m stuck!');
            // test 18.11.: stuck for 20 minutes in shallow water next to a sand bank; the state says why
            const pf = bot.pathfinder;
            journal('stuck', {action: agent.actions.currentActionLabel, mining: pf?.isMining?.(), building: pf?.isBuilding?.(),
                moving: pf?.isMoving?.(), goal: pf?.goal?.constructor?.name || null, dig: bot.targetDigBlock?.name || null,
                controls: Object.entries(bot.controlState || {}).filter(([, v]) => v).map(([k]) => k).join(','),
                ground: bot.entity?.onGround, water: bot.entity?.isInWater, progress: String(agent.actions.progress?.message || "").slice(0, 80)}, bot);
            execute(this, agent, async () => {
                await skills.moveAway(bot, 3);
                say(agent, 'Trying another approach.');
            }, 0.25).catch(error => console.warn('Recovery failed:', error.message));
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Aaa! A ${enemy.name.replace("_", " ")}!`);
                execute(this, agent, async () => {
                    await skills.avoidEnemies(agent.bot, 24);
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Attack nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            // well armed it also takes on skeletons and creepers further away (shield, bow)
            const strong = settings.combat_style !== 'basic' && canFight(agent.bot, Object.values(agent.bot.entities).filter(e => mc.isHostile(e) && e.position.distanceTo(agent.bot.entity.position) < 20));
            // live 18.11.: a creeper 10 blocks below the bunker gave 10 minutes of fight/stuck loop. Mobs far above or
            // below, and mobs it just gave up on (no closer for 6 s), are left alone for a minute.
            const me = agent.bot.entity.position, ignored = agent.bot.__ignoreMobs || new Map();
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity) && Math.abs(entity.position.y - me.y) <= 4
                && !((ignored.get(entity.id) || 0) > Date.now()) && (entity.position.distanceTo(agent.bot.entity.position) <= 8
                || (strong && /^(skeleton|stray|bogged|parched|creeper|witch|phantom)$/.test(entity.name) && entity.position.distanceTo(agent.bot.entity.position) <= 16)), 16);
            // only with a clear path: a mob behind stone made an endless fight/unstuck loop deep down (test 18.11.)
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Fighting ${enemy.name}!`);
                // Arena 18.11.: Task tool calls cancelled the fight mid-swing ("interrupted, health 20") and it died in
                // full iron armor. Keep the emergency window open while fighting so Task actions wait.
                agent.emergencyUntil = Math.max(agent.emergencyUntil || 0, Date.now() + 5000);
                const hold = setInterval(() => { agent.emergencyUntil = Math.max(agent.emergencyUntil || 0, Date.now() + 3000); }, 1000);
                execute(this, agent, async () => {
                    try { await skills.defendSelf(agent.bot, strong ? 16 : 8); }
                    finally { clearInterval(hold); }
                }).finally(() => { clearInterval(hold); agent.emergencyUntil = Math.min(agent.emergencyUntil || 0, Date.now() + 500); });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity) && !protectedAreaAt(agent.bot, entity.position), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            // almost full: throw away junk first, otherwise nothing can be picked up any more
            if (agent.bot.inventory.emptySlotCount() < 4 && Date.now() - (this.lastTidy || 0) > 30000) {
                this.lastTidy = Date.now();
                execute(this, agent, async () => { await skills.tidyInventory(agent.bot); });
                return;
            }
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        // Lars, 17.11.: what was broken in a protected area is put back exactly; holes at the surface are
        // closed again (soil with dirt, never cobblestone on a meadow); a sapling goes where a tree stood.
        // Lars, 17.11.: after a death walk back and pick the dropped things up (they vanish after 5 min),
        // without asking the model. Lost things (lava, void) or a failed walk: take food and tools from the stash.
        name: 'recover_items',
        description: 'After a death, fetch the dropped items back, or restock from the stash chest.',
        interrupts: ['all'],
        on: true,
        active: false,
        last: 0,
        update: async function (agent) {
            if (this.loaded !== agent.name) { this.loaded = agent.name; agent.deathRecovery ??= stashLib.loadRecovery(agent.name); }
            const r = agent.deathRecovery, bot = agent.bot;
            if (!r || this.active || Date.now() - this.last < 3000) return;
            this.last = Date.now();
            if (!bot.entity || bot.health <= 0 || bot.isAlive === false) return;
            if (Date.now() - (r.at || 0) < 4000) return; // the inventory is cleared a moment after respawn
            // only clear our own long window, never a short drowning/danger window
            const release = () => { if ((agent.emergencyUntil || 0) - Date.now() > 20000) agent.emergencyUntil = 0; };
            const finish = (msg) => { agent.deathRecovery = null; stashLib.saveRecovery(agent.name, null); release(); journal('recover', {msg}, bot); if (msg) agent.agentSystem?.wake?.('system', msg); };
            const items = bot.inventory.items().reduce((n, i) => n + i.count, 0);
            const far = String(bot.game.dimension) !== String(r.dimension) || bot.entity.position.distanceTo(new Vec3(r.x, r.y, r.z)) > 400;
            const keepInventory = r.itemsAtDeath > 0 && items >= r.itemsAtDeath * 0.5;
            if (keepInventory) return finish(null);
            // Boys 17.11.: respawned naked at night, walked out to the death spot and died again, 30 times in a row.
            // At night after a second death, or with the death spot far away, dig in until morning instead.
            const streak = (agent.recentDeaths || []).filter(t => Date.now() - t < 10 * 60000).length;
            const dist = bot.entity.position.distanceTo(new Vec3(r.x, r.y, r.z));
            const armored = bot.inventory.slots.slice(5, 9).some(Boolean);
            if (isNight(bot) && !armored && (streak >= 2 || dist > 24) && !r.dugIn) {
                r.dugIn = true;
                agent.emergencyUntil = Date.now() + 60000;
                execute(this, agent, async () => {
                    say(agent, streak >= 2 ? 'Schon wieder tot. Ich grabe mich bis zum Morgen ein.' : 'Nachts ohne Ruestung? Ich grabe mich erst mal ein.');
                    const ok = await digIn(bot);
                    finish(`It is night and you respawned without armor${streak >= 2 ? ` after ${streak} deaths in 10 minutes` : ''}: ${ok ? 'you dug in 2 blocks deep and closed the hole above you' : 'digging in did not work, build a quick shelter (buildShelter) or dig down 2 and cover yourself'}. Stay there until morning (stay 60 repeatedly, eat if hungry); your dropped things are lost or wait until day. Then start again with wood and tools, or take from your stash.`);
                }, 2).finally(release);
                return;
            }
            const goRecover = r.recoverable && !far && Date.now() < r.until && r.tries < 3;
            const hasStash = Boolean(agent.memory_bank?.recallPlace?.(stashLib.STASH_PLACE));
            if (!goRecover && !hasStash) return finish(r.recoverable ? 'Could not get your dropped things back (too far or too late). Start again with wood and tools.' : null);
            r.tries++;
            agent.emergencyUntil = Date.now() + 5 * 60000; // Task waits; the reflex is short
            execute(this, agent, async () => {
                let msg = '';
                if (goRecover) {
                    say(agent, 'Meine Sachen! Ich hol sie zurück.');
                    const res = await stashLib.recoverDrops(bot, r);
                    if (res.picked > 0) msg = `Recovered ${res.picked} of your dropped items at the death spot.`;
                    else if (r.tries < 3 && !res.reached && Date.now() < r.until) return; // try again
                    else msg = 'Found nothing at the death spot (items gone or not reachable).';
                }
                if ((!goRecover || !msg.startsWith('Recovered')) && hasStash) {
                    const t = await stashLib.takeFromStash(bot, agent);
                    msg += t.error ? ` Stash: ${t.error}` : t.taken.length ? ` Took ${t.taken.join(', ')} from your stash.` : ' The stash had nothing you were missing.';
                }
                finish(msg.trim() + ' Continue your plan.');
            }, 5).finally(release); // interrupted (danger) or retry: Task may run until the next try
        }
    },
    {
        name: 'grab_valuables',
        description: 'Take visible diamond and emerald ore close by along, when idle.',
        interrupts: [],
        on: true,
        active: false,
        last: 0,
        update: async function (agent) {
            if (!agent.isIdle() || Date.now() - this.last < 5000) return;
            this.last = Date.now();
            this.active = true;
            try { await grabValuables(agent); } finally { this.active = false; }
        }
    },
    {
        name: 'restore_blocks',
        description: 'Put back blocks broken in protected areas or at the surface, and replant saplings, when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        last: 0,
        update: async function (agent) {
            if (!agent.isIdle() || Date.now() - this.last < 4000) return;
            this.last = Date.now();
            const bot = agent.bot;
            const todo = dueRestores(bot);
            if (!todo.length) return;
            execute(this, agent, async () => { await placeRestores(bot, todo.slice(0, 8)); });
        }
    },
    {
        // Boys server, 17.11.: hunger got critical before it had food, and the first night came without
        // tools or shelter. This only wakes Brain early (no action of its own).
        name: 'needs_watch',
        description: 'Remind the planner early about food and the coming night.',
        interrupts: ['all'],
        on: true,
        active: false,
        lastFood: 0,
        duskDay: -1,
        update: async function (agent) {
            const bot = agent.bot;
            const wake = msg => agent.agentSystem?.wake?.('system', msg);
            const foods = bot.registry?.foodsByName || {};
            const food = bot.inventory.items().filter(i => foods[i.name] && !/rotten_flesh|spider_eye|poisonous_potato|pufferfish|^chicken$/.test(i.name))
                .reduce((n, i) => n + i.count, 0);
            if (food < 3 && bot.food <= 15 && Date.now() - this.lastFood > 5 * 60000) {
                this.lastFood = Date.now();
                wake(`Hunger ${bot.food}/20 and only ${food} food left. Secure food now (hunt and cook, bread, apples) before other work; keep at least 5 cooked food.`);
            }
            const t = bot.time?.timeOfDay, day = bot.time?.day;
            if (Number.isFinite(t) && t >= 11000 && t < 12500 && day !== this.duskDay) {
                this.duskDay = day;
                const bed = getHome(bot)?.bed, me = bot.entity?.position;
                const far = bed && me ? Math.round(Math.hypot(me.x - bed.x, me.z - bed.z)) : 0;
                const armored = [5, 6, 7, 8].filter(i => bot.inventory.slots[i]).length >= 2;
                // sand test 18.11.: at dusk it dropped a player's job (108 of 128 sand) to walk 270 blocks home to bed
                if (bed && far > 80 && armored) wake(`Night falls in about a minute. Your village bed is ${far} blocks away. If you are on a job for a player, finish it here carefully (you are armored; torches around you, fight only with a clear path), then go home. Without a job, go home and sleep (village sleep).`);
                else if (bed && far > 80) wake(`Night falls in about a minute. Your village bed is ${far} blocks away, too far to reach before dark without armor: build a shelter here (buildShelter) or dig in, and keep the player's job for the morning.`);
                else if (bed) wake('Night falls in about a minute. Go home to your village bed and sleep there (village sleep). Fighting creepers at night in the open is not a plan.');
                else wake('Night falls in about a minute. Go to your shelter, or build one now with buildShelter, or dig in; put torches around it. Do not stay in the open. If you have a bed at your base, sleep in it (goToBed): that also sets your respawn point there.');
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            const entity = agent.bot.nearestEntity();
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata[16];
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    }
];

function isWaterish(block) {
    if (!block) return false;
    return /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(block.name) || block.getProperties?.()?.waterlogged === true;
}

// Nearest water block with air above it that can be reached by swimming: a search through connected
// water from the bot (a plain "nearest air" picked a pond behind a wall once, and the bot drowned at it).
export function nearestAirAboveWater(bot, range, maxNodes = 1500) {
    const start = bot.entity.position.floored().offset(0, 1, 0); // head block
    const k = p => `${p.x},${p.y},${p.z}`;
    const parent = new Map([[k(start), null]]);
    const queue = [start];
    for (let i = 0; i < queue.length && i < maxNodes; i++) {
        const p = queue[i];
        const above = bot.blockAt(p.offset(0, 1, 0));
        if (above && /^(air|cave_air)$/.test(above.name)) {
            const path = [];
            for (let n = p; n; n = parent.get(k(n))) path.unshift(n);
            return {target: p, path};
        }
        for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
            const q = p.offset(dx, dy, dz);
            if (Math.abs(q.x - start.x) > range || Math.abs(q.z - start.z) > range || Math.abs(q.y - start.y) > range) continue;
            if (parent.has(k(q))) continue;
            parent.set(k(q), p);
            if (isWaterish(bot.blockAt(q))) queue.push(q);
        }
    }
    return null;
}

async function placeRestores(bot, entries) {
    let placed = 0;
    for (const e of entries) {
        if (bot.interrupt_code) break;
        const item = e.items.find(n => bot.inventory.findInventoryItem(n));
        if (!item) continue;
        await skills.placeBlock(bot, item, e.x, e.y, e.z, 'bottom', true).catch(() => false);
        const now = bot.blockAt(new Vec3(e.x, e.y, e.z));
        if (now && e.items.includes(now.name)) { finishRestore(bot, e); placed++; }
        else e.tries = (e.tries || 0) + 1;
    }
    return placed;
}

// Between two tool calls of a task (no model request): put back what is due close by, at most a few blocks.
// A free-living bot is rarely idle, so the idle mode alone would hardly ever get to it.
export async function restoreBetweenTools(agent, {radius = 10, max = 4} = {}) {
    const bot = agent.bot;
    if (!bot?.entity || bot.modes?.isOn && !bot.modes.isOn('restore_blocks')) return 0;
    const me = bot.entity.position;
    const near = dueRestores(bot).filter(e => Math.hypot(e.x + 0.5 - me.x, e.z + 0.5 - me.z) <= radius).slice(0, max);
    if (!near.length) return 0;
    const result = await agent.actions.runAction('action:restoreBlocks', async () => {
        const n = await placeRestores(bot, near);
        if (n) console.log(`Restored ${n} block(s) between tool calls.`);
    }, {timeout: 1});
    return result?.success ? near.length : 0;
}

async function execute(mode, agent, func, timeout=-1) {
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;
    let code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
        await func();
    }, { timeout });
    mode.active = false;
    console.log(`Mode ${mode.name} finished executing, code_return: ${code_return.message}`);

    let should_reprompt = 
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return.interrupted; // this mode action was not interrupted by something else

    if (should_reprompt) {
        // auto prompt to respond to the interruption
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
        Your behavior log: ${logs}\nRespond accordingly.`);
    }
}

let _agent = null;
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        // Boys patch: no reflex while dead. Moving a dead player (self_preservation fleeing at 0 health)
        // got the bot kicked with "Invalid move player packet" on 26.3 and lost the death recovery.
        const b = _agent.bot;
        if (b?.isAlive === false || (Number.isFinite(b?.health) && b.health <= 0)) return;
        if (_agent.isIdle()) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                await mode.update(_agent);
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    _agent = agent;
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }
}

// Lars, 17.11.: after getting the 4 diamonds he asked for he walked off past two more diamond ores. Valuable
// ore he can see close by is always taken along: between tool calls and when idle, no model request.
const VALUABLE = {diamond_ore: 'iron', deepslate_diamond_ore: 'iron', emerald_ore: 'iron', deepslate_emerald_ore: 'iron', ancient_debris: 'diamond'};
const PICK_TIER = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
function canMine(bot, need) {
    const best = Math.max(-1, ...bot.inventory.items().filter(i => i.name.endsWith('_pickaxe'))
        .map(i => PICK_TIER.indexOf(i.name.replace('_pickaxe', '').replace('golden', 'wooden'))));
    return best >= PICK_TIER.indexOf(need);
}
export function visibleValuables(bot, radius = 6) {
    if (!bot?.entity || typeof bot.findBlocks !== 'function') return [];
    const ids = Object.keys(VALUABLE).map(n => bot.registry?.blocksByName?.[n]?.id).filter(Number.isFinite);
    if (!ids.length) return [];
    return bot.findBlocks({matching: ids, maxDistance: radius, count: 8}).map(p => bot.blockAt(p))
        .filter(b => b && VALUABLE[b.name] && canMine(bot, VALUABLE[b.name]) && !nextToLava(bot, b) && !harvestRefusal(bot, b)
            && (typeof bot.canSeeBlock !== 'function' || bot.canSeeBlock(b)));
}
export async function grabValuables(agent, {radius = 6} = {}) {
    const bot = agent.bot;
    if (!bot?.entity || bot.modes?.isOn && !bot.modes.isOn('grab_valuables')) return 0;
    if (bot.health <= 8 || bot.food <= 6) return 0; // not when he should be heading home
    const found = visibleValuables(bot, radius);
    if (!found.length) return 0;
    const byType = {};
    for (const b of found) byType[b.name] = (byType[b.name] || 0) + 1;
    let got = 0;
    const result = await agent.actions.runAction('action:grabValuables', async () => {
        for (const [name, n] of Object.entries(byType)) {
            const type = name.replace('deepslate_', '').replace('_ore', '');
            const before = bot.inventory.items().filter(i => i.name === type || i.name === name).reduce((s, i) => s + i.count, 0);
            await skills.collectBlock(bot, name, n);
            got += Math.max(0, bot.inventory.items().filter(i => i.name === type || i.name === name).reduce((s, i) => s + i.count, 0) - before);
        }
    }, {timeout: 2});
    if (got) { journal('valuables', {got, types: Object.keys(byType)}, bot); console.log(`Took ${got} valuable item(s) along: ${Object.keys(byType).join(', ')}.`); }
    return result?.success ? got : 0;
}
