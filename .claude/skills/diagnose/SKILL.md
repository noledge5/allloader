---
name: diagnose
description: "Disziplinierte Fehlersuche bei schwierigen Fehlern und Leistungseinbrüchen: Schleife bauen, reproduzieren, Hypothesen aufstellen, messen, beheben, Regressionstest in die UTS. Nutze den Skill, wenn der Nutzer „diagnose“, „debug das“ oder „finde den Fehler“ sagt, einen Fehler meldet, etwas kaputt ist, Fehler wirft oder fehlschlägt, oder ein Leistungsproblem beschreibt. Nicht für einfache, sofort sichtbare Fehler ohne Rätsel und nicht für Neubau."
---

# Diagnose

Eine Disziplin für schwierige Fehler. Phasen werden nur mit ausdrücklicher Begründung übersprungen.

Beim Erkunden des Projekts helfen `STAND.md` (Entscheidungen, Befunde), vorhandene Pläne und das Register der Werkzeuge. Ein Befund dort kann den Fehler schon erklären.

## Phase 1: Eine Rückmeldeschleife bauen

**Das ist der Kern.** Alles andere ist Handwerk. Mit einem schnellen, deterministischen (immer gleich ausgehenden), von Claude selbst ausführbaren Bestanden/Durchgefallen-Signal für den Fehler findest du die Ursache; Eingrenzen, Hypothesen prüfen und Messen verbrauchen nur dieses Signal. Ohne es hilft kein Anstarren des Codes.

Betreibe hier unverhältnismäßig viel Aufwand. **Sei hartnäckig, kreativ und gib nicht auf.**

### Wege zu einer Schleife, ungefähr in dieser Reihenfolge

1. **Fehlschlagender Test in der UTS** an der Stelle, die den Fehler erreicht (Einzelfunktion, Zusammenspiel mehrerer Teile, ganzer Ablauf). Das ist der Standard, und jede andere Schleife soll am Ende hier landen.
2. **Aufruf gegen einen laufenden Entwicklungsserver** (HTTP-Anfrage per Skript).
3. **Befehlsaufruf mit einer Beispieleingabe**, Ausgabe gegen einen bekannten guten Stand vergleichen.
4. **Browser ohne Oberfläche** (Playwright oder Puppeteer, falls im Projekt vorhanden): steuert die Seite und prüft Seiteninhalt, Konsole, Netzwerk.
5. **Aufgezeichneten Vorgang wiedergeben.** Eine echte Anfrage, Nutzlast oder ein Ereignisprotokoll speichern und isoliert durch den Codepfad schicken.
6. **Kleiner Nachbau.** Ein Minimalausschnitt des Systems (ein Dienst, Abhängigkeiten ersetzt), der den fehlerhaften Pfad mit einem Funktionsaufruf auslöst.
7. **Zufalls-Schleife.** Bei „manchmal falsche Ausgabe“: 1000 zufällige Eingaben laufen lassen und die Fehlerform suchen.
8. **Eingrenzen entlang der Zeit.** Trat der Fehler zwischen zwei bekannten Ständen auf (Commit, Datenstand, Version), automatisiere „Stand X herstellen, prüfen, wiederholen“. Mit Git geht das über `git bisect run` und dem UTS-Aufruf der betroffenen Testdatei (`--zu <datei>`).
9. **Vergleichsschleife.** Dieselbe Eingabe durch alte und neue Version (oder zwei Einstellungen) schicken und die Ausgaben vergleichen.
10. **Menschliche Schleife.** Letzter Ausweg, siehe unten.

Hilfsschleifen zum Eingrenzen sind erlaubt, gelten aber nicht als Prüfung. Sobald der Fehler greifbar ist, wird die Reproduktion als Test in die UTS übernommen (Phase 5), soweit sie sich automatisieren lässt. Was nicht automatisierbar ist (Optik, Gerät), wird als „nicht geprüft“ benannt.

Mit der richtigen Rückmeldeschleife ist der Fehler zu 90 % behoben.

### Die Schleife selbst verbessern

Behandle die Schleife wie ein Produkt. Sobald es *eine* gibt, frage:

