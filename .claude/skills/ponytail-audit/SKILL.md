---
name: ponytail-audit
description: "Prüft das ganze Projekt auf Überbau, statt nur eine Änderung: eine nach Größe geordnete Liste dessen, was gelöscht, vereinfacht oder durch Standardbibliothek und Plattform-Bordmittel ersetzt werden kann. Nutze den Skill, wenn der Nutzer „das Projekt auf Überbau prüfen“, „was kann ich löschen“, „Bloat finden“ sagt oder /ponytail-audit aufruft. Einmaliger Bericht, ändert nichts. Nicht für eine einzelne Änderung (dafür ponytail-review), nicht für Fehler, Sicherheit oder Geschwindigkeit."
---

# Ponytail-Audit

Wie ponytail-review, aber für das ganze Projekt statt für eine Änderung. Durchsuche den gesamten Baum und ordne die Befunde nach Größe, größter Schnitt zuerst.

## Tags

Wie bei ponytail-review:

- `delete:` toter Code, ungenutzte Flexibilität, vorsorgliche Funktion. Ersatz: nichts.
- `stdlib:` selbst gebaut, was die Standardbibliothek mitbringt. Funktion nennen.
- `native:` Abhängigkeit oder Code, der tut, was die Plattform schon kann. Funktion nennen.
- `reuse:` gleichwertige Hilfsfunktion oder gleiches Muster liegt schon im Projekt. Pfad nennen.
- `yagni:` Abstraktion mit einer Umsetzung, Einstellung, die niemand setzt, Schicht mit einem Aufrufer. (YAGNI: du wirst es nicht brauchen.)
- `shrink:` gleiche Logik, weniger Zeilen. Kürzere Form zeigen.
- `werkzeug:` wiederholter, regelbasierter Ablauf. Ersatz: Werkzeug statt Code oder Prompt (Skill `werkzeugbau`; sinnvoll als Kandidat mit `register kandidat`).

## Suche

Abhängigkeiten, die Standardbibliothek oder Plattform schon liefern; Schnittstellen mit einer Umsetzung; Fabriken mit einem Produkt; Hüllen, die nur weiterreichen; Dateien, die nur eine Sache ausführen; tote Schalter und Einstellungen; selbst gebaute Standardfunktionen; Hilfsfunktionen, die ein vorhandenes Gegenstück doppeln.

Vor jedem `delete:` den ganzen Baum nach dem Namen durchsuchen, auch Tests, Testdaten sowie Verweise als Text oder dynamisch gebildete Namen.

## Ausgabe

Eine Zeile je Befund, nummeriert und geordnet: `<N>. <Tag> <was weg kann>. <Ersatz>. Grund: <warum>. [Pfad]`, damit der Nutzer „2 und 5 beheben“ sagen kann. Zum Schluss `netto: -<N> Zeilen, -<M> Abhängigkeiten möglich.` Gibt es nichts zu schneiden: `Schon schlank. Weiter.`

## Begründung und Umgang mit Befunden

Jeder Befund nennt seinen Grund, also die echte Ursache des Überbaus. Ein Befund ohne belegbaren Grund wird gestrichen. Der Bericht ändert nichts. Danach gilt: Was eine echte Ursache hat, wird behoben (nach Freigabe des Nutzers, bei vielen Befunden als Plan mit `plan neu`, Skill `plan`; Prüfung der Behebung über die UTS). Was nicht behoben wird, bekommt den Grund dazu, warum es bleibt.

## Grenzen

Nur Überbau und Komplexität. Fehler, Sicherheitslücken und Geschwindigkeit gehören in eine normale Prüfung. Ein einzelner Testfall in der UTS ist das Minimum von ponytail, nie zum Löschen vorschlagen. Listet Befunde, wendet nichts an, einmalig. „stop ponytail-audit“ oder „normaler Modus“ schaltet es ab.

Grundlage: DietrichGebert/ponytail (MIT), übersetzt und an hierarchie angepasst.
