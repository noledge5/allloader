#!/usr/bin/env node
/**
 * hierarchie branches – lokale und Remote-Branches: gemergt? unbewegt? Nur Bericht, löscht nie.
 *
 *   branches [--tage N]    Standard 30: „unbewegt“ = letzter Commit der Spitze älter als N Tage
 *
 * „gemergt“ gilt gegen origin/HEAD, ohne origin/HEAD gegen den aktuellen Branch.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { git } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';

const STANDARD_TAGE = 30;
const TAG_MS = 86400000;
const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];
// Ein Tab zwischen den Feldern; %(symref) ist nur bei Zeigern wie origin/HEAD gesetzt.
const FORMAT = '--format=%(refname)\t%(symref)\t%(objectname)\t%(committerdate:unix)';

const HILFE = `Aufruf: hierarchie branches [--tage N]

  Listet lokale und Remote-Branches (origin/HEAD selbst nicht), eine Zeile je Branch, am Ende eine Zusammenfassung.
  gemergt          Branch-Spitze ist im Vergleichsbranch enthalten (origin/HEAD; ohne origin/HEAD: aktueller Branch)
  unbewegt seit    letzter Commit der Spitze ist älter als N Tage (Standard ${STANDARD_TAGE})
  --tage N         Schwelle in ganzen Tagen (≥ 1)

Nur Bericht: es wird nichts gelöscht, umbenannt, gepusht oder geholt.
Exit-Code: 0 ok · 1 git-Fehler · 2 Bedienfehler (--tage ungültig, kein Git-Repository)`;

function tageAus(wert) {
  if (wert === undefined) return STANDARD_TAGE;
  if (!/^\d+$/.test(wert) || Number(wert) < 1) throw new Bedienfehler(`--tage erwartet eine ganze Zahl ≥ 1 (war „${wert}“)`);
  return Number(wert);
}

/** Vergleichsbranch für „gemergt“: origin/HEAD, sonst der aktuelle Branch. */
function vergleichsref(ordner) {
  if (git(ordner, ['rev-parse', '--verify', '--quiet', 'origin/HEAD^{commit}']) !== null) {
    return { ref: 'origin/HEAD', anzeige: 'origin/HEAD' };
  }
  const aktuell = git(ordner, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return aktuell
    ? { ref: 'HEAD', anzeige: `aktueller Branch ${aktuell} (kein origin/HEAD)` }
    : { ref: 'HEAD', anzeige: 'HEAD (losgelöst, kein origin/HEAD)' };
}

/** Eine Zeile von for-each-ref; Zeiger (symref) wie refs/remotes/origin/HEAD fallen weg. */
function liesZeile(zeile) {
  const [ref, symref, sha, sekunden] = zeile.split('\t');
  if (symref) return null;
  if (ref.startsWith('refs/heads/')) return { art: 'lokal', name: ref.slice('refs/heads/'.length), sha, sekunden: Number(sekunden) };
  if (ref.startsWith('refs/remotes/')) return { art: 'remote', name: ref.slice('refs/remotes/'.length), sha, sekunden: Number(sekunden) };
  return null;
}

const datumVon = (sekunden) => new Date(sekunden * 1000).toISOString().slice(0, 10);

function berichte(ordner, tage) {
  const vergleich = vergleichsref(ordner);
  const roh = git(ordner, ['for-each-ref', FORMAT, 'refs/heads', 'refs/remotes']);
  if (roh === null) throw new Error('git for-each-ref ist fehlgeschlagen');
  const jetzt = Date.now();
  const branches = roh.split('\n').filter(Boolean).map(liesZeile).filter(Boolean).map((b) => {
    const gemergt = git(ordner, ['merge-base', '--is-ancestor', b.sha, vergleich.ref]) !== null;
    const alter = Math.floor((jetzt - b.sekunden * 1000) / TAG_MS);
    return { ...b, gemergt, alter, unbewegt: alter > tage };
  });
  return { vergleich, branches };
}

function bericht(tage, { vergleich, branches }) {
  const zeilen = [`Vergleich für „gemergt“: ${vergleich.anzeige} · „unbewegt“: letzter Commit älter als ${tage} Tage`, ''];
  if (branches.length === 0) zeilen.push('Keine Branches gefunden.');
  const breite = Math.max(0, ...branches.map((b) => b.name.length));
  for (const b of branches) {
    const merkmale = [b.gemergt ? 'gemergt' : 'nicht gemergt'];
    if (b.unbewegt) merkmale.push(`unbewegt seit ${b.alter} Tagen`);
    zeilen.push(`${b.art.padEnd(6)}  ${b.name.padEnd(breite)}  ${merkmale.join(' · ')}  (letzter Commit ${datumVon(b.sekunden)})`);
  }
  const lokal = branches.filter((b) => b.art === 'lokal').length;
  const gemergt = branches.filter((b) => b.gemergt).length;
  const unbewegt = branches.filter((b) => b.unbewegt).length;
  zeilen.push('', `Zusammenfassung: ${branches.length} Branches (${lokal} lokal, ${branches.length - lokal} remote) · ${gemergt} gemergt · `
    + `${unbewegt} unbewegt seit mehr als ${tage} Tagen · nur Bericht, nichts gelöscht`);
  return zeilen.join('\n');
}

/** Führt `branches` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    const { pos, opt } = zerlege(argv, { mitWert: ['--tage'] });
    if (pos.length) throw new Bedienfehler(`keine Positionsargumente erwartet (${pos.join(' ')}); siehe --hilfe`);
    const tage = tageAus(opt.tage);
    if (git(ordner, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
      throw new Bedienfehler('kein Git-Repository im aktuellen Ordner (oder git fehlt)');
    }
    io.aus(bericht(tage, berichte(ordner, tage)));
    return 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) {
      io.fehler(`branches: ${fehler.message}`);
      return 2;
    }
    io.fehler(`branches: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
