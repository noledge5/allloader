---
name: tdd
description: "Testgetriebene Entwicklung (Test zuerst) mit dem Zyklus Rot-Grün-Umbau: Der Test kommt vor dem Code und liegt in der UTS. Nutze den Skill, wenn der Nutzer Funktionen oder Fehlerbehebungen testgetrieben bauen will, „red-green-refactor“, „Test zuerst“ oder Integrationstests nennt. Nicht für reine Textarbeit, nicht für Wegwerfprüfungen außerhalb der UTS."
---

# Testgetriebene Entwicklung (TDD)

TDD heißt: erst ein Test, der fehlschlägt (rot), dann der kleinste Code, der ihn bestehen lässt (grün), dann aufräumen (Umbau, englisch „refactor“).

## Kernregel

**Test zuerst, und der Test liegt in der UTS.** Jeder Test ist eine Testdatei im Projekt (`*.test.mjs`, mit `node:test` und `node:assert`; hierarchie hat keine Abhängigkeiten), die die UTS (Unit-Test-Suite) ausführt. Keine Wegwerfprüfungen außerhalb der UTS.

- Einzelner Lauf zum Arbeiten: `node .hierarchie/werkzeuge/uts.mjs --zu <datei>` (im Repo hierarchie `node werkzeuge/uts.mjs --zu <datei>`).
- Abschluss: Vollauf `node .hierarchie/werkzeuge/uts.mjs --kurz` (im Repo hierarchie `node werkzeuge/uts.mjs --kurz`), Exit 0. „Geprüft“ gilt erst mit dem Namen der Testdatei und dieser Zeile.

## Grundsatz

**Kernprinzip**: Tests prüfen Verhalten über öffentliche Schnittstellen, nicht Umsetzungsdetails. Der Code darf sich komplett ändern, die Tests nicht.

**Gute Tests** sind integrationsartig: Sie durchlaufen echte Codepfade über die öffentliche Schnittstelle. Sie beschreiben, *was* das System tut, nicht *wie*. Ein guter Test liest sich wie eine Spezifikation: „Nutzer kann mit gültigem Warenkorb bestellen“ sagt genau, welche Fähigkeit es gibt. Solche Tests überleben Umbauten, weil ihnen der innere Aufbau egal ist.

**Schlechte Tests** hängen an der Umsetzung. Sie ersetzen interne Mitspieler durch Attrappen (Mocks), testen private Methoden oder prüfen über Umwege (etwa direkt in der Datenbank, statt über die Schnittstelle). Warnzeichen: Der Test bricht beim Umbau, obwohl sich das Verhalten nicht geändert hat. Scheitern Tests, wenn du eine interne Funktion umbenennst, haben sie die Umsetzung getestet, nicht das Verhalten.

Beispiele in [tests.md](tests.md), Hinweise zu Attrappen in [mocking.md](mocking.md).

## Anti-Muster: waagerechte Scheiben

**Nicht erst alle Tests schreiben, dann den ganzen Code.** Das ist „waagerechtes Schneiden“: ROT wird als „alle Tests schreiben“ missverstanden, GRÜN als „allen Code schreiben“.

Das erzeugt **schlechte Tests**:

- Auf Vorrat geschriebene Tests prüfen *vorgestelltes* Verhalten, nicht *tatsächliches*.
- Du testest die *Form* der Dinge (Datenstrukturen, Funktionsköpfe) statt des Verhaltens.
- Die Tests werden unempfindlich gegen echte Änderungen: Sie bestehen, wenn das Verhalten bricht, und scheitern, wenn alles in Ordnung ist.
- Du läufst deinen Scheinwerfern davon und legst die Teststruktur fest, bevor du die Umsetzung verstehst.

**Richtig**: senkrechte Scheiben als Durchstich („Tracer Bullet“, Leuchtspurgeschoss). Ein Test → eine Umsetzung → wiederholen. Jeder Test antwortet auf das, was der vorige Zyklus gelehrt hat. Weil du den Code gerade geschrieben hast, weißt du genau, welches Verhalten zählt und wie man es prüft.