- Geht es schneller? (Aufbau zwischenspeichern, Unwichtiges überspringen, Testumfang verkleinern.)
- Wird das Signal schärfer? (Auf das genaue Symptom prüfen, nicht auf „ist nicht abgestürzt“.)
- Wird sie deterministischer? (Zeit festnageln, Zufall mit festem Startwert, Dateisystem isolieren, Netzwerk einfrieren.)

Eine flackernde 30-Sekunden-Schleife ist kaum besser als keine. Eine deterministische 2-Sekunden-Schleife ist eine Superkraft.

### Nicht deterministische Fehler

Ziel ist keine saubere Reproduktion, sondern eine **höhere Trefferquote**. Auslöser 100-mal wiederholen, parallel laufen lassen, Last erzeugen, Zeitfenster verengen, Pausen einfügen. Ein Fehler, der in 50 % der Läufe auftritt, ist zu beheben, einer bei 1 % nicht: erhöhe die Quote, bis es geht.

### Menschliche Schleife

Muss ein Mensch klicken oder etwas ansehen, steuerst du *ihn* strukturiert (kein Skript nötig, plattformneutral): Schreibe dem Nutzer nummerierte Schritte zum Nachstellen, jeweils mit **einer** klaren Frage am Ende („Hat der Knopf einen Fehler gezeigt? ja/nein“, „Wie lautet die Fehlermeldung genau?“). Der Nutzer meldet die Antworten zurück, du wertest sie aus und stellst die nächste Runde zusammen. Halte die Schritte kurz, setze Ausgangszustand und erwartetes Ergebnis fest und ändere pro Runde nur eine Sache.

### Wenn gar keine Schleife möglich ist

Sage das ausdrücklich und liste auf, was du versucht hast. Bitte den Nutzer um: (a) Zugang zu der Umgebung, die den Fehler zeigt, (b) einen festgehaltenen Beleg (Protokoll, Speicherabzug, Bildschirmaufnahme mit Zeitangaben) oder (c) die Erlaubnis für vorübergehende Messpunkte im Echtbetrieb. Stelle **keine** Hypothesen auf ohne Schleife.

Gehe nicht zu Phase 2, bevor du eine Schleife hast, der du traust.

## Phase 2: Reproduzieren

Lass die Schleife laufen und sieh den Fehler auftreten.

Bestätige:

- [ ] Die Schleife zeigt die Fehlerform, die der **Nutzer** beschrieben hat, nicht einen anderen Fehler in der Nähe. Falscher Fehler = falsche Korrektur.
- [ ] Der Fehler tritt über mehrere Läufe auf (bei nicht deterministischen Fehlern mit einer Quote, die zum Arbeiten reicht).
- [ ] Das genaue Symptom ist festgehalten (Fehlermeldung, falsche Ausgabe, Zeitmessung), damit spätere Phasen prüfen können, ob die Korrektur es wirklich trifft.

Nicht weitergehen, bevor der Fehler reproduziert ist.

## Phase 3: Hypothesen aufstellen

Stelle **3 bis 5 gereihte Hypothesen** auf, bevor du eine prüfst. Mit nur einer verankerst du dich beim ersten plausiblen Einfall.

Jede Hypothese muss **widerlegbar** sein und ihre Vorhersage nennen.

> Form: „Ist <X> die Ursache, dann lässt <Änderung Y> den Fehler verschwinden / macht <Änderung Z> ihn schlimmer.“

Kannst du die Vorhersage nicht nennen, ist die Hypothese nur ein Gefühl: verwerfen oder schärfen.

**Zeige dem Nutzer die gereihte Liste, bevor du prüfst.** Er hat oft Fachwissen, das sofort umordnet („an Nr. 3 wurde gerade etwas geändert“), oder weiß, was schon ausgeschlossen ist. Ein billiger Zwischenhalt, der viel Zeit spart. Blockiere nicht: Ist der Nutzer nicht erreichbar, geht es mit deiner Reihung weiter.

Bleibt der Fehler nach einem systematischen Sonnet-Versuch mit Bericht unklar oder müssen mehrere Hypothesen gegeneinander geprüft werden, ist das ein benannter Opus-Grund. Ob und an wen delegiert wird, entscheidet die Leitung nach den Skills `projektleitung` und `intelligent-routing`.

