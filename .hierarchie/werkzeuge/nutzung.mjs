#!/usr/bin/env node
/**
 * hierarchie nutzung – Modellnutzung aus den lokalen Sitzungsprotokollen: Antworten und Tokens je Modell und je Sitzung.
 *
 *   nutzung [--tage N] [--api-preise] [--protokoll-ordner <pfad>] [--json]
 *
 * Nur lesen. Das Protokollformat ist intern und versionsabhängig; Zeilen, die nicht passen, werden übersprungen und gezählt.
 * Im Pro-Abo fallen keine Tokenkosten an; `--api-preise` liefert nur einen Vergleichswert.
 * Spezifikation: docs/spezifikation/werkzeuge.md (Tabelle „Weitere Werkzeuge“)
 */
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { git } from './lib/git.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { ermittleProtokolle, liesProtokoll, zahl } from './lib/protokolle.mjs';

const STANDARD_TAGE = 30;
const TAG_MS = 86400000;
const MAX_SITZUNGSZEILEN = 30;
const HILFE_OPTIONEN = ['--hilfe', '--help', '-h'];
const FAMILIEN = ['haiku', 'sonnet', 'opus', 'fable', 'andere'];
const HINWEIS = 'Format intern und versionsabhängig – Werte nach bestem Wissen; im Pro-Abo keine Kosten, Kontingent nicht abrufbar.';

/**
 * Preise in $ je Million Tokens (Eingabe / Ausgabe) laut docs/fakten-claude-code.md, Abschnitt „Preise“ (Stand 2026-10-15).
 * Cache-Preise stehen dort nicht; Cache-Tokens fließen deshalb nicht in den Vergleichswert ein. Haiku: Preis gilt bis 100K Kontext.
 */
export const PREISE_STAND = '2026-10-15';
export const PREISE = {
  fable: { id: 'claude-fable-5-1', eingabe: 10, ausgabe: 50 },
  opus: { id: 'claude-opus-5-5', eingabe: 4, ausgabe: 20 },
  sonnet: { id: 'claude-sonnet-5-5', eingabe: 2, ausgabe: 10 },
  haiku: { id: 'claude-haiku-5-5', eingabe: 0.1, ausgabe: 0.5 },
};

const HILFE = `Aufruf: hierarchie nutzung [--tage N] [--api-preise] [--protokoll-ordner <pfad>] [--json]

  Liest die Sitzungsprotokolle des aktuellen Projekts (nur lesen; $CLAUDE_CONFIG_DIR bzw. ~/.claude, darunter projects/<Projektpfad mit - statt Sonderzeichen>)
  und zeigt je Modell die Zahl der Antworten und die Summen von Eingabe-, Ausgabe-, Cache-Erstellungs- und Cache-Lese-Tokens,
  den Anteil der Modellfamilien (${FAMILIEN.join('/')}) an den Ausgabe-Tokens und eine Zeile je Sitzung.
  --tage N         nur Zeilen der letzten N Tage (Standard ${STANDARD_TAGE}); Zeilen ohne Zeitstempel zählen mit
  --api-preise     Vergleichswert in $ aus der Preistabelle (Stand ${PREISE_STAND}, aus docs/fakten-claude-code.md), nur Eingabe und Ausgabe –
                   Cache-Tokens sind nicht eingerechnet. Kein Kostenbetrag, sondern eine Verhältniszahl.
  --protokoll-ordner <pfad>   anderen Ordner mit .jsonl-Protokollen lesen (z. B. für Tests)
  --json           maschinenlesbar

Dieselbe Nachricht (message.id) zählt nur einmal, auch wenn sie in mehreren Zeilen oder Dateien steht. Protokolle der Subagenten
(Unterordner der Sitzung) werden mitgelesen und gesondert ausgewiesen. Nachrichten- und Dateitexte werden nie ausgegeben.
  Je message.id gilt je Feld der höchste Wert. Fehlt in allen Zeilen einer Antwort stop_reason, hat Claude Code nur den Zwischenstand protokolliert
  (Ausgabe-Tokens dann zu niedrig); solche Antworten werden gezählt und im Kopf gemeldet.
${HINWEIS}
Protokolle gibt es nur lokal; Cloud-Container verlieren sie beim Ende der Sitzung.
Exit-Code: 0 ok (auch ohne Protokolle) · 2 Bedienfehler (z. B. --tage ungültig)`;

