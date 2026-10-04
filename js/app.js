import { supabaseClient } from "./supabase.js";
import {
  state,
  loadCache,
  migrateLegacyLocalStorage,
  ensureDay,
  dayForDate,
  notesForDate,
  allVisualNotes,
  currentNotebook,
  notebooksList,
  putNotebook,
  setCurrentNotebook,
  putDay,
  putNote,
  markDayPending,
  markNotePending,
  nowIso,
} from "./store.js";
import {
  syncNow,
  pushPending,
  pullAndMerge,
  startRealtime,
  stopRealtime,
  retryPendingLater,
} from "./sync.js";
import {
  optimizeImage,
  IMAGE_QUALITY_PRESETS,
  getSignedImageUrl,
  getSignedThumbnailUrl,
  ensureThumbnailForPath,
  filePreviewUrl,
  revokePreviewUrl,
} from "./visual-notes.js";

const el = id => document.getElementById(id);
const blobUrlCache = new Map();
const daySaveTimers = new Map();
const thumbnailQueue = [];
let thumbnailWorkers = 0;
const MAX_THUMBNAIL_WORKERS = 4;

function queueThumbnail(task) {
  return new Promise((resolve, reject) => {
    thumbnailQueue.push({ task, resolve, reject });
    runThumbnailQueue();
  });
}

function runThumbnailQueue() {
  while (thumbnailWorkers < MAX_THUMBNAIL_WORKERS && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    thumbnailWorkers += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        thumbnailWorkers -= 1;
        runThumbnailQueue();
      });
  }
}
let visualDraft = {
  previewUrl: "",
  blob: null,
  fileName: "",
  originalFile: null,
  originalSize: 0,
  optimizedSize: 0,
  qualityPreset: "balanced",
  width: 0,
  height: 0,
  busy: false,
};
let retryPending = () => {};
let editingVisualId = null;
let editingNoteId = null;
let editingDayPromptId = null;
let editorHomeMarker = null;
let calendarMonthKey = state.selectedDate.slice(0, 7);
let calendarDetailExpanded = false;
let selectedNotebookColor = "sand";

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat("es-ES", options).format(date);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function notesInCurrentNotebook() {
  return [...state.notes.values()].filter(note =>
    note.notebookId === state.currentNotebookId && !note.deleted
  );
}

function daysInCurrentNotebook() {
  return [...state.days.values()].filter(day =>
    day.notebookId === state.currentNotebookId
  );
}

function notebookActivity(notebookId) {
  let latest = 0;
  for (const day of state.days.values()) {
    if (day.notebookId !== notebookId) continue;
    latest = Math.max(latest, Date.parse(day.updatedAt || 0) || 0);
  }
  for (const note of state.notes.values()) {
    if (note.notebookId !== notebookId || note.deleted) continue;
    latest = Math.max(latest, Date.parse(note.updatedAt || note.createdAt || 0) || 0);
  }
  return latest;
}

function notebookSlug(name) {
  const base = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "cuaderno";

  if (!state.notebooks.has(base)) return base;
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function renderNotebookChrome() {
  const notebook = currentNotebook();
  const label = el("notebookNameLabel");
  const back = el("notebookBackBtn");
  const search = el("searchInput")?.closest(".search-box");
  const today = el("todayBtn");

  document.body.classList.toggle("notebook-picker-open", state.showingNotebooks);

  if (label) {
    label.textContent = state.showingNotebooks
      ? "Cuaderno"
      : (notebook?.nombre || "Cuaderno");
  }
  if (back) back.hidden = state.showingNotebooks;
  if (search) search.hidden = state.showingNotebooks;
  if (today) today.hidden = state.showingNotebooks;

  if (state.showingNotebooks) {
    el("pageTitle").innerHTML = "Mis cuadernos<span>.</span>";
  }
}

function renderNotebooksView() {
  const view = el("notebooksView");
  const grid = el("notebooksGrid");
  if (!view || !grid) return;

  view.hidden = !state.showingNotebooks;
  if (!state.showingNotebooks) return;

  grid.replaceChildren();

  for (const notebook of notebooksList()) {
    const notes = [...state.notes.values()].filter(note =>
      note.notebookId === notebook.id && !note.deleted
    ).length;
    const days = [...state.days.values()].filter(day =>
      day.notebookId === notebook.id &&
      (
        day.apuntes ||
        day.conclusiones ||
        (day.prompts || []).length ||
        (day.tareas || []).length
      )
    ).length;
    const activity = notebookActivity(notebook.id);
    const activityText = activity
      ? formatDate(new Date(activity), { day: "2-digit", month: "short" })
      : "Sin actividad";

    const card = document.createElement("button");
    card.type = "button";
    card.className = "notebook-card";
    card.dataset.notebookId = notebook.id;
    card.dataset.color = notebook.color || "sand";
    card.innerHTML = `
      <div class="notebook-card-top">
        <span class="notebook-card-icon">${escapeHtml(notebook.icono || "▤")}</span>
        <span class="notebook-card-arrow">↗</span>
      </div>
      <div class="notebook-card-body">
        <h3>${escapeHtml(notebook.nombre)}</h3>
        <p>${notebook.isDefault ? "Cuaderno principal" : "Espacio independiente"}</p>
      </div>
      <div class="notebook-card-meta">
        <span>${notes} nota${notes === 1 ? "" : "s"}</span>
        <span>${days} día${days === 1 ? "" : "s"}</span>
        <span>${activityText}</span>
      </div>
    `;
    card.onclick = () => openNotebook(notebook.id);
    grid.appendChild(card);
  }

  const notice = el("notebookCloudNotice");
  if (notice) {
    notice.hidden = state.notebookSchemaReady !== false;
  }
}

async function openNotebook(id) {
  const changed = await setCurrentNotebook(id);
  if (!changed) return;

  state.showingNotebooks = false;
  state.currentView = "today";
  state.currentFilter = "all";
  state.searchTerm = "";
  state.selectedDate = toKey(new Date());
  ensureDay(state.selectedDate);

  if (el("searchInput")) el("searchInput").value = "";
  setVisualEditUI?.(null);
  renderAll();
}

function openNotebookPicker() {
  state.showingNotebooks = true;
  renderAll();
}

async function createNotebook() {
  const input = el("notebookNameInput");
  const name = input?.value.trim();
  if (!name) {
    input?.focus();
    return;
  }

  const now = nowIso();
  const notebook = {
    id: notebookSlug(name),
    nombre: name,
    icono: selectedNotebookColor === "blue" ? "</>" : "▤",
    color: selectedNotebookColor,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    syncError: null,
  };

  await putNotebook(notebook);
  el("notebookDialog")?.close();
  if (input) input.value = "";
  selectedNotebookColor = "sand";
  document.querySelectorAll(".notebook-color-option").forEach(button => {
    button.classList.toggle("active", button.dataset.notebookColor === "sand");
  });

  renderNotebooksView();
  syncSoon();
  toast("Cuaderno creado", "success");
}

function parseNormalNoteContent(value = "") {
  const raw = String(value || "");
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      ("apuntes" in parsed || "prompt" in parsed)
    ) {
      return {
        apuntes: String(parsed.apuntes || ""),
        prompt: String(parsed.prompt || ""),
      };
    }
  } catch {}
  return { apuntes: raw, prompt: "" };
}

function serializeNormalNoteContent(apuntes = "", prompt = "") {
  return JSON.stringify({
    apuntes: String(apuntes || ""),
    prompt: String(prompt || ""),
  });
}

function dayPromptItems(day) {
  if (!day) return [];
  if (Array.isArray(day.prompts)) {
    return day.prompts
      .map(item => ({
        id: String(item?.id || crypto.randomUUID()),
        text: String(item?.text || "").trim(),
        createdAt: item?.createdAt || day.updatedAt || nowIso(),
      }))
      .filter(item => item.text);
  }

  const legacy = String(day.prompt || "").trim();
  return legacy
    ? [{
        id: `legacy-${day.fecha}`,
        text: legacy,
        createdAt: day.updatedAt || nowIso(),
      }]
    : [];
}

async function saveDayPrompts(prompts) {
  await updateDay({
    prompt: "",
    prompts: prompts.filter(item => String(item?.text || "").trim()),
  });
}

