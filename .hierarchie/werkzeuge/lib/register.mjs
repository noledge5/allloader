// Register der Werkzeuge (register.json): Orte, Lesen, Schreiben und Schema.
// Spezifikation: docs/spezifikation/werkzeuge.md (Abschnitte „Ablageorte“ und „Register“).
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leseOderNull } from './dateien.mjs';
import { erkenneFormat, formatiereJson, istObjekt, parseJson } from './json.mjs';

/** Wurzel der Installation: das hierarchie-Repo oder der Ordner `.hierarchie` eines Projekts (Elternordner von `werkzeuge/`). */
export const INSTALL_WURZEL = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Name eines Werkzeugs, Befehls oder Kandidaten (darf nicht mit `-` beginnen, sonst sähe er wie eine Option aus). */
export const NAME_MUSTER = /^[a-z0-9][a-z0-9-]*$/;

/** Marke in einer Testdatei: solange sie dort steht, ist die Datei noch ein Gerüst und der Teststatus bleibt „ungetestet“. */
export const GERUEST_MARKE = 'GERUEST-OFFEN';

export const TESTSTATUS = ['gruen', 'rot', 'ungetestet'];
export const MODELL_NOETIG = ['nein', 'teilweise', 'ja'];
export const ENTSCHEIDUNGEN = ['offen', 'bauen', 'verworfen'];

export const leeresRegister = () => ({ version: 1, werkzeuge: [], kandidaten: [] });

/**
 * Orte der Register.
 * `repo`: Installation im hierarchie-Repo (Register: `register.json` in der Wurzel).
 * `projekt`: Installation als `.hierarchie/` in einem Projekt (Register: `.hierarchie/register.json` als Kopie,
 * dazu das beschreibbare `automatisierung/register.json` des Projekts).
 * `module` im eigenen Register gelten relativ zur Installationswurzel, im Projektregister relativ zum Projekt.
 */
export function ermittleOrte(installWurzel = INSTALL_WURZEL) {
  const projektModus = basename(installWurzel) === '.hierarchie';
  const projektWurzel = projektModus ? dirname(installWurzel) : null;
  const eigenes = {
    pfad: join(installWurzel, 'register.json'),
    wurzel: installWurzel,
    anzeige: projektModus ? '.hierarchie/register.json' : 'register.json',
  };
  const projekt = projektWurzel
    ? { pfad: join(projektWurzel, 'automatisierung', 'register.json'), wurzel: projektWurzel, anzeige: 'automatisierung/register.json' }
    : null;
  return {
    modus: projektModus ? 'projekt' : 'repo',
    installWurzel,
    projektWurzel,
    eigenes,
    projekt,
    /** Das Register, in das Schreibbefehle (Kandidaten, neue Werkzeuge, Teststatus) schreiben. */
    schreib: projekt ?? eigenes,
    /** Ort der UTS-Ergebnisse und Basis für Pfade der Testdateien. */
    projektBasis: projektWurzel ?? installWurzel,
  };
}

/** Liest ein Register. Ergebnis: { quelle, vorhanden, daten, text, fehler? }; fehlende Datei ⇒ leeres Register. */
export function liesRegister(quelle) {
  const roh = leseOderNull(quelle.pfad);
  if (roh === null) return { quelle, vorhanden: false, daten: leeresRegister(), text: null };
  const text = roh.toString('utf8');
  try {
    return { quelle, vorhanden: true, daten: parseJson(text, quelle.anzeige), text };
  } catch (fehler) {
    return { quelle, vorhanden: true, daten: null, text, fehler: fehler.message };
  }
}

/** Schreibt das Register im Format der vorhandenen Datei (Einzug, Zeilenenden); legt Ordner an. */
export function schreibeRegister(gelesen, daten) {
  mkdirSync(dirname(gelesen.quelle.pfad), { recursive: true });
  writeFileSync(gelesen.quelle.pfad, formatiereJson(daten, gelesen.text === null ? {} : erkenneFormat(gelesen.text)));
}

// ---------------------------------------------------------------- Schema

const istText = (wert) => typeof wert === 'string' && wert.trim() !== '';
const istTextListe = (wert) => Array.isArray(wert) && wert.every(istText);

