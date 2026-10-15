---
name: projektleitung
description: Leite mehrstufige oder größere Aufgaben als Projektleitung - planen, in Arbeitspakete zerlegen, an Worker delegieren, Ergebnisse prüfen und bewerten, neu planen. Nutze diesen Skill, sobald eine Aufgabe in mehrere Arbeitspakete mit eigener Abnahme zerfällt, ein Plan nötig ist oder du Arbeit an Subagents (routine-worker, implementation-worker, recherche-worker, complex-worker, verification-worker) abgeben willst. Gilt für Stufe 3 laut ARBEITSWEISE.md; nicht für Einzelschritte und Stufe 1–2, die sich direkt erledigen lassen – auch nicht, wenn sie mehrere Dateien berühren. Enthält die Leitungsschleife, die Auftragsschablone, die Grenzen gegen Kostenschleifen, Hinweise für das Pro-Abo und die Prüfregel (UTS als einzige Prüfinstanz).
---

# Projektleitung

Du bist die Leitung: planen, zerlegen, delegieren, Ergebnisse bewerten, neu planen. Routinearbeit in Plänen gibst du ab; Kleines erledigst du selbst, wenn ein Worker mehr Kontext kostet als er spart. Empfohlenes Sitzungsmodell der Leitung ist `opusplan` (Opus im Plan-Modus, Sonnet beim Umsetzen), durchgehend `opus` nur für Architektur-Sitzungen. Die Modellwahl je Paket folgt dem Skill `intelligent-routing`.

## Plan und Status

Der Plan liegt im Projekt unter `plaene/<name>/`: `plan.md` enthält den Plan (Ziel, Arbeitspakete, Abhängigkeiten, Modellwahl, Abnahme, Risiken), `status.json` hält fest, wo die Arbeit steht, unter anderem je Paket Stufe und Begründung (bei Opus der benannte Grund), Status, Abhängigkeiten sowie `delegationen` und `delegationen_max` (Standard 12). Gepflegt wird er mit dem Befehl `plan` (Skill `plan`): `node .hierarchie/werkzeuge/hierarchie.mjs plan …`, im hierarchie-Repo selbst `node werkzeuge/hierarchie.mjs plan …`. Den Status änderst du nur mit `plan setze`, jede Delegation zählst du mit `plan delegation`. Beides gehört zur Sitzung dazu: Wer die Leitung übernimmt (etwa nach einem Wechsel des Sitzungsmodells), beginnt mit `plan zeige` und macht aus `plan.md` und `status.json` weiter. Eine neue Sitzung beginnt mit `node .hierarchie/werkzeuge/hierarchie.mjs uebergabe` (Branch, letzte Commits, uncommittete Dateien, UTS-Stand, offene Pläne und Kandidaten in höchstens 30 Zeilen).

## Leitungsschleife

1. **Plan anlegen oder aktualisieren** (Skill `plan`: `plan neu`, `plan paket`): Arbeitspakete mit Ergebnis, Abnahme (als UTS-Test formulierbar), Abhängigkeiten, Stufe und Begründung.
2. **Genau ein** nächstes Paket wählen, dessen Abhängigkeiten erfüllt sind (`plan naechstes`). Ausnahme: rein lesende, voneinander unabhängige Recherchen dürfen parallel laufen.
3. **Eskalationsfolge anwenden** (Skill `intelligent-routing`) und den Worker beauftragen (vorher `plan delegation`). Der Auftrag enthält immer: Ziel, betroffene Dateien, verbindliche Spezifikation und Regeln, Abnahme, was **nicht** geändert werden darf, Berichtsformat.
4. **Ergebnis prüfen lassen:** `verification-worker` bei Änderungen an Produktivcode, bei Sicherheitsthemen oder wenn der Worker selbst Unsicherheit meldet; vor dem Push nicht trivialer Änderungen macht er auch die Diffprüfung (unnötigen Code prüft der Skill `ponytail-review`). Bei trivialen Paketen genügt der UTS-Lauf der Leitung (`uts --kurz`, `uts --status`).
5. **Bewerten:** Abnahme erfüllt **und** UTS-Vollauf grün ergibt „fertig“: Status setzen, gegebenenfalls committen. Sonst gezielte Nachbesserung an **denselben** Worker (der Kontext bleibt erhalten).
6. **Nach jedem Paket fragen: „Wiederholt sich das?“** Ja oder vermutet: als Kandidat eintragen (Skill `werkzeugbau`). Vermutetes als vermutet kennzeichnen.
7. **Neu planen**, nächstes Paket. Nach jedem abgeschlossenen Paket außerdem den Projektstand nachführen (Abschnitt „Projektstand“).

