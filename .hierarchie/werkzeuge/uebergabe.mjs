#!/usr/bin/env node
/**
 * hierarchie uebergabe – Kurzstand für eine neue Sitzung (höchstens 30 Zeilen).
 *
 *   uebergabe    Branch, letzte 5 Commits, uncommittete Dateien, UTS-Status, STAND.md-Zeile, offene Pläne, offene Kandidaten,
 *                „Anderswo offen“ (nur wenn projekte.json erreichbar ist, siehe projekte.mjs)
 *
 * Fehlt Git, Plan oder Register, entfällt die jeweilige Angabe bzw. steht dort „keine“. Schreibt nichts.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { git, gitBytes } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { ermittleOrte, liesRegister } from './lib/register.mjs';
import { sammle, utsStatusZeile } from './lib/sammeln.mjs';
import { main as planMain } from './plan.mjs';
import { anderswoZeile } from './projekte.mjs';
import { standZeile } from './stand.mjs';

const MAX_ZEILEN = 30;
const HILFE = `Aufruf: hierarchie uebergabe

  Kurzstand für eine neue Sitzung, höchstens ${MAX_ZEILEN} Zeilen: Branch, letzte 5 Commits, uncommittete Dateien (Anzahl, bis 10 Pfade),
  UTS-Status (uts --status), Zustand von STAND.md (aktuell/veraltet/fehlt), offene Pläne (plan zeige), offene Kandidaten im Register,
  „Anderswo offen“ aus der Projektübersicht (nur wenn gedaechtnis/projekte.json erreichbar ist). Schreibt nichts.
Exit-Code: 0 (auch wenn Git, Plan oder Register fehlen)`;

const kuerze = (text, n = 110) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function gitAbschnitte(basis) {
  if (git(basis, ['rev-parse', '--is-inside-work-tree']) !== 'true') return [];
  const branch = git(basis, ['symbolic-ref', '--short', '-q', 'HEAD']) ?? `losgelöst bei ${git(basis, ['rev-parse', '--short', 'HEAD']) ?? '?'}`;
  const commits = (git(basis, ['log', '-5', '--format=%h %s']) ?? '').split('\n').filter(Boolean);
  const geaendert = (gitBytes(basis, ['status', '--porcelain', '-uall'], 1 << 26)?.toString('utf8') ?? '').split('\n').filter(Boolean);
  return [
    `Branch: ${branch}`,
    ...(commits.length ? ['Letzte Commits:', ...commits.map((c) => `  ${kuerze(c)}`)] : ['Letzte Commits: keine']),
    geaendert.length
      ? `Uncommittet: ${geaendert.length} Datei(en)`
      : 'Uncommittet: keine',
    ...geaendert.slice(0, 10).map((z) => `  ${z.trim()}`),
    ...(geaendert.length > 10 ? [`  … und ${geaendert.length - 10} weitere`] : []),
  ];
}

/** Führt `uebergabe` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { orte = ermittleOrte() } = {}) {
  if (argv.some((a) => ['--hilfe', '--help', '-h'].includes(a))) { io.aus(HILFE); return 0; }
  if (argv.length) { io.fehler(`uebergabe: keine Argumente erwartet (${argv.join(' ')}); siehe --hilfe`); return 2; }
  const basis = orte.projektBasis;
  const zeilen = gitAbschnitte(basis);
  const uts = await utsStatusZeile(basis, orte);
  zeilen.push(uts.startsWith('UTS') ? uts : `UTS: ${uts}`, standZeile(basis));
  const plaene = await sammle((aus) => planMain(['zeige'], { aus, fehler: aus }, { orte }));
  const kandidaten = [orte.eigenes, orte.projekt].filter(Boolean).map(liesRegister)
    .flatMap((r) => (Array.isArray(r.daten?.kandidaten) ? r.daten.kandidaten : []))
    .filter((k) => k?.entscheidung === 'offen').map((k) => k.name);
  const kandidatenZeile = `Offene Kandidaten: ${kandidaten.length ? kuerze(kandidaten.join(', '), 200) : 'keine'}`;
  const anderswo = anderswoZeile(orte);
  const platz = Math.max(2, MAX_ZEILEN - zeilen.length - 2 - (anderswo ? 1 : 0));
  const planZeilen = plaene.length > platz ? [...plaene.slice(0, platz - 1), `… und ${plaene.length - platz + 1} weitere Zeilen (plan zeige)`] : plaene;
  zeilen.push(...(plaene.length && !/^Keine offenen Pläne/.test(plaene[0]) ? ['Offene Pläne:', ...planZeilen.map((z) => `  ${kuerze(z, 140)}`)] : ['Offene Pläne: keine']), kandidatenZeile, ...(anderswo ? [anderswo] : []));
  io.aus(zeilen.slice(0, MAX_ZEILEN).join('\n'));
  return 0;
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
