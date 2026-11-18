// Sand test 18.11.: the player who ordered 128 sand stood 80 blocks away, out of entity range. goToPlayer said
// "Could not find Tester", the bot took them for offline and put the sand into a chest. Now it remembers where
// it last saw each player, so it can walk there and look again.
const seen = new WeakMap();

export function installLastSeen(bot) {
    if (!bot || bot.__lastSeen) return;
    bot.__lastSeen = true;
    const map = new Map();
    seen.set(bot, map);
    const t = setInterval(() => {
        for (const [name, p] of Object.entries(bot.players || {})) {
            const pos = p?.entity?.position;
            if (pos && name !== bot.username) map.set(name, {x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), at: Date.now()});
        }
    }, 2000);
    bot.once('end', () => clearInterval(t));
}

/** Where and how long ago the bot last saw this player: {x, y, z, at} or null. */
export function lastSeen(bot, name, maxAgeMs = 30 * 60000) {
    const s = seen.get(bot)?.get(name);
    return s && Date.now() - s.at <= maxAgeMs ? s : null;
}

/** For tests: set a sighting by hand. */
export function noteSeen(bot, name, pos, at = Date.now()) {
    if (!seen.has(bot)) seen.set(bot, new Map());
    seen.get(bot).set(name, {x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), at});
}
