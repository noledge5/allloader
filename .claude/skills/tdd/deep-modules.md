# Tiefe Module

Nach „A Philosophy of Software Design“:

**Tiefes Modul** = kleine Schnittstelle + viel Umsetzung dahinter

```
┌─────────────────────┐
│  Kleine Schnittstelle│  ← wenige Funktionen, einfache Parameter
├─────────────────────┤
│                     │
│                     │
│  Tiefe Umsetzung    │  ← knifflige Logik versteckt
│                     │
│                     │
└─────────────────────┘
```

**Flaches Modul** = große Schnittstelle + wenig Umsetzung (vermeiden)

```
┌─────────────────────────────────┐
│       Große Schnittstelle       │  ← viele Funktionen, verwickelte Parameter
├─────────────────────────────────┤
│  Dünne Umsetzung                │  ← reicht nur durch
└─────────────────────────────────┘
```

Beim Entwerfen von Schnittstellen frage:

- Kann ich die Zahl der Funktionen verringern?
- Kann ich die Parameter vereinfachen?
- Kann ich mehr Komplexität im Inneren verstecken?