function normalizeLink(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function currentEditingVisual() {
  return editingVisualId ? state.notes.get(editingVisualId) || null : null;
}

function setVisualEditUI(note = null) {
  editingVisualId = note?.id || null;
  const banner = el("visualEditBanner");
  banner.hidden = !note;
  el("visualEditTitle").textContent = note?.titulo || "";
  el("visualSaveBtn").innerHTML = note ? "✓&nbsp; Guardar cambios" : "▱&nbsp; Guardar apunte";
  el("visualCancelEditBtn").hidden = !note;
}

function timeLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function syncLabel(status) {
  if (status === "synced") return "En la nube";
  if (status === "syncing") return "Sincronizando";
  if (status === "error") return "Error";
  return "Pendiente";
}

function syncClass(status) {
  if (status === "synced") return "synced";
  if (status === "syncing") return "syncing";
  if (status === "error") return "error";
  return "pending";
}

function toast(message, tone = "neutral", action) {
  let host = el("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (action?.label && action?.onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.onclick = () => {
      action.onClick();
      node.remove();
    };
    node.appendChild(btn);
  }
  host.appendChild(node);
  setTimeout(() => node.remove(), action ? 9000 : 2600);
}

function setCloudUI() {
  const box = el("cloudStatus");
  if (!box) return;

  if (!state.user) {
    box.dataset.state = "local";
    box.querySelector("strong").textContent = "Inicia sesión";
    box.querySelector("small").textContent = "Sincroniza PC ↔ móvil";
  } else if (!navigator.onLine) {
    box.dataset.state = "error";
    box.querySelector("strong").textContent = "Sin conexión";
    box.querySelector("small").textContent = "Los cambios quedan pendientes";
  } else if (state.syncStatus === "syncing") {
    box.dataset.state = "sync";
    box.querySelector("strong").textContent = "Sincronizando";
    box.querySelector("small").textContent = state.user.email || "";
  } else if (state.syncStatus === "error") {
    box.dataset.state = "error";
    box.querySelector("strong").textContent = "Error de sincronización";
    box.querySelector("small").textContent = state.lastSyncError || "Pulsa actualizar para reintentar";
    box.title = state.lastSyncError || "";
  } else {
    box.dataset.state = "ok";
    box.querySelector("strong").textContent = "En la nube";
    box.querySelector("small").textContent = state.user.email || "Sincronizado";
  }

  const account = el("accountBtn");
  if (account) {
    account.textContent = state.user ? `✓ ${state.user.email || "Cuenta"}` : "Iniciar sesión";
    account.title = state.user ? "Cerrar sesión" : "Iniciar sesión";
  }

  const saveStatus = el("saveStatus");
  if (saveStatus) {
    const day = state.days.get(state.selectedDate);
    saveStatus.textContent = day ? syncLabel(day.syncStatus) : "Guardado";
  }
}

