// JSON-Dateien lesen und so zurückschreiben, dass Einzug, Zeilenenden und Schlüsselreihenfolge erhalten bleiben.

export const istObjekt = (wert) => wert !== null && typeof wert === 'object' && !Array.isArray(wert);

/** Zeilenenden des Textes: CRLF, wenn dort überwiegend verwendet. */
export function erkenneZeilenende(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/** Parst JSON-Text (mit oder ohne BOM). Wirft Error mit verständlicher Meldung. */
export function parseJson(text, name = 'Datei') {
  try {
    return JSON.parse(String(text).replace(/^﻿/, ''));
  } catch (fehler) {
    throw new Error(`${name} ist kein gültiges JSON: ${fehler.message}`);
  }
}

/** Format der vorhandenen Datei: Einzug, Zeilenende, abschließender Umbruch, BOM. */
export function erkenneFormat(text) {
  const einzug = String(text).match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
  return {
    einzug,
    eol: erkenneZeilenende(text),
    umbruchAmEnde: /\n$/.test(text) || text.trim() === '',
    bom: text.startsWith('﻿'),
  };
}

/** Serialisiert `daten` im Format der Vorlage `format` (Standard: 2 Leerzeichen, LF, Umbruch am Ende). */
export function formatiereJson(daten, format = {}) {
  const { einzug = '  ', eol = '\n', umbruchAmEnde = true, bom = false } = format;
  let text = JSON.stringify(daten, null, einzug);
  if (eol !== '\n') text = text.replaceAll('\n', eol);
  return `${bom ? '﻿' : ''}${text}${umbruchAmEnde ? eol : ''}`;
}

export const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
