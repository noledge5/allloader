#!/usr/bin/env node
/**
 * hierarchie doku-verweise – Markdown-Verweise auf Dateien, die es nicht gibt.
 *
 *   doku-verweise [ordner…] [--json]
 *
 * Geprüft werden relative Markdown-Links `[Text](pfad)` und Pfade in Inline-Code (`pfad/datei.md`).
 * Ziel ist wenig Fehlalarm: im Zweifel wird ein Verweis nicht geprüft. Schreibt nichts.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { listeDateien } from './lib/dateien.mjs';
import { relativUnter } from './lib/pfade.mjs';
import { git } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';

const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];
const AUSGESCHLOSSEN = new Set(['node_modules', '.git', '.next', '.uts', 'dist', 'build', 'coverage', '.hierarchie']);
const MAX_BYTES = 2 * 1024 * 1024;
// Dateiendungen, an denen ein Inline-Code-Text als Dateiverweis erkannt wird.
const ENDUNGEN = new Set(['md', 'mjs', 'cjs', 'js', 'ts', 'tsx', 'jsx', 'json', 'jsonl', 'sh', 'yml', 'yaml', 'html', 'css', 'txt', 'toml', 'py', 'csv', 'svg', 'png', 'jpg', 'gif', 'ps1', 'bat', 'cmd', 'sql']);
const PFADZEICHEN = /^[\p{L}\p{N}_.\-/]+$/u;
// Erzeugt oder installiert bzw. Benutzer-/Projekteinstellungen außerhalb der Dokumentation: Verweise darauf werden nicht geprüft.
const NICHT_GEPRUEFT = new Set([...AUSGESCHLOSSEN, '.claude']);
const PLATZHALTER = /[<>*…$]|\{\{|\.\.\./;

const HILFE = `Aufruf: hierarchie doku-verweise [ordner…] [--json]

  Prüft in allen Markdown-Dateien (.md) unter den Ordnern (Standard: ganzes Projekt = aktueller Ordner)
  - relative Links [Text](pfad): Ziel relativ zur Datei (mit / am Anfang: zur Projektwurzel); Anker, Query und URLs werden ignoriert
  - Inline-Code \`pfad/datei.md\`: nur wenn er wie ein Repo-Pfad aussieht (enthält / oder endet auf eine bekannte Endung) und
    relativ zur Datei und zur Projektwurzel nicht existiert; Platzhalter (<…>, *, …, $) werden ignoriert
  Reine Dateinamen ohne / (status.json) und Kurzpfade, die am Ende eines vorhandenen Pfades passen (kalender/page.jsx), werden nicht gemeldet.
  Codeblöcke werden übersprungen. Nicht durchsucht: ${[...AUSGESCHLOSSEN].join(', ')}.
  Projektwurzel = Git-Wurzel des Ordners, sonst der Ordner selbst.

Ausgabe: eine Zeile je Befund \`datei:zeile → ziel\`; --json: { befunde: [{ datei, zeile, ziel, art }], dateien }
Exit-Code: 0 keine Befunde · 1 Befund · 2 Bedienfehler (Ordner fehlt)`;

const PFAD_URL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

function wurzelVon(ordner) {
  const oben = git(ordner, ['rev-parse', '--show-toplevel']);
  return oben ? resolve(oben) : ordner;
}

/** Zeilen einer Markdown-Datei ohne Codeblöcke: [{ nr, text }]. */
function zeilenOhneCodeblock(text) {
  const ergebnis = [];
  let zaun = null;
  text.split(/\r?\n/).forEach((zeile, i) => {
    const treffer = /^\s{0,3}(`{3,}|~{3,})/.exec(zeile);
    if (zaun) {
      if (treffer && treffer[1][0] === zaun[0] && treffer[1].length >= zaun.length && /^\s{0,3}[`~]+\s*$/.test(zeile)) zaun = null;
      return;
    }
    if (treffer) { zaun = treffer[1]; return; }
    ergebnis.push({ nr: i + 1, text: zeile });
  });
  return ergebnis;
}

/** Trennt Inline-Code ab: liefert die Zeile mit gleich langen Platzhaltern statt des Codes und die Codeteile. */
function trenneCode(zeile) {
  const codes = [];
  const rest = zeile.replace(/(`+)(.+?)\1(?!`)/g, (treffer, _zaun, inhalt) => {
    codes.push(inhalt.trim());
    return 'x'.repeat(treffer.length);
  });
  return { rest, codes };
}