## Phase 4: Messen

Jede Messung gehört zu einer bestimmten Vorhersage aus Phase 3. **Ändere jeweils nur eine Größe.**

Rangfolge der Mittel:

1. **Debugger oder interaktive Konsole**, falls die Umgebung sie hat. Ein Haltepunkt schlägt zehn Logzeilen.
2. **Gezielte Logzeilen** an den Grenzen, die Hypothesen unterscheiden.
3. Nie „alles loggen und durchsuchen“.

**Kennzeichne jede Debug-Logzeile** mit einem eindeutigen Präfix, zum Beispiel `[DEBUG-a4f2]`. Das Aufräumen am Ende ist dann eine einzige Suche. Unmarkierte Logzeilen bleiben, markierte sterben.

**Leistungszweig.** Bei Leistungseinbrüchen sind Logzeilen meist falsch. Stattdessen: erst eine Basismessung (Zeitmessung, `performance.now()`, Profiler, Abfrageplan), dann eingrenzen. Erst messen, dann beheben.

## Phase 5: Beheben und Regressionstest

Ein Regressionstest (er hält fest, dass der Fehler nicht wiederkommt) wird **vor der Korrektur** in der UTS geschrieben, aber nur, wenn es eine **passende Nahtstelle** dafür gibt.

Eine passende Nahtstelle ist eine Stelle, an der der Test das **echte Fehlermuster** so auslöst, wie es an der Aufrufstelle auftritt. Ist die einzige verfügbare Stelle zu flach (Test mit einem Aufrufer, obwohl der Fehler mehrere braucht; Einzeltest, der die auslösende Kette nicht nachbildet), gibt ein Test dort falsche Sicherheit.

**Gibt es keine passende Nahtstelle, ist das selbst der Befund.** Notiere ihn: Der Aufbau des Codes verhindert, den Fehler festzunageln. Halte das für den nächsten Schritt fest.

Gibt es eine passende Nahtstelle:

1. Aus der verkleinerten Reproduktion einen fehlschlagenden Test in der UTS machen (Testdatei im Projekt, nicht als Wegwerfskript).
2. Sehen, dass er fehlschlägt (`node .hierarchie/werkzeuge/uts.mjs --zu <datei>`, im Repo hierarchie `node werkzeuge/uts.mjs --zu <datei>`).
3. Die Korrektur anwenden.
4. Sehen, dass er besteht.
5. Die Schleife aus Phase 1 gegen das ursprüngliche, nicht verkleinerte Szenario noch einmal laufen lassen.

## Phase 6: Aufräumen und Rückblick

Vor dem Abschluss erforderlich:

- [ ] Die ursprüngliche Reproduktion tritt nicht mehr auf (Schleife aus Phase 1 erneut).
- [ ] Der Regressionstest besteht (oder das Fehlen einer Nahtstelle ist festgehalten).
- [ ] Alle `[DEBUG-...]`-Messpunkte sind entfernt (nach dem Präfix suchen).
- [ ] Wegwerf-Prototypen sind gelöscht (oder in einem klar markierten Debug-Ordner).
- [ ] UTS-Vollauf grün: `node .hierarchie/werkzeuge/uts.mjs --kurz` (im Repo hierarchie `node werkzeuge/uts.mjs --kurz`). „Geprüft“ gilt erst mit Testdatei und dieser Zeile.
- [ ] Die Hypothese, die sich als richtig erwies, steht in der Commit-Nachricht oder PR-Beschreibung, damit der nächste Suchende lernt.

**Dann frage: Was hätte diesen Fehler verhindert?** Verlangt die Antwort einen Umbau (keine gute Nahtstelle, verwickelte Aufrufer, versteckte Kopplung), halte ihn mit den Einzelheiten als Befund in `STAND.md` fest oder schlage dem Nutzer einen Plan vor (Skill `plan`). Wiederholt sich der Fehlertyp, trage einen Kandidaten ein (`register kandidat`, Skill `werkzeugbau`). Mache diese Empfehlung **nach** der Korrektur, nicht davor: Du weißt jetzt mehr als am Anfang.

Grundlage: Matt Pocock (MIT), übersetzt und an hierarchie angepasst.
