#!/bin/sh
# Baut das Image mindcraft-ce26: mindcraft-ce (agent-system) mit der 26.3-Kette von Misty4119.
# Voraussetzung: Image mindcraft-ce-test und ~/jarvis-training/fork (siehe lager26-bauen.sh).
set -e
B=$HOME/mindcraft-ce26
F=$HOME/jarvis-training/fork
rm -rf "$B"; mkdir -p "$B/nm"
cp -rL "$F/mineflayer" "$B/nm/mineflayer"; rm -rf "$B/nm/mineflayer/.git"
cp -rL "$F/mineflayer/vendor/minecraft-data" "$B/nm/minecraft-data"
cp -rL "$F/mineflayer/node_modules/minecraft-data-base" "$B/nm/minecraft-data-base"
cd "$B/nm"
# CE-Patches auf den Fork
patch -s -p3 -d mineflayer < "$HOME/mindcraft-ce/patches/mineflayer+4.39.0.patch"
patch -s -p3 -d mineflayer/node_modules/prismarine-block < "$HOME/mindcraft-ce/patches/prismarine-block+1.23.0.patch"
python3 - mineflayer/node_modules/prismarine-item/index.js <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
old = """      if (this.componentMap?.has(componentType)) {
        return this.componentMap.get(componentType).data
      }"""
new = """      if (this.componentMap?.has(componentType)) {
        const data = this.componentMap.get(componentType).data
        const enchantments = Array.isArray(data) ? data : data.enchantments || []
        return enchantments.map(ench => ({
          lvl: ench.level ?? ench.lvl,
          name: typeof ench.name === 'string' ? ench.name.replace('minecraft:', '')
            : typeof ench.id === 'string' ? ench.id.replace('minecraft:', '')
              : registry.enchantments[ench.id]?.name || null
        }))
      }"""
assert s.count(old) == 1, "prismarine-item: Stelle nicht gefunden"
open(p, "w").write(s.replace(old, new))
EOF
# Chat-Pruefsumme (1.21.5+): Reihenfolge ab dem aeltesten Eintrag wie vanilla (sonst Kick nach 20 Chatnachrichten)
cp "$HOME/mindcraft-ce/npc/checksums.cjs" mineflayer/node_modules/minecraft-protocol/src/datatypes/checksums.js
# Platzieren: nicht 5 s auf ein verpasstes Block-Update warten
python3 "$HOME/mindcraft-ce/npc/patch_place_block.py" mineflayer/lib/plugins/place_block.js
# Tod: keine Bewegungspakete, solange er tot ist (26.3 kickt sonst)
python3 "$HOME/mindcraft-ce/npc/patch_physics_dead.py" mineflayer/lib/plugins/physics.js
# Angriff: erst Angriff, dann Armschwung (sonst nur ~20 % Schlagkraft, Arena 18.11.)
python3 "$HOME/mindcraft-ce/npc/patch_attack_order.py" mineflayer/lib/plugins/entities.js
# Hochbauen: Block erst setzen, wenn die Fuesse ueber dem Zielblock sind (26.3 lehnt sonst ab)
mkdir -p mineflayer-pathfinder
docker run --rm mindcraft-ce-test cat /app/node_modules/mineflayer-pathfinder/index.js > mineflayer-pathfinder/index.js
python3 "$HOME/mindcraft-ce/npc/patch_pathfinder_tower.py" mineflayer-pathfinder/index.js
cat > "$B/Dockerfile" <<'EOF'
FROM mindcraft-ce-test
RUN rm -rf /app/node_modules/mineflayer /app/node_modules/minecraft-data /app/node_modules/minecraft-data-base
COPY nm/ /app/node_modules/
EOF
cd "$B" && docker build -q -t mindcraft-ce26 . && echo "mindcraft-ce26 gebaut"
# alte, namenlose Zwischenstaende wegraeumen (17.11.: 71 davon fuellten die Platte mit 57 GB)
docker image prune -f >/dev/null 2>&1 || true
