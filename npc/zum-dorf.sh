#!/bin/sh
# Schickt den Bot zum naechsten Dorf und gibt ihm auf Wunsch das Start-Eisenkit (Lars, 17.11.: neue Welt).
# Aufruf: RCON="<rcon-befehl>" ./zum-dorf.sh <botname> [kit]
#   RCON: Befehl, der Konsolenbefehle als Argumente nimmt und die Antwort ausgibt
#         (Standard: Testwelt echt26, ~/mindcraft-ce-lauf/rcon26.sh).
# Der Bot muss online sein. Danach zieht er selbst ein (village move_in).
NAME=${1:?Botname fehlt}
RCON=${RCON:-/home/lars/mindcraft-ce-lauf/rcon26.sh}
xz() { sed -n 's/.*at \[\([-0-9]*\), [^,]*, \([-0-9]*\)\].*/\1 \2/p' | head -1; }
V=$($RCON "execute at $NAME run locate structure #minecraft:village" | xz)
# Fallback: the nearest bell (meeting point), e.g. a village placed with /place has no structure entry
[ -n "$V" ] || V=$($RCON "execute at $NAME run locate poi minecraft:meeting" | xz)
[ -n "$V" ] || { echo "kein Dorf gefunden (ist $NAME online?)"; exit 1; }
set -- $V "$2"
$RCON "spreadplayers $(($1 + 12)) $2 0 6 false $NAME" >/dev/null
echo "$NAME ans Dorf bei $1 $2 gesetzt"
if [ "$3" = "kit" ]; then
  $RCON "give $NAME iron_helmet 1" "give $NAME iron_chestplate 1" "give $NAME iron_leggings 1" "give $NAME iron_boots 1" \
        "give $NAME iron_sword 1" "give $NAME shield 1" "give $NAME bread 16" >/dev/null
  echo "Eisenkit gegeben (Ruestung, Schwert, Schild, 16 Brot)"
fi