function renderDateHeader() {
  const date = fromKey(state.selectedDate);
  el("selectedDateLabel").textContent = formatDate(date, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  el("selectedDateSub").textContent = formatDate(date, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const exactDatePicker = el("exactDatePicker");
  if (exactDatePicker && exactDatePicker.value !== state.selectedDate) {
    exactDatePicker.value = state.selectedDate;
  }

  const badge = el("visualDateBadge");
  if (badge) {
    badge.textContent = formatDate(date, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const monday = new Date(date);
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);

  const week = el("weekRow");
  week.replaceChildren();

  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = toKey(d);
    const count = [...state.notes.values()].filter(note => note.fecha === key && !note.deleted).length;
    const button = document.createElement("button");
    button.className = `week-day${key === state.selectedDate ? " active" : ""}`;
    button.innerHTML = `
      <span>${formatDate(d, { weekday: "short" }).replace(".", "")}</span>
      <strong>${d.getDate()}</strong>
      <small>${count} nota${count === 1 ? "" : "s"}</small>
    `;
    button.onclick = () => {
      state.selectedDate = key;
      renderAll();
    };
    week.appendChild(button);
  }
}

function renderDailyPrompts() {
  const day = ensureDay(state.selectedDate);
  const prompts = dayPromptItems(day);
  const list = el("dailyPromptsList");
  const count = el("dailyPromptCount");
  count.textContent = String(prompts.length);
  list.replaceChildren();

  if (!prompts.length) {
    list.innerHTML = '<div class="daily-prompts-empty">Todavía no hay prompts guardados para este día.</div>';
  } else {
    prompts.forEach((prompt, index) => {
      const card = document.createElement("article");
      card.className = "daily-prompt-card";
      card.innerHTML = `
        <div class="daily-prompt-number">${index + 1}</div>
        <p>${escapeHtml(prompt.text)}</p>
        <div class="daily-prompt-actions">
          <button class="copy-day-prompt" type="button" title="Copiar">⧉</button>
          <button class="edit-day-prompt" type="button" title="Editar">✎</button>
          <button class="delete-day-prompt" type="button" title="Eliminar">×</button>
        </div>
      `;

      card.querySelector(".copy-day-prompt").onclick = async () => {
        await navigator.clipboard.writeText(prompt.text);
        toast("Prompt copiado", "success");
      };

      card.querySelector(".edit-day-prompt").onclick = () => {
        editingDayPromptId = prompt.id;
        el("promptInput").value = prompt.text;
        el("addDailyPromptBtn").textContent = "Guardar cambios";
        el("promptInput").focus();
      };

      card.querySelector(".delete-day-prompt").onclick = async () => {
        if (!confirm("¿Eliminar este prompt?")) return;
        const next = prompts.filter(item => item.id !== prompt.id);
        if (editingDayPromptId === prompt.id) {
          editingDayPromptId = null;
          el("promptInput").value = "";
          el("addDailyPromptBtn").textContent = "+ Añadir prompt";
        }
        await saveDayPrompts(next);
        renderDailyPrompts();
      };

      list.appendChild(card);
    });
  }
}

function renderDay() {
  const day = ensureDay(state.selectedDate);
  editingDayPromptId = null;
  el("promptInput").value = "";
  el("addDailyPromptBtn").textContent = "+ Añadir prompt";
  renderDailyPrompts();
  el("notesEditor").innerHTML = day.apuntes || "";
  el("conclusionsInput").value = day.conclusiones || "";
  renderTasks();
}

const TYPE_META = {
  incident: { label: "Incidencia", tone: "orange" },
  error: { label: "Error", tone: "blue" },
  note: { label: "Apunte", tone: "green" },
  prompt: { label: "Prompt", tone: "yellow" },
};

function renderNotes() {
  const list = el("notesList");
  let notes = [];

  if (state.searchTerm) {
    notes = [...state.notes.values()].filter(note => {
      if (note.tipo === "visual" || note.deleted) return false;
      const content = parseNormalNoteContent(note.contenido);
      const haystack = `${note.titulo} ${content.apuntes} ${content.prompt} ${note.etiqueta} ${note.fecha}`.toLowerCase();
      return haystack.includes(state.searchTerm);
    });
  } else {
    notes = notesForDate(state.selectedDate).filter(note => note.tipo !== "visual");
  }

  if (state.currentFilter !== "all") {
    notes = notes.filter(note => note.tipo === state.currentFilter);
  }

  notes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  if (!notes.length) {
    list.innerHTML = '<div class="empty-state">No hay notas que coincidan.<br><small>Usa “Nueva nota” para registrar una incidencia, error o apunte.</small></div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const note of notes) {
    const meta = TYPE_META[note.tipo] || TYPE_META.note;
    const card = document.createElement("article");
    card.className = `note-card ${meta.tone}`;
    const content = parseNormalNoteContent(note.contenido);
    card.innerHTML = `
      <div class="meta">
        <span>${meta.label}</span>
        <span class="note-sync ${syncClass(note.syncStatus)}">● ${syncLabel(note.syncStatus)}</span>
      </div>
      <h3>${escapeHtml(note.titulo)}</h3>
      <p class="note-card-apuntes">${escapeHtml(content.apuntes || "Sin apuntes todavía.")}</p>
      ${content.prompt ? `<div class="note-card-prompt"><strong>Prompt</strong><span>${escapeHtml(content.prompt)}</span></div>` : ""}
      <div class="note-card-footer">
        <span class="tag">${escapeHtml(note.etiqueta || note.fecha)}</span>
        <button class="open-note" type="button">Abrir ↗</button>
      </div>
      <button class="delete-note" title="Eliminar">×</button>
    `;
    const openNote = () => openNormalNoteEditor(note);
    card.querySelector(".open-note").onclick = event => {
      event.stopPropagation();
      openNote();
    };
    card.onclick = event => {
      if (event.target.closest("button")) return;
      openNote();
    };

    card.querySelector(".delete-note").onclick = async event => {
      event.stopPropagation();
      if (!confirm("¿Eliminar esta nota?")) return;
      await putNote({
        ...note,
        deleted: true,
        updatedAt: nowIso(),
        syncStatus: "pending",
      });
      renderNotes();
      syncSoon();
    };
    fragment.appendChild(card);
  }

  list.replaceChildren(fragment);
}

function renderTasks() {
  const box = el("tasksList");
  const day = ensureDay(state.selectedDate);
  box.replaceChildren();

  for (const task of day.tareas || []) {
    const row = document.createElement("div");
    row.className = `task${task.done ? " done" : ""}`;
    row.innerHTML = `
      <input type="checkbox" ${task.done ? "checked" : ""}>
      <span>${escapeHtml(task.text)}</span>
      <button type="button">×</button>
    `;
    row.querySelector("input").onchange = async event => {
      const tareas = day.tareas.map(item =>
        item.id === task.id ? { ...item, done: event.target.checked } : item,
      );
      await updateDay({ tareas });
      renderTasks();
    };
    row.querySelector("button").onclick = async () => {
      const tareas = day.tareas.filter(item => item.id !== task.id);
      await updateDay({ tareas });
      renderTasks();
    };
    box.appendChild(row);
  }
}

function storagePathForNote(note) {
  if (note.imagenPath) return note.imagenPath;
  if (!state.user || !note?.id || !note?.fecha) return "";
  // uploadImage siempre ha usado esta ruta; permite recuperar filas antiguas
  // que quedaron sincronizadas antes de guardar imagen_path en la tabla.
  return `${state.user.id}/${note.fecha}/${note.id}.jpg`;
}

async function imageUrlForNote(note) {
  if (note.pendingBlob) {
    if (!blobUrlCache.has(note.id)) {
      blobUrlCache.set(note.id, URL.createObjectURL(note.pendingBlob));
    }
    return blobUrlCache.get(note.id);
  }
  if (note.legacyImageData) return note.legacyImageData;

  const path = storagePathForNote(note);
  if (!path) return "";

  try {
    const url = await getSignedImageUrl(path);

    // Autorrepara el campo imagen_path en notas antiguas cuando comprobamos
    // que el archivo determinista realmente existe en Storage.
    if (url && !note.imagenPath) {
      const repaired = {
        ...note,
        imagenPath: path,
        updatedAt: nowIso(),
        syncStatus: "pending",
        syncError: null,
      };
      await putNote(repaired);
      Object.assign(note, repaired);
      queueMicrotask(() => syncSoon());
    }

    return url;
  } catch (error) {
    console.warn("No se pudo cargar la imagen", path, error);
    return "";
  }
}

async function thumbnailUrlForNote(note) {
  if (note.pendingBlob) return imageUrlForNote(note);
  if (note.legacyImageData) return note.legacyImageData;

  const path = storagePathForNote(note);
  if (!path) return "";

  try {
    const thumbUrl = await getSignedThumbnailUrl(path);
    if (thumbUrl) return thumbUrl;

    // Mostramos el original inmediatamente y reparamos la miniatura en segundo plano.
    ensureThumbnailForPath(path);
    return await imageUrlForNote(note);
  } catch (error) {
    console.warn("Miniatura no disponible; usando original", path, error);
    return await imageUrlForNote(note);
  }
}

function renderVisualNotes() {
  const list = el("visualNotesList");
  const notes = allVisualNotes();
  const count = el("visualLibraryCount");
  if (count) count.textContent = `${notes.length} apunte${notes.length === 1 ? "" : "s"} guardado${notes.length === 1 ? "" : "s"}`;

  if (!notes.length) {
    list.innerHTML = '<div class="empty-state">Todavía no hay apuntes visuales guardados.<br><small>Añade una imagen y su prompt arriba.</small></div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const note of notes) {
    const card = document.createElement("article");
    card.className = "visual-note-card";
    card.innerHTML = `
      <button class="visual-thumb-button" type="button" aria-label="Ver imagen">
        <span class="visual-thumb-skeleton"></span>
        <img class="visual-note-thumb is-pending" loading="eager" decoding="async" fetchpriority="auto" alt="">
      </button>
      <div class="visual-note-body">
        <div class="visual-note-meta">
          <span>${formatDate(fromKey(note.fecha), { day: "2-digit", month: "short" })} · ${timeLabel(note.createdAt)}</span>
          <span class="note-sync ${syncClass(note.syncStatus)}">● ${syncLabel(note.syncStatus)}</span>
        </div>
        <h3>${escapeHtml(note.titulo || "Apunte visual")}</h3>
        <div class="visual-note-prompt">${escapeHtml(note.contenido || "")}</div>
        ${note.syncStatus === "error" && note.syncError
          ? `<div class="visual-sync-error" title="${escapeHtml(note.syncError)}">⚠ ${escapeHtml(note.syncError)}</div>`
          : ""}
        <div class="visual-note-actions">
          <button class="view-visual" type="button">Ver</button>
          <button class="copy-visual" type="button">Copiar</button>
          <button class="edit-visual" type="button">Editar</button>
          ${note.enlace ? '<button class="open-visual-link" type="button">Enlace ↗</button>' : ""}
          ${note.syncStatus === "error" ? '<button class="retry-visual" type="button">Reintentar</button>' : ""}
          <button class="delete-visual" type="button">Eliminar</button>
        </div>
      </div>
    `;

    const img = card.querySelector(".visual-note-thumb");
    const skeleton = card.querySelector(".visual-thumb-skeleton");

    queueThumbnail(() => thumbnailUrlForNote(note)).then(async url => {
      let fallbackTried = false;

      img.onload = () => {
        img.classList.remove("is-pending");
        img.classList.add("is-loaded");
        skeleton.hidden = true;
      };

      img.onerror = async () => {
        if (!fallbackTried) {
          fallbackTried = true;
          const fullUrl = await imageUrlForNote(note);
          if (fullUrl && fullUrl !== img.src) {
            img.src = fullUrl;
            return;
          }
        }
        img.classList.add("is-pending");
        skeleton.hidden = false;
        skeleton.textContent = "No se pudo cargar";
        skeleton.classList.add("visual-thumb-empty");
      };

      if (url) {
        img.src = url;
      } else {
        const fullUrl = await imageUrlForNote(note);
        if (fullUrl) img.src = fullUrl;
        else {
          skeleton.textContent = "Imagen no encontrada";
          skeleton.classList.add("visual-thumb-empty");
        }
      }
    });

    const open = () => openVisualViewer(note);
    card.querySelector(".visual-thumb-button").onclick = open;
    card.querySelector(".view-visual").onclick = open;
    card.querySelector(".copy-visual").onclick = async () => {
      await navigator.clipboard.writeText(note.contenido || "");
      toast("Prompt copiado", "success");
    };
    card.querySelector(".edit-visual").onclick = () => beginVisualEdit(note);
    const linkButton = card.querySelector(".open-visual-link");
    if (linkButton) {
      linkButton.onclick = () => {
        const href = normalizeLink(note.enlace);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      };
    }
    const retryButton = card.querySelector(".retry-visual");
    if (retryButton) retryButton.onclick = async () => {
      await putNote({ ...note, syncStatus: "pending", syncError: null });
      renderVisualNotes();
      syncSoon();
    };
    card.querySelector(".delete-visual").onclick = async () => {
      if (!confirm("¿Eliminar este apunte visual?")) return;
      await putNote({
        ...note,
        deleted: true,
        updatedAt: nowIso(),
        syncStatus: "pending",
      });
      renderVisualNotes();
      syncSoon();
    };
    fragment.appendChild(card);
  }

  list.replaceChildren(fragment);
}

async function beginVisualEdit(note) {
  if (!note) return;

  clearVisualDraft({ keepEditMode: true });
  setVisualEditUI(note);

  el("visualTitleInput").value = note.titulo || "";
  el("visualLinkInput").value = note.enlace || "";
  el("visualPromptInput").value = note.contenido || "";
  el("visualPromptCount").textContent = `${(note.contenido || "").length}/2000`;

  const url = await imageUrlForNote(note);
  if (url) {
    visualDraft.previewUrl = url;
    el("visualImagePreview").src = url;
    el("visualImagePreview").hidden = false;
    el("visualImagePlaceholder").hidden = true;
    el("visualRemoveImageBtn").hidden = true;
    el("visualImageInfo").textContent = "Imagen actual · selecciona otra solo si quieres reemplazarla.";
  }

  el("visualTitleInput").focus();
  el("visualFormCard")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function cancelVisualEdit() {
  setVisualEditUI(null);
  clearVisualDraft();
  toast("Edición cancelada", "neutral");
}

async function openVisualViewer(note) {
  el("visualViewerTitle").textContent = note.titulo || "Apunte visual";
  el("visualViewerPrompt").textContent = note.contenido || "";
  const viewerLinkWrap = el("visualViewerLinkWrap");
  const viewerLink = el("visualViewerLink");
  const href = normalizeLink(note.enlace);
  viewerLinkWrap.hidden = !href;
  if (href) {
    viewerLink.href = href;
    viewerLink.textContent = href.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  } else {
    viewerLink.removeAttribute("href");
  }
  const image = el("visualViewerImage");
  image.removeAttribute("src");
  image.classList.add("is-loading");
  const url = await imageUrlForNote(note);
  if (url) image.src = url;
  image.classList.remove("is-loading");
  const dialog = el("visualViewerDialog");
  if (!dialog.open) dialog.showModal();
}

function stripHtml(value = "") {
  const node = document.createElement("div");
  node.innerHTML = String(value || "");
  return (node.textContent || node.innerText || "").trim();
}

function formatCalendarDropDate(fecha) {
  return formatDate(fromKey(fecha), { day: "numeric", month: "short" });
}

function cleanupCalendarDragUI() {
  document.body.classList.remove("calendar-dragging");
  document.querySelectorAll(".calendar-day-cell.drop-target").forEach(node => node.classList.remove("drop-target"));
  document.querySelectorAll(".calendar-drag-source-active").forEach(node => node.classList.remove("calendar-drag-source-active"));
  document.querySelectorAll(".calendar-drag-ghost").forEach(node => node.remove());
}

function pickCalendarDropDate(payload) {
  const picker = document.createElement("input");
  picker.type = "date";
  picker.value = state.selectedDate;
  picker.className = "calendar-drop-date-picker";
  picker.setAttribute("aria-label", "Elegir fecha destino");
  document.body.appendChild(picker);

  let resolved = false;
  const cleanup = () => {
    if (resolved) return;
    resolved = true;
    picker.remove();
  };

  picker.addEventListener("change", async () => {
    const targetDate = picker.value;
    cleanup();
    if (targetDate) await dropCalendarItem(payload, targetDate);
  }, { once: true });

  picker.addEventListener("blur", () => setTimeout(cleanup, 250), { once: true });

  try {
    picker.focus({ preventScroll: true });
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  } catch {
    picker.click();
  }
}

async function dropCalendarItem(payload, targetDate) {
  if (!payload || !targetDate) return;

  if (payload.kind === "note") {
    const note = state.notes.get(payload.noteId);
    if (!note || note.deleted) return;
    if (note.fecha === targetDate) {
      toast("La nota ya está en esa fecha", "neutral");
      return;
    }

    const sourceDate = note.fecha;
    const moved = {
      ...note,
      fecha: targetDate,
      updatedAt: nowIso(),
      syncStatus: "pending",
      syncError: null,
    };
    await putNote(moved);

    state.selectedDate = targetDate;
    setCalendarMonthFromDate(targetDate);
    calendarDetailExpanded = false;
    renderCalendarView();
    syncSoon();

    toast(`Nota movida al ${formatCalendarDropDate(targetDate)}`, "success", {
      label: "Deshacer",
      onClick: async () => {
        const current = state.notes.get(note.id);
        if (!current || current.deleted) return;
        await putNote({
          ...current,
          fecha: sourceDate,
          updatedAt: nowIso(),
          syncStatus: "pending",
          syncError: null,
        });
        state.selectedDate = sourceDate;
        setCalendarMonthFromDate(sourceDate);
        renderCalendarView();
        syncSoon();
      },
    });
    return;
  }

  if (payload.kind === "prompt") {
    if (!payload.prompt) return;
    if (payload.sourceDate === targetDate) {
      toast("Ese prompt ya pertenece a esa fecha", "neutral");
      return;
    }

    const target = ensureDay(targetDate);
    const targetPrompts = dayPromptItems(target);
    const copied = {
      id: crypto.randomUUID(),
      text: payload.prompt,
      createdAt: nowIso(),
    };

    const next = markDayPending(targetDate, {
      prompt: "",
      prompts: [...targetPrompts, copied],
    });
    await putDay(next);

    state.selectedDate = targetDate;
    setCalendarMonthFromDate(targetDate);
    calendarDetailExpanded = false;
    renderCalendarView();
    scheduleDayPush(targetDate);

    toast(`Prompt añadido al ${formatCalendarDropDate(targetDate)}`, "success", {
      label: "Deshacer",
      onClick: async () => {
        const current = ensureDay(targetDate);
        const restored = markDayPending(targetDate, {
          prompt: "",
          prompts: dayPromptItems(current).filter(item => item.id !== copied.id),
        });
        await putDay(restored);
        renderCalendarView();
        scheduleDayPush(targetDate);
      },
    });
  }
}

function attachCalendarDragHandle(handle, payload, label, sourceNode = null) {
  if (!handle) return;

  handle.onpointerdown = event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    let dragging = false;
    let ghost = null;
    let targetCell = null;

    const setTarget = next => {
      if (targetCell === next) return;
      targetCell?.classList.remove("drop-target");
      targetCell = next;
      targetCell?.classList.add("drop-target");
    };

    const begin = () => {
      if (dragging) return;
      dragging = true;
      document.body.classList.add("calendar-dragging");
      sourceNode?.classList.add("calendar-drag-source-active");

      ghost = document.createElement("div");
      ghost.className = "calendar-drag-ghost";
      ghost.innerHTML = `<span>⠿</span><strong>${escapeHtml(label)}</strong><small>Suelta sobre una fecha</small>`;
      document.body.appendChild(ghost);
    };

    const moveGhost = (x, y) => {
      if (!ghost) return;
      ghost.style.transform = `translate3d(${Math.min(window.innerWidth - 190, Math.max(8, x + 14))}px,${Math.min(window.innerHeight - 74, Math.max(8, y + 14))}px,0)`;
    };

    const onMove = eventMove => {
      const distance = Math.hypot(eventMove.clientX - startX, eventMove.clientY - startY);
      if (!dragging && distance < 7) return;
      begin();
      eventMove.preventDefault();
      moveGhost(eventMove.clientX, eventMove.clientY);

      if (eventMove.clientY < 84) window.scrollBy(0, -18);
      else if (eventMove.clientY > window.innerHeight - 84) window.scrollBy(0, 18);

      const underPointer = document.elementFromPoint(eventMove.clientX, eventMove.clientY);
      setTarget(underPointer?.closest?.(".calendar-day-cell") || null);
    };

    const finish = async eventEnd => {
      window.removeEventListener("pointermove", onMove, { passive: false });
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);

      const targetDate = dragging ? targetCell?.dataset?.date : null;
      cleanupCalendarDragUI();

      try {
        handle.releasePointerCapture?.(pointerId);
      } catch {}

      if (targetDate) {
        await dropCalendarItem(payload, targetDate);
      } else if (dragging) {
        toast("Suelta sobre un día del calendario", "neutral");
      } else {
        pickCalendarDropDate(payload);
      }

      eventEnd?.preventDefault?.();
    };

    try {
      handle.setPointerCapture?.(pointerId);
    } catch {}

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  handle.onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toast("Mantén pulsado y arrastra el elemento hasta otra fecha", "neutral");
    }
  };
}

