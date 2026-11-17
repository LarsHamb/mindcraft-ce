#!/bin/sh
# Kurzer Szenen-Test in echt26 (Testbot MindCE): typische Auftraege nacheinander, je mit Zeitlimit.
# Ergebnis pro Szene aus dem Tagebuch (task_end), am Ende der Abendbericht fuer diesen Lauf.
# Aufruf: ./szenen-test.sh [x z]   (Startpunkt, Standard 900 -800)
L=/home/lars/mindcraft-ce-lauf
cd $L || exit 1
X=${1:-900}; Z=${2:--800}
J=$L/bots26/MindCE/journal.jsonl
rm -f $L/bots26/MindCE/usage.json
T0=$(date +%s)
./start26.sh >/dev/null; sleep 32
./rcon26.sh "spreadplayers $X $Z 0 4 false MindCE" "time set 1000" >/dev/null; sleep 3

warte() { # $1 = Startzeit (s), $2 = Limit (s): wartet auf ein task_end fuer einen Spieler-Auftrag
  python3 - "$J" "$1" "$2" <<'EOF'
import json, sys, time
j, t0, limit = sys.argv[1], int(sys.argv[2]) * 1000, int(sys.argv[3])
end = time.time() + limit
while time.time() < end:
    try:
        for l in open(j):
            e = json.loads(l)
            if e.get("at", 0) >= t0 and e["type"] == "task_end" and e.get("forPlayer"):
                print(f"{e.get('outcome')}: {e.get('reason', '')[:100]}"); sys.exit()
    except OSError:
        pass
    time.sleep(5)
print("ZEITLIMIT")
EOF
}

szene() { # $1 Name, $2 Auftrag, $3 Limit
  S=$(date +%s)
  ./auftrag26.sh "$2" Tester
  R=$(warte $S $3)
  echo "$1 ($(( $(date +%s) - S )) s): $R" | tee -a $L/szenen-ergebnis.txt
}

: > $L/szenen-ergebnis.txt
szene holz "Hol mir bitte 8 Holzstaemme." 180
szene stein "Hol mir bitte 16 Bruchstein." 180
P=$(./rcon26.sh "data get entity MindCE Pos"); PX=$(echo $P | sed "s/.*\[\([-0-9]*\)\..*/\1/"); PY=$(echo $P | sed "s/.*, \([-0-9]*\)\.[0-9]*d, .*/\1/"); PZ=$(echo $P | sed "s/.*, \([-0-9]*\)\.[0-9]*d\]/\1/")
./rcon26.sh "fill $((PX+6)) $((PY-1)) $((PZ-3)) $((PX+11)) $((PY-1)) $((PZ+2)) sand" >/dev/null
szene sand "Sammle bitte 16 Sand und leg ihn in eine Kiste neben dir." 240
szene huette "Bau dir hier bitte eine kleine Huette." 180
( sleep 40; ./rcon26.sh "execute at MindCE run summon minecraft:creeper ~7 ~ ~" >/dev/null ) &
szene essen "Besorg dir bitte 4 Stueck Essen." 240
docker stop mindcraft-ce26-bot >/dev/null
./rcon26.sh "kill @e[type=creeper]" >/dev/null
echo "--- Bericht ---"
MIN=$(( ($(date +%s) - T0) / 60 + 1 ))
BOTDIR=$L/bots26/MindCE ASSUME_PLAY=1 python3 /home/lars/mindcraft-ce/npc/abendbericht.py $(python3 -c "print($MIN/60)")
