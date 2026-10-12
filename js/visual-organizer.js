import { state, allVisualNotes, putNote, nowIso } from "./store.js";
import { pushPending } from "./sync.js";

const GENERAL_CATEGORY = "General";
const LAST_CATEGORY_KEY = "cuaderno-notas:visual-last-category:v1";
const LEGACY_VISUAL_TAG = /^Imagen\s*\+\s*prompt(?:\s*·.*)?$/i;

let editingVisualId = null;
let refreshQueued = false;

const el = id => document.getElementById(id);

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function categoryFor(note) {
  const value = String(note?.etiqueta || "").trim().replace(/\s+/g, " ").slice(0, 48);
  if (!value || LEGACY_VISUAL_TAG.test(value)) return GENERAL_CATEGORY;
  return value;
}

function dateFor(note) {
  const value = String(note?.fecha || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const created = String(note?.createdAt || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : localDateKey();
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function formatDate(key, includeYear = false) {
  const [y, m, d] = String(key).split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(y, m - 1, d)).replace(/\./g, "");
}

function formatTime(iso) {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function visualNotes() {
  return allVisualNotes();
}

function categories() {
  const values = new Set([GENERAL_CATEGORY]);
  visualNotes().forEach(note => values.add(categoryFor(note)));
  return [...values].sort((a, b) => {
    if (a === GENERAL_CATEGORY) return -1;
    if (b === GENERAL_CATEGORY) return 1;
    return a.localeCompare(b, "es", { sensitivity: "base" });
  });
}

function rememberedCategory() {
  try {
    return localStorage.getItem(LAST_CATEGORY_KEY) || GENERAL_CATEGORY;
  } catch {
    return GENERAL_CATEGORY;
  }
}

function rememberCategory(value) {
  try {
    localStorage.setItem(LAST_CATEGORY_KEY, value || GENERAL_CATEGORY);
  } catch {}
}

function fillCategorySelect(select, selected, allowNew = false) {
  if (!select) return;
  const current = selected || GENERAL_CATEGORY;
  const values = categories();
  if (!values.includes(current)) values.push(current);

  select.replaceChildren(...values.map(value => new Option(value, value)));
  if (allowNew) select.append(new Option("+ Nueva categoría…", "__new__"));
  select.value = current;
}

function injectStyles() {
  if (el("visualOrganizerStyles")) return;

  const style = document.createElement("style");
  style.id = "visualOrganizerStyles";
  style.textContent = `
    .visual-organizer-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.75fr);gap:10px}
    .visual-organizer-stack{display:grid;gap:7px}
    .visual-organizer-help{margin-top:5px;color:#8e877d;font-size:10px;font-weight:650}
    .visual-organizer-fields select,.visual-organizer-fields input[type=date],.visual-category-new,.visual-library-filters select,.visual-library-filters input{height:38px;border:1px solid #dcd5c9;border-radius:12px;background:#fffdf8;color:#29251f;padding:0 11px;font:650 13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none}
    .visual-organizer-fields select:focus,.visual-organizer-fields input:focus,.visual-library-filters select:focus,.visual-library-filters input:focus{border-color:#ff9b72;box-shadow:0 0 0 3px rgba(255,126,72,.12)}
    .visual-library-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 13px;padding:10px 11px;border:1px solid #e1dbcf;border-radius:15px;background:rgba(255,253,248,.72)}
    .visual-library-filter{display:flex;align-items:center;gap:6px}
    .visual-library-filter>span{font-size:10px;font-weight:800;color:#81796f;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
    .visual-filter-reset{height:38px;border:1px solid #ded7ca;border-radius:999px;background:#fffaf1;padding:0 12px;font:750 12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#6c645b;cursor:pointer}
    .visual-organizer-card-meta{display:flex;gap:6px;flex-wrap:wrap;margin:1px 0 7px}
    .visual-organizer-chip{border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;line-height:1.1}
    .visual-organizer-chip.category{background:#f0eadf;color:#655d53}
    .visual-organizer-chip.date{background:#eef3e8;color:#5c704d}
    #visualNotesList .visual-note-card[hidden]{display:none!important}
    @media(max-width:720px){
      .visual-organizer-fields{grid-template-columns:1fr}
      .visual-library-filters{overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch}
      .visual-library-filter{flex:0 0 auto}
      .visual-library-filters select,.visual-library-filters input{max-width:155px}
    }
  `;
  document.head.appendChild(style);
}

function ensureFormFields() {
  if (el("visualOrganizerFields")) return;
  const promptField = el("visualPromptInput")?.closest("label");
  if (!promptField?.parentElement) return;

  const fields = document.createElement("div");
  fields.id = "visualOrganizerFields";
  fields.className = "visual-organizer-fields";
  fields.innerHTML = `
    <label class="visual-field">
      <span class="visual-label"><span aria-hidden="true">⌑</span> Categoría</span>
      <span class="visual-organizer-stack">
        <select id="visualCategorySelect" aria-label="Categoría del apunte visual"></select>
        <input id="visualCategoryNew" class="visual-category-new" maxlength="48" placeholder="Nueva categoría" hidden>
      </span>
      <small class="visual-organizer-help">Elige una categoría existente o crea una nueva.</small>
    </label>
    <label class="visual-field">
      <span class="visual-label"><span aria-hidden="true">◷</span> Fecha</span>
      <input id="visualNoteDate" type="date" aria-label="Fecha del apunte visual">
      <small class="visual-organizer-help">Puedes guardar el apunte en una fecha distinta de hoy.</small>
    </label>
  `;

  promptField.parentElement.insertBefore(fields, promptField);
  fillCategorySelect(el("visualCategorySelect"), rememberedCategory(), true);
  el("visualNoteDate").value = state.selectedDate || localDateKey();

  el("visualCategorySelect").addEventListener("change", () => {
    const input = el("visualCategoryNew");
    const creating = el("visualCategorySelect").value === "__new__";
    input.hidden = !creating;
    if (creating) {
      input.value = "";
      input.focus();
    }
  });
}

function ensureLibraryFilters() {
  if (el("visualLibraryFilters")) return;
  const head = document.querySelector(".visual-library-head");
  if (!head) return;

  const filters = document.createElement("div");
  filters.id = "visualLibraryFilters";
  filters.className = "visual-library-filters";
  filters.innerHTML = `
    <label class="visual-library-filter">
      <span>Categoría</span>
      <select id="visualCategoryFilter" aria-label="Filtrar por categoría"></select>
    </label>
    <label class="visual-library-filter">
      <span>Fecha</span>
      <select id="visualDateFilter" aria-label="Filtrar por fecha">
        <option value="all">Todas</option>
        <option value="today">Hoy</option>
        <option value="week">Esta semana</option>
        <option value="month">Este mes</option>
        <option value="exact">Elegir fecha…</option>
      </select>
      <input id="visualDateExact" type="date" aria-label="Fecha exacta" hidden>
    </label>
    <button id="visualFiltersReset" class="visual-filter-reset" type="button">Limpiar filtros</button>
  `;
  head.insertAdjacentElement("afterend", filters);

  el("visualCategoryFilter").addEventListener("change", applyFilters);
  el("visualDateFilter").addEventListener("change", () => {
    const exact = el("visualDateExact");
    exact.hidden = el("visualDateFilter").value !== "exact";
    if (!exact.hidden && !exact.value) exact.value = localDateKey();
    applyFilters();
  });
  el("visualDateExact").addEventListener("change", applyFilters);
  el("visualFiltersReset").addEventListener("click", () => {
    el("visualCategoryFilter").value = "all";
    el("visualDateFilter").value = "all";
    el("visualDateExact").hidden = true;
    el("visualDateExact").value = "";
    applyFilters();
  });
}

function noteForCard(card) {
  const storedId = card.dataset.visualOrganizerId;
  if (storedId) {
    const stored = state.notes.get(storedId);
    if (stored && !stored.deleted) return stored;
  }

  const title = normalizeText(card.querySelector("h3")?.textContent);
  const prompt = normalizeText(card.querySelector(".visual-note-prompt")?.textContent);
  const candidates = visualNotes().filter(note =>
    normalizeText(note.titulo || "Apunte visual") === title &&
    normalizeText(note.contenido) === prompt
  );

  if (!candidates.length) return null;
  const note = candidates[0];
  card.dataset.visualOrganizerId = note.id;
  return note;
}

function decorateCard(card) {
  const note = noteForCard(card);
  if (!note) return;

  card.dataset.visualOrganizerId = note.id;
  card.dataset.visualCategory = categoryFor(note);
  card.dataset.visualDate = dateFor(note);

  const originalMeta = card.querySelector(".visual-note-meta > span:first-child");
  if (originalMeta) {
    const time = formatTime(note.createdAt);
    originalMeta.textContent = `${formatDate(dateFor(note))}${time ? ` · ${time}` : ""}`;
  }

  let row = card.querySelector(".visual-organizer-card-meta");
  if (!row) {
    row = document.createElement("div");
    row.className = "visual-organizer-card-meta";
    row.innerHTML = `
      <span class="visual-organizer-chip category"></span>
      <span class="visual-organizer-chip date"></span>
    `;
    const body = card.querySelector(".visual-note-body");
    const title = body?.querySelector("h3");
    if (body && title) body.insertBefore(row, title);
  }

  if (row) {
    row.querySelector(".category").textContent = categoryFor(note);
    row.querySelector(".date").textContent = formatDate(dateFor(note), true);
  }
}

function syncCategoryFilterOptions() {
  const select = el("visualCategoryFilter");
  if (!select) return;
  const current = select.value || "all";
  select.replaceChildren(
    new Option("Todas", "all"),
    ...categories().map(value => new Option(value, value)),
  );
  select.value = [...select.options].some(option => option.value === current) ? current : "all";
}

function currentWeekRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [localDateKey(start), localDateKey(end)];
}

function matchesDate(key, mode, exact) {
  if (mode === "all") return true;
  if (mode === "today") return key === localDateKey();
  if (mode === "month") return key.slice(0, 7) === localDateKey().slice(0, 7);
  if (mode === "week") {
    const [start, end] = currentWeekRange();
    return key >= start && key <= end;
  }
  if (mode === "exact") return Boolean(exact) && key === exact;
  return true;
}

function applyFilters() {
  const category = el("visualCategoryFilter")?.value || "all";
  const dateMode = el("visualDateFilter")?.value || "all";
  const exact = el("visualDateExact")?.value || "";
  let total = 0;
  let visible = 0;

  document.querySelectorAll("#visualNotesList .visual-note-card").forEach(card => {
    const note = noteForCard(card);
    if (!note) return;
    total += 1;
    const show =
      (category === "all" || categoryFor(note) === category) &&
      matchesDate(dateFor(note), dateMode, exact);
    card.hidden = !show;
    if (show) visible += 1;
  });

  const count = el("visualLibraryCount");
  if (count) {
    count.textContent = category !== "all" || dateMode !== "all"
      ? `${visible} de ${total} apuntes`
      : `${total} apunte${total === 1 ? "" : "s"} guardado${total === 1 ? "" : "s"}`;
  }
}

function refreshCards() {
  document.querySelectorAll("#visualNotesList .visual-note-card").forEach(decorateCard);
  syncCategoryFilterOptions();
  applyFilters();
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    refreshCards();
  });
}

