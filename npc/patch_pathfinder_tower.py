#!/usr/bin/env python3
"""Patch for mineflayer-pathfinder (index.js) in the 26.3 image, applied by ce26-bauen.sh.

Towering (jump and place a block below) placed the block as soon as the feet were barely above the floor
of the target block, i.e. still inside it. 26.3 sees the position one tick later, refuses the block as
colliding with the player, and the bot jumped 30 to 100 times without building (Boys test 17.11.: 99 refusals
in 60 s). Now it places only when the feet are clearly above the target block (jump peak is ~1.25).
17.11. evening: 1.1 above (2.1) was too strict: with the equip delay the short window near the peak was often
missed, the bot fell back onto air and needed 5 minutes for 12 blocks (Boys: 98 "standing on air"). A test bot
on 26.3 got every block accepted from 0.8 above (the bot is still rising when the packet arrives), so 0.85."""
import sys

p = sys.argv[1]
s = open(p).read()
if "Boys patch: place when the feet are above" in s:
    print("pathfinder already patched"); sys.exit()
old = "        canPlace = placingBlock.y + 1 < bot.entity.position.y\n"
new = ("        // Boys patch: place when the feet are above the target block (26.3 refuses a block inside the player)\n"
       "        canPlace = placingBlock.y + 1.85 < bot.entity.position.y\n")
assert s.count(old) == 1, "pathfinder: tower check not found"
open(p, "w").write(s.replace(old, new))
print("pathfinder patched")
