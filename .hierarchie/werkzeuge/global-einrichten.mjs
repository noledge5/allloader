#!/usr/bin/env node
/**
 * hierarchie global-einrichten [--cloud] [--uebernehmen] [--home <ordner>]
 *
 * Lädt gedaechtnis/ARBEITSWEISE.md nutzerweit, also in jede Sitzung, unabhängig vom Projekt.
 *   --cloud        gibt ein Setup-Skript für die Cloud-Umgebung aus (Datei eingebettet, mit Versionsmarke);
 *                  Cloud-Sitzungen lesen kein lokales ~/.claude, aber das Setup-Skript darf ~/.claude/CLAUDE.md schreiben
 *                  (docs/fakten-claude-code.md, Abschnitt Cloud-Sitzungen)
 *   sonst          setzt in ~/.claude/CLAUDE.md einen Block mit @-Import auf diesen Klon; ohne --uebernehmen nur Trockenlauf,
 *                  vor einer Änderung wird die vorhandene Datei gesichert
 * Läuft nur aus dem hierarchie-Repo (dort liegt gedaechtnis/ARBEITSWEISE.md).
 */
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { setzeBlock } from './lib/bloecke.mjs';
import { sha256 } from './lib/hash.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';

const QUELLE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'gedaechtnis', 'ARBEITSWEISE.md');
const ANFANG = '<!-- hierarchie:arbeitsweise:anfang -->';
const ENDE = '<!-- hierarchie:arbeitsweise:ende -->';
const TRENNER = 'HIERARCHIE_ARBEITSWEISE_ENDE';

const HILFE = `Aufruf: hierarchie global-einrichten [--cloud] [--uebernehmen] [--home <ordner>]

Lädt ARBEITSWEISE.md nutzerweit, also in jede Sitzung, unabhängig vom Projekt.

  --cloud          Setup-Skript für die Cloud-Umgebung auf stdout (ARBEITSWEISE.md eingebettet, mit Versionsmarke).
                   Einfügen: Umgebung bearbeiten → Setup-Skript. Nach jeder Änderung an ARBEITSWEISE.md neu erzeugen.
                   Prüfen in der nächsten Cloud-Sitzung: /context zeigt /root/.claude/CLAUDE.md unter Memory files.
  (ohne --cloud)   Mac/Windows/Linux: Block mit @-Import auf diesen Klon in ~/.claude/CLAUDE.md. Ohne --uebernehmen
                   nur Trockenlauf; vorhandene Datei wird vor einer Änderung gesichert (CLAUDE.md.sicherung-<zeit>).
  --uebernehmen    wirklich schreiben (nur ohne --cloud)
  --home <ordner>  statt des eigenen Benutzerordners (zum Testen)

Läuft nur aus dem hierarchie-Repo. Exit-Code: 0 ok · 1 Fehler (Quelle fehlt, Block defekt) · 2 Bedienfehler`;

/** Setup-Skript, das ~/.claude/CLAUDE.md mit dem Inhalt schreibt; erste Zeile der Datei trägt die Versionsmarke. */
export function setupSkript(inhalt) {
  const text = inhalt.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
  if (text.split('\n').includes(TRENNER)) throw new Error(`ARBEITSWEISE.md enthält die Zeile ${TRENNER} – Skript wäre kaputt`);
  return [
    '#!/bin/bash',
    `# hierarchie: ARBEITSWEISE.md als nutzerweite Anweisung (erzeugt mit \`hierarchie global-einrichten --cloud\`)`,
    'mkdir -p ~/.claude',
    `cat > ~/.claude/CLAUDE.md <<'${TRENNER}'`,
    `<!-- hierarchie:arbeitsweise ${sha256(text).slice(0, 12)} -->`,
    `${text}${TRENNER}`,
    '',
  ].join('\n');
}

// Zwei Läufe in derselben Sekunde: -2, -3 … anhängen statt die erste Sicherung zu überschreiben.
function freierName(name) {
  let kandidat = name;
  for (let n = 2; existsSync(kandidat); n++) kandidat = `${name}-${n}`;
  return kandidat;
}

const zeitstempel = (jetzt) => jetzt.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/** Führt `global-einrichten` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { jetzt = new Date() } = {}) {
  try {
    if (argv.some((a) => ['--hilfe', '--help', '-h'].includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    const { pos, opt } = zerlege(argv, { mitWert: ['--home'], schalter: ['--cloud', '--uebernehmen'] });
    if (pos.length) throw new Bedienfehler(`keine Positionsargumente erwartet (${pos.join(' ')}); siehe --hilfe`);
    if (opt.cloud && (opt.uebernehmen || opt.home)) throw new Bedienfehler('--cloud gibt nur ein Skript aus; --uebernehmen und --home gelten nur lokal');
    if (!existsSync(QUELLE)) {
      io.fehler(`hierarchie global-einrichten: ${QUELLE} fehlt – nur aus dem hierarchie-Repo aufrufen`);
      return 1;
    }

    if (opt.cloud) {
      io.aus(setupSkript(readFileSync(QUELLE, 'utf8')).replace(/\n$/, ''));
      return 0;
    }

    const datei = join(resolve(opt.home ?? homedir()), '.claude', 'CLAUDE.md');
    const bytes = existsSync(datei) ? readFileSync(datei) : Buffer.alloc(0);
    const vorher = bytes.toString('utf8');
    if (!Buffer.from(vorher, 'utf8').equals(bytes)) {
      io.fehler(`hierarchie global-einrichten: ${datei} ist nicht als UTF-8 gespeichert – nichts geschrieben (Datei in UTF-8 umwandeln)`);
      return 1;
    }
    // ponytail: @-Import mit Leerzeichen im Pfad ist ungeprüft, bei erstem Fall Pfad in ~/.claude kopieren
    const ergebnis = setzeBlock(vorher, ANFANG, ENDE, `@${QUELLE.replaceAll('\\', '/')}`);
    if (ergebnis.status === 'defekt') {
      io.fehler(`hierarchie global-einrichten: ${datei} hat ${ANFANG} ohne ${ENDE} – bitte von Hand reparieren, nichts geschrieben`);
      return 1;
    }
    if (ergebnis.status === 'unveraendert') {
      io.aus(`= unverändert  ${datei}`);
      return 0;
    }
    const sicherung = vorher ? freierName(`${datei}.sicherung-${zeitstempel(jetzt)}`) : null;
    io.aus(`${vorher ? '~ ändern' : '+ neu   '}  ${datei}${sicherung ? ` (Sicherung: ${sicherung})` : ''}`);
    if (!opt.uebernehmen) {
      io.aus('Trockenlauf – mit --uebernehmen schreiben.');
      return 0;
    }
    mkdirSync(dirname(datei), { recursive: true });
    if (sicherung) copyFileSync(datei, sicherung, constants.COPYFILE_EXCL); // nie eine ältere Sicherung überschreiben
    writeFileSync(datei, ergebnis.text);
    return 0;
  } catch (fehler) {
    io.fehler(`hierarchie global-einrichten: ${fehler.message}`);
    return fehler instanceof Bedienfehler ? 2 : 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
