import { state, allVisualNotes, putNote } from "./store.js";
import { supabaseClient } from "./supabase.js";

const ORDER_STEP = 1000;
const hydratedKeys = new Set();
let visualApplyQueued = false;
let cloudPersistTimer = null;

function injectEnhancementStyles() {
  if (document.getElementById("cuadernoEnhancementStyles")) return;
  const style = document.createElement("style");
  style.id = "cuadernoEnhancementStyles";
  style.textContent = `
    .saved-link-card.is-clickable-link {
      cursor: pointer;
    }
    .saved-link-card.is-clickable-link:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 3px;
    }
    .visual-note-card {
      position: relative;
      transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;
    }
    .visual-note-card.is-reordering {
      opacity: .72;
      transform: scale(.985);
      z-index: 20;
      box-shadow: 0 14px 34px rgba(0,0,0,.16);
    }
    .visual-note-card.visual-drop-before::before,
    .visual-note-card.visual-drop-after::after {
      content: "";
      position: absolute;
      left: 8px;
      right: 8px;
      height: 3px;
      border-radius: 999px;
      background: currentColor;
      opacity: .55;
      z-index: 30;
      pointer-events: none;
    }
    .visual-note-card.visual-drop-before::before { top: -7px; }
    .visual-note-card.visual-drop-after::after { bottom: -7px; }
    .visual-reorder-handle {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 8;
      width: 34px;
      height: 34px;
      display: inline-grid;
      place-items: center;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 10px;
      background: rgba(255,255,255,.92);
      color: inherit;
      cursor: grab;
      font-size: 18px;
      line-height: 1;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .visual-reorder-handle:active { cursor: grabbing; }
    .visual-reorder-handle:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    @media (max-width: 720px) {
      .visual-reorder-handle {
        width: 38px;
        height: 38px;
      }
    }
  `;
  document.head.appendChild(style);
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.("a, button, input, textarea, select, label, [contenteditable='true']"));
}

function enhanceSavedLinks() {
  const list = document.getElementById("linksList");
  if (!list) return;

  list.querySelectorAll(".saved-link-card").forEach(card => {
    if (card.dataset.oneClickLink === "1") return;
    const anchor = card.querySelector(".open-saved-link") || card.querySelector("a[href]");
    const href = anchor?.href;
    if (!href) return;

    card.dataset.oneClickLink = "1";
    card.classList.add("is-clickable-link");
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `Abrir ${card.querySelector("h3")?.textContent?.trim() || "enlace"}`);

    const open = () => window.open(href, "_blank", "noopener,noreferrer");
    card.addEventListener("click", event => {
      if (isInteractiveTarget(event.target)) return;
      open();
    });
    card.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (isInteractiveTarget(event.target) && event.target !== card) return;
      event.preventDefault();
      open();
    });
  });
}

