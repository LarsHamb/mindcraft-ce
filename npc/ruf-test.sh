#!/bin/sh
# Ruf-Test in echt26 (Lars, 18.11.: "wenn ihm jemand etwas gibt ... aergert oder manipuliert merkt er sich das").
# MindCE mit CheesyNPC-Profil in der Arena, der Testspieler schenkt, schlaegt, manipuliert, kippt Lava,
# will dann einen Auftrag und entschuldigt sich. Ergebnis: ruf-ergebnis.txt
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
E=$L/ruf-ergebnis.txt; : > $E
B=$L/bots26/MindCE; P=$L/profiles/mindce.json
cp $P $L/mindce-profil.bak
python3 - /home/lars/mindcraft-ce/npc/cheesynpc.json $P <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8')); d['name'] = 'MindCE'
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
PY
[ -f $B/players.json ] && mv $B/players.json $B/players-vor-ruftest-$(date +%H%M%S).json
X=1700; Y=140; Z=-1800
./start26.sh >/dev/null; sleep 35
./rcon26.sh "difficulty peaceful" "time set 1000" "gamemode survival MindCE" "tp MindCE $X $Y $Z" "effect give MindCE fire_resistance 600 0" >/dev/null
docker rm -f tester >/dev/null 2>&1
docker run -d --name tester --network karimnet -v /home/lars/mindcraft-ce/npc/ruf-tester.cjs:/app/t.cjs:ro mindcraft-ce26 node /app/t.cjs >/dev/null
sleep 5
./rcon26.sh "gamemode survival Tester" "clear Tester" "tp Tester $((X+2)) $Y $Z" "give Tester bread 6" "give Tester lava_bucket 1" >/dev/null
# Lava nach dem Kippen wieder weg
( sleep 140; ./rcon26.sh "fill $((X-8)) $Y $((Z-8)) $((X+8)) $((Y+3)) $((Z+8)) air replace lava" >/dev/null ) &
for i in $(seq 1 50); do sleep 5; docker ps -q -f name=^tester$ | grep -q . || break; done
docker logs tester 2>&1 | tee -a $E
echo "--- Bot-Log ---" | tee -a $E
docker logs --since 6m mindcraft-ce26-bot 2>&1 | grep -E "Reputation|Not attacking|Refused|MindCE.*(chat|says)|received message" | cut -c1-200 | tail -30 | tee -a $E
echo "--- players.json ---" | tee -a $E
cat $B/players.json | tee -a $E
docker stop mindcraft-ce26-bot >/dev/null
docker rm -f tester >/dev/null 2>&1
cp $L/mindce-profil.bak $P