const familieVon = (modell) => FAMILIEN.find((f) => f !== 'andere' && modell.toLowerCase().includes(f)) ?? 'andere';
const saubererName = (text, muster, ersatz) => (typeof text === 'string' && muster.test(text) ? text : ersatz);
const anzahl = (wert) => (Number.isFinite(wert) && wert > 0 ? wert : 0);

function tageAus(wert) {
  if (wert === undefined) return STANDARD_TAGE;
  if (!/^\d+$/.test(wert) || Number(wert) < 1) throw new Bedienfehler(`--tage erwartet eine ganze Zahl ≥ 1 (war „${wert}“)`);
  return Number(wert);
}

/** Wertet die Protokolle aus: Nachrichten (je message.id einmal) → Summen je Modell, Familie und Sitzung. */
export function wertAus(dateien, { tage = STANDARD_TAGE, jetzt = Date.now() } = {}) {
  const grenze = jetzt - tage * TAG_MS;
  const nachrichten = new Map();
  let uebersprungen = 0;
  let ausserhalb = 0;
  let doppelt = 0;
  let laufnummer = 0;
  const sitzungen = new Set();
  for (const { sitzung, datei, subagent } of dateien) {
    sitzungen.add(sitzung);
    const gelesen = liesProtokoll(datei);
    uebersprungen += gelesen.uebersprungen;
    for (const zeile of gelesen.zeilen) {
      if (zeile.type !== 'assistant') continue;
      const nachricht = zeile.message;
      if (nachricht === null || typeof nachricht !== 'object' || typeof nachricht.model !== 'string' || nachricht.usage === null || typeof nachricht.usage !== 'object') {
        uebersprungen++;
        continue;
      }
      if (nachricht.model.startsWith('<')) continue; // „<synthetic>“: keine API-Antwort
      const zeit = typeof zeile.timestamp === 'string' ? Date.parse(zeile.timestamp) : NaN;
      if (Number.isFinite(zeit) && zeit < grenze) { ausserhalb++; continue; }
      const u = nachricht.usage;
      const werte = {
        eingabe: anzahl(u.input_tokens), ausgabe: anzahl(u.output_tokens),
        cacheErstellung: anzahl(u.cache_creation_input_tokens), cacheLesen: anzahl(u.cache_read_input_tokens),
      };
      const schluessel = typeof nachricht.id === 'string' && nachricht.id !== '' ? `id:${nachricht.id}` : `zeile:${laufnummer++}`;
      const fertig = typeof nachricht.stop_reason === 'string';
      const vorhanden = nachrichten.get(schluessel);
      if (vorhanden) { // mehrfach vorhandene Nachricht: einmal zählen, höchste gemeldete Werte gelten (Zwischenstände steigen, der Endstand ist der höchste)
        doppelt++;
        vorhanden.fertig ||= fertig;
        for (const feld of Object.keys(werte)) vorhanden[feld] = Math.max(vorhanden[feld], werte[feld]);
        continue;
      }
      nachrichten.set(schluessel, {
        sitzung, subagent, modell: saubererName(nachricht.model, /^[A-Za-z0-9._:\/-]{1,60}$/, '(unbekannt)'),
        zeit: Number.isFinite(zeit) ? zeit : null, fertig, ...werte,
      });
    }
  }

  const summen = () => ({ antworten: 0, eingabe: 0, ausgabe: 0, cacheErstellung: 0, cacheLesen: 0 });
  let zwischenstand = 0;
  const addiere = (summe, n) => {
    summe.antworten++;
    for (const feld of ['eingabe', 'ausgabe', 'cacheErstellung', 'cacheLesen']) summe[feld] += n[feld];
  };
  const proModell = new Map();
  const proFamilie = Object.fromEntries(FAMILIEN.map((f) => [f, 0]));
  const proSitzung = new Map();
  const subagenten = summen();
  for (const n of nachrichten.values()) {
    const modell = proModell.get(n.modell) ?? { modell: n.modell, familie: familieVon(n.modell), ...summen(), subagentAntworten: 0, nurZwischenstand: 0 };
    addiere(modell, n);
    if (!n.fertig) { modell.nurZwischenstand++; zwischenstand++; }
    if (n.subagent) modell.subagentAntworten++;
    proModell.set(n.modell, modell);
    proFamilie[modell.familie] += n.ausgabe;
    const s = proSitzung.get(n.sitzung) ?? { sitzung: n.sitzung, ...summen(), subagentAntworten: 0, subagentAusgabe: 0, familien: {}, erste: null, letzte: null };
    addiere(s, n);
    if (n.subagent) { s.subagentAntworten++; s.subagentAusgabe += n.ausgabe; addiere(subagenten, n); }
    s.familien[modell.familie] = (s.familien[modell.familie] ?? 0) + 1;
    if (n.zeit !== null) { s.erste = Math.min(s.erste ?? n.zeit, n.zeit); s.letzte = Math.max(s.letzte ?? n.zeit, n.zeit); }
    proSitzung.set(n.sitzung, s);
  }
  const gesamtAusgabe = Object.values(proFamilie).reduce((a, b) => a + b, 0);
  return {
    tage,
    dateien: dateien.length,
    subagentenDateien: dateien.filter((d) => d.subagent).length,
    sitzungenGelesen: sitzungen.size,
    uebersprungeneZeilen: uebersprungen,
    ausserhalbZeitraum: ausserhalb,
    doppelteNachrichten: doppelt,
    antworten: nachrichten.size,
    antwortenNurZwischenstand: zwischenstand,
    modelle: [...proModell.values()].sort((a, b) => b.ausgabe - a.ausgabe || (a.modell < b.modell ? -1 : 1)),
    anteileAusgabe: Object.fromEntries(FAMILIEN.map((f) => [f, gesamtAusgabe ? proFamilie[f] / gesamtAusgabe : 0])),
    ausgabeGesamt: gesamtAusgabe,
    subagenten,
    sitzungen: [...proSitzung.values()].sort((a, b) => (b.letzte ?? 0) - (a.letzte ?? 0) || (a.sitzung < b.sitzung ? -1 : 1)),
  };
}

