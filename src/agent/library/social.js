// Lars, 18.11.: social awareness. He notices when a player joins, dies or comes back near him after a while,
// and the planner gets one short note to react in character (greet with what it remembers, comfort, tease).
// Rate-limited per player and per kind, so it costs a few requests per hour at most.
const DEATH = /^(\S+) (was slain|was shot|was blown up|blew up|drowned|fell|hit the ground|burned|went up in flames|tried to swim in lava|was killed|starved|suffocated|was squashed|was pricked|walked into|froze|died|was impaled|was fireballed|experienced kinetic|withered|was struck)/;
const GAP = {join: 30 * 60000, death: 3 * 60000, near: 20 * 60000};
const QUIET_AFTER_SPAWN = 30000;

export function deathOf(text, self) {
    const m = DEATH.exec(String(text || '').trim());
    return m && m[1] !== self ? {player: m[1], how: String(text).trim().slice(m[1].length + 1, m[1].length + 80)} : null;
}

export function installSocial(agent) {
    const bot = agent.bot;
    if (!bot || bot.__social) return;
    bot.__social = true;
    const since = Date.now();
    const last = new Map();
    const lastNear = new Map();
    const ok = (kind, who) => {
        const k = `${kind}:${who}`, t = last.get(k) || 0;
        if (Date.now() - t < GAP[kind]) return false;
        last.set(k, Date.now());
        return true;
    };
    const note = msg => { try { agent.agentSystem?.wake?.('system', msg); } catch {} };
    bot.on('playerJoined', p => {
        const who = p?.username;
        if (!who || who === bot.username || Date.now() - since < QUIET_AFTER_SPAWN || !ok('join', who)) return;
        note(`Social: ${who} just joined the server. Greet them briefly in character, using what you remember about them. One line, then carry on.`);
    });
    bot.on('messagestr', (text, position) => {
        if (position === 'chat') return;
        const d = deathOf(text, bot.username);
        if (!d || !bot.players?.[d.player] || !ok('death', d.player)) return;
        note(`Social: ${d.player} just died (${d.how}). React briefly in character (comfort or tease kindly, offer help if they are near). Remember it if it is a funny story.`);
    });
    const timer = setInterval(() => {
        const me = bot.entity?.position;
        if (!me) return;
        for (const p of Object.values(bot.players || {})) {
            if (!p?.entity || p.username === bot.username) continue;
            const near = p.entity.position.distanceTo(me) <= 12;
            const was = lastNear.get(p.username) || 0;
            if (near) {
                if (Date.now() - was > GAP.near && Date.now() - since > QUIET_AFTER_SPAWN && ok('near', p.username))
                    note(`Social: ${p.username} is standing right next to you after a while. Say hello in character, maybe ask what they are up to or mention something you remember. One line.`);
                lastNear.set(p.username, Date.now());
            }
        }
    }, 5000);
    bot.once('end', () => clearInterval(timer));
}
