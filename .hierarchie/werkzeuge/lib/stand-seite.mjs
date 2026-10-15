// HTML-Seite zum Projektstand (`stand html`): aus fertigen Daten ein Fragment für claude.ai und ein vollständiges Dokument.
// Reine Funktion ohne Dateizugriff. Alle Texte aus Projektdaten werden HTML-maskiert; STAND.md läuft durch den sicheren
// Umsetzer (lib/markdown.mjs). Gestaltungsregeln: docs/spezifikation/stand.md, Abschnitt „Gestaltung“.
import { escapeHtml, markdownZuHtml } from './markdown.mjs';

const e = escapeHtml;

// Farben nur hier (Tokens); alles andere im Stylesheet verwendet var(--…). Hell auf :root, dunkel zweimal (System und Umschalter).
const HELL = {
  bg: '#fafaf8', flaeche: '#f1f0ec', fg: '#1d1f23', leise: '#5b6169', rand: '#d9d7d0', akzent: '#2f5fd0',
  'gut-fg': '#1c6b34', 'gut-bg': '#dff3e4', 'warn-fg': '#8a5a00', 'warn-bg': '#fbefcf',
  'krit-fg': '#a4262c', 'krit-bg': '#fbe0e0', 'neutral-fg': '#4a5058', 'neutral-bg': '#e8e7e2',
  'balken-bg': '#e3e1da', fortschritt: '#2b7a6f',
};
const DUNKEL = {
  bg: '#16181c', flaeche: '#1f2227', fg: '#e6e7ea', leise: '#9aa1ab', rand: '#363a41', akzent: '#8ab4ff',
  'gut-fg': '#7ee2a0', 'gut-bg': '#16301f', 'warn-fg': '#f2c36b', 'warn-bg': '#3a2d10',
  'krit-fg': '#ff9a9f', 'krit-bg': '#3c1a1d', 'neutral-fg': '#b6bcc6', 'neutral-bg': '#2a2e35',
  'balken-bg': '#2d3138', fortschritt: '#6fb3a8',
};
const tokens = (werte, einzug) => Object.entries(werte).map(([name, wert]) => `${einzug}--${name}: ${wert};`).join('\n');

const SCHRIFT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">',
].join('\n');

const STIL = `:root {
  color-scheme: light;
${tokens(HELL, '  ')}
  --schrift: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${tokens(DUNKEL, '    ')}
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
${tokens(DUNKEL, '  ')}
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); margin: 0; font-family: var(--schrift); line-height: 1.55; }
.seite { background: var(--bg); color: var(--fg); padding-block: 24px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.spalte { max-width: 72ch; margin-inline: auto; overflow-wrap: anywhere; }
h1, h2, h3, h4 { line-height: 1.25; text-wrap: balance; }
h1 { font-size: 1.7rem; margin: 0 0 4px; }
h2 { font-size: 1.2rem; margin: 32px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--rand); }
h3 { font-size: 1.02rem; margin: 18px 0 4px; }
h4 { font-size: .95rem; margin: 12px 0 2px; }
a { color: var(--akzent); }
p, ul, ol { margin-block: 8px; }
.meta { color: var(--leise); font-size: .9rem; margin: 4px 0; }
code, .mono, pre { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: .88em; }
code { background: var(--flaeche); border-radius: 4px; padding: 1px 4px; }
pre { background: var(--flaeche); border-radius: 6px; padding: 10px 12px; overflow-x: auto; max-width: 100%; }
pre code { padding: 0; background: none; }
blockquote { margin: 12px 0; padding: 2px 14px; border-left: 3px solid var(--rand); color: var(--leise); }
hr { border: 0; border-top: 1px solid var(--rand); }
.tabelle { overflow-x: auto; max-width: 100%; margin-block: 8px; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { border: 1px solid var(--rand); padding: 5px 9px; text-align: left; vertical-align: top; font-variant-numeric: tabular-nums; }
td.mono { white-space: nowrap; }
th { background: var(--flaeche); }
.kennzahlen { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr)); gap: 8px; list-style: none; padding: 0; margin: 16px 0 0; }
.kz { background: var(--flaeche); border: 1px solid var(--rand); border-radius: 8px; padding: 10px 12px; min-width: 0; }
.kz .label { color: var(--leise); font-size: .8rem; }
.kz .wert { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 1.3rem; font-weight: 600; }
.kz .zusatz { color: var(--leise); font-size: .78rem; }
@media (max-width: 400px) { .kennzahlen { grid-template-columns: 1fr; } }
.pille { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: .78rem; font-weight: 600; white-space: nowrap; background: var(--neutral-bg); color: var(--neutral-fg); }
.pille.gut { background: var(--gut-bg); color: var(--gut-fg); }
.pille.warnung { background: var(--warn-bg); color: var(--warn-fg); }
.pille.kritisch { background: var(--krit-bg); color: var(--krit-fg); }
.pille.neutral { background: var(--neutral-bg); color: var(--neutral-fg); }
.plan { border: 1px solid var(--rand); border-radius: 8px; padding: 4px 14px 10px; margin: 12px 0; }
.fortschritt { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.balken { flex: 1; min-width: 60px; height: 8px; border-radius: 4px; background: var(--balken-bg); overflow: hidden; }
.balken span { display: block; height: 100%; background: var(--fortschritt); }
.pakete { list-style: none; padding: 0; margin: 6px 0 0; }
.pakete li { padding: 4px 0; border-top: 1px solid var(--rand); display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.pakete li:first-child { border-top: 0; }
.fuss { color: var(--leise); font-size: .82rem; margin-top: 40px; border-top: 1px solid var(--rand); padding-top: 10px; }`;

