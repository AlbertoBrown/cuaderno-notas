const DB_NAME = "cuaderno-notas-db";
const DB_VERSION = 1;

let dbPromise;

function openDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("days")) {
          db.createObjectStore("days", { keyPath: "fecha" });
        }
        if (!db.objectStoreNames.contains("notes")) {
          const notes = db.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("fecha", "fecha", { unique: false });
          notes.createIndex("tipo", "tipo", { unique: false });
          notes.createIndex("syncStatus", "syncStatus", { unique: false });
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
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const state = {
  user: null,
  selectedDate: new Date().toISOString().slice(0, 10),
  currentView: "today",
  currentFilter: "all",
  searchTerm: "",
  days: new Map(),
  notes: new Map(),
  syncStatus: "local",
  online: navigator.onLine,
};

export function nowIso() {
  return new Date().toISOString();
}

export async function loadCache() {
  const db = await openDb();
  if (!db) return state;

  const [days, notes] = await Promise.all([
    withStore("days", "readonly", store => requestResult(store.getAll())),
    withStore("notes", "readonly", store => requestResult(store.getAll())),
  ]);

  state.days = new Map((days || []).map(item => [item.fecha, item]));
  state.notes = new Map((notes || []).map(item => [item.id, item]));
  return state;
}

export async function putDay(day) {
  state.days.set(day.fecha, day);
  await withStore("days", "readwrite", store => store && store.put(day));
  return day;
}

export async function putNote(note) {
  state.notes.set(note.id, note);
  await withStore("notes", "readwrite", store => store && store.put(note));
  return note;
}

export async function deleteNoteLocal(id) {
  state.notes.delete(id);
  await withStore("notes", "readwrite", store => store && store.delete(id));
}

export async function deleteDayLocal(fecha) {
  state.days.delete(fecha);
  await withStore("days", "readwrite", store => store && store.delete(fecha));
}

export async function getMeta(key) {
  return withStore("meta", "readonly", async store => {
    if (!store) return null;
    const row = await requestResult(store.get(key));
    return row?.value ?? null;
  });
}

export async function setMeta(key, value) {
  return withStore("meta", "readwrite", store => store && store.put({ key, value }));
}

export function ensureDay(fecha) {
  if (!state.days.has(fecha)) {
    state.days.set(fecha, {
      fecha,
      prompt: "",
      apuntes: "",
      conclusiones: "",
      tareas: [],
      updatedAt: nowIso(),
      syncStatus: "local",
    });
  }
  return state.days.get(fecha);
}

export function notesForDate(fecha) {
  return [...state.notes.values()].filter(note => note.fecha === fecha && !note.deleted);
}

export function allVisualNotes() {
  return [...state.notes.values()]
    .filter(note => note.tipo === "visual" && !note.deleted)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function markDayPending(fecha, patch = {}) {
  const current = ensureDay(fecha);
  return {
    ...current,
    ...patch,
    fecha,
    updatedAt: nowIso(),
    syncStatus: "pending",
  };
}

export function markNotePending(note, patch = {}) {
  return {
    ...note,
    ...patch,
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
      const dayRow = {
        fecha,
        prompt: day.prompt || "",
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
