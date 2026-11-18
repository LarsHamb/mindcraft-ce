#!/bin/sh
# Dauerlauf in echt26 (Lars, 18.11.): frischer Bot mit dem CheesyNPC-Profil (als MindCE) am Testdorf.
# Ziel: dem Dorf anschliessen, Basis im Haus mit Kisten, Ausruestung bis Diamantruestung.
# Aufruf: ./dorf-dauerlauf.sh [minuten]   Ergebnis: dorf-dauerlauf.txt (Schnappschuss alle 10 min)
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
MIN=${1:-120}
E=$L/dorf-dauerlauf.txt
B=$L/bots26/MindCE
P=$L/profiles/mindce.json
cp $P /tmp/mindce-profil.bak
python3 - /home/lars/mindcraft-ce/npc/cheesynpc.json $P <<'EOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8')); d['name'] = 'MindCE'
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
EOF
# frische Welt-Daten fuer den Bot (alter Stand gesichert)
Z=$B/vor-dauerlauf-$(date +%H%M); mkdir -p $Z
for f in memory.json home.json built_areas.json own_blocks.json restore.json player_areas.json met_players.json death_recovery.json character.json journal.jsonl usage.json; do [ -f $B/$f ] && mv $B/$f $Z/; done
./start26.sh >/dev/null; sleep 40
# ein Zuschauer muss online sein, sonst pausiert der Bot (keine Spieler = keine Modellanfragen)
docker rm -f tester >/dev/null 2>&1
docker run -d --name tester --network karimnet -v $L/tester.cjs:/app/tester.cjs:ro -e MSGS="hallo" -e STAY=1 mindcraft-ce26 node /app/tester.cjs >/dev/null
sleep 8; ./rcon26.sh "gamemode spectator Tester" >/dev/null
./rcon26.sh "difficulty normal" "gamerule minecraft:advance_time true" "time set 1000" "gamemode survival MindCE" "clear MindCE" "effect clear MindCE" "spreadplayers 1560 -1560 0 10 false MindCE" >/dev/null
sleep 5
RCON=./rcon26.sh /home/lars/mindcraft-ce/npc/zum-dorf.sh MindCE kit | tee $E
./rcon26.sh "spawnpoint MindCE 1675 66 -1630" >/dev/null
sleep 5
./auftrag26.sh "Schliess dich bitte dem Dorf hier an: zieh in ein freies Haus, richte dort deine Basis mit Kisten ein und arbeite dich dann Schritt fuer Schritt bis zur kompletten Diamantruestung hoch. Pass auf dich auf." HiImCheeZy
S=$(date +%s)
schnapp() {
  T=$(( ($(date +%s) - S) / 60 ))
  POS=$(./rcon26.sh "data get entity MindCE Pos" | sed 's/.*\[\([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d\].*/\1 \2 \3/')
  INV=$(./rcon26.sh "data get entity MindCE Inventory" | python3 -c "
import re,sys,collections
s=sys.stdin.read(); c=collections.Counter()
for m in re.finditer(r'\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', s):
    b=m.group(1); i=re.search(r'id: \"minecraft:([a-z_]+)\"', b); n=re.search(r'count: (\d+)', b)
    if i and n: c[i.group(1)]+=int(n.group(1))
keep=[k for k in c if re.search('diamond|iron|chest|bed|pickaxe|sword|shield|bow|arrow|cooked|bread|torch|coal', k)]
print(', '.join(f'{k} {c[k]}' for k in sorted(keep)))
")
  echo "$T min: pos $POS | $INV" | tee -a $E
}
while [ $(( $(date +%s) - S )) -lt $(( MIN * 60 )) ]; do sleep 600; schnapp; done
echo "--- Bericht ---" | tee -a $E
BOTDIR=$B ASSUME_PLAY=1 python3 /home/lars/mindcraft-ce/npc/abendbericht.py $(python3 -c "print($MIN/60+0.2)") | tee -a $E
cat $B/home.json 2>/dev/null | tee -a $E
docker stop mindcraft-ce26-bot >/dev/null
docker rm -f tester >/dev/null 2>&1
cp /tmp/mindce-profil.bak $P
