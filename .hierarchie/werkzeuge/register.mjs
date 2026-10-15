#!/usr/bin/env node
/**
 * hierarchie register – Register der Werkzeuge anzeigen, prüfen und pflegen.
 *
 *   register                                 Liste (Name · Befehl · Teststatus · Modell nötig), danach offene Kandidaten
 *   register pruefen                         Schema, Module, Testdateien, doppelte Namen, Teststatus gegen den letzten Vollauf
 *   register aktualisieren                   schreibt den Teststatus aus dem letzten Vollauf (nur wenn der Lauf aktuell ist)
 *   register kandidat <name> --ablauf "…"    Kandidat für ein künftiges Werkzeug anlegen
 *   register entscheide <name> bauen|verworfen --begruendung "…"
 *
 * Schreibt nur `aktualisieren`, `kandidat` und `entscheide` (genau dafür sind sie da) und nur in das Register
 * des Projekts (`automatisierung/register.json`) bzw. im hierarchie-Repo in `register.json`.
 * Spezifikation: docs/spezifikation/werkzeuge.md
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { leseOderNull } from './lib/dateien.mjs';
import { istObjekt, parseJson } from './lib/json.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import {
  ENTSCHEIDUNGEN, GERUEST_MARKE, NAME_MUSTER, ermittleOrte, liesRegister, pruefeSchema, schreibeRegister,
} from './lib/register.mjs';

const HILFE = `Aufruf: hierarchie register [--json]
       hierarchie register pruefen [--json]
       hierarchie register aktualisieren
       hierarchie register kandidat <name> --ablauf "…" [--belegt --quelle "…"]
       hierarchie register entscheide <name> bauen|verworfen --begruendung "…"

  (ohne Unterbefehl)  Liste: Name · Befehl · Teststatus · Modell nötig, danach offene Kandidaten
  pruefen             Exit 1 bei Befund: Schema verletzt · Modul, Datei oder Testdatei fehlt · Name doppelt ·
                      Teststatus widerspricht dem letzten Vollauf in .uts/letzter-lauf.json
                      (kein Vollauf ⇒ nur ein Hinweis, kein Befund)
  aktualisieren       schreibt teststatus aus dem letzten Vollauf; ist der Lauf nicht aktuell (oder kein Vollauf),
                      Exit 1 mit Hinweis, zuerst \`uts\` auszuführen
  kandidat            legt einen Kandidaten an (entscheidung "offen"); --belegt verlangt --quelle
  entscheide          bauen oder verworfen, --begruendung ist Pflicht

Schreibende Befehle: aktualisieren, kandidat, entscheide – im Projekt in automatisierung/register.json,
im hierarchie-Repo in register.json. Das Register der hierarchie-Werkzeuge im Projekt (.hierarchie/register.json) ist eine
Kopie und wird nie verändert.
Exit-Code: 0 ok · 1 Befund/Fehler im Inhalt · 2 Bedienfehler`;

const nurPosition = (pos, anzahl, form) => {
  if (pos.length !== anzahl) throw new Bedienfehler(`Erwartet: ${form}`);
};

// ---------------------------------------------------------------- Lauf und Teststatus

/** Ergebnis des letzten UTS-Laufs: { lauf } oder { grund }. */
export function liesLauf(basis) {
  const roh = leseOderNull(join(basis, '.uts', 'letzter-lauf.json'));
  if (roh === null) return { grund: 'noch kein UTS-Lauf (.uts/letzter-lauf.json fehlt)' };
  try {
    const lauf = parseJson(roh.toString('utf8'), '.uts/letzter-lauf.json');
    if (!istObjekt(lauf) || !Array.isArray(lauf.dateien) || !Array.isArray(lauf.fehler)) return { grund: '.uts/letzter-lauf.json hat ein unerwartetes Format' };
    return { lauf };
  } catch (fehler) {
    return { grund: fehler.message };
  }
}

/** Nur ein Lauf über alle Tests (modus "alle") zählt. */
export const istVollauf = (lauf) => lauf?.modus === 'alle';

/**
 * Teststatus eines Eintrags laut Lauf: `rot`, wenn eine seiner Testdateien in `fehler` steht; `gruen`, wenn alle
 * Testdateien mitgelaufen sind und keine mehr die Gerüst-Marke trägt; sonst `ungetestet` (keine Tests, Test nicht
 * mitgelaufen oder nur ein Gerüst-Test).
 */
