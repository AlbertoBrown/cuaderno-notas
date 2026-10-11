import {
  supabaseClient,
  detectVisualColumns,
  detectNotebookSchema,
  buildNoteRow,
} from "./supabase.js";
import { uploadImage } from "./visual-notes.js";

const DB_NAME = "cuaderno-notas-db";
const NOTES_STORE = "notes";
const RECOVERABLE_STATUSES = new Set(["pending", "syncing", "error"]);

let rescueRunning = false;
let reloadScheduled = false;

function errorText(error) {
  if (!error) return "Error local de IndexedDB sin detalle";
  if (typeof error === "string") return error;
  return String(
    error.message ||
    error.error_description ||
    error.error ||
    error.statusCode ||
    error.name ||
    JSON.stringify(error) ||
    "Error desconocido"
  );
}

function showToast(message, tone = "neutral") {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }

  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  const text = document.createElement("span");
  text.textContent = message;
  node.appendChild(text);
  host.appendChild(node);
  setTimeout(() => node.remove(), tone === "error" ? 9000 : 4000);
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB no está disponible en este dispositivo"));
      return;
    }

    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir IndexedDB"));
    request.onupgradeneeded = () => {
      try { request.transaction?.abort(); } catch {}
      reject(new Error("La base local todavía no está preparada"));
    };
  });
}

async function readLocalNotes() {
  const db = await openDb();
  try {
    if (!db.objectStoreNames.contains(NOTES_STORE)) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, "readonly");
      const store = tx.objectStore(NOTES_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || tx.error || new Error("No se pudieron leer las fotos locales"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB abortó la lectura de fotos"));
    });
  } finally {
    db.close();
  }
}

async function persistLocalNote(note) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, "readwrite");
      const store = tx.objectStore(NOTES_STORE);
      const request = store.put(note);

      request.onerror = () => reject(
        request.error || tx.error || new Error("No se pudo actualizar la copia local de la foto")
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || request.error || new Error("Error al guardar la foto recuperada"));
      tx.onabort = () => reject(tx.error || request.error || new Error("IndexedDB abortó el guardado de la foto recuperada"));
    });
  } finally {
    db.close();
  }
}

function isCandidate(note) {
  if (!note || note.tipo !== "visual" || note.deleted) return false;

  return Boolean(
    note.pendingBlob ||
    (
      RECOVERABLE_STATUSES.has(note.syncStatus) &&
      note.imagenPath
    )
  );
}

async function rescueOne(note, user, schema) {
  let current = { ...note };

  if (current.pendingBlob) {
    const path = await uploadImage({
      userId: user.id,
      fecha: current.fecha,
      noteId: current.id,
      blob: current.pendingBlob,
    });

    current = {
      ...current,
      imagenPath: path,
      imagenNombre: current.imagenNombre || `${current.id}.jpg`,
    };
  }

  if (!current.imagenPath) {
    throw new Error(
      `La foto “${current.titulo || "sin título"}” no conserva un archivo local recuperable.`
    );
  }

  const now = new Date().toISOString();
  const cloudNote = {
    ...current,
    contenido: JSON.stringify({
      prompt: current.contenido || "",
      link: current.enlace || "",
    }),
    updatedAt: now,
  };

  const row = buildNoteRow(
    cloudNote,
    user.id,
    schema.hasVisualColumns,
    schema.hasNotebookSchema,
  );

  const { error } = await supabaseClient
    .from("cuaderno_notas")
    .upsert(row, { onConflict: "id" });

  if (error) throw error;

  const localSynced = {
    ...current,
    pendingBlob: null,
    previousImagenPath: null,
    legacyImageData: schema.hasVisualColumns ? null : current.legacyImageData,
    updatedAt: now,
    syncStatus: "synced",
    syncError: null,
  };

  await persistLocalNote(localSynced);
  return localSynced;
}

export async function rescuePendingVisualPhotos({ manual = false } = {}) {
  if (rescueRunning || !navigator.onLine) return { recovered: 0, failed: 0 };
  rescueRunning = true;

  try {
    const { data, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const user = data.session?.user;
    if (!user) return { recovered: 0, failed: 0 };

    const notes = await readLocalNotes();
    const candidates = notes.filter(isCandidate);
    if (!candidates.length) return { recovered: 0, failed: 0 };

    const [hasVisualColumns, hasNotebookSchema] = await Promise.all([
      detectVisualColumns(),
      detectNotebookSchema(),
    ]);

    const schema = { hasVisualColumns, hasNotebookSchema };
    let recovered = 0;
    const failures = [];

    for (const note of candidates) {
      try {
        await rescueOne(note, user, schema);
        recovered += 1;
      } catch (error) {
        const detail = errorText(error);
        failures.push({ note, detail });
        console.error("No se pudo rescatar la foto local", note?.id, error);
      }
    }

    if (recovered > 0) {
      showToast(
        recovered === 1
          ? "Foto recuperada y subida a la nube"
          : `${recovered} fotos recuperadas y subidas a la nube`,
        "success",
      );

      if (!reloadScheduled) {
        reloadScheduled = true;
        setTimeout(() => window.location.reload(), 900);
      }
    }

    if (failures.length) {
      const first = failures[0];
      showToast(
        `No se pudo subir “${first.note?.titulo || "una foto"}”: ${first.detail}`,
        "error",
      );
    } else if (manual && recovered === 0) {
      showToast("No hay fotos locales pendientes de rescate", "neutral");
    }

    return { recovered, failed: failures.length };
  } catch (error) {
    const detail = errorText(error);
    console.error("Error del rescate de fotos", error);
    if (manual) showToast(`Rescate de fotos: ${detail}`, "error");
    return { recovered: 0, failed: 1 };
  } finally {
    rescueRunning = false;
  }
}

function scheduleAutoRescue(delay = 1600) {
  setTimeout(() => {
    rescuePendingVisualPhotos().catch(error => {
      console.warn("Rescate automático de fotos pendiente", error);
    });
  }, delay);
}

// Recuperación automática al abrir Cuaderno.
scheduleAutoRescue();

window.addEventListener("online", () => scheduleAutoRescue(250));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleAutoRescue(400);
});

// Si el sincronizador general vuelve a fallar al pulsar Actualizar, esta vía
// independiente vuelve a intentar únicamente las fotos locales.
document.getElementById("refreshBtn")?.addEventListener("click", () => {
  scheduleAutoRescue(100);
});