function calendarDaySummary(fecha) {
  const day = state.days.get(fecha) || { prompt: "", apuntes: "", conclusiones: "", tareas: [] };
  const notes = notesForDate(fecha).filter(note => note.tipo !== "visual");
  const notePrompts = notes.reduce((total, note) => {
    return total + (parseNormalNoteContent(note.contenido).prompt ? 1 : 0);
  }, 0);
  return {
    day,
    notes,
    dayPrompts: dayPromptItems(day),
    prompts: dayPromptItems(day).length + notePrompts,
    pending: (day.tareas || []).filter(task => !task.done),
    incidents: notes.filter(note => note.tipo === "incident" || note.tipo === "error"),
  };
}

function setCalendarMonthFromDate(fecha) {
  calendarMonthKey = fecha.slice(0, 7);
}

function calendarMonthDate() {
  const [y, m] = calendarMonthKey.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function moveCalendarMonth(delta) {
  const current = calendarMonthDate();
  const selected = fromKey(state.selectedDate);
  const day = selected.getDate();
  const next = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, maxDay));
  state.selectedDate = toKey(next);
  setCalendarMonthFromDate(state.selectedDate);
  calendarDetailExpanded = false;
  renderAll();
}

function renderCalendarDetail() {
  const date = fromKey(state.selectedDate);
  const summary = calendarDaySummary(state.selectedDate);

  el("calendarDayWeekday").textContent = formatDate(date, { weekday: "long" });
  el("calendarDayTitle").textContent = formatDate(date, { day: "2-digit", month: "2-digit", year: "numeric" });
  el("calendarDayNotes").textContent = String(summary.notes.length);
  el("calendarDayPrompts").textContent = String(summary.prompts);
  el("calendarDayPending").textContent = String(summary.pending.length);
  el("calendarDayIncidents").textContent = String(summary.incidents.length);
  el("calendarDayConclusion").textContent = summary.day.conclusiones || "Sin conclusiones todavía.";

  const calendarPrompts = el("calendarPromptsList");
  calendarPrompts.replaceChildren();
  el("calendarPromptCount").textContent = summary.dayPrompts.length
    ? `(${summary.dayPrompts.length})`
    : "";

  if (!summary.dayPrompts.length) {
    calendarPrompts.innerHTML = '<div class="calendar-empty-mini">Sin prompts para este día.</div>';
  } else {
    summary.dayPrompts.forEach((prompt, index) => {
      const row = document.createElement("article");
      row.className = "calendar-prompt-item";
      row.innerHTML = `
        <div class="calendar-prompt-index">${index + 1}</div>
        <p>${escapeHtml(prompt.text)}</p>
        <span class="calendar-drag-handle" role="button" tabindex="0" title="Arrastrar o tocar para elegir otra fecha" aria-label="Copiar prompt a otra fecha">⠿</span>
      `;
      attachCalendarDragHandle(
        row.querySelector(".calendar-drag-handle"),
        {
          kind: "prompt",
          sourceDate: state.selectedDate,
          promptId: prompt.id,
          prompt: prompt.text,
        },
        `Prompt ${index + 1}`,
        row,
      );
      calendarPrompts.appendChild(row);
    });
  }

  const tasks = el("calendarTasksList");
  tasks.replaceChildren();
  el("calendarTasksCount").textContent = summary.pending.length ? `(${summary.pending.length})` : "";
  if (!summary.pending.length) {
    tasks.innerHTML = '<div class="calendar-empty-mini">No hay pendientes abiertos.</div>';
  } else {
    summary.pending.slice(0, 5).forEach(task => {
      const row = document.createElement("div");
      row.className = "calendar-task-row";
      row.innerHTML = `<span class="calendar-task-check"></span><span>${escapeHtml(task.text)}</span>`;
      tasks.appendChild(row);
    });
  }

  const preview = el("calendarNotesPreview");
  preview.replaceChildren();
  el("calendarNotesCount").textContent = summary.notes.length ? `(${summary.notes.length})` : "";
  if (!summary.notes.length) {
    preview.innerHTML = '<div class="calendar-empty-mini">No hay notas registradas.</div>';
  } else {
    summary.notes.slice(0, 3).forEach(note => {
      const meta = TYPE_META[note.tipo] || TYPE_META.note;
      const content = parseNormalNoteContent(note.contenido);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `calendar-note-mini ${meta.tone}`;
      card.innerHTML = `
        <span class="calendar-note-type">${escapeHtml(meta.label)}</span>
        <strong>${escapeHtml(note.titulo || "Sin título")}</strong>
        <small>${escapeHtml(content.apuntes || content.prompt || "Sin detalle.")}</small>
        <span class="calendar-note-drag" role="button" tabindex="0" title="Arrastrar o tocar para elegir fecha" aria-label="Mover nota a otra fecha">⠿</span>
        <span class="calendar-note-arrow">→</span>
      `;
      const dragHandle = card.querySelector(".calendar-note-drag");
      attachCalendarDragHandle(
        dragHandle,
        { kind: "note", noteId: note.id },
        note.titulo || "Nota",
        card,
      );
      card.onclick = event => {
        if (event.target.closest(".calendar-note-drag")) return;
        openNormalNoteEditor(note);
      };
      preview.appendChild(card);
    });
  }

  el("calendarMoreDetail").hidden = !calendarDetailExpanded;
  el("calendarExpandBtn").textContent = calendarDetailExpanded ? "Ver menos ↑" : "Ver un poco más ↓";
  el("calendarDayApuntes").textContent = stripHtml(summary.day.apuntes || "") || "Sin apuntes.";
}

