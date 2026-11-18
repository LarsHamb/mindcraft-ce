// Lars, 17.11.: talk with CheesyNPC in Simple Voice Chat. The server mod (npc/cheesy-voice) does listening and
// speaking with Gemini Live; this small HTTP bridge tells it where the bot is and which character (voice, role)
// it plays, and turns spoken requests into chat requests of that player (same rules, memory and filters).
// settings.voice_port: 0 = off (default).
import { situation } from './situation.js';
import http from 'node:http';
import settings from '../settings.js';
import { currentCharacter } from './characters.js';

const DEFAULT_VOICE = 'Charon';

export function voiceInfo(agent) {
    const c = currentCharacter(agent);
    const p = agent.bot?.entity?.position;
    return {
        character: c?.id || 'default',
        voice: c?.voice || DEFAULT_VOICE,
        persona: c?.voice_persona || `Du bist ${agent.name}, ein Mitspieler auf diesem Minecraft-Server.`,
        pos: p ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10] : null,
    };
}

export function voiceStatus(agent) {
    const parts = [];
    const action = agent.actions?.currentActionLabel;
    if (action) parts.push(`gerade: ${action.replace(/^action:/, '')}`);
    const goal = agent.agentSystem?.lastDirective?.goal || agent.agentSystem?.task?.goal;
    if (goal) parts.push(`Aufgabe: ${String(goal).slice(0, 160)}`);
    const bot = agent.bot;
    // Lars, 18.11.: "wo bist du / wie geht's dir / was machst du" - place, health, gear and goal, like in chat
    if (bot?.entity?.position) {
        const p = bot.entity.position;
        parts.push(`Ort ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`);
        try { parts.push(situation(agent)); } catch { parts.push(`Leben ${Math.round(bot.health)}/20, Hunger ${bot.food}/20`); }
    }
    return parts.join('; ') || 'Gerade nichts Besonderes, ich mache mit meinem eigenen Plan weiter.';
}

/** Handles one tool call from the voice mod. Returns the text the voice hears back. */
export function voiceTool(agent, {name, args = {}, speaker = ''}) {
    const who = String(speaker || '').trim() || 'Voice';
    const text = String(args.text || '').trim().slice(0, 300);
    if (name === 'status') return voiceStatus(agent);
    if (name === 'auftrag' && text) { agent.respondFunc?.(who, text); return 'Ist weitergegeben, ich kümmere mich drum.'; }
    if (name === 'merk_dir' && text) { agent.respondFunc?.(who, `Merk dir bitte: ${text}`); return 'Gemerkt.'; }
    return 'Das kann ich gerade nicht.';
}

export function startVoiceBridge(agent) {
    const port = Number(settings.voice_port) || 0;
    if (!port || agent.__voiceBridge) return null;
    const server = http.createServer((req, res) => {
        const send = (code, obj) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
        try {
            if (req.method === 'GET' && req.url.startsWith('/voice')) return send(200, voiceInfo(agent));
            if (req.method === 'POST' && req.url.startsWith('/tool')) {
                let body = '';
                req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
                req.on('end', () => {
                    try { send(200, {result: voiceTool(agent, JSON.parse(body || '{}'))}); }
                    catch (e) { send(400, {result: 'Das habe ich nicht verstanden.'}); }
                });
                return;
            }
            send(404, {});
        } catch (e) { send(500, {}); }
    });
    server.on('error', e => console.warn('voice bridge:', e.message));
    server.listen(port, '0.0.0.0', () => console.log(`Voice bridge on port ${port}`));
    agent.__voiceBridge = server;
    return server;
}