/** Vergleichswert in $ aus der Preistabelle; Modelle ohne Preis (Familie „andere“) stehen in `ohnePreis`. */
export function apiVergleich(modelle) {
  const proModell = [];
  const ohnePreis = [];
  let gesamt = 0;
  for (const m of modelle) {
    const preis = PREISE[m.familie];
    if (!preis) { ohnePreis.push(m.modell); continue; }
    const wert = (m.eingabe * preis.eingabe + m.ausgabe * preis.ausgabe) / 1e6;
    gesamt += wert;
    proModell.push({ modell: m.modell, wert });
  }
  return {
    stand: PREISE_STAND,
    hinweis: 'Vergleichswert API-Preise, keine tatsächlichen Kosten; nur Eingabe- und Ausgabe-Tokens (Cache-Tokens nicht eingerechnet)',
    gesamt, modelle: proModell, ohnePreis,
  };
}

const dollar = (wert) => `$${wert.toFixed(2).replace('.', ',')}`;
const datum = (ms) => (ms === null ? '?' : new Date(ms).toISOString().slice(0, 10));
const prozent = (anteil) => `${Math.round(anteil * 100)} %`;
const kurzId = (sitzung) => sitzung.replace(/[^A-Za-z0-9-]/g, '_').slice(0, 8);

