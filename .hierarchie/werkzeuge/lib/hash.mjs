// Prüfsummen für die Änderungserkennung. Zeilenenden werden vereinheitlicht (CRLF → LF),
// damit eine unter Windows mit autocrlf ausgecheckte Kopie nicht als „lokal geändert“ gilt.
import { createHash } from 'node:crypto';

/** SHA-256 (hex) über Inhalt als Buffer oder Text; Binärdaten (mit NUL-Byte) bleiben unverändert. */
export function sha256(inhalt) {
  const daten = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(String(inhalt), 'utf8');
  const hash = createHash('sha256');
  if (daten.includes(0)) return hash.update(daten).digest('hex');
  return hash.update(daten.toString('latin1').replaceAll('\r\n', '\n'), 'latin1').digest('hex');
}
