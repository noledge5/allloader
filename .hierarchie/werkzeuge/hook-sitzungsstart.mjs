#!/usr/bin/env node
/**
 * SessionStart-Hook: richtet in Cloud-Sitzungen die Abhängigkeiten ein und gibt den Kurzstand aus.
 *
 * 1. Nur wenn CLAUDE_CODE_REMOTE === "true" UND package-lock.json existiert UND node_modules fehlt ⇒
 *    `npm ci` und eine Zeile Ergebnis auf stdout. Idempotent (danach existiert node_modules);
 *    ein Fehler von npm ergibt nur eine Hinweiszeile.
 * 2. Immer danach: die Ausgabe von `uebergabe` (höchstens 30 Zeilen; bei SessionStart landet stdout im Kontext der
 *    Sitzung). Scheitert `uebergabe`, steht dort nur eine Hinweiszeile.
 * Der Exit-Code bleibt immer 0.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { istStartdatei } from './lib/modul.mjs';

const ZEITLIMIT_MS = 280_000; // unter dem timeout (300 s) in settings.json

/** Das zur Plattform passende npm. Unter Windows ist es eine .cmd-Datei und braucht die Shell (feste Argumente, keine Shell-Syntax). */
export function npmAufruf(plattform = process.platform) {
  return plattform === 'win32'
    ? { befehl: 'npm.cmd', shell: true }
    : { befehl: 'npm', shell: false };
}

function npmCi(projekt) {
  const { befehl, shell } = npmAufruf();
  const lauf = spawnSync(befehl, ['ci'], {
    cwd: projekt, encoding: 'utf8', timeout: ZEITLIMIT_MS, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: lauf.error ? null : lauf.status, fehler: lauf.error, ausgabe: `${lauf.stderr ?? ''}\n${lauf.stdout ?? ''}` };
}

/** Liefert die Ergebniszeile oder null, wenn nichts zu tun war. `starte` ist für Tests austauschbar. */
export function sitzungsstart({ env = process.env, projekt = env.CLAUDE_PROJECT_DIR || process.cwd(), starte = npmCi } = {}) {
  if (env.CLAUDE_CODE_REMOTE !== 'true') return null;
  if (!existsSync(join(projekt, 'package-lock.json')) || existsSync(join(projekt, 'node_modules'))) return null;

  const start = Date.now();
  const ergebnis = starte(projekt);
  const sekunden = ((Date.now() - start) / 1000).toFixed(1);
  if (ergebnis.status === 0) return `hierarchie: npm ci ausgeführt (${sekunden} s), node_modules ist da.`;
  const grund = ergebnis.fehler
    ? `npm nicht startbar (${ergebnis.fehler.code ?? ergebnis.fehler.message})`
    : `Exit ${ergebnis.status}`;
  const letzte = ergebnis.ausgabe.split(/\r?\n/).map((z) => z.trim()).filter(Boolean).find((z) => /^npm (error|ERR!)/i.test(z));
  return `hierarchie: npm ci fehlgeschlagen (${grund}${letzte ? `: ${letzte.slice(0, 160)}` : ''}) – bitte von Hand ausführen.`;
}

/** Hook-Eintritt; liefert den Exit-Code (immer 0). */
export function main(optionen = {}, aus = (text) => process.stdout.write(`${text}\n`)) {
  try {
    const zeile = sitzungsstart(optionen);
    if (zeile) aus(zeile);
  } catch (fehler) {
    aus(`hierarchie: Sitzungsstart-Hook übersprungen (${fehler?.message ?? fehler}).`);
  }
  return 0;
}

const MAX_UEBERGABE_ZEILEN = 30;

/**
 * Gibt die Ausgabe von `uebergabe` über `aus` aus (je Zeile ein Aufruf, höchstens 30 Zeilen). Fehler ⇒ eine Hinweiszeile.
 * Im hierarchie-Repo (Orte im Modus „repo“) gilt der Projektordner aus CLAUDE_PROJECT_DIR bzw. der Arbeitsordner;
 * als Projektkopie (`.hierarchie/`) das Projekt, in dem die Kopie liegt.
 */
export async function uebergabeAusgeben({ env = process.env, aus = (text) => process.stdout.write(`${text}\n`), orte } = {}) {
  try {
    const gefunden = orte ?? (await import('./lib/register.mjs')).ermittleOrte();
    const verwendet = gefunden.modus === 'repo' ? { ...gefunden, projektBasis: resolve(env.CLAUDE_PROJECT_DIR || process.cwd()) } : gefunden;
    const zeilen = [];
    const fehler = [];
    const { main: uebergabe } = await import('./uebergabe.mjs');
    const code = await uebergabe([], { aus: (t) => zeilen.push(...String(t).split('\n')), fehler: (t) => fehler.push(String(t)) }, { orte: verwendet });
    if (code !== 0) throw new Error(fehler.join(' ').trim() || `Exit ${code}`);
    for (const zeile of zeilen.filter((z) => z.trim() !== '').slice(0, MAX_UEBERGABE_ZEILEN)) aus(zeile);
  } catch (fehler) {
    aus(`hierarchie: Übergabe nicht verfügbar (${String(fehler?.message ?? fehler).split('\n')[0].slice(0, 160)}).`);
  }
}

/** Gesamter Hook: npm-Teil (`main`), dann die Übergabe. Liefert den Exit-Code (immer 0). */
export async function hook(optionen = {}, aus = (text) => process.stdout.write(`${text}\n`)) {
  const code = main(optionen, aus);
  await uebergabeAusgeben({ env: optionen.env ?? process.env, aus, orte: optionen.orte });
  return code;
}

if (istStartdatei(import.meta.url)) process.exitCode = await hook();
