#!/bin/sh
# Setzt den Anzeigenamen (Styled Nicknames) des Live-Bots, wenn er den Charakter wechselt (Lars, 17.11.).
# Der Bot schreibt seinen Charakter nach bots-live/<Bot>/character.json; dieses Skript laeuft auf dem Host
# und schickt bei jeder Aenderung den Konsolenbefehl an den Server (tmux-Sitzung "mc", Socket "mc").
# Aufruf: ./nick-watch.sh [Bot] [Intervall]      (DRY=1: nur anzeigen, nichts senden)
BOT=${1:-CheesyNPC}
SLEEP=${2:-10}
DIR=${DIR:-/home/lars/mindcraft-ce-lauf/bots-live}
F=$DIR/$BOT/character.json
LAST=$DIR/$BOT/.nick-gesetzt
while :; do
  if [ -f "$F" ]; then
    D=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('display',''))" "$F" 2>/dev/null)
    if [ -n "$D" ] && [ "$D" != "$(cat "$LAST" 2>/dev/null)" ]; then
      if [ -n "$DRY" ]; then echo "wuerde setzen: styled-nicknames set $BOT $D"
      else tmux -L mc send-keys -t mc "styled-nicknames set $BOT $D" Enter && echo "$(date +%H:%M) $BOT: $D"; fi
      printf '%s' "$D" > "$LAST"
    fi
  fi
  sleep "$SLEEP"
done
