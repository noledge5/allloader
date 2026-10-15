# Gute und schlechte Tests

Alle Tests liegen in der UTS (Testdatei im Projekt, `node:test` und `node:assert`).

## Gute Tests

**Integrationsartig**: über echte Schnittstellen testen, nicht über Attrappen innerer Teile.

```js
// GUT: prüft beobachtbares Verhalten
test('Nutzer kann mit gültigem Warenkorb bestellen', async () => {
  const korb = erzeugeKorb();
  korb.hinzufuegen(produkt);
  const ergebnis = await bestellen(korb, zahlungsart);
  assert.equal(ergebnis.status, 'bestaetigt');
});
```

Merkmale:

- Prüft Verhalten, das Nutzer oder Aufrufer interessiert
- Nutzt nur die öffentliche Schnittstelle
- Überlebt innere Umbauten
- Beschreibt WAS, nicht WIE
- Eine logische Aussage je Test

## Schlechte Tests

**Umsetzungsdetail-Tests**: hängen am inneren Aufbau.

```js
// SCHLECHT: prüft Umsetzungsdetails
test('bestellen ruft zahlungsdienst.verarbeite auf', async (t) => {
  const attrappe = t.mock.method(zahlungsdienst, 'verarbeite');
  await bestellen(korb, zahlung);
  assert.deepEqual(attrappe.mock.calls[0].arguments, [korb.summe]);
});
```

Warnzeichen:

- Interne Mitspieler werden durch Attrappen ersetzt
- Private Methoden werden getestet
- Aufrufzahlen oder Reihenfolge werden geprüft
- Der Test bricht beim Umbau ohne Verhaltensänderung
- Der Testname beschreibt WIE statt WAS
- Es wird über Umwege geprüft statt über die Schnittstelle

```js
// SCHLECHT: umgeht die Schnittstelle
test('erzeugeNutzer speichert in der Datenbank', async () => {
  await erzeugeNutzer({ name: 'Alice' });
  const zeile = await db.abfrage('SELECT * FROM nutzer WHERE name = ?', ['Alice']);
  assert.ok(zeile);
});

// GUT: prüft über die Schnittstelle
test('erzeugeNutzer macht den Nutzer abrufbar', async () => {
  const nutzer = await erzeugeNutzer({ name: 'Alice' });
  const geholt = await holeNutzer(nutzer.id);
  assert.equal(geholt.name, 'Alice');
});
```
