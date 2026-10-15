#!/usr/bin/env node
/**
 * hierarchie projekte – Projektübersicht: was ist in den anderen Projekten offen?
 *
 *   projekte                                         je Projekt eine Zeile: Name, Stand-Datum, Zahl offener Punkte, Seite
 *   projekte einlesen <owner/repo> <STAND.md|Ordner> [--quelle <branch>] [--seite <https-Link>]
 *                                                    Momentaufnahme der STAND.md in gedaechtnis/projekte.json (ersetzt den alten Eintrag)
 *   projekte quellen <datei…>                        Antworten von list_repos/list_sessions (JSON) als Metadaten je Repo übernehmen:
 *                                                    letzter Push, aktiv (≤ 30 Tage), Bereich, Zahl und Datum der Sitzungen, Themen
 *   projekte html                                    schreibt uebersicht.html (Dokument) und uebersicht.seite.html (Fragment für claude.ai)
 *
 * Datenschutz: Von Sitzungen werden nur Titel, Datum und Repos gelesen; gespeichert werden nur Zahlen je Repo und Themenwörter
 * aus mindestens 3 Titeln – nie Titel, Zusammenfassungen, Kosten oder IDs.
 *
 * Holt nichts aus dem Netz: Claude besorgt die STAND.md (Klon oder GitHub-Werkzeug) und ruft `einlesen` auf.
 * projekte.json liegt im hierarchie-Repo (gedaechtnis/); in einem Projekt sucht das Werkzeug sie im Nachbarordner ../hierarchie.
 * Das eigene Projekt wird immer frisch aus seiner STAND.md gelesen. Kein Modellaufruf.
 * Spezifikation: docs/spezifikation/stand.md, Abschnitt 6
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { istObjekt, parseJson } from './lib/json.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { ermittleOrte } from './lib/register.mjs';
import { baueUebersichtSeite } from './lib/stand-seite.mjs';
import { DATEI, lokalesDatum, pruefeStand } from './stand.mjs';

const HILFE = `Aufruf: hierarchie projekte [einlesen <owner/repo> <STAND.md|Ordner> [--quelle <branch>] [--seite <https-Link>] | quellen <datei…> | html]

  (ohne)     nach Bereich gruppiert je Projekt eine Zeile: Name, Stand-Datum, offene Punkte, Sitzungen, Projektseite
             (eigenes Projekt frisch aus ${DATEI}); ruhende Repos und Themen je in einer Zeile
  einlesen   prüft die ${DATEI} wie \`stand pruefen\` und übernimmt Ziel, Offene Punkte, Nächste Schritte und Datum
             nach gedaechtnis/projekte.json (ein Eintrag je Repo, wird ersetzt). Ungültige ${DATEI} ⇒ Exit 1, nichts geschrieben
  quellen    liest Antworten von list_repos und list_sessions (JSON-Dateien, mindestens eine mit Repos) und übernimmt je Repo
             letzten Push, aktiv (Push ≤ 30 Tage), Bereich (gedaechtnis/bereiche.json), Zahl und Datum der Sitzungen sowie Themen.
             Gespeichert werden nie Sitzungstitel, Zusammenfassungen, Kosten oder IDs
  html       schreibt uebersicht.html (Dokument) und uebersicht.seite.html (Fragment für claude.ai), beide nicht versioniert
Holt nichts aus dem Netz; die ${DATEI} eines anderen Repos besorgt Claude (Klon oder GitHub-Werkzeug).
Exit-Code: 0 ok · 1 Befund (ungültige ${DATEI}, projekte.json oder bereiche.json nicht lesbar) · 2 Bedienfehler`;

const VERSION = 1;
const REPO_MUSTER = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SICHERER_LINK = /^https:\/\/[^\s"'<>]+$/;
const AKTIV_TAGE = 30;
const TAG_MS = 86400000;
const OHNE_BEREICH = 'ohne Bereich';
const MIN_THEMA = 3; // Themenwort erst ab so vielen Sitzungstiteln
const MAX_THEMEN = 15;
const FUELLWOERTER = new Set(['eine', 'einen', 'einer', 'eines', 'oder', 'nach', 'über', 'ueber', 'beim', 'sowie', 'ohne', 'durch', 'gegen',
  'with', 'from', 'into', 'this', 'that', 'than', 'then', 'your', 'about', 'using']);

/** Ort von projekte.json: im hierarchie-Repo gedaechtnis/, in einem Projekt ../hierarchie/gedaechtnis/. */
export function projekteDatei(orte) {
  return orte.modus === 'projekt'
    ? join(orte.projektWurzel, '..', 'hierarchie', 'gedaechtnis', 'projekte.json')
    : join(orte.installWurzel, 'gedaechtnis', 'projekte.json');
}

