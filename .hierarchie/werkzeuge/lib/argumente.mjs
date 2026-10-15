// Einfache Argumentzerlegung für Werkzeuge: Positionsargumente, Optionen mit Wert und Schalter.

/** Fehler in der Bedienung (falsche Argumente) ⇒ Exit 2. */
export class Bedienfehler extends Error {}

/**
 * Zerlegt `argv`; `mitWert` (z. B. '--zweck') nehmen den nächsten Wert, `schalter` (z. B. '--app') nicht,
 * `mehrfach` (z. B. '--abnahme') dürfen wiederholt werden und liefern eine Liste.
 * Unbekannte Optionen und fehlende Werte ⇒ Bedienfehler. Ergebnis: { pos: [Text], opt: { zweck: Text, app: true } }
 */
export function zerlege(argv, { mitWert = [], schalter = [], mehrfach = [] } = {}) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (mitWert.includes(arg) || mehrfach.includes(arg)) {
      i++;
      if (i >= argv.length || argv[i].trim() === '' || argv[i].startsWith('--')) throw new Bedienfehler(`${arg} erwartet einen Wert.`);
      if (mehrfach.includes(arg)) opt[arg.slice(2)] = [...(opt[arg.slice(2)] ?? []), argv[i]];
      else opt[arg.slice(2)] = argv[i];
    } else if (schalter.includes(arg)) opt[arg.slice(2)] = true;
    else if (arg.startsWith('-')) throw new Bedienfehler(`Unbekannte Option: ${arg} (siehe --hilfe)`);
    else pos.push(arg);
  }
  return { pos, opt };
}
