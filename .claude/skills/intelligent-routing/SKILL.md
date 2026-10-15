---
name: intelligent-routing
description: Wähle vor jeder Delegation an einen Subagent und vor jeder Modellwahl die passende Stufe (Werkzeug, Haiku, Sonnet, Opus) nach fester Eskalationsfolge und nach Bedarf statt Größe. Nutze diesen Skill, bevor du eine Aufgabe an routine-worker, implementation-worker, recherche-worker, complex-worker oder verification-worker übergibst, bevor du ein Modell empfiehlst oder wechselst, und wenn unklar ist, ob eine Aufgabe ein Werkzeug, ein kleines oder ein großes Modell braucht. Enthält die Kriterien je Stufe, die Fable-Regel, die technischen Grenzen der Modellzuweisung und Beispiele.
---

# Intelligentes Routing

Für jedes Arbeitspaket gilt: so wenig Modell wie nötig, so viel wie sicher erforderlich. Die Stufe richtet sich nach dem **Bedarf**, nicht nach der Größe der Aufgabe.

## Eskalationsfolge

Prüfe in dieser Reihenfolge und nimm die erste Stufe, die zutrifft.

0. **Werkzeug vorhanden?** Register prüfen (`.hierarchie/register.json` bzw. `node .hierarchie/werkzeuge/hierarchie.mjs register`). Gibt es eines, führe es aus. Kein Modell.
1. **Deterministisch lösbar?** Dann Werkzeug bauen (Skill `werkzeugbau`), wenn es sich lohnt; sonst direkt per Befehl.
2. **Haiku** (`routine-worker`), wenn alle vier Punkte zutreffen: Ergebnis eindeutig prüfbar, keine Abwägung, höchstens etwa 3 Dateien mit klarer Vorgabe, Fehler billig zu entdecken.
3. **Sonnet** (`implementation-worker`) ist der **Standard** für alles, was Haiku nicht sicher kann und keinen Opus-Grund hat. Reine Recherche (nur lesend) geht an den `recherche-worker`, ebenfalls Sonnet.
4. **Opus** (`complex-worker`) nur mit mindestens einem **benannten** Grund:
   - Architekturentscheidung mit weitreichenden, schwer umkehrbaren Folgen
   - mehrdeutiges Problem, mehrere Hypothesen müssen gegeneinander geprüft werden
   - Fehler nach systematischer Suche (mindestens 1 Sonnet-Versuch mit Bericht) weiter unklar
   - sicherheitskritisch oder Datenschutz (Personendaten, Rechte, RLS, Geheimnisse)
   - Refactoring über viele voneinander abhängige Komponenten
   - Synthese widersprüchlicher Anforderungen

   Der Grund steht im Delegationsauftrag und in `status.json`. Ohne Grund arbeitet der `complex-worker` nicht.

Die unabhängige Abnahme übernimmt der `verification-worker` (Sonnet, nur über die UTS).

## Bedarf statt Größe

Nicht die Zahl der Dateien oder Zeilen entscheidet, sondern ob Urteilsvermögen nötig ist.

- Viele Dateien mit mechanischer Änderung: Haiku oder Werkzeug.
- Eine einzige Zeile in der Rechteprüfung: Opus-Prüfung.

## Fable-Regel

`fable` wird **nie** automatisch gewählt, nur wenn der Mensch es ausdrücklich verlangt.

## Technische Grenzen (so funktioniert die Modellzuweisung wirklich)

- Die Hauptsitzung wechselt ihr Modell nicht selbst. Das Sitzungsmodell wählt der Mensch (`/model`, `--model`, `settings.json`); `opusplan` kennt nur zwei Stufen und ist an den Plan-Modus gebunden – genau deshalb ist es die Empfehlung für die Hauptsitzung (Opus plant, Sonnet setzt um).
- Eine **echte** Modellzuweisung je Aufgabe gibt es nur über das `model` im Subagent-Frontmatter oder über den `model`-Parameter beim Agent-Aufruf (er überschreibt das Frontmatter für diesen Aufruf). Reihenfolge: Aufruf-Parameter, Frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, Hauptmodell.
- Ein `model` im Skill-Frontmatter gilt nur für den Rest des aktuellen Turns, danach gilt wieder das Sitzungsmodell. Deshalb tragen diese Skills kein `model`.
- Hooks können kein Modell wählen. Sie routen nicht.
- Die Worker sind mit `disallowedTools: Agent` gesperrt und starten keine eigenen Subagents.

## Kosten als Verhältnis

API-Preise je Million Tokens (Eingabe/Ausgabe): Haiku 0,10/0,50 $ · Sonnet 2/10 $ · Opus 4/20 $ · Fable 10/50 $. Im Pro-Abo fällt ein Nutzungskontingent an, dessen Restwert nicht abrufbar ist; die Preise sind dort nur eine Verhältniszahl. Mache keine Aussagen über das verbleibende Kontingent.

## Beispiele

| Aufgabe | Stufe | Begründung |
|---|---|---|
| 120 Bilddateien einmalig nach festem Schema umbenennen (`IMG_…` zu `JJJJ-MM-TT_…`) | Befehl, kein Modell (Stufe 1) | Deterministisch lösbar; Einmalaufgabe, daher kein Werkzeugbau. Viele Dateien, aber kein Urteil nötig |
| Reproduzierbaren Bugfix mit klarer Fehlerbeschreibung umsetzen und per Test absichern | Sonnet (`implementation-worker`) | Reguläre Implementierung, kein Opus-Grund, für Haiku zu viel Abwägung |
| Zeile in einer RLS-Policy ändern | Opus (`complex-worker`) | Sicherheitskritisch (Rechte, RLS); Bedarf statt Größe. Danach `verification-worker` |
| Defekte Links auf eine umbenannte Seite in 3 Doku-Dateien korrigieren, Linkprüfung als Test vorhanden | Haiku (`routine-worker`) | Eindeutig prüfbar, keine Abwägung, höchstens 3 Dateien, Fehler billig zu entdecken |
| Datenhaltung für ein neues Modul wählen (relationale Tabellen oder Ereignisprotokoll) | Opus (`complex-worker`) | Architekturentscheidung mit weitreichenden, schwer umkehrbaren Folgen |
| Monatlich wiederkehrend 300 Dateien von einem Format in ein anderes umwandeln, Regeln eindeutig | Werkzeug bauen (Stufe 1, Skill `werkzeugbau`) | Deterministisch lösbar und wiederkehrend; Werkzeug statt immer neuer Prompts |
| Flaky Fehler, der nach einem Sonnet-Versuch mit Bericht weiter unklar ist | Opus (`complex-worker`) | Fehler nach systematischer Suche (mindestens 1 Sonnet-Versuch mit Bericht) weiter unklar; Bericht in den Auftrag |
| Rate-Limits und Paginierung einer externen API in der Dokumentation belegen | Sonnet (`recherche-worker`) | Nur lesend, Fakten belegen: Aufgabe des `recherche-worker` |
| Schnittstelle ändern und 15 voneinander abhängige Module anpassen | Opus (`complex-worker`) | Refactoring über viele voneinander abhängige Komponenten |
| Commit-Text nach vorgegebenem Schema aus vorliegendem Bericht und Diff-Statistik formulieren | Haiku (`routine-worker`) | Format eindeutig prüfbar, keine Abwägung; das Committen selbst bleibt bei der Leitung |

## Vor dem Delegieren

1. Eskalationsfolge anwenden und Stufe samt Begründung festhalten (bei Opus: den benannten Grund).
2. Passenden Worker mit einem vollständigen Auftrag beauftragen (Schablone im Skill `projektleitung`).
