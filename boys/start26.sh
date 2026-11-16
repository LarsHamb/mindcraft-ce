#!/bin/sh
docker rm -f mindcraft-ce26-bot >/dev/null 2>&1
docker run -d --name mindcraft-ce26-bot --network karimnet --user 1000:1000 \
  -v /home/lars/fabric-test/config/karim-voice.json:/secrets/kv.json:ro \
  -v /home/lars/mindcraft-ce-lauf/bots26:/app/bots \
  -v /home/lars/mindcraft-ce-lauf/profiles:/app/lauf/profiles:ro -e HOME=/tmp \
  -e SETTINGS_JSON="$(cat /home/lars/mindcraft-ce-lauf/settings26.json)" \
  mindcraft-ce26 sh -c "export GEMINI_API_KEY=\$(node -e \"console.log(JSON.parse(require(\\\"fs\\\").readFileSync(\\\"/secrets/kv.json\\\")).apiKey)\"); exec node main.js"
