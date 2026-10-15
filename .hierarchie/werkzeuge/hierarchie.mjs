#!/usr/bin/env node
/**
 * hierarchie – zentraler Einstieg: `hierarchie <befehl> [args]`, `hierarchie hilfe`
 *
 * Die Befehlstabelle kommt aus dem Register (Feld `cli` → `modul`), nicht aus festem Code; nur `hilfe` ist eingebaut.
 * Im hierarchie-Repo gilt `register.json`; im Projekt zusätzlich `automatisierung/register.json` (projekteigene Befehle,
 * in `hilfe` gesondert). Jeder Befehl ist ein eigenes Modul mit exportierter `main(argv)`-Funktion
 * (Exit-Code als Rückgabe) und auch direkt aufrufbar. Ein neues Werkzeug braucht hier keinen Eingriff:
 * `neues-werkzeug <name>` trägt es ins Register ein.
 */
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { istObjekt } from './lib/json.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { ermittleOrte, liesRegister } from './lib/register.mjs';

const EINGEBAUT = 'hilfe';

/** Notbehelf, wenn das eigene Register fehlt oder kaputt ist: `register pruefen` muss trotzdem erreichbar bleiben. */
const NOTBEHELF = { register: { modul: 'werkzeuge/register.mjs', kurz: 'Register prüfen und pflegen (Notbehelf, weil das Register nicht lesbar ist)' } };

/**
 * Liest die Befehlstabellen aus den Registern des Ortes (siehe `ermittleOrte`).
 * Ergebnis: { eigene, projekt, warnungen }; jede Tabelle ist { befehl → { modul, datei, kurz } }
 * (`datei`: absoluter Pfad des Moduls). Eigene Befehle gehen vor, `hilfe` ist nicht überschreibbar.
 */
export function ladeBefehle(orte) {
  const warnungen = [];
  const tabelle = (quelle, wurzel, vorhanden) => {
    const ergebnis = {};
    const gelesen = liesRegister(quelle);
    if (gelesen.fehler) { warnungen.push(gelesen.fehler); return { ergebnis, defekt: true }; }
    if (!gelesen.vorhanden) return { ergebnis, defekt: true };
    for (const w of Array.isArray(gelesen.daten.werkzeuge) ? gelesen.daten.werkzeuge : []) {
      if (!istObjekt(w) || typeof w.cli !== 'string' || typeof w.modul !== 'string') continue; // ohne cli: kein Befehl (z. B. Hooks, Apps)
      if (w.cli === EINGEBAUT || Object.hasOwn(vorhanden, w.cli) || Object.hasOwn(ergebnis, w.cli)) {
        warnungen.push(`${quelle.anzeige}: Befehl "${w.cli}" ist schon belegt und wird ignoriert`);
        continue;
      }
      ergebnis[w.cli] = { modul: w.modul, datei: join(wurzel, w.modul), kurz: typeof w.zweck === 'string' ? w.zweck : '' };
    }
    return { ergebnis, defekt: false };
  };

  const eigen = tabelle(orte.eigenes, orte.eigenes.wurzel, {});
  let eigene = eigen.ergebnis;
  if (eigen.defekt) {
    if (!warnungen.length) warnungen.push(`${orte.eigenes.anzeige} fehlt`);
    eigene = Object.fromEntries(Object.entries(NOTBEHELF).map(([name, e]) => [name, { ...e, datei: join(orte.eigenes.wurzel, e.modul) }]));
  }
  const projekt = orte.projekt ? tabelle(orte.projekt, orte.projekt.wurzel, eigene).ergebnis : {};
  return { eigene, projekt, warnungen };
}

const STANDARD = ladeBefehle(ermittleOrte());

/** befehl → { modul, datei, kurz } der hierarchie-Werkzeuge (aus dem Register). */
export const BEFEHLE = STANDARD.eigene;
/** Projekteigene Befehle (leer im hierarchie-Repo und in Projekten ohne automatisierung/register.json). */
export const PROJEKT_BEFEHLE = STANDARD.projekt;

const aufruf = () => {
  const pfad = relative(process.cwd(), fileURLToPath(import.meta.url)).split(sep).join('/');
  return `node ${pfad}`;
};

export function hilfeText(tabellen = STANDARD) {
  const { eigene, projekt, warnungen } = tabellen;
  const namen = [...Object.keys(eigene), ...Object.keys(projekt), EINGEBAUT];
  const breite = Math.max(...namen.map((name) => name.length));
  const zeile = (name, kurz) => `  ${name.padEnd(breite)}  ${kurz}`;
  const zeilen = Object.entries(eigene).map(([name, { kurz }]) => zeile(name, kurz));
  zeilen.push(zeile(EINGEBAUT, 'diese Übersicht'));
  const projektZeilen = Object.entries(projekt).map(([name, { kurz }]) => zeile(name, kurz));
  const projektBlock = projektZeilen.length ? `\n\nProjekteigene Befehle (automatisierung/register.json):\n${projektZeilen.join('\n')}` : '';
  const hinweise = warnungen.length ? `\n\nHinweis:\n${warnungen.map((w) => `  ${w}`).join('\n')}` : '';
  return `hierarchie – Werkzeugkasten für Claude Code

Aufruf: ${aufruf()} <befehl> [argumente]

${zeilen.join('\n')}${projektBlock}${hinweise}

Einzelhilfe: <befehl> --hilfe
Exit-Code: 0 ok · 1 Fehler · 2 Bedienfehler (z. B. unbekannter Befehl)`;
}

/**
 * Führt `hierarchie <befehl> …` aus (Argumente ohne `node` und Skriptpfad); liefert den Exit-Code.
 * `orte`: nur für Tests (andere Installation als die dieser Datei).
 */
export async function main(argv, io = standardEinAus(), { orte } = {}) {
  const tabellen = orte ? ladeBefehle(orte) : STANDARD;
  const [befehl, ...rest] = argv;
  if (befehl === undefined || [EINGEBAUT, '--hilfe', '--help', '-h'].includes(befehl)) {
    io.aus(hilfeText(tabellen));
    return 0;
  }
  const eintrag = [tabellen.eigene, tabellen.projekt].find((tabelle) => Object.hasOwn(tabelle, befehl))?.[befehl];
  if (!eintrag) {
    io.fehler(`hierarchie: unbekannter Befehl „${befehl}“\n\n${hilfeText(tabellen)}`);
    return 2;
  }
  if (!existsSync(eintrag.datei)) {
    io.fehler(`hierarchie: Modul für „${befehl}“ fehlt: ${eintrag.modul} (\`register pruefen\` zeigt alle Abweichungen)`);
    return 1;
  }
  const modul = await import(pathToFileURL(eintrag.datei).href);
  return (await modul.main(rest)) ?? 0;
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
