#!/usr/bin/env node
/**
 * hierarchie aenderungsliste – Commits nach Präfix gruppiert als Markdown.
 *
 *   aenderungsliste [<von>..<bis>]    ohne Bereich: seit dem letzten Tag, gibt es keinen: die letzten 20 Commits
 *
 * Nur Bericht auf stdout; schreibt nichts. Merge-Commits fehlen.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { git } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';

const GRUPPEN = ['feat', 'fix', 'docs', 'test', 'refactor', 'chore'];
const SONSTIGE = 'sonstige';
const ANZAHL = 20;
const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];
// Typ, optionaler Bereich in Klammern, optionales „!“ (Breaking), Doppelpunkt, Rest der Betreffzeile.
const PRAEFIX = /^([A-Za-z]+)(?:\(([^()]*)\))?!?:\s*(.+)$/;

const HILFE = `Aufruf: hierarchie aenderungsliste [<von>..<bis>]

  ohne Bereich     seit dem letzten Tag (git describe --tags); gibt es keinen: die letzten ${ANZAHL} Commits ohne Merges
  <von>..<bis>     Commits in diesem Bereich, z. B. v1.0.0..HEAD (Tags, Branches oder Hashes)

Gruppen in fester Reihenfolge: ${GRUPPEN.join(', ')}, ${SONSTIGE} (alles ohne oder mit anderem Präfix).
Eine Zeile je Commit: **(Bereich)** Betreff (Kurz-Hash). Merge-Commits fehlen. Ausgabe nur auf stdout; schreibt keine Datei.
Exit-Code: 0 ok · 1 git-Fehler · 2 Bedienfehler (kein Git-Repository, ungültiger oder unbekannter Bereich, unbekannte Option)`;

/** Commits aus `git log` (Zeilen „Kurz-Hash Betreff“) in Gruppen einordnen; Reihenfolge der Gruppen fest. */
function gruppiere(commits) {
  const gruppen = new Map([...GRUPPEN, SONSTIGE].map((name) => [name, []]));
  for (const { hash, betreff } of commits) {
    const treffer = PRAEFIX.exec(betreff);
    if (treffer && GRUPPEN.includes(treffer[1].toLowerCase())) {
      const bereich = treffer[2]?.trim();
      const text = treffer[3];
      gruppen.get(treffer[1].toLowerCase()).push(`${bereich ? `**(${bereich})** ` : ''}${text} (\`${hash}\`)`);
    } else {
      gruppen.get(SONSTIGE).push(`${betreff || '(ohne Betreff)'} (\`${hash}\`)`);
    }
  }
  return gruppen;
}

function holeCommits(ordner, argumente) {
  const roh = git(ordner, ['log', '--no-merges', '--format=%h %s', ...argumente]);
  if (roh === null) throw new Error('git log ist fehlgeschlagen');
  return roh.split('\n').filter(Boolean).map((zeile) => {
    const [hash, ...rest] = zeile.split(' ');
    return { hash, betreff: rest.join(' ') };
  });
}

/** Bereich „von..bis“: beide Seiten müssen Commits sein (vorher prüfen, damit git keine Optionen sieht). */
function bereichsCommits(ordner, text) {
  const teile = text.split('..');
  if (teile.length !== 2 || teile.some((teil) => teil.trim() === '')) {
    throw new Bedienfehler(`Bereich „${text}“ ungültig; erwartet <von>..<bis> (z. B. v1.0.0..HEAD)`);
  }
  for (const ref of teile) {
    if (ref.startsWith('-') || git(ordner, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) {
      throw new Bedienfehler(`„${ref}“ ist kein Commit in diesem Repository`);
    }
  }
  return { titel: text, commits: holeCommits(ordner, [text]) };
}

/** Ohne Bereich: seit dem letzten Tag, sonst die letzten Commits. */
function standardCommits(ordner) {
  const tag = git(ordner, ['describe', '--tags', '--abbrev=0']);
  if (tag) return { titel: `${tag}..HEAD`, commits: holeCommits(ordner, [`${tag}..HEAD`]) };
  if (git(ordner, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) === null) {
    return { titel: 'HEAD', commits: [], leer: 'Noch keine Commits.' };
  }
  return { titel: `letzte ${ANZAHL} Commits (ohne Merges)`, commits: holeCommits(ordner, ['-n', String(ANZAHL), 'HEAD']) };
}

function markdown({ titel, commits, leer }) {
  const zeilen = [`# Änderungsliste: ${titel}`, ''];
  if (commits.length === 0) zeilen.push(leer ?? '_Keine Commits im Bereich._');
  for (const [name, eintraege] of gruppiere(commits)) {
    if (eintraege.length === 0) continue;
    zeilen.push(`## ${name}`, ...eintraege.map((eintrag) => `- ${eintrag}`), '');
  }
  return zeilen.join('\n').trimEnd();
}

/** Führt `aenderungsliste` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    const { pos } = zerlege(argv);
    if (pos.length > 1) throw new Bedienfehler(`nur ein Bereich erlaubt (${pos.join(' ')}); erwartet: aenderungsliste [<von>..<bis>]`);
    if (git(ordner, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
      throw new Bedienfehler('kein Git-Repository im aktuellen Ordner (oder git fehlt)');
    }
    io.aus(markdown(pos.length ? bereichsCommits(ordner, pos[0]) : standardCommits(ordner)));
    return 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) {
      io.fehler(`aenderungsliste: ${fehler.message}`);
      return 2;
    }
    io.fehler(`aenderungsliste: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
