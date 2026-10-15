---
name: grill-me
description: "Befragt den Nutzer gründlich zu einem Plan oder Entwurf, bis beide dasselbe verstehen, und klärt dabei jeden Zweig des Entscheidungsbaums. Nutze den Skill, wenn der Nutzer einen Plan auf Herz und Nieren prüfen lassen will, „grill me“ sagt oder seinen Entwurf durchgefragt haben möchte. Nicht für Fragen, die sich durch Lesen des Projekts beantworten lassen, und nicht für die reine Umsetzung eines schon freigegebenen Plans."
---

# Grill me

Befrage mich gründlich zu jedem Aspekt dieses Plans, bis wir dasselbe verstehen. Gehe jeden Zweig des Entwurfsbaums nacheinander durch und kläre die Abhängigkeiten zwischen den Entscheidungen der Reihe nach. Gib zu jeder Frage deine empfohlene Antwort an.

Stelle die Fragen **einzeln**, eine pro Nachricht.

Lässt sich eine Frage durch Lesen des Projekts beantworten (Code, `STAND.md`, Pläne, `register`), lies nach, statt zu fragen.

## Ergebnis festhalten

Planen geschieht gemeinsam mit dem Nutzer, umgesetzt wird erst nach seiner Freigabe. Am Ende fasst du die geklärten Punkte kurz zusammen:

- Entscheidungen des Nutzers kommen in `STAND.md` unter „Entscheidungen“.
- Offene Fragen kommen unter „Offene Punkte“.
- Ist daraus ein Vorhaben mit mehreren Arbeitspaketen geworden, geht es als Plan weiter (Skill `plan`, Leitung nach Skill `projektleitung`).

Nichts davon wird ohne ausdrückliche Zustimmung des Nutzers eingetragen.

Grundlage: Matt Pocock (MIT), übersetzt und an hierarchie angepasst.
