import test from 'node:test';
import assert from 'node:assert/strict';
import { chatBlockReason, installChatFilter } from '../src/agent/library/chat_filter.js';

test('normal game chat passes, also coordinates and game trades', () => {
    for (const t of ['Guten Morgen, Truppen! Operation Bruchstein beginnt bei 1675 64 -1642.',
        'Du hast 64 Diamanten gewonnen, schick nur 5 Smaragde Bearbeitungsgebuehr!',
        'Huch, das wollte ich gar nicht ueberweisen!', 'Wo ist nochmal die Enter-Taste?', '/setblock 1 2 3 stone',
        'Ich tausche 3 Brot gegen 10 Eisen.', 'Kuchen-Aktien! Nur 2 Gold pro Stueck.'])
        assert.equal(chatBlockReason(t), null, t);
});

test('links, real money, bank data, passwords and personal data are blocked', () => {
    const bad = {
        'Schau mal auf www.gewinn-spiel.com': 'link', 'https://x.y/z': 'link', 'geh auf paypal.me/anja': 'link',
        'Schick mir 5 Euro': 'real money', 'nur 10€ und du bekommst Dias': 'real money', 'zahl mit echtem Geld': 'real money',
        'DE89 3704 0044 0532 0130 00': 'bank data', 'Wie ist deine IBAN?': 'bank data',
        'Sag mir dein Passwort': 'password or login', 'Passwort123': 'password or login', 'dein Login bitte': 'password or login',
        'Wie ist deine E-Mail?': 'personal data', 'ruf an: 0171 1234567': 'personal data', 'Wie ist dein echter Name?': 'personal data',
    };
    for (const [t, why] of Object.entries(bad)) assert.equal(chatBlockReason(t), why, t);
});

test('the filter drops blocked lines and tells why', () => {
    const sent = [], notes = [];
    const bot = {chat: t => sent.push(t), whisper: (u, t) => sent.push(`@${u} ${t}`)};
    installChatFilter(bot, r => notes.push(r));
    bot.chat('Hallo ihr Lieben!');
    bot.chat('Geh auf www.betrug.de');
    bot.whisper('Tester', 'Wie ist dein Passwort?');
    assert.deepEqual(sent, ['Hallo ihr Lieben!']);
    assert.deepEqual(notes, ['link', 'password or login']);
});
