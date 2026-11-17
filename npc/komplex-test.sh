#!/bin/sh
# Komplexe Auftraege in echt26 (Testbot MindCE): Feld, Kohle, Eisen, Kuehe zuechten, Lager, Tod mit Rueckholen.
# Aufruf: [NUR=kuehe,tod] ./komplex-test.sh [x z]   (Startpunkt, Standard 900 -800). Ergebnis in komplex-ergebnis.txt
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
X=${1:-900}; Z=${2:--800}
J=$L/bots26/MindCE/journal.jsonl
E=$L/komplex-ergebnis.txt
rm -f $L/bots26/MindCE/usage.json
T0=$(date +%s)
./start26.sh >/dev/null; sleep 32
./rcon26.sh "spreadplayers $X $Z 0 4 false MindCE" "time set 1000" "weather clear" >/dev/null; sleep 3

warte() { # $1 Startzeit (s), $2 Limit (s): wartet auf task_end fuer einen Spieler-Auftrag
  python3 - "$J" "$1" "$2" <<'EOF'
import json, sys, time
j, t0, limit = sys.argv[1], int(sys.argv[2]) * 1000, int(sys.argv[3])
end = time.time() + limit
while time.time() < end:
    started = False
    try:
        for l in open(j):
            e = json.loads(l)
            if e.get("at", 0) < t0: continue
            if e["type"] == "task_start" and e.get("forPlayer"): started = True
            if e["type"] == "task_end" and e.get("forPlayer"):
                print(f"{e.get('outcome')}: {e.get('reason', '')[:110]}"); sys.exit()
    except OSError:
        pass
    if not started and time.time() - t0 / 1000 > 60:
        print("keine Aufgabe angelegt (direkt beantwortet)"); sys.exit()
    time.sleep(5)
print("ZEITLIMIT")
EOF
}

szene() { # $1 Name, $2 Auftrag, $3 Limit
  dran $1 || return 0
  S=$(date +%s)
  ./auftrag26.sh "$2" Tester
  R=$(warte $S $3)
  echo "$1 ($(( $(date +%s) - S )) s): $R" | tee -a $E
}

dran() { [ -z "$NUR" ] || echo ",$NUR," | grep -q ",$1,"; }
nachoben() { ./rcon26.sh "spreadplayers $X $Z 0 4 false MindCE" >/dev/null; sleep 4; ./rcon26.sh "tp Tester MindCE" >/dev/null; }
pos() { ./rcon26.sh "data get entity MindCE Pos" | sed "s/.*\[\([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d, \([-0-9]*\)\.[0-9]*d\].*/\1 \2 \3/"; }

: > $E
docker rm -f tester >/dev/null 2>&1
docker run -d --name tester --network karimnet -v $L/tester.cjs:/app/tester.cjs:ro -e MSGS="hallo" -e STAY=1 mindcraft-ce26 node /app/tester.cjs >/dev/null
sleep 6; ./rcon26.sh "tp Tester MindCE" >/dev/null

# 1) Feld: kleiner Teich neben ihm, Rest (Hacke, Samen) muss er selbst besorgen
set -- $(pos); PX=$1; PY=$2; PZ=$3
dran feld && ./rcon26.sh "fill $((PX+4)) $((PY-1)) $((PZ-1)) $((PX+5)) $((PY-1)) $((PZ)) water" >/dev/null
szene feld "Leg bitte neben dem Wasser ein kleines Weizenfeld an." 420
szene kohle "Hol mir bitte 8 Kohle." 360
szene eisen "Hol mir bitte 3 Eisenbarren." 720
# 4) Kuehe: zwei Kuehe neben ihm an der Oberflaeche, Weizen bekommt er (Feld waechst erst in 20 min)
dran kuehe && nachoben
set -- $(pos); PX=$1; PY=$2; PZ=$3
dran kuehe && ./rcon26.sh "summon cow $((PX+3)) $PY $PZ" "summon cow $((PX+3)) $PY $((PZ+2))" "give MindCE wheat 4" >/dev/null
szene kuehe "Zuechte bitte die zwei Kuehe hier, damit wir Nachwuchs haben." 240
# 5) Lager: etwas Ueberschuss geben, dann Lager anlegen lassen
dran lager && ./rcon26.sh "give MindCE bread 12" "give MindCE stone_pickaxe 1" "give MindCE oak_planks 8" >/dev/null
szene lager "Leg dir bitte ein Lager in einer Kiste an, mit Essen und Werkzeug fuer den Notfall." 240
# 5a) Huette (NUR=huette): mit Holz, ohne Hilfe
if dran huette; then
  nachoben
  ./rcon26.sh "give MindCE oak_planks 64" >/dev/null
  szene huette "Bau dir hier bitte eine kleine Huette." 300