const PILLE_NACH_STATUS = { offen: 'neutral', in_arbeit: 'warnung', pruefung: 'warnung', fertig: 'gut', blockiert: 'kritisch' };
const PILLE_NACH_TEST = { gruen: 'gut', rot: 'kritisch', ungetestet: 'warnung' };
const TESTSTATUS_TEXT = { gruen: 'grün', rot: 'rot', ungetestet: 'ungetestet' };

const pille = (text, art) => `<span class="pille ${art}">${e(text)}</span>`;
const zeitpunkt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};
const tabelle = (kopf, zeilen) => `<div class="tabelle"><table><thead><tr>${kopf.map((k) => `<th>${e(k)}</th>`).join('')}</tr></thead>`
  + `<tbody>${zeilen.map((z) => `<tr>${z.join('')}</tr>`).join('')}</tbody></table></div>`;

function utsKennzahl(uts) {
  const art = { aktuell: ['aktuell grün', 'gut'], rot: ['aktuell rot', 'kritisch'], veraltet: ['veraltet', 'warnung'], teillauf: ['Teillauf', 'warnung'], keinlauf: ['kein Lauf', 'neutral'] }[uts?.status] ?? ['unbekannt', 'neutral'];
  const zusatz = [uts?.tests != null ? `${uts.tests} ${uts.tests === 1 ? 'Test' : 'Tests'}` : null, uts?.zeit ? `Lauf ${zeitpunkt(uts.zeit)}` : null].filter(Boolean).join(' · ');
  return `<li class="kz"><div class="label">UTS</div><div class="wert">${pille(art[0], art[1])}</div>${zusatz ? `<div class="zusatz">${e(zusatz)}</div>` : ''}</li>`;
}

const kennzahl = (label, wert, zusatz) => `<li class="kz"><div class="label">${e(label)}</div><div class="wert">${e(wert)}</div>${zusatz ? `<div class="zusatz">${e(zusatz)}</div>` : ''}</li>`;

function planHtml(plan) {
  const gesamt = plan.pakete.length;
  const fertig = plan.pakete.filter((p) => p.status === 'fertig').length;
  const prozent = gesamt ? Math.round((fertig / gesamt) * 100) : 0;
  const pakete = plan.pakete.map((p) => `<li><span class="mono">${e(p.id)}</span> <span>${e(p.titel)}</span> ${pille(p.status, PILLE_NACH_STATUS[p.status] ?? 'neutral')} ${pille(p.stufe, 'neutral')}</li>`).join('');
  return `<article class="plan"><h3>${e(plan.name)}${plan.abgeschlossen ? ` ${pille('abgeschlossen', 'gut')}` : ''}</h3>`
    + `<p class="meta">${e(plan.ziel)}</p>`
    + `<div class="fortschritt"><div class="balken" role="progressbar" aria-valuemin="0" aria-valuemax="${gesamt}" aria-valuenow="${fertig}"><span style="width:${prozent}%"></span></div><span class="mono">${fertig}/${gesamt} fertig</span></div>`
    + `<p class="meta">Delegationen <span class="mono">${plan.delegationen}/${plan.delegationen_max}</span></p>`
    + (gesamt ? `<ul class="pakete">${pakete}</ul>` : '<p class="meta">Noch keine Pakete.</p>')
    + '</article>';
}

const markdownBlock = (text) => markdownZuHtml(text).replaceAll('<table>', '<div class="tabelle"><table>').replaceAll('</table>', '</table></div>');

