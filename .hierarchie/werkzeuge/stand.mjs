#!/usr/bin/env node
/**
 * hierarchie stand – Projektgedächtnis: STAND.md prüfen, anlegen und als HTML-Seite ausgeben.
 *
 *   stand                       Kurzanzeige: Kopfzeilen, Abschnittslängen, Befunde und Warnungen
 *   stand pruefen               Exit 1 bei Befund (Datei fehlt, Aufbau, Datum, Länge, Platzhalter); Veraltet ist nur eine Warnung
 *   stand neu [--name "…"]      legt STAND.md aus vorlagen/STAND.md an (vorhanden ⇒ Exit 2)
 *   stand html                  schreibt stand.html (Dokument) und stand.seite.html (Fragment für claude.ai)
 *
 * Schreiben ist der Zweck von `neu` (STAND.md) und `html` (stand.html, stand.seite.html im Projektordner).
 * Kein Modellaufruf; Veröffentlichen auf claude.ai übernimmt Claude mit dem Artifact-Werkzeug, nicht dieses Skript.
 * Spezifikation: docs/spezifikation/stand.md
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { git, gitBytes } from './lib/git.mjs';
import { istObjekt } from './lib/json.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { ermittleOrte, liesRegister } from './lib/register.mjs';
import { utsStatusZeile } from './lib/sammeln.mjs';
import { baueStandSeite } from './lib/stand-seite.mjs';
import { pruefeStatus } from './plan.mjs';
import { liesLauf } from './register.mjs';

export const DATEI = 'STAND.md';
export const STANDARD_MAX_ZEILEN = 80;
export const ABSCHNITTE = ['Ziel', 'Aktueller Stand', 'Offene Punkte', 'Entscheidungen', 'Nächste Schritte', 'Befunde'];

const HILFE = `Aufruf: hierarchie stand [pruefen | neu [--name "…"] | html]

  (ohne)          Kurzanzeige von ${DATEI}: Kopfzeilen, Abschnittslängen, Befunde und Warnungen
  pruefen         Exit 1 bei: Datei fehlt · Pflichtüberschrift fehlt oder falsche Reihenfolge · Datum fehlt/ungültig ·
                  über der Höchstlänge (${STANDARD_MAX_ZEILEN} Zeilen, in package.json → "hierarchie": {"stand_max_zeilen": N}) · Platzhalter <…> der Vorlage.
                  Warnung (Exit 0): "Zuletzt aktualisiert" ist älter als der letzte Commit, der nicht nur ${DATEI} betrifft
  neu [--name "…"]  legt ${DATEI} aus vorlagen/${DATEI} an; ist sie vorhanden: Exit 2, nichts wird überschrieben
  html            schreibt stand.html (vollständiges Dokument) und stand.seite.html (Fragment für claude.ai), beide nicht versioniert;
                  Daten aus ${DATEI}, UTS-Status, Plänen, Register und Git, ohne Modellaufruf
Veröffentlichen auf claude.ai übernimmt Claude mit dem Artifact-Werkzeug, nicht dieses Skript.
Exit-Code: 0 ok · 1 Befund · 2 Bedienfehler`;

// ---------------------------------------------------------------- Lesen und Zerlegen

export const lokalesDatum = (jetzt) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}`;
};

function gueltigesDatum(text) {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!treffer) return false;
  const [j, m, t] = [Number(treffer[1]), Number(treffer[2]), Number(treffer[3])];
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

/** Zerlegt den Text von STAND.md (Überschriften in Codeblöcken zählen nicht). */
export function zerlegeStand(text) {
  const zeilen = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (zeilen.at(-1) === '') zeilen.pop();
  let imCode = false;
  const ueberschriften = []; // { name, zeile (0-basiert) }
  const aussenzeilen = []; // Zeilen außerhalb von Codeblöcken: { text, nr }
  zeilen.forEach((zeile, nr) => {
    if (/^\s*(```|~~~)/.test(zeile)) { imCode = !imCode; return; }
    if (imCode) return;
    aussenzeilen.push({ text: zeile, nr });
    const treffer = /^##\s+(.+?)\s*$/.exec(zeile);
    if (treffer) ueberschriften.push({ name: treffer[1], zeile: nr });
  });
  const ersteUeberschrift = ueberschriften[0]?.zeile ?? zeilen.length;
  const kopf = zeilen.slice(0, ersteUeberschrift);
  const titelNr = kopf.findIndex((z) => z.trim() !== '');
  const titel = titelNr >= 0 ? /^#\s+Stand:\s*(\S.*?)\s*$/.exec(kopf[titelNr]) : null;
  const datumNr = kopf.findIndex((z) => /^Zuletzt aktualisiert:/.test(z));
  const htmlNr = kopf.findIndex((z) => /^HTML-Seite:/.test(z));
  const wert = (nr, schluessel) => (nr >= 0 ? kopf[nr].slice(schluessel.length + 1).trim() : null);
  const abschnitte = ueberschriften.map((u, i) => {
    const ende = ueberschriften[i + 1]?.zeile ?? zeilen.length;
    const inhalt = zeilen.slice(u.zeile + 1, ende);
    return { name: u.name, zeilen: inhalt.filter((z) => z.trim() !== '').length, inhalt };
  });
  const verborgen = new Set([titel ? titelNr : -1, datumNr, htmlNr]);
  return {
    zeilen, anzahl: zeilen.length, ueberschriften, abschnitte, aussenzeilen,
    hatTitel: titel !== null, name: titel ? titel[1] : null,
    datumRoh: wert(datumNr, 'Zuletzt aktualisiert'), htmlSeite: wert(htmlNr, 'HTML-Seite'),
    rumpf: zeilen.filter((_, nr) => !verborgen.has(nr)).join('\n'),
  };
}

const TAG_ODER_LINK = /^<(?:\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?|!--[^<>]*--|(?:https?:\/\/|mailto:)[^<>\s]*)>$/;

/** Platzhalter der Vorlage (`<…>`) außerhalb von Code; HTML-Tags in Kleinbuchstaben, Autolinks und Kommentare zählen nicht. */
export function findePlatzhalter(zerlegt) {
  const funde = [];
  for (const { text, nr } of zerlegt.aussenzeilen) {
    const ohneCode = text.replace(/(`+)[\s\S]*?\1/g, '');
    for (const treffer of ohneCode.matchAll(/<[^<>\n]+>/g)) {
      if (!TAG_ODER_LINK.test(treffer[0])) funde.push({ zeile: nr + 1, text: treffer[0] });
    }
  }
  return funde;
}

/** Höchstlänge aus package.json → "hierarchie": {"stand_max_zeilen": N}; Standard 80. */
export function maxZeilen(basis) {
  try {
    const wert = JSON.parse(readFileSync(join(basis, 'package.json'), 'utf8'))?.hierarchie?.stand_max_zeilen;
    if (Number.isInteger(wert) && wert >= 1) return wert;
  } catch { /* keine oder unlesbare package.json ⇒ Standard */ }
  return STANDARD_MAX_ZEILEN;
}

/**
 * Prüft STAND.md im Ordner `basis`. Ergebnis: { vorhanden, befunde: [Text], warnungen: [Text], stand (zerlegt) | null, veraltetSeit, nurPlatzhalter }.
 * `befunde` leer ⇒ gültig. `nurPlatzhalter`: der einzige Befund ist der Platzhalter der Vorlage (STAND.md noch nicht ausgefüllt). `veraltetSeit`: Datum des letzten Commits ohne STAND.md, wenn die Datei älter ist, sonst null.
 */
export function pruefeStand(basis) {
  const pfad = join(basis, DATEI);
  if (!existsSync(pfad)) return { vorhanden: false, befunde: [`${DATEI} fehlt (hierarchie stand neu legt sie an)`], warnungen: [], stand: null, veraltetSeit: null };
  const stand = zerlegeStand(readFileSync(pfad, 'utf8'));
  const befunde = [];
  const warnungen = [];

  if (!stand.hatTitel) befunde.push('erste Zeile muss "# Stand: <Projektname>" sein');
  if (stand.datumRoh === null) befunde.push('Zeile "Zuletzt aktualisiert: JJJJ-MM-TT" fehlt');
  else if (!stand.datumRoh.includes('<') && !gueltigesDatum(stand.datumRoh)) befunde.push(`Datum "${stand.datumRoh}" ungültig (erwartet JJJJ-MM-TT, echtes Kalenderdatum)`);
  if (stand.htmlSeite === null) befunde.push('Zeile "HTML-Seite: <claude.ai-Link oder keine>" fehlt');

  const namen = stand.ueberschriften.map((u) => u.name);
  const fehlend = ABSCHNITTE.filter((a) => !namen.includes(a));
  for (const a of fehlend) befunde.push(`Überschrift "## ${a}" fehlt`);
  for (const a of ABSCHNITTE.filter((x) => namen.filter((n) => n === x).length > 1)) befunde.push(`Überschrift "## ${a}" kommt mehrfach vor`);
  if (!fehlend.length) {
    const reihenfolge = namen.filter((n) => ABSCHNITTE.includes(n));
    if (reihenfolge.join('|') !== ABSCHNITTE.join('|') && new Set(reihenfolge).size === reihenfolge.length) {
      befunde.push(`Reihenfolge der Überschriften falsch (erwartet: ${ABSCHNITTE.join(', ')})`);
    }
  }

  const grenze = maxZeilen(basis);
  if (stand.anzahl > grenze) befunde.push(`${DATEI} hat ${stand.anzahl} Zeilen, höchstens ${grenze} erlaubt (kürzen)`);

  const platzhalter = findePlatzhalter(stand);
  if (platzhalter.length) {
    const beispiele = platzhalter.slice(0, 3).map((p) => `Zeile ${p.zeile} ${p.text}`).join('; ');
    befunde.push(`Platzhalter der Vorlage noch drin (${platzhalter.length}): ${beispiele}${platzhalter.length > 3 ? ' …' : ''}`);
  }

  let veraltetSeit = null;
  if (stand.datumRoh && gueltigesDatum(stand.datumRoh)) {
    const letzter = git(basis, ['log', '-1', '--format=%cs', '--', '.', `:(exclude)${DATEI}`]);
    if (letzter && /^\d{4}-\d{2}-\d{2}$/.test(letzter) && stand.datumRoh < letzter) {
      veraltetSeit = letzter;
      warnungen.push(`Zuletzt aktualisiert (${stand.datumRoh}) ist älter als der letzte Commit ohne ${DATEI} (${letzter}) – nachführen`);
    }
  }
  return { vorhanden: true, befunde, warnungen, stand, veraltetSeit, nurPlatzhalter: platzhalter.length > 0 && befunde.length === 1 };
}

/** Eine Zeile für `uebergabe`: "STAND.md: aktuell (…) | veraltet (zuletzt …) | fehlt | ungültig (…)". Wirft nie. */
export function standZeile(basis) {
  try {
    const e = pruefeStand(basis);
    if (!e.vorhanden) return `${DATEI}: fehlt`;
    if (e.befunde.length) return `${DATEI}: ungültig (${e.befunde[0]}${e.befunde.length > 1 ? `; +${e.befunde.length - 1}` : ''})`;
    if (e.veraltetSeit) return `${DATEI}: veraltet (zuletzt ${e.stand.datumRoh}, letzter Commit ${e.veraltetSeit})`;
    return `${DATEI}: aktuell`;
  } catch (fehler) {
    return `${DATEI}: nicht lesbar (${String(fehler?.message ?? fehler).slice(0, 60)})`;
  }
}

// ---------------------------------------------------------------- Unterbefehle

function projektname(basis, stand) {
  if (stand?.name && !stand.name.includes('<')) return stand.name;
  try {
    const name = JSON.parse(readFileSync(join(basis, 'package.json'), 'utf8'))?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch { /* weiter mit dem Ordnernamen */ }
  return basename(basis);
}

/** Unterbefehle ohne Argumente: Positionsargumente und unbekannte Optionen sind Bedienfehler. */
function ohneArgumente(argv, name) {
  if (zerlege(argv).pos.length) throw new Bedienfehler(`${name} erwartet keine Argumente (${argv.join(' ')}); siehe --hilfe`);
}

function anzeige(argv, io, orte) {
  ohneArgumente(argv, 'stand');
  const e = pruefeStand(orte.projektBasis);
  if (!e.vorhanden) { io.fehler(`${DATEI} fehlt. Anlegen: hierarchie stand neu`); return 1; }
  const s = e.stand;
  io.aus([
    `Stand: ${projektname(orte.projektBasis, s)}`,
    `Zuletzt aktualisiert: ${s.datumRoh ?? 'fehlt'}`,
    `HTML-Seite: ${s.htmlSeite ?? 'fehlt'}`,
    `Länge: ${s.anzahl} von ${maxZeilen(orte.projektBasis)} Zeilen`,
    `Abschnitte: ${s.abschnitte.map((a) => `${a.name} ${a.zeilen}`).join(' · ') || 'keine'}`,
    ...e.befunde.map((b) => `Befund: ${b}`),
    ...e.warnungen.map((w) => `Warnung: ${w}`),
  ].join('\n'));
  return 0;
}

function pruefen(argv, io, orte) {
  ohneArgumente(argv, 'stand pruefen');
  const e = pruefeStand(orte.projektBasis);
  if (e.befunde.length) {
    io.fehler(e.befunde.map((b) => `${DATEI}: ${b}`).join('\n'));
    for (const w of e.warnungen) io.aus(`Warnung: ${w}`);
    return 1;
  }
  io.aus(`${DATEI}: in Ordnung (${e.stand.anzahl} von ${maxZeilen(orte.projektBasis)} Zeilen, zuletzt ${e.stand.datumRoh})`);
  for (const w of e.warnungen) io.aus(`Warnung: ${w}`);
  return 0;
}

function neu(argv, io, orte, jetzt) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--name'] });
  if (pos.length) throw new Bedienfehler('Erwartet: stand neu [--name "…"]');
  const ziel = join(orte.projektBasis, DATEI);
  if (existsSync(ziel)) { io.fehler(`hierarchie stand: ${DATEI} gibt es schon, sie wird nie überschrieben.`); return 2; }
  const vorlage = join(orte.installWurzel, 'vorlagen', DATEI);
  if (!existsSync(vorlage)) throw new Error(`Vorlage fehlt: ${vorlage}`);
  const name = (opt.name ?? projektname(orte.projektBasis, null)).replace(/\s+/g, ' ').trim();
  if (!name) throw new Bedienfehler('--name darf nicht leer sein.');
  const text = readFileSync(vorlage, 'utf8').replace('<Projektname>', () => name).replace('<JJJJ-MM-TT>', lokalesDatum(jetzt));
  writeFileSync(ziel, text);
  io.aus(`+ ${DATEI}\nNächste Schritte: Platzhalter <…> ausfüllen, dann stand pruefen und stand html.`);
  return 0;
}

// ---------------------------------------------------------------- HTML

function klassifiziereUts(zeile, lauf) {
  const status = /^UTS aktuell: grün/.test(zeile) ? 'aktuell' : /^UTS aktuell: rot/.test(zeile) ? 'rot' : /^UTS veraltet/.test(zeile) ? 'veraltet'
    : /^UTS Teillauf/.test(zeile) ? 'teillauf' : /^UTS: noch kein Lauf/.test(zeile) ? 'keinlauf' : 'unbekannt';
  return { status, tests: Number.isInteger(lauf?.gesamt) ? lauf.gesamt : null, zeit: typeof lauf?.zeit === 'string' ? lauf.zeit : null };
}

function liesPlaene(basis) {
  const wurzel = join(basis, 'plaene');
  const namen = existsSync(wurzel) ? readdirSync(wurzel, { withFileTypes: true }).filter((x) => x.isDirectory() && existsSync(join(wurzel, x.name, 'status.json'))).map((x) => x.name).sort() : [];
  const plaene = [];
  const defekt = [];
  for (const name of namen) {
    try {
      const status = JSON.parse(readFileSync(join(wurzel, name, 'status.json'), 'utf8'));
      if (pruefeStatus(status).length === 0) plaene.push(status); else defekt.push(name);
    } catch { defekt.push(name); }
  }
  return { plaene, defekt };
}

/** Sammelt alle Daten der Seite; fehlende Quellen bleiben leer (nichts wird erfunden). */
export async function sammleSeitenDaten(orte, jetzt = new Date()) {
  const basis = orte.projektBasis;
  const e = pruefeStand(basis);
  const imGit = git(basis, ['rev-parse', '--is-inside-work-tree']) === 'true';
  const branch = imGit ? (git(basis, ['symbolic-ref', '--short', '-q', 'HEAD']) ?? `losgelöst bei ${git(basis, ['rev-parse', '--short', 'HEAD']) ?? '?'}`) : null;
  const commits = imGit ? (git(basis, ['log', '-10', '--format=%h%x1f%s%x1f%cs']) ?? '').split('\n').filter(Boolean)
    .map((z) => { const [sha, betreff, datum] = z.split('\x1f'); return { sha, betreff: betreff ?? '', datum: datum ?? '' }; }) : null;
  const uncommittet = imGit ? (gitBytes(basis, ['status', '--porcelain', '-uall'], 1 << 26)?.toString('utf8') ?? '').split('\n').filter(Boolean).length : null;
  const { plaene, defekt } = liesPlaene(basis);
  const register = [orte.eigenes, orte.projekt].filter(Boolean).map(liesRegister).filter((r) => istObjekt(r.daten));
  const werkzeuge = register.flatMap((r) => (Array.isArray(r.daten.werkzeuge) ? r.daten.werkzeuge : [])).filter((w) => istObjekt(w) && typeof w.name === 'string')
    .map((w) => ({ name: w.name, teststatus: w.teststatus, modell_noetig: String(w.modell_noetig ?? '') }));
  const kandidaten = register.flatMap((r) => (Array.isArray(r.daten.kandidaten) ? r.daten.kandidaten : []))
    .filter((k) => k?.entscheidung === 'offen' && typeof k.name === 'string').map((k) => k.name);
  const utsZeile = await utsStatusZeile(basis, orte);
  return {
    projekt: projektname(basis, e.stand), erzeugt: jetzt, branch,
    aktualisiert: e.stand?.datumRoh && !e.stand.datumRoh.includes('<') ? e.stand.datumRoh : null,
    veraltet: e.warnungen[0] ?? null, standFehlt: !e.vorhanden, standMarkdown: e.stand?.rumpf ?? '',
    uts: klassifiziereUts(utsZeile, liesLauf(basis).lauf), plaene, plaeneDefekt: defekt,
    plaeneOffen: plaene.filter((p) => !p.abgeschlossen).length, werkzeuge, kandidaten, commits, uncommittet,
  };
}

async function html(argv, io, orte, jetzt) {
  ohneArgumente(argv, 'stand html');
  const { seite, voll } = baueStandSeite(await sammleSeitenDaten(orte, jetzt));
  const dokument = join(orte.projektBasis, 'stand.html');
  const fragment = join(orte.projektBasis, 'stand.seite.html');
  writeFileSync(dokument, voll);
  writeFileSync(fragment, seite);
  io.aus(`+ ${dokument}  (Dokument zum lokalen Öffnen)\n+ ${fragment}  (Fragment für claude.ai, mit dem Artifact-Werkzeug veröffentlichen)`);
  return 0;
}

// ---------------------------------------------------------------- Hauptablauf

const UNTERBEFEHLE = { pruefen, neu, html };

/** Führt `stand` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { orte = ermittleOrte(), jetzt = new Date() } = {}) {
  try {
    if (argv.some((a) => ['--hilfe', '--help', '-h'].includes(a)) || argv[0] === 'hilfe') { io.aus(HILFE); return 0; }
    const [unterbefehl, ...rest] = argv;
    if (unterbefehl === undefined || unterbefehl.startsWith('-')) return anzeige(argv, io, orte);
    if (!Object.hasOwn(UNTERBEFEHLE, unterbefehl)) throw new Bedienfehler(`Unbekannter Unterbefehl "${unterbefehl}" (${Object.keys(UNTERBEFEHLE).join(', ')}; siehe --hilfe).`);
    return await UNTERBEFEHLE[unterbefehl](rest, io, orte, jetzt);
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`hierarchie stand: ${fehler.message}`); return 2; }
    io.fehler(`hierarchie stand: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
