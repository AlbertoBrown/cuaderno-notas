import { allVisualNotes, putNote } from "./store.js";

const PREFIX = "cuaderno-visual-order:v3:";
let queued = false;

function key() {
  const first = allVisualNotes()[0];
  return PREFIX + (first?.notebookId || "default");
}

function readOrder() {
  try { return JSON.parse(localStorage.getItem(key()) || "[]"); }
  catch { return []; }
}

function writeOrder(ids) {
  try { localStorage.setItem(key(), JSON.stringify(ids)); } catch {}
}

function addStyles() {
  if (document.getElementById("cuadernoDragV3Styles")) return;
  const style = document.createElement("style");
  style.id = "cuadernoDragV3Styles";
  style.textContent = `
    #visualNotesList .visual-note-card{position:relative;transition:transform .14s ease,opacity .14s ease,box-shadow .14s ease}
    #visualNotesList .visual-note-card.is-dragging{opacity:.28}
    #visualNotesList .visual-note-card.drag-over{transform:scale(.985);box-shadow:0 12px 30px rgba(0,0,0,.13)}
    #visualNotesList .visual-drag-handle{position:absolute;top:8px;left:8px;z-index:10;width:34px;height:34px;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:rgba(255,255,255,.95);display:grid;place-items:center;cursor:grab;touch-action:none;user-select:none;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    #visualNotesList .visual-drag-handle:active{cursor:grabbing}
    .visual-drag-ghost{position:fixed;z-index:99999;pointer-events:none;opacity:.9;box-shadow:0 18px 40px rgba(0,0,0,.2);max-width:300px}
    .saved-link-card .saved-link-click-target{color:inherit;text-decoration:none}
    .saved-link-card .saved-link-click-target:hover h3{text-decoration:underline;text-underline-offset:3px}
  `;
  document.head.appendChild(style);
}

function improveLinks() {
  document.querySelectorAll("#linksList .saved-link-card").forEach(card => {
    if (card.dataset.linkV3) return;
    const box = card.querySelector(".saved-link-top > div");
    const source = card.querySelector(".open-saved-link") || card.querySelector("a[href]");
    if (!box || !source?.href) return;
    const a = document.createElement("a");
    a.className = "saved-link-click-target";
    a.href = source.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    while (box.firstChild) a.appendChild(box.firstChild);
    box.appendChild(a);
    card.dataset.linkV3 = "1";
  });
}

function assignIds(list) {
  const notes = allVisualNotes();
  [...list.querySelectorAll(":scope > .visual-note-card")].forEach((card, index) => {
    if (!card.dataset.noteId && notes[index]) card.dataset.noteId = notes[index].id;
  });
}

function applyOrder(list) {
  const order = readOrder();
  if (!order.length) return;
  const rank = new Map(order.map((id, index) => [id, index]));
  const cards = [...list.querySelectorAll(":scope > .visual-note-card")];
  cards.sort((a, b) => (rank.get(a.dataset.noteId) ?? 999999) - (rank.get(b.dataset.noteId) ?? 999999));
  cards.forEach(card => list.appendChild(card));
}

async function persist(list) {
  const ids = [...list.querySelectorAll(":scope > .visual-note-card")].map(card => card.dataset.noteId).filter(Boolean);
  writeOrder(ids);
  const byId = new Map(allVisualNotes().map(note => [note.id, note]));
  for (let index = 0; index < ids.length; index += 1) {
    const note = byId.get(ids[index]);
    if (!note) continue;
    const displayOrder = (index + 1) * 1000;
    if (Number(note.displayOrder) !== displayOrder) await putNote({ ...note, displayOrder });
  }
}

function nearest(list, x, y, dragged) {
  let winner = null;
  let distance = Infinity;
  for (const card of list.querySelectorAll(":scope > .visual-note-card")) {
    if (card === dragged) continue;
    const rect = card.getBoundingClientRect();
    const current = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
    if (current < distance) { distance = current; winner = card; }
  }
  return winner;
}

function place(card, target, x, y) {
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const after = Math.abs(x - (rect.left + rect.width / 2)) > Math.abs(y - (rect.top + rect.height / 2))
    ? x > rect.left + rect.width / 2
    : y > rect.top + rect.height / 2;
  after ? target.after(card) : target.before(card);
}

function addHandle(card, list) {
  if (card.querySelector(":scope > .visual-drag-handle")) return;
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "visual-drag-handle";
  handle.textContent = "⠿";
  handle.title = "Mover foto";
  card.appendChild(handle);

  handle.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    let dragging = false;
    let ghost = null;
    let target = null;
    const startX = event.clientX;
    const startY = event.clientY;

    const begin = source => {
      if (dragging) return;
      dragging = true;
      card.classList.add("is-dragging");
      ghost = card.cloneNode(true);
      ghost.classList.add("visual-drag-ghost");
      ghost.style.width = Math.min(card.getBoundingClientRect().width, 300) + "px";
      document.body.appendChild(ghost);
      moveGhost(source);
    };

    const moveGhost = source => {
      if (!ghost) return;
      ghost.style.left = Math.max(8, Math.min(innerWidth - ghost.offsetWidth - 8, source.clientX + 14)) + "px";
      ghost.style.top = Math.max(8, Math.min(innerHeight - ghost.offsetHeight - 8, source.clientY + 14)) + "px";
    };

    const timer = event.pointerType === "touch" ? setTimeout(() => begin(event), 180) : null;
    if (event.pointerType !== "touch") begin(event);

    const move = ev => {
      const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!dragging) {
        if (event.pointerType === "touch" && moved > 8) cleanup(false);
        return;
      }
      ev.preventDefault();
      moveGhost(ev);
      target?.classList.remove("drag-over");
      target = nearest(list, ev.clientX, ev.clientY, card);
      target?.classList.add("drag-over");
      place(card, target, ev.clientX, ev.clientY);
      if (ev.clientY < 70) scrollBy(0, -14);
      else if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
    };

    const cleanup = async save => {
      clearTimeout(timer);
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", cancel, true);
      ghost?.remove();
      card.classList.remove("is-dragging");
      target?.classList.remove("drag-over");
      if (save && dragging) await persist(list);
    };

    const up = ev => { ev.preventDefault(); cleanup(true); };
    const cancel = () => cleanup(false);
    addEventListener("pointermove", move, { capture: true, passive: false });
    addEventListener("pointerup", up, { capture: true, passive: false });
    addEventListener("pointercancel", cancel, { capture: true, passive: false });
  });
}

function improveVisuals() {
  const list = document.getElementById("visualNotesList");
  if (!list) return;
  assignIds(list);
  applyOrder(list);
  list.querySelectorAll(":scope > .visual-note-card").forEach(card => addHandle(card, list));
}

function run() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    improveLinks();
    improveVisuals();
  });
}

function init() {
  addStyles();
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