/** Rahmen beider Seiten: `seite` ohne doctype/html/head/body (claude.ai), `voll` als eigenständiges Dokument. */
function rahmen(titel, inhalt) {
  const rumpf = `<div class="seite"><div class="spalte">\n${inhalt}\n</div></div>`
    .replaceAll('#', '&#35;').replace(/\b(rgba?|hsla?)\(/gi, '$1&#40;'); // kein Text der Seite soll wie ein Farbwert aussehen („#123“, „rgb(…)“)
  const kopf = `<title>${e(titel)}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${STIL}\n</style>\n${SCHRIFT_LINKS}`;
  return {
    seite: `${kopf}\n${rumpf}\n`,
    voll: `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${kopf}\n</head>\n<body>\n${rumpf}\n</body>\n</html>\n`,
  };
}

/**
 * Baut die Seite. `d`: { projekt, erzeugt: Date, branch, aktualisiert, veraltet: Text|null, standFehlt, standMarkdown,
 * uts: {status, tests, zeit}, plaene: [Planstatus], plaeneOffen, werkzeuge: [{name, teststatus, modell_noetig}],
 * kandidaten: [Text], commits: [{sha, betreff, datum}] | null, uncommittet: Zahl | null }
 * Ergebnis: { seite, voll } – `seite` ohne doctype/html/head/body (claude.ai), `voll` als eigenständiges Dokument.
 */
export function baueStandSeite(d) {
  const titel = `${d.projekt} Stand`;
  const gruen = d.werkzeuge.filter((w) => w.teststatus === 'gruen').length;
  const kennzahlen = [
    utsKennzahl(d.uts),
    kennzahl('Offene Pläne', String(d.plaeneOffen)),
    kennzahl('Werkzeuge im Register', String(d.werkzeuge.length), `davon ${gruen} grün`),
    ...(d.uncommittet == null ? [] : [kennzahl('Uncommittete Dateien', String(d.uncommittet))]),
  ].join('');

  const offene = d.plaene.filter((p) => !p.abgeschlossen);
  const fertige = d.plaene.filter((p) => p.abgeschlossen);
  const defekt = d.plaeneDefekt?.length ? `<p class="meta">Nicht lesbar (status.json defekt): ${d.plaeneDefekt.map(e).join(', ')}</p>` : '';
  const plaene = d.plaene.length
    ? [...offene.map(planHtml), fertige.length ? `<p class="meta">Abgeschlossen: ${fertige.map((p) => e(p.name)).join(', ')}</p>` : '', defekt].join('')
    : `<p class="meta">Keine Pläne.</p>${defekt}`;

  const commits = d.commits == null ? '<p class="meta">Kein Git-Verlauf verfügbar.</p>'
    : d.commits.length ? tabelle(['Commit', 'Betreff', 'Datum'], d.commits.map((c) => [`<td class="mono">${e(c.sha)}</td>`, `<td>${e(c.betreff)}</td>`, `<td class="mono">${e(c.datum)}</td>`]))
      : '<p class="meta">Noch keine Commits.</p>';

  const werkzeuge = d.werkzeuge.length
    ? tabelle(['Werkzeug', 'Teststatus', 'Modell nötig'], d.werkzeuge.map((w) => [
      `<td class="mono">${e(w.name)}</td>`, `<td>${pille(TESTSTATUS_TEXT[w.teststatus] ?? String(w.teststatus), PILLE_NACH_TEST[w.teststatus] ?? 'neutral')}</td>`, `<td>${e(w.modell_noetig)}</td>`]))
    : '<p class="meta">Kein Register gefunden.</p>';
  const kandidaten = d.kandidaten.length ? `<h3>Offene Kandidaten</h3><ul>${d.kandidaten.map((k) => `<li>${e(k)}</li>`).join('')}</ul>` : '<p class="meta">Keine offenen Kandidaten.</p>';

  const stand = d.standFehlt ? '<p class="meta">STAND.md fehlt (<code>stand neu</code> legt sie an).</p>'
    : d.standMarkdown.trim() === '' ? '<p class="meta">STAND.md hat keinen Inhalt.</p>'
      : markdownBlock(d.standMarkdown);

  const aktualisiert = d.aktualisiert ? `Zuletzt aktualisiert <span class="mono">${e(d.aktualisiert)}</span>` : 'Zuletzt aktualisiert unbekannt';
  const inhalt = `<div class="kopf"><h1>${e(titel)}</h1>
<p class="meta">Erzeugt <span class="mono">${e(zeitpunkt(d.erzeugt.toISOString()))}</span>${d.branch ? ` · Branch <code>${e(d.branch)}</code>` : ''} · ${aktualisiert}${d.veraltet ? ` ${pille('veraltet', 'warnung')}` : ''}</p>
${d.veraltet ? `<p class="meta">${e(d.veraltet)}</p>` : ''}</div>
<ul class="kennzahlen">${kennzahlen}</ul>
<section>${stand}</section>
<section><h2>Pläne</h2>${plaene}</section>
<section><h2>Letzte Commits</h2>${commits}</section>
<section><h2>Werkzeuge</h2>${werkzeuge}${kandidaten}</section>
<p class="fuss">Erzeugt mit hierarchie stand html – ohne Modellaufruf</p>`;
  return rahmen(titel, inhalt);
}

/**
 * Projektübersicht (`projekte html`). `d`: { erzeugt: Date, gruppen: [[Bereich, [Projekt]]], ruhende: [Projekt],
 * themen: [{wort, anzahl}], aktivTage }. Projekt: { name, repo|null, aktualisiert|null, eingelesen|null, quelle|null, seite|null,
 * ziel, offene_punkte, naechste_schritte, offen: Zahl, letzter_push?, sitzungen?: {anzahl, letzte} }. Ergebnis wie `baueStandSeite`.
 */
export function baueUebersichtSeite(d) {
  const titel = 'Projektübersicht';
  const aktive = d.gruppen.flatMap(([, liste]) => liste);
  const offenGesamt = aktive.reduce((summe, p) => summe + p.offen, 0);
  const abschnitt = (name, text) => (text.trim() ? `<h4>${e(name)}</h4>${markdownBlock(text)}` : '');
  const karte = (p) => {
    const meta = [
      p.repo ? `<code>${e(p.repo)}</code>` : null,
      p.aktualisiert ? `Stand <span class="mono">${e(p.aktualisiert)}</span>` : 'noch keine STAND.md',
      p.aktualisiert ? (p.eingelesen ? `eingelesen <span class="mono">${e(p.eingelesen)}</span>` : 'frisch gelesen') : null,
      p.quelle ? `Quelle <code>${e(p.quelle)}</code>` : null,
      p.sitzungen ? `Sitzungen <span class="mono">${e(p.sitzungen.anzahl)}</span>${p.sitzungen.letzte ? ` (zuletzt <span class="mono">${e(p.sitzungen.letzte)}</span>)` : ''}` : null,
      p.seite ? `<a href="${e(p.seite)}">Projektseite</a>` : null,
    ].filter(Boolean).join(' · ');
    return `<article class="plan"><h3>${e(p.name)} ${pille(`${p.offen} offen`, p.offen ? 'warnung' : 'gut')}</h3><p class="meta">${meta}</p>`
      + `${abschnitt('Ziel', p.ziel)}${abschnitt('Offene Punkte', p.offene_punkte)}${abschnitt('Nächste Schritte', p.naechste_schritte)}</article>`;
  };
  const gruppen = d.gruppen.map(([bereich, liste]) => `<section><h2>${e(bereich)}</h2>\n${liste.map(karte).join('\n')}</section>`).join('\n');
  const ruhende = d.ruhende.length
    ? `<section><h2>Ruhende Repos</h2><p class="meta">Kein Push seit ${e(d.aktivTage)} Tagen.</p>${tabelle(['Repo', 'Bereich', 'Letzter Push', 'Sitzungen'], d.ruhende.map((p) => [
      `<td class="mono">${e(p.repo ?? p.name)}</td>`, `<td>${e(p.bereich ?? '–')}</td>`, `<td class="mono">${e(p.letzter_push ?? '–')}</td>`, `<td class="mono">${e(p.sitzungen?.anzahl ?? '–')}</td>`]))}</section>`
    : '';
  const themen = d.themen.length
    ? `<section><h2>Wiederkehrende Themen</h2><p class="meta">Wörter aus mindestens 3 Sitzungstiteln (die Titel selbst werden nicht gespeichert).</p>`
      + `<ul>${d.themen.map((t) => `<li>${e(t.wort)} <span class="mono">${e(t.anzahl)}×</span></li>`).join('')}</ul></section>`
    : '';
  const inhalt = `<div class="kopf"><h1>${e(titel)}</h1>
<p class="meta">Erzeugt <span class="mono">${e(zeitpunkt(d.erzeugt.toISOString()))}</span> · Momentaufnahmen aus den STAND.md der Projekte und Metadaten der Repos</p></div>
<ul class="kennzahlen">${kennzahl('Aktive Projekte', String(aktive.length))}${kennzahl('Ruhende Repos', String(d.ruhende.length))}${kennzahl('Offene Punkte', String(offenGesamt))}</ul>
${gruppen || '<p class="meta">Noch keine Projekte (<code>projekte einlesen</code>, <code>projekte quellen</code>).</p>'}
${ruhende}${themen}
<p class="fuss">Erzeugt mit hierarchie projekte html – ohne Modellaufruf</p>`;
  return rahmen(titel, inhalt);
}
