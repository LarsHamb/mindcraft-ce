#!/bin/sh
# Start in der neuen Welt (Lars, 18.11.: "dass er mit uns startet"). Nur auf Lars' Wort ausfuehren.
#  1. Sichert den ganzen Bot-Ordner nach bots-live/alte-welt-<zeit>.
#  2. Setzt alles Weltbezogene zurueck: Zuhause/Dorf, Schutzzonen (built/player), eigene Bloecke, Wiederherstellungen,
#     Todes-Bergung, Tagebuch, gemerkte Orte, Ziele und Auftrag, Gespraechsverlauf, Orte und Lage in der
#     Zusammenfassung (auch pro Charakter).
#     Behalten: Spieler-Gedaechtnis und Vertrauen (players.json), Tipps samt Whitelist und eigene Lehren (tips.json),
#     Charakter (character.json), Spielernotizen, Regeln und Rollen in der Zusammenfassung.
#  3. Holt das naechste Dorf zum Weltspawn per locate (oder nimmt x z aus den Argumenten) und setzt village_hint
#     in settings-live-lokal.json (start-live.sh liest sie).
#  4. Startet den Bot, wartet bis er online ist, setzt ihn mit Eisenkit ins Dorf (zum-dorf.sh). Er zieht dann selbst ein.
# Aufruf: ./neustart-neue-welt.sh [x z]
#   Fuer Tests: B=<botordner> CON=<konsole> LOKAL=<datei> NOSTART=1 (nur 1-3) NODORF=1 (ohne tp/kit)
L=/home/lars/mindcraft-ce-lauf
N=/home/lars/mindcraft-ce/npc
BOT=${BOT:-CheesyNPC}
B=${B:-$L/bots-live/$BOT}
CON=${CON:-$N/konsole-live.sh}
LOKAL=${LOKAL:-$L/settings-live-lokal.json}
START=${START:-$N/start-live.sh}
[ -d "$B" ] || { echo "Bot-Ordner fehlt: $B"; exit 1; }
if [ -z "$NOSTART" ] && docker ps --format '{{.Names}}' | grep -qx mindcraft-live-bot; then
  echo "mindcraft-live-bot laeuft noch, erst stoppen: docker stop mindcraft-live-bot"; exit 1
fi

# 1. sichern
Z=$(dirname "$B")/alte-welt-$(date +%Y%m%d-%H%M%S)
cp -a "$B" "$Z" || { echo "Sichern fehlgeschlagen"; exit 1; }
echo "gesichert: $Z"

# 2. zuruecksetzen
for f in built_areas.json restore.json player_areas.json; do echo "[]" > "$B/$f"; done
echo "{}" > "$B/own_blocks.json"
rm -f "$B/home.json" "$B/stash.json" "$B/met_players.json" "$B/death_recovery.json" "$B/journal.jsonl" "$B/.nick-gesetzt"
python3 - "$B" <<'PY'
import json, os, re, sys, time
b = sys.argv[1]
WORLD = re.compile(r'-?\d+\s*[,/ ]\s*-?\d+\s*[,/ ]\s*-?\d+|-?\d{2,6}\s*/\s*-?\d{2,6}|\b(orte|status|lage|position|koordinate|bunker|unterschlupf|kiste|mine|lager)\b', re.I)
NOTE = 'Neue Welt seit %s: alle alten Orte, Haeuser und Kisten gibt es nicht mehr. Zuerst ins naechste Dorf ziehen.' % time.strftime('%d.%m.%Y')
def clean(text):
    keep = [l for l in str(text).splitlines() if l.strip() and not WORLD.search(l)]
    return '\n'.join(keep + [NOTE])
p = os.path.join(b, 'memory.json')
if os.path.exists(p):
    m = json.load(open(p, encoding='utf-8'))
    m['memory'] = clean(m.get('memory', ''))
    m['turns'] = []
    for k in ('self_prompt', 'taskStart'): m.pop(k, None)
    m['self_prompting_state'] = 0
    a = m.get('agent_system') or {}
    for k in ('goals', 'locations', 'directive', 'lastDirective', 'scope'): a.pop(k, None)
    m['agent_system'] = a
    json.dump(m, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('memory.json: Zusammenfassung jetzt', len(m['memory']), 'Zeichen, Verlauf, Orte und Ziele geleert')
p = os.path.join(b, 'memory-by-character.json')
if os.path.exists(p):
    d = json.load(open(p, encoding='utf-8'))
    def walk(x):
        if isinstance(x, str): return clean(x) if len(x) > 40 else x
        if isinstance(x, list): return [walk(i) for i in x]
        if isinstance(x, dict): return {k: ([] if k == 'turns' else walk(v)) for k, v in x.items()}
        return x
    json.dump(walk(d), open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('memory-by-character.json: Orte entfernt')
PY
echo "behalten: $(cd "$B" && ls players.json tips.json character.json 2>/dev/null | tr '\n' ' ')"

# 3. Dorf
if [ -n "$2" ]; then X=$1; ZZ=$2
else
  xz() { sed -n 's/.*at \[\([-0-9]*\), [^,]*, \([-0-9]*\)\].*/\1 \2/p' | head -1; }
  V=$($CON "locate structure #minecraft:village" | xz)
  # fallback: the nearest bell (a village placed with /place has no structure entry)
  [ -n "$V" ] || V=$($CON "locate poi minecraft:meeting" | xz)
  set -- $V
  X=$1; ZZ=$2
fi
[ -n "$X" ] && [ -n "$ZZ" ] || { echo "kein Dorf gefunden: x z selbst angeben (./neustart-neue-welt.sh <x> <z>)"; exit 1; }
python3 - "$LOKAL" "$X" "$ZZ" <<'PY'
import json, os, sys
p, x, z = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
d['village_hint'] = {'x': x, 'y': None, 'z': z}
json.dump(d, open(p, 'w', encoding='utf-8'), indent=1)
PY
echo "Dorf: $X $ZZ (village_hint in $LOKAL)"
[ -n "$NOSTART" ] && { echo "NOSTART: Bot nicht gestartet"; exit 0; }

# 4. starten und ins Dorf
$START || exit 1
i=0
until $CON "list" | grep -q "$BOT"; do
  i=$((i + 1)); [ $i -gt 30 ] && { echo "$BOT nach 3 Minuten nicht online, Dorf-Schritt fehlt: RCON=$CON $N/zum-dorf.sh $BOT kit"; exit 1; }
  sleep 6
done
sleep 10
[ -n "$NODORF" ] && { echo "NODORF: nicht ins Dorf gesetzt"; exit 0; }
RCON=$CON $N/zum-dorf.sh "$BOT" kit
echo "fertig: $BOT ist im Dorf bei $X $ZZ und zieht selbst ein (Bett setzt den Respawn)"
