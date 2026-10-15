#!/usr/bin/env node
/**
 * hierarchie neues-werkzeug <name> [--app] [--zweck "…"]
 *
 * Legt das Gerüst eines neuen Werkzeugs an: Skript (oder mit --app eine HTML-App), Test und Registereintrag.
 * Schreiben ist der Zweck dieses Befehls. Vorhandene Dateien und Namen werden nie überschrieben (Exit 2).
 *
 * Im hierarchie-Repo:  werkzeuge/<name>.mjs + tests/<name>.test.mjs        (App: apps/<name>.html + tests/<name>.test.mjs)
 * Im Projekt:          automatisierung/werkzeuge/<name>.mjs + <name>.test.mjs daneben
 *                      (App: automatisierung/apps/<name>.html + <name>.test.mjs daneben)
 * Spezifikation: docs/spezifikation/werkzeuge.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Bedienfehler, zerlege } from './lib/argumente.mjs';
import { istStartdatei, standardEinAus } from './lib/modul.mjs';
import { GERUEST_MARKE, NAME_MUSTER, ermittleOrte, liesRegister, pruefeSchema, schreibeRegister } from './lib/register.mjs';

const RESERVIERT = ['hilfe'];
const NOCH_ZU_BESCHREIBEN = '(noch zu beschreiben)';

const HILFE = `Aufruf: hierarchie neues-werkzeug <name> [--app] [--zweck "…"]

  <name>         [a-z0-9-]+ (nicht mit - beginnend); ein vorhandener Name (Register oder Datei) ⇒ Exit 2
  --app          statt eines Skripts eine kleine HTML-App (eine Datei, offline, helles/dunkles Farbschema)
  --zweck "…"    Zweck in einem Satz (Register und Kopfzeile)

Legt an (hierarchie-Repo):  werkzeuge/<name>.mjs + tests/<name>.test.mjs   (App: apps/<name>.html + tests/<name>.test.mjs)
Legt an (Projekt):          automatisierung/werkzeuge/<name>.mjs + <name>.test.mjs daneben
                            (App: automatisierung/apps/<name>.html + <name>.test.mjs daneben)
und einen Eintrag im Register (teststatus "ungetestet", Häufigkeit "vermutet"). Der Gerüst-Test ist bewusst ein
todo-Test; solange die Marke ${GERUEST_MARKE} in der Testdatei steht, bleibt der Teststatus "ungetestet".
Skripte sind danach als \`hierarchie <name>\` aufrufbar (Befehlstabelle aus dem Register).
Schreibt nur dieses Gerüst; bestehende Dateien werden nie überschrieben.
Exit-Code: 0 ok · 1 Fehler (z. B. Register nicht lesbar, nichts geschrieben) · 2 Bedienfehler`;

/** Ersetzt {{schluessel}} in einem Durchgang (Werte werden nicht erneut ausgewertet). */
export function fuelle(vorlage, werte) {
  return vorlage.replace(/\{\{(\w+)\}\}/g, (treffer, schluessel) => (Object.hasOwn(werte, schluessel) ? werte[schluessel] : treffer));
}

const einzeilig = (text) => text.replace(/\s+/g, ' ').trim();
const htmlEscape = (text) => text.replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);

function leseVorlage(orte, name) {
  const pfad = join(orte.installWurzel, 'vorlagen', name);
  if (!existsSync(pfad)) throw new Error(`Vorlage fehlt: ${pfad}`);
  return readFileSync(pfad, 'utf8');
}

/** Pfade und Platzhalter für Repo bzw. Projekt. */
function ziele(orte, name, app) {
  const projekt = orte.modus === 'projekt';
  const basis = projekt ? 'automatisierung/' : '';
  const test = projekt ? `automatisierung/${app ? 'apps' : 'werkzeuge'}/${name}.test.mjs` : `tests/${name}.test.mjs`;
  if (app) {
    const html = `${projekt ? 'automatisierung/' : ''}apps/${name}.html`;
    return { haupt: html, test, htmlRelativ: projekt ? `./${name}.html` : `../apps/${name}.html`, lib: null, basis };
  }
  return {
    haupt: `${basis}werkzeuge/${name}.mjs`,
    test,
    htmlRelativ: null,
    lib: projekt ? '../../.hierarchie/werkzeuge/lib' : './lib',
    basis,
  };
}