function parseVisualPayload(value = "") {
  try {
    const parsed = JSON.parse(value || "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return { prompt: String(value || "") };
}

function visualNotesById() {
  return new Map(allVisualNotes().map(note => [note.id, note]));
}

function numericOrder(note) {
  const value = Number(note?.displayOrder);
  return Number.isFinite(value) ? value : null;
}

async function hydrateOrdersFromCloud(notes) {
  if (!state.user || !navigator.onLine || !notes.length) return;

  const ids = notes.map(note => note.id);
  const key = `${state.currentNotebookId}:${ids.slice().sort().join(",")}`;
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);

  try {
    const { data, error } = await supabaseClient
      .from("cuaderno_notas")
      .select("id, contenido")
      .eq("user_id", state.user.id)
      .in("id", ids);

    if (error) throw error;

    const remoteOrders = new Map();
    for (const row of data || []) {
      const order = Number(parseVisualPayload(row.contenido).displayOrder);
      if (Number.isFinite(order)) remoteOrders.set(row.id, order);
    }

    for (const note of notes) {
      if (!remoteOrders.has(note.id)) continue;
      const remoteOrder = remoteOrders.get(note.id);
      if (numericOrder(note) === remoteOrder) continue;
      await putNote({ ...note, displayOrder: remoteOrder });
    }
  } catch (error) {
    hydratedKeys.delete(key);
    console.warn("No se pudo recuperar el orden de las fotos", error);
  }
}

async function persistCloudOrders(notes) {
  if (!state.user || !navigator.onLine || !notes.length) return;

  try {
    const ids = notes.map(note => note.id);
    const { data, error } = await supabaseClient
      .from("cuaderno_notas")
      .select("id, contenido")
      .eq("user_id", state.user.id)
      .in("id", ids);

    if (error) throw error;

    const remoteById = new Map((data || []).map(row => [row.id, row]));
    for (const note of notes) {
      const order = numericOrder(note);
      if (order === null) continue;
      const row = remoteById.get(note.id);
      if (!row) continue;
      const payload = parseVisualPayload(row.contenido);
      if (Number(payload.displayOrder) === order) continue;

      payload.displayOrder = order;
      const { error: updateError } = await supabaseClient
        .from("cuaderno_notas")
        .update({ contenido: JSON.stringify(payload) })
        .eq("id", note.id)
        .eq("user_id", state.user.id);

      if (updateError) throw updateError;
    }
  } catch (error) {
    console.warn("No se pudo guardar el orden de las fotos en la nube", error);
  }
}

function scheduleCloudPersist(notes) {
  clearTimeout(cloudPersistTimer);
  cloudPersistTimer = setTimeout(() => persistCloudOrders(notes), 700);
}

async function ensureOrders(notes) {
  if (!notes.length) return;
  let maxOrder = notes.reduce((max, note) => Math.max(max, numericOrder(note) ?? 0), 0);
  let changed = false;

  for (const note of notes) {
    if (numericOrder(note) !== null) continue;
    maxOrder += ORDER_STEP;
    await putNote({ ...note, displayOrder: maxOrder });
    changed = true;
  }

  if (changed) scheduleCloudPersist(allVisualNotes());
}

function assignFreshCardIds(list, notes) {
  const cards = [...list.querySelectorAll(":scope > .visual-note-card")];
  if (!cards.length) return cards;

  const needsMapping = cards.some(card => !card.dataset.noteId);
  if (!needsMapping) return cards;

  cards.forEach((card, index) => {
    const note = notes[index];
    if (note) card.dataset.noteId = note.id;
  });
  return cards;
}

function reorderDomFromState(list) {
  const byId = visualNotesById();
  const cards = [...list.querySelectorAll(":scope > .visual-note-card")];
  cards.sort((a, b) => {
    const noteA = byId.get(a.dataset.noteId);
    const noteB = byId.get(b.dataset.noteId);
    const orderA = numericOrder(noteA) ?? Number.MAX_SAFE_INTEGER;
    const orderB = numericOrder(noteB) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(noteB?.createdAt || "").localeCompare(String(noteA?.createdAt || ""));
  });
  cards.forEach(card => list.appendChild(card));
}

async function persistCurrentDomOrder(list) {
  const byId = visualNotesById();
  const cards = [...list.querySelectorAll(":scope > .visual-note-card")];
  const changed = [];

  for (let index = 0; index < cards.length; index += 1) {
    const note = byId.get(cards[index].dataset.noteId);
    if (!note) continue;
    const nextOrder = (index + 1) * ORDER_STEP;
    if (numericOrder(note) === nextOrder) continue;
    const updated = { ...note, displayOrder: nextOrder };
    await putNote(updated);
    changed.push(updated);
  }

  if (changed.length) scheduleCloudPersist(allVisualNotes());
}

function clearDropIndicators(list) {
  list.querySelectorAll(".visual-drop-before, .visual-drop-after").forEach(card => {
    card.classList.remove("visual-drop-before", "visual-drop-after");
  });
}

function attachReorderHandle(card, list) {
  if (card.querySelector(":scope > .visual-reorder-handle")) return;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "visual-reorder-handle";
  handle.innerHTML = "⋮⋮";
  handle.title = "Mover foto";
  handle.setAttribute("aria-label", "Mover esta foto");
  card.appendChild(handle);

  handle.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let cancelled = false;
    let lastTarget = null;
    let lastAfter = false;

    const beginDrag = () => {
      if (cancelled || dragging) return;
      dragging = true;
      card.classList.add("is-reordering");
      try { handle.setPointerCapture(pointerId); } catch {}
    };

    const longPress = event.pointerType === "touch"
      ? setTimeout(beginDrag, 180)
      : null;

    if (event.pointerType !== "touch") beginDrag();

    const onMove = moveEvent => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!dragging) {
        if (event.pointerType === "touch" && distance > 9) {
          cancelled = true;
          clearTimeout(longPress);
        }
        return;
      }

      moveEvent.preventDefault();
      clearDropIndicators(list);

      card.style.pointerEvents = "none";
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".visual-note-card");
      card.style.pointerEvents = "";

      if (!target || target === card || target.parentElement !== list) return;
      const rect = target.getBoundingClientRect();
      const sameRow = moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom;
      const after = sameRow
        ? moveEvent.clientX > rect.left + rect.width / 2
        : moveEvent.clientY > rect.top + rect.height / 2;

      lastTarget = target;
      lastAfter = after;
      target.classList.add(after ? "visual-drop-after" : "visual-drop-before");

      if (after) target.after(card);
      else target.before(card);

      if (moveEvent.clientY < 80) window.scrollBy(0, -12);
      else if (moveEvent.clientY > window.innerHeight - 80) window.scrollBy(0, 12);
    };

    const finish = async finishEvent => {
      clearTimeout(longPress);
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", finish, { capture: true });
      window.removeEventListener("pointercancel", finish, { capture: true });
      clearDropIndicators(list);
      card.classList.remove("is-reordering");
      try { handle.releasePointerCapture(pointerId); } catch {}

      if (!dragging) return;
      finishEvent?.preventDefault?.();
      if (lastTarget) {
        if (lastAfter) lastTarget.after(card);
        else lastTarget.before(card);
      }
      await persistCurrentDomOrder(list);
    };

    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, { capture: true, passive: false });
    window.addEventListener("pointercancel", finish, { capture: true, passive: false });
  });
}

