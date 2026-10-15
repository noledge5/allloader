#!/usr/bin/env node
/**
 * UTS – Unit-Test-Suite-Runner
 *
 * UTS-Version: 1.2.0
 *
 * Eine Datei, keine Abhängigkeiten, Node >= 20, ESM. Läuft ohne Sprachmodell
 * (von Hand, Git-Hook, CI); das Ergebnis ist für Claude token-sparend lesbar.
 * Projektwurzel ist das aktuelle Arbeitsverzeichnis.
 * Spezifikation: docs/spezifikation/uts.md – Hilfe: --hilfe
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const UTS_VERSION = '1.2.0';
const WURZEL = process.cwd();
const ERGEBNISDATEI = '.uts/letzter-lauf.json';
const MAX_MELDUNG = 500;

const STANDARD_MUSTER = ['**/*.test.mjs', '**/*.test.js', '**/*.test.cjs'];
const IMMER_AUSGESCHLOSSEN = new Set(['node_modules', '.git', '.next', '.uts', 'dist', 'build', 'coverage']);

// Tatsächlicher Aufrufpfad, relativ zum aktuellen Verzeichnis und immer mit `/`
// (liegt die Datei auf einem anderen Laufwerk, bleibt es der absolute Pfad).
const AUFRUFPFAD = relative(WURZEL, fileURLToPath(import.meta.url)).split(sep).join('/');

const hilfe = () => `UTS ${UTS_VERSION} – Unit-Test-Suite ohne Sprachmodell

Aufruf: node ${AUFRUFPFAD} [optionen] [filter…]

  (keine)       alle Tests, lesbare Ausgabe
  --kurz        grün: eine Zeile; rot: nur die fehlgeschlagenen Tests
  --json        Ergebnisobjekt als JSON auf stdout, sonst nichts
  --geaendert   nur Tests, die von Änderungen gegenüber HEAD betroffen sind
  --zu <datei>  nur die Tests, die zu dieser Datei gehören (sie selbst, wenn sie ein Test ist,
                sonst Testdatei mit gleichem Basisnamen im selben Ordner oder in tests/ bzw. test/
                der Projektwurzel); keiner ⇒ Exit 0
  --status      führt nichts aus; meldet, ob das letzte Ergebnis zum Stand passt
  --hilfe       diese Hilfe
  filter…       Teilstrings; nur Testdateien, deren Pfad einen davon enthält

Exit-Code: 0 grün · 1 mindestens ein Test rot · 2 Bedienfehler oder keine Tests
Konfiguration (optional, package.json): "uts": { "muster": [], "ausschluss": [], "parallel": 4 }
Ergebnis: ${ERGEBNISDATEI}`;

class Bedienfehler extends Error {}

// ---------------------------------------------------------------- Argumente

function leseArgumente(argv) {
  const opt = { kurz: false, json: false, geaendert: false, status: false, hilfe: false, zu: null, filter: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--kurz': opt.kurz = true; break;
      case '--json': opt.json = true; break;
      case '--geaendert': opt.geaendert = true; break;
      case '--status': opt.status = true; break;
      case '--zu':
        if (opt.zu !== null) throw new Bedienfehler('--zu darf nur einmal angegeben werden.');
        i++;
        if (i >= argv.length || argv[i].startsWith('--') || argv[i] === '') {
          throw new Bedienfehler('--zu erwartet eine Datei (--zu <datei>).');
        }
        opt.zu = argv[i];
        break;
      case '--hilfe': case '--help': case '-h': opt.hilfe = true; break;
      default:
        if (arg.startsWith('-')) throw new Bedienfehler(`Unbekannte Option: ${arg} (siehe --hilfe)`);
        opt.filter.push(arg.replaceAll('\\', '/'));
    }
  }
  if (opt.kurz && opt.json) throw new Bedienfehler('--kurz und --json schließen sich aus.');
  if (opt.status && (opt.json || opt.geaendert || opt.filter.length)) {
    throw new Bedienfehler('--status lässt sich nur allein (oder mit --kurz) verwenden.');
  }
  if (opt.zu !== null && (opt.status || opt.geaendert || opt.filter.length)) {
    throw new Bedienfehler('--zu lässt sich nicht mit --status, --geaendert oder Filtern kombinieren.');
  }
  return opt;
}

