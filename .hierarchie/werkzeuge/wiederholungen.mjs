#!/usr/bin/env node
/**
 * hierarchie wiederholungen – was wiederholt sich? Belege für Werkzeug-Kandidaten aus Git und (mit --protokolle) aus Sitzungsprotokollen.
 *
 *   wiederholungen [--protokolle] [--protokoll-ordner <pfad>] [--als-kandidaten [--schreiben]] [--json]
 *
 * Git: letzte 300 Commits ohne Merges. Protokolle: nur Muster + Anzahl, nie Befehle, Dateiinhalte oder Nachrichtentexte.
 * Schreibt nur mit `--als-kandidaten --schreiben` (Register des Projekts bzw. des hierarchie-Repos).
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { git, gitBytes } from './lib/git.mjs';
import { sha256 } from './lib/hash.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { ermittleProtokolle, liesProtokoll, zahl } from './lib/protokolle.mjs';
import { ermittleOrte, liesRegister, schreibeRegister } from './lib/register.mjs';

const MAX_COMMITS = 300;
const MIN_GIT = 3; // Dateipaare/-gruppen: gemeinsam in mindestens so vielen Commits
const MIN_ZAEHLUNG = 2; // Commit-Bereiche und meistgeänderte Dateien: erst ab zweimal sinnvoll
const MIN_MUSTER = 3; // Befehlsmuster aus Protokollen
const MIN_KANDIDAT = 5;
const TOP_GIT = 10;
const TOP_MUSTER = 15;
const MAX_DATEIEN_PRO_COMMIT = 30; // größere Commits (Umbauten, Formatierung) sagen nichts über „gehört zusammen“
const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];

const HILFE = `Aufruf: hierarchie wiederholungen [--protokolle] [--protokoll-ordner <pfad>] [--als-kandidaten [--schreiben]] [--json]

  Git (immer)      letzte ${MAX_COMMITS} Commits ohne Merges: Dateipaare/-gruppen, die in mindestens ${MIN_GIT} Commits gemeinsam geändert wurden
                   (Commits mit mehr als ${MAX_DATEIEN_PRO_COMMIT} Dateien zählen dafür nicht), Commit-Bereiche typ(bereich) mit Anzahl,
                   Dateien mit den meisten Änderungen (ab ${MIN_ZAEHLUNG}). Jeweils Top ${TOP_GIT}.
  --protokolle     zusätzlich die Sitzungsprotokolle des aktuellen Projekts (nur lesen): wiederholte Bash-Befehlsmuster, ab ${MIN_MUSTER} Vorkommen,
                   Top ${TOP_MUSTER}, mit Anzahl und Zahl der Sitzungen. Ausgegeben wird nur das Muster (erstes Wort + Unterbefehl), nie ein Befehl,
                   Dateiinhalt oder Nachrichtentext. Führende \`cd …\` und Umgebungsvariablen am Anfang einer Kette zählen nicht als Kommando.
                   Programmnamen erscheinen nur, wenn sie gängig oder im PATH installiert sind (sonst <BEFEHL>), Skriptnamen nur,
                   wenn die Datei im Projekt versioniert ist (sonst <SKRIPT>).
                   Ordner: $CLAUDE_CONFIG_DIR bzw. ~/.claude, darunter projects/<Projektpfad mit - statt Sonderzeichen>.
  --protokoll-ordner <pfad>   anderen Ordner mit .jsonl-Protokollen lesen (z. B. für Tests)
  --als-kandidaten Funde ab ${MIN_KANDIDAT} Vorkommen (Dateigruppen, Commit-Bereiche, Befehlsmuster) als Kandidaten ins Register übernehmen
                   (belegt: true, Quelle "git" bzw. "protokolle (N Sitzungen)"); ohne --schreiben nur anzeigen. Vorhandene Namen werden nicht doppelt angelegt.
  --schreiben      zusammen mit --als-kandidaten wirklich schreiben (Projekt: automatisierung/register.json, hierarchie-Repo: register.json)
  --json           maschinenlesbar (jeder Fund mit belegt: true und quelle)

Das Protokollformat ist intern und versionsabhängig: Zeilen, die kein JSON sind oder nicht passen, werden übersprungen und gezählt.
Protokolle gibt es nur lokal; Cloud-Container verlieren sie beim Ende der Sitzung.
Exit-Code: 0 ok (auch ohne Funde oder ohne Protokolle) · 1 Fehler beim Lesen oder Schreiben des Registers · 2 Bedienfehler (z. B. kein Git-Repository ohne --protokolle)`;

// ---------------------------------------------------------------- Befehlsmuster

// Bekannte Unterbefehle: nur diese werden ausgegeben, damit nie Inhalt als „Unterbefehl“ durchrutscht.
const UNTERBEFEHLE = {
  git: ['add', 'am', 'apply', 'bisect', 'blame', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'describe', 'diff', 'fetch',
    'for-each-ref', 'grep', 'init', 'log', 'ls-files', 'merge', 'merge-base', 'mv', 'pull', 'push', 'rebase', 'reflog', 'remote', 'reset', 'restore',
    'rev-list', 'rev-parse', 'revert', 'rm', 'show', 'stash', 'status', 'switch', 'symbolic-ref', 'tag', 'worktree'],
  npm: ['audit', 'ci', 'exec', 'init', 'install', 'i', 'link', 'ls', 'pack', 'publish', 'remove', 'run', 'start', 'test', 'update', 'version'],
  pnpm: ['add', 'build', 'dev', 'exec', 'install', 'i', 'lint', 'remove', 'run', 'start', 'test', 'update'],
  yarn: ['add', 'build', 'dev', 'install', 'lint', 'remove', 'run', 'start', 'test', 'upgrade'],
  gh: ['api', 'auth', 'issue', 'pr', 'release', 'repo', 'run', 'workflow'],
  docker: ['build', 'compose', 'exec', 'images', 'logs', 'ps', 'pull', 'push', 'rm', 'run', 'stop'],
  cargo: ['build', 'check', 'clippy', 'fmt', 'run', 'test'],
  go: ['build', 'fmt', 'mod', 'run', 'test', 'vet'],
  supabase: ['db', 'functions', 'gen', 'init', 'link', 'migration', 'start', 'status', 'stop'],
  claude: ['mcp', 'plugin'],
  make: [],
};
const SKRIPT_STARTER = ['node', 'python', 'python3', 'bash', 'sh', 'deno', 'bun', 'tsx', 'ts-node'];
const SKRIPT = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(?:mjs|cjs|js|ts|py|sh)$/;
const BEFEHLSWORT = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/;
const VORSATZ = ['sudo', 'time', 'nohup'];
// Gängige Werkzeuge, deren Name als Muster erscheinen darf; andere Namen nur, wenn sie als Programm im PATH liegen (sonst <BEFEHL>).
const GAENGIGE_BEFEHLE = new Set(`awk basename bash cat cd chmod chown claude cmp cp curl cut date deno diff dirname docker du echo env export find for gh git go grep
  head if jq kill ln ls make mkdir mv node npm npx pgrep pkill pnpm printf ps pwd python python3 read rg rm rmdir sed set sh sleep sort source tail tar tee test touch tr tsx
  uniq unzip wc which while xargs yarn zip`.split(/\s+/));
const imPfad = new Map();

/** Liegt `name` als Programm in einem Ordner des PATH? (nur Dateinamen prüfen, nichts ausführen) */
function istProgrammImPfad(name, env = process.env) {
  if (imPfad.has(name)) return imPfad.get(name);
  const endungen = process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  const gefunden = !name.includes('/') && (env.PATH ?? '').split(delimiter).filter(Boolean).some((ordner) => endungen.some((e) => existsSync(join(ordner, name + e))));
  imPfad.set(name, gefunden);
  return gefunden;
}