function renderCalendarView() {
  const monthDate = calendarMonthDate();
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const label = formatDate(monthDate, { month: "long", year: "numeric" });
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);

  el("calendarPageTitle").innerHTML = `${pretty}<span>.</span>`;
  el("calendarMonthLabel").textContent = pretty;

  const monthNotes = [...state.notes.values()].filter(note =>
    !note.deleted && note.tipo !== "visual" && String(note.fecha || "").startsWith(monthPrefix)
  );

  let monthPrompts = 0;
  let monthPending = 0;
  for (const [fecha, day] of state.days.entries()) {
    if (!fecha.startsWith(monthPrefix)) continue;
    monthPrompts += dayPromptItems(day).length;
    monthPending += (day.tareas || []).filter(task => !task.done).length;
  }
  for (const note of monthNotes) {
    if (parseNormalNoteContent(note.contenido).prompt) monthPrompts += 1;
  }

  el("calendarMonthNotes").textContent = String(monthNotes.length);
  el("calendarMonthPrompts").textContent = String(monthPrompts);
  el("calendarMonthPending").textContent = String(monthPending);

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const grid = el("calendarGrid");
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toKey(date);
    const summary = calendarDaySummary(key);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day-cell";
    cell.dataset.date = key;
    if (date.getMonth() !== month) cell.classList.add("outside");
    if (key === state.selectedDate) cell.classList.add("selected");
    if (key === toKey(new Date())) cell.classList.add("today");

    const events = [];
    if (summary.notes.length) events.push(`<span><i class="dot note"></i><b>${summary.notes.length}</b><em>nota${summary.notes.length === 1 ? "" : "s"}</em></span>`);
    if (summary.prompts) events.push(`<span><i class="dot prompt"></i><b>${summary.prompts}</b><em>prompt${summary.prompts === 1 ? "" : "s"}</em></span>`);
    if (summary.pending.length) events.push(`<span><i class="dot pending"></i><b>${summary.pending.length}</b><em>pendiente${summary.pending.length === 1 ? "" : "s"}</em></span>`);
    if (summary.incidents.length) events.push(`<span><i class="dot incident"></i><b>${summary.incidents.length}</b><em>incidencia${summary.incidents.length === 1 ? "" : "s"}</em></span>`);

    cell.innerHTML = `<strong class="calendar-day-number">${date.getDate()}</strong><div class="calendar-day-events">${events.join("")}</div>`;
    cell.onclick = () => {
      state.selectedDate = key;
      if (date.getMonth() !== month) setCalendarMonthFromDate(key);
      calendarDetailExpanded = false;
      renderCalendarView();
    };
    fragment.appendChild(cell);
  }

  grid.replaceChildren(fragment);
  renderCalendarDetail();
}

