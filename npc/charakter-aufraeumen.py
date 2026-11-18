#!/usr/bin/env python3
"""Lars, 18.11.: the war minister is replaced by the villager Hmmbert ("zu militaerisch").
Removes the old minister self-descriptions from a bot folder, keeps trust, tips and everything else:
  - memory-by-character.json: the 'minister' summary
  - memory.json: summary lines and player notes with minister/military words, an old saved directive
  - players.json: player notes with military words (trust and the other notes stay)
  - character.json: an unknown id (minister) becomes the profile default, with its display (nick-watch sets the nick)
Run with the bot stopped (live: docker stop mindcraft-live-bot; test: docker stop mindcraft-ce26-bot).
Usage: python3 charakter-aufraeumen.py <bot-folder> <profile.json>
"""
import json, os, re, shutil, sys, time

MILITARY = re.compile(r'kriegsminister|minister|oberbefehl|truppe|soldat|rekrut|operation |operation\b|morgenappell|st(ue|ü)tzpunkt|'
                      r'letalit|kampfbereit|hauptquartier|nachschublager|gefallen im dienst|drill|appell|beutegut|taktisch', re.I)

def main(b, profile_path):
    profile = json.load(open(profile_path, encoding='utf-8'))
    chars = profile.get('characters', {})
    default = profile.get('character_default') or next(iter(chars), None)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    keep = os.path.join(b, f'vor-charakterwechsel-{stamp}')
    os.makedirs(keep, exist_ok=True)
    for f in ('memory.json', 'memory-by-character.json', 'players.json', 'character.json'):
        if os.path.exists(os.path.join(b, f)): shutil.copy2(os.path.join(b, f), keep)
    print('gesichert:', keep)

    p = os.path.join(b, 'memory-by-character.json')
    if os.path.exists(p):
        d = json.load(open(p, encoding='utf-8'))
        gone = [k for k in d if k not in chars]
        for k in gone: d.pop(k)
        json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('memory-by-character.json: entfernt', gone)

    p = os.path.join(b, 'memory.json')
    if os.path.exists(p):
        m = json.load(open(p, encoding='utf-8'))
        lines = str(m.get('memory', '')).splitlines()
        kept = [l for l in lines if not MILITARY.search(l)]
        m['memory'] = '\n'.join(kept)
        m['turns'] = [t for t in m.get('turns', []) if not MILITARY.search(str(t.get('content', '')))]
        a = m.get('agent_system') or {}
        notes = a.get('notes') or {}
        for who in list(notes):
            v = notes[who]
            if isinstance(v, list): notes[who] = [x for x in v if not MILITARY.search(json.dumps(x, ensure_ascii=False))]
            elif isinstance(v, str) and MILITARY.search(v): notes[who] = ''
        for k in ('directive', 'lastDirective'):
            if MILITARY.search(json.dumps(a.get(k), ensure_ascii=False)): a.pop(k, None)
        json.dump(m, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'memory.json: {len(lines) - len(kept)} Zeilen der Zusammenfassung entfernt')

    p = os.path.join(b, 'players.json')
    if os.path.exists(p):
        d = json.load(open(p, encoding='utf-8'))
        n = 0
        for who, v in d.items():
            if isinstance(v, dict) and isinstance(v.get('notes'), list):
                before = len(v['notes'])
                v['notes'] = [x for x in v['notes'] if not MILITARY.search(str(x.get('text', '')))]
                n += before - len(v['notes'])
        json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'players.json: {n} Notizen entfernt, Vertrauen bleibt')

    p = os.path.join(b, 'character.json')
    s = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    if s.get('id') not in chars and default:
        s = {'id': default, 'display': chars[default].get('display', default), 'at': int(time.time() * 1000),
             'day': time.strftime('%Y-%m-%d'), 'by': 'charakterwechsel'}
        json.dump(s, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
        print('character.json: jetzt', default)

if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
