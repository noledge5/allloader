#!/usr/bin/env node
/**
 * hierarchie einrichten <projektordner> [--uebernehmen] [--modell <alias>]
 *
 * Kopiert Werkzeuge, Skills und Agents in ein Projekt und ergänzt Einstellungen, Hooks und CLAUDE.md.
 * Ohne --uebernehmen wird nichts geschrieben (Trockenlauf): Ausgabe ist die Liste der geplanten Aktionen
 *   + neu · ~ ändern · = unverändert · ! übersprungen
 * Ein zweiter Lauf direkt danach zeigt ausschließlich `=` (idempotent).
 * Spezifikation: docs/spezifikation/einrichten.md
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setzeBlock } from './lib/bloecke.mjs';
import { leseOderNull, listeDateien } from './lib/dateien.mjs';
import { hooksOrdner } from './lib/git.mjs';
import { sha256 } from './lib/hash.mjs';
import { erkenneFormat, formatiereJson, gleich, istObjekt, parseJson } from './lib/json.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { gleicherOrt, relativUnter } from './lib/pfade.mjs';
import { mischeSettings } from './lib/settings.mjs';

const QUELLE = dirname(dirname(fileURLToPath(import.meta.url)));
const ZIEL_WERKZEUGE = '.hierarchie/werkzeuge';
const MANIFEST = '.hierarchie/manifest.json';
// Vorlagen, die Werkzeuge im Projekt zur Laufzeit lesen (neues-werkzeug); landen unter .hierarchie/vorlagen/.
const LAUFZEIT_VORLAGEN = ['plan.md', 'STAND.md', 'app.html', 'app.test.mjs.vorlage', 'werkzeug.mjs.vorlage', 'werkzeug.test.mjs.vorlage'];
const STAND_TEST = 'automatisierung/stand.test.mjs';
const TEST_BEFEHL = 'node .hierarchie/werkzeuge/uts.mjs';
const NPM_STANDARD_TEST = 'echo "Error: no test specified" && exit 1';
const CLAUDE_ANFANG = '<!-- hierarchie:anfang -->';
const CLAUDE_ENDE = '<!-- hierarchie:ende -->';
const HOOK_ANFANG = '# hierarchie:anfang';
const HOOK_ENDE = '# hierarchie:ende';
const SHELL_SHEBANG = /^#!\s*(?:\/bin\/(?:ba)?sh|\/usr\/bin\/env\s+(?:ba)?sh)(?:\s|$)/;

const HILFE = `Aufruf: hierarchie einrichten <projektordner> [--uebernehmen] [--modell <alias>]

  <projektordner>   das Projekt, in das eingerichtet wird (muss existieren)
  --uebernehmen     wirklich schreiben; ohne diese Option nur Trockenlauf (es wird nichts geschrieben)
  --modell <alias>  setzt "model" in .claude/settings.json, falls dort noch keins steht

Ausgabe je Aktion:  + neu · ~ ändern · = unverändert · ! übersprungen: <grund>
Exit-Code: 0 ok · 1 Fehler (dann wurde nichts geschrieben) · 2 Bedienfehler`;

class Bedienfehler extends Error {}
class Abbruch extends Error {}

const ART = {
  neu: { zeichen: '+', text: 'neu' },
  aendern: { zeichen: '~', text: 'ändern' },
  gleich: { zeichen: '=', text: 'unverändert' },
  uebersprungen: { zeichen: '!', text: 'übersprungen' },
};

// ---------------------------------------------------------------- Argumente

function leseArgumente(argv) {
  const opt = { projekt: null, uebernehmen: false, modell: null, hilfe: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uebernehmen') opt.uebernehmen = true;
    else if (arg === '--hilfe' || arg === '--help' || arg === '-h') opt.hilfe = true;
    else if (arg === '--modell') {
      i++;
      if (i >= argv.length || argv[i] === '' || argv[i].startsWith('--')) throw new Bedienfehler('--modell erwartet einen Alias (z. B. sonnet).');
      opt.modell = argv[i];
    } else if (arg.startsWith('-')) throw new Bedienfehler(`Unbekannte Option: ${arg} (siehe --hilfe)`);
    else if (opt.projekt === null) opt.projekt = arg;
    else throw new Bedienfehler(`Nur ein Projektordner erlaubt, zusätzlich genannt: ${arg}`);
  }
  if (!opt.hilfe && opt.projekt === null) throw new Bedienfehler('Projektordner fehlt.\n\n' + HILFE);
  return opt;
}

// ---------------------------------------------------------------- Hilfen

const istOrdner = (pfad) => { try { return statSync(pfad).isDirectory(); } catch { return false; } };

function stempel(jetzt) {
  const z = (n) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}${z(jetzt.getMonth() + 1)}${z(jetzt.getDate())}-${z(jetzt.getHours())}${z(jetzt.getMinutes())}${z(jetzt.getSeconds())}`;
}

function schreibeDatei(pfad, inhalt, modus) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
  if (modus !== undefined && process.platform !== 'win32') chmodSync(pfad, modus);
}

function leseVorlage(name) {
  const pfad = join(QUELLE, 'vorlagen', name);
  const inhalt = leseOderNull(pfad);
  if (inhalt === null) {
    throw new Bedienfehler(`Vorlage fehlt: ${pfad}\nEinrichten muss aus einem vollständigen hierarchie-Repo (oder Plugin) gestartet werden, nicht aus einer Projektkopie.`);
  }
  return inhalt.toString('utf8');
}

function pluginVersion() {
  try {
    return JSON.parse(readFileSync(join(QUELLE, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------- Planung

/**
 * Eine Aktion: { art, pfad, text?, anwenden? }. Geplant wird ohne zu schreiben;
 * `anwenden` führt sie aus. Fehler beim Planen (Abbruch) verhindern jedes Schreiben.
 */