function showView(view) {
  state.currentView = view;
  const visual = view === "visual";
  const calendar = view === "calendar";
  el("mainNotebookView").hidden = visual || calendar;
  el("visualNotesView").hidden = !visual;
  el("calendarView").hidden = !calendar;
  el("dateStrip").hidden = calendar;
  el("pageTitle").innerHTML = visual
    ? "Apuntes visuales<span>.</span>"
    : calendar
      ? "Calendario<span>.</span>"
      : "Mis notas<span>.</span>";
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function renderAll() {
  if (state.currentView === "calendar") {
    renderCalendarView();
  } else {
    renderDateHeader();
    if (state.currentView === "visual") renderVisualNotes();
    else {
      renderDay();
      renderNotes();
    }
  }
  setCloudUI();
}

async function updateDay(patch) {
  const next = markDayPending(state.selectedDate, patch);
  await putDay(next);
  setCloudUI();
  scheduleDayPush(state.selectedDate);
}

function scheduleDayPush(fecha) {
  clearTimeout(daySaveTimers.get(fecha));
  daySaveTimers.set(
    fecha,
    setTimeout(() => {
      daySaveTimers.delete(fecha);
      syncSoon();
    }, 550),
  );
}

function syncSoon() {
  setCloudUI();
  queueMicrotask(async () => {
    if (!state.user || !navigator.onLine) return;
    state.syncStatus = "syncing";
    setCloudUI();
    try {
      await pushPending();
      state.syncStatus = "synced";
    } catch (error) {
      console.error(error);
      state.syncStatus = "error";
      state.lastSyncError = String(error?.message || error || "Error desconocido");
      toast(state.lastSyncError, "error", {
        label: "Reintentar",
        onClick: () => el("refreshBtn").click(),
      });
    }
    setCloudUI();
    if (state.currentView === "visual") renderVisualNotes();
    else if (state.currentView === "calendar") renderCalendarView();
    else renderNotes();
  });
}

function clearVisualDraft({ keepEditMode = false } = {}) {
  revokePreviewUrl(visualDraft.previewUrl);
  visualDraft = {
    previewUrl: "",
    blob: null,
    fileName: "",
    originalFile: null,
    originalSize: 0,
    optimizedSize: 0,
    qualityPreset: el("visualQualitySelect")?.value || "balanced",
    width: 0,
    height: 0,
    busy: false,
  };
  el("visualImagePreview").hidden = true;
  el("visualImagePreview").removeAttribute("src");
  el("visualImagePlaceholder").hidden = false;
  el("visualRemoveImageBtn").hidden = true;
  el("visualImageInfo").textContent = "";
  el("visualTitleInput").value = "";
  el("visualLinkInput").value = "";
  el("visualPromptInput").value = "";
  el("visualPromptCount").textContent = "0/2000";
  el("visualImageInput").value = "";
  el("visualCameraInput").value = "";
  if (!keepEditMode) setVisualEditUI(null);
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function qualityPreset() {
  const key = el("visualQualitySelect")?.value || "balanced";
  return { key, ...(IMAGE_QUALITY_PRESETS[key] || IMAGE_QUALITY_PRESETS.balanced) };
}

async function recompressVisualDraft() {
  const file = visualDraft.originalFile;
  if (!file) return;

  const preset = qualityPreset();
  visualDraft.busy = true;
  visualDraft.qualityPreset = preset.key;
  el("visualImageInfo").textContent = `Comprimiendo · ${preset.label}…`;

  try {
    const optimized = await optimizeImage(file, {
      maxSide: preset.maxSide,
      quality: preset.quality,
    });
    visualDraft.blob = optimized.blob;
    visualDraft.width = optimized.width;
    visualDraft.height = optimized.height;
    visualDraft.optimizedSize = optimized.blob.size;
    visualDraft.busy = false;

    const saving = visualDraft.originalSize
      ? Math.max(0, Math.round((1 - optimized.blob.size / visualDraft.originalSize) * 100))
      : 0;

    el("visualImageInfo").textContent =
      `Original ${formatBytes(visualDraft.originalSize)} → ${formatBytes(optimized.blob.size)} · ${optimized.width}×${optimized.height}${saving ? ` · −${saving}%` : ""}`;
  } catch (error) {
    visualDraft.busy = false;
    visualDraft.blob = file;
    visualDraft.optimizedSize = file.size || 0;
    el("visualImageInfo").textContent = "No se pudo comprimir; se usará la imagen original.";
    console.warn(error);
  }
}

async function handleImageSelection(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith("image/")) {
    toast("Selecciona una foto o imagen", "error");
    return;
  }

  revokePreviewUrl(visualDraft.previewUrl);
  const previewUrl = await filePreviewUrl(file);
  visualDraft = {
    previewUrl,
    blob: null,
    fileName: file.name || "imagen.jpg",
    originalFile: file,
    originalSize: file.size || 0,
    optimizedSize: 0,
    qualityPreset: qualityPreset().key,
    width: 0,
    height: 0,
    busy: true,
  };

  el("visualImagePreview").src = previewUrl;
  el("visualImagePreview").hidden = false;
  el("visualImagePlaceholder").hidden = true;
  el("visualRemoveImageBtn").hidden = false;
  el("visualImageInfo").textContent = "Preparando imagen…";
  await recompressVisualDraft();
}

async function saveVisualNote() {
  const title = el("visualTitleInput").value.trim() || "Apunte visual";
  const prompt = el("visualPromptInput").value.trim();
  const rawLink = el("visualLinkInput").value.trim();
  const enlace = normalizeLink(rawLink);
  const button = el("visualSaveBtn");
  const editing = currentEditingVisual();

  if (rawLink && !enlace) {
    el("visualLinkInput").focus();
    toast("El enlace no es válido", "error");
    return;
  }

  const hasExistingImage = Boolean(
    editing?.imagenPath ||
    editing?.legacyImageData ||
    editing?.pendingBlob
  );
  const hasNewImage = Boolean(visualDraft.blob);

  if (!hasNewImage && !hasExistingImage) {
    toast("Añade una imagen", "error");
    return;
  }
  if (!prompt) {
    el("visualPromptInput").focus();
    toast("Escribe el prompt", "error");
    return;
  }
  if (visualDraft.busy) {
    toast("Espera a que termine de preparar la imagen", "neutral");
    return;
  }

  const old = button.innerHTML;
  button.disabled = true;
  button.innerHTML = editing ? "Guardando cambios…" : "Guardando…";

  try {
    const now = nowIso();
    let note;

    if (editing) {
      const previousPath = hasNewImage
        ? (editing.imagenPath || storagePathForNote(editing) || null)
        : (editing.previousImagenPath || null);

      note = markNotePending(
        {
          ...editing,
          id: editing.id,
          fecha: editing.fecha,
          tipo: "visual",
          titulo: title,
          etiqueta: `Imagen + prompt · ${qualityPreset().label}`,
          contenido: prompt,
          enlace,
          imagenPath: hasNewImage ? null : editing.imagenPath,
          imagenNombre: hasNewImage
            ? (visualDraft.fileName || editing.imagenNombre || `${editing.id}.jpg`)
            : editing.imagenNombre,
          pendingBlob: hasNewImage ? visualDraft.blob : editing.pendingBlob || null,
          legacyImageData: hasNewImage ? null : editing.legacyImageData || null,
          previousImagenPath: previousPath,
          createdAt: editing.createdAt,
          updatedAt: now,
          syncStatus: "pending",
          syncError: null,
          deleted: false,
        },
        {},
      );
    } else {
      note = markNotePending(
        {
          id: crypto.randomUUID(),
          fecha: state.selectedDate,
          tipo: "visual",
          titulo: title,
          etiqueta: `Imagen + prompt · ${qualityPreset().label}`,
          contenido: prompt,
          enlace,
          imagenPath: null,
          imagenNombre: visualDraft.fileName,
          pendingBlob: visualDraft.blob,
          legacyImageData: null,
          previousImagenPath: null,
          createdAt: now,
          updatedAt: now,
          syncStatus: "pending",
          deleted: false,
        },
        {},
      );
    }

    await putNote(note);
    renderVisualNotes();
    const wasEditing = Boolean(editing);
    setVisualEditUI(null);
    clearVisualDraft();

    if (state.user && navigator.onLine) {
      button.innerHTML = wasEditing ? "Sincronizando cambios…" : "Sincronizando…";
      try {
        state.syncStatus = "syncing";
        setCloudUI();
        await pushPending();
        state.syncStatus = "synced";
        renderVisualNotes();
        setCloudUI();
        toast(wasEditing ? "✓ Cambios guardados en la nube" : "✓ Guardado en la nube", "success");
      } catch (syncError) {
        console.error(syncError);
        state.syncStatus = "error";
        state.lastSyncError = String(syncError?.message || syncError || "Error desconocido");
        renderVisualNotes();
        setCloudUI();
        toast(wasEditing ? "Cambios guardados localmente · pendientes de sincronizar" : "Guardado local · pendiente de sincronizar", "neutral", {
          label: "Reintentar",
          onClick: () => el("refreshBtn").click(),
        });
      }
    } else {
      toast(wasEditing ? "Cambios guardados localmente · pendientes de sincronizar" : "Guardado local · pendiente de sincronizar", "neutral");
    }
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar · Reintentar", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = editingVisualId ? "✓&nbsp; Guardar cambios" : "▱&nbsp; Guardar apunte";
  }
}

function resetNormalNoteDialog() {
  editingNoteId = null;
  el("noteForm").reset();
  el("noteDialogEyebrow").textContent = "Nuevo registro";
  el("noteDialogTitle").textContent = "Añadir nota";
  el("saveNoteBtn").textContent = "Guardar nota";
  el("copyNotePromptBtn").disabled = false;
}

function openNormalNoteEditor(note) {
  if (!note) return;
  const content = parseNormalNoteContent(note.contenido);
  editingNoteId = note.id;
  el("noteDialogEyebrow").textContent = "Detalle de la nota";
  el("noteDialogTitle").textContent = note.titulo || "Editar nota";
  el("saveNoteBtn").textContent = "Guardar cambios";
  el("noteTitle").value = note.titulo || "";
  el("noteType").value = note.tipo || "note";
  el("noteTag").value = note.etiqueta || "";
  el("noteBody").value = content.apuntes || "";
  el("notePrompt").value = content.prompt || "";
  if (!el("noteDialog").open) el("noteDialog").showModal();
}

async function addNormalNote() {
  const title = el("noteTitle").value.trim();
  if (!title) {
    el("noteTitle").focus();
    return;
  }

  const now = nowIso();
  const apuntes = el("noteBody").value.trim();
  const prompt = el("notePrompt").value.trim();
  const existing = editingNoteId ? state.notes.get(editingNoteId) : null;

  const note = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    fecha: existing?.fecha || state.selectedDate,
    tipo: el("noteType").value,
    titulo: title,
    etiqueta: el("noteTag").value.trim(),
    contenido: serializeNormalNoteContent(apuntes, prompt),
    imagenPath: null,
    imagenNombre: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    syncStatus: "pending",
    syncError: null,
    deleted: false,
  };

  await putNote(note);
  const wasEditing = Boolean(existing);
  el("noteDialog").close();
  resetNormalNoteDialog();
  renderNotes();
  renderDateHeader();
  syncSoon();
  toast(wasEditing ? "Cambios guardados" : "Nota guardada", "success");
}