function setFormForNote(note = null) {
  ensureFormFields();
  const selected = note ? categoryFor(note) : rememberedCategory();
  fillCategorySelect(el("visualCategorySelect"), selected, true);
  el("visualCategoryNew").hidden = true;
  el("visualCategoryNew").value = "";
  el("visualNoteDate").value = note ? dateFor(note) : (state.selectedDate || localDateKey());
}

function chosenCategory() {
  const select = el("visualCategorySelect");
  if (!select) return GENERAL_CATEGORY;
  if (select.value !== "__new__") return select.value || GENERAL_CATEGORY;
  return String(el("visualCategoryNew")?.value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

async function waitForSavedNote({ editingId, beforeIds, oldUpdatedAt, title, prompt }) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    let note = null;
    if (editingId) {
      const candidate = state.notes.get(editingId);
      if (candidate && candidate.updatedAt !== oldUpdatedAt) note = candidate;
    } else {
      note = visualNotes().find(candidate =>
        !beforeIds.has(candidate.id) &&
        normalizeText(candidate.titulo || "Apunte visual") === normalizeText(title) &&
        normalizeText(candidate.contenido) === normalizeText(prompt)
      );
    }

    if (note && !el("visualSaveBtn")?.disabled) return note;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return null;
}

async function persistOrganizerMetadata(note, category, date) {
  const current = state.notes.get(note.id) || note;
  const next = {
    ...current,
    fecha: date,
    etiqueta: category || GENERAL_CATEGORY,
    updatedAt: nowIso(),
    syncStatus: "pending",
    syncError: null,
  };

  await putNote(next);
  rememberCategory(next.etiqueta);

  if (state.user && navigator.onLine) {
    try {
      await pushPending();
    } catch (error) {
      console.warn("Categoría/fecha pendientes de sincronizar", error);
    }
  }

  editingVisualId = null;
  setFormForNote(null);
  queueRefresh();
  setTimeout(queueRefresh, 150);
}

function bindEvents() {
  const list = el("visualNotesList");
  if (list && list.dataset.visualOrganizerBound !== "true") {
    list.dataset.visualOrganizerBound = "true";
    list.addEventListener("click", event => {
      const card = event.target.closest(".visual-note-card");
      if (!card) return;
      const note = noteForCard(card);
      if (note && event.target.closest(".edit-visual")) {
        editingVisualId = note.id;
        queueMicrotask(() => setFormForNote(note));
      }
    }, true);
  }

  const cancel = el("visualCancelEditBtn");
  if (cancel && cancel.dataset.visualOrganizerBound !== "true") {
    cancel.dataset.visualOrganizerBound = "true";
    cancel.addEventListener("click", () => {
      editingVisualId = null;
      setTimeout(() => setFormForNote(null), 0);
    });
  }

  const save = el("visualSaveBtn");
  if (save && save.dataset.visualOrganizerBound !== "true") {
    save.dataset.visualOrganizerBound = "true";
    save.addEventListener("click", event => {
      const category = chosenCategory();
      if (el("visualCategorySelect")?.value === "__new__" && !category) {
        event.preventDefault();
        event.stopImmediatePropagation();
        el("visualCategoryNew")?.focus();
        return;
      }

      const date = el("visualNoteDate")?.value || state.selectedDate || localDateKey();
      const title = el("visualTitleInput")?.value.trim() || "Apunte visual";
      const prompt = el("visualPromptInput")?.value.trim() || "";
      const editingId = editingVisualId;
      const oldUpdatedAt = editingId ? state.notes.get(editingId)?.updatedAt : null;
      const beforeIds = new Set(visualNotes().map(note => note.id));

      setTimeout(async () => {
        const note = await waitForSavedNote({
          editingId,
          beforeIds,
          oldUpdatedAt,
          title,
          prompt,
        });
        if (note) await persistOrganizerMetadata(note, category || GENERAL_CATEGORY, date);
      }, 0);
    }, true);
  }
}

function init() {
  if (window.__cuadernoVisualOrganizerV1) return;
  window.__cuadernoVisualOrganizerV1 = true;

  injectStyles();
  ensureFormFields();
  ensureLibraryFilters();
  bindEvents();
  setFormForNote(null);
  refreshCards();

  const list = el("visualNotesList");
  if (list) {
    new MutationObserver(queueRefresh).observe(list, { childList: true, subtree: true });
  }

  const view = el("visualNotesView");
  if (view) {
    new MutationObserver(() => {
      if (!view.hidden) {
        bindEvents();
        if (!editingVisualId) setFormForNote(null);
        queueRefresh();
      }
    }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
