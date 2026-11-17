#!/bin/sh
# Weltbezogene Daten des Live-Bots (CheesyNPC) beim Weltwechsel umschalten. Startet NICHTS.
#   ./weltwechsel-live.sh neu            alte Daten nach bots-live/alte-welt-<zeit> sichern und leeren
#   ./weltwechsel-live.sh alt <ordner>   Daten aus einem alte-welt-Ordner zurueckholen (alte Welt wieder da)
# Weltbezogen sind: Schutzzonen (built/player), eigene Bloecke, Merkliste, Gedaechtnis (Koordinaten, Ziele), Dorf-Zuhause, getroffene Spieler.
# Vorher den Bot stoppen: docker stop mindcraft-live-bot
D=/home/lars/mindcraft-ce-lauf/bots-live
B=$D/CheesyNPC
FILES="built_areas.json own_blocks.json restore.json player_areas.json memory.json home.json met_players.json death_recovery.json"

if docker ps --format '{{.Names}}' | grep -qx mindcraft-live-bot; then
  echo "mindcraft-live-bot laeuft noch, erst stoppen: docker stop mindcraft-live-bot"; exit 1
fi

case "$1" in
  neu)
    Z=$D/alte-welt-$(date +%Y%m%d-%H%M)
    mkdir -p "$Z"
    for f in $FILES; do [ -f "$B/$f" ] && cp -a "$B/$f" "$Z/"; done
    for f in built_areas.json restore.json player_areas.json; do echo "[]" > "$B/$f"; done
    echo "{}" > "$B/own_blocks.json"
    rm -f "$B/memory.json" "$B/home.json" "$B/met_players.json" "$B/death_recovery.json"
    echo "gesichert in $Z, Daten geleert"
    ;;
  alt)
    [ -d "$2" ] || { echo "Ordner fehlt: $2"; exit 1; }
    for f in $FILES; do [ -f "$2/$f" ] && cp -a "$2/$f" "$B/"; done
    echo "Daten aus $2 zurueckgeholt"
    ;;
  *)
    echo "Aufruf: $0 neu | alt <ordner>"; exit 1
    ;;
esac
