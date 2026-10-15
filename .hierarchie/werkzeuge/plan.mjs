#!/usr/bin/env node
/**
 * hierarchie plan – Pläne mit Arbeitspaketen und Status führen.
 *
 *   plan neu <name> --ziel "…"            legt plaene/<name>/plan.md (Vorlage) und status.json an
 *   plan paket <name> <id> --titel … --stufe … [--begruendung …] [--abhaengig WP1,WP2] [--abnahme "…"]   anlegen/ändern
 *   plan setze <name> <id> <status> [--notiz "…"]
 *   plan delegation <name>                zählt eine Delegation; ab dem Limit Exit 1
 *   plan zeige [<name>]                   eine Zeile je Paket; ohne Name alle nicht abgeschlossenen Pläne
 *   plan naechstes <name>                 erstes offenes Paket mit erfüllten Abhängigkeiten
 *   plan html <name>                      plan.html aus plan.md plus Statustabelle (eine Datei, offline)
 *
 * Schreiben ist der Zweck von neu, paket, setze, delegation und html (nur unter plaene/<name>/).
 * Spezifikation: docs/spezifikation/werkzeuge.md (Abschnitt „plan“)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { erkenneFormat, formatiereJson, istObjekt, parseJson } from './lib/json.mjs';
import { escapeHtml, markdownZuHtml } from './lib/markdown.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { NAME_MUSTER, ermittleOrte } from './lib/register.mjs';

export const STUFEN = ['werkzeug', 'haiku', 'sonnet', 'opus'];
export const STATUS = ['offen', 'in_arbeit', 'pruefung', 'fertig', 'blockiert'];
const ID_MUSTER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PLAENE = 'plaene';
const STANDARD_DELEGATIONEN = 12;

const HILFE = `Aufruf: hierarchie plan <unterbefehl> …

  neu <name> --ziel "…" [--delegationen-max <n>]
        legt ${PLAENE}/<name>/plan.md (aus vorlagen/plan.md) und status.json an (Standard: höchstens ${STANDARD_DELEGATIONEN} Delegationen)
  paket <name> <id> --titel "…" --stufe werkzeug|haiku|sonnet|opus [--begruendung "…"] [--abhaengig WP1,WP2|keine] [--abnahme "…"]
        Paket anlegen oder ändern (bei Änderung nur die genannten Felder; --abnahme darf wiederholt werden und ersetzt die Liste).
        Stufe opus braucht eine Begründung (Exit 2)
  setze <name> <id> <status> [--notiz "…"]
        Status: ${STATUS.join(' | ')}. in_arbeit nur, wenn alle Abhängigkeiten fertig sind (sonst Exit 1)
  delegation <name>
        zählt eine Delegation. Ist delegationen_max erreicht, Exit 1 mit Hinweis „anhalten und berichten“ (nicht gezählt)
  zeige [<name>]
        eine Zeile je Paket; ohne Name alle nicht abgeschlossenen Pläne
  naechstes <name>
        erstes offenes Paket, dessen Abhängigkeiten fertig sind
  html <name>
        schreibt ${PLAENE}/<name>/plan.html (plan.md als HTML plus Statustabelle; eine Datei, offline, hell/dunkel)

Der Status ändert sich nur über diese Befehle. Pläne liegen im Projekt unter ${PLAENE}/<name>/ (plan.html ist erzeugt und nicht versioniert).
Exit-Code: 0 ok · 1 Befund (ungültiger Übergang, Limit erreicht, defekte status.json) · 2 Bedienfehler`;

class Befund extends Error {}

// ---------------------------------------------------------------- Lesen und Schreiben

const planOrdner = (orte, name) => join(orte.projektBasis, PLAENE, name);
const anzeigePfad = (name, datei) => `${PLAENE}/${name}/${datei}`;

function pruefeName(name) {
  if (!NAME_MUSTER.test(name ?? '')) throw new Bedienfehler(`Plan-Name "${name ?? ''}" ungültig (erlaubt: [a-z0-9-]+, nicht mit - beginnend).`);
}

const istText = (wert) => typeof wert === 'string';
const istListe = (wert) => Array.isArray(wert) && wert.every(istText);

/** Strukturfehler einer status.json (leer = in Ordnung). */
export function pruefeStatus(status) {
  if (!istObjekt(status)) return ['Wurzel muss ein Objekt sein'];
  const fehler = [];
  for (const feld of ['name', 'ziel', 'erstellt', 'aktualisiert']) if (!istText(status[feld])) fehler.push(`${feld} fehlt (Text erwartet)`);
  if (typeof status.abgeschlossen !== 'boolean') fehler.push('abgeschlossen muss true oder false sein');
  for (const feld of ['delegationen_max', 'delegationen']) {
    if (!Number.isInteger(status[feld]) || status[feld] < 0) fehler.push(`${feld} muss eine ganze Zahl ≥ 0 sein`);
  }
  if (!Array.isArray(status.pakete)) fehler.push('pakete muss eine Liste sein');
  else {
    const ids = new Set();
    for (const [i, p] of status.pakete.entries()) {
      if (!istObjekt(p) || !istText(p.id) || !ID_MUSTER.test(p.id)) { fehler.push(`pakete[${i}]: id fehlt oder ist ungültig`); continue; }
      if (ids.has(p.id)) fehler.push(`${p.id}: id doppelt`);
      ids.add(p.id);
      if (!istText(p.titel) || p.titel.trim() === '') fehler.push(`${p.id}: titel fehlt`);
      if (!STUFEN.includes(p.stufe)) fehler.push(`${p.id}: stufe muss ${STUFEN.join('|')} sein`);
      if (!istText(p.begruendung)) fehler.push(`${p.id}: begruendung muss Text sein`);
      else if (p.stufe === 'opus' && p.begruendung.trim() === '') fehler.push(`${p.id}: Stufe opus braucht eine begruendung`);
      if (!STATUS.includes(p.status)) fehler.push(`${p.id}: status muss ${STATUS.join('|')} sein`);
      if (!istListe(p.abhaengig)) fehler.push(`${p.id}: abhaengig muss eine Liste von Texten sein`);
      if (!istListe(p.abnahme)) fehler.push(`${p.id}: abnahme muss eine Liste von Texten sein`);
      if (!istText(p.notiz)) fehler.push(`${p.id}: notiz muss Text sein`);
    }
    for (const p of status.pakete.filter((x) => istObjekt(x) && istListe(x.abhaengig))) {
      for (const d of p.abhaengig) if (!ids.has(d)) fehler.push(`${p.id}: abhaengig nennt unbekanntes Paket ${d}`);
    }
  }
  for (const feld of ['risiken', 'naechste_schritte']) if (!Array.isArray(status[feld])) fehler.push(`${feld} muss eine Liste sein`);
  return fehler;
}