function leseKonfiguration() {
  const konfig = { muster: STANDARD_MUSTER, ausschluss: [], parallel: Math.max(1, availableParallelism()) };
  const pfad = join(WURZEL, 'package.json');
  if (!existsSync(pfad)) return konfig;

  let paket;
  try {
    paket = JSON.parse(readFileSync(pfad, 'utf8').replace(/^﻿/, ''));
  } catch (fehler) {
    throw new Bedienfehler(`package.json ist kein gültiges JSON: ${fehler.message}`);
  }
  const eigene = paket?.uts;
  if (eigene === undefined) return konfig;
  if (eigene === null || typeof eigene !== 'object' || Array.isArray(eigene)) {
    throw new Bedienfehler('package.json: "uts" muss ein Objekt sein.');
  }
  for (const schluessel of ['muster', 'ausschluss']) {
    if (eigene[schluessel] === undefined) continue;
    const liste = eigene[schluessel];
    if (!Array.isArray(liste) || liste.some((eintrag) => typeof eintrag !== 'string')) {
      throw new Bedienfehler(`package.json: "uts.${schluessel}" muss eine Liste von Zeichenketten sein.`);
    }
    konfig[schluessel] = liste;
  }
  if (eigene.parallel !== undefined) {
    if (!Number.isInteger(eigene.parallel) || eigene.parallel < 1) {
      throw new Bedienfehler('package.json: "uts.parallel" muss eine ganze Zahl >= 1 sein.');
    }
    konfig.parallel = eigene.parallel;
  }
  return konfig;
}

// ---------------------------------------------------------------- Dateien

