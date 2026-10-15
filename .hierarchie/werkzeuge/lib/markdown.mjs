// Kleiner, sicherer Markdown-Umsetzer (nur für Pläne): Überschriften, Absätze, Listen (verschachtelt), Tabellen, Codeblöcke,
// Zitate, Trennlinien, fett/kursiv/Code/Links. Jede Eingabe wird HTML-maskiert; rohes HTML im Markdown bleibt Text.
// Links nur mit http(s), mailto oder ohne Schema (relativ, Anker); alles andere (z. B. javascript:) wird zu Text.

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);

const sichererLink = (url) => {
  const schema = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return schema === null || ['http', 'https', 'mailto'].includes(schema[1].toLowerCase());
};

/** Zeilenelemente: `code`, **fett**, *kursiv*, _kursiv_, [Text](Ziel). */
export function inline(text) {
  const codes = [];
  const ohneCode = String(text).replaceAll('\0', '').replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, inhalt) => {
    codes.push(`<code>${escapeHtml(inhalt.trim())}</code>`);
    return `\0${codes.length - 1}\0`;
  });
  let html = escapeHtml(ohneCode);
  html = html.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (treffer, beschriftung, url) => (sichererLink(url) ? `<a href="${url}">${beschriftung}</a>` : beschriftung));
  html = html.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])/g, '$1<em>$2</em>');
  return html.replace(/\0(\d+)\0/g, (_, i) => codes[Number(i)]);
}

const ZEILE_LISTE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TRENNLINIE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABELLEN_TRENNER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE = /^\s*(```|~~~)/;

const zellen = (zeile) => {
  let text = zeile.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((zelle) => zelle.replaceAll('\\|', '|').trim());
};

const aufgabe = (text) => text.replace(/^\[ \]\s+/, '☐ ').replace(/^\[[xX]\]\s+/, '☑ ');

function baueListe(zeilen) {
  // Baum nach Einrückung; Fortsetzungszeilen hängen am letzten Eintrag.
  const wurzel = { kinder: [], einzug: -1, geordnet: false };
  const stapel = [wurzel];
  for (const zeile of zeilen) {
    const treffer = zeile.match(ZEILE_LISTE);
    if (!treffer) {
      const letzter = stapel.at(-1);
      if (letzter.text !== undefined) letzter.text += ` ${zeile.trim()}`;
      continue;
    }
    const einzug = treffer[1].replaceAll('\t', '    ').length;
    while (stapel.length > 1 && stapel.at(-1).einzug >= einzug) stapel.pop();
    const eintrag = { text: treffer[3], einzug, kinder: [], geordnet: /^\d/.test(treffer[2]) };
    stapel.at(-1).kinder.push(eintrag);
    stapel.push(eintrag);
  }
  const rendere = (kinder) => {
    if (kinder.length === 0) return '';
    const tag = kinder[0].geordnet ? 'ol' : 'ul';
    const eintraege = kinder.map((k) => `<li>${inline(aufgabe(k.text))}${rendere(k.kinder)}</li>`).join('');
    return `<${tag}>${eintraege}</${tag}>`;
  };
  return rendere(wurzel.kinder);
}

/** Markdown → HTML-Fragment (ohne <html>-Rahmen). */
export function markdownZuHtml(markdown) {
  const zeilen = String(markdown).replace(/^﻿/, '').split(/\r?\n/);
  const aus = [];
  let i = 0;
  const istBlockBeginn = (zeile, naechste) => FENCE.test(zeile) || /^\s{0,3}#{1,6}\s/.test(zeile) || TRENNLINIE.test(zeile) || /^\s*>/.test(zeile)
    || ZEILE_LISTE.test(zeile) || (zeile.includes('|') && naechste !== undefined && TABELLEN_TRENNER.test(naechste) && naechste.includes('-'));

  while (i < zeilen.length) {
    const zeile = zeilen[i];
    if (zeile.trim() === '') { i++; continue; }

    const fence = zeile.match(FENCE);
    if (fence) {
      const code = [];
      i++;
      while (i < zeilen.length && !zeilen[i].trim().startsWith(fence[1])) code.push(zeilen[i++]);
      i++;
      aus.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const ueberschrift = zeile.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (ueberschrift) { aus.push(`<h${ueberschrift[1].length}>${inline(ueberschrift[2])}</h${ueberschrift[1].length}>`); i++; continue; }
    if (TRENNLINIE.test(zeile)) { aus.push('<hr>'); i++; continue; }

    if (zeile.includes('|') && i + 1 < zeilen.length && TABELLEN_TRENNER.test(zeilen[i + 1]) && zeilen[i + 1].includes('-')) {
      const kopf = zellen(zeile);
      const ausrichtung = zellen(zeilen[i + 1]).map((z) => (z.startsWith(':') && z.endsWith(':') ? 'center' : z.endsWith(':') ? 'right' : z.startsWith(':') ? 'left' : ''));
      i += 2;
      const zeilenHtml = [];
      while (i < zeilen.length && zeilen[i].trim() !== '' && zeilen[i].includes('|')) zeilenHtml.push(zellen(zeilen[i++]));
      const stil = (n) => (ausrichtung[n] ? ` style="text-align:${ausrichtung[n]}"` : '');
      const th = kopf.map((z, n) => `<th${stil(n)}>${inline(z)}</th>`).join('');
      const tr = zeilenHtml.map((r) => `<tr>${kopf.map((_, n) => `<td${stil(n)}>${inline(r[n] ?? '')}</td>`).join('')}</tr>`).join('');
      aus.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }

    if (/^\s*>/.test(zeile)) {
      const innen = [];
      while (i < zeilen.length && /^\s*>/.test(zeilen[i])) innen.push(zeilen[i++].replace(/^\s*>\s?/, ''));
      aus.push(`<blockquote>${markdownZuHtml(innen.join('\n'))}</blockquote>`);
      continue;
    }

    if (ZEILE_LISTE.test(zeile)) {
      const liste = [];
      while (i < zeilen.length) {
        if (ZEILE_LISTE.test(zeilen[i])) liste.push(zeilen[i++]);
        else if (zeilen[i].trim() !== '' && /^\s+\S/.test(zeilen[i])) liste.push(zeilen[i++]);
        else if (zeilen[i].trim() === '' && i + 1 < zeilen.length && ZEILE_LISTE.test(zeilen[i + 1])) i++;
        else break;
      }
      aus.push(baueListe(liste));
      continue;
    }

    const absatz = [zeile.trim()];
    i++;
    while (i < zeilen.length && zeilen[i].trim() !== '' && !istBlockBeginn(zeilen[i], zeilen[i + 1])) absatz.push(zeilen[i++].trim());
    aus.push(`<p>${inline(absatz.join(' '))}</p>`);
  }
  return aus.join('\n');
}
