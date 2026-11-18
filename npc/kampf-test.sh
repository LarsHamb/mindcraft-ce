#!/bin/sh
# Kampf-Arena in echt26 (Lars, 18.11.: "stärker beim Kämpfen"). MindCE mit Eisenruestung, Eisenschwert, Schild
# auf einer Plattform in der Luft (Barriere-Waende), nachts. Runden: 3 Zombies, 2 Skelette, Creeper, gemischt.
# Aufruf: ./kampf-test.sh [smart|basic] [ausruestung: eisen|stein]   Ergebnis: kampf-ergebnis.txt
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
STYLE=${1:-smart}; KIT=${2:-eisen}; BOW=${BOW:-0}
E=$L/kampf-ergebnis.txt
J=$L/bots26/MindCE/journal.jsonl
python3 - "$L/settings26.json" "$STYLE" <<'EOF'
import json, sys
p, style = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["combat_style"] = style
json.dump(d, open(p, "w"), indent=4)
EOF
X=1700; Y=140; Z=-1800
./start26.sh >/dev/null; sleep 35
docker rm -f tester >/dev/null 2>&1
docker run -d --name tester --network karimnet -v $L/tester.cjs:/app/tester.cjs:ro -e MSGS="hallo" -e STAY=1 mindcraft-ce26 node /app/tester.cjs >/dev/null
sleep 8; ./rcon26.sh "gamemode spectator Tester" "tp Tester $X $((Y+3)) $Z" >/dev/null
./rcon26.sh "difficulty normal" "time set 18000" "fill $((X-9)) $((Y-1)) $((Z-9)) $((X+9)) $((Y+5)) $((Z+9)) air" \
  "fill $((X-9)) $((Y-1)) $((Z-9)) $((X+9)) $((Y-1)) $((Z+9)) stone" \
  "fill $((X-9)) $Y $((Z-9)) $((X+9)) $((Y+4)) $((Z-9)) barrier" "fill $((X-9)) $Y $((Z+9)) $((X+9)) $((Y+4)) $((Z+9)) barrier" \
  "fill $((X-9)) $Y $((Z-9)) $((X-9)) $((Y+4)) $((Z+9)) barrier" "fill $((X+9)) $Y $((Z-9)) $((X+9)) $((Y+4)) $((Z+9)) barrier" \
  "fill $((X-9)) $((Y+5)) $((Z-9)) $((X+9)) $((Y+5)) $((Z+9)) barrier" >/dev/null
ruestung() {
  ./rcon26.sh "kill @e[type=!player,distance=..30,x=$X,y=$Y,z=$Z]" "tp MindCE $X $Y $Z" "clear MindCE" "effect clear MindCE" >/dev/null
  if [ "$KIT" = eisen ]; then
    ./rcon26.sh "item replace entity MindCE armor.head with iron_helmet" "item replace entity MindCE armor.chest with iron_chestplate" \
      "item replace entity MindCE armor.legs with iron_leggings" "item replace entity MindCE armor.feet with iron_boots" \
      "give MindCE iron_sword 1" "give MindCE shield 1" "give MindCE bread 8" >/dev/null
  else
    ./rcon26.sh "give MindCE stone_sword 1" "give MindCE bread 8" >/dev/null
  fi
  ./rcon26.sh "effect give MindCE instant_health 1 10" "effect give MindCE saturation 1 10" >/dev/null
  [ "$BOW" = 1 ] && ./rcon26.sh "give MindCE bow 1" "give MindCE arrow 32" >/dev/null
  sleep 4
}
runde() { # $1 Name, $2.. summon-Befehle (relativ)
  NAME=$1; shift
  ruestung
  D0=$(grep -c '"type":"death"' $J 2>/dev/null)
  for m in "$@"; do ./rcon26.sh "summon $m" >/dev/null; done
  S=$(date +%s)
  for i in $(seq 1 30); do
    sleep 3
    N=$(./rcon26.sh "execute if entity @e[type=!player,type=!item,type=!experience_orb,type=!arrow,x=$X,y=$Y,z=$Z,distance=..15]" | sed -n "s/.*Count: \([0-9]*\).*/\1/p")
    [ "${N:-0}" = 0 ] && break
  done
  H=$(./rcon26.sh "data get entity MindCE Health" | sed -n "s/.*data: \([0-9.]*\)f.*/\1/p")
  D1=$(grep -c '"type":"death"' $J 2>/dev/null)
  echo "$STYLE/$KIT $NAME: $(( $(date +%s) - S )) s, Rest-Mobs ${N:-?}, Leben ${H:-?}, Tode $((D1 - D0))" | tee -a $E
}
runde "3 Zombies" "zombie $((X+6)) $Y $Z" "zombie $((X-6)) $Y $Z" "zombie $X $Y $((Z+6))"
runde "2 Skelette" "skeleton $((X+7)) $Y $((Z+3))" "skeleton $((X-7)) $Y $((Z-3))"
runde "Creeper" "creeper $((X+6)) $Y $Z"
runde "gemischt" "zombie $((X+6)) $Y $Z" "zombie $((X-6)) $Y $((Z+2))" "skeleton $X $Y $((Z+7))" "spider $((X+5)) $Y $((Z-5))"
docker logs --since 10m mindcraft-ce26-bot 2>&1 | grep -E "defended self|killed|Retreated|backed off" | tail -8 | cut -c1-160 | tee -a $E
docker stop mindcraft-ce26-bot >/dev/null
docker rm -f tester >/dev/null 2>&1
