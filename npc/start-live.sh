#!/bin/sh
# Startet CheesyNPC (mindcraft-ce) auf dem Live-Server (Fabric 26.3, Port 11116). NUR nach Lars Okay.
# Vorher: Karim gestoppt (sicher-stoppen.sh), Image mindcraft-ce26 aktuell (ce26-bauen.sh).
# Microsoft-Tokens: ~/karim-bot/.auth (lesen und erneuern), Key nur lesend.
L=/home/lars/mindcraft-ce-lauf
if docker ps --format "{{.Names}}" | grep -qx karim-bot; then echo "karim-bot laeuft noch, erst ~/karim-bot/sicher-stoppen.sh"; exit 1; fi
mkdir -p $L/bots-live
cp /home/lars/mindcraft-ce/npc/cheesynpc.json $L/profiles/cheesynpc.json
docker rm -f mindcraft-live-bot >/dev/null 2>&1
docker run -d --name mindcraft-live-bot --restart unless-stopped --network karimnet --user 1000:1000 \
  -v /home/lars/fabric-test/config/karim-voice.json:/secrets/kv.json:ro \
  -v /home/lars/karim-bot/.auth:/auth \
  -v $L/bots-live:/app/bots \
  -v $L/profiles:/app/lauf/profiles:ro -e HOME=/tmp -e EXIT_ON_AGENT_FAILURE=60 \
  -e SETTINGS_JSON="$(cat /home/lars/mindcraft-ce/npc/settings-live.json)" \
  mindcraft-ce26 sh -c "export GEMINI_API_KEY=\$(node -e \"console.log(JSON.parse(require(\\\"fs\\\").readFileSync(\\\"/secrets/kv.json\\\")).apiKey)\"); exec node main.js"
echo "gestartet: docker logs -f mindcraft-live-bot"
