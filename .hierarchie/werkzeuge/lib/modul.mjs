// Hilfen für Module, die sowohl importierbar als auch direkt aufrufbar sind.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Wurde dieses Modul (`import.meta.url`) direkt mit `node <datei>` gestartet? */
export function istStartdatei(moduleUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/** Standardausgabe für `main(argv, io)`-Funktionen; Tests übergeben eigene Sammler. */
export function standardEinAus() {
  return {
    aus: (text) => process.stdout.write(`${text}\n`),
    fehler: (text) => process.stderr.write(`${text}\n`),
  };
}
