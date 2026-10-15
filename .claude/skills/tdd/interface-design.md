# Schnittstellen für Testbarkeit

Gute Schnittstellen machen Testen selbstverständlich:

1. **Abhängigkeiten annehmen, nicht erzeugen**

   ```js
   // Testbar
   function bearbeiteBestellung(bestellung, zahlungsgateway) {}

   // Schwer testbar
   function bearbeiteBestellung(bestellung) {
     const gateway = new StripeGateway();
   }
   ```

2. **Ergebnisse zurückgeben, keine Nebenwirkungen erzeugen**

   ```js
   // Testbar
   function berechneRabatt(korb) { return rabatt; }

   // Schwer testbar
   function wendeRabattAn(korb) {
     korb.summe -= rabatt;
   }
   ```

3. **Kleine Oberfläche**
   - Weniger Funktionen = weniger nötige Tests
   - Weniger Parameter = einfacherer Testaufbau