const text = (wert) => (typeof wert === 'string' ? wert : '');

/**
 * Liest projekte.json: { projekte, themen }. Fehlt sie ⇒ leer; unlesbar ⇒ Ausnahme. Die Datei ist von Hand änderbar:
 * fehlende Textfelder werden leer, eine Seite ohne https-Link fällt weg, ungültige Themen werden übergangen.
 */
function liesDaten(datei) {
  if (!existsSync(datei)) return { projekte: [], themen: [] };
  const daten = parseJson(readFileSync(datei, 'utf8'), 'projekte.json');
  if (!istObjekt(daten) || !Array.isArray(daten.projekte) || !daten.projekte.every((p) => istObjekt(p) && typeof p.repo === 'string')) {
    throw new Error('Aufbau falsch (erwartet {"version": 1, "projekte": [{"repo": …}]})');
  }
  const projekte = daten.projekte.map((p) => ({
    ...p, name: text(p.name) || p.repo, seite: SICHERER_LINK.test(text(p.seite)) ? p.seite : null,
    ziel: text(p.ziel), offene_punkte: text(p.offene_punkte), naechste_schritte: text(p.naechste_schritte),
  }));
  const themen = (Array.isArray(daten.themen) ? daten.themen : []).filter((t) => istObjekt(t) && typeof t.wort === 'string' && Number.isInteger(t.anzahl));
  return { projekte, themen };
}

/** Schreibt projekte.json (nach repo sortiert). Fehlt der hierarchie-Ordner, wird nichts angelegt: Ergebnis false. */
function schreibeDaten(datei, { projekte, themen }) {
  if (!existsSync(dirname(dirname(datei)))) return false;
  projekte.sort((a, b) => a.repo.localeCompare(b.repo));
  mkdirSync(dirname(datei), { recursive: true });
  writeFileSync(datei, `${JSON.stringify({ version: VERSION, projekte, themen }, null, 2)}\n`);
  return true;
}

const keinHierarchieRepo = (io, befehl, datei) => {
  io.fehler(`projekte ${befehl}: kein hierarchie-Repo unter ${dirname(dirname(datei))} – im hierarchie-Repo aufrufen oder es daneben klonen; nichts geändert`);
  return 1;
};

/** Bereichsregeln aus gedaechtnis/bereiche.json: { Bereich: ["name", "präfix-*"] }. Fehlt sie ⇒ {}; Aufbau falsch ⇒ Ausnahme. */
function liesBereiche(datei) {
  if (!existsSync(datei)) return {};
  const regeln = parseJson(readFileSync(datei, 'utf8'), 'bereiche.json');
  if (!istObjekt(regeln) || !Object.values(regeln).every((l) => Array.isArray(l) && l.every((x) => typeof x === 'string'))) {
    throw new Error('bereiche.json: Aufbau falsch (erwartet {"Bereich": ["repo", "präfix-*"]})');
  }
  return regeln;
}

/** Erster Bereich, dessen Regel auf den Repo-Namen (ohne owner, ohne Groß-/Kleinschreibung) passt, sonst null. */
function bereichFuer(repo, regeln) {
  const name = repo.split('/').pop().toLowerCase();
  const passt = (regel) => {
    const r = regel.toLowerCase();
    return r.endsWith('*') ? name.startsWith(r.slice(0, -1)) : name === r;
  };
  return Object.keys(regeln).find((bereich) => regeln[bereich].some(passt)) ?? null;
}