## Projektstand (STAND.md)

`STAND.md` in der Projektwurzel ist das Gedächtnis des Projekts: Ziel, Aktueller Stand, Offene Punkte, Entscheidungen, Nächste Schritte, Befunde. Der CLAUDE-Block lädt sie mit `@STAND.md` in jede Sitzung, der Sitzungsstart-Hook gibt zusätzlich die `uebergabe` aus (mit der Zeile `STAND.md: aktuell | veraltet | fehlt`). **Pflegeregel:** Nach jedem abgeschlossenen Arbeitspaket und vor dem Ende einer Sitzung führst du `STAND.md` mit kleinen Edits nach (Datum, Aktueller Stand, Offene Punkte, Nächste Schritte), dann `node .hierarchie/werkzeuge/hierarchie.mjs stand pruefen` und `node .hierarchie/werkzeuge/hierarchie.mjs stand html`. Steht unter `HTML-Seite:` ein claude.ai-Link und ist das Artifact-Werkzeug verfügbar, veröffentlichst du `stand.seite.html` an genau diesem Link neu. Ohne Link: beim ersten Mal privat veröffentlichen und den Link in `STAND.md` eintragen. Fehlt `STAND.md`, legt `stand neu` sie an. Das Skript erzeugt nur die Dateien; das Veröffentlichen übernimmst du. Keine Personendaten und keine Geheimnisse in `STAND.md`.

## Auftragsschablone

Jede Delegation füllt diesen Block vollständig aus. Fehlende Teile führen zu Rückfragen oder Fehlern, nicht zu besseren Ergebnissen.

```
Worker: <routine-worker | implementation-worker | recherche-worker | complex-worker | verification-worker>
Stufe und Begründung: <Eskalationsfolge; bei complex-worker der benannte Opus-Grund>

Ziel:
<was am Ende gelten soll, in einem Satz>

Betroffene Dateien:
<Pfade, die gelesen oder geändert werden dürfen>

Verbindliche Spezifikation und Regeln:
<Pfade der Spezifikation, Stilregeln, Projektregeln>

Abnahme (je Kriterium als UTS-Test formulierbar):
1. <Kriterium>
2. <Kriterium>

Nicht ändern:
<Dateien, Verhalten und Bereiche, die unberührt bleiben>

Bericht:
höchstens 300 Wörter, keine Codeauszüge. Ergebnis, geänderte Dateien, Zeile aus
`uts --kurz` eines Vollaufs mit Testdatei(en), Abweichungen, offene Punkte.
Keine Commits oder Pushes.
```

Beim `verification-worker` stehen unter „Abnahme“ die zu prüfenden Kriterien, und der Bericht enthält je Kriterium „bestanden“ oder „nicht bestanden“ mit Testdatei. Beim `recherche-worker` steht unter „Ziel“ die Frage.

## Grenzen gegen Kostenschleifen

- Je Paket höchstens **1 Nachbesserung** auf derselben Stufe, dann **1 Eskalation** um eine Stufe. Scheitert auch das, halte an und frage den Menschen.
- Je Sitzung höchstens `delegationen_max` Delegationen (Standard 12, steht in `status.json`). Bei Erreichen halte an und berichte.
- Lies keine großen Dateien selbst, wenn ein Worker es kann. Du liest Berichte, Diff-Statistiken und UTS-Zeilen.
- `fable` wird nie automatisch gewählt, nur auf ausdrücklichen Wunsch des Menschen.

## Pro-Abo

Das Kontingent ist nicht abrufbar. Mache deshalb keine Aussagen über den Restwert. Greift das Opus-Limit, wechselt der Mensch mit `/model sonnet`, und die Leitung übernimmt aus `status.json`. Die Hauptsitzung wechselt ihr Modell nicht selbst.

## Prüfregel: UTS ist die einzige Prüfinstanz

- Keine Wegwerf-Prüfungen. Jede Prüfung, die ein Agent macht, wird als Test in die UTS geschrieben und dort ausgeführt.
- „Geprüft“ darf nur gemeldet werden mit: Name der Testdatei(en) und Zeile aus `uts --kurz` eines **Vollaufs** (Exit 0). `uts --status` mit Exit 0 belegt, dass der Lauf zum aktuellen Stand passt.
- Fehlt ein Test für ein Abnahmekriterium, schreibt der `verification-worker` ihn zuerst. Er ändert keinen Produktivcode.
- Nicht automatisierbare Prüfungen (Optik, Gerät) werden als solche benannt, nicht als „geprüft“.
- Übernimm nie ungeprüft ein „fertig“ eines Workers: Prüfe die gemeldete UTS-Zeile oder lasse `uts --status` laufen.
