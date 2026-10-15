// Zusammenführen der Projekt-Einstellungen (.claude/settings.json) mit der Vorlage: ergänzen, nie ersetzen.
import { gleich, istObjekt } from './json.mjs';

export const PLUGIN_SCHLUESSEL = 'hierarchie@hierarchie';

const kopie = (wert) => JSON.parse(JSON.stringify(wert));

function pruefeTyp(bedingung, beschreibung) {
  if (!bedingung) throw new Error(`.claude/settings.json: ${beschreibung}`);
}

/** Hooks aus der Vorlage ergänzen; Duplikat = gleicher `command` im selben Ereignis. Liefert die ergänzten Ereignisse. */
function mischeHooks(ziel, vorlage) {
  const ergaenzt = [];
  for (const [ereignis, gruppen] of Object.entries(vorlage)) {
    pruefeTyp(Array.isArray(gruppen), `Vorlage: hooks.${ereignis} muss eine Liste sein`);
    if (ziel[ereignis] === undefined) ziel[ereignis] = [];
    pruefeTyp(Array.isArray(ziel[ereignis]), `"hooks.${ereignis}" muss eine Liste sein`);
    const gruppenZiel = ziel[ereignis];
    for (const gruppe of gruppen) {
      for (const hook of gruppe.hooks ?? []) {
        const vorhanden = gruppenZiel.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => h?.command === hook.command));
        if (vorhanden) continue;
        const passend = gruppenZiel.find((g) => istObjekt(g) && Array.isArray(g.hooks) && g.matcher === gruppe.matcher);
        if (passend) passend.hooks.push(kopie(hook));
        else gruppenZiel.push({ ...(gruppe.matcher === undefined ? {} : { matcher: gruppe.matcher }), hooks: [kopie(hook)] });
        if (!ergaenzt.includes(ereignis)) ergaenzt.push(ereignis);
      }
    }
  }
  return ergaenzt;
}

/**
 * Führt `vorlage` in `bestehend` ein (ohne die Eingaben zu verändern).
 * Ergebnis: { settings, aenderungen: [Text], hinweise: [Text] }; wirft bei unerwarteter Struktur.
 */
export function mischeSettings(bestehend, vorlage, { modell } = {}) {
  pruefeTyp(istObjekt(bestehend), 'oberste Ebene muss ein Objekt sein');
  const settings = kopie(bestehend);
  const aenderungen = [];
  const hinweise = [];

  if (vorlage.hooks) {
    if (settings.hooks === undefined) settings.hooks = {};
    pruefeTyp(istObjekt(settings.hooks), '"hooks" muss ein Objekt sein');
    for (const ereignis of mischeHooks(settings.hooks, vorlage.hooks)) aenderungen.push(`Hook ${ereignis}`);
  }

  const frageVorlage = vorlage.permissions?.ask;
  if (frageVorlage) {
    if (settings.permissions === undefined) settings.permissions = {};
    pruefeTyp(istObjekt(settings.permissions), '"permissions" muss ein Objekt sein');
    if (settings.permissions.ask === undefined) settings.permissions.ask = [];
    pruefeTyp(Array.isArray(settings.permissions.ask), '"permissions.ask" muss eine Liste sein');
    const neue = frageVorlage.filter((eintrag) => !settings.permissions.ask.includes(eintrag));
    settings.permissions.ask.push(...neue);
    if (neue.length) aenderungen.push(`permissions.ask (+${neue.length})`);
  }

  if (vorlage.enabledPlugins) {
    if (settings.enabledPlugins === undefined) settings.enabledPlugins = {};
    pruefeTyp(istObjekt(settings.enabledPlugins), '"enabledPlugins" muss ein Objekt sein');
    for (const [schluessel, wert] of Object.entries(vorlage.enabledPlugins)) {
      if (settings.enabledPlugins[schluessel] !== wert) {
        settings.enabledPlugins[schluessel] = wert;
        aenderungen.push(`enabledPlugins["${schluessel}"] = ${wert}`);
      }
    }
  }

  if (modell) {
    if (settings.model === undefined) {
      settings.model = modell;
      aenderungen.push(`model = ${modell}`);
    } else if (settings.model !== modell) {
      hinweise.push(`"model" ist bereits "${settings.model}" – --modell ${modell} nicht gesetzt`);
    }
  }

  return { settings, aenderungen, hinweise, geaendert: !gleich(settings, bestehend) };
}