/** Zahl der Listenpunkte oberster Ebene (Unterpunkte, Fließtext und „keine“ zählen nicht). */
const zaehleOffen = (markdown) => String(markdown ?? '').split('\n')
  .filter((z) => /^(?:[-*+]|\d+[.)])\s/.test(z) && !/^\S+\s+(?:keine|–|-)\s*\.?\s*$/i.test(z)).length;

const abschnitt = (stand, name) => (stand.abschnitte.find((a) => a.name === name)?.inhalt ?? []).join('\n').trim();

/** Eintrag aus einer geprüften STAND.md (zerlegt). */
function eintragAusStand(stand, { repo = null, quelle = null, seite = null, eingelesen = null } = {}) {
  return {
    repo, name: stand.name, aktualisiert: stand.datumRoh, eingelesen, quelle,
    seite: seite ?? (SICHERER_LINK.test(stand.htmlSeite ?? '') ? stand.htmlSeite : null),
    ziel: abschnitt(stand, 'Ziel'), offene_punkte: abschnitt(stand, 'Offene Punkte'), naechste_schritte: abschnitt(stand, 'Nächste Schritte'),
  };
}

/** Das eigene Projekt frisch aus seiner STAND.md, oder null, wenn sie fehlt oder ungültig ist. */
function eigenesProjekt(orte) {
  const e = pruefeStand(orte.projektBasis);
  return e.vorhanden && !e.befunde.length ? eintragAusStand(e.stand) : null;
}

/**
 * Alle Projekte aus projekte.json mit Zahl offener Punkte; das eigene Projekt zuerst und frisch aus seiner STAND.md
 * (die Metadaten seines Eintrags bleiben). Ergebnis: { projekte, themen }.
 */
function alleProjekte(orte) {
  const eigen = eigenesProjekt(orte);
  const { projekte, themen } = liesDaten(projekteDatei(orte));
  const gespeichert = projekte.find((p) => p.name === eigen?.name);
  const andere = projekte.filter((p) => p !== gespeichert);
  const zuerst = eigen ? [{ ...gespeichert, ...eigen, repo: gespeichert?.repo ?? null, quelle: gespeichert?.quelle ?? null }] : [];
  return { projekte: [...zuerst, ...andere].map((p) => ({ ...p, offen: zaehleOffen(p.offene_punkte) })), themen };
}

/** Aktive Projekte nach Bereich (Reihenfolge wie in bereiche.json, „ohne Bereich“ zuletzt) und ruhende gesondert. */
function gruppiere(projekte, regeln) {
  const ruhende = projekte.filter((p) => p.aktiv === false);
  const namen = [...Object.keys(regeln), OHNE_BEREICH];
  const bereich = (p) => (namen.includes(p.bereich) ? p.bereich : OHNE_BEREICH); // auch Bereiche, die die Regeldatei nicht mehr kennt
  const gruppen = namen.map((name) => [name, projekte.filter((p) => p.aktiv !== false && bereich(p) === name)]).filter(([, liste]) => liste.length);
  return { gruppen, ruhende };
}

const bereicheDatei = (orte) => join(dirname(projekteDatei(orte)), 'bereiche.json');
const themenText = (themen) => themen.map((t) => `${t.wort} ${t.anzahl}`).join(', ');

/**
 * Zeile für `uebergabe`: offene Punkte der anderen Projekte, oder null (keine projekte.json, nichts offen). Wirft nie.
 */
