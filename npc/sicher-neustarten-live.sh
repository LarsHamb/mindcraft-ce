#!/bin/sh
# Startet den Live-Bot CheesyNPC (mindcraft-live-bot) neu, aber nur wenn in den letzten 5 Minuten
# niemand mit ihm geredet hat: kein Spieler-Chat im Server-Log und keine Nachricht an ihn im Bot-Log.
# Wartet sonst bis zu MAX Sekunden (Standard 900). Den Minecraft-Server fasst das Skript nicht an.
# Zwischen zwei Anmeldungen mindestens 2 Minuten, sonst sperrt Mojang mit 429.
MAX=${1:-900}
case "$MAX" in ''|*[!0-9]*) MAX=900 ;; esac
SERVERLOG=${SERVERLOG:-$HOME/minecraft/logs/latest.log}

gespraech() {
  a=$(docker logs --since 5m mindcraft-live-bot 2>&1 | grep "received message from" | grep -vc "from system\|from ADMIN\|from Server")
  c=$(python3 - "$SERVERLOG" <<'EOF'
import sys, re, datetime
now = datetime.datetime.now(); n = 0
try:
    lines = open(sys.argv[1], errors="replace").read().splitlines()[-3000:]
except OSError:
    print(0); sys.exit()
# his own lines: the account name and every character's nickname (Styled Nicknames, e.g. "Kriegsminister Hmmbert")
import json
own = {"CheesyNPC"}
try:
    for c in json.load(open("/home/lars/mindcraft-ce/npc/cheesynpc.json", encoding="utf-8")).get("characters", {}).values():
        own.add(re.sub(r"<[^>]+>", "", c.get("display", "")).strip())
except (OSError, ValueError):
    pass
for line in lines:
    m = re.match(r"\[(\d\d):(\d\d):(\d\d)\] \[Server thread/INFO\]: (\[Not Secure\] )?<([^>]+)>", line)
    if not m or m.group(5).strip() in own:
        continue
    t = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=int(m.group(3)), microsecond=0)
    if t > now:
        t -= datetime.timedelta(days=1)
    if (now - t).total_seconds() <= 300:
        n += 1
print(n)
EOF
)
  echo $((a + c))
}

start=$(date +%s)
while :; do
  g=$(gespraech)
  if [ "$g" -eq 0 ]; then
    "$(dirname "$0")/start-live.sh" && exit 0
    exit 1
  fi
  waited=$(( $(date +%s) - start ))
  if [ "$waited" -ge "$MAX" ]; then
    echo "nach ${waited} s nicht neu gestartet: Gespraech in den letzten 5 min ($g Zeilen)"
    exit 1
  fi
  echo "warte: Gespraech in den letzten 5 min ($g Zeilen)"
  sleep 15
done