/** Führt `neues-werkzeug` aus (Argumente ohne Befehlsnamen); liefert den Exit-Code. */
export async function main(argv, io = standardEinAus(), { orte = ermittleOrte() } = {}) {
  try {
    if (argv.some((arg) => ['--hilfe', '--help', '-h'].includes(arg))) { io.aus(HILFE); return 0; }
    const { pos, opt } = zerlege(argv, { mitWert: ['--zweck'], schalter: ['--app'] });
    if (pos.length !== 1) throw new Bedienfehler('Erwartet: neues-werkzeug <name> [--app] [--zweck "…"]');
    const [name] = pos;
    if (!NAME_MUSTER.test(name)) throw new Bedienfehler(`Name "${name}" ungültig (erlaubt: [a-z0-9-]+, nicht mit - beginnend).`);
    if (RESERVIERT.includes(name)) throw new Bedienfehler(`Name "${name}" ist reserviert.`);
    const app = Boolean(opt.app);
    const zweck = opt.zweck ? einzeilig(opt.zweck) : NOCH_ZU_BESCHREIBEN;

    // Alles prüfen, bevor etwas geschrieben wird.
    const ziel = liesRegister(orte.schreib);
    if (ziel.fehler) { io.fehler(`hierarchie neues-werkzeug: ${ziel.fehler} – nichts geschrieben`); return 1; }
    const befunde = pruefeSchema(ziel.daten);
    if (befunde.length) { io.fehler(`hierarchie neues-werkzeug: ${orte.schreib.anzeige} verletzt das Schema (${befunde[0]}) – nichts geschrieben`); return 1; }
    const bekannte = orte.modus === 'projekt' ? [ziel, liesRegister(orte.eigenes)] : [ziel];
    for (const register of bekannte) {
      if (register.fehler) { io.fehler(`hierarchie neues-werkzeug: ${register.fehler} – nichts geschrieben`); return 1; }
      const treffer = (register.daten.werkzeuge ?? []).find((w) => w?.name === name || w?.cli === name);
      if (treffer) throw new Bedienfehler(`Name "${name}" gibt es schon im Register (${register.quelle.anzeige}: ${treffer.name}).`);
    }
    const pfade = ziele(orte, name, app);
    for (const datei of [pfade.haupt, pfade.test]) {
      if (existsSync(join(orte.projektBasis, datei))) throw new Bedienfehler(`${datei} existiert schon (wird nie überschrieben).`);
    }

    const werte = {
      name,
      zweck_kommentar: zweck.replaceAll('*/', '* /'),
      zweck_js: JSON.stringify(zweck),
      zweck_html: htmlEscape(zweck),
      marke: GERUEST_MARKE,
      test_pfad: pfade.test,
      register_pfad: orte.schreib.anzeige,
      lib: pfade.lib ?? '',
      html_datei: pfade.haupt,
      html_relativ: pfade.htmlRelativ ?? '',
    };
    const inhalte = {
      [pfade.haupt]: fuelle(leseVorlage(orte, app ? 'app.html' : 'werkzeug.mjs.vorlage'), werte),
      [pfade.test]: fuelle(leseVorlage(orte, app ? 'app.test.mjs.vorlage' : 'werkzeug.test.mjs.vorlage'), werte),
    };

    const eintrag = {
      name,
      ...(app ? {} : { cli: name }),
      modul: pfade.haupt,
      zweck,
      eingabe: NOCH_ZU_BESCHREIBEN,
      ausgabe: NOCH_ZU_BESCHREIBEN,
      befehl: app ? `Datei ${pfade.haupt} im Browser öffnen` : `node .hierarchie/werkzeuge/hierarchie.mjs ${name}`,
      dateien: [pfade.haupt, pfade.test],
      voraussetzungen: [app ? 'Browser (läuft offline)' : 'Node ≥ 20'],
      tests: [pfade.test],
      teststatus: 'ungetestet',
      grenzen: ['Gerüst: Verhalten noch nicht umgesetzt, Test ist ein todo-Test'],
      modell_noetig: 'nein',
      haeufigkeit: { wert: 'vermutet', belegt: false, quelle: null },
      zeitersparnis: null,
    };

    for (const [datei, text] of Object.entries(inhalte)) {
      const pfad = join(orte.projektBasis, datei);
      mkdirSync(dirname(pfad), { recursive: true });
      writeFileSync(pfad, text);
    }
    ziel.daten.werkzeuge.push(eintrag);
    schreibeRegister(ziel, ziel.daten);

    io.aus([
      `+ ${pfade.haupt}`,
      `+ ${pfade.test}  (Gerüst-Test, todo)`,
      `~ ${orte.schreib.anzeige}  (Eintrag ${name}, teststatus ungetestet, Häufigkeit vermutet)`,
      'Nächste Schritte: Verhalten umsetzen, Tests schreiben, Registereintrag vervollständigen, danach UTS-Vollauf und `register aktualisieren`.',
    ].join('\n'));
    return 0;
  } catch (fehler) {
    if (fehler instanceof Bedienfehler) { io.fehler(`hierarchie neues-werkzeug: ${fehler.message}`); return 2; }
    io.fehler(`hierarchie neues-werkzeug: Fehler: ${fehler?.message ?? fehler}`);
    return 1;
  }
}

if (istStartdatei(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