export function anderswoZeile(orte) {
  try {
    const eigenerName = pruefeStand(orte.projektBasis).stand?.name;
    const andere = liesDaten(projekteDatei(orte)).projekte
      .filter((p) => p.name !== eigenerName)
      .map((p) => ({ ...p, offen: zaehleOffen(p.offene_punkte) }))
      .filter((p) => p.offen > 0);
    if (!andere.length) return null;
    const teile = andere.map((p) => `${p.name} ${p.offen} (Stand ${p.aktualisiert})`).join(', ');
    return `Anderswo offen: ${teile.length > 160 ? `${teile.slice(0, 159)}…` : teile} – Übersicht: projekte`;
  } catch (fehler) {
    return `Projektübersicht: projekte.json nicht lesbar (${String(fehler?.message ?? fehler).slice(0, 60)})`;
  }
}

// ---------------------------------------------------------------- Unterbefehle

function liste(argv, io, orte) {
  if (argv.length) throw new Bedienfehler(`projekte erwartet hier keine Argumente (${argv.join(' ')}); siehe --hilfe`);
  const { projekte, themen } = alleProjekte(orte);
  const { gruppen, ruhende } = gruppiere(projekte, liesBereiche(bereicheDatei(orte)));
  const zeile = (p) => [
    `${p.name}${p.repo ? ` (${p.repo})` : ''}`,
    ...(p.aktualisiert ? [`Stand ${p.aktualisiert}`, p.eingelesen ? `eingelesen ${p.eingelesen}` : 'frisch'] : [`keine ${DATEI}`]),
    `${p.offen} offen`,
    ...(p.sitzungen ? [`${p.sitzungen.anzahl} ${p.sitzungen.anzahl === 1 ? 'Sitzung' : 'Sitzungen'}`] : []),
    ...(p.seite ? [p.seite] : []),
  ].join(' · ');
  const zeilen = gruppen.flatMap(([name, liste]) => [`${name}:`, ...liste.map((p) => `  ${zeile(p)}`)]);
  if (ruhende.length) zeilen.push(`Ruhend (kein Push seit ${AKTIV_TAGE} Tagen): ${ruhende.map((p) => p.name).join(', ')}`);
  if (themen.length) zeilen.push(`Themen: ${themenText(themen)}`);
  if (projekte.length < 2) zeilen.push(`Weitere Projekte aufnehmen: projekte einlesen <owner/repo> <STAND.md>`);
  io.aus(zeilen.join('\n'));
  return 0;
}

function einlesen(argv, io, orte, jetzt) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--quelle', '--seite'] });
  if (pos.length !== 2) throw new Bedienfehler('einlesen erwartet <owner/repo> und den Pfad zur STAND.md (oder ihren Ordner); siehe --hilfe');
  const [repo, pfad] = pos;
  if (!REPO_MUSTER.test(repo)) throw new Bedienfehler(`"${repo}" ist kein Repo der Form owner/repo`);
  if (opt.seite !== undefined && !SICHERER_LINK.test(opt.seite)) throw new Bedienfehler('--seite muss ein https-Link sein');
  const voll = resolve(pfad);
  if (!existsSync(voll)) throw new Bedienfehler(`${pfad} gibt es nicht`);
  const istOrdner = statSync(voll).isDirectory();
  const ordner = istOrdner ? voll : dirname(voll);
  if (!istOrdner && basename(voll) !== DATEI) throw new Bedienfehler(`erwartet eine Datei namens ${DATEI} oder ihren Ordner`);

  const geprueft = pruefeStand(ordner);
  if (geprueft.befunde.length) {
    io.fehler(`projekte einlesen: ${DATEI} von ${repo} ist ungültig, nichts geändert:\n${geprueft.befunde.map((b) => `  ${b}`).join('\n')}`);
    return 1;
  }
  const datei = projekteDatei(orte);
  const daten = liesDaten(datei);
  const alt = daten.projekte.find((p) => p.repo.toLowerCase() === repo.toLowerCase());
  const eintrag = eintragAusStand(geprueft.stand, { repo, quelle: opt.quelle ?? null, seite: opt.seite ?? null, eingelesen: lokalesDatum(jetzt) });
  daten.projekte = [...daten.projekte.filter((p) => p !== alt), { ...alt, ...eintrag }]; // Metadaten aus `quellen` bleiben
  if (!schreibeDaten(datei, daten)) return keinHierarchieRepo(io, 'einlesen', datei);
  io.aus(`${repo}: Stand ${eintrag.aktualisiert}, ${zaehleOffen(eintrag.offene_punkte)} offen → ${datei}`);
  return 0;
}