```
FALSCH (waagerecht):
  ROT:   Test1, Test2, Test3, Test4, Test5
  GRÜN:  Code1, Code2, Code3, Code4, Code5

RICHTIG (senkrecht):
  ROT→GRÜN: Test1→Code1
  ROT→GRÜN: Test2→Code2
  ROT→GRÜN: Test3→Code3
  ...
```

## Ablauf

### 1. Planen

Planen geschieht gemeinsam mit dem Nutzer, umgesetzt wird erst nach seiner Freigabe. Beim Erkunden des Projekts helfen die Begriffe aus `STAND.md` und den Plänen, damit Testnamen und Schnittstellenwörter zur Sprache des Projekts passen; getroffene Entscheidungen in `STAND.md` werden beachtet.

Bevor Code entsteht:

- [ ] Mit dem Nutzer klären, welche Schnittstellenänderungen nötig sind
- [ ] Mit dem Nutzer klären, welche Verhalten getestet werden (nach Wichtigkeit)
- [ ] Chancen für [tiefe Module](deep-modules.md) suchen (kleine Schnittstelle, viel dahinter)
- [ ] Schnittstellen [testbar](interface-design.md) entwerfen
- [ ] Die zu testenden Verhalten auflisten (keine Umsetzungsschritte)
- [ ] Freigabe des Nutzers für den Plan holen

Frage: „Wie soll die öffentliche Schnittstelle aussehen? Welche Verhalten sind am wichtigsten?“

**Du kannst nicht alles testen.** Kläre mit dem Nutzer, welche Verhalten am meisten zählen. Lege den Testaufwand auf kritische Pfade und knifflige Logik, nicht auf jeden Randfall.

### 2. Durchstich

Schreibe EINEN Test, der EINE Sache am System bestätigt:

```
ROT:   Test für das erste Verhalten schreiben → Test schlägt fehl
GRÜN:  Kleinsten Code schreiben, der ihn besteht → Test besteht
```

Das ist dein Durchstich: Er beweist, dass der Weg von Anfang bis Ende trägt. Kleines Beispiel mit den Bordmitteln von Node:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summe } from '../werkzeuge/rechnen.mjs';

test('summe addiert die Preise eines Warenkorbs', () => {
  assert.equal(summe([{ preis: 2 }, { preis: 3 }]), 5);
});
```

Der Test schlägt fehl (rot), weil `summe` noch fehlt. Erst dann entsteht der Code.

### 3. Schrittweise Schleife

Für jedes weitere Verhalten:

```
ROT:   Nächsten Test schreiben → schlägt fehl
GRÜN:  Kleinster Code zum Bestehen → besteht
```

Regeln:

- Immer nur ein Test
- Nur so viel Code, wie der aktuelle Test braucht
- Spätere Tests nicht vorwegnehmen
- Tests auf beobachtbares Verhalten richten
- Nach jedem Zyklus die Testdatei mit `--zu <datei>` laufen lassen

### 4. Umbauen

Sind alle Tests grün, suche [Umbau-Kandidaten](refactoring.md):

- [ ] Doppelungen herausziehen
- [ ] Module vertiefen (Komplexität hinter einfache Schnittstellen verlegen)
- [ ] SOLID-Prinzipien (bekannte Entwurfsregeln für klare Verantwortung) anwenden, wo sie natürlich passen
- [ ] Überlegen, was der neue Code über den vorhandenen verrät
- [ ] Nach jedem Umbauschritt die Tests laufen lassen
- [ ] Am Ende den UTS-Vollauf (`uts --kurz`, Exit 0)

**Nie umbauen, solange ein Test ROT ist.** Erst GRÜN erreichen.

## Prüfliste je Zyklus

```
[ ] Test beschreibt Verhalten, nicht Umsetzung
[ ] Test nutzt nur die öffentliche Schnittstelle
[ ] Test würde einen inneren Umbau überleben
[ ] Test liegt in der UTS (Testdatei im Projekt)
[ ] Code ist minimal für diesen Test
[ ] Keine vorsorglichen Funktionen ergänzt
```

Grundlage: Matt Pocock (MIT), übersetzt und an hierarchie angepasst.