function ladePlan(orte, name) {
  pruefeName(name);
  const ordner = planOrdner(orte, name);
  const pfad = join(ordner, 'status.json');
  if (!existsSync(pfad)) throw new Bedienfehler(`Plan "${name}" gibt es nicht (${anzeigePfad(name, 'status.json')} fehlt). Anlegen: plan neu ${name} --ziel "…"`);
  const text = readFileSync(pfad, 'utf8');
  let status;
  try {
    status = parseJson(text, anzeigePfad(name, 'status.json'));
  } catch (fehler) {
    throw new Befund(fehler.message);
  }
  const fehler = pruefeStatus(status);
  if (fehler.length) throw new Befund(`${anzeigePfad(name, 'status.json')} ist defekt: ${fehler.slice(0, 3).join('; ')}${fehler.length > 3 ? ` (+${fehler.length - 3})` : ''}`);
  return { name, ordner, pfad, text, status };
}

function speichere(plan, jetzt = new Date()) {
  plan.status.aktualisiert = jetzt.toISOString();
  plan.status.abgeschlossen = plan.status.pakete.length > 0 && plan.status.pakete.every((p) => p.status === 'fertig');
  writeFileSync(plan.pfad, formatiereJson(plan.status, plan.text === null ? {} : erkenneFormat(plan.text)));
}

const paketVon = (plan, id) => {
  const paket = plan.status.pakete.find((p) => p.id === id);
  if (!paket) throw new Bedienfehler(`Paket "${id}" gibt es im Plan ${plan.name} nicht (vorhanden: ${plan.status.pakete.map((p) => p.id).join(', ') || 'keine'}).`);
  return paket;
};

const offeneAbhaengigkeiten = (plan, paket) => paket.abhaengig.filter((id) => plan.status.pakete.find((p) => p.id === id)?.status !== 'fertig');

