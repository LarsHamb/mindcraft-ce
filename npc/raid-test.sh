#!/bin/sh
# Lerntest 18.11. in echt26 (Lars: "ja bitte die lernings umsetzten"):
#   flucht  ohne Ruestung, 2 Pluenderer 25 Bloecke weg: einmal weit fliehen, keine Flucht-Schleife
#   kampf   Eisenkit, 2 Pluenderer: gezielt kaempfen
#   alarm   Eisenkit am Dorf, Pluenderer 45 Bloecke vor der Glocke: Glocke laeuten, im Chat warnen
#   abend   ohne Auftrag 270 Bloecke vom Dorfbett, Abend: rechtzeitig heim, Ueberzaehliges in die Kiste, Ersatzkit
#   tod     am Dorf ohne Sachen sterben: am Bett wieder da, zuerst aus der Kiste ausruesten
# Aufruf: ./raid-test.sh <szenario> [minuten]    Ergebnis: raid-ergebnis.txt
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
SZ=${1:?szenario fehlt}; MIN=${2:-4}
E=$L/raid-ergebnis.txt; B=$L/bots26/MindCE; P=$L/profiles/mindce.json; J=$B/journal.jsonl
R=./rcon26.sh
cp $P $L/mindce-profil.bak
python3 - /home/lars/mindcraft-ce/npc/cheesynpc.json $P <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8')); d['name'] = 'MindCE'
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
PY
echo "=== $(date +%H:%M) Szenario $SZ" | tee -a $E
docker ps --format '{{.Names}}' | grep -q '^mindcraft-ce26-bot$' || { ./start26.sh >/dev/null; sleep 35; }
pos() { $R "data get entity MindCE Pos" | sed 's/.*\[\([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d\].*/\1 \2 \3/'; }
put() { $R "forceload add $1 $2" "execute positioned $1 300 $2 run spreadplayers $1 $2 0 1 false MindCE" >/dev/null; sleep 3; $R "forceload remove $1 $2" >/dev/null; }
kit() { $R "item replace entity MindCE armor.head with iron_helmet" "item replace entity MindCE armor.chest with iron_chestplate" \
  "item replace entity MindCE armor.legs with iron_leggings" "item replace entity MindCE armor.feet with iron_boots" \
  "give MindCE iron_sword 1" "give MindCE shield 1" >/dev/null; }
base() { $R "difficulty normal" "gamemode survival MindCE" "clear MindCE" "effect clear MindCE" "effect give MindCE instant_health 1 5" \
  "give MindCE stone_pickaxe 1" "give MindCE bread 12" >/dev/null; }
pillager() { $R "execute at MindCE run summon pillager ~$1 ~ ~$2" "execute at MindCE run summon pillager ~$1 ~ ~$(($2 + 3))" >/dev/null; }
$R "time set 1000" "kill @e[type=pillager]" >/dev/null
S=$(date +%s)
case $SZ in
  flucht) put 1400 -1600; base; $R "time set 1000" "kill @e[type=pillager]" >/dev/null; sleep 3; pillager 25 0 ;;
  kampf)  put 1400 -1600; base; kit; $R "time set 1000" "kill @e[type=pillager]" >/dev/null; sleep 3; pillager 22 0 ;;
  alarm)  put 1685 -1645; base; kit; $R "time set 1000" "kill @e[type=pillager]" >/dev/null; sleep 5
          $R "summon pillager 1720 75 -1642" "summon pillager 1721 75 -1645" "execute positioned 1720 75 -1642 run spreadplayers 1720 -1643 0 3 false @e[type=pillager]" >/dev/null ;;
  abend)  put 1400 -1600; base; $R "time set 8700" "give MindCE cobblestone 64" "give MindCE oak_planks 24" "give MindCE crafting_table 1" \
          "give MindCE dirt 40" "give MindCE stone_pickaxe 1" "give MindCE leather_helmet 1" "item replace entity MindCE armor.head with iron_helmet" >/dev/null ;;
  tod)    put 1671 -1606; $R "time set 3000" >/dev/null; sleep 20; $R "clear MindCE" "kill MindCE" >/dev/null ;;
esac
docker rm -f tester >/dev/null 2>&1
docker run -d --name tester --network karimnet -v $L/tester.cjs:/app/tester.cjs:ro -e MSGS="" -e STAY=1 mindcraft-ce26 node /app/tester.cjs >/dev/null
sleep 6; $R "gamemode spectator Tester" "execute at MindCE run tp Tester ~ ~10 ~" >/dev/null
while [ $(( $(date +%s) - S )) -lt $(( MIN * 60 )) ]; do
  sleep 30
  echo "$(( $(date +%s) - S )) s: pos $(pos) | Pluenderer: $($R 'execute if entity @e[type=pillager]' | sed -n 's/.*Count: \([0-9]*\).*/\1/p')" | tee -a $E
done
echo "--- Ablauf ---" | tee -a $E
python3 - $J $S <<'PY' | tee -a $E
import json, sys
start = int(sys.argv[2]) * 1000
for line in open(sys.argv[1], encoding='utf-8'):
    try: e = json.loads(line)
    except Exception: continue
    if (e.get('at') or 0) < start: continue
    k = e.get('type')
    if k in ('reflex', 'alarm', 'bell', 'kill', 'death', 'recover', 'evening_home', 'evening_store', 'watchdog', 'stuck'): print(k, json.dumps({x: y for x, y in e.items() if x not in ('at', 'type')})[:170])
    elif k == 'tool' and e.get('tool') in ('buildShelter', 'stash'): print('  tool', e.get('tool'), e.get('status'), (e.get('text') or '')[:120])
PY
echo "Inventar: $($R 'data get entity MindCE Inventory' | grep -o 'count: [0-9]*, Slot: [0-9]*b, id: \"minecraft:[a-z_]*' | sed 's/count: \([0-9]*\), Slot: [0-9]*b, id: \"minecraft:/ /' | tr '\n' ',' | cut -c1-300)" | tee -a $E
echo "Ruestung: $($R 'data get entity MindCE equipment' | grep -o 'minecraft:[a-z_]*' | tr '\n' ' ')" | tee -a $E
docker logs tester 2>&1 | grep CHAT | tail -10 | cut -c1-200 | tee -a $E
docker logs --since ${MIN}m mindcraft-ce26-bot 2>&1 | grep -E 'Danger zone|fight |Mode (ranged_threat|evening_home|recover_items)' | tail -12 | cut -c1-200 | tee -a $E
docker rm -f tester >/dev/null 2>&1
cp $L/mindce-profil.bak $P
