import { state, allVisualNotes } from "./store.js";

const ORDER_KEY_PREFIX = "cuaderno-notas:visual-order:v1:";
let queued = false;

function injectStyles() {
  if (document.getElementById("cuadernoEnhancementsV2Styles")) return;
  const style = document.createElement("style");
  style.id = "cuadernoEnhancementsV2Styles";
  style.textContent = `
    .saved-link-card.one-click-link{cursor:pointer}
    .saved-link-card.one-click-link:focus-visible{outline:2px solid currentColor;outline-offset:3px}
    #visualNotesList .visual-note-card{position:relative;transition:transform .16s ease,box-shadow .16s ease,opacity .16s ease}
    #visualNotesList .visual-note-card.is-reordering{opacity:.74;transform:scale(.985);z-index:20;box-shadow:0 14px 34px rgba(0,0,0,.16)}
    #visualNotesList .visual-note-card.drop-before::before,
    #visualNotesList .visual-note-card.drop-after::after{content:"";position:absolute;left:8px;right:8px;height:3px;border-radius:999px;background:currentColor;opacity:.55;z-index:30;pointer-events:none}
    #visualNotesList .visual-note-card.drop-before::before{top:-7px}
    #visualNotesList .visual-note-card.drop-after::after{bottom:-7px}
    .visual-reorder-handle{position:absolute;top:8px;right:48px;z-index:8;width:34px;height:34px;display:grid;place-items:center;padding:0;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:rgba(255,255,255,.94);color:inherit;cursor:grab;font:700 18px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.08);touch-action:none;user-select:none;-webkit-user-select:none}
    .visual-reorder-handle:active{cursor:grabbing}
    .visual-reorder-handle:focus-visible{outline:2px solid currentColor;outline-offset:2px}
    @media(max-width:720px){.visual-reorder-handle{width:36px;height:36px;right:46px}}
  `;
  document.head.appendChild(style);
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function isControl(target) {
  return Boolean(target?.closest?.("a,button,input,textarea,select,label,[contenteditable='true']"));
}

function enhanceLinks() {
  const list = document.getElementById("linksList");
  if (!list) return;

  list.querySelectorAll(".saved-link-card").forEach(card => {
    if (card.dataset.oneClickReady === "1") return;
    const anchor = card.querySelector(".open-saved-link") || card.querySelector("a[href]");
    const href = safeUrl(anchor?.getAttribute("href") || "");
    if (!href) return;

    card.dataset.oneClickReady = "1";
    card.classList.add("one-click-link");
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `Abrir ${card.querySelector("h3")?.textContent?.trim() || "enlace"}`);

    const open = () => window.open(href, "_blank", "noopener,noreferrer");
    card.addEventListener("click", event => {
      if (!isControl(event.target)) open();
    });
    card.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target === card) {
        event.preventDefault();
        open();
      }
    });
  });
}

function orderStorageKey() {
  return `${ORDER_KEY_PREFIX}${state.currentNotebookId || "default"}`;
}

function readOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(orderStorageKey()) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeOrder(ids) {
  try {
    localStorage.setItem(orderStorageKey(), JSON.stringify(ids));
  } catch (error) {
    console.warn("No se pudo guardar el orden de las fotos", error);
  }
}

function mapCardsToNotes(list) {
  const cards = [...list.querySelectorAll(":scope > .visual-note-card")];
  const notes = allVisualNotes();
  cards.forEach((card, index) => {
    if (!card.dataset.noteId && notes[index]) card.dataset.noteId = notes[index].id;
  });
  return cards;
}

function applySavedOrder(list) {
  const cards = mapCardsToNotes(list);
  if (cards.length < 2) return;

  const saved = readOrder();
  if (!saved.length) return;

  const rank = new Map(saved.map((id, index) => [id, index]));
  const desired = cards.slice().sort((a, b) => {
    const aRank = rank.has(a.dataset.noteId) ? rank.get(a.dataset.noteId) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b.dataset.noteId) ? rank.get(b.dataset.noteId) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return cards.indexOf(a) - cards.indexOf(b);
  });

  const alreadyCorrect = desired.every((card, index) => card === cards[index]);
  if (alreadyCorrect) return;

  const fragment = document.createDocumentFragment();
  desired.forEach(card => fragment.appendChild(card));
  list.appendChild(fragment);
}

function saveDomOrder(list) {
  const ids = [...list.querySelectorAll(":scope > .visual-note-card")]
    .map(card => card.dataset.noteId)
    .filter(Boolean);
  if (ids.length) writeOrder(ids);
}

function clearIndicators(list) {
  list.querySelectorAll(".drop-before,.drop-after").forEach(node => node.classList.remove("drop-before", "drop-after"));
}

function addHandle(card, list) {
  if (card.querySelector(":scope > .visual-reorder-handle")) return;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "visual-reorder-handle";
  handle.textContent = "⠿";
  handle.title = "Mover foto";
  handle.setAttribute("aria-label", "Mover esta foto");
  card.appendChild(handle);

  handle.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
  });

  handle.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let touchCancelled = false;

    const begin = () => {
      if (dragging || touchCancelled) return;
      dragging = true;
      card.classList.add("is-reordering");
      try { handle.setPointerCapture(pointerId); } catch {}
    };

    const holdTimer = event.pointerType === "touch" ? setTimeout(begin, 180) : null;
    if (event.pointerType !== "touch") begin();

    const onMove = moveEvent => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!dragging) {
        if (event.pointerType === "touch" && distance > 9) {
          touchCancelled = true;
          clearTimeout(holdTimer);
        }
        return;
      }

      moveEvent.preventDefault();
      clearIndicators(list);
      card.style.pointerEvents = "none";
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".visual-note-card");
      card.style.pointerEvents = "";
      if (!target || target === card || target.parentElement !== list) return;

      const rect = target.getBoundingClientRect();
      const horizontal = Math.abs(moveEvent.clientY - (rect.top + rect.height / 2)) < rect.height / 2;
      const after = horizontal
        ? moveEvent.clientX > rect.left + rect.width / 2
        : moveEvent.clientY > rect.top + rect.height / 2;

      target.classList.add(after ? "drop-after" : "drop-before");
      if (after) target.after(card);
      else target.before(card);

      if (moveEvent.clientY < 80) window.scrollBy(0, -12);
      if (moveEvent.clientY > window.innerHeight - 80) window.scrollBy(0, 12);
    };

    const finish = finishEvent => {
      clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      clearIndicators(list);
      card.classList.remove("is-reordering");
      try { handle.releasePointerCapture(pointerId); } catch {}
      if (!dragging) return;
      finishEvent?.preventDefault?.();
      saveDomOrder(list);
    };

    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, { capture: true, passive: false });
    window.addEventListener("pointercancel", finish, { capture: true, passive: false });
  });
}

function enhanceVisuals() {
  const list = document.getElementById("visualNotesList");
  if (!list) return;
  mapCardsToNotes(list);
  applySavedOrder(list);
  list.querySelectorAll(":scope > .visual-note-card").forEach(card => addHandle(card, list));
}

function queueEnhance() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    enhanceLinks();
    enhanceVisuals();
  });
}

function init() {
  injectStyles();
  queueEnhance();

  const observer = new MutationObserver(mutations => {
    const relevant = mutations.some(mutation => {
      const target = mutation.target;
      return target?.id === "linksList" || target?.id === "visualNotesList" || target?.closest?.("#linksList,#visualNotesList");
    });
    if (relevant) queueEnhance();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) queueEnhance();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