function bindEvents() {
  el("prevDay").onclick = () => {
    const date = fromKey(state.selectedDate);
    date.setDate(date.getDate() - 1);
    state.selectedDate = toKey(date);
    renderAll();
  };
  el("nextDay").onclick = () => {
    const date = fromKey(state.selectedDate);
    date.setDate(date.getDate() + 1);
    state.selectedDate = toKey(date);
    renderAll();
  };
  el("todayBtn").onclick = () => {
    state.selectedDate = toKey(new Date());
    if (state.currentView === "calendar") setCalendarMonthFromDate(state.selectedDate);
    renderAll();
  };

  const exactDatePicker = el("exactDatePicker");
  const calendarBtn = el("calendarBtn");

  const applyExactDate = () => {
    const value = exactDatePicker.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    state.selectedDate = value;
    if (state.currentView === "calendar") setCalendarMonthFromDate(value);
    renderAll();
  };

  exactDatePicker.addEventListener("change", applyExactDate);
  exactDatePicker.addEventListener("input", applyExactDate);

  calendarBtn.onclick = () => {
    exactDatePicker.value = state.selectedDate;
    try {
      if (typeof exactDatePicker.showPicker === "function") {
        exactDatePicker.showPicker();
      } else {
        exactDatePicker.focus({ preventScroll: true });
        exactDatePicker.click();
      }
    } catch (error) {
      console.warn("No se pudo abrir el selector nativo de fecha", error);
      exactDatePicker.focus();
      exactDatePicker.click();
    }
  };

  el("calendarPrevMonth").onclick = () => moveCalendarMonth(-1);
  el("calendarNextMonth").onclick = () => moveCalendarMonth(1);
  el("calendarTodayBtn").onclick = () => {
    state.selectedDate = toKey(new Date());
    setCalendarMonthFromDate(state.selectedDate);
    calendarDetailExpanded = false;
    renderAll();
  };
  el("calendarOpenDayBtn").onclick = () => {
    showView("today");
    renderAll();
  };
  el("calendarExpandBtn").onclick = () => {
    calendarDetailExpanded = !calendarDetailExpanded;
    renderCalendarDetail();
  };

  el("refreshBtn").onclick = async () => {
    const btn = el("refreshBtn");
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "↻ <span>Actualizando…</span>";
    state.syncStatus = "syncing";
    setCloudUI();

    try {
      await syncNow();
      state.syncStatus = "synced";
      renderAll();
      toast("Todo sincronizado", "success");
    } catch (error) {
      console.error(error);
      state.syncStatus = "error";
      state.lastSyncError = String(error?.message || error || "Error desconocido");
      setCloudUI();
      toast(state.lastSyncError, "error", {
        label: "Reintentar",
        onClick: () => el("refreshBtn").click(),
      });
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  };

  el("newNoteBtn").onclick = () => {
    resetNormalNoteDialog();
    el("noteDialog").showModal();
  };
  el("saveNoteBtn").onclick = event => {
    event.preventDefault();
    addNormalNote();
  };
  el("copyNotePromptBtn").onclick = async () => {
    const prompt = el("notePrompt").value.trim();
    if (!prompt) {
      toast("No hay prompt para copiar", "neutral");
      return;
    }
    await navigator.clipboard.writeText(prompt);
    toast("Prompt copiado", "success");
  };
  el("noteDialog").addEventListener("close", () => {
    editingNoteId = null;
  });

  el("addDailyPromptBtn").onclick = async () => {
    const input = el("promptInput");
    const text = input.value.trim();
    if (!text) {
      input.focus();
      toast("Escribe un prompt", "neutral");
      return;
    }

    const day = ensureDay(state.selectedDate);
    const prompts = dayPromptItems(day);
    let next;

    if (editingDayPromptId) {
      next = prompts.map(item =>
        item.id === editingDayPromptId
          ? { ...item, text, updatedAt: nowIso() }
          : item,
      );
      editingDayPromptId = null;
      toast("Prompt actualizado", "success");
    } else {
      next = [
        ...prompts,
        { id: crypto.randomUUID(), text, createdAt: nowIso() },
      ];
      toast("Prompt añadido", "success");
    }

    input.value = "";
    el("addDailyPromptBtn").textContent = "+ Añadir prompt";
    await saveDayPrompts(next);
    renderDailyPrompts();
  };

  el("notesEditor").addEventListener("input", event => updateDay({ apuntes: event.target.innerHTML }));
  el("conclusionsInput").addEventListener("input", event => updateDay({ conclusiones: event.target.value }));

  document.querySelectorAll("[data-command]").forEach(button => {
    button.onclick = () => {
      document.execCommand(button.dataset.command, false, null);
      el("notesEditor").focus();
      updateDay({ apuntes: el("notesEditor").innerHTML });
    };
  });

  el("clearEditorBtn").onclick = () => {
    if (!confirm("¿Limpiar los apuntes de este día?")) return;
    el("notesEditor").innerHTML = "";
    updateDay({ apuntes: "" });
  };

  document.querySelectorAll(".mini-chip").forEach(button => {
    button.onclick = () => {
      const current = el("promptInput").value.trim();
      const next = current ? `${current}\n\n${button.dataset.prompt}` : button.dataset.prompt;
      el("promptInput").value = next;
      el("promptInput").focus();
    };
  });

  el("copyPromptBtn").onclick = async () => {
    const prompts = dayPromptItems(ensureDay(state.selectedDate));
    const text = prompts.length
      ? prompts.map((item, index) => `${index + 1}. ${item.text}`).join("\n\n")
      : el("promptInput").value.trim();

    if (!text) {
      toast("No hay prompts para copiar", "neutral");
      return;
    }

    await navigator.clipboard.writeText(text);
    toast(prompts.length > 1 ? "Prompts copiados" : "Prompt copiado", "success");
  };

  document.querySelectorAll(".filter-chip").forEach(button => {
    button.onclick = () => {
      state.currentFilter = button.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach(item => {
        item.classList.toggle("active", item === button);
      });
      renderNotes();
    };
  });

  el("searchInput").addEventListener("input", event => {
    state.searchTerm = event.target.value.trim().toLowerCase();
    renderNotes();
  });

  el("addTaskBtn").onclick = async () => {
    const input = el("taskInput");
    const text = input.value.trim();
    if (!text) return;
    const day = ensureDay(state.selectedDate);
    const tareas = [...(day.tareas || []), { id: crypto.randomUUID(), text, done: false }];
    input.value = "";
    await updateDay({ tareas });
    renderTasks();
  };

  el("taskInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      el("addTaskBtn").click();
    }
  });

  const openVisualPicker = input => {
    if (!input) return;
    input.value = "";
    input.click();
  };
  const onVisualFileChange = async event => {
    const input = event.target;
    const file = input.files?.[0];
    if (file) await handleImageSelection(file);
    input.value = "";
  };

  el("visualImageInput").addEventListener("change", onVisualFileChange);
  el("visualCameraInput").addEventListener("change", onVisualFileChange);
  el("visualGalleryBtn").onclick = () => openVisualPicker(el("visualImageInput"));
  el("visualCameraBtn").onclick = () => openVisualPicker(el("visualCameraInput"));
  el("visualReplaceImageBtn").onclick = () => openVisualPicker(el("visualImageInput"));
  el("visualRetakeImageBtn").onclick = () => openVisualPicker(el("visualCameraInput"));
  el("visualQualitySelect").addEventListener("change", async event => {
    const preset = IMAGE_QUALITY_PRESETS[event.target.value] || IMAGE_QUALITY_PRESETS.balanced;
    el("visualQualityHint").textContent = preset.description;
    if (visualDraft.originalFile) await recompressVisualDraft();
  });
  el("visualRemoveImageBtn").onclick = async () => {
    const editing = currentEditingVisual();
    if (editing) {
      revokePreviewUrl(visualDraft.previewUrl);
      visualDraft = {
        previewUrl: "",
        blob: null,
        fileName: "",
        originalFile: null,
        originalSize: 0,
        optimizedSize: 0,
        qualityPreset: el("visualQualitySelect")?.value || "balanced",
        width: 0,
        height: 0,
        busy: false,
      };
      const url = await imageUrlForNote(editing);
      if (url) {
        visualDraft.previewUrl = url;
        el("visualImagePreview").src = url;
        el("visualImagePreview").hidden = false;
        el("visualImagePlaceholder").hidden = true;
        el("visualRemoveImageBtn").hidden = true;
        el("visualImageInfo").textContent = "Se mantiene la imagen actual.";
      }
      return;
    }
    clearVisualDraft();
  };
  el("visualPromptInput").addEventListener("input", event => {
    el("visualPromptCount").textContent = `${event.target.value.length}/2000`;
  });
  el("visualCopyDraftBtn").onclick = async () => {
    await navigator.clipboard.writeText(el("visualPromptInput").value || "");
    toast("Prompt copiado", "success");
  };
  el("visualSaveBtn").onclick = saveVisualNote;
  el("visualCancelEditBtn").onclick = cancelVisualEdit;
  el("visualViewerClose").onclick = () => el("visualViewerDialog").close();

  const editorSection = el("editorSection");
  const editorDialog = el("editorFullscreenDialog");
  const editorMount = el("editorFullscreenMount");

  const restoreEditorSection = () => {
    if (!editorHomeMarker?.parentNode || !editorSection.classList.contains("editor-section-expanded")) return;
    editorHomeMarker.parentNode.insertBefore(editorSection, editorHomeMarker.nextSibling);
    editorSection.classList.remove("editor-section-expanded");
    el("expandEditorBtn").textContent = "⤢ Ampliar";
  };

  const closeExpandedEditor = () => {
    restoreEditorSection();
    if (editorDialog.open) editorDialog.close();
  };

  el("expandEditorBtn").onclick = () => {
    if (editorSection.classList.contains("editor-section-expanded")) {
      closeExpandedEditor();
      return;
    }
    if (!editorHomeMarker) {
      editorHomeMarker = document.createComment("editor-section-home");
      editorSection.parentNode.insertBefore(editorHomeMarker, editorSection);
    }
    editorMount.appendChild(editorSection);
    editorSection.classList.add("editor-section-expanded");
    el("expandEditorBtn").textContent = "↙ Reducir";
    if (!editorDialog.open) editorDialog.showModal();
    el("notesEditor").focus();
  };

  el("editorFullscreenClose").onclick = closeExpandedEditor;
  editorDialog.addEventListener("close", restoreEditorSection);

  document.querySelectorAll(".nav-item").forEach(button => {
    button.onclick = () => {
      const view = button.dataset.view;
      showView(view);
      if (view === "today") {
        state.selectedDate = toKey(new Date());
        state.currentFilter = "all";
      } else if (view === "notes") state.currentFilter = "note";
      else if (view === "prompts") state.currentFilter = "prompt";
      else if (view === "incidents") state.currentFilter = "incident";
      else if (view === "calendar") {
        setCalendarMonthFromDate(state.selectedDate);
        calendarDetailExpanded = false;
      }
      renderAll();
    };
  });

  el("exportBtn").onclick = () => {
    const payload = {
      version: 2,
      days: [...state.days.values()],
      notes: [...state.notes.values()].map(({ pendingBlob, ...note }) => note),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cuaderno-notas-${toKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  el("importBtn").onclick = () => el("importInput").click();
  el("importInput").onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed.days) && Array.isArray(parsed.notes)) {
        for (const day of parsed.days) await putDay({ ...day, syncStatus: "pending" });
        for (const note of parsed.notes) await putNote({ ...note, syncStatus: "pending" });
      } else {
        toast("Formato antiguo: impórtalo desde una copia previa de la app", "error");
      }
      renderAll();
      syncSoon();
    } catch {
      toast("No se pudo importar el archivo", "error");
    }
    event.target.value = "";
  };

  el("cloudStatus").onclick = () => {
    if (!state.user) el("authDialog").showModal();
    else el("refreshBtn").click();
  };

  el("accountBtn").onclick = async () => {
    if (!state.user) {
      el("authDialog").showModal();
      return;
    }
    if (!confirm(`¿Cerrar sesión de ${state.user.email || "esta cuenta"}?`)) return;
    stopRealtime();
    await supabaseClient.auth.signOut();
  };

  el("authCloseBtn").onclick = () => el("authDialog").close();
  el("authLocalBtn").onclick = () => el("authDialog").close();

  el("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const email = el("authEmail").value.trim();
    const password = el("authPassword").value;
    const message = el("authMessage");
    message.className = "auth-message";
    message.textContent = "Entrando…";

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      message.className = "auth-message error";
      message.textContent = error.message;
      return;
    }
    el("authDialog").close();
  });

  el("authSignupBtn").onclick = async () => {
    const email = el("authEmail").value.trim();
    const password = el("authPassword").value;
    const message = el("authMessage");
    if (!email || password.length < 6) {
      message.className = "auth-message error";
      message.textContent = "Introduce un email y una contraseña de al menos 6 caracteres.";
      return;
    }

    message.className = "auth-message";
    message.textContent = "Creando cuenta…";
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      message.className = "auth-message error";
      message.textContent = error.message;
      return;
    }

    if (!data.session) {
      message.className = "auth-message ok";
      message.textContent = "Cuenta creada. Confirma el correo y después entra.";
    }
  };

  window.addEventListener("online", async () => {
    state.online = true;
    setCloudUI();
    retryPending();
    if (state.user) {
      try {
        await syncNow();
        renderAll();
      } catch {}
    }
  });

  window.addEventListener("offline", () => {
    state.online = false;
    state.syncStatus = "local";
    setCloudUI();
    toast("Sin conexión · los cambios quedan pendientes", "neutral");
  });
}

