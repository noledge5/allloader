// Sitzungsprotokolle von Claude Code lesen (gemeinsam für `wiederholungen` und `nutzung`).
// Ort: <CLAUDE_CONFIG_DIR bzw. ~/.claude>/projects/<Projektordner>/<sitzung>.jsonl, Unterordner (z. B. <sitzung>/subagents/*.jsonl) gehören zur Sitzung.
// Das Format ist intern und versionsabhängig (docs/fakten-claude-code.md): jede Zeile, die nicht passt, wird übersprungen und gezählt.
// Die Protokolle werden nur gelesen. Inhalte (Befehle, Nachrichten, Dateitexte) gibt diese Datei nie weiter – nur, was die Aufrufer ausdrücklich herausziehen.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { listeDateien } from './dateien.mjs';

/** Größere Dateien werden nicht gelesen (Speicherschutz); sie zählen als eine übersprungene Zeile. */
export const MAX_DATEIGROESSE = 256 * 1024 * 1024;

/** Ordnername eines Projekts: jedes Zeichen außer [A-Za-z0-9] wird durch `-` ersetzt (so benennt Claude Code den Ordner). */
export const projektOrdnerName = (pfad) => String(pfad).replace(/[^A-Za-z0-9]/g, '-');

/** Ordner mit den Protokollen eines Projektpfads: `$CLAUDE_CONFIG_DIR` bzw. `~/.claude`, darunter `projects/<Projektordner>`. */
export function standardProtokollOrdner(projektPfad, env = process.env, heim = homedir()) {
  const konfig = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() !== '' ? env.CLAUDE_CONFIG_DIR : join(heim, '.claude');
  return join(konfig, 'projects', projektOrdnerName(projektPfad));
}

/**
 * Alle Protokolldateien unter `ordner`: [{ sitzung, datei (absolut), subagent }].
 * `<id>.jsonl` ist die Hauptdatei der Sitzung `<id>`; jede .jsonl in einem Unterordner `<id>/…` gehört zur Sitzung `<id>` (subagent: true).
 */
export function findeProtokolle(ordner) {
  if (!existsSync(ordner)) return [];
  const ergebnis = [];
  for (const relativ of listeDateien(ordner, (pfad) => !pfad.endsWith('.jsonl'))) {
    const teile = relativ.split('/');
    if (teile.length === 1) ergebnis.push({ sitzung: teile[0].slice(0, -'.jsonl'.length), datei: join(ordner, relativ), subagent: false });
    else ergebnis.push({ sitzung: teile[0], datei: join(ordner, relativ), subagent: true });
  }
  return ergebnis;
}

/**
 * Liest eine JSONL-Datei zeilenweise. Ergebnis: { zeilen: [Objekt], uebersprungen }.
 * Übersprungen (und gezählt) wird jede nicht leere Zeile, die kein JSON-Objekt mit Textfeld `type` ist, sowie eine zu große oder unlesbare Datei.
 */
export function liesProtokoll(datei) {
  let text;
  try {
    if (statSync(datei).size > MAX_DATEIGROESSE) return { zeilen: [], uebersprungen: 1 };
    text = readFileSync(datei, 'utf8');
  } catch {
    return { zeilen: [], uebersprungen: 1 };
  }
  const zeilen = [];
  let uebersprungen = 0;
  for (const roh of text.split('\n')) {
    if (roh.trim() === '') continue;
    let eintrag;
    try { eintrag = JSON.parse(roh); } catch { uebersprungen++; continue; }
    if (eintrag === null || typeof eintrag !== 'object' || Array.isArray(eintrag) || typeof eintrag.type !== 'string') { uebersprungen++; continue; }
    zeilen.push(eintrag);
  }
  return { zeilen, uebersprungen };
}

/** Aufgelöste Protokollquelle: { ordner, dateien } – `ueberschreibung` ist `--protokoll-ordner`; sonst der Standardordner zum Projektpfad. */
export function ermittleProtokolle(projektPfade, ueberschreibung, env = process.env, heim = homedir()) {
  if (ueberschreibung) return { ordner: ueberschreibung, dateien: findeProtokolle(ueberschreibung) };
  const kandidaten = [...new Set(projektPfade)].map((pfad) => standardProtokollOrdner(pfad, env, heim));
  const ordner = kandidaten.find((k) => existsSync(k)) ?? kandidaten[0];
  return { ordner, dateien: findeProtokolle(ordner) };
}

/** Zahl mit Tausenderpunkt (unabhängig von Gebietsschema und ICU). */
export const zahl = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
