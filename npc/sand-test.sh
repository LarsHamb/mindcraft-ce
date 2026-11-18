#!/bin/sh
# Grossauftrag-Test in echt26 (Lars, 18.11.: "ob er das mit Sand holen oder einen grossen Auftrag hin bekommt").
# Start im Wald bei 1400 -1600 (Strand 115, Wueste 143 Bloecke weg). Der Testspieler steht im Kreativmodus am
# Start und gibt den Auftrag im Chat; gezaehlt wird, was am Ende in seinem Inventar ankommt.
# Aufruf: ./sand-test.sh [menge] [schaufel: none|wooden|stone|iron] [voll: 0|1] [minuten] ["auftrag"]
# Ergebnis: sand-ergebnis.txt (alle 5 Minuten Stand)
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
N=${1:-128}; SHOVEL=${2:-none}; FULL=${3:-0}; MIN=${4:-40}; ITEM=${ITEM:-sand}
MSG=${5:-"Hmmbert, hol mir bitte $N Sand und bring ihn mir hierher."}
E=$L/sand-ergebnis.txt
B=$L/bots26/MindCE; P=$L/profiles/mindce.json; J=$B/journal.jsonl
cp $P $L/mindce-profil.bak
[ -f $B/players.json ] && mv $B/players.json $B/players-vor-sandtest-$(date +%H%M%S).json
python3 - /home/lars/mindcraft-ce/npc/cheesynpc.json $P <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8')); d['name'] = 'MindCE'
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
PY
X=1400; Z=-1600
echo "=== $(date +%H:%M) Auftrag: $MSG | Schaufel $SHOVEL, Inventar voll $FULL" | tee -a $E
./start26.sh >/dev/null; sleep 35
Y=$(./rcon26.sh "forceload add $X $Z" "execute positioned $X 300 $Z run spreadplayers $X $Z 0 1 false MindCE" >/dev/null; sleep 3; ./rcon26.sh "data get entity MindCE Pos" | sed 's/.*\[[-0-9.]*d, \([-0-9]*\)\..*/\1/')
./rcon26.sh "forceload remove $X $Z" "difficulty normal" "time set 1000" "gamemode survival MindCE" "clear MindCE" "effect clear MindCE" \
  "item replace entity MindCE armor.head with iron_helmet" "item replace entity MindCE armor.chest with iron_chestplate" \
  "item replace entity MindCE armor.legs with iron_leggings" "item replace entity MindCE armor.feet with iron_boots" \
  "give MindCE iron_sword 1" "give MindCE stone_pickaxe 1" "give MindCE bread 16" "give MindCE oak_planks 8" >/dev/null
[ "$SHOVEL" != none ] && ./rcon26.sh "give MindCE ${SHOVEL}_shovel 1" >/dev/null
if [ "$FULL" = 1 ]; then
  for it in cobblestone dirt gravel granite diorite andesite oak_log birch_log spruce_log cobbled_deepslate tuff calcite \
            sandstone red_sand clay_ball flint string bone arrow feather leather wheat_seeds oak_sapling stick coal; do
    ./rcon26.sh "give MindCE $it 64" >/dev/null
  done
fi
docker rm -f tester >/dev/null 2>&1
docker run -d --name tester --network karimnet -v $L/tester.cjs:/app/tester.cjs:ro -e MSGS="$MSG" -e STAY=1 mindcraft-ce26 node /app/tester.cjs >/dev/null
sleep 5; ./rcon26.sh "gamemode creative Tester" "clear Tester" "tp Tester $X $((Y+1)) $((Z+3))" >/dev/null
S=$(date +%s)
zahl() { ./rcon26.sh "clear $1 minecraft:$ITEM 0" | sed -n 's/.*Found \([0-9]*\).*/\1/p'; }
while [ $(( $(date +%s) - S )) -lt $(( MIN * 60 )) ]; do
  sleep 300
  T=$(( ($(date +%s) - S) / 60 ))
  POS=$(./rcon26.sh "data get entity MindCE Pos" | sed 's/.*\[\([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d\].*/\1 \2 \3/')
  G=$(zahl Tester); H=$(zahl MindCE)
  echo "$T min: pos $POS | Tester hat ${G:-0} $ITEM, Bot traegt ${H:-0}" | tee -a $E
  [ "${G:-0}" -ge "$N" ] && break
done
echo "--- Ablauf ---" | tee -a $E
python3 - $J $S <<'PY' | tee -a $E
import json, sys
start = int(sys.argv[2]) * 1000
for line in open(sys.argv[1], encoding='utf-8'):
    try: e = json.loads(line)
    except Exception: continue
    if (e.get('at') or e.get('t') or 0) < start: continue
    k = e.get('type')
    if k in ('task_start', 'task_end'): print(k, (e.get('objective') or '')[:90], e.get('outcome', ''), (e.get('reason') or '')[:110])
    elif k == 'tool' and e.get('status') not in ('ok', None): print('  tool', e.get('tool'), e.get('status'), (e.get('text') or '')[:120])
    elif k in ('death', 'stuck'): print(k, json.dumps(e)[:140])
PY
docker logs tester 2>&1 | grep CHAT | tail -12 | cut -c1-220 | tee -a $E
docker stop mindcraft-ce26-bot >/dev/null
docker rm -f tester >/dev/null 2>&1
cp $L/mindce-profil.bak $P
