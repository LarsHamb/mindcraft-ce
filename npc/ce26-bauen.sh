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
cat > "$B/Dockerfile" <<'EOF'
FROM mindcraft-ce-test
RUN rm -rf /app/node_modules/mineflayer /app/node_modules/minecraft-data /app/node_modules/minecraft-data-base
COPY nm/ /app/node_modules/
EOF
cd "$B" && docker build -q -t mindcraft-ce26 . && echo "mindcraft-ce26 gebaut"
