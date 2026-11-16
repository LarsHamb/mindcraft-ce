# NPC-Aufbau (Laptop)

- `ce26-bauen.sh`: baut das Image `mindcraft-ce26` (dieses Repo plus mineflayer-Fork von Misty4119 fuer 26.3). Vorher `docker build -t mindcraft-ce-test .` im Repo.
- `start26.sh`: startet `mindcraft-ce26-bot` in `karimnet` gegen echt26, mit `settings26.json` und dem Profil in `~/mindcraft-ce-lauf/profiles`. Der Key wird nur lesend eingehaengt.
- `auftrag26.sh "Text" [Absender]`: gibt einen Auftrag ueber den MindServer.
- `pruef_huette.sh ox oy oz`: prueft einen Unterschlupf serverseitig ueber RCON.
- `mindce.json`: Profil mit `thinkingLevel: low` (spart Denk-Tokens).
- `tester.cjs`: Hilfs-Bot, der Chatzeilen schreibt (MSGS="a|b|c"), etwa zum Testen von Xaero-Wegpunkten und `!schutz`.

## Schutzzonen im Chat

- Xaero-Wegpunkt teilen (Share im Wegpunkt-Menue): wird als Zone mit Radius 40 uebernommen.
- `!schutz [radius] [name]`: Zone um die eigene Position (Radius 5 bis 128, Standard 40).
- `!schutz weg`: entfernt die Zone, in der man steht (nur wer sie gesetzt hat oder `protection_admins`).
- `!schutz liste`: zeigt alle Zonen.
Keine dieser Nachrichten geht an das Modell.
