// Git-Aufrufe ohne Shell. Fehler (kein Git, kein Repository) ⇒ null statt Ausnahme.
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { gleicherOrt } from './pfade.mjs';

export function git(ordner, argumente) {
  try {
    return execFileSync('git', argumente, {
      cwd: ordner, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

/** Wie `git`, aber die rohe Ausgabe als Buffer (Dateiinhalte, NUL-getrennte Listen); Fehler oder mehr als `maxBytes` ⇒ null. */
export function gitBytes(ordner, argumente, maxBytes = 1 << 20) {
  try {
    return execFileSync('git', argumente, {
      cwd: ordner, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: maxBytes, windowsHide: true,
    });
  } catch {
    return null;
  }
}

/**
 * Ordner der Git-Hooks des Projekts: `core.hooksPath` (relativ zur Repo-Wurzel), sonst der Hook-Ordner von Git.
 * Ergebnis: { ordner } oder { grund } (kein Repository, oder der Ordner liegt nur in einem übergeordneten Repository).
 */
export function hooksOrdner(projekt) {
  const wurzel = git(projekt, ['rev-parse', '--show-toplevel']);
  if (wurzel === null) return { grund: 'kein Git-Repository' };
  if (!gleicherOrt(wurzel, projekt)) return { grund: `kein eigenes Git-Repository (gehört zu ${wurzel})` };

  const konfiguriert = git(projekt, ['config', '--get', '--type=path', 'core.hooksPath']);
  if (konfiguriert) return { ordner: isAbsolute(konfiguriert) ? konfiguriert : join(wurzel, konfiguriert) };

  const standard = git(projekt, ['rev-parse', '--git-path', 'hooks']);
  return { ordner: resolve(projekt, standard || '.git/hooks') };
}