// Eigener Glob-Abgleich (`**`, `*`, `?`); fs.glob gibt es in Node 20 nicht.
function globZuRegex(muster) {
  const m = muster.replaceAll('\\', '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < m.length; i++) {
    const zeichen = m[i];
    if (zeichen === '*') {
      if (m[i + 1] === '*') {
        i++;
        if (m[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (zeichen === '?') re += '[^/]';
    else re += zeichen.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Ein Ausschlussmuster trifft auch alles unterhalb eines passenden Ordners.
function passtZuAusschluss(regexe, datei) {
  const teile = datei.split('/');
  for (let n = 1; n <= teile.length; n++) {
    const pfad = teile.slice(0, n).join('/');
    if (regexe.some((re) => re.test(pfad))) return true;
  }
  return false;
}

function git(argumente) {
  try {
    return execFileSync('git', argumente, {
      cwd: WURZEL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 30, windowsHide: true,
    });
  } catch {
    return null; // kein Git, kein Repository oder Fehler: Aufrufer fällt zurück
  }
}

const nullGetrennt = (text) => text.split('\0').filter(Boolean);
const liegtInAusgeschlossenemOrdner = (datei) => datei.split('/').slice(0, -1).some((teil) => IMMER_AUSGESCHLOSSEN.has(teil));
const vergleiche = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // bewusst nicht lokalisiert: reproduzierbar

function geheDurch(verzeichnis, ergebnis) {
  let eintraege;
  try {
    eintraege = readdirSync(join(WURZEL, verzeichnis), { withFileTypes: true });
  } catch {
    return;
  }
  for (const eintrag of eintraege) {
    const pfad = verzeichnis ? `${verzeichnis}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) {
      if (!IMMER_AUSGESCHLOSSEN.has(eintrag.name)) geheDurch(pfad, ergebnis);
    } else if (eintrag.isFile()) ergebnis.push(pfad);
  }
}

const istDatei = (datei) => {
  try { return statSync(join(WURZEL, datei)).isFile(); } catch { return false; }
};

// Alle vom Projekt erfassten Dateien (relativ, mit `/`, sortiert).
function projektDateien() {
  const ausGit = git(['ls-files', '-co', '--exclude-standard', '-z']);
  let liste;
  if (ausGit === null) {
    liste = [];
    geheDurch('', liste);
  } else {
    // Gelöschte, aber noch getrackte Dateien und Submodule stehen in der Liste, existieren aber nicht als Datei.
    liste = [...new Set(nullGetrennt(ausGit))].filter((datei) => !liegtInAusgeschlossenemOrdner(datei) && istDatei(datei));
  }
  return liste.sort(vergleiche);
}

function ermittleTests(dateien, konfig) {
  const muster = konfig.muster.map(globZuRegex);
  const ausschluss = konfig.ausschluss.map(globZuRegex);
  return dateien.filter((datei) => muster.some((re) => re.test(datei)) && !passtZuAusschluss(ausschluss, datei));
}

function fingerabdruck(dateien) {
  const hash = createHash('sha256');
  for (const datei of dateien) {
    let inhalt;
    try { inhalt = readFileSync(join(WURZEL, datei)); } catch { continue; }
    hash.update(`${datei}\0${inhalt.length}\0`);
    hash.update(inhalt);
  }
  return hash.digest('hex');
}

function aktuellerStand(dateien) {
  const kopf = git(['rev-parse', '--verify', '-q', 'HEAD']);
  return { git_head: kopf?.trim() || null, fingerabdruck: fingerabdruck(dateien) };
}

// ---------------------------------------------------------------- --geaendert

const stammDerQuelle = (datei) => datei.slice(datei.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
const stammDesTests = (datei) => datei.slice(datei.lastIndexOf('/') + 1).replace(/\.test\.[^.]+$/, '');
const ordnerVon = (datei) => datei.slice(0, Math.max(0, datei.lastIndexOf('/')));

function geaenderteDateien() {
  if (git(['rev-parse', '--git-dir']) === null) return null;
  const hatKopf = git(['rev-parse', '--verify', '-q', 'HEAD']) !== null;
  let texte;
  if (hatKopf) {
    // Ohne Umbenennungserkennung, damit alter und neuer Pfad auftauchen.
    texte = [git(['diff', '--name-only', '--no-renames', '--relative', '-z', 'HEAD']), git(['ls-files', '-o', '--exclude-standard', '-z'])];
  } else {
    texte = [git(['ls-files', '-co', '--exclude-standard', '-z'])];
  }
  if (texte.includes(null)) return null;
  return [...new Set(texte.flatMap(nullGetrennt))].filter((datei) => !liegtInAusgeschlossenemOrdner(datei));
}

// Ergebnis: { art: 'keine' | 'auswahl' | 'alle', tests, hinweis }
function waehleGeaenderte(tests) {
  const geaendert = geaenderteDateien();
  if (geaendert === null) return { art: 'alle', tests, hinweis: 'kein Git-Stand verfügbar, alle Tests' };
  if (geaendert.length === 0) return { art: 'keine', tests: [], hinweis: 'keine Änderungen gegenüber HEAD' };

  const nachNachbar = new Map();
  for (const test of tests) {
    const schluessel = `${ordnerVon(test)}\0${stammDesTests(test)}`;
    nachNachbar.set(schluessel, [...(nachNachbar.get(schluessel) ?? []), test]);
  }
  const testmenge = new Set(tests);
  const gewaehlt = new Set();
  for (const datei of geaendert) {
    if (testmenge.has(datei)) gewaehlt.add(datei);
    for (const test of nachNachbar.get(`${ordnerVon(datei)}\0${stammDerQuelle(datei)}`) ?? []) gewaehlt.add(test);
  }
  if (gewaehlt.size === 0) {
    return { art: 'alle', tests, hinweis: 'Änderungen ohne zuordenbaren Test, daher alle Tests' };
  }
  return { art: 'auswahl', tests: tests.filter((test) => gewaehlt.has(test)), hinweis: null };
}

// ---------------------------------------------------------------- --zu

// Datei relativ zur Projektwurzel mit `/`; null, wenn sie außerhalb liegt.
function relativZurWurzel(datei) {
  const rel = relative(WURZEL, resolve(WURZEL, datei.replaceAll('\\', '/'))).split(sep).join('/');
  return rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel) ? null : rel;
}

// Die Tests zu genau einer Datei: sie selbst, wenn sie ein Test ist, sonst Testdateien
// mit gleichem Basisnamen im selben Ordner (`lib/x.js` → `lib/x.test.mjs`) oder
// in `tests/` bzw. `test/` der Projektwurzel (`lib/x.js` → `tests/x.test.mjs`).
function waehleZu(tests, datei) {
  const rel = relativZurWurzel(datei);
  if (rel === null) return [];
  if (tests.includes(rel)) return [rel];
  const ordner = [ordnerVon(rel), 'tests', 'test'];
  return tests.filter((test) => ordner.includes(ordnerVon(test)) && stammDesTests(test) === stammDerQuelle(rel));
}

// ---------------------------------------------------------------- Ausführen

const ANSI = /\u001b\[[0-9;]*m/g;

function bereinigeZeilen(text) {
  return String(text).replace(ANSI, '').split(/\r?\n/)
    .map((zeile) => zeile.trimEnd())
    .filter((zeile) => zeile.trim() !== '' && !/^\s+at\s/.test(zeile));
}

const kuerze = (text) => (text.length > MAX_MELDUNG ? `${text.slice(0, MAX_MELDUNG - 1)}…` : text);

function fehlerText(fehler) {
  const ursache = fehler?.cause ?? fehler;
  if (typeof ursache === 'string') return ursache;
  return ursache?.message ?? String(ursache ?? '');
}

// Ein Skript, das einfach abbricht, hat nur Stderr: daraus die aussagekräftige Fehlerstelle ziehen.
function meldungAusStderr(zeilen) {
  const sauber = bereinigeZeilen(zeilen.join('\n'))
    .filter((zeile) => !/^Node\.js v\d/.test(zeile) && !/^\s*[\^{}]+\s*$/.test(zeile));
  const start = sauber.findIndex((zeile) => /^\w*Error\b/.test(zeile));
  const relevant = start >= 0 ? sauber.slice(start) : sauber;
  return relevant.length ? relevant.join('\n') : 'Datei endete mit Fehler (Exit-Code ≠ 0), ohne Fehlerausgabe';
}

// Die Ereignisse treffen je Datei nachgeordnet ein (Kinder vor ihrem Elternteil). Ein Ereignis,
// vor dem tiefer verschachtelte standen, ist ein Container (Suite oder Test mit Untertests).
// Gezählt werden nur Blätter; Container liefern den Namenspfad.
function verbucheEreignis(zustand, ereignis) {
  const daten = ereignis.data;
  const kinder = [];
  while (zustand.stapel.length && zustand.stapel.at(-1).tiefe > daten.nesting) kinder.push(zustand.stapel.pop());
  const rot = ereignis.type === 'test:fail';
  const fehlerart = daten.details?.error?.failureType;
  const neuesBlatt = () => {
    const blatt = { namen: [daten.name], status: 'bestanden', meldung: null, dateiebene: false };
    if (daten.skip) blatt.status = 'uebersprungen';
    else if (rot) {
      blatt.status = daten.todo ? 'uebersprungen' : 'fehlgeschlagen';
      blatt.meldung = fehlerText(daten.details?.error);
      blatt.dateiebene = daten.nesting === 0 && (daten.name === daten.file || daten.name === zustand.absolut);
      if (blatt.dateiebene) blatt.namen = [];
    }
    zustand.tests.push(blatt);
    return blatt;
  };

  const eintrag = { tiefe: daten.nesting, blaetter: [] };
  const istContainer = kinder.length > 0 || daten.details?.type === 'suite';
  if (istContainer) {
    for (const kind of kinder.reverse()) {
      for (const blatt of kind.blaetter) blatt.namen.unshift(daten.name);
      eintrag.blaetter.push(...kind.blaetter);
    }
    // Scheitert der Container selbst (z. B. Hook), nicht nur seine Untertests, zählt das als eigener Fehler.
    if (rot && fehlerart !== 'subtestsFailed') eintrag.blaetter.push(neuesBlatt());
  } else {
    eintrag.blaetter.push(neuesBlatt());
  }
  zustand.stapel.push(eintrag);
}

async function fuehreAus(dateien, parallel) {
  // Läuft UTS selbst unter `node --test`, würde das geerbte NODE_TEST_CONTEXT run() stören.
  delete process.env.NODE_TEST_CONTEXT;
  const { run } = await import('node:test');

  const zustaende = new Map();
  const absolut = new Map();
  for (const datei of dateien) {
    const pfad = resolve(WURZEL, datei);
    absolut.set(pfad, datei);
    zustaende.set(datei, { absolut: pfad, stapel: [], tests: [], stderr: [] });
  }
  const zuDatei = (pfad) => absolut.get(pfad) ?? (pfad ? relative(WURZEL, pfad).split(sep).join('/') : null);

  const strom = run({ files: [...absolut.keys()], concurrency: parallel });
  for await (const ereignis of strom) {
    if (!['test:pass', 'test:fail', 'test:stderr'].includes(ereignis.type)) continue;
    const zustand = zustaende.get(zuDatei(ereignis.data.file));
    if (!zustand) continue;
    if (ereignis.type === 'test:stderr') {
      zustand.stderr.push(...ereignis.data.message.split(/\r?\n/));
      if (zustand.stderr.length > 200) zustand.stderr.splice(0, zustand.stderr.length - 200);
    } else verbucheEreignis(zustand, ereignis);
  }

  return dateien.map((datei) => {
    const { tests, stderr } = zustaende.get(datei);
    for (const test of tests) {
      // Auf Dateiebene sagt Node nur „test failed“; die eigentliche Ursache steht auf Stderr.
      if (test.dateiebene && test.status === 'fehlgeschlagen') test.meldung = meldungAusStderr(stderr);
      test.name = test.namen.join(' › ') || '(ganze Datei)';
      test.meldung = test.meldung === null ? null : kuerze(bereinigeZeilen(test.meldung).join('\n'));
    }
    return { datei, tests };
  });
}

// ---------------------------------------------------------------- Ausgabe

const mehrzahl = (n, einzahl, plural) => `${n} ${n === 1 ? einzahl : plural}`;
const sekunden = (ms) => (ms / 1000).toFixed(1);

function zusammenfassung(erg) {
  const zeit = `${sekunden(erg.dauer_ms)} s`;
  const dateien = mehrzahl(erg.dateien.length, 'Datei', 'Dateien');
  if (erg.fehlgeschlagen === 0) {
    const uebersprungen = erg.uebersprungen ? ` (${erg.uebersprungen} übersprungen)` : '';
    return `UTS grün: ${mehrzahl(erg.gesamt, 'Test', 'Tests')}${uebersprungen} in ${dateien}, ${zeit}`;
  }
  return `UTS rot: ${erg.fehlgeschlagen} von ${mehrzahl(erg.gesamt, 'Test', 'Tests')} fehlgeschlagen in ${dateien}, ${zeit}`;
}

const einruecken = (zeilen, tiefe) => zeilen.map((zeile) => `${' '.repeat(tiefe)}${zeile}`);

function druckeKurz(erg, ergebnisse, hinweis) {
  const zeilen = [];
  for (const { datei, tests } of ergebnisse) {
    for (const test of tests.filter((t) => t.status === 'fehlgeschlagen')) {
      zeilen.push(`✗ ${datei} › ${test.name}`);
      // Höchstens 5 Zeilen je Fehler: Kopfzeile plus 4 Zeilen Meldung.
      zeilen.push(...einruecken(bereinigeZeilen(test.meldung).slice(0, 4), 2));
    }
  }
  zeilen.push(zusammenfassung(erg) + (hinweis ? ` (Hinweis: ${hinweis})` : ''));
  schreibe(zeilen.join('\n'));
}

function druckeAusfuehrlich(erg, ergebnisse, hinweis) {
  const zeilen = [];
  if (hinweis) zeilen.push(`Hinweis: ${hinweis}`);
  for (const { datei, tests } of ergebnisse) {
    const rote = tests.filter((t) => t.status === 'fehlgeschlagen');
    zeilen.push(rote.length
      ? `✗ ${datei} (${rote.length} von ${mehrzahl(tests.length, 'Test', 'Tests')} fehlgeschlagen)`
      : `✓ ${datei} (${mehrzahl(tests.length, 'Test', 'Tests')})`);
    for (const test of rote) {
      zeilen.push(`    ✗ ${test.name}`);
      zeilen.push(...einruecken(bereinigeZeilen(test.meldung).slice(0, 8), 8));
    }
  }
  zeilen.push('', zusammenfassung(erg));
  schreibe(zeilen.join('\n'));
}

const schreibe = (text) => process.stdout.write(`${text}\n`);

// ---------------------------------------------------------------- Ergebnis

function baueErgebnis({ start, modus, dateien, ergebnisse, stand }) {
  const alle = ergebnisse.flatMap(({ datei, tests }) => tests.map((test) => ({ datei, ...test })));
  const zaehle = (status) => alle.filter((test) => test.status === status).length;
  return {
    uts_version: UTS_VERSION,
    zeit: new Date().toISOString(),
    dauer_ms: Date.now() - start,
    node: process.version,
    modus,
    dateien,
    gesamt: alle.length,
    bestanden: zaehle('bestanden'),
    fehlgeschlagen: zaehle('fehlgeschlagen'),
    uebersprungen: zaehle('uebersprungen'),
    fehler: alle.filter((test) => test.status === 'fehlgeschlagen')
      .map((test) => ({ datei: test.datei, test: test.name, meldung: test.meldung })),
    stand,
  };
}

function schreibeErgebnisdatei(ergebnis) {
  try {
    const pfad = join(WURZEL, ERGEBNISDATEI);
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, `${JSON.stringify(ergebnis, null, 2)}\n`);
  } catch (fehler) {
    process.stderr.write(`UTS: Ergebnisdatei konnte nicht geschrieben werden: ${fehler.message}\n`);
  }
}

// ---------------------------------------------------------------- --status

function zeigeStatus(dateien) {
  let letzter;
  try {
    letzter = JSON.parse(readFileSync(join(WURZEL, ERGEBNISDATEI), 'utf8'));
  } catch (fehler) {
    if (fehler.code === 'ENOENT') { schreibe('UTS: noch kein Lauf'); return 1; }
    schreibe('UTS veraltet: Ergebnisdatei unlesbar, bitte neu laufen lassen');
    return 1;
  }
  const farbe = letzter.fehlgeschlagen === 0 ? 'grün' : 'rot';
  const teillauf = letzter.modus && letzter.modus !== 'alle' ? `, nur ${letzter.modus}` : '';
  if (letzter.stand?.fingerabdruck !== fingerabdruck(dateien)) {
    schreibe(`UTS veraltet: Dateien seit dem Lauf geändert (letzter Lauf ${letzter.zeit}: ${farbe}${teillauf})`);
    return 1;
  }
  const tests = mehrzahl(letzter.gesamt, 'Test', 'Tests');
  // Ein Teillauf ist nie eine Gesamtprüfung: Exit 0 gibt es nur für einen aktuellen, grünen Vollauf.
  if (letzter.modus && letzter.modus !== 'alle') {
    const befund = letzter.fehlgeschlagen === 0 ? 'grün' : `rot (${letzter.fehlgeschlagen} von ${tests} fehlgeschlagen)`;
    schreibe(`UTS Teillauf (${letzter.modus}): ${befund} – kein Vollauf, für die Abnahme \`node ${AUFRUFPFAD}\` ausführen`);
    return 1;
  }
  if (letzter.fehlgeschlagen === 0) {
    schreibe(`UTS aktuell: grün (${tests}, ${sekunden(letzter.dauer_ms)} s, Lauf ${letzter.zeit})`);
    return 0;
  }
  schreibe(`UTS aktuell: rot (${letzter.fehlgeschlagen} von ${tests} fehlgeschlagen, Lauf ${letzter.zeit})`);
  return 1;
}

// ---------------------------------------------------------------- Hauptablauf

async function laufe(argv) {
  const start = Date.now();
  const opt = leseArgumente(argv);
  if (opt.hilfe) { schreibe(hilfe()); return 0; }

  const konfig = leseKonfiguration();
  const dateien = projektDateien();
  if (opt.status) return zeigeStatus(dateien);

  let tests = ermittleTests(dateien, konfig);
  if (opt.zu !== null) {
    tests = waehleZu(tests, opt.zu);
    if (tests.length === 0) {
      // Kein Lauf: die Ergebnisdatei eines früheren Laufs bleibt unangetastet. Auch ein Projekt ganz
      // ohne Tests ist hier kein Fehler (ein Hook nach jeder Änderung darf nicht scheitern).
      const genannt = relativZurWurzel(opt.zu) ?? opt.zu;
      if (opt.json) {
        const leer = baueErgebnis({ start, modus: 'zu', dateien: [], ergebnisse: [], stand: aktuellerStand(dateien) });
        schreibe(JSON.stringify(leer, null, 2));
      } else schreibe(`UTS: kein Test zu ${genannt}`);
      return 0;
    }
  } else if (tests.length === 0) {
    throw new Bedienfehler(`Keine Tests gefunden (Muster: ${konfig.muster.join(', ')}).`);
  }
  if (opt.filter.length) {
    tests = tests.filter((test) => opt.filter.some((filter) => test.includes(filter)));
    if (tests.length === 0) throw new Bedienfehler(`Kein Test passt zum Filter: ${opt.filter.join(', ')}.`);
  }

  const stand = aktuellerStand(dateien); // vor dem Lauf: das Ergebnis gilt für genau diesen Stand
  let modus = opt.zu !== null ? 'zu' : opt.filter.length ? 'gefiltert' : 'alle';
  let hinweis = null;
  if (opt.geaendert) {
    const auswahl = waehleGeaenderte(tests);
    if (auswahl.art === 'auswahl') modus = 'geaendert';
    if (auswahl.art === 'keine') {
      const leer = baueErgebnis({ start, modus: 'geaendert', dateien: [], ergebnisse: [], stand });
      if (opt.json) schreibe(JSON.stringify(leer, null, 2));
      else schreibe(`UTS: ${auswahl.hinweis}, nichts zu testen.`);
      return 0; // kein Lauf: die Ergebnisdatei eines früheren Laufs bleibt unangetastet
    }
    tests = auswahl.tests;
    hinweis = auswahl.hinweis;
  }

  const ergebnisse = await fuehreAus(tests, konfig.parallel);
  const ergebnis = baueErgebnis({ start, modus, dateien: tests, ergebnisse, stand });
  schreibeErgebnisdatei(ergebnis);

  if (opt.json) schreibe(JSON.stringify(ergebnis, null, 2));
  else if (opt.kurz) druckeKurz(ergebnis, ergebnisse, hinweis);
  else druckeAusfuehrlich(ergebnis, ergebnisse, hinweis);
  return ergebnis.fehlgeschlagen === 0 ? 0 : 1;
}

/**
 * Führt die UTS aus (Argumente ohne `node` und Skriptpfad) und liefert den Exit-Code.
 * Bedien- und interne Fehler werden auf stderr gemeldet (Exit 2).
 */
export async function main(argv = process.argv.slice(2)) {
  try {
    return await laufe(argv);
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) process.stderr.write(`UTS: ${fehler.message}\n`);
    else process.stderr.write(`UTS: interner Fehler: ${fehler?.stack ?? fehler}\n`);
    return 2;
  }
}

const alsSkriptGestartet = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (alsSkriptGestartet) process.exitCode = await main();