export function berechneTeststatus(eintrag, lauf, wurzel) {
  const tests = Array.isArray(eintrag.tests) ? eintrag.tests : [];
  if (tests.length === 0) return 'ungetestet';
  if (tests.some((test) => lauf.fehler.some((fehler) => fehler.datei === test))) return 'rot';
  if (!tests.every((test) => lauf.dateien.includes(test))) return 'ungetestet';
  const istGeruest = (test) => leseOderNull(join(wurzel, test))?.toString('utf8').includes(GERUEST_MARKE) ?? false;
  return tests.some(istGeruest) ? 'ungetestet' : 'gruen';
}

/** Passt das Ergebnis der UTS zum aktuellen Stand der Dateien? (Fragt `uts --status`, rechnet den Fingerabdruck nicht nach.) */
function laufIstAktuell(orte) {
  const uts = join(orte.installWurzel, 'werkzeuge', 'uts.mjs');
  if (!existsSync(uts)) return { aktuell: false, meldung: `UTS fehlt: ${uts}` };
  const lauf = spawnSync(process.execPath, [uts, '--status'], {
    cwd: orte.projektBasis, encoding: 'utf8', windowsHide: true, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const meldung = (lauf.stdout || lauf.stderr || '').trim().split('\n')[0] ?? '';
  return { aktuell: /^UTS aktuell:/.test(meldung), meldung };
}

// ---------------------------------------------------------------- Prüfung

/**
 * Prüft ein gelesenes Register. `wurzel`: Basis für `modul`, `dateien` und `tests`.
 * `vollstaendig` false (Kopie der hierarchie-Werkzeuge im Projekt): nur Schema, Namen und Module –
 * Dateien und Tests liegen dort nicht mit.
 * `lauf`: Ergebnis von `liesLauf` (nur ein Vollauf wird gegen den Teststatus gehalten).
 * `fremd`: { namen, cli } des anderen Registers (Doppelungen über beide Register).
 * Ergebnis: { befunde: [Text], hinweise: [Text] }
 */
export function pruefeRegister(daten, { wurzel, vollstaendig = true, lauf = null, fremd = { namen: new Set(), cli: new Set() } }) {
  const befunde = pruefeSchema(daten);
  const hinweise = [];
  if (!istObjekt(daten)) return { befunde, hinweise };

  const werkzeuge = (Array.isArray(daten.werkzeuge) ? daten.werkzeuge : []).filter((w) => istObjekt(w) && typeof w.name === 'string');
  const gesehen = { namen: new Set(), cli: new Set() };
  for (const w of werkzeuge) {
    if (gesehen.namen.has(w.name) || fremd.namen.has(w.name)) befunde.push(`${w.name}: Name doppelt`);
    gesehen.namen.add(w.name);
    if (typeof w.cli === 'string') {
      if (gesehen.cli.has(w.cli) || fremd.cli.has(w.cli)) befunde.push(`${w.name}: Befehl "${w.cli}" doppelt`);
      gesehen.cli.add(w.cli);
    }
    if (typeof w.modul === 'string' && !existsSync(join(wurzel, w.modul))) befunde.push(`${w.name}: Modul ${w.modul} fehlt`);
    if (!vollstaendig) continue;
    for (const datei of Array.isArray(w.dateien) ? w.dateien : []) {
      if (typeof datei === 'string' && !existsSync(join(wurzel, datei))) befunde.push(`${w.name}: Datei ${datei} fehlt`);
    }
    for (const test of Array.isArray(w.tests) ? w.tests : []) {
      if (typeof test === 'string' && !existsSync(join(wurzel, test))) befunde.push(`${w.name}: Testdatei ${test} fehlt`);
    }
  }
  const kandidaten = (Array.isArray(daten.kandidaten) ? daten.kandidaten : []).filter((k) => istObjekt(k) && typeof k.name === 'string');
  const kandidatenNamen = new Set();
  for (const k of kandidaten) {
    if (kandidatenNamen.has(k.name)) befunde.push(`Kandidat ${k.name}: Name doppelt`);
    kandidatenNamen.add(k.name);
  }

  if (vollstaendig && lauf) {
    if (!istVollauf(lauf)) hinweise.push(`Teststatus nicht geprüft: der letzte UTS-Lauf war ein Teillauf (${lauf.modus}); für die Prüfung \`uts\` ohne Filter ausführen`);
    else {
      for (const w of werkzeuge) {
        if (!['gruen', 'rot', 'ungetestet'].includes(w.teststatus)) continue;
        const soll = berechneTeststatus(w, lauf, wurzel);
        if (soll !== w.teststatus) befunde.push(`${w.name}: teststatus "${w.teststatus}" widerspricht dem letzten Vollauf ("${soll}") – \`register aktualisieren\``);
      }
    }
  }
  return { befunde, hinweise };
}

// ---------------------------------------------------------------- Befehle

/** Alle lesbaren Register des Ortes; ein unlesbares Register ist ein Fehler (Exit 1). */
function liesAlle(orte) {
  const eigenes = liesRegister(orte.eigenes);
  const projekt = orte.projekt ? liesRegister(orte.projekt) : null;
  const defekt = [eigenes, projekt].filter((r) => r && r.fehler);
  return { eigenes, projekt, defekt };
}

const meldeDefekte = (io, defekt) => {
  for (const r of defekt) io.fehler(`register: ${r.fehler}`);
  return 1;
};

const liste = (gelesen, feld) => (Array.isArray(gelesen?.daten?.[feld]) ? gelesen.daten[feld].filter(istObjekt) : []);

const anzeigeBefehl = (orte, befehl) => (orte.modus === 'repo' ? befehl.replace(/^node \.hierarchie\/werkzeuge\//, 'node werkzeuge/') : befehl);

function zeigeListe(argv, io, orte) {
  const { opt, pos } = zerlege(argv, { schalter: ['--json'] });
  nurPosition(pos, 0, 'register [--json]');
  const { eigenes, projekt, defekt } = liesAlle(orte);
  if (defekt.length) return meldeDefekte(io, defekt);

  if (opt.json) {
    io.aus(JSON.stringify({
      werkzeuge: [...liste(eigenes, 'werkzeuge'), ...liste(projekt, 'werkzeuge')],
      kandidaten: [...liste(eigenes, 'kandidaten'), ...liste(projekt, 'kandidaten')],
    }, null, 2));
    return 0;
  }
  const zeile = (w) => `${w.name} · ${anzeigeBefehl(orte, w.befehl)} · ${w.teststatus} · Modell: ${w.modell_noetig}`;
  const zeilen = [];
  const projektWerkzeuge = liste(projekt, 'werkzeuge');
  zeilen.push(...liste(eigenes, 'werkzeuge').map(zeile));
  if (projektWerkzeuge.length) zeilen.push('Projekteigene Werkzeuge:', ...projektWerkzeuge.map(zeile));
  const offen = [...liste(eigenes, 'kandidaten'), ...liste(projekt, 'kandidaten')].filter((k) => k.entscheidung === 'offen');
  if (offen.length) {
    zeilen.push('Offene Kandidaten:');
    for (const k of offen) zeilen.push(`${k.name} · ${k.ablauf} · ${k.belegt ? `belegt (${k.quelle})` : 'vermutet'}`);
  }
  if (zeilen.length === 0) zeilen.push('Das Register ist leer.');
  io.aus(zeilen.join('\n'));
  return 0;
}

function pruefen(argv, io, orte) {
  const { opt, pos } = zerlege(argv, { schalter: ['--json'] });
  nurPosition(pos, 0, 'register pruefen [--json]');
  const { eigenes, projekt, defekt } = liesAlle(orte);
  const befunde = [];
  const hinweise = [];
  for (const r of defekt) befunde.push(`${r.quelle.anzeige}: ${r.fehler}`);

  const gelesen = { eigenes: eigenes.fehler ? null : eigenes.daten, projekt: projekt && !projekt.fehler ? projekt.daten : null };
  const namenVon = (daten) => ({
    namen: new Set((daten?.werkzeuge ?? []).filter(istObjekt).map((w) => w.name)),
    cli: new Set((daten?.werkzeuge ?? []).filter(istObjekt).map((w) => w.cli).filter((c) => typeof c === 'string')),
  });
  const { lauf, grund } = liesLauf(orte.projektBasis);
  let mitLauf = null;
  if (lauf) mitLauf = lauf;
  else hinweise.push(`Teststatus nicht geprüft: ${grund}`);

  const pruefe = (r, daten, optionen, pflicht) => {
    if (r === null || r.fehler) return;
    if (!r.vorhanden) {
      if (pflicht) befunde.push(`${r.quelle.anzeige} fehlt`);
      else hinweise.push(`${r.quelle.anzeige} fehlt (noch keine projekteigenen Werkzeuge registriert)`);
      return;
    }
    const ergebnis = pruefeRegister(daten, optionen);
    befunde.push(...ergebnis.befunde.map((b) => `${r.quelle.anzeige}: ${b}`));
    hinweise.push(...ergebnis.hinweise);
  };
  // Im Repo ist das eigene Register vollständig prüfbar; im Projekt ist es eine Kopie (Tests liegen nicht mit).
  pruefe(eigenes, gelesen.eigenes, {
    wurzel: orte.eigenes.wurzel, vollstaendig: orte.modus === 'repo', lauf: orte.modus === 'repo' ? mitLauf : null,
  }, true);
  if (orte.projekt) {
    pruefe(projekt, gelesen.projekt, { wurzel: orte.projekt.wurzel, vollstaendig: true, lauf: mitLauf, fremd: namenVon(gelesen.eigenes) }, false);
  }

  if (opt.json) {
    io.aus(JSON.stringify({ befunde, hinweise }, null, 2));
    return befunde.length ? 1 : 0;
  }
  const anzahl = (r) => liste(r, 'werkzeuge').length;
  const orteText = [orte.eigenes.anzeige, ...(orte.projekt && projekt.vorhanden ? [orte.projekt.anzeige] : [])].join(' + ');
  const zeilen = befunde.map((b) => `✗ ${b}`);
  zeilen.push(...hinweise.map((h) => `Hinweis: ${h}`));
  zeilen.push(befunde.length
    ? `register: ${befunde.length} ${befunde.length === 1 ? 'Befund' : 'Befunde'} (${orteText})`
    : `register in Ordnung: ${anzahl(eigenes) + anzahl(projekt)} Werkzeuge (${orteText})`);
  io.aus(zeilen.join('\n'));
  return befunde.length ? 1 : 0;
}

function aktualisieren(argv, io, orte) {
  const { pos } = zerlege(argv, {});
  nurPosition(pos, 0, 'register aktualisieren');
  const ziel = liesRegister(orte.schreib);
  if (ziel.fehler) return meldeDefekte(io, [ziel]);
  if (!ziel.vorhanden) { io.aus(`register aktualisieren: ${orte.schreib.anzeige} existiert nicht, nichts zu tun.`); return 0; }

  const { lauf, grund } = liesLauf(orte.projektBasis);
  if (!lauf) { io.fehler(`register aktualisieren: ${grund} – zuerst \`uts\` ausführen.`); return 1; }
  if (!istVollauf(lauf)) { io.fehler(`register aktualisieren: der letzte UTS-Lauf war ein Teillauf (${lauf.modus}) – zuerst \`uts\` ohne Filter ausführen.`); return 1; }
  const stand = laufIstAktuell(orte);
  if (!stand.aktuell) { io.fehler(`register aktualisieren: der UTS-Lauf passt nicht zum aktuellen Stand (${stand.meldung}) – zuerst \`uts\` ausführen.`); return 1; }

  const schemaBefunde = pruefeSchema(ziel.daten);
  if (schemaBefunde.length) { io.fehler(`register aktualisieren: ${orte.schreib.anzeige} verletzt das Schema (${schemaBefunde[0]}) – zuerst \`register pruefen\`.`); return 1; }

  const zeilen = [];
  let geaendert = 0;
  for (const w of ziel.daten.werkzeuge) {
    const neu = berechneTeststatus(w, lauf, orte.schreib.wurzel);
    if (neu === w.teststatus) { zeilen.push(`= ${w.name}: ${neu}`); continue; }
    zeilen.push(`~ ${w.name}: ${w.teststatus} → ${neu}`);
    w.teststatus = neu;
    geaendert++;
  }
  if (geaendert) schreibeRegister(ziel, ziel.daten);
  io.aus([`register aktualisieren – ${orte.schreib.anzeige}, Vollauf vom ${lauf.zeit}`, ...zeilen,
    geaendert ? `${geaendert} Teststatus geschrieben.` : 'Teststatus unverändert.'].join('\n'));
  return 0;
}

function kandidat(argv, io, orte) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--ablauf', '--quelle'], schalter: ['--belegt'] });
  nurPosition(pos, 1, 'register kandidat <name> --ablauf "…" [--belegt --quelle "…"]');
  const [name] = pos;
  if (!NAME_MUSTER.test(name)) throw new Bedienfehler(`Name "${name}" ungültig (erlaubt: [a-z0-9-]+, nicht mit - beginnend).`);
  if (!opt.ablauf) throw new Bedienfehler('--ablauf "…" fehlt (was läuft wiederholt ab?).');
  if (opt.belegt && !opt.quelle) throw new Bedienfehler('--belegt verlangt --quelle "…" (woran ist die Wiederholung belegt?).');
  if (opt.quelle && !opt.belegt) throw new Bedienfehler('--quelle gehört zu --belegt; ohne Beleg gilt der Kandidat als vermutet.');

  const ziel = liesRegister(orte.schreib);
  if (ziel.fehler) return meldeDefekte(io, [ziel]);
  const daten = ziel.daten;
  if (!Array.isArray(daten.kandidaten)) { io.fehler(`register: ${orte.schreib.anzeige}: kandidaten muss eine Liste sein`); return 1; }
  if (daten.kandidaten.some((k) => k?.name === name)) throw new Bedienfehler(`Kandidat "${name}" gibt es schon.`);
  daten.kandidaten.push({
    name, ablauf: opt.ablauf, belegt: Boolean(opt.belegt), quelle: opt.belegt ? opt.quelle : null, entscheidung: 'offen', begruendung: '',
  });
  schreibeRegister(ziel, daten);
  io.aus(`Kandidat ${name} angelegt (${opt.belegt ? 'belegt' : 'vermutet'}, offen) in ${orte.schreib.anzeige}.`);
  return 0;
}

function entscheide(argv, io, orte) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--begruendung'] });
  nurPosition(pos, 2, 'register entscheide <name> bauen|verworfen --begruendung "…"');
  const [name, entscheidung] = pos;
  if (!['bauen', 'verworfen'].includes(entscheidung)) throw new Bedienfehler(`Entscheidung "${entscheidung}" ungültig (erlaubt: ${ENTSCHEIDUNGEN.filter((e) => e !== 'offen').join(' oder ')}).`);
  if (!opt.begruendung) throw new Bedienfehler('--begruendung "…" fehlt.');

  const ziel = liesRegister(orte.schreib);
  if (ziel.fehler) return meldeDefekte(io, [ziel]);
  const gefunden = (Array.isArray(ziel.daten.kandidaten) ? ziel.daten.kandidaten : []).find((k) => k?.name === name);
  if (!gefunden) {
    const imAnderen = orte.projekt && orte.modus === 'projekt'
      && (liesRegister(orte.eigenes).daten?.kandidaten ?? []).some((k) => k?.name === name);
    throw new Bedienfehler(imAnderen
      ? `Kandidat "${name}" steht nur im hierarchie-Register (${orte.eigenes.anzeige}, Kopie) und lässt sich im Projekt nicht entscheiden.`
      : `Kandidat "${name}" gibt es nicht in ${orte.schreib.anzeige}.`);
  }
  const vorher = gefunden.entscheidung;
  gefunden.entscheidung = entscheidung;
  gefunden.begruendung = opt.begruendung;
  schreibeRegister(ziel, ziel.daten);
  io.aus(`Kandidat ${name}: ${vorher} → ${entscheidung} (${orte.schreib.anzeige}).`);
  return 0;
}

// ---------------------------------------------------------------- Hauptablauf

/** Führt `register` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { orte = ermittleOrte() } = {}) {
  try {
    const [unterbefehl, ...rest] = argv;
    if (argv.includes('--hilfe') || argv.includes('--help') || argv.includes('-h') || unterbefehl === 'hilfe') { io.aus(HILFE); return 0; }
    switch (unterbefehl) {
      case undefined: return zeigeListe(argv, io, orte);
      case 'pruefen': return pruefen(rest, io, orte);
      case 'aktualisieren': return aktualisieren(rest, io, orte);
      case 'kandidat': return kandidat(rest, io, orte);
      case 'entscheide': return entscheide(rest, io, orte);
      default:
        if (unterbefehl.startsWith('-')) return zeigeListe(argv, io, orte);
        throw new Bedienfehler(`Unbekannter Unterbefehl "${unterbefehl}" (pruefen, aktualisieren, kandidat, entscheide; siehe --hilfe).`);
    }
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`hierarchie register: ${fehler.message}`); return 2; }
    io.fehler(`hierarchie register: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
