// Markierungsblöcke in Textdateien einfügen oder ersetzen; Text außerhalb bleibt unangetastet.
import { erkenneZeilenende } from './json.mjs';

const maskiere = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Erste Zeile ab `ab`, die genau `marker` enthält (Leerraum am Zeilenende erlaubt).
function findeZeile(text, marker, ab = 0) {
  const re = new RegExp(`^${maskiere(marker)}[ \\t]*\\r?$`, 'gm');
  re.lastIndex = ab;
  const treffer = re.exec(text);
  return treffer ? { start: treffer.index, ende: treffer.index + marker.length } : null;
}

/**
 * Setzt den Block `anfang` … `ende` mit `inhalt` ein.
 * `ort`: 'ende' (hinten anhängen) oder 'nachErsterZeile' (hinter die Shebang-Zeile).
 * Ergebnis: { text, status: 'neu' | 'ersetzt' | 'unveraendert' | 'defekt' }
 * 'defekt' = Anfangs- ohne Endmarke (dann bleibt der Text unverändert).
 */
export function setzeBlock(text, anfang, ende, inhalt, ort = 'ende') {
  const eol = text.includes('\n') ? erkenneZeilenende(text) : '\n';
  const zeilen = inhalt.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const block = [anfang, ...zeilen, ende].join(eol);

  const von = findeZeile(text, anfang);
  if (von) {
    const bis = findeZeile(text, ende, von.start + anfang.length);
    if (!bis) return { text, status: 'defekt' };
    const alt = text.slice(von.start, bis.ende);
    if (alt === block) return { text, status: 'unveraendert' };
    return { text: text.slice(0, von.start) + block + text.slice(bis.ende), status: 'ersetzt' };
  }

  if (ort === 'nachErsterZeile') {
    const umbruch = text.indexOf('\n');
    if (umbruch === -1) return { text: `${text}${eol}${block}${eol}`, status: 'neu' };
    return { text: `${text.slice(0, umbruch + 1)}${block}${eol}${text.slice(umbruch + 1)}`, status: 'neu' };
  }

  if (text.trim() === '') return { text: `${block}${eol}`, status: 'neu' };
  const abschluss = text.endsWith('\n') ? '' : eol;
  const leerzeile = /(\r?\n){2}$/.test(text) ? '' : eol;
  return { text: `${text}${abschluss}${leerzeile}${block}${eol}`, status: 'neu' };
}
