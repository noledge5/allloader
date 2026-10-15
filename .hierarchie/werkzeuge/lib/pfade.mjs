// Plattformneutrale Pfadarithmetik für Hook-Eingaben (Windows-Pfade mit `\` auch auf Linux/macOS auswertbar)
// und Vergleich echter Orte im Dateisystem (`echterPfad`, `gleicherOrt`, `relativUnter`).
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const LAUFWERK = /^[a-zA-Z]:\//;

/** Rückwärtsschrägstriche → `/`, `.` und `..` aufgelöst, ohne abschließenden `/` (außer Wurzel). */
export function normalisiere(pfad) {
  const text = String(pfad).replaceAll('\\', '/');
  const laufwerk = text.match(/^[a-zA-Z]:(?=\/|$)/)?.[0] ?? '';
  const rest = text.slice(laufwerk.length);
  const absolut = rest.startsWith('/');
  const teile = [];
  for (const teil of rest.split('/')) {
    if (teil === '' || teil === '.') continue;
    if (teil === '..') { if (teile.length && teile.at(-1) !== '..') teile.pop(); else if (!absolut) teile.push('..'); continue; }
    teile.push(teil);
  }
  return `${laufwerk}${absolut ? '/' : ''}${teile.join('/')}` || '.';
}

const istAbsolut = (pfad) => pfad.startsWith('/') || LAUFWERK.test(pfad);

/**
 * `datei` relativ zum `projekt` (mit `/`) oder null, wenn sie außerhalb liegt.
 * Relative Dateipfade werden gegen `cwd` (sonst `projekt`) aufgelöst. Bei Laufwerksbuchstaben
 * wird ohne Beachtung der Groß-/Kleinschreibung verglichen (Windows).
 */
export function relativZumProjekt(datei, projekt, cwd = projekt) {
  const wurzel = normalisiere(projekt);
  let ziel = normalisiere(datei);
  if (!istAbsolut(ziel)) ziel = normalisiere(`${istAbsolut(normalisiere(cwd)) ? normalisiere(cwd) : wurzel}/${ziel}`);
  const ohneGrossKlein = LAUFWERK.test(wurzel) || LAUFWERK.test(ziel);
  const vergleich = (text) => (ohneGrossKlein ? text.toLowerCase() : text);
  const vorsatz = wurzel.endsWith('/') ? wurzel : `${wurzel}/`;
  if (!vergleich(ziel).startsWith(vergleich(vorsatz)) || ziel.length === vorsatz.length) return null;
  return ziel.slice(vorsatz.length);
}

// ---------------------------------------------------------------- echte Orte im Dateisystem

const WINDOWS = () => process.platform === 'win32';
// `\` ist nur unter Windows ein Trenner (unter POSIX ein erlaubtes Namenszeichen).
const mitSchraegstrich = (text) => (WINDOWS() ? text.replaceAll('\\', '/') : text);

/** Ohne abschließenden `/` (außer Wurzel `/` oder `C:/`). */
const ohneSchluss = (text) => (/^(?:[a-zA-Z]:)?\/$/.test(text) ? text : text.replace(/\/+$/, ''));

/**
 * Der tatsächliche Ort von `pfad` als absoluter Pfad mit `/`: Symlinks, `..`, Windows-Kurznamen (RUNNER~1) und die
 * Schreibweise des Dateisystems sind aufgelöst (`fs.realpathSync.native`). Existiert der Pfad nicht, wird der nächste
 * vorhandene übergeordnete Ordner aufgelöst und der Rest angehängt. Die Groß-/Kleinschreibung bleibt erhalten.
 */
export function echterPfad(pfad) {
  const absolut = resolve(String(pfad));
  const rest = [];
  let aktuell = absolut;
  for (;;) {
    try {
      const echt = mitSchraegstrich(realpathSync.native(aktuell));
      return rest.length ? `${echt.replace(/\/+$/, '')}/${rest.reverse().join('/')}` : ohneSchluss(echt);
    } catch {
      const oben = dirname(aktuell);
      if (oben === aktuell) return ohneSchluss(mitSchraegstrich(absolut));
      rest.push(basename(aktuell));
      aktuell = oben;
    }
  }
}

/** Vergleichsform eines Ortes: `echterPfad`, unter Windows zusätzlich ohne Beachtung der Groß-/Kleinschreibung. */
export function kanonisch(pfad) {
  const text = echterPfad(pfad);
  return WINDOWS() ? text.toLowerCase() : text;
}

/** Ob zwei Pfade denselben Ort im Dateisystem meinen (Symlink, Kurz-/Langname, `..`, `\` vs. `/`, Schluss-`/`). */
export const gleicherOrt = (a, b) => kanonisch(a) === kanonisch(b);

/**
 * `pfad` relativ zu `wurzel` (mit `/`, in der echten Schreibweise von `pfad`); '' bei gleichem Ort,
 * null, wenn `pfad` nicht unterhalb von `wurzel` liegt.
 */
export function relativUnter(pfad, wurzel) {
  const ziel = echterPfad(pfad);
  const basis = echterPfad(wurzel);
  const falte = (text) => (WINDOWS() ? text.toLowerCase() : text);
  if (falte(ziel) === falte(basis)) return '';
  const vorsatz = basis.endsWith('/') ? basis : `${basis}/`;
  return falte(ziel).startsWith(falte(vorsatz)) ? ziel.slice(vorsatz.length) : null;
}
