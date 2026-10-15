// Dateihilfen: Pfade nach außen immer mit `/`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Inhalt als Buffer oder null, wenn die Datei fehlt. */
export function leseOderNull(pfad) {
  try {
    return readFileSync(pfad);
  } catch (fehler) {
    if (fehler.code === 'ENOENT' || fehler.code === 'ENOTDIR') return null;
    throw fehler;
  }
}

/**
 * Alle Dateien unter `ordner` (rekursiv), relativ, mit `/`, sortiert. Fehlender Ordner ⇒ [].
 * `ausser(pfad)` blendet Dateien aus, `ueberspringe(name)` ganze Unterordner (ohne hineinzugehen).
 */
export function listeDateien(ordner, ausser = () => false, ueberspringe = () => false) {
  const ergebnis = [];
  const gehe = (relativ) => {
    let eintraege;
    try {
      eintraege = readdirSync(join(ordner, relativ), { withFileTypes: true });
    } catch {
      return;
    }
    for (const eintrag of eintraege) {
      const pfad = relativ ? `${relativ}/${eintrag.name}` : eintrag.name;
      if (eintrag.isDirectory()) { if (!ueberspringe(eintrag.name)) gehe(pfad); }
      else if (eintrag.isFile() && !ausser(pfad)) ergebnis.push(pfad);
    }
  };
  if (existsSync(ordner)) gehe('');
  return ergebnis.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
