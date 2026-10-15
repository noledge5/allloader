#!/usr/bin/env node
/**
 * hierarchie ponytail-debt – Sammelt alle bewussten Abkürzungen (Kommentare mit der Marke ponytail:) eines Repos und listet sie mit Grenze und Ausbau-Zeitpunkt auf
 *
 *   ponytail-debt [--streng] [--json]
 *
 * Marke und Form laut Skill ponytail: Kommentar `<Grenze>, <wann ausbauen>` hinter der Marke. Ein Fund ohne zweiten Teil
 * gilt als unvollständig (faule Abkürzungen ohne Auslöser verrotten still). Bericht, kein Fehler: Funde ändern den Exit-Code
 * nur mit --streng. Schreibt nichts.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { listeDateien } from './lib/dateien.mjs';
import { git, gitBytes } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';

const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];
const MAX_BYTES = 1024 * 1024;
// Ohne Git: diese Ordner werden nicht durchsucht. Mit Git zählen nur node_modules und .hierarchie (Projektkopie dieser Werkzeuge).
const OHNE_GIT_AUSGESCHLOSSEN = new Set(['node_modules', '.git', '.next', '.uts', 'dist', 'build', 'coverage', '.hierarchie']);
const IMMER_AUSGESCHLOSSEN = new Set(['node_modules', '.hierarchie']);
const MARKDOWN = /\.(?:md|markdown)$/i;

const HILFE = `Aufruf: hierarchie ponytail-debt [--streng] [--json]

  Sammelt die bewussten Abkürzungen eines Repos: Kommentare der Form  ponytail: <Grenze>, <wann ausbauen>
  (Skill ponytail). Gesucht wird in den von Git versionierten Dateien (git ls-files, Inhalt der Arbeitskopie),
  ohne Git im Dateibaum ohne .git, node_modules, .uts, dist, build, coverage, .next und .hierarchie.
  Die Marke zählt nur direkt hinter einem Kommentarzeichen am Zeilenanfang oder nach Leerraum: //  /*  <!--  #  --
  (# und -- mitten in der Zeile nur mit Leerzeichen danach), sowie * am Zeilenanfang im Blockkommentar. Zeilen über 2000 Zeichen werden nicht durchsucht.
  Dokumentation (*.md) wird ausgenommen, weil sie die Marke nur erklärt; Binärdateien und Dateien über 1 MB werden übersprungen.
  Eine Marke gilt je Zeile; mehrzeilige Kommentare werden nicht zusammengesetzt. Die Teilung an der ersten Komma-Stelle:
  davor die Grenze, danach der Zeitpunkt zum Ausbauen. Fehlt ein Teil, ist der Fund unvollständig.
  --streng   Exit 1, wenn unvollständige Marken vorkommen
  --json     { funde: [{ datei, zeile, grenze, ausbau, vollstaendig }], unvollstaendig, geprueft, uebersprungen }

Ausgabe: eine Zeile je Fund \`datei:zeile  Grenze → wann ausbauen\`, am Ende eine Summenzeile. Schreibt nichts.
Exit-Code: 0 Bericht erstellt (auch mit Funden) · 1 nur mit --streng bei unvollständigen Marken · 2 Bedienfehler
Nicht lesbare Dateien zählen als übersprungen.`;

// Kommentarzeichen am Zeilenanfang oder nach Leerraum, dann Marke, dann Leerraum oder Zeilenende. So bleiben eine
// Adresse mit //host:port, eine Marke in einem String ("// …") und #wort außen vor.
const MARKE = /(?:^\s*(?:#+|--)|(?:^|\s)(?:\/\/+|\/\*+|<!--|#+\s|--\s))\s*ponytail:(?:\s+(.*))?$/;
const BLOCKZEILE = /^\s*\*\s*ponytail:(?:\s+(.*))?$/;
const MAX_ZEILE = 2000; // längere Zeilen sind erzeugter Code; schützt den regulären Ausdruck vor quadratischer Laufzeit

/** Marke einer Zeile → { grenze, ausbau, vollstaendig } oder null. */
export function parseZeile(zeile) {
  if (zeile.length > MAX_ZEILE || !zeile.includes('ponytail:')) return null;
  const treffer = MARKE.exec(zeile) ?? BLOCKZEILE.exec(zeile);
  if (!treffer) return null;
  const text = (treffer[1] ?? '').replace(/\s*(?:\*\/|-->)\s*$/, '').trim();
  const komma = text.indexOf(',');
  const grenze = (komma === -1 ? text : text.slice(0, komma)).trim();
  const ausbau = komma === -1 ? '' : text.slice(komma + 1).trim();
  return { grenze, ausbau, vollstaendig: grenze !== '' && ausbau !== '' };
}

