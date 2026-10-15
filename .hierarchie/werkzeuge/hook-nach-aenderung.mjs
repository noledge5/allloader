#!/usr/bin/env node
/**
 * PostToolUse-Hook (Edit|Write|MultiEdit): führt nach jeder Dateiänderung die Tests aus, die zu genau
 * dieser Datei gehören (`uts.mjs --zu <datei> --kurz`).
 *
 * Eingabe (stdin, JSON): tool_input.file_path (absolut, unter Windows mit `\`) und cwd.
 * Ausgang: grün oder kein Test ⇒ Exit 0 ohne Ausgabe. Rot ⇒ Exit 2 und die kompakte Fehlerausgabe
 * auf stderr (Rückmeldung an Claude). Alles andere (fehlendes oder kaputtes JSON, Datei außerhalb
 * des Projekts, Zeitüberschreitung, Bedienfehler der UTS) ⇒ Exit 0 still: ein Hook darf die Arbeit
 * nie blockieren, nur ein echter Testfehler tut es.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { istStartdatei } from './lib/modul.mjs';
import { normalisiere, relativZumProjekt } from './lib/pfade.mjs';

const UTS = join(dirname(fileURLToPath(import.meta.url)), 'uts.mjs');
const ZEITLIMIT_MS = 50_000; // knapp unter dem timeout (60 s) in settings.json
const MAX_AUSGABE = 4000;
const UEBERSPRINGEN = new Set(['node_modules', '.git', '.next', '.uts', 'dist', 'build', 'coverage']);

/** Projektordner: CLAUDE_PROJECT_DIR, sonst der nächste übergeordnete Ordner mit .hierarchie oder .git, sonst cwd. */
export function projektOrdner(cwd, env = process.env) {
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  let ordner = normalisiere(cwd);
  for (;;) {
    if (existsSync(join(ordner, '.hierarchie')) || existsSync(join(ordner, '.git'))) return ordner;
    const eltern = normalisiere(`${ordner}/..`);
    if (eltern === ordner || eltern === '.') return cwd;
    ordner = eltern;
  }
}

/** Die Datei relativ zum Projekt oder null, wenn die UTS nichts zu tun hat (außerhalb, Abhängigkeiten, …). */
export function zuPruefendeDatei(eingabe, env = process.env) {
  const datei = eingabe?.tool_input?.file_path;
  const cwd = typeof eingabe?.cwd === 'string' && eingabe.cwd !== '' ? eingabe.cwd : env.CLAUDE_PROJECT_DIR;
  if (typeof datei !== 'string' || datei === '' || !cwd) return null;
  const projekt = projektOrdner(cwd, env);
  const relativ = relativZumProjekt(datei, projekt, cwd);
  if (relativ === null || relativ.split('/').some((teil) => UEBERSPRINGEN.has(teil))) return null;
  return { projekt, relativ };
}

function leseStdin() {
  return new Promise((fertig) => {
    if (process.stdin.isTTY) { fertig(''); return; }
    const teile = [];
    process.stdin.on('data', (teil) => teile.push(teil));
    process.stdin.on('end', () => fertig(Buffer.concat(teile).toString('utf8')));
    process.stdin.on('error', () => fertig(''));
  });
}

/** Läuft die UTS für die Datei; liefert { code, meldung } (code 2 = Testfehler zurückmelden). */
export function pruefe(eingabe, { env = process.env, uts = UTS } = {}) {
  const ziel = zuPruefendeDatei(eingabe, env);
  if (ziel === null) return { code: 0 };
  const lauf = spawnSync(process.execPath, [uts, '--zu', ziel.relativ, '--kurz'], {
    cwd: ziel.projekt,
    encoding: 'utf8',
    timeout: ZEITLIMIT_MS,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  if (lauf.error || lauf.status !== 1) return { code: 0 }; // grün (0), Bedienfehler (2), Zeitlimit, Startfehler: still
  let meldung = (lauf.stdout || lauf.stderr || '').trim();
  if (meldung.length > MAX_AUSGABE) meldung = `${meldung.slice(0, MAX_AUSGABE - 1)}…`;
  return { code: 2, meldung: meldung || `UTS rot nach Änderung an ${ziel.relativ}` };
}

/** Hook-Eintritt: `eingabeText` ist der Inhalt von stdin; liefert den Exit-Code (Meldung auf stderr). */
export function main(eingabeText, optionen = {}, fehler = (text) => process.stderr.write(`${text}\n`)) {
  let eingabe;
  try {
    eingabe = JSON.parse(eingabeText.replace(/^﻿/, ''));
  } catch {
    return 0;
  }
  try {
    const ergebnis = pruefe(eingabe, optionen);
    if (ergebnis.code === 2) fehler(ergebnis.meldung);
    return ergebnis.code;
  } catch {
    return 0;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(await leseStdin());