function pruefeWerkzeug(w, i) {
  if (!istObjekt(w)) return [`werkzeuge[${i}] ist kein Objekt`];
  const marke = istText(w.name) ? w.name : `werkzeuge[${i}]`;
  const befunde = [];
  const fehler = (text) => befunde.push(`${marke}: ${text}`);

  if (!istText(w.name) || !NAME_MUSTER.test(w.name)) fehler('name fehlt oder entspricht nicht [a-z0-9-]+');
  if (w.cli !== undefined && (!istText(w.cli) || !NAME_MUSTER.test(w.cli))) fehler('cli muss ein Name [a-z0-9-]+ sein (oder fehlen)');
  for (const feld of ['modul', 'zweck', 'eingabe', 'ausgabe', 'befehl']) if (!istText(w[feld])) fehler(`${feld} fehlt (Text erwartet)`);
  for (const feld of ['dateien', 'voraussetzungen', 'tests', 'grenzen']) {
    if (!istTextListe(w[feld])) fehler(`${feld} muss eine Liste nicht leerer Texte sein`);
  }
  if (!TESTSTATUS.includes(w.teststatus)) fehler(`teststatus muss ${TESTSTATUS.join('|')} sein`);
  if (!MODELL_NOETIG.includes(w.modell_noetig)) fehler(`modell_noetig muss ${MODELL_NOETIG.join('|')} sein`);

  const h = w.haeufigkeit;
  if (!istObjekt(h) || typeof h.belegt !== 'boolean' || !(istText(h.wert) || Number.isFinite(h.wert))
    || !(h.quelle === null || istText(h.quelle))) {
    fehler('haeufigkeit muss {wert, belegt: true|false, quelle: Text|null} sein');
  } else if (!h.belegt && h.wert !== 'vermutet') {
    fehler('haeufigkeit: ohne Beleg muss wert "vermutet" sein (keine erfundenen Häufigkeiten)');
  } else if (h.belegt && !istText(h.quelle)) {
    fehler('haeufigkeit: belegt: true braucht eine quelle');
  }

  const z = w.zeitersparnis;
  if (z !== null && !(istObjekt(z) && Number.isFinite(z.schaetzung) && istText(z.einheit))) {
    fehler('zeitersparnis muss null oder {schaetzung: Zahl, einheit: Text} sein');
  }
  return befunde;
}

function pruefeKandidat(k, i) {
  if (!istObjekt(k)) return [`kandidaten[${i}] ist kein Objekt`];
  const marke = istText(k.name) ? `Kandidat ${k.name}` : `kandidaten[${i}]`;
  const befunde = [];
  const fehler = (text) => befunde.push(`${marke}: ${text}`);
  if (!istText(k.name) || !NAME_MUSTER.test(k.name)) fehler('name fehlt oder entspricht nicht [a-z0-9-]+');
  if (!istText(k.ablauf)) fehler('ablauf fehlt (Text erwartet)');
  if (typeof k.belegt !== 'boolean') fehler('belegt muss true oder false sein');
  if (!(k.quelle === null || istText(k.quelle))) fehler('quelle muss Text oder null sein');
  else if (k.belegt === true && !istText(k.quelle)) fehler('belegt: true braucht eine quelle');
  if (!ENTSCHEIDUNGEN.includes(k.entscheidung)) fehler(`entscheidung muss ${ENTSCHEIDUNGEN.join('|')} sein`);
  else if (k.entscheidung !== 'offen' && !istText(k.begruendung)) fehler('entschiedener Kandidat braucht eine begruendung');
  return befunde;
}

/** Schemaverstöße eines gelesenen Registers als Liste von Texten (leer = in Ordnung). */
export function pruefeSchema(daten) {
  if (!istObjekt(daten)) return ['Wurzel muss ein Objekt sein'];
  const befunde = [];
  if (daten.version !== 1) befunde.push('version muss 1 sein');
  if (Array.isArray(daten.werkzeuge)) daten.werkzeuge.forEach((w, i) => befunde.push(...pruefeWerkzeug(w, i)));
  else befunde.push('werkzeuge muss eine Liste sein');
  if (Array.isArray(daten.kandidaten)) daten.kandidaten.forEach((k, i) => befunde.push(...pruefeKandidat(k, i)));
  else befunde.push('kandidaten muss eine Liste sein');
  return befunde;
}
