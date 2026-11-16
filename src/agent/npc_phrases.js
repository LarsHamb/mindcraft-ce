// German versions of mindcraft-ce's fixed chat sentences (narration fallbacks, mode messages).
// Applied in openChat when settings.npc_language is "de". Model-written text passes unchanged;
// no translation service and no model request is involved.

const MOBS = {
    zombie: 'Zombie', skeleton: 'Skelett', spider: 'Spinne', cave_spider: 'Höhlenspinne', creeper: 'Creeper',
    drowned: 'Ertrunkener', husk: 'Wüstenzombie', stray: 'Eiswanderer', witch: 'Hexe', enderman: 'Enderman',
    slime: 'Schleim', phantom: 'Phantom', pillager: 'Plünderer', cow: 'Kuh', pig: 'Schwein', sheep: 'Schaf',
    chicken: 'Huhn', rabbit: 'Hase', salmon: 'Lachs', cod: 'Kabeljau',
};
const RESOURCES = {wood: 'Holz', blocks: 'Blöcke', stone: 'Stein', cobblestone: 'Bruchstein', coal: 'Kohle', 'coal ore': 'Kohle',
    'iron ore': 'Eisenerz', dirt: 'Erde', sand: 'Sand', gravel: 'Kies', 'grass block': 'Erde'};
const mob = name => MOBS[String(name).trim().replace(/ /g, '_').toLowerCase()] || name;
const res = name => RESOURCES[String(name).trim().toLowerCase()] || name;

const EXACT = new Map(Object.entries({
    'That spot is lit.': 'Hier ist es jetzt hell.',
    "I'm lighting the area.": 'Ich mache hier Licht.',
    'That block is in place.': 'Der Block sitzt.',
    "I'm adding the next blocks.": 'Ich setze die nächsten Blöcke.',
    "I've reached the next spot.": 'Bin da.',
    "I'm heading to the next spot.": 'Ich gehe weiter.',
    "I'm making a crafting table.": 'Ich baue eine Werkbank.',
    "I'm crafting what we need.": 'Ich stelle her, was wir brauchen.',
    "I'm waiting for the furnace to finish.": 'Ich warte auf den Ofen.',
    "I'm checking my supplies.": 'Ich schaue in mein Inventar.',
    "I'm checking how things look.": 'Ich schaue, wie es steht.',
    "I'm looking around.": 'Ich schaue mich um.',
    "I'm checking what's nearby.": 'Ich schaue, was in der Nähe ist.',
    "I'm checking how to do this.": 'Ich schaue nach, wie das geht.',
    "I'm working out the next step.": 'Ich überlege den nächsten Schritt.',
    "I'm checking what I can make.": 'Ich schaue, was ich herstellen kann.',
    "I'm bringing you the items.": 'Ich bringe dir die Sachen.',
    "I'm getting the right equipment ready.": 'Ich nehme das richtige Werkzeug.',
    "I'm having something to eat.": 'Ich esse kurz was.',
    "I'm putting the items away.": 'Ich räume die Sachen ein.',
    "I'm getting the items from the chest.": 'Ich hole die Sachen aus der Kiste.',
    "I'm checking the chest.": 'Ich schaue in die Kiste.',
    "I'm heading to bed.": 'Ich gehe ins Bett.',
    "I'm staying here.": 'Ich bleibe hier.',
    "I'm stopping.": 'Ich höre auf.',
    'Stopped.': 'Gestoppt.',
    "I'm going after the target.": 'Ich gehe auf das Ziel los.',
    "I'm going after the player you named.": 'Ich gehe auf den Spieler los.',
    "I'm collecting what's in the furnace.": 'Ich hole die Sachen aus dem Ofen.',
    "I'm clearing some space in my inventory.": 'Ich mache Platz im Inventar.',
    "I'm working on the next step.": 'Ich mache weiter.',
    "I've reached my usage limit and need to pause.": 'Ich mache kurz Pause, mein Limit für diese Stunde ist erreicht.',
    'I need a suitable tool before I can mine that.': 'Dafür brauche ich erst das passende Werkzeug.',
    'My inventory is full. I need to make some room.': 'Mein Inventar ist voll, ich muss Platz machen.',
    "I'm out of torches.": 'Ich habe keine Fackeln mehr.',
    "I don't have the blocks I need.": 'Mir fehlen die Blöcke.',
    "I couldn't put a torch in that spot.": 'Da passt keine Fackel hin.',
    "I couldn't place a block in that spot.": 'Da kann ich keinen Block setzen.',
    "I couldn't reach that spot.": 'Da komme ich nicht hin.',
    "I couldn't finish crafting that yet.": 'Das kann ich noch nicht herstellen.',
    "I couldn't finish smelting that yet.": 'Das Schmelzen hat noch nicht geklappt.',
    "I couldn't finish that step.": 'Der Schritt hat nicht geklappt.',
    "I'm having trouble working out the next step. Please try again shortly.": 'Ich komme gerade nicht weiter. Versuch es gleich nochmal.',
    'I have paused repeated attempts without progress. I need a different approach.': 'Ich komme so nicht weiter und probiere es gleich anders.',
    'I need air!': 'Ich brauche Luft!',
    "I'm on fire!": 'Ich brenne!',
    "Placed some water, ahhhh that's better!": 'Wasser drauf, puh, besser!',
    "Found some water, ahhhh that's better!": 'Wasser gefunden, puh, besser!',
    "I'm dying!": 'Mir geht es schlecht, ich ziehe mich zurück!',
    "I'm stuck!": 'Ich hänge fest!',
    'Trying another approach.': 'Ich versuche es anders.',
    'Picking up item!': 'Ich hebe was auf.',
    "I'm spreading torches along the path.": 'Ich stelle Fackeln am Weg auf.',
    "I'm lighting the next dark patch.": 'Ich mache die nächste dunkle Stelle hell.',
    'The path is lit now.': 'Der Weg ist jetzt hell.',
}));

const PATTERNS = [
    [/^I've made some progress gathering (.+)\.$/, (m, r) => `Ich komme mit ${res(r)} voran.`],
    [/^I'm gathering (.+)\.$/, (m, r) => `Ich sammle ${res(r)}.`],
    [/^I couldn't find more (.+) nearby\.$/, (m, r) => `Ich finde hier kein ${res(r)} mehr.`],
    [/^I'm having trouble gathering (.+)\.$/, (m, r) => `Mit ${res(r)} habe ich gerade Probleme.`],
    [/^Aaa! A (.+)!$/, (m, e) => `Achtung, ${mob(e)}!`],
    [/^Fighting (.+)!$/, (m, e) => `Ich kämpfe gegen: ${mob(e)}!`],
    [/^Hunting (.+)!$/, (m, e) => `Ich jage: ${mob(e)}.`],
];

export function germanize(text) {
    const t = String(text ?? '').trim();
    if (EXACT.has(t)) return EXACT.get(t);
    for (const [re, fn] of PATTERNS) {
        const m = re.exec(t);
        if (m) return fn(...m);
    }
    return text;
}