/** Gibt es im Abhängigkeitsgraphen einen Kreis? Liefert die Kette oder null. */
function findeKreis(pakete) {
  const abhaengig = new Map(pakete.map((p) => [p.id, p.abhaengig]));
  const besucht = new Set();
  const pfad = [];
  const gehe = (id) => {
    if (pfad.includes(id)) return [...pfad.slice(pfad.indexOf(id)), id];
    if (besucht.has(id)) return null;
    besucht.add(id);
    pfad.push(id);
    for (const d of abhaengig.get(id) ?? []) {
      const kreis = gehe(d);
      if (kreis) return kreis;
    }
    pfad.pop();
    return null;
  };
  for (const p of pakete) {
    const kreis = gehe(p.id);
    if (kreis) return kreis;
  }
  return null;
}

// ---------------------------------------------------------------- Unterbefehle

function neu(argv, io, orte, jetzt) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--ziel', '--delegationen-max'] });
  if (pos.length !== 1) throw new Bedienfehler('Erwartet: plan neu <name> --ziel "…"');
  const [name] = pos;
  pruefeName(name);
  if (!opt.ziel) throw new Bedienfehler('--ziel "…" fehlt (Ziel des Plans in einem Satz).');
  let max = STANDARD_DELEGATIONEN;
  if (opt['delegationen-max'] !== undefined) {
    if (!/^[1-9]\d*$/.test(opt['delegationen-max'])) throw new Bedienfehler('--delegationen-max erwartet eine ganze Zahl ≥ 1.');
    max = Number(opt['delegationen-max']);
  }
  const ordner = planOrdner(orte, name);
  if (existsSync(ordner)) throw new Bedienfehler(`Plan "${name}" gibt es schon (${PLAENE}/${name}/ existiert, wird nie überschrieben).`);
  const vorlagePfad = join(orte.installWurzel, 'vorlagen', 'plan.md');
  if (!existsSync(vorlagePfad)) throw new Error(`Vorlage fehlt: ${vorlagePfad}`);

  const ziel = opt.ziel.replace(/\s+/g, ' ').trim();
  const werte = { name, ziel, datum: jetzt.toISOString().slice(0, 10) };
  const planText = readFileSync(vorlagePfad, 'utf8').replace(/\{\{(\w+)\}\}/g, (treffer, schluessel) => (Object.hasOwn(werte, schluessel) ? werte[schluessel] : treffer));
  const status = {
    name, ziel, erstellt: jetzt.toISOString(), aktualisiert: jetzt.toISOString(), abgeschlossen: false,
    delegationen_max: max, delegationen: 0, pakete: [], risiken: [], naechste_schritte: [],
  };
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, 'plan.md'), planText);
  writeFileSync(join(ordner, 'status.json'), formatiereJson(status));
  io.aus([`+ ${anzeigePfad(name, 'plan.md')}`, `+ ${anzeigePfad(name, 'status.json')}  (Delegationen höchstens ${max})`,
    `Nächste Schritte: plan.md ausfüllen, Pakete anlegen (plan paket ${name} WP1 --titel … --stufe … --begruendung …).`].join('\n'));
  return 0;
}

