// Pause model requests while no real player is online (settings.pause_without_players).
// Called before every model request (Prompter.checkCooldown), so Brain, Task, RP and memory summaries
// all wait. Modes without the model (eating, self defence, picking up items) keep running.
import settings from './settings.js';

export function realPlayersOnline(bot) {
    const ignore = new Set([bot?.username, ...(settings.ignore_players || [])]);
    return Object.keys(bot?.players || {}).filter(name => !ignore.has(name));
}

export async function waitForPlayers(agent, {pollMs = 5000} = {}) {
    if (!settings.pause_without_players) return;
    const bot = agent?.bot;
    if (!bot?.players || !bot.entity) return;
    if (realPlayersOnline(bot).length) return;
    console.log('No players online: pausing model requests.');
    agent.pausedForPlayers = true;
    try {
        while (!realPlayersOnline(bot).length && bot.entity) await new Promise(r => setTimeout(r, pollMs));
    } finally {
        agent.pausedForPlayers = false;
    }
    console.log(`Player online again (${realPlayersOnline(bot).join(', ')}): resuming.`);
}