function setupMobileKeyboardUX() {
  const viewport = window.visualViewport;

  const update = () => {
    const height = viewport ? viewport.height : window.innerHeight;
    const keyboard = window.innerHeight - height > 140 ||
      document.activeElement?.matches?.("input,textarea,select,[contenteditable='true']");
    document.body.classList.toggle("keyboard-open", Boolean(keyboard));
  };

  document.addEventListener("focusin", event => {
    if (event.target.matches?.("input,textarea,select,[contenteditable='true']")) {
      document.body.classList.add("keyboard-open");
      setTimeout(() => event.target.scrollIntoView({ block: "center", behavior: "smooth" }), 160);
    }
  });
  document.addEventListener("focusout", () => setTimeout(update, 180));
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
}

async function bootAuth() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) console.error(error);

  if (data.session?.user) {
    state.user = data.session.user;
    state.syncStatus = navigator.onLine ? "syncing" : "local";
    setCloudUI();
    try {
      await syncNow();
    } catch (syncError) {
      console.error(syncError);
      state.syncStatus = "error";
    }
    startRealtime(() => {
      renderAll();
      setCloudUI();
    });
  } else {
    state.user = null;
    setCloudUI();
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      state.user = session.user;
      state.syncStatus = "syncing";
      setCloudUI();
      try {
        await syncNow();
        state.syncStatus = "synced";
      } catch (syncError) {
        console.error(syncError);
        state.syncStatus = "error";
      }
      startRealtime(() => renderAll());
      renderAll();
    } else if (event === "SIGNED_OUT") {
      state.user = null;
      state.syncStatus = "local";
      stopRealtime();
      setCloudUI();
      renderAll();
    }
  });
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").then(registration => {
    if (registration.waiting) {
      toast("Nueva versión disponible", "neutral", {
        label: "Actualizar",
        onClick: () => registration.waiting.postMessage({ type: "SKIP_WAITING" }),
      });
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          toast("Nueva versión disponible", "neutral", {
            label: "Actualizar",
            onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
          });
        }
      });
    });
  }).catch(console.error);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}

async function init() {
  await migrateLegacyLocalStorage();
  await loadCache();
  state.selectedDate = toKey(new Date());
  ensureDay(state.selectedDate);

  showView("today");
  bindEvents();
  setupMobileKeyboardUX();
  setupServiceWorker();
  retryPending = retryPendingLater(() => renderAll());
  renderAll();
  await bootAuth();
  renderAll();
}

init().catch(error => {
  console.error(error);
  toast("No se pudo iniciar la aplicación", "error");
});