const istBekannterBefehl = (wort) => GAENGIGE_BEFEHLE.has(wort) || istProgrammImPfad(wort);

/** Menge aller Pfadendstücke versionierter Dateien (`a/b/c.mjs` → `a/b/c.mjs`, `b/c.mjs`, `c.mjs`): nur solche Skriptnamen darf ein Muster zeigen. */
export function skriptEndstuecke(dateien) {
  const menge = new Set();
  for (const pfad of dateien) {
    const teile = pfad.split('/');
    for (let i = 0; i < teile.length; i++) menge.add(teile.slice(i).join('/'));
  }
  return menge;
}

/**
 * Normalisiert einen Bash-Befehl zu einem Muster: Heredoc-Inhalte entfernt, Strings → <TEXT>, absolute Pfade → <PFAD>, Zahlen → <N>;
 * nur das erste Kommando der Kette zählt (führendes `cd …` und `VAR=wert` übersprungen), gruppiert nach erstem Wort + Unterbefehl bzw. Skript.
 * Ausgegeben werden nur: gängige oder im PATH installierte Programmnamen, bekannte Unterbefehle und Skriptnamen, die in `skripte`
 * (siehe `skriptEndstuecke`; null = alle erlaubt) vorkommen – alles andere wird zu <BEFEHL> bzw. <SKRIPT>.
 * Liefert den Text des Musters oder null, wenn kein Kommando zu erkennen ist.
 */
