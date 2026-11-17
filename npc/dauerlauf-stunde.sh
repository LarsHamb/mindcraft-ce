#!/bin/sh
# 1-Stunden-Lauf: MindCE lebt frisch (leeres Inventar, neuer Ort) selbststaendig in echt26, Tester schaut nur zu.
# Alle 10 min ein Schnappschuss (Ort, Inventar, letzte Aufgaben), am Ende Auswertung.
MIN=${1:-60}; X=${2:-1500}; Z=${3:--1500}
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
S=$L/stunde-schnappschuesse.txt; : > $S
docker rm -f mindcraft-ce26-bot tester >/dev/null 2>&1
rm -f $L/bots26/MindCE/memory.json $L/bots26/MindCE/usage.json $L/bots26/MindCE/death_recovery.json
T0=$(date +%s); echo "$T0" > $L/dauerlauf.start
./start26.sh >/dev/null; sleep 32
./rcon26.sh "clear MindCE" "spreadplayers $X $Z 0 8 false MindCE" "time set 0" "weather clear" "spawnpoint MindCE ~ ~ ~" >/dev/null; sleep 3
./rcon26.sh "execute as MindCE at @s run spawnpoint MindCE ~ ~ ~" >/dev/null
docker run -d --name tester --network karimnet -v $L/tester.cjs:/app/tester.cjs:ro -e MSGS="hallo" -e STAY=1 mindcraft-ce26 node /app/tester.cjs >/dev/null
sleep 6; ./rcon26.sh "tp Tester MindCE" "gamemode spectator Tester" >/dev/null
./auftrag26.sh "Ich schaue dir heute nur zu und gebe dir keine Auftraege. Du startest mit nichts an einem neuen Ort. Lebe selbststaendig und plane selbst: erst ueberleben (Holz, Werkzeug, Essen, Unterschlupf vor der Nacht), dann richtige Projekte, zum Beispiel ein Weizenfeld, Tiere zuechten, Eisen fuer bessere Werkzeuge und einen Eimer, eine Vorratskiste fuer den Notfall und dein Meisterwerk. Sag ab und zu kurz im Chat, was du machst." Tester
i=0
while [ $i -lt $((MIN / 10)) ]; do
  sleep 600; i=$((i + 1))
  P=$(./rcon26.sh "data get entity MindCE Pos" | sed "s/.*\[\(.*\)\]/\1/")
  INV=$(docker exec mindcraft-ce26-bot node -e "" 2>/dev/null; python3 - $L/bots26/MindCE/journal.jsonl $T0 <<'PY'
import json, sys
t0 = int(sys.argv[2]) * 1000
ev = [json.loads(l) for l in open(sys.argv[1]) if json.loads(l).get("at", 0) >= t0]
ends = [e for e in ev if e["type"] == "task_end"][-3:]
print(f"Aufgaben bisher {sum(e['type']=='task_end' for e in ev)}, erledigt {sum(e['type']=='task_end' and e.get('outcome')=='done' for e in ev)}, Tode {sum(e['type']=='death' for e in ev)}")
for e in ends: print(f"   - {e.get('outcome')}: {str(e.get('objective',''))[:90]}")
PY
)
  echo "== $((i * 10)) min  Pos $P" >> $S; echo "$INV" >> $S
done
docker stop mindcraft-ce26-bot >/dev/null; docker rm -f tester >/dev/null 2>&1
echo "--- Schnappschuesse ---"; cat $S
echo "--- Bericht ---"
BOTDIR=$L/bots26/MindCE ASSUME_PLAY=1 python3 /home/lars/mindcraft-ce/npc/abendbericht.py $(python3 -c "print(($MIN+2)/60)")