fi
# 5b) Ruestung und Diamanten (NUR=ruestung,diamant)
if dran ruestung; then
  nachoben
  ./rcon26.sh "give MindCE iron_ingot 24" >/dev/null
  szene ruestung "Mach dir bitte eine komplette Eisenruestung und zieh sie an." 300
fi
if dran diamant; then
  nachoben
  ./rcon26.sh "give MindCE iron_pickaxe 1" "give MindCE cooked_beef 16" "give MindCE torch 32" "give MindCE cobblestone 64" >/dev/null
  szene diamant "Hol mir bitte 3 Diamanten, aber pass auf dich auf." 1500
  ./rcon26.sh "data get entity MindCE Pos" | tee -a $E
fi
# 5c) Wertvolles mitnehmen (NUR=wertvoll): Raum auf y -58 mit 3 Diamanterzen, Auftrag nur fuer einen
if dran wertvoll; then
  nachoben
  set -- $(pos); PX=$1; PZ=$3
  ./rcon26.sh "clear MindCE" "fill $((PX-3)) -60 $((PZ-3)) $((PX+3)) -55 $((PZ+3)) deepslate" "fill $((PX-2)) -59 $((PZ-2)) $((PX+2)) -57 $((PZ+2)) air"     "setblock $((PX+3)) -58 $PZ deepslate_diamond_ore" "setblock $((PX-3)) -58 $PZ deepslate_diamond_ore" "setblock $PX -58 $((PZ+3)) deepslate_diamond_ore"     >/dev/null
  ./rcon26.sh "tp MindCE $PX -59 $PZ" "give MindCE iron_pickaxe 1" "give MindCE cooked_beef 8" >/dev/null; sleep 4
  szene wertvoll "Bau bitte einen Diamanten hier ab und behalte ihn." 180
  sleep 20
  ./rcon26.sh "clear MindCE minecraft:diamond 0" | tee -a $E
fi
# 6) Tod und Rueckholen: Spawnpunkt 25 Bloecke weg, dann sterben
if dran tod; then
nachoben
set -- $(pos); PX=$1; PY=$2; PZ=$3
./rcon26.sh "spawnpoint MindCE $((PX+25)) $(( PY + 0 )) $PZ" >/dev/null
S=$(date +%s)
./rcon26.sh "kill MindCE" >/dev/null
python3 - "$J" "$S" <<'EOF' | tee -a $E
import json, sys, time
j, t0 = sys.argv[1], int(sys.argv[2]) * 1000
end = time.time() + 300
while time.time() < end:
    for l in open(j):
        e = json.loads(l)
        if e.get("at", 0) >= t0 and e["type"] == "recover":
            print(f"tod ({int(time.time() - t0 / 1000)} s): {e.get('msg')}"); sys.exit()
    time.sleep(5)
print("tod: ZEITLIMIT (kein recover-Eintrag)")
EOF
fi
docker stop mindcraft-ce26-bot >/dev/null
docker rm -f tester >/dev/null 2>&1
echo "--- Bericht ---"
MIN=$(( ($(date +%s) - T0) / 60 + 1 ))
BOTDIR=$L/bots26/MindCE ASSUME_PLAY=1 python3 /home/lars/mindcraft-ce/npc/abendbericht.py $(python3 -c "print($MIN/60)")
