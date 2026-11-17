#!/usr/bin/env python3
"""Abendbericht fuer CheesyNPC (Lars, 17.11.): haengt er, schafft er etwas?

Liest bots-live/CheesyNPC/journal.jsonl (Werkzeuge, Auftraege, Haenger, Reflexe, Tode) und usage-log.jsonl.
Zahlen fuer Lars:
  - Spielzeit: Minuten, in denen ein echter Spieler online war (aus dem Server-Log)
  - Minuten ohne Fortschritt pro Stunde Spielzeit: Luecken > 3 min zwischen erfolgreichen Werkzeug-Ergebnissen
  - Auftraege von Spielern: angenommen / erledigt / blockiert
  - eigene erledigte Ziele, Tode mit Ursache, Hanger-Gruende, Tokens
Aufruf: python3 abendbericht.py [Stunden zurueck, Standard 24]
"""
import json, os, re, sys, time, datetime, collections

HOURS = float(sys.argv[1]) if len(sys.argv) > 1 else 24
D = os.path.expanduser(os.environ.get("BOTDIR", "~/mindcraft-ce-lauf/bots-live/CheesyNPC"))
SERVERLOG = os.path.expanduser(os.environ.get("SERVERLOG", "~/minecraft/logs/latest.log"))
ASSUME_PLAY = os.environ.get("ASSUME_PLAY") == "1"  # test runs: count the whole period as play time
BOTS = {"CheesyNPC"}
now = time.time() * 1000
since = now - HOURS * 3600000

def lines(path):
    try:
        with open(path) as f:
            for l in f:
                try: yield json.loads(l)
                except ValueError: pass
    except OSError:
        return

J = [e for e in lines(f"{D}/journal.jsonl") if e.get("at", 0) >= since]
U = [u for u in lines(f"{D}/usage-log.jsonl") if u.get("at", 0) >= since]

# play time from the server log (today's log only; times are server-local)
online, play = {}, []
today = datetime.date.today()
try:
    for l in open(SERVERLOG, errors="replace"):
        m = re.match(r"\[(\d\d):(\d\d):(\d\d)\].*System chat: (\S+) (joined|left) the game", l)
        if not m or m.group(4) in BOTS: continue
        t = datetime.datetime.combine(today, datetime.time(int(m.group(1)), int(m.group(2)), int(m.group(3)))).timestamp() * 1000
        if t > now: t -= 86400000  # log from before midnight
        if m.group(5) == "joined": online[m.group(4)] = t
        elif m.group(4) in online: play.append((online.pop(m.group(4)), t))
except OSError:
    pass
for start in online.values(): play.append((start, now))
if ASSUME_PLAY: play = [(since, now)]
# merge intervals of several players
play.sort(); merged = []
for a, b in play:
    if merged and a <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], b)
    else: merged.append([a, b])
play_ms = sum(max(0, min(b, now) - max(a, since)) for a, b in merged)
in_play = lambda t: any(a <= t <= b for a, b in merged)

ok = sorted(e["at"] for e in J if e["type"] == "tool" and e.get("status") in ("ok", "partial"))
stall_ms, stalls = 0, []
for a, b in merged:
    pts = [a] + [t for t in ok if a <= t <= b] + [b]
    for x, y in zip(pts, pts[1:]):
        if y - x > 180000:
            stall_ms += y - x - 180000
            stalls.append((x, (y - x) / 60000))

tasks = [e for e in J if e["type"] == "task_end"]
is_player = lambda e: e.get("forPlayer") if "forPlayer" in e else e.get("source") not in ("system", "ADMIN", None, "CheesyNPC")
# a request split into several tasks counts once: only its last step (or a blocked step)
player_tasks = [e for e in tasks if is_player(e) and (e.get("lastStep", True) or e.get("outcome") in ("blocked", "error"))]
own = [e for e in tasks if not is_player(e) and e.get("outcome") == "done"]
deaths = [e for e in J if e["type"] == "death"]
stuck = [e for e in J if e["type"] == "stuck"]
blocked = collections.Counter(re.sub(r"\d+", "#", e.get("reason", ""))[:80] for e in tasks if e.get("outcome") in ("blocked", "error"))
failed_tools = collections.Counter(f"{e['tool']}: {re.sub(r'-?[0-9]+', '#', e.get('text', ''))[:70]}" for e in J if e["type"] == "tool" and e.get("status") in ("failed", "blocked"))
tok_in = sum(u["input"] for u in U); tok_out = sum(u["output"] + u.get("thoughts", 0) for u in U)
tok_cached = sum(u.get("cached") or 0 for u in U)
# angenommene Flash-Preise in $/Mio. (Eingabe 0.50, aus dem Cache 0.05, Ausgabe 3.00), grob in Euro
euro = ((tok_in - tok_cached) * 0.50 + tok_cached * 0.05 + tok_out * 3.0) / 1e6 * 0.92

h = play_ms / 3600000
print(f"# Abendbericht CheesyNPC ({HOURS:.0f} h zurueck, Stand {time.strftime('%d.%m. %H:%M')})")
print(f"- Spielzeit mit Spielern: {play_ms / 60000:.0f} min")
print(f"- **Minuten ohne Fortschritt pro Stunde: {stall_ms / 60000 / h:.1f}**" if h > 0.05 else "- Minuten ohne Fortschritt pro Stunde: (keine Spielzeit)")
print(f"- **Auftraege von Spielern: {len(player_tasks)} beendet, davon {sum(e.get('outcome') == 'done' for e in player_tasks)} erledigt**, "
      f"{sum(e.get('outcome') in ('blocked', 'error') for e in player_tasks)} blockiert")
print(f"- eigene Ziele erledigt: {len(own)}" + (f" (zuletzt: {own[-1].get('objective', '')[:80]})" if own else ""))
print(f"- Tode: {len(deaths)}" + "".join(f"\n  - {time.strftime('%H:%M', time.localtime(e['at'] / 1000))} {e.get('message', '')[:80]} bei {e.get('pos')}" for e in deaths))
print(f"- 'Ich haenge fest': {len(stuck)}")
print(f"- Tokens: {tok_in / 1e6:.2f} Mio. Eingabe (davon {tok_cached / max(tok_in, 1):.0%} aus dem Cache), {tok_out / 1e3:.0f} Tsd. Ausgabe, ca. {euro:.2f} EUR (geschaetzt)")
if stalls:
    print("- laengste Stillstaende: " + ", ".join(f"{time.strftime('%H:%M', time.localtime(t / 1000))} {m:.0f} min" for t, m in sorted(stalls, key=lambda s: -s[1])[:5]))
if blocked:
    print("- haeufigste Blockaden:\n" + "\n".join(f"  - {n}x {r}" for r, n in blocked.most_common(5)))
if failed_tools:
    print("- haeufigste Fehlschlaege:\n" + "\n".join(f"  - {n}x {r}" for r, n in failed_tools.most_common(5)))
