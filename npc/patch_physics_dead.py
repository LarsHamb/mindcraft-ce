#!/usr/bin/env python3
"""Patch for the 26.3 mineflayer fork (lib/plugins/physics.js), applied by ce26-bauen.sh.

mineflayer keeps sending position packets for 20 ticks after death. A 26.3 server kicks a dead player that
moves ("Invalid move player packet received"), so every death became a disconnect, a new login and a lost
death recovery (Boys test 17.11.). A dead bot now sends no movement until it is alive again."""
import sys

p = sys.argv[1]
s = open(p).read()
if "Boys patch: a dead player sends no movement" in s:
    print("physics.js already patched"); sys.exit()
old = "    // Only send updates for 20 ticks after death\n    if (isEntityRemoved()) return\n"
new = old + "    // Boys patch: a dead player sends no movement (26.3 kicks it)\n    if (bot.isAlive === false) return\n"
assert s.count(old) == 1, "physics.js: death check not found"
s = s.replace(old, new)
# The delayed position_look 1.5 s after respawn is a second movement in one tick for 26.3 (its teleport
# confirmation already carries the position, as the normal teleport path below assumes): skip it there.
old2 = "    if (respawnTimer > 0 && Date.now() - respawnTimer < 2000) {"
new2 = "    if (bot.version !== '26.3' && respawnTimer > 0 && Date.now() - respawnTimer < 2000) { // Boys patch"
assert s.count(old2) == 1, "physics.js: respawn delay not found"
open(p, "w").write(s.replace(old2, new2))
print("physics.js patched")
