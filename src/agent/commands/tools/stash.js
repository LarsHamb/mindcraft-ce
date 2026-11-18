import BaseTool from "../base_tool.js";
import CommandProperty from "../property.js";
import { toolResult } from "../../tool_result.js";
import { makeStash, storeInStash, takeFromStash, stashPlace, STASH_PLACE } from "../../library/stash.js";

class StashTool extends BaseTool {
    constructor() {
        super(
            "stash",
            `Your supply chest (place '${STASH_PLACE}') for the case you die. store: put spare food (keeps 8) and second tools in it, making the chest here if there is none. take: get food and missing tools back. make: place the chest here.`,
            [new CommandProperty("mode", "store (default), take or make.", "string", false)]
        );
    }

    async execute(agent, mode = 'store') {
        mode = ['store', 'take', 'make'].includes(mode) ? mode : 'store';
        const actionFn = async () => {
            const bot = agent.bot;
            if (mode === 'make') {
                const err = await makeStash(bot, agent);
                if (err) return toolResult('blocked', err, 'no_stash');
                const p = stashPlace(agent);
                return toolResult('ok', `Stash chest placed at ${p.map(Math.round).join(',')} and saved as '${STASH_PLACE}'.`);
            }
            const r = mode === 'take' ? await takeFromStash(bot, agent) : await storeInStash(bot, agent);
            if (r.error) return toolResult('blocked', r.error, 'stash');
            const list = r.taken || r.stored;
            if (!list.length) return toolResult('ok', r.note || (mode === 'take' ? 'Nothing in the stash that I am missing.' : 'Nothing stored.'));
            return toolResult('ok', `${mode === 'take' ? 'Took' : 'Stored'} ${list.join(', ')} ${mode === 'take' ? 'from' : 'in'} the stash at ${r.pos.x},${r.pos.y},${r.pos.z}.`);
        };
        return await agent.actions.runAction('action:stash', actionFn, {timeout: 4});
    }
}

export default StashTool;
