#!/bin/sh
# Konsolenbefehle an den Boys-Server schicken (tmux-Sitzung "mc", Socket "mc") und die Antworten aus
# ~/minecraft/logs/latest.log ausgeben, wie rcon26.sh fuer echt26. Nur auf Lars' Wort benutzen.
# Aufruf: ./konsole-live.sh "<befehl>" ["<befehl>" ...]
LOG=${LOG:-/home/lars/minecraft/logs/latest.log}
for c in "$@"; do
  n=$(wc -l < "$LOG")
  tmux -L mc send-keys -t mc "$c" Enter
  sleep ${WAIT:-2}
  tail -n +$((n + 1)) "$LOG" | sed 's/^\[[^]]*\] \[[^]]*\]: //'
done