const istBinaer = (inhalt) => inhalt.subarray(0, 8000).includes(0);

/** Dateinamen (relativ, mit `/`) der Suche: Git-Index, sonst Dateibaum. */
function dateiNamen(wurzel, mitGit) {
  if (mitGit) {
    const roh = gitBytes(wurzel, ['ls-files', '-z'], 1 << 28);
    if (roh === null) throw new Error('git ls-files ist fehlgeschlagen');
    return [...new Set(roh.toString('utf8').split('\0').filter(Boolean))]
      .filter((pfad) => !IMMER_AUSGESCHLOSSEN.has(pfad.split('/')[0]));
  }
  return listeDateien(wurzel, () => false, (name) => OHNE_GIT_AUSGESCHLOSSEN.has(name));
}

function lesen(pfad) {
  try {
    return statSync(pfad).isFile() && statSync(pfad).size <= MAX_BYTES ? readFileSync(pfad) : null;
  } catch { return null; }
}

/** Sucht die Marken; liefert { funde, unvollstaendig, geprueft, uebersprungen }. */
export function sammle(wurzel, { mitGit }) {
  const funde = [];
  let geprueft = 0;
  let uebersprungen = 0;
  for (const datei of dateiNamen(wurzel, mitGit).sort()) {
    const bytes = MARKDOWN.test(datei) ? null : lesen(join(wurzel, datei));
    if (bytes === null || istBinaer(bytes)) { uebersprungen++; continue; }
    geprueft++;
    bytes.toString('utf8').split(/\r?\n/).forEach((zeile, i) => {
      const fund = parseZeile(zeile);
      if (fund) funde.push({ datei, zeile: i + 1, ...fund });
    });
  }
  return { funde, unvollstaendig: funde.filter((f) => !f.vollstaendig).length, geprueft, uebersprungen };
}

function zeileFuer(f) {
  if (f.vollstaendig) return `${f.datei}:${f.zeile}  ${f.grenze} → ${f.ausbau}`;
  const fehlt = [!f.grenze && 'Grenze', !f.ausbau && (f.grenze ? 'wann ausbauen' : 'Zeitpunkt')].filter(Boolean).join(' und ');
  return `${f.datei}:${f.zeile}  ${f.grenze || '(Grenze fehlt)'} → ${f.ausbau ? `${f.ausbau} ` : ''}(unvollständig: ${fehlt} fehlt)`;
}

/** Führt `ponytail-debt` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    const { pos, opt } = zerlege(argv, { schalter: ['--streng', '--json'] });
    if (pos.length) throw new Bedienfehler(`keine Positionsargumente erwartet (${pos.join(' ')}); siehe --hilfe`);
    const gitWurzel = git(ordner, ['rev-parse', '--show-toplevel']);
    const ergebnis = sammle(gitWurzel || ordner, { mitGit: Boolean(gitWurzel) });
    const { funde, unvollstaendig, geprueft, uebersprungen } = ergebnis;
    if (opt.json) io.aus(JSON.stringify(ergebnis, null, 2));
    else {
      const summe = `${geprueft} Dateien geprüft, ${uebersprungen} übersprungen (Markdown, binär, über 1 MB oder nicht lesbar)`;
      io.aus(funde.length
        ? `${funde.map(zeileFuer).join('\n')}\n${funde.length} Abkürzung(en), ${unvollstaendig} unvollständig. ${summe}`
        : `Keine Abkürzungen mit Marke gefunden. ${summe}`);
    }
    return opt.streng && unvollstaendig ? 1 : 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) {
      io.fehler(`ponytail-debt: ${fehler.message}`);
      return 2;
    }
    io.fehler(`ponytail-debt: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