const aktion = (art, pfad, text, anwenden) => ({ art, pfad, text, anwenden });

// Projekte bekommen die Werkzeuge des Registers, nicht die Kandidaten des hierarchie-Repos (dessen eigene Planung).
function ohneKandidaten(inhalt) {
  const text = inhalt.toString('utf8');
  let daten;
  try {
    daten = parseJson(text, 'register.json');
  } catch (fehler) {
    throw new Bedienfehler(fehler.message);
  }
  if (!istObjekt(daten)) return inhalt;
  return Buffer.from(formatiereJson({ ...daten, kandidaten: [] }, erkenneFormat(text)));
}

// Kopierte Dateien (Werkzeuge, Skills, Agents) mit Schutz lokaler Änderungen über das Manifest.
function planeKopien(projekt, altManifest, neuManifest) {
  const aktionen = [];
  const quellen = [];
  const ohneTests = (pfad) => /\.test\.[^/]+$/.test(pfad) || pfad.endsWith('.gitkeep');
  for (const datei of listeDateien(join(QUELLE, 'werkzeuge'), ohneTests)) quellen.push([`werkzeuge/${datei}`, `${ZIEL_WERKZEUGE}/${datei}`]);
  quellen.push(['register.json', '.hierarchie/register.json', ohneKandidaten]);
  for (const datei of LAUFZEIT_VORLAGEN) quellen.push([`vorlagen/${datei}`, `.hierarchie/vorlagen/${datei}`]);
  quellen.push(['vorlagen/stand.test.mjs.vorlage', STAND_TEST]); // gehört dem Projekt-Ordner automatisierung/, bleibt aber hash-geschützt
  for (const datei of listeDateien(join(QUELLE, 'skills'), (p) => p.endsWith('.gitkeep'))) quellen.push([`skills/${datei}`, `.claude/skills/${datei}`]);
  for (const datei of listeDateien(join(QUELLE, 'agents'), (p) => p.endsWith('.gitkeep'))) quellen.push([`agents/${datei}`, `.claude/agents/${datei}`]);

  for (const [quelle, ziel, umwandeln] of quellen) {
    const quellPfad = join(QUELLE, quelle);
    const zielPfad = join(projekt, ziel);
    if (!existsSync(quellPfad)) throw new Bedienfehler(`${quelle.startsWith('vorlagen/') ? 'Vorlage' : 'Quelle'} fehlt: ${quellPfad}\nEinrichten muss aus einem vollständigen hierarchie-Repo (oder Plugin) gestartet werden.`);
    const inhalt = umwandeln ? umwandeln(readFileSync(quellPfad)) : readFileSync(quellPfad);
    const soll = sha256(inhalt);
    const modus = statSync(quellPfad).mode & 0o777;
    const vorhanden = leseOderNull(zielPfad);
    const eintrag = altManifest.dateien[ziel];
    const kopiere = () => { mkdirSync(dirname(zielPfad), { recursive: true }); writeFileSync(zielPfad, inhalt); if (process.platform !== 'win32') chmodSync(zielPfad, modus); };

    if (vorhanden === null) {
      aktionen.push(aktion('neu', ziel, undefined, kopiere));
      neuManifest.dateien[ziel] = soll;
    } else if (sha256(vorhanden) === soll) {
      aktionen.push(aktion('gleich', ziel));
      neuManifest.dateien[ziel] = soll;
    } else if (eintrag !== undefined && sha256(vorhanden) === eintrag) {
      aktionen.push(aktion('aendern', ziel, 'neuere Fassung', kopiere));
      neuManifest.dateien[ziel] = soll;
    } else if (eintrag !== undefined) {
      aktionen.push(aktion('uebersprungen', ziel, 'lokal geändert, wird nicht überschrieben'));
      neuManifest.dateien[ziel] = eintrag;
    } else {
      aktionen.push(aktion('uebersprungen', ziel, 'vorhanden ohne Manifest-Eintrag (fremde Datei), wird nicht überschrieben'));
    }
  }
  return aktionen;
}

