import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import * as skills from "../../library/skills.js";
import { toolResult } from "../../tool_result.js";

// Lars, 17.11.: "Kühe ... fortpflanzen, oder Schweine oder Hühner". Two adults fed with their food go into
// love mode and make a baby; after that they need 5 minutes before they breed again.

export const BREED_FOOD = {
    cow: ['wheat'], mooshroom: ['wheat'], sheep: ['wheat'], goat: ['wheat'],
    pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds'],
    rabbit: ['carrot', 'dandelion', 'golden_carrot'], horse: ['golden_carrot', 'golden_apple'], donkey: ['golden_carrot', 'golden_apple'],
    llama: ['hay_block'], turtle: ['seagrass'], fox: ['sweet_berries'], wolf: ['beef', 'porkchop', 'chicken', 'mutton', 'cooked_beef'],
    cat: ['cod', 'salmon'], frog: ['slime_ball'], bee: ['dandelion', 'poppy'], armadillo: ['spider_eye'], camel: ['cactus'],
};
const LOVE_COOLDOWN_MS = 5 * 60000;
const fedAt = new WeakMap(); // bot -> Map(entityId -> time)

function animalName(name) {
    const n = String(name || '').toLowerCase().replace(/s$/, '');
    return {kuh: 'cow', kuehe: 'cow', schwein: 'pig', huhn: 'chicken', huehner: 'chicken', schaf: 'sheep', cows: 'cow', chickens: 'chicken'}[n] || n;
}

function foodFor(bot, animal) {
    for (const f of BREED_FOOD[animal] || []) {
        const n = bot.inventory.items().filter(i => i.name === f).reduce((s, i) => s + i.count, 0);
        if (n) return {name: f, count: n};
    }
    return null;
}

function herd(bot, animal, range = 32) {
    const me = bot.entity.position;
    const fed = fedAt.get(bot) || new Map();
    return Object.values(bot.entities).filter(e => e.name === animal && e.position && e.position.distanceTo(me) < range
        && Date.now() - (fed.get(e.id) || 0) > LOVE_COOLDOWN_MS).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
}

function countAnimals(bot, animal, around, range = 16) {
    return Object.values(bot.entities).filter(e => e.name === animal && e.position && e.position.distanceTo(around) < range).length;
}

async function feed(bot, entity, food) {
    if (!entity?.isValid && entity?.isValid !== undefined) return false;
    // animals wander: walk to where it is now, up to three times (babies are not told apart on 26.3; a
    // baby only eats one piece of food and grows faster)
    for (let i = 0; i < 3 && bot.entity.position.distanceTo(entity.position) > 3 && !bot.interrupt_code; i++)
        await skills.goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, 1.5);
    if (bot.entity.position.distanceTo(entity.position) > 4) return false;
    if (!await skills.equip(bot, food)) return false;
    await bot.lookAt(entity.position.offset(0, (entity.height || 1) * 0.6, 0));
    await bot.useOn(entity);
    const fed = fedAt.get(bot) || new Map();
    fed.set(entity.id, Date.now());
    fedAt.set(bot, fed);
    return true;
}

class BreedAnimalsTool extends BaseTool {
    constructor() {
        super(
            "breedAnimals",
            "Breed farm animals nearby (cow, sheep, pig, chicken, rabbit, goat...): feeds pairs of adults with their food (cow/sheep: wheat, pig: carrot/potato, chicken: seeds) so babies are born. Needs 2 food per pair.",
            [
                new CommandProperty("animal", "cow, sheep, pig, chicken, ...", "string", true),
                new CommandProperty("pairs", "1-4, default 1.", "integer", false),
            ]
        );
    }

    async execute(agent, animal, pairs = 1) {
        pairs = Number.isFinite(pairs) ? Math.max(1, Math.min(4, Math.round(pairs))) : 1;
        animal = animalName(animal);
        const actionFn = async () => {
            const bot = agent.bot;
            if (!BREED_FOOD[animal]) return toolResult('failed', `Cannot breed "${animal}". Known: ${Object.keys(BREED_FOOD).join(', ')}.`, 'bad_animal');
            let food = foodFor(bot, animal);
            if (!food || food.count < 2) return toolResult('blocked', `Need at least 2 of ${BREED_FOOD[animal].join(' or ')} to breed ${animal}; have ${food?.count || 0}.`, 'no_food');
            pairs = Math.min(pairs, Math.floor(food.count / 2));
            const first = herd(bot, animal);
            if (first.length < 2) return toolResult('blocked', `Found ${first.length} adult ${animal} ready to breed within 32 blocks (fed ones wait 5 min). Find more (searchForEntity ${animal}).`, 'no_animals');
            const start = first[0].position.clone();
            const before = countAnimals(bot, animal, start, 24);
            let fedCount = 0, made = 0;
            for (let p = 0; p < pairs; p++) {
                if (bot.interrupt_code) break;
                const ready = herd(bot, animal);
                if (ready.length < 2) break;
                const a = ready[0];
                const b = ready.slice(1).sort((x, y) => x.position.distanceTo(a.position) - y.position.distanceTo(a.position))[0];
                food = foodFor(bot, animal);
                if (!food || food.count < 2) break;
                if (await feed(bot, a, food.name)) fedCount++;
                if (await feed(bot, b, food.name)) fedCount++;
                made++;
            }
            await new Promise(r => setTimeout(r, 6000)); // love mode: the pair walks together and the baby appears
            const after = countAnimals(bot, animal, start, 24);
            const babies = Math.max(0, after - before);
            if (bot.interrupt_code) return toolResult('cancelled', `Stopped after feeding ${fedCount} ${animal}.`, 'interrupted');
            if (!fedCount) return toolResult('failed', `Could not reach or feed any ${animal}.`, 'feed_failed');
            return toolResult(babies ? 'ok' : 'partial',
                `Fed ${fedCount} ${animal} (${made} pair${made === 1 ? '' : 's'}); ${babies} baby ${animal} seen nearby now${babies ? '' : ' (they may still be walking together; pairs farther than ~8 blocks apart do not meet)'}. Fed animals can breed again in 5 minutes. Keep animals in a fenced pen so they stay.`);
        };
        return await agent.actions.runAction('action:breedAnimals', actionFn, {timeout: 4});
    }
}

export default BreedAnimalsTool;
