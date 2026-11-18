#!/usr/bin/env python3
"""Patch for the mineflayer fork (lib/plugins/entities.js) in the 26.3 image, applied by ce26-bauen.sh.

The fork sent the arm swing BEFORE the attack packet on 26.1+. The server resets the attack strength on the
swing, so every hit arrived at ~20 % strength: an iron sword needed 19 hits for a zombie instead of 5, and the
bot lost fights in full iron armor (arena test 18.11.). The vanilla client attacks first, then swings."""
import sys

p = sys.argv[1]
s = open(p).read()
if "Boys patch: attack before swing" in s:
    print("attack order already patched"); sys.exit()
old = ("      if (swing) swingArm()\n"
       "      bot._client.write('attack', { entityId: target.id })\n")
new = ("      // Boys patch: attack before swing (the swing resets the attack strength on the server)\n"
       "      bot._client.write('attack', { entityId: target.id })\n"
       "      if (swing) swingArm()\n")
assert s.count(old) == 1, "entities.js: 26.1 attack block not found"
open(p, "w").write(s.replace(old, new))
print("attack order patched")
