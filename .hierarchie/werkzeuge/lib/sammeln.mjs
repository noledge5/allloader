// Ausgabe anderer Werkzeug-Module einsammeln (Kurzstand, Projektgedächtnis): Textzeilen von `main(argv, io)` bzw. von
// Modulen, die direkt auf stdout schreiben, und die UTS-Statuszeile (`uts --status`) des Projekts.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ermittleOrte } from './register.mjs';

const kuerze = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Ausgabe von `lauf(aus)` (und alles, was währenddessen auf stdout geschrieben wird) als nicht leere Textzeilen. */
export async function sammle(lauf) {
  const zeilen = [];
  const original = process.stdout.write;
  process.stdout.write = (text) => { zeilen.push(...String(text).split('\n')); return true; };
  try { await lauf((t) => zeilen.push(...String(t).split('\n'))); } finally { process.stdout.write = original; }
  return zeilen.filter((z) => z.trim() !== '');
}

/**
 * Erste Zeile von `uts --status` für das Projekt in `basis` (die UTS liest die Projektwurzel beim Laden aus dem
 * Arbeitsordner, daher wird kurz dorthin gewechselt). Fehler ⇒ „nicht lesbar (…)“.
 */
export async function utsStatusZeile(basis, orte = ermittleOrte()) {
  const eintrag = join(orte.installWurzel, 'werkzeuge', 'uts.mjs');
  const arbeitsordner = process.cwd();
  try {
    process.chdir(basis);
    const uts = await import(pathToFileURL(eintrag).href);
    return (await sammle(() => uts.main(['--status'])))[0] ?? 'keine Auskunft';
  } catch (fehler) {
    return `nicht lesbar (${kuerze(String(fehler?.message ?? fehler), 60)})`;
  } finally {
    process.chdir(arbeitsordner);
  }
}
