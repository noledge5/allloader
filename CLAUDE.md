<!-- hierarchie:anfang -->
## hierarchie

- Tests (UTS): `node .hierarchie/werkzeuge/uts.mjs --kurz` (grün = eine Zeile); `npm test` nur, wenn es in package.json darauf zeigt.
  Ist das Ergebnis aktuell? `node .hierarchie/werkzeuge/uts.mjs --status`. Prüfungen nur über die UTS.
- Neue Sitzung: zuerst `node .hierarchie/werkzeuge/hierarchie.mjs uebergabe` (Kurzstand: Branch, Commits, offene Pläne).
- Projektstand (automatisch geladen): @STAND.md
- Pflege: nach jedem abgeschlossenen Arbeitspaket und vor Sitzungsende STAND.md mit kleinen Edits nachführen (Datum, Aktueller Stand, Offene Punkte, Nächste Schritte), dann `node .hierarchie/werkzeuge/hierarchie.mjs stand pruefen` und `node .hierarchie/werkzeuge/hierarchie.mjs stand html`; steht unter „HTML-Seite:“ ein claude.ai-Link und ist das Artifact-Werkzeug da, `stand.seite.html` an genau diesen Link neu veröffentlichen, ohne Link beim ersten Mal privat veröffentlichen und den Link in STAND.md eintragen.
- Werkzeuge (`node .hierarchie/werkzeuge/hierarchie.mjs <befehl>`): `uebergabe` Kurzstand · `plan` Pläne · `stand` Projektstand ·
  `ponytail-debt` offene Abkürzungen · `geheimnis-scan` vor dem Commit · `doku-verweise` tote Verweise · `aenderungsliste` ·
  `branches` · `wiederholungen` · `nutzung` · `projekte` andere Projekte. Werkzeug vor Prompt: vor dem Bau von etwas Neuem `node .hierarchie/werkzeuge/hierarchie.mjs register`.
- Arbeitsweise und Stufen 1–3: ARBEITSWEISE.md (nutzerweit). Stufe 3: Skill `projektleitung`. Modellwahl nach Skill `intelligent-routing`:
  Sonnet ist Standard für Worker, Opus nur mit benanntem Grund, Fable nie automatisch.
- Wiederholung erkannt: Skill `werkzeugbau`.
- Neues Wissen (bewährte Lösungen, Fallstricke) gehört in die Projekt-Doku, dort wo das Projekt sie führt, nicht in Chatverläufe.
- Alle Befehle: `node .hierarchie/werkzeuge/hierarchie.mjs hilfe`
<!-- hierarchie:ende -->
