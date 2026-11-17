// Lars, 17.11.: hard limit for every character (Anja's "scams" are only ever about game items).
// Chat lines with links/domains, real money, bank or payment data, passwords/logins or personal data never
// leave the bot. The line is dropped and the planner is asked to say it again without that.
const RULES = [
    ['link', /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|de|net|org|me|io|gg|ly|xyz|info|ru|tk|co|eu|at|ch|app|link|shop|site|online)\b/i],
    ['paypal link', /paypal\s*\.\s*me|paypal\s*(konto|account|adresse|daten|login)/i],
    ['real money', /\d\s*(€|euro|eur\b|dollar|usd)|(€|\$)\s*\d|echte[sm]?\s+geld|real money|\bbitcoin|\bkrypto|gutschein-?code|gift\s*card|paysafe/i],
    ['bank data', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,}/],
    ['bank data', /\biban\b|\bbic\b|bankdaten|kontonummer|kreditkarte|credit card|\btan\b|bankverbindung/i],
    ['password or login', /passw(o|ö)rt|password|kennwort|\blogin\b|einloggen|anmeldedaten|zugangsdaten|\bpin\b|verifizierungs?code|bestätigungscode|2fa/i],
    ['personal data', /e-?mail|@[a-z0-9-]+\.[a-z]{2,}|telefonnummer|handynummer|(\+\d{2}\s?\d{2,4}|\b0\d{3,4})[\s/-]?\d{3,8}\b|wohnadresse|deine adresse|echter name|richtiger name|discord-?(name|tag)/i],
    ['outside the game', /außerhalb des spiels|ausserhalb des spiels|im echten leben (überweis|schick|zahl)|lade .* herunter|download/i],
];

/** Returns null if the line is fine, else the reason it is blocked. Server commands ("/...") pass. */
export function chatBlockReason(text) {
    const t = String(text ?? '');
    if (t.startsWith('/')) return null;
    for (const [reason, re] of RULES) if (re.test(t)) return reason;
    return null;
}

/** Wraps bot.chat and bot.whisper. onBlock(reason, text) is told when a line is dropped. */
export function installChatFilter(bot, onBlock) {
    if (!bot || bot.__chatFilter) return;
    bot.__chatFilter = true;
    for (const fn of ['chat', 'whisper']) {
        const orig = bot[fn];
        if (typeof orig !== 'function') continue;
        bot[fn] = function (...args) {
            const text = fn === 'whisper' ? args[1] : args[0];
            const reason = chatBlockReason(text);
            if (reason) {
                console.warn(`Chat filter: blocked (${reason}): ${String(text).slice(0, 120)}`);
                try { onBlock?.(reason, text); } catch {}
                return;
            }
            return orig.apply(this, args);
        };
    }
}