export function befehlsmuster(befehl, { skripte = null, istBefehl = istBekannterBefehl } = {}) {
  if (typeof befehl !== 'string') return null;
  const text = befehl
    .replace(/(?<!<)<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([^\n]*)\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, '<<HEREDOC$3')
    .replace(/"(?:\\[\s\S]|[^"\\])*"|'[^']*'/g, '<TEXT>')
    .replace(/["'][\s\S]*$/, '<TEXT>')
    .replace(/(^|[\s=(])~?\/[^\s;|&<>()]*/g, '$1<PFAD>')
    .replace(/(^|[\s=(])[A-Za-z]:[\\/][^\s;|&<>()]*/g, '$1<PFAD>');
  const kommandos = text.split(/&&|\|\||[;|&\n]/).map((s) => s.trim().replace(/^[({!\s]+/, '')).filter(Boolean);
  let token = null;
  for (const kommando of kommandos) {
    const teile = kommando.split(/\s+/);
    while (teile.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(teile[0]) || VORSATZ.includes(teile[0]))) teile.shift();
    if (!teile.length) continue;
    token = teile;
    if (!['cd', 'pushd', 'popd'].includes(teile[0])) break;
  }
  if (!token) return null;
  const skriptErlaubt = (name) => skripte === null || skripte.has(name.replace(/^\.\//, ''));
  const zeigeSkript = (name) => (skriptErlaubt(name) ? name.replace(/\b\d+(?:[.,]\d+)*\b/g, '<N>') : '<SKRIPT>');
  const erstes = token[0];
  let wort;
  if (erstes === '<PFAD>') wort = '<PFAD>';
  else if (!BEFEHLSWORT.test(erstes) || erstes.length > 60) wort = '<BEFEHL>';
  else if (SKRIPT.test(erstes) || erstes.includes('/')) wort = SKRIPT.test(erstes) ? zeigeSkript(erstes) : '<BEFEHL>';
  else wort = istBefehl(erstes) ? erstes : '<BEFEHL>';
  const zweites = token[1];
  let rest = '';
  if (wort in UNTERBEFEHLE && zweites && UNTERBEFEHLE[wort].includes(zweites)) rest = ` ${zweites}`;
  else if (SKRIPT_STARTER.includes(wort) && zweites) {
    if (SKRIPT.test(zweites)) rest = ` ${zeigeSkript(zweites)}`;
    else if (zweites === '<PFAD>') rest = ' <PFAD>';
  }
  return `${wort}${rest}`;
}

/** Bash-Befehle aus den Zeilen einer Protokolldatei: [{ id, muster }]; zählt unpassende assistant-Zeilen als übersprungen. */
export function bashMuster(zeilen, optionen = {}) {
  const funde = [];
  let uebersprungen = 0;
  for (const z of zeilen) {
    if (z.type !== 'assistant') continue;
    const inhalt = z.message?.content;
    if (typeof z.message !== 'object' || z.message === null || !(Array.isArray(inhalt) || typeof inhalt === 'string')) { uebersprungen++; continue; }
    if (!Array.isArray(inhalt)) continue;
    for (const element of inhalt) {
      if (element === null || typeof element !== 'object' || element.type !== 'tool_use' || element.name !== 'Bash') continue;
      const muster = befehlsmuster(element.input?.command, optionen);
      if (muster === null) { uebersprungen++; continue; }
      funde.push({ id: typeof element.id === 'string' ? element.id : null, muster });
    }
  }
  return { funde, uebersprungen };
}

function analysiereProtokolle(quelle, optionen) {
  const proMuster = new Map();
  const gesehen = new Set();
  const sitzungen = new Set();
  let uebersprungen = 0;
  for (const { sitzung, datei } of quelle.dateien) {
    sitzungen.add(sitzung);
    const gelesen = liesProtokoll(datei);
    uebersprungen += gelesen.uebersprungen;
    const { funde, uebersprungen: schlecht } = bashMuster(gelesen.zeilen, optionen);
    uebersprungen += schlecht;
    for (const { id, muster } of funde) {
      if (id !== null) { if (gesehen.has(id)) continue; gesehen.add(id); }
      const eintrag = proMuster.get(muster) ?? { muster, anzahl: 0, sitzungen: new Set() };
      eintrag.anzahl++;
      eintrag.sitzungen.add(sitzung);
      proMuster.set(muster, eintrag);
    }
  }
  const alle = [...proMuster.values()].map((e) => ({ muster: e.muster, anzahl: e.anzahl, sitzungen: e.sitzungen.size }));
  const rang = (a, b) => b.anzahl - a.anzahl || (a.muster < b.muster ? -1 : a.muster > b.muster ? 1 : 0);
  return {
    ordner: quelle.ordner,
    dateien: quelle.dateien.length,
    sitzungen: sitzungen.size,
    uebersprungeneZeilen: uebersprungen,
    muster: alle.filter((e) => e.anzahl >= MIN_MUSTER).sort(rang).slice(0, TOP_MUSTER)
      .map((e) => ({ ...e, belegt: true, quelle: `protokolle (${e.sitzungen} ${e.sitzungen === 1 ? 'Sitzung' : 'Sitzungen'})` })),
    alleMuster: alle.filter((e) => e.anzahl >= MIN_KANDIDAT).sort(rang),
  };
}

// ---------------------------------------------------------------- Git

const PRAEFIX = /^([A-Za-z]+)\(([^()]+)\)!?:/;
const vergleiche = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function analysiereGit(ordner) {
  const roh = gitBytes(ordner, ['-c', 'core.quotepath=false', 'log', '--no-merges', '-n', String(MAX_COMMITS), '--name-only', '--format=%x1e%s'], 1 << 27);
  if (roh === null && git(ordner, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null) return null;
  const commits = (roh ?? Buffer.alloc(0)).toString('utf8').split('\x1e').slice(1).map((teil) => {
    const [betreff, ...dateien] = teil.split('\n');
    return { betreff, dateien: [...new Set(dateien.map((d) => d.trim()).filter(Boolean))].sort() };
  });

  const dateiZaehler = new Map();
  const bereichZaehler = new Map();
  const dateiCommits = new Map(); // Datei → Indizes der Commits (nur Commits mit höchstens MAX_DATEIEN_PRO_COMMIT Dateien)
  const paarZaehler = new Map();
  let uebergangen = 0;
  commits.forEach(({ betreff, dateien }, index) => {
    for (const d of dateien) dateiZaehler.set(d, (dateiZaehler.get(d) ?? 0) + 1);
    const treffer = PRAEFIX.exec(betreff);
    if (treffer) {
      const schluessel = `${treffer[1].toLowerCase()}(${treffer[2].trim()})`;
      bereichZaehler.set(schluessel, (bereichZaehler.get(schluessel) ?? 0) + 1);
    }
    if (dateien.length > MAX_DATEIEN_PRO_COMMIT) { uebergangen++; return; }
    for (const d of dateien) dateiCommits.set(d, [...(dateiCommits.get(d) ?? []), index]);
    for (let i = 0; i < dateien.length; i++) {
      for (let j = i + 1; j < dateien.length; j++) {
        const schluessel = `${dateien[i]}\0${dateien[j]}`;
        paarZaehler.set(schluessel, (paarZaehler.get(schluessel) ?? 0) + 1);
      }
    }
  });

  // Gruppen: Dateien mit genau denselben Commits (mindestens 2 Dateien, mindestens MIN_GIT Commits)
  const proMenge = new Map();
  for (const [datei, indizes] of dateiCommits) {
    if (indizes.length < MIN_GIT) continue;
    const schluessel = indizes.join(',');
    proMenge.set(schluessel, { anzahl: indizes.length, dateien: [...(proMenge.get(schluessel)?.dateien ?? []), datei] });
  }
  const gruppen = [...proMenge.values()].filter((g) => g.dateien.length >= 2).map((g) => ({ dateien: g.dateien.sort(), anzahl: g.anzahl }));
  const gruppeVon = new Map();
  gruppen.forEach((g, i) => g.dateien.forEach((d) => gruppeVon.set(d, i)));
  const paare = [...paarZaehler].filter(([, n]) => n >= MIN_GIT).map(([schluessel, anzahl]) => ({ dateien: schluessel.split('\0'), anzahl }))
    .filter(({ dateien: [a, b] }) => !(gruppeVon.has(a) && gruppeVon.get(a) === gruppeVon.get(b)));
  const gemeinsam = [...gruppen, ...paare]
    .sort((a, b) => b.anzahl - a.anzahl || b.dateien.length - a.dateien.length || vergleiche(a.dateien.join('\0'), b.dateien.join('\0')))
    .slice(0, TOP_GIT).map((e) => ({ ...e, belegt: true, quelle: 'git' }));

  const top = (zaehler, feld) => [...zaehler].filter(([, n]) => n >= MIN_ZAEHLUNG)
    .sort((a, b) => b[1] - a[1] || vergleiche(a[0], b[0])).slice(0, TOP_GIT)
    .map(([name, anzahl]) => ({ [feld]: name, anzahl, belegt: true, quelle: 'git' }));
  return { commits: commits.length, uebergangeneGrosseCommits: uebergangen, gemeinsam, bereiche: top(bereichZaehler, 'bereich'), dateien: top(dateiZaehler, 'datei') };
}

// ---------------------------------------------------------------- Kandidaten

const slug = (text, max) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || 'x';
const basisname = (pfad) => pfad.split('/').at(-1);
const kurzListe = (liste) => (liste.length > 4 ? `${liste.slice(0, 4).join(', ')} u. a.` : liste.join(', '));

/** Kandidaten (Name, Ablauf, Quelle) aus Funden mit mindestens MIN_KANDIDAT Vorkommen. */
function kandidatenAus(gitErgebnis, protokollErgebnis) {
  const liste = [];
  for (const g of gitErgebnis?.gemeinsam ?? []) {
    if (g.anzahl < MIN_KANDIDAT) continue;
    liste.push({
      name: `dateigruppe-${slug(basisname(g.dateien[0]), 24)}-${sha256(g.dateien.join('\n')).slice(0, 6)}`,
      ablauf: `Dateien ändern sich oft gemeinsam: ${kurzListe(g.dateien)} (${g.anzahl} Commits) – Abgleich oder Generator prüfen`,
      quelle: 'git',
    });
  }
  for (const b of gitErgebnis?.bereiche ?? []) {
    if (b.anzahl < MIN_KANDIDAT) continue;
    liste.push({ name: `bereich-${slug(b.bereich, 40)}`, ablauf: `Commit-Bereich ${b.bereich} kehrt in ${b.anzahl} Commits wieder – wiederkehrenden Ablauf prüfen`, quelle: 'git' });
  }
  for (const m of protokollErgebnis?.alleMuster ?? []) {
    liste.push({
      name: `befehl-${slug(m.muster, 40)}`,
      ablauf: `Befehlsmuster „${m.muster}“ läuft ${m.anzahl}× in ${m.sitzungen} ${m.sitzungen === 1 ? 'Sitzung' : 'Sitzungen'} – Automatisierung prüfen`,
      quelle: `protokolle (${m.sitzungen} ${m.sitzungen === 1 ? 'Sitzung' : 'Sitzungen'})`,
    });
  }
  return liste;
}

function uebernimmKandidaten(kandidaten, orte, schreiben, io) {
  const vorhandeneNamen = new Set();
  for (const quelle of [orte.eigenes, orte.projekt].filter(Boolean)) {
    const gelesen = liesRegister(quelle);
    for (const k of Array.isArray(gelesen.daten?.kandidaten) ? gelesen.daten.kandidaten : []) if (typeof k?.name === 'string') vorhandeneNamen.add(k.name);
  }
  const neu = [];
  const zeilen = [];
  for (const k of kandidaten) {
    if (vorhandeneNamen.has(k.name)) { zeilen.push(`  vorhanden: ${k.name}`); continue; }
    vorhandeneNamen.add(k.name);
    neu.push({ name: k.name, ablauf: k.ablauf, belegt: true, quelle: k.quelle, entscheidung: 'offen', begruendung: '' });
    zeilen.push(`  ${schreiben ? 'angelegt' : 'würde anlegen'}: ${k.name} – ${k.quelle}`);
  }
  if (schreiben && neu.length) {
    const ziel = liesRegister(orte.schreib);
    if (ziel.fehler) { io.fehler(`wiederholungen: ${ziel.fehler}`); return { zeilen, code: 1 }; }
    if (!Array.isArray(ziel.daten.kandidaten)) { io.fehler(`wiederholungen: ${orte.schreib.anzeige}: kandidaten muss eine Liste sein`); return { zeilen, code: 1 }; }
    ziel.daten.kandidaten.push(...neu);
    schreibeRegister(ziel, ziel.daten);
  }
  const kopf = kandidaten.length === 0
    ? `Kandidaten (ab ${MIN_KANDIDAT} Vorkommen): keine Funde`
    : `Kandidaten (ab ${MIN_KANDIDAT} Vorkommen) in ${orte.schreib.anzeige}${schreiben ? '' : ' – nur Anzeige, mit --schreiben anlegen'}:`;
  return { zeilen: [kopf, ...zeilen], neu: neu.map((k) => k.name), code: 0 };
}

// ---------------------------------------------------------------- Ausgabe

function textGit(g) {
  const z = [`Git – letzte ${g.commits} Commits ohne Merges [belegt · Quelle git]`];
  z.push(`Gemeinsam geänderte Dateien (ab ${MIN_GIT} Commits${g.uebergangeneGrosseCommits ? `; ${g.uebergangeneGrosseCommits} Commits mit über ${MAX_DATEIEN_PRO_COMMIT} Dateien nicht gewertet` : ''}):`);
  z.push(...(g.gemeinsam.length ? g.gemeinsam.map((e) => `  ${String(e.anzahl).padStart(3)}×  ${e.dateien.join(' + ')}`) : ['  keine']));
  z.push(`Commit-Bereiche (ab ${MIN_ZAEHLUNG}):`);
  z.push(...(g.bereiche.length ? g.bereiche.map((e) => `  ${String(e.anzahl).padStart(3)}×  ${e.bereich}`) : ['  keine']));
  z.push(`Meistgeänderte Dateien (ab ${MIN_ZAEHLUNG}):`);
  z.push(...(g.dateien.length ? g.dateien.map((e) => `  ${String(e.anzahl).padStart(3)}×  ${e.datei}`) : ['  keine']));
  return z;
}

function textProtokolle(p) {
  const z = [`Protokolle – ${p.sitzungen} Sitzungen in ${p.dateien} Dateien, ${zahl(p.uebersprungeneZeilen)} Zeilen übersprungen (Format intern) [belegt · Quelle protokolle]`];
  if (p.dateien === 0) z.push('  Keine Protokolle gefunden (nur lokal vorhanden; Cloud-Container verlieren sie beim Ende).');
  else {
    z.push(`Wiederholte Bash-Befehlsmuster (ab ${MIN_MUSTER}, nur Muster, nie Befehle):`);
    z.push(...(p.muster.length ? p.muster.map((e) => `  ${String(e.anzahl).padStart(4)}×  ${e.muster}  (${e.sitzungen} ${e.sitzungen === 1 ? 'Sitzung' : 'Sitzungen'})`) : ['  keine']));
  }
  return z;
}

/** Führt `wiederholungen` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd(), orte = ermittleOrte(), env = process.env, heim = homedir() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) { io.aus(HILFE); return 0; }
    const { pos, opt } = zerlege(argv, {
      mitWert: ['--protokoll-ordner'], schalter: ['--protokolle', '--als-kandidaten', '--schreiben', '--json'],
    });
    if (pos.length) throw new Bedienfehler(`keine Positionsargumente erwartet (${pos.join(' ')}); siehe --hilfe`);
    if (opt.schreiben && !opt['als-kandidaten']) throw new Bedienfehler('--schreiben gehört zu --als-kandidaten');
    if (opt['protokoll-ordner'] && !opt.protokolle) throw new Bedienfehler('--protokoll-ordner gehört zu --protokolle');

    const imRepo = git(ordner, ['rev-parse', '--is-inside-work-tree']) === 'true';
    if (!imRepo && !opt.protokolle) throw new Bedienfehler('kein Git-Repository im aktuellen Ordner (oder git fehlt); für Sitzungsprotokolle --protokolle verwenden');
    const gitErgebnis = imRepo ? analysiereGit(ordner) : null;
    if (imRepo && gitErgebnis === null) { io.fehler('wiederholungen: git log ist fehlgeschlagen'); return 1; }

    let protokolle = null;
    if (opt.protokolle) {
      const wurzel = imRepo ? git(ordner, ['rev-parse', '--show-toplevel']) : null;
      const versioniert = imRepo ? (gitBytes(ordner, ['-c', 'core.quotepath=false', 'ls-files'], 1 << 27)?.toString('utf8') ?? '').split('\n').filter(Boolean) : [];
      protokolle = analysiereProtokolle(ermittleProtokolle([ordner, ...(wurzel ? [wurzel] : [])], opt['protokoll-ordner'], env, heim),
        { skripte: skriptEndstuecke(versioniert) });
    }

    const kandidaten = opt['als-kandidaten'] ? kandidatenAus(gitErgebnis, protokolle) : null;
    const uebernahme = kandidaten ? uebernimmKandidaten(kandidaten, orte, Boolean(opt.schreiben), io) : null;
    if (uebernahme?.code) return uebernahme.code;

    if (opt.json) {
      const ohneRest = protokolle && (({ alleMuster, ...rest }) => rest)(protokolle);
      io.aus(JSON.stringify({
        git: gitErgebnis, protokolle: ohneRest,
        kandidaten: kandidaten && { geschrieben: Boolean(opt.schreiben), neu: uebernahme.neu, gefunden: kandidaten.map((k) => k.name) },
      }, null, 2));
      return 0;
    }
    const zeilen = [...(gitErgebnis ? textGit(gitErgebnis) : ['Git: kein Repository im aktuellen Ordner – Git-Teil entfällt'])];
    if (protokolle) zeilen.push('', ...textProtokolle(protokolle));
    if (uebernahme) zeilen.push('', ...uebernahme.zeilen);
    io.aus(zeilen.join('\n'));
    return 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`wiederholungen: ${fehler.message}`); return 2; }
    io.fehler(`wiederholungen: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