const LINK = /\]\(\s*(<[^>]+>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+["'(][^)]*)?\s*\)/g;
const DEFINITION = /^\s{0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]+>|\S+)/;

/** Link-Ziel → Dateipfad (ohne Anker/Query) oder null, wenn nicht zu prüfen. */
function linkZiel(roh) {
  let ziel = roh.trim();
  if (ziel.startsWith('<') && ziel.endsWith('>')) ziel = ziel.slice(1, -1).trim();
  if (ziel === '' || ziel.startsWith('#') || PFAD_URL.test(ziel) || PLATZHALTER.test(ziel) || /[{}]/.test(ziel)) return null;
  ziel = ziel.replace(/[#?].*$/, '');
  if (ziel === '') return null;
  try { return decodeURIComponent(ziel); } catch { return ziel; }
}

/** Inline-Code-Text → Pfad, wenn er wie ein Repo-Pfad aussieht; sonst null. */
function codePfad(text) {
  let pfad = text.replace(/^\.\//, '').replace(/#[\w-]*$/, '').replace(/:\d+(?:-\d+)?$/, '');
  if (pfad === '' || pfad.startsWith('/') || pfad.startsWith('-') || !PFADZEICHEN.test(pfad)) return null;
  if (pfad.split('/').some((teil) => /^\.{3,}$/.test(teil))) return null;
  const segmente = pfad.split('/').filter((teil) => teil !== '' && teil !== '.' && teil !== '..');
  if (segmente.length === 0 || /^[\w-]+\.(com|org|net|io|dev|de|app)$/.test(segmente[0])) return null;
  const letztes = segmente.at(-1);
  const endung = /^[^.].*\.([A-Za-z0-9]+)$/.exec(letztes)?.[1]?.toLowerCase();
  // Reine Dateinamen (`status.json`, `Node.js`) sind oft erzeugte Dateien oder Produktnamen: nicht prüfen.
  if (!pfad.includes('/')) return null;
  return { pfad, bekannt: ENDUNGEN.has(endung), segmente };
}

/** Prüft eine Datei; liefert Befunde [{ zeile, ziel, art }]. */
function pruefeDatei(wurzel, relativ, endetMitPfad) {
  const text = readFileSync(join(wurzel, relativ), 'utf8');
  const hier = dirname(join(wurzel, relativ));
  const gibtEs = (pfad, basis) => existsSync(resolve(basis, pfad));
  const befunde = [];
  for (const { nr, text: zeile } of zeilenOhneCodeblock(text)) {
    const { rest, codes } = trenneCode(zeile);
    const ziele = [...rest.matchAll(LINK)].map((t) => t[1]);
    const definition = DEFINITION.exec(rest);
    if (definition) ziele.push(definition[1]);
    for (const roh of ziele) {
      const ziel = linkZiel(roh);
      if (ziel === null) continue;
      const basis = ziel.startsWith('/') ? wurzel : hier;
      if (!gibtEs(ziel.startsWith('/') ? ziel.slice(1) : ziel, basis)) befunde.push({ zeile: nr, ziel: roh.replace(/^<|>$/g, ''), art: 'link' });
    }
    for (const code of codes) {
      const kandidat = codePfad(code);
      if (!kandidat) continue;
      const { pfad, bekannt, segmente } = kandidat;
      if (NICHT_GEPRUEFT.has(segmente[0])) continue;
      if (gibtEs(pfad, hier) || gibtEs(pfad, wurzel)) continue;
      // Ohne bekannte Endung (z. B. `werkzeuge/lib`, `und/oder`): nur melden, wenn der erste Ordner existiert.
      if (!bekannt && !(gibtEs(segmente[0], hier) || gibtEs(segmente[0], wurzel))) continue;
      // Kurzpfad (`kalender/page.jsx` für `app/kalender/page.jsx`): nicht melden.
      if (endetMitPfad(segmente.join('/'))) continue;
      befunde.push({ zeile: nr, ziel: code, art: 'code' });
    }
  }
  return befunde;
}

function pruefeOrdner(ordner) {
  const wurzel = wurzelVon(ordner);
  const alle = listeDateien(wurzel, () => false, (name) => AUSGESCHLOSSEN.has(name));
  const endetMitPfad = (pfad) => alle.some((p) => p === pfad || p.endsWith(`/${pfad}`));
  // Git meldet den echten Pfad, der Ordner kann über Link/Kurzname genannt sein: Vergleich über die echten Orte.
  const rel = relativUnter(ordner, wurzel);
  const unter = rel ? `${rel}/` : '';
  const dateien = alle.filter((p) => /\.(md|markdown)$/i.test(p) && p.startsWith(unter) && statSync(join(wurzel, p)).size <= MAX_BYTES);
  const befunde = [];
  for (const datei of dateien) {
    for (const b of pruefeDatei(wurzel, datei, endetMitPfad)) befunde.push({ datei, ...b });
  }
  return { befunde, dateien: dateien.length };
}

/** Führt `doku-verweise` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    const { pos, opt } = zerlege(argv, { schalter: ['--json'] });
    const ordnerListe = (pos.length ? pos : ['.']).map((o) => resolve(ordner, o));
    for (const o of ordnerListe) {
      if (!existsSync(o) || !statSync(o).isDirectory()) throw new Bedienfehler(`Ordner nicht gefunden: ${isAbsolute(o) ? o : join(ordner, o)}`);
    }
    const befunde = [];
    let dateien = 0;
    for (const o of ordnerListe) {
      const ergebnis = pruefeOrdner(o);
      befunde.push(...ergebnis.befunde);
      dateien += ergebnis.dateien;
    }
    if (opt.json) io.aus(JSON.stringify({ befunde, dateien }, null, 2));
    else if (befunde.length) io.aus(befunde.map((b) => `${b.datei}:${b.zeile} → ${b.ziel}`).join('\n'));
    else io.aus(`Keine kaputten Verweise (${dateien} Markdown-Dateien geprüft).`);
    return befunde.length ? 1 : 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) {
      io.fehler(`doku-verweise: ${fehler.message}`);
      return 2;
    }
    io.fehler(`doku-verweise: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