function paket(argv, io, orte, jetzt) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--titel', '--stufe', '--begruendung', '--abhaengig'], mehrfach: ['--abnahme'] });
  if (pos.length !== 2) throw new Bedienfehler('Erwartet: plan paket <name> <id> --titel "…" --stufe … [--begruendung "…"] [--abhaengig WP1,WP2] [--abnahme "…"]');
  const [name, id] = pos;
  const plan = ladePlan(orte, name);
  if (!ID_MUSTER.test(id)) throw new Bedienfehler(`Paket-ID "${id}" ungültig (z. B. WP1: Buchstabe, dann Buchstaben, Ziffern, _ oder -).`);
  if (opt.stufe !== undefined && !STUFEN.includes(opt.stufe)) throw new Bedienfehler(`Stufe "${opt.stufe}" ungültig (erlaubt: ${STUFEN.join(', ')}).`);

  const vorhanden = plan.status.pakete.find((p) => p.id === id);
  if (!vorhanden && (!opt.titel || !opt.stufe)) throw new Bedienfehler('Neues Paket braucht --titel und --stufe.');
  const neuesPaket = vorhanden ?? { id, titel: '', stufe: '', begruendung: '', status: 'offen', abhaengig: [], abnahme: [], notiz: '' };
  const kandidat = { ...neuesPaket, abhaengig: [...neuesPaket.abhaengig], abnahme: [...neuesPaket.abnahme] };
  if (opt.titel !== undefined) kandidat.titel = opt.titel.trim();
  if (opt.stufe !== undefined) kandidat.stufe = opt.stufe;
  if (opt.begruendung !== undefined) kandidat.begruendung = opt.begruendung.trim();
  if (opt.abnahme !== undefined) kandidat.abnahme = opt.abnahme.map((a) => a.trim());
  if (opt.abhaengig !== undefined) {
    kandidat.abhaengig = opt.abhaengig === 'keine' ? [] : [...new Set(opt.abhaengig.split(',').map((d) => d.trim()).filter(Boolean))];
  }
  if (kandidat.stufe === 'opus' && kandidat.begruendung.trim() === '') {
    throw new Bedienfehler(`Stufe opus braucht einen benannten Grund: --begruendung "…" (Architektur, mehrere Hypothesen, Fehler nach Sonnet-Versuch, Sicherheit/Datenschutz, Refactoring über viele Komponenten, Synthese widersprüchlicher Anforderungen).`);
  }
  const bekannt = new Set([...plan.status.pakete.map((p) => p.id), id]);
  for (const d of kandidat.abhaengig) {
    if (d === id) throw new Bedienfehler(`Paket ${id} kann nicht von sich selbst abhängen.`);
    if (!bekannt.has(d)) throw new Bedienfehler(`Abhängigkeit "${d}" gibt es im Plan ${name} nicht (zuerst anlegen).`);
  }
  const pakete = vorhanden ? plan.status.pakete.map((p) => (p.id === id ? kandidat : p)) : [...plan.status.pakete, kandidat];
  const kreis = findeKreis(pakete);
  if (kreis) throw new Bedienfehler(`Zyklische Abhängigkeit: ${kreis.join(' → ')}.`);

  plan.status.pakete = pakete;
  speichere(plan, jetzt);
  io.aus(`${id} ${vorhanden ? 'geändert' : 'angelegt'}: ${kandidat.titel} · ${kandidat.stufe}${kandidat.abhaengig.length ? ` · abhängig von ${kandidat.abhaengig.join(', ')}` : ''}`);
  return 0;
}

function setze(argv, io, orte, jetzt) {
  const { pos, opt } = zerlege(argv, { mitWert: ['--notiz'] });
  if (pos.length !== 3) throw new Bedienfehler('Erwartet: plan setze <name> <id> <status> [--notiz "…"]');
  const [name, id, neuerStatus] = pos;
  const plan = ladePlan(orte, name);
  const p = paketVon(plan, id);
  if (!STATUS.includes(neuerStatus)) throw new Befund(`Ungültiger Status "${neuerStatus}" (erlaubt: ${STATUS.join(', ')}).`);
  if (neuerStatus === 'in_arbeit') {
    const offen = offeneAbhaengigkeiten(plan, p);
    if (offen.length) throw new Befund(`${id} kann nicht in_arbeit: Abhängigkeit nicht fertig (${offen.map((d) => `${d}: ${plan.status.pakete.find((x) => x.id === d).status}`).join(', ')}).`);
  }
  const alt = p.status;
  p.status = neuerStatus;
  if (opt.notiz !== undefined) p.notiz = opt.notiz.trim();
  speichere(plan, jetzt);
  io.aus(`${id}: ${alt} → ${neuerStatus}${opt.notiz !== undefined ? ' (Notiz gesetzt)' : ''}${plan.status.abgeschlossen ? `\nPlan ${name} abgeschlossen: alle Pakete fertig.` : ''}`);
  return 0;
}

function delegation(argv, io, orte, jetzt) {
  const { pos } = zerlege(argv);
  if (pos.length !== 1) throw new Bedienfehler('Erwartet: plan delegation <name>');
  const plan = ladePlan(orte, pos[0]);
  const { delegationen, delegationen_max: max } = plan.status;
  if (delegationen >= max) {
    io.fehler(`plan ${plan.name}: Limit erreicht (${delegationen} von ${max} Delegationen). Anhalten und berichten; nicht gezählt.`);
    return 1;
  }
  plan.status.delegationen = delegationen + 1;
  speichere(plan, jetzt);
  io.aus(`Delegation ${delegationen + 1} von ${max}.${delegationen + 1 === max ? ' Limit erreicht: nach dieser Delegation anhalten und berichten.' : ''}`);
  return 0;
}

