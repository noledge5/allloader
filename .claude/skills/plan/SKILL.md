---
name: plan
description: Lege für größere Aufgaben mit mehreren Arbeitspaketen einen Plan an und führe ihn mit dem Befehl plan - Pakete mit Stufe und Begründung, Abhängigkeiten und Abnahme, Status, Zähler für Delegationen. Nutze diesen Skill, sobald eine Aufgabe in mehrere Pakete zerfällt, sobald du Arbeit delegierst und mitzählen musst, und zu Beginn jeder neuen Sitzung, die an einem bestehenden Plan weiterarbeitet. Nicht für Einzelschritte, die sich direkt erledigen lassen.
---

# Plan

Ein Plan hält fest, was getan wird, in welcher Reihenfolge und wo die Arbeit steht. So kann jede Sitzung (auch nach einem Wechsel des Modells) aus dem Plan weitermachen, statt aus dem Gedächtnis.

## Wann ein Plan?

Bei größeren Aufgaben, die in **mehrere Arbeitspakete** mit eigener Abnahme zerfallen. Einzelne Schritte, die sich direkt erledigen lassen, brauchen keinen Plan.

## Wo liegt er?

Im Projekt unter `plaene/<name>/`:

- `plan.md`: der Text des Plans (Ziel und messbare Erfolgskriterien, Ausgangszustand und Architektur, Arbeitspakete, Abhängigkeiten, Modellwahl je Paket mit Begründung, Werkzeuge und Automatisierungen, Tests und Abnahme, Risiken, nächste Schritte).
- `status.json`: der Stand. Je Paket Titel, Stufe, Begründung, Status, Abhängigkeiten, Abnahme, Notiz; dazu `delegationen` und `delegationen_max` (Standard 12).
- `plan.html`: erzeugte, lesbare Ansicht für den Menschen. Nicht versioniert.

## Befehle

Im Projekt: `node .hierarchie/werkzeuge/hierarchie.mjs plan …`. Im hierarchie-Repo selbst: `node werkzeuge/hierarchie.mjs plan …`. Die Beispiele zeigen die Projektform.

- `node .hierarchie/werkzeuge/hierarchie.mjs plan neu <name> --ziel "…"` legt `plan.md` aus der Vorlage und ein leeres `status.json` an.
- `node .hierarchie/werkzeuge/hierarchie.mjs plan paket <name> <id> --titel "…" --stufe werkzeug|haiku|sonnet|opus --begruendung "…" [--abhaengig WP1,WP2] [--abnahme "…"]` legt ein Paket an oder ändert es. Stufe `opus` braucht den benannten Grund als Begründung (sonst Exit 2). `--abnahme` darf wiederholt werden.
- `node .hierarchie/werkzeuge/hierarchie.mjs plan setze <name> <id> <status> [--notiz "…"]` setzt den Status (`offen`, `in_arbeit`, `pruefung`, `fertig`, `blockiert`). `in_arbeit` geht nur, wenn alle Abhängigkeiten `fertig` sind (sonst Exit 1).
- `node .hierarchie/werkzeuge/hierarchie.mjs plan delegation <name>` zählt eine Delegation. Ist `delegationen_max` erreicht, kommt Exit 1 mit dem Hinweis „anhalten und berichten“.
- `node .hierarchie/werkzeuge/hierarchie.mjs plan zeige [<name>]` zeigt eine Zeile je Paket; ohne Namen alle nicht abgeschlossenen Pläne.
- `node .hierarchie/werkzeuge/hierarchie.mjs plan naechstes <name>` nennt das erste offene Paket, dessen Abhängigkeiten erfüllt sind.
- `node .hierarchie/werkzeuge/hierarchie.mjs plan html <name>` erzeugt `plan.html` (plan.md als HTML plus Statustabelle).

## Regeln

1. **Status nur über `plan setze`.** Nie `status.json` von Hand ändern, damit die Übergangsregeln und der Abschlussvermerk stimmen.
2. **Jede Delegation über `plan delegation` zählen**, bevor der Worker beauftragt wird. Bei Exit 1 anhalten und dem Menschen berichten, nicht weiter delegieren.
3. **Stufe und Begründung je Paket festhalten** (Skill `intelligent-routing`). Bei Opus steht der benannte Grund in der Begründung.
4. **Abnahme als UTS-Test formulierbar** schreiben. „Fertig“ gilt erst nach Abnahme und grünem UTS-Vollauf (Skill `projektleitung`).
5. **Genau ein nächstes Paket**: `plan naechstes` fragen, `plan setze … in_arbeit`, delegieren, prüfen, `plan setze … fertig`.
6. **Neue Sitzung beginnt mit `plan zeige`.** Daraus und aus `plan.md` weitermachen, nicht aus dem Gedächtnis.
7. **Was sich wiederholt,** wird Kandidat für ein Werkzeug (Skill `werkzeugbau`).
8. **Projektstand nachführen:** Nach jedem abgeschlossenen Arbeitspaket und vor dem Ende einer Sitzung `STAND.md` mit kleinen Edits aktualisieren (Datum, Aktueller Stand, Offene Punkte, Nächste Schritte), dann `node .hierarchie/werkzeuge/hierarchie.mjs stand pruefen` und `node .hierarchie/werkzeuge/hierarchie.mjs stand html`. Steht unter `HTML-Seite:` ein claude.ai-Link und ist das Artifact-Werkzeug verfügbar, `stand.seite.html` an genau diesen Link neu veröffentlichen; ohne Link beim ersten Mal privat veröffentlichen und den Link in `STAND.md` eintragen. Details im Skill `projektleitung`.