function text(ergebnis, ordnername, preise) {
  const z = [
    `nutzung – letzte ${ergebnis.tage} Tage · Protokolle: ${ordnername} · ${ergebnis.sitzungenGelesen} Sitzungen, ${ergebnis.dateien} Dateien`
      + `${ergebnis.subagentenDateien ? ` (davon ${ergebnis.subagentenDateien} von Subagenten)` : ''}`,
    `Hinweis: ${HINWEIS}`,
    `Übersprungene Zeilen: ${zahl(ergebnis.uebersprungeneZeilen)} · außerhalb des Zeitraums: ${zahl(ergebnis.ausserhalbZeitraum)} · mehrfach vorkommende Nachrichten nur einmal gezählt: ${zahl(ergebnis.doppelteNachrichten)}`,
  ];
  if (ergebnis.dateien === 0) { z.push('Keine Protokolle gefunden (nur lokal vorhanden; Cloud-Container verlieren sie beim Ende).'); return z; }
  if (ergebnis.antworten === 0) z.push(`Keine Antworten im Zeitraum.`);
  else {
    z.push('', `Je Modell (${zahl(ergebnis.antworten)} Antworten):`);
    if (ergebnis.antwortenNurZwischenstand) {
      z.push(`Achtung: bei ${zahl(ergebnis.antwortenNurZwischenstand)} Antworten (ohne stop_reason) enthält das Protokoll nur den Zwischenstand der Ausgabe-Tokens – die Ausgabe-Summen sind dann Untergrenzen, vor allem bei Subagenten/Sonnet/Haiku.`);
    }
    const breite = Math.max(...ergebnis.modelle.map((m) => m.modell.length));
    for (const m of ergebnis.modelle) {
      z.push(`  ${m.modell.padEnd(breite)}  Antworten ${zahl(m.antworten)} · Eingabe ${zahl(m.eingabe)} · Ausgabe ${zahl(m.ausgabe)}`
        + ` · Cache-Erstellung ${zahl(m.cacheErstellung)} · Cache-Lesen ${zahl(m.cacheLesen)}`);
    }
    z.push('', `Anteil an den Ausgabe-Tokens: ${ergebnis.ausgabeGesamt ? FAMILIEN.map((f) => `${f} ${prozent(ergebnis.anteileAusgabe[f])}`).join(' · ') : 'keine Ausgabe-Tokens'}`);
    if (ergebnis.subagenten.antworten) {
      z.push(`Davon Subagenten: ${zahl(ergebnis.subagenten.antworten)} Antworten · Eingabe ${zahl(ergebnis.subagenten.eingabe)} · Ausgabe ${zahl(ergebnis.subagenten.ausgabe)}`);
    }
    z.push('', `Je Sitzung (${ergebnis.sitzungen.length}, jüngste zuerst):`);
    for (const s of ergebnis.sitzungen.slice(0, MAX_SITZUNGSZEILEN)) {
      const familien = Object.entries(s.familien).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ');
      z.push(`  ${kurzId(s.sitzung)}  ${datum(s.letzte)}  Antworten ${zahl(s.antworten)}${s.subagentAntworten ? ` (Subagenten ${zahl(s.subagentAntworten)})` : ''}`
        + ` · Eingabe ${zahl(s.eingabe)} · Ausgabe ${zahl(s.ausgabe)} · ${familien}`);
    }
    if (ergebnis.sitzungen.length > MAX_SITZUNGSZEILEN) z.push(`  … und ${ergebnis.sitzungen.length - MAX_SITZUNGSZEILEN} weitere (--json zeigt alle)`);
  }
  if (preise) {
    z.push('', `Vergleichswert API-Preise, keine tatsächlichen Kosten (Preistabelle Stand ${preise.stand}; nur Eingabe und Ausgabe, Cache-Tokens nicht eingerechnet):`);
    for (const m of preise.modelle) z.push(`  ${m.modell}: ${dollar(m.wert)}`);
    z.push(`  Summe: ${dollar(preise.gesamt)}${preise.ohnePreis.length ? ` (ohne Preis: ${preise.ohnePreis.join(', ')})` : ''}`);
  }
  return z;
}

/** Führt `nutzung` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export function main(argv, io = standardEinAus(), { ordner = process.cwd(), env = process.env, heim = homedir(), jetzt = Date.now() } = {}) {
  try {
    if (argv.some((a) => HILFE_OPTIONEN.includes(a))) { io.aus(HILFE); return 0; }
    const { pos, opt } = zerlege(argv, { mitWert: ['--tage', '--protokoll-ordner'], schalter: ['--api-preise', '--json'] });
    if (pos.length) throw new Bedienfehler(`keine Positionsargumente erwartet (${pos.join(' ')}); siehe --hilfe`);
    const tage = tageAus(opt.tage);
    const wurzel = git(ordner, ['rev-parse', '--show-toplevel']);
    const quelle = ermittleProtokolle([ordner, ...(wurzel ? [wurzel] : [])], opt['protokoll-ordner'], env, heim);
    const ergebnis = wertAus(quelle.dateien, { tage, jetzt });
    const preise = opt['api-preise'] ? apiVergleich(ergebnis.modelle) : null;
    if (opt.json) {
      io.aus(JSON.stringify({
        hinweis: HINWEIS, protokollordner: basename(quelle.ordner), ...ergebnis,
        sitzungen: ergebnis.sitzungen.map(({ sitzung, erste, letzte, ...rest }) => ({ sitzung, erste: erste && new Date(erste).toISOString(), letzte: letzte && new Date(letzte).toISOString(), ...rest })),
        ...(preise ? { apiPreise: preise } : {}),
      }, null, 2));
      return 0;
    }
    io.aus(text(ergebnis, basename(quelle.ordner), preise).join('\n'));
    return 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`nutzung: ${fehler.message}`); return 2; }
    io.fehler(`nutzung: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = main(process.argv.slice(2));
