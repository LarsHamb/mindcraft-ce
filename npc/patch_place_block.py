#!/usr/bin/env python3
"""Patch for the 26.3 mineflayer fork (lib/plugins/place_block.js), applied by ce26-bauen.sh.

Placing waited for the server's blockUpdate:<dest>, but the listener is attached only after _genericPlace
returns; on a fast server the update often arrives earlier, so every block waited the full 5 s timeout
(buildShelter: ~6 s per block). Now a poll of the world runs alongside and settles as soon as the block at
the destination has changed."""
import sys

p = sys.argv[1]
s = open(p).read()
if "settle as soon as the world shows it" in s:
    print("place_block.js already patched"); sys.exit()
old = "    const [, newBlock] = await onceWithCleanup(bot, `blockUpdate:${dest}`, {"
new = """    // Boys patch: the update may have arrived before the listener above; settle as soon as the world shows it
    let stopPoll = false
    const poll = (async () => {
      for (let i = 0; i < 50 && !stopPoll; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const now = bot.blockAt(dest)
        if (now && oldBlock && now.type !== oldBlock.type) return [oldBlock, now]
      }
      return new Promise(() => {})
    })()
    const waitUpdate = onceWithCleanup(bot, `blockUpdate:${dest}`, {"""
assert s.count(old) == 1, "place_block.js: wait not found"
s = s.replace(old, new)
old2 = """      if (inFlight.get(key) === 1) inFlight.delete(key)
      else inFlight.set(key, inFlight.get(key) - 1)
    })
"""
new2 = """      if (inFlight.get(key) === 1) inFlight.delete(key)
      else inFlight.set(key, inFlight.get(key) - 1)
    })
    const [, newBlock] = await Promise.race([waitUpdate, poll]).finally(() => { stopPoll = true })
    waitUpdate.catch(() => {})
"""
assert s.count(old2) == 1, "place_block.js: cleanup not found"
s = s.replace(old2, new2)
open(p, "w").write(s)
print("place_block.js patched")
