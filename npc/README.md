# NPC-Aufbau (Laptop)

- `ce26-bauen.sh`: baut das Image `mindcraft-ce26` (dieses Repo plus mineflayer-Fork von Misty4119 fuer 26.3). Vorher `docker build -t mindcraft-ce-test .` im Repo.
- `start26.sh`: startet `mindcraft-ce26-bot` in `karimnet` gegen echt26, mit `settings26.json` und dem Profil in `~/mindcraft-ce-lauf/profiles`. Der Key wird nur lesend eingehaengt.
- `auftrag26.sh "Text" [Absender]`: gibt einen Auftrag ueber den MindServer.
- `pruef_huette.sh ox oy oz`: prueft einen Unterschlupf serverseitig ueber RCON.
- `mindce.json`: Profil mit `thinkingLevel: low` (spart Denk-Tokens).
- `tester.cjs`: Hilfs-Bot, der Chatzeilen schreibt (MSGS="a|b|c"), etwa zum Testen von Xaero-Wegpunkten und `!schutz`.

## Schutzzonen im Chat

- Xaero-Wegpunkt teilen (Share im Wegpunkt-Menue): Name mit Base, Basis, Haus, House, Home, Zuhause oder Heim wird Zone mit Radius 40, andere Wegpunkte nicht.
- `!schutz [radius] [name]`: Zone um die eigene Position (Radius 5 bis 128, Standard 40).
- `!schutz weg`: entfernt die Zone, in der man steht (nur wer sie gesetzt hat oder `protection_admins`).
- `!schutz liste`: zeigt alle Zonen.
Keine dieser Nachrichten geht an das Modell.
- Betten: Ein Bett, das nicht vom Bot stammt, bekommt automatisch eine Zone mit Radius 40. Ausnahme Dorf: Glocke, Dorfbewohner oder viele Trampelpfade in der Naehe. Wegpunkte mit Bett, Betten oder Bed im Namen zaehlen wie Base.
- `sicher-neustarten-live.sh [s]`: Neustart des Live-Bots nur ohne Chat in den letzten 5 min.
- Wiederherstellen (Lars, 17.11.): In Schutzzonen darf er natuerliche Bloecke abbauen, um durchzukommen; sie kommen auf die Merkliste (bots/<name>/restore.json) und werden wieder eingesetzt. Gebaute Bloecke bleiben tabu, Ernten in Zonen ebenfalls. Loecher in der obersten Schicht schliesst er wieder (Erde statt Bruchstein), nach dem Faellen pflanzt er einen Setzling. Ausgenommen: digStairs-Eingaenge, Unterschlupf-Innenraum, bewusst gesammeltes Material. Zurueckgesetzt wird zwischen zwei Werkzeug-Aufrufen (bis 10 Bloecke Abstand) und im Leerlauf.
- Jedes Bett ist eine Schutzzone (Radius 40), auch in Doerfern.
