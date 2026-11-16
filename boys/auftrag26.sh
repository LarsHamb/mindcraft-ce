#!/bin/sh
# Gibt MindCE einen Auftrag ueber den MindServer: ./auftrag.sh "Hol Stein" [Absender]
FROM="${2:-HiImCheeZy}"
docker exec -e MSG="$1" -e FROM="$FROM" mindcraft-ce26-bot node -e "
const {io}=require(\"socket.io-client\");const s=io(\"http://127.0.0.1:8080\");
s.on(\"connect\",()=>{s.emit(\"send-message\",\"MindCE\",{from:process.env.FROM,message:process.env.MSG});setTimeout(()=>process.exit(0),500)});
setTimeout(()=>process.exit(1),5000);"
