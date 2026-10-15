# Wann Attrappen (Mocks) nutzen

Eine Attrappe (Mock) ersetzt im Test einen echten Teil, etwa einen Netzdienst. Ersetze nur an **Systemgrenzen**:

- Externe Schnittstellen (Zahlung, E-Mail usw.)
- Datenbanken (manchmal; besser eine Test-Datenbank)
- Zeit und Zufall
- Dateisystem (manchmal; besser ein temporärer Ordner)

Nicht ersetzen:

- Eigene Klassen und Module
- Interne Mitspieler
- Alles, was du selbst kontrollierst

Mit `node:test` geht das ohne zusätzliche Pakete (`t.mock.method`, `t.mock.timers`).

## Für Attrappen entwerfen

An Systemgrenzen sollen Schnittstellen leicht zu ersetzen sein:

**1. Abhängigkeiten hineingeben**

Externe Teile werden übergeben, nicht innen erzeugt:

```js
// Leicht zu ersetzen
function zahleBestellung(bestellung, zahlungsclient) {
  return zahlungsclient.belaste(bestellung.summe);
}

// Schwer zu ersetzen
function zahleBestellung(bestellung) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.belaste(bestellung.summe);
}
```

**2. Lieber eine Funktion je Vorgang als einen Allzweck-Abrufer**

Lege für jeden externen Vorgang eine eigene Funktion an, statt einer einzigen mit Fallunterscheidung:

```js
// GUT: jede Funktion ist einzeln ersetzbar
const api = {
  holeNutzer: (id) => fetch(`/nutzer/${id}`),
  holeBestellungen: (nutzerId) => fetch(`/nutzer/${nutzerId}/bestellungen`),
  erzeugeBestellung: (daten) => fetch('/bestellungen', { method: 'POST', body: daten }),
};

// SCHLECHT: die Attrappe braucht innen Fallunterscheidungen
const api = {
  fetch: (endpunkt, optionen) => fetch(endpunkt, optionen),
};
```

Das bringt:

- Jede Attrappe liefert eine bestimmte Form
- Keine Fallunterscheidung im Testaufbau
- Man sieht leichter, welche Endpunkte ein Test nutzt
- Typsicherheit je Endpunkt
