// Prüft das Projektgedächtnis STAND.md mit (Gerüst von `hierarchie einrichten`, Vorlage vorlagen/stand.test.mjs.vorlage).
// Ruft dieselbe Prüfung auf wie `hierarchie stand pruefen`: fehlende Datei, falscher Aufbau, ungültiges Datum oder zu lang
// machen den Test rot. "Veraltet" ist nur eine Warnung. Ist nur der Platzhalter der Vorlage der Befund (frisch
// eingerichtet, noch nicht ausgefüllt), wird der Test übersprungen; `stand pruefen` bleibt dann trotzdem Exit 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruefeStand } from '../.hierarchie/werkzeuge/stand.mjs';

const projekt = dirname(dirname(fileURLToPath(import.meta.url)));

test('STAND.md ist vorhanden und gültig (stand pruefen)', (t) => {
  const ergebnis = pruefeStand(projekt);
  if (ergebnis.nurPlatzhalter) { t.skip('STAND.md noch nicht ausgefüllt – Vorlage ausfüllen'); return; }
  assert.deepEqual(ergebnis.befunde, [], `STAND.md ausfüllen bzw. nachführen: ${ergebnis.befunde.join(' | ')}`);
});
