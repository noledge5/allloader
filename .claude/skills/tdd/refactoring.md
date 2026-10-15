# Umbau-Kandidaten

Nach einem TDD-Zyklus (Umbau nur bei grünen Tests; danach die Testdatei, am Ende den UTS-Vollauf laufen lassen) suche nach:

- **Doppelungen** → Funktion oder Klasse herausziehen
- **Lange Methoden** → in private Hilfsfunktionen zerlegen (Tests bleiben an der öffentlichen Schnittstelle)
- **Flache Module** → zusammenlegen oder vertiefen
- **Neid auf fremde Daten** („Feature Envy“: Logik arbeitet vor allem mit den Daten eines anderen Moduls) → Logik dorthin verlegen, wo die Daten liegen
- **Grundtyp-Besessenheit** (Zahlen und Texte statt eigener kleiner Typen) → Wertobjekte einführen
- **Vorhandener Code**, den der neue Code als problematisch zeigt
