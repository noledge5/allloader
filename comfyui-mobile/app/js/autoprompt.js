// Autoprompter sheet: lets a language model (configured on the PC) expand,
// improve or vary the prompt in a text field.

import { clear, h, icon, openSheet, toast } from "./ui.js";

const PREFS_KEY = "comfy-mobile.autoprompt";

const MODES = [
  ["expand", "Ausbauen", "Macht aus einer kurzen Idee einen ausführlichen Prompt."],
  ["improve", "Verbessern", "Behält den Inhalt, formuliert klarer und konkreter."],
  ["variation", "Variation", "Gleiches Motiv, andere Umgebung, Licht oder Bildaufbau."],
];

const STYLES = [
  ["", "Kein Stil"],
  ["photo", "Foto"],
  ["cinematic", "Film"],
  ["anime", "Anime"],
  ["illustration", "Illustration"],
  ["3d", "3D"],
  ["painting", "Gemälde"],
  ["watercolor", "Aquarell"],
  ["pixel", "Pixel"],
];

function loadPrefs() {
  try {
    return { mode: "expand", style: "", ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { mode: "expand", style: "" };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

// text: current field value; negative: field is a negative prompt;
// positive: the workflow's positive prompt (context for negative mode);
// onApply(newText) writes the result into the field.
export async function openAutoprompt(app, { text, negative, positive, onApply }) {
  let settings;
  try {
    settings = await app.api.autopromptSettings();
  } catch (e) {
    toast(e.message, { error: true });
    return;
  }

  if (!settings.configured) {
    const sheet = openSheet({
      title: "Autoprompter",
      content: h(
        "div",
        { class: "pad" },
        h("p", null, "Der Autoprompter ist noch nicht eingerichtet. Wähle im Tab ", h("strong", null, "System"), " Anbieter, API-Key und Modell."),
        h(
          "button",
          {
            class: "btn primary block",
            onclick: () => {
              sheet.close();
              app.navigate("system");
              setTimeout(() => app.views.system.focusAutoprompt(), 300);
            },
          },
          "Jetzt einrichten"
        )
      ),
    });
    return;
  }

  const prefs = loadPrefs();
  let mode = negative ? "negative" : prefs.mode;
  let style = prefs.style;

  const modeHint = h("p", { class: "muted small ap-hint" });
  const modes = negative
    ? null
    : h(
        "div",
        { class: "segmented", role: "radiogroup", "aria-label": "Modus" },
        MODES.map(([key, label]) =>
          h(
            "button",
            {
              class: key === mode ? "on" : "",
              onclick: (e) => {
                mode = key;
                savePrefs({ ...loadPrefs(), mode });
                for (const b of modes.children) b.classList.toggle("on", b === e.currentTarget);
                updateHint();
              },
            },
            label
          )
        )
      );
  const styles = negative
    ? null
    : h(
        "div",
        { class: "chips" },
        STYLES.map(([key, label]) =>
          h(
            "button",
            {
              class: `chip${key === style ? " on" : ""}`,
              onclick: (e) => {
                style = key;
                savePrefs({ ...loadPrefs(), style });
                for (const b of styles.children) b.classList.toggle("on", b === e.currentTarget);
              },
            },
            label
          )
        )
      );
  const updateHint = () => {
    modeHint.textContent = negative
      ? "Erzeugt passend zum Prompt eine Liste mit Dingen, die nicht im Bild sein sollen."
      : MODES.find(([k]) => k === mode)?.[2] ?? "";
  };
  updateHint();

  const wish = h("input", {
    class: "input",
    type: "text",
    placeholder: text.trim() ? "Zusatzwunsch, z.B. bei Nacht, Regen" : "Deine Idee, z.B. Fuchs im Schnee",
    enterkeyhint: "go",
  });
  wish.addEventListener("keydown", (e) => e.key === "Enter" && run());

  const result = h("div", { class: "ap-result" });
  const goBtn = h("button", { class: "btn primary block", onclick: () => run() }, icon("create"), "Erzeugen");

  const source = h(
    "div",
    { class: "ap-source" },
    h("div", { class: "field-label" }, negative ? "Aktueller Negativ-Prompt" : "Aktueller Prompt"),
    h("p", { class: text.trim() ? "" : "muted" }, text.trim() || "Noch leer, schreib unten deine Idee.")
  );

  const sheet = openSheet({
    title: negative ? "Negativ-Prompt erzeugen" : "Autoprompter",
    tall: true,
    content: [
      source,
      modes,
      modeHint,
      styles ? h("div", { class: "field-label ap-label" }, "Stil") : null,
      styles,
      h("div", { class: "field-label ap-label" }, text.trim() ? "Zusatzwunsch (optional)" : "Idee"),
      wish,
      goBtn,
      result,
      h("p", { class: "muted small ap-model" }, `Modell: ${settings.model}`),
    ],
  });

  async function run() {
    goBtn.disabled = true;
    clear(goBtn, h("span", { class: "spinner small" }), "Denkt nach…");
    try {
      const res = await app.api.autoprompt({
        text,
        wish: wish.value,
        mode,
        style,
        positive: negative ? positive : undefined,
      });
      showResult(res.text);
    } catch (e) {
      clear(result, h("p", { class: "notice error" }, e.message));
    } finally {
      goBtn.disabled = false;
      clear(goBtn, icon("create"), "Erzeugen");
    }
  }

  function showResult(value) {
    const ta = h("textarea", { class: "input textarea", rows: 6, value });
    clear(
      result,
      h("div", { class: "field-label ap-label" }, "Vorschlag (du kannst ihn noch ändern)"),
      ta,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", onclick: () => run() }, icon("refresh"), "Nochmal"),
        h(
          "button",
          {
            class: "btn primary grow",
            onclick: () => {
              onApply(ta.value.trim());
              sheet.close();
              toast("Prompt übernommen");
            },
          },
          icon("check"),
          "Übernehmen"
        )
      )
    );
    requestAnimationFrame(() => {
      ta.style.height = `${Math.min(ta.scrollHeight + 2, 320)}px`;
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
}
