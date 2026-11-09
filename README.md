# READY OR NOT

Ein 3D-Ego-Shooter im Browser (Three.js + WebGL2): **Team-Deathmatch 4 gegen 4 in einem Schützengraben-Gelände** –
NATO (grüne Tarnung, grüner Helm mit US-Flagge) gegen RUS (dunkelrote Tarnung, matt-schwarzer Helm mit russischer Flagge).
Das erste Team mit **100 Kills** gewinnt.

## Starten

```bash
npm install
npm run dev        # http://localhost:5173
# oder
npm run build && npm run preview
```

Beim ersten Start im Menü auf **Spielen → Team-Deathmatch** klicken (die Maus wird eingefangen, Audio startet).
Qualität im Menü: *Auto* (dynamische Auflösung), Hoch, Mittel, Niedrig. Die URL-Parameter `?q=low|medium|high|auto` gehen ebenfalls.

## Steuerung

| Taste | Aktion |
|---|---|
| WASD | Bewegen |
| Shift | Rennen (**6 s Ausdauer**, danach muss sie komplett nachladen) |
| Leertaste | Springen (aus Gräben kann man hinausklettern oder die Rampen/Enden nutzen) |
| C / Strg | Ducken |
| Maus / RMT | Zielen · Schießen · Visier (mit Messer: RMT = Messer werfen) |
| R | Nachladen (manchmal klappt das Magazin nicht beim ersten Versuch) |
| 1 / 2 / 3 · Mausrad | Hauptwaffe · Pistole · Messer |
| G | Granate (1 pro Leben) |
| E | Aufheben / Aufsatz montieren (Waffen, Munition, Schalldämpfer, langer Lauf, Messer) |
| L | Waffenlampe umschalten (geht nachts automatisch an) |
| Esc | Pause |

## Was drin ist

* **Waffen**: Pistole (8), Maschinengewehr (25–30), Schrotflinte (6, Patrone für Patrone), Raketenwerfer (selten). Beim Tod wird die Ausrüstung neu ausgewürfelt (Pistole + MG *oder* Schrotflinte). Jeder hat ein wurf- und wieder aufhebbares Messer.
* **Magazine mit echten Patronen**: die Hülsen sind im offenen Magazin sichtbar und werden beim Schießen weniger; ausgeworfene Hülsen, lose Patronen und Magazine liegen als Physik-Objekte am Boden und reagieren auf Schritte.
* **Rückstoß, Hitze, Überhitzen**: lange Feuerstöße heizen den Lauf auf (er glüht); manchmal überhitzt die Waffe, die Haltehand wird weggerissen, geschüttelt und wieder angelegt.
* **Nachladen mit Varianten**: normal, Magazin verfehlt den Schacht beim ersten Versuch, neues Magazin rutscht aus der Hand; jeder NPC hat eigene Nachladegeschwindigkeit und Patzer-Wahrscheinlichkeit.
* **Treffer**: Kopfschuss tötet sofort, Körper 2–3 Treffer, Beinschuss lässt ins Stolpern geraten. Kein Friendly Fire.
* **Gegner/NPCs**: Pfadfindung (A*) durch das Grabensystem, Sicht/Gehör, Teamunterstützung im 5-m-Radius, Pistole/Messer nur bei völlig leerer Munition, **je eine Granate** die selten und nur sinnvoll geworfen wird (z. B. Ziel im Graben/liegt fest). Unterschiedliche Größe (1,70–1,92 m), Hautfarbe, Augenfarbe, Haare (jede Strähne simuliert), Geschlecht (Männer in der Überzahl), Ausrüstung (leicht/mittel/schwer, Brille/Sturmhaube).
* **Gelände**: 300×300 m, Schützengrabensystem mit Zickzack, Verbindungsgräben, Spähgräben und Rampen, Sandsäcke, Holzverschalung, Stacheldraht, Panzersperren, Wracks, Krater, lose Steine, windbewegtes Gras, Bäume mit Einschusslöchern und fallendem Laub (sie stürzen bei Granate/Rakete, Radius 4 m), **zwei unterschiedliche Lost-Place-Gebäude** mit Graffiti und zersplitterndem Glas.
* **Grenze**: rote **WARNUNG11**-Schilder, dahinter Minenfeld – wer hineinläuft, stirbt und spawnt neu.
* **Wetter & Tageszeit**: stufenloser Übergang Morgen → Tag → Abend → Nacht, ziehende Wolken (abends fast weg), Regen, Sonne/Mond, Waffenlampen nachts, dynamische Schatten, Himmels-Spiegelungen.
* **Sound (komplett prozedural)**: Schüsse passen sich der Umgebung an (offenes Feld, Graben, Gebäude, Wald, Regen, Nacht); Schritte nur bis 2 m hörbar (bis 6 m kaum), Wind rauscht beim Drehen des Kopfes; Granaten, Glas, Bäume, Überflug von Kugeln …
* **HUD**: Minimap (Verbündete blau, Gegner rot), Verbündeten-Marker, Killfeed, Hitmarker, Schadensrichtung, Countdown 3-2-1, Respawn bei den eigenen Leuten oder an leeren Orten.

## Technik / Performance

Render-Pipeline mit **dynamischer Auflösungsskalierung + kontrastadaptivem Schärfen (CAS)** – ein browserfähiger Ersatz für DLSS/FSR (echtes DLSS ist im Browser nicht verfügbar). Instancing für Bäume/Gras/Gräben, zusammengeführte Meshes, Distanz-Culling für Gras.

Alles (Texturen, Modelle, Sounds) wird zur Laufzeit prozedural erzeugt – es gibt keine externen Assets.
