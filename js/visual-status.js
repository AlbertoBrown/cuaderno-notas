(() => {
  const STORAGE_KEY = "cuaderno-notas:visual-status:v1";

  function readState() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function writeState(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      console.warn("No se pudo guardar el estado de los apuntes visuales", error);
    }
  }

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function cardKey(card) {
    const title = card.querySelector("h3")?.textContent?.trim() || "";
    const meta = card.querySelector(".visual-note-meta > span:first-child")?.textContent?.trim() || "";
    const prompt = card.querySelector(".visual-note-prompt")?.textContent?.trim() || "";
    return `visual-${hash(`${meta}|${title}|${prompt}`)}`;
  }

  function applyButtonState(button, done) {
    button.dataset.done = done ? "true" : "false";
    button.classList.toggle("is-done", done);
    button.classList.toggle("is-pending", !done);
    button.innerHTML = done ? "✓" : "×";
    button.setAttribute("aria-pressed", done ? "true" : "false");
    button.setAttribute("aria-label", done ? "Hecho. Pulsar para marcar como no hecho" : "No hecho. Pulsar para marcar como hecho");
    button.title = done ? "Hecho · pulsar para marcar como no hecho" : "No hecho · pulsar para marcar como hecho";
  }

  function decorateCard(card) {
    if (!(card instanceof HTMLElement) || card.dataset.visualStatusReady === "true") return;

    const thumb = card.querySelector(".visual-thumb-button");
    if (!thumb) return;

    card.dataset.visualStatusReady = "true";
    const key = cardKey(card);
    card.dataset.visualStatusKey = key;

    const states = readState();
    const done = states[key] === true;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "visual-status-toggle";
    applyButtonState(button, done);

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const nextDone = button.dataset.done !== "true";
      const nextStates = readState();
      nextStates[key] = nextDone;
      writeState(nextStates);
      applyButtonState(button, nextDone);
    });

    thumb.appendChild(button);
  }

  function decorateAll() {
    document.querySelectorAll("#visualNotesList .visual-note-card").forEach(decorateCard);
  }

  function injectStyles() {
    if (document.getElementById("visualStatusStyles")) return;
    const style = document.createElement("style");
    style.id = "visualStatusStyles";
    style.textContent = `
      #visualNotesList .visual-thumb-button{position:relative;overflow:visible}
      .visual-status-toggle{
        position:absolute;
        top:8px;
        right:8px;
        z-index:5;
        width:31px;
        height:31px;
        display:grid;
        place-items:center;
        padding:0;
        border:2px solid rgba(255,255,255,.95);
        border-radius:999px;
        color:#fff;
        font:800 20px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        cursor:pointer;
        box-shadow:0 2px 8px rgba(32,28,22,.22);
        transition:transform .16s ease,box-shadow .16s ease,background .16s ease;
      }
      .visual-status-toggle:hover{transform:scale(1.07);box-shadow:0 3px 11px rgba(32,28,22,.28)}
      .visual-status-toggle:focus-visible{outline:3px solid rgba(255,126,72,.35);outline-offset:2px}
      .visual-status-toggle.is-done{background:#1f9d62}
      .visual-status-toggle.is-pending{background:#d94b43}
      @media (max-width:720px){
        .visual-status-toggle{top:7px;right:7px;width:30px;height:30px;font-size:19px}
      }
    `;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    decorateAll();

    const target = document.getElementById("visualNotesList") || document.body;
    const observer = new MutationObserver(() => queueMicrotask(decorateAll));
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

// Mejoras de interacción de Cuaderno: enlaces de un clic y orden manual de fotos.
import("./cuaderno-enhancements-v3.js?v=3").catch(error => {
  console.warn("No se pudieron cargar las mejoras de Cuaderno", error);
});