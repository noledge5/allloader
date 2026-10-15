---
name: ponytail-review
description: "Prüft eine Änderung (Diff, also die Unterschiede zum vorigen Stand) ausschließlich auf Überbau und sagt, was gelöscht werden kann: nachgebaute Standardbibliothek, unnötige Abhängigkeiten, vorsorgliche Abstraktionen, ungenutzte Flexibilität. Eine Zeile je Befund mit Ort, Schnitt, Ersatz und Grund. Nutze den Skill, wenn der Nutzer „auf Überbau prüfen“, „was können wir löschen“, „ist das überbaut“ sagt oder /ponytail-review aufruft. Ergänzt eine Prüfung auf Korrektheit, ersetzt sie nicht. Nicht für Fehler, Sicherheit oder Geschwindigkeit; nicht für das ganze Projekt (dafür ponytail-audit)."
---

# Ponytail-Review

Prüfe eine Änderung auf unnötige Komplexität. Eine Zeile je Befund: Ort, was weg kann, was es ersetzt, warum. Das beste Ergebnis: Die Änderung wird kürzer.

## Format

`<N>. L<Zeile>: <Tag> <was>. <Ersatz>. Grund: <warum>.` Bei mehreren Dateien `<Datei>:L<Zeile>: …`. Befunde über den ganzen Bericht fortlaufend nummerieren (`1.`, `2.`, …), damit der Nutzer „2 und 5 beheben“ sagen kann.

Tags:

- `delete:` toter Code, ungenutzte Flexibilität, vorsorgliche Funktion. Ersatz: nichts.
- `stdlib:` selbst gebaut, was die Standardbibliothek mitbringt. Funktion nennen.
- `native:` Abhängigkeit oder Code, der tut, was die Plattform schon kann. Funktion nennen.
- `reuse:` gleichwertige Hilfsfunktion oder gleiches Muster liegt schon im Projekt. Pfad nennen.
- `yagni:` Abstraktion mit einer Umsetzung, Einstellung, die niemand setzt, Schicht mit einem Aufrufer. (YAGNI: du wirst es nicht brauchen.)
- `shrink:` gleiche Logik, weniger Zeilen. Kürzere Form zeigen.
- `werkzeug:` Ablauf, der sich wiederholt und sich in Regeln fassen lässt. Ersatz: Werkzeug statt Code oder Prompt (Skill `werkzeugbau`).

## Begründung und Umgang mit Befunden

Jeder Befund nennt seinen Grund, also die echte Ursache des Überbaus (zum Beispiel „ein Aufrufer“, „nie gesetzt“, „existiert unter src/lib“). Ein Befund ohne belegbaren Grund wird gestrichen. Der Bericht ändert selbst nichts. Danach gilt: Was eine echte Ursache hat, wird behoben (nach Freigabe des Nutzers, bei mehreren als Paket im Plan, Skill `plan`). Was nicht behoben wird, bekommt den Grund dazu, warum es bleibt.

## Beispiele

Schlecht: „Diese E-Mail-Prüfklasse ist vielleicht komplexer als nötig, wurde schon überlegt, ob alle Regeln jetzt gebraucht werden?“

Gut:

`1. L12-38: stdlib: 27-zeilige Prüfklasse. „@“ in der Adresse, 1 Zeile; echte Prüfung ist die Bestätigungsmail. Grund: Regeln werden nirgends sonst genutzt.`

`2. L4: native: moment.js für einen einzigen Formataufruf. Intl.DateTimeFormat, 0 Abhängigkeiten. Grund: nur ein Aufruf.`

`3. L18-29: reuse: Hilfsfunktion slugify doppelt src/lib/slug.ts. Löschen, vorhandene importieren. Grund: gleiche Logik, gleiche Tests.`

`4. repo.py:L88: yagni: AbstractRepository mit einer Umsetzung. Einsetzen, bis eine zweite existiert. Grund: ein einziger Aufrufer.`

`5. L52-71: delete: Wiederholungsschleife um einen wiederholbaren lokalen Aufruf. Nichts. Grund: der Aufruf kann nicht vorübergehend scheitern.`

`6. L30-44: shrink: Schleife baut Wörterbuch. dict(zip(keys, values)), 1 Zeile. Grund: gleiche Aussage.`

## Wertung

Zum Schluss die einzige Zahl, die zählt: `netto: -<N> Zeilen möglich.` Gibt es nichts zu schneiden: `Schon schlank. Weiter.` und Schluss.

## Grenzen

Nur Überbau und Komplexität. Fehler, Sicherheitslücken und Geschwindigkeit gehören ausdrücklich nicht hierher, sondern in eine normale Prüfung. Ein einzelner Testfall in der UTS ist das Minimum von ponytail, kein Ballast: nie zum Löschen vorschlagen. „stop ponytail-review“ oder „normaler Modus“ schaltet auf die ausführliche Prüfung zurück.

Grundlage: DietrichGebert/ponytail (MIT), übersetzt und an hierarchie angepasst.
