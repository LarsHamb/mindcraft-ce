#!/usr/bin/env python3
"""Patch for mineflayer-pathfinder (index.js) in the 26.3 image, applied by ce26-bauen.sh.

When the pathfinder breaks a block on its path it sets `digging` and waits for bot.dig() to settle. If that
promise never settles (no block update arrives, e.g. sand falling into the spot), `digging` stays true and
every later goto stands still: monitorMovement returns early on each tick. Test 18.11.: 20 minutes without
moving in shallow water next to a sand bank, while a fresh bot walked out at once. Now a watchdog ends a dig
after its dig time plus 5 seconds, so the path is planned again."""
import sys

p = sys.argv[1]
s = open(p).read()
if "NPC patch: dig watchdog" in s:
    print("pathfinder dig already patched"); sys.exit()
old = """        const digBlock = () => {
          bot.dig(block, true)
            .catch(_ignoreError => {
              resetPath('dig_error')
            })
            .then(function () {
              lastNodeTime = performance.now()
              digging = false
            })
        }
"""
new = """        const digBlock = () => {
          // NPC patch: dig watchdog (a dig that never settles kept `digging` true and froze all movement)
          let settled = false
          const ms = Math.min((bot.digTime ? bot.digTime(block) : 0) || 0, 60000) + 5000
          const watchdog = setTimeout(() => {
            if (settled) return
            settled = true
            try { bot.stopDigging() } catch (_e) {}
            lastNodeTime = performance.now()
            digging = false
            resetPath('dig_timeout')
          }, ms)
          bot.dig(block, true)
            .catch(_ignoreError => {
              if (!settled) resetPath('dig_error')
            })
            .then(function () {
              clearTimeout(watchdog)
              if (settled) return
              settled = true
              lastNodeTime = performance.now()
              digging = false
            })
        }
"""
assert s.count(old) == 1, "pathfinder: digBlock not found"
open(p, "w").write(s.replace(old, new))
print("pathfinder dig patched")