const paketZeile = (p) => `${p.id} · ${p.status} · ${p.stufe} · ${p.titel}${p.abhaengig.length ? ` (abhängig: ${p.abhaengig.join(', ')})` : ''}`;
const planKopf = (s) => `Plan ${s.name} – ${s.ziel} · Delegationen ${s.delegationen}/${s.delegationen_max} · ${s.abgeschlossen ? 'abgeschlossen' : 'offen'}`;

function zeige(argv, io, orte) {
  const { pos } = zerlege(argv);
  if (pos.length > 1) throw new Bedienfehler('Erwartet: plan zeige [<name>]');
  if (pos.length === 1) {
    const { status } = ladePlan(orte, pos[0]);
    io.aus([planKopf(status), ...(status.pakete.length ? status.pakete.map(paketZeile) : ['(noch keine Pakete)'])].join('\n'));
    return 0;
  }
  const wurzel = join(orte.projektBasis, PLAENE);
  const namen = existsSync(wurzel) ? readdirSync(wurzel, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(wurzel, e.name, 'status.json'))).map((e) => e.name).sort() : [];
  const zeilen = [];
  let defekt = 0;
  for (const name of namen) {
    try {
      const { status } = ladePlan(orte, name);
      if (status.abgeschlossen) continue;
      zeilen.push(planKopf(status), ...(status.pakete.length ? status.pakete.map(paketZeile) : ['(noch keine Pakete)']));
    } catch (fehler) {
      if (!(fehler instanceof Befund || fehler instanceof Bedienfehler)) throw fehler;
      zeilen.push(`Plan ${name}: ${fehler.message}`);
      defekt++;
    }
  }
  io.aus(zeilen.length ? zeilen.join('\n') : 'Keine offenen Pläne.');
  return defekt ? 1 : 0;
}

function naechstes(argv, io, orte) {
  const { pos } = zerlege(argv);
  if (pos.length !== 1) throw new Bedienfehler('Erwartet: plan naechstes <name>');
  const plan = ladePlan(orte, pos[0]);
  const bereit = plan.status.pakete.find((p) => p.status === 'offen' && offeneAbhaengigkeiten(plan, p).length === 0);
  if (bereit) { io.aus(paketZeile(bereit)); return 0; }
  const pakete = plan.status.pakete;
  if (pakete.length === 0) io.aus('Kein Paket: der Plan hat noch keine Pakete (plan paket …).');
  else if (pakete.every((p) => p.status === 'fertig')) io.aus('Kein Paket offen: alle Pakete fertig.');
  else {
    const laufend = pakete.filter((p) => ['in_arbeit', 'pruefung'].includes(p.status)).map((p) => `${p.id} (${p.status})`);
    const blockiert = pakete.filter((p) => p.status === 'blockiert' || (p.status === 'offen' && offeneAbhaengigkeiten(plan, p).length)).map((p) => p.id);
    io.aus(`Kein Paket startbereit.${laufend.length ? ` Laufend: ${laufend.join(', ')}.` : ''}${blockiert.length ? ` Wartet oder blockiert: ${blockiert.join(', ')}.` : ''}`);
  }
  return 0;
}

// ---------------------------------------------------------------- plan.html

const CSS = `:root{color-scheme:light dark;--bg:#fff;--flaeche:#f3f4f6;--text:#1f2933;--leise:#52606d;--rand:#cbd2d9;--akzent:#1f6feb;--gruen:#1a7f37;--gelb:#9a6700;--rot:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#14181d;--flaeche:#1e242b;--text:#e4e7eb;--leise:#9aa5b1;--rand:#3e4c59;--akzent:#58a6ff;--gruen:#3fb950;--gelb:#d29922;--rot:#f85149}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,sans-serif}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 3rem}h1,h2,h3{line-height:1.25}h2{margin-top:2rem;border-bottom:1px solid var(--rand);padding-bottom:.25rem}
a{color:var(--akzent)}code,pre{font:14px/1.5 ui-monospace,monospace;background:var(--flaeche);border-radius:.35rem}code{padding:.1rem .3rem}pre{padding:.75rem;overflow:auto}pre code{padding:0}
table{border-collapse:collapse;width:100%;margin:1rem 0;display:block;overflow-x:auto}th,td{border:1px solid var(--rand);padding:.4rem .6rem;text-align:left;vertical-align:top}th{background:var(--flaeche)}
blockquote{margin:1rem 0;padding:.1rem 1rem;border-left:4px solid var(--rand);color:var(--leise)}.meta{color:var(--leise)}
.s-fertig{color:var(--gruen);font-weight:600}.s-in_arbeit,.s-pruefung{color:var(--gelb);font-weight:600}.s-blockiert{color:var(--rot);font-weight:600}`;