async function enhanceVisualNotes() {
  const list = document.getElementById("visualNotesList");
  if (!list) return;

  const baseNotes = allVisualNotes();
  if (!baseNotes.length) return;

  const cards = assignFreshCardIds(list, baseNotes);
  if (!cards.length) return;

  await hydrateOrdersFromCloud(baseNotes);
  const hydratedNotes = allVisualNotes();
  await ensureOrders(hydratedNotes);
  reorderDomFromState(list);

  list.querySelectorAll(":scope > .visual-note-card").forEach(card => {
    attachReorderHandle(card, list);
  });

  scheduleCloudPersist(allVisualNotes());
}

function queueVisualEnhancement() {
  if (visualApplyQueued) return;
  visualApplyQueued = true;
  requestAnimationFrame(async () => {
    visualApplyQueued = false;
    await enhanceVisualNotes();
  });
}

function startEnhancements() {
  injectEnhancementStyles();
  enhanceSavedLinks();
  queueVisualEnhancement();

  const observer = new MutationObserver(mutations => {
    let linksChanged = false;
    let visualsChanged = false;
    for (const mutation of mutations) {
      const target = mutation.target;
      if (target?.id === "linksList" || target?.closest?.("#linksList")) linksChanged = true;
      if (target?.id === "visualNotesList" || target?.closest?.("#visualNotesList")) visualsChanged = true;
    }
    if (linksChanged) enhanceSavedLinks();
    if (visualsChanged) queueVisualEnhancement();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("online", () => {
    hydratedKeys.clear();
    queueVisualEnhancement();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      hydratedKeys.clear();
      enhanceSavedLinks();
      queueVisualEnhancement();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startEnhancements, { once: true });
} else {
  startEnhancements();
}