/** owner/repo (klein) aus einer GitHub-URL, sonst null. */
const repoAusUrl = (url) => /github\.com[/:]([^/\s:]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(text(url))?.[1].toLowerCase() ?? null;

/**
 * Nur die erlaubten Felder einer Sitzung (Datenschutz): Titel, Datum, Repos. Alles andere wird nicht gelesen.
 * Der Schlüssel dient nur zum Entdoppeln über mehrere Seiten (ID, ohne ID Titel + Datum + Repos) und wird nicht gespeichert.
 */
function sitzungMetadaten(s) {
  const kontext = istObjekt(s.session_context) ? s.session_context : {};
  const repos = new Set([
    ...(Array.isArray(kontext.sources) ? kontext.sources : []).map((q) => repoAusUrl(q?.git_repository?.url)),
    ...(Array.isArray(kontext.outcomes) ? kontext.outcomes : []).map((o) => text(o?.git_repository?.git_info?.repo).toLowerCase() || null),
  ].filter(Boolean));
  const datum = text(s.updated_at || s.created_at).slice(0, 10);
  const titel = text(s.title);
  return { schluessel: text(s.id) || JSON.stringify([titel, text(s.updated_at || s.created_at), [...repos].sort()]), titel, datum: /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : null, repos };
}

/** Wörter (ab 4 Zeichen, ohne Füllwörter), die in mindestens MIN_THEMA Titeln vorkommen; je Titel einmal gezählt. */
function themenAus(titel) {
  const zaehler = new Map();
  for (const t of titel) {
    for (const wort of new Set(t.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [])) {
      if (wort.length >= 4 && !FUELLWOERTER.has(wort)) zaehler.set(wort, (zaehler.get(wort) ?? 0) + 1);
    }
  }
  return [...zaehler].filter(([, anzahl]) => anzahl >= MIN_THEMA).map(([wort, anzahl]) => ({ wort, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.wort.localeCompare(b.wort)).slice(0, MAX_THEMEN);
}

function quellen(argv, io, orte, jetzt) {
  const { pos } = zerlege(argv);
  if (!pos.length) throw new Bedienfehler('quellen erwartet JSON-Dateien mit den Antworten von list_repos und list_sessions; siehe --hilfe');
  const repos = new Map(); // klein → { repo, pushed_at }
  const sitzungen = new Map(); // Schlüssel → Metadaten
  let mitSitzungen = false; // ohne Sitzungsdatei bleiben Sitzungszahlen und Themen, wie sie sind
  for (const pfad of pos) {
    if (!existsSync(pfad)) throw new Bedienfehler(`${pfad} gibt es nicht`);
    let roh;
    try { roh = parseJson(readFileSync(pfad, 'utf8'), pfad); } catch { throw new Bedienfehler(`${pfad}: kein gültiges JSON`); } // Meldung ohne Dateiinhalt (könnte ein Titel sein)
    const liste = istObjekt(roh) ? (roh.ccr?.data ?? roh.data) : null;
    if (istObjekt(roh) && Array.isArray(roh.repos)) {
      for (const r of roh.repos) {
        if (istObjekt(r) && REPO_MUSTER.test(text(r.full_name)) && !Number.isNaN(Date.parse(r.pushed_at))) repos.set(r.full_name.toLowerCase(), { repo: r.full_name, pushed_at: r.pushed_at });
      }
    } else if (Array.isArray(liste)) {
      mitSitzungen = true;
      for (const s of liste.filter(istObjekt).map(sitzungMetadaten)) sitzungen.set(s.schluessel, s);
    } else throw new Bedienfehler(`${pfad}: weder Antwort von list_repos ({"repos": […]}) noch von list_sessions ({"data": […]})`);
  }
  if (!repos.size) throw new Bedienfehler('quellen braucht mindestens eine Datei mit Repos (Antwort von list_repos)');

  const datei = projekteDatei(orte);
  const daten = liesDaten(datei);
  const regeln = liesBereiche(bereicheDatei(orte));
  const grenze = jetzt.getTime() - AKTIV_TAGE * TAG_MS;
  for (const [klein, r] of repos) {
    const eigene = [...sitzungen.values()].filter((s) => s.repos.has(klein));
    const letzte = eigene.map((s) => s.datum).filter(Boolean).sort().at(-1) ?? null;
    const meta = {
      letzter_push: r.pushed_at.slice(0, 10), aktiv: Date.parse(r.pushed_at) >= grenze, bereich: bereichFuer(r.repo, regeln),
      ...(mitSitzungen ? { sitzungen: { anzahl: eigene.length, letzte } } : {}),
    };
    const alt = daten.projekte.find((p) => p.repo.toLowerCase() === klein);
    const neu = alt ? { ...alt, ...meta } : {
      repo: r.repo, name: r.repo.split('/').pop(), aktualisiert: null, eingelesen: null, quelle: null, seite: null,
      ziel: '', offene_punkte: '', naechste_schritte: '', ...meta,
    };
    daten.projekte = [...daten.projekte.filter((p) => p !== alt), neu];
  }
  if (mitSitzungen) daten.themen = themenAus([...sitzungen.values()].map((s) => s.titel));
  if (!schreibeDaten(datei, daten)) return keinHierarchieRepo(io, 'quellen', datei);
  const aktiv = [...repos.values()].filter((r) => Date.parse(r.pushed_at) >= grenze).length;
  io.aus(`${repos.size} Repos (${aktiv} aktiv, ${repos.size - aktiv} ruhend), ${mitSitzungen ? `${sitzungen.size} Sitzungen ausgewertet` : 'Sitzungen unverändert'} → ${datei}`
    + (daten.themen.length ? `\nThemen: ${themenText(daten.themen)}` : ''));
  return 0;
}

function html(argv, io, orte, jetzt) {
  if (argv.length) throw new Bedienfehler(`projekte html erwartet keine Argumente (${argv.join(' ')}); siehe --hilfe`);
  const { projekte, themen } = alleProjekte(orte);
  const { seite, voll } = baueUebersichtSeite({ erzeugt: jetzt, ...gruppiere(projekte, liesBereiche(bereicheDatei(orte))), themen, aktivTage: AKTIV_TAGE });
  const dokument = join(orte.projektBasis, 'uebersicht.html');
  const fragment = join(orte.projektBasis, 'uebersicht.seite.html');
  writeFileSync(dokument, voll);
  writeFileSync(fragment, seite);
  io.aus(`+ ${dokument}  (Dokument zum lokalen Öffnen)\n+ ${fragment}  (Fragment für claude.ai, mit dem Artifact-Werkzeug veröffentlichen)`);
  return 0;
}

// ---------------------------------------------------------------- Hauptablauf

const UNTERBEFEHLE = { einlesen, quellen, html };

/** Führt `projekte` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { orte = ermittleOrte(), jetzt = new Date() } = {}) {
  try {
    if (argv.some((a) => ['--hilfe', '--help', '-h'].includes(a)) || argv[0] === 'hilfe') { io.aus(HILFE); return 0; }
    const [unterbefehl, ...rest] = argv;
    if (unterbefehl === undefined) return liste(rest, io, orte);
    if (!Object.hasOwn(UNTERBEFEHLE, unterbefehl)) throw new Bedienfehler(`Unbekannter Unterbefehl "${unterbefehl}" (${Object.keys(UNTERBEFEHLE).join(', ')}; siehe --hilfe).`);
    return UNTERBEFEHLE[unterbefehl](rest, io, orte, jetzt);
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`hierarchie projekte: ${fehler.message}`); return 2; }
    io.fehler(`hierarchie projekte: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