const zelle = (text) => escapeHtml(text);

/** Vollständige HTML-Seite (eine Datei, ohne externe Ressourcen, ohne Skript) aus plan.md und status.json. */
export function baueHtml(status, planText) {
  const zeilen = status.pakete.map((p) => `<tr><td>${zelle(p.id)}</td><td>${zelle(p.titel)}</td><td>${zelle(p.stufe)}</td>`
    + `<td class="s-${STATUS.includes(p.status) ? p.status : 'offen'}">${zelle(p.status)}</td><td>${zelle(p.abhaengig.join(', '))}</td>`
    + `<td>${p.abnahme.length ? `<ul>${p.abnahme.map((a) => `<li>${zelle(a)}</li>`).join('')}</ul>` : ''}</td><td>${zelle(p.notiz)}</td></tr>`).join('\n');
  const tabelle = status.pakete.length
    ? `<table><thead><tr><th>Paket</th><th>Titel</th><th>Stufe</th><th>Status</th><th>Abhängig von</th><th>Abnahme</th><th>Notiz</th></tr></thead>\n<tbody>\n${zeilen}\n</tbody></table>`
    : '<p class="meta">Noch keine Pakete.</p>';
  const liste = (titel, eintraege) => (eintraege.length ? `<h3>${titel}</h3><ul>${eintraege.map((e) => `<li>${zelle(typeof e === 'string' ? e : JSON.stringify(e))}</li>`).join('')}</ul>` : '');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan ${escapeHtml(status.name)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
<h1>Plan ${escapeHtml(status.name)}</h1>
<p>${escapeHtml(status.ziel)}</p>
<p class="meta">${status.abgeschlossen ? 'abgeschlossen' : 'offen'} · Delegationen ${status.delegationen} von ${status.delegationen_max} · aktualisiert ${escapeHtml(status.aktualisiert)}</p>
<h2>Status der Arbeitspakete</h2>
${tabelle}
${liste('Risiken', status.risiken)}${liste('Nächste Schritte', status.naechste_schritte)}
<h2>Plan</h2>
${planText === null ? '<p class="meta">plan.md fehlt.</p>' : markdownZuHtml(planText)}
</main>
</body>
</html>
`;
}

function html(argv, io, orte) {
  const { pos } = zerlege(argv);
  if (pos.length !== 1) throw new Bedienfehler('Erwartet: plan html <name>');
  const plan = ladePlan(orte, pos[0]);
  const planPfad = join(plan.ordner, 'plan.md');
  const text = existsSync(planPfad) ? readFileSync(planPfad, 'utf8') : null;
  writeFileSync(join(plan.ordner, 'plan.html'), baueHtml(plan.status, text));
  io.aus(`+ ${anzeigePfad(plan.name, 'plan.html')}${text === null ? '  (plan.md fehlt, nur die Statustabelle)' : ''}`);
  return 0;
}

// ---------------------------------------------------------------- Hauptablauf

const UNTERBEFEHLE = { neu, paket, setze, delegation, zeige, naechstes, html };

/** Führt `plan` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { orte = ermittleOrte(), jetzt = new Date() } = {}) {
  try {
    const [unterbefehl, ...rest] = argv;
    if (unterbefehl === undefined) { io.fehler(`hierarchie plan: Unterbefehl fehlt.\n\n${HILFE}`); return 2; }
    if (['--hilfe', '--help', '-h', 'hilfe'].includes(unterbefehl) || rest.some((a) => ['--hilfe', '--help', '-h'].includes(a))) {
      io.aus(HILFE);
      return 0;
    }
    if (!Object.hasOwn(UNTERBEFEHLE, unterbefehl)) {
      throw new Bedienfehler(`Unbekannter Unterbefehl "${unterbefehl}" (${Object.keys(UNTERBEFEHLE).join(', ')}; siehe --hilfe).`);
    }
    return UNTERBEFEHLE[unterbefehl](rest, io, orte, jetzt);
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`hierarchie plan: ${fehler.message}`); return 2; }
    if (fehler instanceof Befund) { io.fehler(`hierarchie plan: ${fehler.message}`); return 1; }
    io.fehler(`hierarchie plan: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
