#!/usr/bin/env node
/**
 * hierarchie geheimnis-scan – Mustererkennung für Geheimnisse in versionierten Dateien.
 *
 *   geheimnis-scan [--gestaged] [--json]
 *
 * Meldet nur `datei:zeile  art`; der gefundene Wert wird nie ausgegeben (weder auf stdout noch stderr noch in JSON).
 * Kein Ersatz für Secret-Scanning von GitHub. Schreibt nichts.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { git, gitBytes } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';

const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];
const MAX_BYTES = 1024 * 1024;
const MAX_ZEILE = 2000;
const AUSNAHMEN_DATEI = '.hierarchie-geheimnis-ausnahmen';

const HILFE = `Aufruf: hierarchie geheimnis-scan [--gestaged] [--json]

  Sucht in den von Git versionierten Dateien (git ls-files, Inhalt der Arbeitskopie) nach Geheimnis-Mustern:
    privater-schluessel   -----BEGIN … PRIVATE KEY-----
    openai-schluessel     sk-… (auch sk-proj-, sk-ant-)
    github-token          ghp_/gho_/ghu_/ghs_/ghr_… und github_pat_…
    aws-zugangsschluessel AKIA…/ASIA… (20 Zeichen)
    supabase-service-role JWT, dessen Nutzlast role=service_role enthält
    env-datei             .env, .env.* (außer .example/.sample/.template/.dist) im Git-Index
    zuweisung             password=/passwort=/secret=/api_key= mit plausiblem Wert
  --gestaged   nur gestagte Dateien, Inhalt aus dem Index (git diff --cached, git show :pfad) – für einen pre-commit-Hook
  --json       { funde: [{ datei, zeile, art }], geprueft, uebersprungen }
  Binärdateien und Dateien über 1 MB werden übersprungen.
  Ausnahmen: ${AUSNAHMEN_DATEI} im Projekt (eine Pfadmuster-Zeile je Eintrag, # = Kommentar; * ohne /, ** mit /;
  ohne / im Muster gilt es für den Dateinamen in jedem Ordner).

Ausgabe: eine Zeile je Fund \`datei:zeile  art\`. Der gefundene Wert wird nie ausgegeben.
Mustererkennung mit Grenzen: findet nicht jedes Geheimnis und meldet auch Harmloses. Kein Ersatz für Secret-Scanning von GitHub.
Exit-Code: 0 nichts gefunden · 1 Fund · 2 Bedienfehler (kein Git-Repository)`;

// ---------------------------------------------------------------- Muster

const base64url = (text) => {
  try { return Buffer.from(text.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'); } catch { return ''; }
};

const ZEILENMUSTER = [
  { art: 'privater-schluessel', muster: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { art: 'openai-schluessel', muster: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{31,}/g, pruefe: (wert) => /\d/.test(wert) },
  { art: 'github-token', muster: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { art: 'aws-zugangsschluessel', muster: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    art: 'supabase-service-role',
    muster: /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g,
    pruefe: (_wert, nutzlast) => /"role"\s*:\s*"service_role"/.test(base64url(nutzlast)),
  },
];

const ZUWEISUNG_NAME = /(?:password|passwort|passwd|secret|api[_-]?key)/i;
const ZUWEISUNG = /(?:password|passwort|passwd|secret|api[_-]?key)[\w.-]*["']?\s*[:=]\s*(?:"([^"\s]{6,})"|'([^'\s]{6,})'|([^\s"',;]{6,}))/gi;

/** Ein Zuweisungswert gilt nur als Fund, wenn er nicht wie Platzhalter, Verweis oder Code aussieht. */
function plausiblerWert(wert) {
  if (/^[$<{%[(*.~/\\@]/.test(wert) || /[()<>${}`]/.test(wert)) return false; // Verweis, Platzhalter, Aufruf, Pfad
  if (/^(?:process|os|env|import|config|settings|self|this|args|options)\b/i.test(wert)) return false;
  if (/^(?:x+|\*+|\.+|-+|_+|changeme|change-me|example|dummy|test|placeholder|redacted|your[-_]\w*|none|null|nil|true|false|undefined|string|secret|password)$/i.test(wert)) return false;
  return /[0-9]/.test(wert) || /[!#%^&*+=?~]/.test(wert); // reiner Bezeichner (`secret_name`) ist kein Wert
}

/** Arten, die in dieser Zeile vorkommen (jede Art höchstens einmal; der Treffer selbst wird nicht weitergegeben). */
function artenInZeile(zeile) {
  const arten = [];
  for (const { art, muster, pruefe } of ZEILENMUSTER) {
    muster.lastIndex = 0;
    for (const t of zeile.matchAll(muster)) {
      if (!pruefe || pruefe(t[0], t[1])) { arten.push(art); break; }
    }
  }
  if (zeile.length <= MAX_ZEILE && ZUWEISUNG_NAME.test(zeile)) {
    for (const t of zeile.matchAll(ZUWEISUNG)) {
      if (plausiblerWert(t[1] ?? t[2] ?? t[3])) { arten.push('zuweisung'); break; }
    }
  }
  return arten;
}

const istEnvDatei = (pfad) => {
  const name = pfad.slice(pfad.lastIndexOf('/') + 1);
  return (name === '.env' || name.startsWith('.env.')) && !/\.(?:example|sample|template|dist)$/i.test(name);
};

const istBinaer = (inhalt) => inhalt.subarray(0, 8000).includes(0);

// ---------------------------------------------------------------- Ausnahmen

function musterZuRegex(muster) {
  let text = muster.trim().replace(/^\.\//, '');
  const anker = text.startsWith('/') || text.slice(0, -1).includes('/');
  let ordner = text.endsWith('/');
  if (text.endsWith('/**')) { text = text.slice(0, -2); ordner = true; }
  text = text.replace(/^\//, '').replace(/\/$/, '');
  const koerper = text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replaceAll('\u0000', '(?:.*/)?').replaceAll('\u0001', '.*');
  return new RegExp(`^${anker ? '' : '(?:.*/)?'}${koerper}${ordner ? '/.*' : '(?:/.*)?'}$`);
}

function ladeAusnahmen(wurzel) {
  const pfad = join(wurzel, AUSNAHMEN_DATEI);
  if (!existsSync(pfad)) return () => false;
  const regeln = readFileSync(pfad, 'utf8').split(/\r?\n/).map((z) => z.trim()).filter((z) => z && !z.startsWith('#')).map(musterZuRegex);
  return (datei) => regeln.some((r) => r.test(datei));
}

// ---------------------------------------------------------------- Dateien und Scan

function dateienUndInhalt(wurzel, gestaged) {
  if (gestaged) {
    const roh = gitBytes(wurzel, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], 1 << 28);
    const namen = (roh ?? Buffer.alloc(0)).toString('utf8').split('\0').filter(Boolean);
    return { namen, inhalt: (datei) => gitBytes(wurzel, ['show', `:${datei}`], MAX_BYTES + 1) };
  }
  const roh = gitBytes(wurzel, ['ls-files', '-z'], 1 << 28);
  if (roh === null) throw new Error('git ls-files ist fehlgeschlagen');
  const namen = [...new Set(roh.toString('utf8').split('\0').filter(Boolean))];
  return {
    namen,
    inhalt: (datei) => {
      try {
        const pfad = join(wurzel, datei);
        return statSync(pfad).isFile() && statSync(pfad).size <= MAX_BYTES ? readFileSync(pfad) : null;
      } catch { return null; }
    },
  };
}

/** Scannt die Dateien; liefert { funde: [{ datei, zeile, art }], geprueft, uebersprungen }. */
export function scanne(wurzel, { gestaged = false } = {}) {
  const ausgenommen = ladeAusnahmen(wurzel);
  const { namen, inhalt } = dateienUndInhalt(wurzel, gestaged);
  const funde = [];
  let geprueft = 0;
  let uebersprungen = 0;
  for (const datei of namen.sort()) {
    if (ausgenommen(datei)) continue;
    if (istEnvDatei(datei)) funde.push({ datei, zeile: 1, art: 'env-datei' });
    const bytes = inhalt(datei);
    if (bytes === null || bytes.length > MAX_BYTES || istBinaer(bytes)) { uebersprungen++; continue; }
    geprueft++;
    bytes.toString('utf8').split(/\r?\n/).forEach((zeile, i) => {
      for (const art of artenInZeile(zeile)) funde.push({ datei, zeile: i + 1, art });
    });
  }
  return { funde, geprueft, uebersprungen };
}

/** Führt `geheimnis-scan` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    const { pos, opt } = zerlege(argv, { schalter: ['--gestaged', '--json'] });
    if (pos.length) throw new Bedienfehler(`keine Positionsargumente erwartet (${pos.join(' ')}); siehe --hilfe`);
    const wurzel = git(ordner, ['rev-parse', '--show-toplevel']);
    if (!wurzel) throw new Bedienfehler('kein Git-Repository im aktuellen Ordner (oder git fehlt)');
    const ergebnis = scanne(wurzel, { gestaged: opt.gestaged === true });
    if (opt.json) io.aus(JSON.stringify(ergebnis, null, 2));
    else {
      const { funde, geprueft, uebersprungen } = ergebnis;
      const summe = `${geprueft} Dateien geprüft, ${uebersprungen} übersprungen (binär, über 1 MB oder nicht lesbar)`;
      io.aus(funde.length
        ? `${funde.map((f) => `${f.datei}:${f.zeile}  ${f.art}`).join('\n')}\n${funde.length} Fund(e) – Werte werden nie ausgegeben. ${summe}`
        : `Keine Funde. ${summe}`);
    }
    return ergebnis.funde.length ? 1 : 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) {
      io.fehler(`geheimnis-scan: ${fehler.message}`);
      return 2;
    }
    io.fehler(`geheimnis-scan: Fehler: ${fehler?.message ?? fehler}`); // nie Dateiinhalt: Meldungen stammen von git/fs, nicht aus dem Scan
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