function liesManifest(projekt) {
  const roh = leseOderNull(join(projekt, MANIFEST));
  if (roh === null) return { vorhanden: null, dateien: {} };
  let daten;
  try {
    daten = parseJson(roh.toString('utf8'), MANIFEST);
  } catch (fehler) {
    throw new Abbruch(`${fehler.message} – nichts geschrieben`);
  }
  if (!istObjekt(daten) || (daten.dateien !== undefined && !istObjekt(daten.dateien))) {
    throw new Abbruch(`${MANIFEST} hat ein unerwartetes Format – nichts geschrieben`);
  }
  return { vorhanden: daten, dateien: daten.dateien ?? {} };
}

function planeManifest(projekt, alt, neuDateien, jetzt) {
  const sortiert = Object.fromEntries(Object.entries(neuDateien).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const version = pluginVersion();
  const gleichGeblieben = alt.vorhanden && alt.vorhanden.version === version && gleich(alt.vorhanden.dateien ?? {}, sortiert);
  if (gleichGeblieben) return aktion('gleich', MANIFEST);
  const manifest = { version, eingerichtet: jetzt.toISOString(), dateien: sortiert };
  const schreibe = () => schreibeDatei(join(projekt, MANIFEST), formatiereJson(manifest));
  return alt.vorhanden ? aktion('aendern', MANIFEST, 'Hashes aktualisiert', schreibe) : aktion('neu', MANIFEST, undefined, schreibe);
}

function planePackageJson(projekt) {
  const pfad = join(projekt, 'package.json');
  const roh = leseOderNull(pfad);
  if (roh === null) {
    return aktion('uebersprungen', 'package.json', `keine vorhanden, nicht angelegt (später scripts.test = "${TEST_BEFEHL}" setzen)`);
  }
  const text = roh.toString('utf8');
  let paket;
  try {
    paket = parseJson(text, 'package.json');
  } catch (fehler) {
    return aktion('uebersprungen', 'package.json', fehler.message);
  }
  if (!istObjekt(paket) || (paket.scripts !== undefined && !istObjekt(paket.scripts))) {
    return aktion('uebersprungen', 'package.json', '"scripts" ist kein Objekt');
  }
  const aktuell = paket.scripts?.test;
  if (aktuell === TEST_BEFEHL) return aktion('gleich', 'package.json', 'scripts.test');
  if (aktuell !== undefined && aktuell !== NPM_STANDARD_TEST) {
    return aktion('uebersprungen', 'package.json', `scripts.test ist bereits "${aktuell}" (nicht überschrieben; UTS: ${TEST_BEFEHL})`);
  }
  paket.scripts = { ...(paket.scripts ?? {}), test: TEST_BEFEHL };
  return aktion('aendern', 'package.json', 'scripts.test gesetzt',
    () => writeFileSync(pfad, formatiereJson(paket, erkenneFormat(text))));
}

const ignoriertClaude = new Set(['.claude/*', '.claude/', '/.claude/*', '/.claude/', '.claude', '/.claude']);
const PLAN_HTML = 'plaene/*/plan.html';
const STAND_HTML = ['stand.html', 'stand.seite.html', 'uebersicht.html', 'uebersicht.seite.html'];
const FREIGABEN = ['!.claude/skills/', '!.claude/agents/', '!.claude/settings.json'];

function planeGitignore(projekt) {
  const pfad = join(projekt, '.gitignore');
  const roh = leseOderNull(pfad);
  const text = roh === null ? '' : roh.toString('utf8');
  const zeilen = text.split(/\r?\n/).map((zeile) => zeile.trim());
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const fehlend = [];
  const hinweise = [];

  if (!zeilen.some((z) => ['.uts/', '.uts', '/.uts/', '/.uts'].includes(z))) fehlend.push('.uts/');
  if (!zeilen.some((z) => [PLAN_HTML, `/${PLAN_HTML}`].includes(z))) fehlend.push(PLAN_HTML);
  for (const datei of STAND_HTML) if (!zeilen.some((z) => [datei, `/${datei}`].includes(z))) fehlend.push(datei);
  const ignoriert = zeilen.filter((z) => ignoriertClaude.has(z));
  if (ignoriert.length) {
    const freigaben = FREIGABEN.filter((f) => !zeilen.includes(f));
    if (freigaben.length) fehlend.push('# hierarchie: geteilte Claude-Dateien freigeben', ...freigaben);
    if (ignoriert.some((z) => !z.endsWith('*'))) {
      hinweise.push('„.claude/“ ignoriert den ganzen Ordner; Freigaben wirken erst, wenn dort „.claude/*“ steht');
    }
  }

  const aktionen = [];
  if (fehlend.length) {
    const ergaenzt = fehlend.filter((z) => !z.startsWith('#')).join(', ');
    const neuerText = `${text}${text === '' || /\n$/.test(text) ? '' : eol}${fehlend.join(eol)}${eol}`;
    aktionen.push(aktion(roh === null ? 'neu' : 'aendern', '.gitignore', `ergänzt: ${ergaenzt}`, () => writeFileSync(pfad, neuerText)));
  } else aktionen.push(aktion('gleich', '.gitignore'));
  for (const hinweis of hinweise) aktionen.push(aktion('uebersprungen', '.gitignore', hinweis));
  return aktionen;
}

// STAND.md ist das Projektgedächtnis und gehört dem Projekt: nur anlegen, wenn sie fehlt; nie überschreiben, nicht im Manifest.
function planeStandMd(projekt) {
  const pfad = join(projekt, 'STAND.md');
  if (existsSync(pfad)) return aktion('gleich', 'STAND.md');
  const vorlage = leseVorlage('STAND.md');
  return aktion('neu', 'STAND.md', 'Vorlage mit Platzhaltern, bitte ausfüllen', () => writeFileSync(pfad, vorlage));
}

function planeClaudeMd(projekt) {
  const pfad = join(projekt, 'CLAUDE.md');
  const roh = leseOderNull(pfad);
  const inhalt = leseVorlage('CLAUDE-block.md');
  const text = roh === null ? '' : roh.toString('utf8');
  const ergebnis = setzeBlock(text, CLAUDE_ANFANG, CLAUDE_ENDE, inhalt);
  switch (ergebnis.status) {
    case 'defekt': return aktion('uebersprungen', 'CLAUDE.md', 'Anfangsmarkierung ohne Endmarkierung, bitte von Hand beheben');
    case 'unveraendert': return aktion('gleich', 'CLAUDE.md');
    case 'ersetzt': return aktion('aendern', 'CLAUDE.md', 'Block ersetzt', () => writeFileSync(pfad, ergebnis.text));
    default:
      return roh === null
        ? aktion('neu', 'CLAUDE.md', undefined, () => writeFileSync(pfad, ergebnis.text))
        : aktion('aendern', 'CLAUDE.md', 'Block angehängt', () => writeFileSync(pfad, ergebnis.text));
  }
}

function planeSettings(projekt, opt, jetzt) {
  const rel = '.claude/settings.json';
  const pfad = join(projekt, rel);
  const vorlage = parseJson(leseVorlage('settings-projekt.json'), 'vorlagen/settings-projekt.json');
  const roh = leseOderNull(pfad);
  const text = roh === null ? '' : roh.toString('utf8');
  let bestehend = {};
  if (roh !== null) {
    try {
      bestehend = parseJson(text, rel);
    } catch (fehler) {
      throw new Abbruch(`${fehler.message} – nichts geschrieben`);
    }
  }
  let ergebnis;
  try {
    ergebnis = mischeSettings(bestehend, vorlage, { modell: opt.modell });
  } catch (fehler) {
    throw new Abbruch(`${fehler.message} – nichts geschrieben`);
  }

  const aktionen = [];
  const neuerText = formatiereJson(ergebnis.settings, roh === null ? {} : erkenneFormat(text));
  if (roh === null) {
    aktionen.push(aktion('neu', rel, ergebnis.aenderungen.join(', '), () => schreibeDatei(pfad, neuerText)));
  } else if (ergebnis.geaendert) {
    let sicherung = `${rel}.sicherung-${stempel(jetzt)}`;
    for (let n = 2; existsSync(join(projekt, sicherung)); n++) sicherung = `${rel}.sicherung-${stempel(jetzt)}-${n}`;
    aktionen.push(aktion('aendern', rel, `${ergebnis.aenderungen.join(', ')} (Sicherung: ${sicherung})`, () => {
      writeFileSync(join(projekt, sicherung), roh);
      writeFileSync(pfad, neuerText);
    }));
  } else aktionen.push(aktion('gleich', rel));
  for (const hinweis of ergebnis.hinweise) aktionen.push(aktion('uebersprungen', rel, hinweis));
  return aktionen;
}

function planeWorkflow(projekt) {
  const rel = '.github/workflows/uts.yml';
  const pfad = join(projekt, rel);
  const vorlage = leseVorlage('uts.yml');
  const vorhanden = leseOderNull(pfad);
  if (vorhanden === null) return aktion('neu', rel, undefined, () => schreibeDatei(pfad, vorlage));
  if (sha256(vorhanden) === sha256(vorlage)) return aktion('gleich', rel);
  return aktion('uebersprungen', rel, 'vorhanden, wird nie überschrieben (Vorlage: vorlagen/uts.yml)');
}

function planePrePush(projekt) {
  const rel = 'Git-Hook pre-push';
  const ziel = hooksOrdner(projekt);
  if (!ziel.ordner) return aktion('uebersprungen', rel, ziel.grund);
  const pfad = join(ziel.ordner, 'pre-push');
  const block = leseVorlage('pre-push-block.sh');
  const roh = leseOderNull(pfad);
  const text = roh === null ? '' : roh.toString('utf8');
  // Im Projekt: relativ mit `/` (auch wenn Git den echten Pfad meldet und das Projekt über Link/Kurzname genannt wurde).
  const unter = relativUnter(ziel.ordner, projekt);
  const anzeige = `${rel} (${unter === null ? pfad.split('\\').join('/') : unter === '' ? 'pre-push' : `${unter}/pre-push`})`;

  if (text.trim() === '') {
    const neu = setzeBlock('#!/bin/sh\n', HOOK_ANFANG, HOOK_ENDE, block, 'nachErsterZeile').text;
    return aktion(roh === null ? 'neu' : 'aendern', anzeige, undefined, () => schreibeDatei(pfad, neu, 0o755));
  }
  if (!SHELL_SHEBANG.test(text.split(/\r?\n/, 1)[0])) {
    return aktion('uebersprungen', anzeige, 'anderer Interpreter als sh/bash, Block bitte von Hand einfügen (Vorlage: vorlagen/pre-push-block.sh)');
  }
  const ergebnis = setzeBlock(text, HOOK_ANFANG, HOOK_ENDE, block, 'nachErsterZeile');
  if (ergebnis.status === 'defekt') return aktion('uebersprungen', anzeige, 'Anfangsmarkierung ohne Endmarkierung, bitte von Hand beheben');
  if (ergebnis.status === 'unveraendert') return aktion('gleich', anzeige);
  return aktion('aendern', anzeige, ergebnis.status === 'ersetzt' ? 'Block ersetzt' : 'Block eingefügt',
    () => schreibeDatei(pfad, ergebnis.text, 0o755));
}

export function plane(projekt, opt, jetzt = new Date()) {
  const altManifest = liesManifest(projekt);
  const neuManifest = { dateien: {} };
  const aktionen = [];
  aktionen.push(...planeKopien(projekt, altManifest, neuManifest));
  aktionen.push(planeManifest(projekt, altManifest, neuManifest.dateien, jetzt));
  aktionen.push(planePackageJson(projekt));
  aktionen.push(...planeGitignore(projekt));
  aktionen.push(planeStandMd(projekt));
  aktionen.push(planeClaudeMd(projekt));
  aktionen.push(...planeSettings(projekt, opt, jetzt));
  aktionen.push(planeWorkflow(projekt));
  aktionen.push(planePrePush(projekt));
  return aktionen;
}

// ---------------------------------------------------------------- Ausgabe

function formatiere(a) {
  const { zeichen, text } = ART[a.art];
  const ort = a.art === 'uebersprungen' ? `${a.pfad}: ${a.text}` : a.text ? `${a.pfad} – ${a.text}` : a.pfad;
  return `${zeichen} ${text.padEnd(12)} ${ort}`;
}

function zusammenfassung(aktionen) {
  const n = (art) => aktionen.filter((a) => a.art === art).length;
  return `${n('neu')} neu, ${n('aendern')} geändert, ${n('gleich')} unverändert, ${n('uebersprungen')} übersprungen`;
}

// ---------------------------------------------------------------- Hauptablauf

/** Führt `einrichten` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { jetzt = new Date() } = {}) {
  try {
    const opt = leseArgumente(argv);
    if (opt.hilfe) { io.aus(HILFE); return 0; }

    const projekt = resolve(opt.projekt);
    if (!istOrdner(projekt)) throw new Bedienfehler(`Projektordner existiert nicht: ${opt.projekt}`);
    if (gleicherOrt(projekt, QUELLE)) throw new Bedienfehler('Das hierarchie-Repo selbst kann nicht Ziel der Einrichtung sein.');

    const aktionen = plane(projekt, opt, jetzt);
    io.aus(`hierarchie einrichten – ${opt.uebernehmen ? 'Übernahme' : 'Trockenlauf (es wird nichts geschrieben)'}`);
    io.aus(`Projekt: ${projekt.split('\\').join('/')}`);
    io.aus('');
    if (opt.uebernehmen) {
      for (const a of aktionen) {
        a.anwenden?.();
        io.aus(formatiere(a));
      }
      io.aus('');
      io.aus(`Fertig: ${zusammenfassung(aktionen)}.`);
    } else {
      for (const a of aktionen) io.aus(formatiere(a));
      io.aus('');
      io.aus(`Geplant: ${zusammenfassung(aktionen)}. Zum Ausführen --uebernehmen anhängen.`);
    }
    return 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`hierarchie einrichten: ${fehler.message}`); return 2; }
    if (fehler instanceof Abbruch) { io.fehler(`hierarchie einrichten: abgebrochen – ${fehler.message}`); return 1; }
    io.fehler(`hierarchie einrichten: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
