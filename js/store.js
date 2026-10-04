const DB_NAME = "cuaderno-notas-db";
const DB_VERSION = 3;

export const DEFAULT_NOTEBOOK_ID = "combustibles-los-baldios";
export const DEFAULT_NOTEBOOKS = [
  {
    id: DEFAULT_NOTEBOOK_ID,
    nombre: "Combustibles Los Baldíos",
    icono: "◫",
    color: "sand",
    isDefault: true,
  },
  {
    id: "programacion",
    nombre: "Programación",
    icono: "</>",
    color: "blue",
    isDefault: false,
  },
];

let dbPromise;

function openDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;

        // Se conserva "days" como almacén legado para poder migrar instalaciones anteriores.
        if (!db.objectStoreNames.contains("days")) {
          db.createObjectStore("days", { keyPath: "fecha" });
        }

        if (!db.objectStoreNames.contains("notebook_days")) {
          const days = db.createObjectStore("notebook_days", { keyPath: "cacheKey" });
          days.createIndex("fecha", "fecha", { unique: false });
          days.createIndex("notebookId", "notebookId", { unique: false });
          days.createIndex("syncStatus", "syncStatus", { unique: false });
        }

        if (!db.objectStoreNames.contains("notes")) {
          const notes = db.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("fecha", "fecha", { unique: false });
          notes.createIndex("tipo", "tipo", { unique: false });
          notes.createIndex("syncStatus", "syncStatus", { unique: false });
        }

        if (!db.objectStoreNames.contains("notebooks")) {
          const notebooks = db.createObjectStore("notebooks", { keyPath: "id" });
          notebooks.createIndex("syncStatus", "syncStatus", { unique: false });
        }

        if (!db.objectStoreNames.contains("links")) {
          const links = db.createObjectStore("links", { keyPath: "id" });
          links.createIndex("notebookId", "notebookId", { unique: false });
          links.createIndex("syncStatus", "syncStatus", { unique: false });
          links.createIndex("createdAt", "createdAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function withStore(name, mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  if (!db.objectStoreNames.contains(name)) return fn(null);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try {
      result = fn(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestResult(request) {
  if (!request) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function notebookDayKey(fecha, notebookId = state.currentNotebookId || DEFAULT_NOTEBOOK_ID) {
  return `${notebookId}:${fecha}`;
}

function normalizeNotebook(notebook) {
  const fallback = DEFAULT_NOTEBOOKS.find(item => item.id === notebook?.id);
  return {
    id: String(notebook?.id || `custom-${crypto.randomUUID()}`),
    nombre: String(notebook?.nombre || fallback?.nombre || "Nuevo cuaderno").trim(),
    icono: String(notebook?.icono || fallback?.icono || "▤"),
    color: String(notebook?.color || fallback?.color || "sand"),
    isDefault: Boolean(notebook?.isDefault ?? notebook?.is_default ?? fallback?.isDefault),
    createdAt: notebook?.createdAt || notebook?.created_at || nowIso(),
    updatedAt: notebook?.updatedAt || notebook?.updated_at || nowIso(),
    syncStatus: notebook?.syncStatus || "pending",
    syncError: notebook?.syncError || null,
  };
}

function normalizeDay(day, notebookId = day?.notebookId || day?.notebook_id || DEFAULT_NOTEBOOK_ID) {
  const fecha = String(day?.fecha || "");
  return {
    ...day,
    notebookId,
    cacheKey: notebookDayKey(fecha, notebookId),
    fecha,
    prompt: day?.prompt || "",
    prompts: Array.isArray(day?.prompts) ? day.prompts : [],
    apuntes: day?.apuntes || "",
    conclusiones: day?.conclusiones || "",
    tareas: Array.isArray(day?.tareas) ? day.tareas : [],
    updatedAt: day?.updatedAt || day?.updated_at || nowIso(),
    syncStatus: day?.syncStatus || "local",
  };
}

function normalizeNote(note) {
  return {
    ...note,
    notebookId: note?.notebookId || note?.notebook_id || DEFAULT_NOTEBOOK_ID,
  };
}

function normalizeLink(link) {
  return {
    ...link,
    id: String(link?.id || crypto.randomUUID()),
    notebookId: link?.notebookId || link?.notebook_id || DEFAULT_NOTEBOOK_ID,
    url: String(link?.url || "").trim(),
    titulo: String(link?.titulo || "").trim(),
    nota: String(link?.nota || ""),
    etiquetas: Array.isArray(link?.etiquetas) ? link.etiquetas : [],
    createdAt: link?.createdAt || link?.created_at || nowIso(),
    updatedAt: link?.updatedAt || link?.updated_at || nowIso(),
    syncStatus: link?.syncStatus || "pending",
    syncError: link?.syncError || null,
    deleted: Boolean(link?.deleted),
  };
}

export const state = {
  user: null,
  selectedDate: new Date().toISOString().slice(0, 10),
  currentView: "today",
  currentFilter: "all",
  searchTerm: "",
  notebooks: new Map(),
  currentNotebookId: DEFAULT_NOTEBOOK_ID,
  showingNotebooks: false,
  notebookSchemaReady: null,
  days: new Map(),
  notes: new Map(),
  links: new Map(),
  syncStatus: "local",
  online: navigator.onLine,
};

export function nowIso() {
  return new Date().toISOString();
}

export function dayKey(fecha, notebookId = state.currentNotebookId) {
  return notebookDayKey(fecha, notebookId);
}

export function dayForDate(fecha, notebookId = state.currentNotebookId) {
  return state.days.get(notebookDayKey(fecha, notebookId));
}

export function notebookForId(id) {
  return state.notebooks.get(id) || null;
}

export function currentNotebook() {
  return notebookForId(state.currentNotebookId);
}

export function notebooksList() {
  return [...state.notebooks.values()].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

export async function loadCache() {
  const db = await openDb();
  if (!db) return state;

  const [notebooks, notebookDays, legacyDays, notes, links, selectedNotebookId] = await Promise.all([
    withStore("notebooks", "readonly", store => requestResult(store?.getAll())),
    withStore("notebook_days", "readonly", store => requestResult(store?.getAll())),
    withStore("days", "readonly", store => requestResult(store?.getAll())),
    withStore("notes", "readonly", store => requestResult(store?.getAll())),
    withStore("links", "readonly", store => requestResult(store?.getAll())),
    getMeta("current-notebook-id"),
  ]);

  state.notebooks = new Map((notebooks || []).map(item => {
    const normalized = normalizeNotebook(item);
    return [normalized.id, normalized];
  }));

  for (const seed of DEFAULT_NOTEBOOKS) {
    if (!state.notebooks.has(seed.id)) {
      const localSeed = normalizeNotebook({
        ...seed,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        syncStatus: "pending",
      });
      state.notebooks.set(localSeed.id, localSeed);
      await withStore("notebooks", "readwrite", store => store?.put(localSeed));
    }
  }

  state.days = new Map();
  for (const raw of notebookDays || []) {
    const day = normalizeDay(raw);
    state.days.set(day.cacheKey, day);
  }

  // Copia transparente de los días guardados por versiones anteriores.
  for (const raw of legacyDays || []) {
    const day = normalizeDay(raw, raw?.notebookId || DEFAULT_NOTEBOOK_ID);
    if (!state.days.has(day.cacheKey)) {
      state.days.set(day.cacheKey, day);
      await withStore("notebook_days", "readwrite", store => store?.put(day));
    }
  }

  state.notes = new Map();
  for (const raw of notes || []) {
    const note = normalizeNote(raw);
    state.notes.set(note.id, note);
    if (!raw.notebookId && !raw.notebook_id) {
      await withStore("notes", "readwrite", store => store?.put(note));
    }
  }

  state.links = new Map();
  for (const raw of links || []) {
    const link = normalizeLink(raw);
    state.links.set(link.id, link);
  }

  state.currentNotebookId =
    selectedNotebookId && state.notebooks.has(selectedNotebookId)
      ? selectedNotebookId
      : DEFAULT_NOTEBOOK_ID;

  return state;
}

export async function putNotebook(notebook) {
  const normalized = normalizeNotebook(notebook);
  state.notebooks.set(normalized.id, normalized);
  await withStore("notebooks", "readwrite", store => store?.put(normalized));
  return normalized;
}

export async function setCurrentNotebook(id) {
  if (!state.notebooks.has(id)) return false;
  state.currentNotebookId = id;
  await setMeta("current-notebook-id", id);
  return true;
}

export async function putDay(day) {
  const normalized = normalizeDay(day);
  state.days.set(normalized.cacheKey, normalized);
  await withStore("notebook_days", "readwrite", store => store?.put(normalized));
  return normalized;
}

export async function putNote(note) {
  const normalized = normalizeNote(note);
  state.notes.set(normalized.id, normalized);
  await withStore("notes", "readwrite", store => store?.put(normalized));
  return normalized;
}

export async function deleteNoteLocal(id) {
  state.notes.delete(id);
  await withStore("notes", "readwrite", store => store?.delete(id));
}

export async function putLink(link) {
  const normalized = normalizeLink(link);
  state.links.set(normalized.id, normalized);
  await withStore("links", "readwrite", store => store?.put(normalized));
  return normalized;
}

export async function deleteLinkLocal(id) {
  state.links.delete(id);
  await withStore("links", "readwrite", store => store?.delete(id));
}

export function linksForNotebook(notebookId = state.currentNotebookId) {
  return [...state.links.values()]
    .filter(link => link.notebookId === notebookId && !link.deleted)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export async function deleteDayLocal(fecha, notebookId = state.currentNotebookId) {
  const key = notebookDayKey(fecha, notebookId);
  state.days.delete(key);
  await withStore("notebook_days", "readwrite", store => store?.delete(key));
}

export async function getMeta(key) {
  return withStore("meta", "readonly", async store => {
    if (!store) return null;
    const row = await requestResult(store.get(key));
    return row?.value ?? null;
  });
}

export async function setMeta(key, value) {
  return withStore("meta", "readwrite", store => store?.put({ key, value }));
}

export function ensureDay(fecha) {
  const key = notebookDayKey(fecha);
  if (!state.days.has(key)) {
    state.days.set(key, {
      cacheKey: key,
      notebookId: state.currentNotebookId || DEFAULT_NOTEBOOK_ID,
      fecha,
      prompt: "",
      prompts: [],
      apuntes: "",
      conclusiones: "",
      tareas: [],
      updatedAt: nowIso(),
      syncStatus: "local",
    });
  }
  return state.days.get(key);
}

export function notesForDate(fecha) {
  return [...state.notes.values()].filter(note =>
    note.notebookId === state.currentNotebookId &&
    note.fecha === fecha &&
    !note.deleted
  );
}

export function allVisualNotes() {
  return [...state.notes.values()]
    .filter(note =>
      note.notebookId === state.currentNotebookId &&
      note.tipo === "visual" &&
      !note.deleted
    )
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function markDayPending(fecha, patch = {}) {
  const current = ensureDay(fecha);
  return {
    ...current,
    ...patch,
    cacheKey: notebookDayKey(fecha, current.notebookId || state.currentNotebookId),
    notebookId: current.notebookId || state.currentNotebookId,
    fecha,
    updatedAt: nowIso(),
    syncStatus: "pending",
  };
}

export function markNotePending(note, patch = {}) {
  return {
    ...note,
    ...patch,
    notebookId: note?.notebookId || state.currentNotebookId || DEFAULT_NOTEBOOK_ID,
    updatedAt: nowIso(),
    syncStatus: "pending",
  };
}

export function remoteWins(local, remote) {
  if (!local) return true;
  if (["pending", "syncing", "error"].includes(local.syncStatus)) {
    const localTime = Date.parse(local.updatedAt || 0) || 0;
    const remoteTime = Date.parse(remote.updatedAt || 0) || 0;
    return remoteTime > localTime;
  }
  return true;
}

export async function migrateLegacyLocalStorage() {
  const done = await getMeta("legacy-migrated");
  if (done) return;

  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem("cuaderno-notas:v1") || "null");
  } catch {
    legacy = null;
  }

  if (legacy && typeof legacy === "object") {
    for (const [fecha, day] of Object.entries(legacy)) {
      const legacyPrompt = String(day.prompt || "").trim();
      const dayRow = {
        notebookId: DEFAULT_NOTEBOOK_ID,
        fecha,
        prompt: "",
        prompts: legacyPrompt
          ? [{ id: crypto.randomUUID(), text: legacyPrompt, createdAt: nowIso() }]
          : [],
        apuntes: day.notesHtml || day.apuntes || "",
        conclusiones: day.conclusions || day.conclusiones || "",
        tareas: Array.isArray(day.tasks) ? day.tasks : Array.isArray(day.tareas) ? day.tareas : [],
        updatedAt: nowIso(),
        syncStatus: "pending",
      };
      await putDay(dayRow);

      for (const item of day.items || []) {
        let contenido = item.body || "";
        let prompt = "";
        let imageData = "";
        if (item.type === "visual") {
          try {
            const parsed = JSON.parse(contenido);
            prompt = parsed.prompt || "";
            imageData = parsed.imageData || "";
          } catch {
            prompt = contenido;
          }
        }
        await putNote({
          id: item.id || crypto.randomUUID(),
          notebookId: DEFAULT_NOTEBOOK_ID,
          fecha,
          tipo: item.type || "note",
          titulo: item.title || "",
          etiqueta: item.tag || "",
          contenido: item.type === "visual" ? prompt : contenido,
          legacyImageData: imageData || null,
          imagenPath: null,
          imagenNombre: null,
          createdAt: item.createdAt || new Date(`${fecha}T${item.time || "12:00"}:00`).toISOString(),
          updatedAt: nowIso(),
          syncStatus: "pending",
          deleted: false,
        });
      }
    }
  }

  try {
    localStorage.removeItem("cuaderno-notas:v1");
  } catch {}
  await setMeta("legacy-migrated", true);
}
