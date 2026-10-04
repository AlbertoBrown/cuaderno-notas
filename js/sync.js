import {
  supabaseClient,
  detectVisualColumns,
  detectNotebookSchema,
  buildNotebookRow,
  buildDayRow,
  buildNoteRow,
} from "./supabase.js";
import {
  state,
  DEFAULT_NOTEBOOK_ID,
  dayKey,
  putNotebook,
  putDay,
  putNote,
  deleteNoteLocal,
  remoteWins,
  nowIso,
} from "./store.js";
import {
  uploadImage,
  removeImage,
  migrateLegacyVisualImage,
} from "./visual-notes.js";

let realtimeChannel = null;
let realtimeRefreshTimer = null;
let syncing = false;

function parseRemoteDayPrompts(value, fecha, fallbackDate) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2 && Array.isArray(parsed.items)) {
      return parsed.items
        .map(item => ({
          id: String(item?.id || crypto.randomUUID()),
          text: String(item?.text || "").trim(),
          createdAt: item?.createdAt || fallbackDate || nowIso(),
        }))
        .filter(item => item.text);
    }
  } catch {}

  return [{
    id: `legacy-${fecha}`,
    text: raw,
    createdAt: fallbackDate || nowIso(),
  }];
}

function remoteNotebookToLocal(row) {
  return {
    id: row.id,
    nombre: row.nombre || "Nuevo cuaderno",
    icono: row.icono || "▤",
    color: row.color || "sand",
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at || nowIso(),
    updatedAt: row.updated_at || row.created_at || nowIso(),
    syncStatus: "synced",
    syncError: null,
  };
}

function remoteDayToLocal(row, hasNotebookSchema = true) {
  const notebookId = hasNotebookSchema
    ? (row.notebook_id || DEFAULT_NOTEBOOK_ID)
    : DEFAULT_NOTEBOOK_ID;

  return {
    notebookId,
    cacheKey: dayKey(row.fecha, notebookId),
    fecha: row.fecha,
    prompt: "",
    prompts: parseRemoteDayPrompts(
      row.prompt,
      row.fecha,
      row.updated_at || row.created_at || nowIso(),
    ),
    apuntes: row.apuntes || "",
    conclusiones: row.conclusiones || "",
    tareas: Array.isArray(row.tareas) ? row.tareas : [],
    updatedAt: row.updated_at || row.created_at || nowIso(),
    syncStatus: "synced",
  };
}

function parseRemoteVisualContent(row) {
  let prompt = row.contenido || "";
  let imagePath = row.imagen_path || null;
  let legacyImageData = null;
  let enlace = "";

  if (row.tipo === "visual") {
    try {
      const parsed = JSON.parse(row.contenido || "");
      if (parsed && typeof parsed === "object") {
        prompt = parsed.prompt || "";
        imagePath = imagePath || parsed.imagePath || null;
        legacyImageData = parsed.imageData || null;
        enlace = parsed.link || parsed.enlace || "";
      }
    } catch {}
  }

  return { prompt, imagePath, legacyImageData, enlace };
}

function remoteNoteToLocal(row, hasNotebookSchema = true) {
  const visual = parseRemoteVisualContent(row);
  return {
    id: row.id,
    notebookId: hasNotebookSchema
      ? (row.notebook_id || DEFAULT_NOTEBOOK_ID)
      : DEFAULT_NOTEBOOK_ID,
    fecha: row.fecha,
    tipo: row.tipo || "note",
    titulo: row.titulo || "",
    etiqueta: row.etiqueta || "",
    contenido: row.tipo === "visual" ? visual.prompt : row.contenido || "",
    enlace: row.tipo === "visual" ? visual.enlace : "",
    imagenPath: visual.imagePath,
    imagenNombre: row.imagen_nombre || null,
    legacyImageData: visual.legacyImageData,
    createdAt: row.created_at || nowIso(),
    updatedAt: row.updated_at || row.created_at || nowIso(),
    syncStatus: "synced",
    deleted: false,
  };
}

function localNoteForRemote(note, hasVisualColumns) {
  let safe = { ...note };

  if (note.tipo === "visual") {
    const visualPayload = {
      prompt: note.contenido || "",
      link: note.enlace || "",
    };

    if (!hasVisualColumns) {
      visualPayload.imagePath = note.imagenPath || null;
      visualPayload.imageData = note.legacyImageData || null;
    }

    safe.contenido = JSON.stringify(visualPayload);
  }

  return buildNoteRow(
    safe,
    state.user.id,
    hasVisualColumns,
    state.notebookSchemaReady !== false,
  );
}

async function pushNotebook(notebook) {
  const syncingNotebook = { ...notebook, syncStatus: "syncing", syncError: null };
  await putNotebook(syncingNotebook);

  const { error } = await supabaseClient
    .from("cuadernos")
    .upsert(buildNotebookRow(syncingNotebook, state.user.id), { onConflict: "user_id,id" });

  if (error) {
    await putNotebook({
      ...syncingNotebook,
      syncStatus: "error",
      syncError: errorText(error),
    });
    throw error;
  }

  await putNotebook({
    ...syncingNotebook,
    syncStatus: "synced",
    syncError: null,
  });
}

function errorText(error) {
  return String(
    error?.message ||
    error?.error_description ||
    error?.error ||
    error?.statusCode ||
    "Error desconocido"
  );
}

async function pushDay(day, hasNotebookSchema) {
  if (!hasNotebookSchema && day.notebookId !== DEFAULT_NOTEBOOK_ID) return;

  const syncingDay = { ...day, syncStatus: "syncing", syncError: null };
  await putDay(syncingDay);

  const { error } = await supabaseClient
    .from("cuaderno_dias")
    .upsert(
      buildDayRow(syncingDay, state.user.id, hasNotebookSchema),
      { onConflict: hasNotebookSchema ? "user_id,notebook_id,fecha" : "user_id,fecha" },
    );

  if (error) {
    await putDay({ ...syncingDay, syncStatus: "error", syncError: errorText(error) });
    throw error;
  }

  await putDay({ ...syncingDay, syncStatus: "synced", syncError: null });
}

async function ensureVisualImage(note) {
  let current = note;

  if (current.tipo !== "visual") return current;

  if (!current.imagenPath && current.pendingBlob) {
    const path = await uploadImage({
      userId: state.user.id,
      fecha: current.fecha,
      noteId: current.id,
      blob: current.pendingBlob,
    });
    current = {
      ...current,
      imagenPath: path,
      imagenNombre: current.imagenNombre || `${current.id}.jpg`,
      pendingBlob: null,
      updatedAt: nowIso(),
      syncStatus: "syncing",
    };
    await putNote(current);
  }

  if (!current.imagenPath && current.legacyImageData) {
    current = await migrateLegacyVisualImage(current, state.user.id);
    current = {
      ...current,
      updatedAt: nowIso(),
      syncStatus: "syncing",
    };
    await putNote(current);
  }

  return current;
}

async function pushNote(note, hasVisualColumns, hasNotebookSchema) {
  if (!hasNotebookSchema && note.notebookId !== DEFAULT_NOTEBOOK_ID) return;

  if (note.deleted) {
    const { error } = await supabaseClient
      .from("cuaderno_notas")
      .delete()
      .eq("id", note.id)
      .eq("user_id", state.user.id);

    if (error) {
      await putNote({ ...note, syncStatus: "error" });
      throw error;
    }

    try {
      if (note.imagenPath) await removeImage(note.imagenPath);
    } catch (error) {
      console.warn("La fila se borró pero no se pudo borrar la imagen", error);
    }

    await deleteNoteLocal(note.id);
    return;
  }

  let current = { ...note, syncStatus: "syncing", syncError: null };
  await putNote(current);

  try {
    current = await ensureVisualImage(current);
    const row = localNoteForRemote(current, hasVisualColumns);
    const { error } = await supabaseClient
      .from("cuaderno_notas")
      .upsert(row, { onConflict: "id" });

    if (error) throw error;

    if (
      current.previousImagenPath &&
      current.imagenPath &&
      current.previousImagenPath !== current.imagenPath
    ) {
      try {
        await removeImage(current.previousImagenPath);
      } catch (cleanupError) {
        console.warn("La nota se actualizó pero no se pudo borrar la imagen anterior", cleanupError);
      }
    }

    await putNote({
      ...current,
      previousImagenPath: null,
      pendingBlob: null,
      legacyImageData: hasVisualColumns ? null : current.legacyImageData,
      syncStatus: "synced",
      syncError: null,
    });
  } catch (error) {
    await putNote({
      ...current,
      syncStatus: "error",
      syncError: errorText(error),
    });
    throw error;
  }
}

export async function pushPending() {
  if (!state.user || syncing || !navigator.onLine) return;
  syncing = true;
  state.syncStatus = "syncing";

  try {
    const [hasVisualColumns, hasNotebookSchema] = await Promise.all([
      detectVisualColumns(),
      detectNotebookSchema(),
    ]);
    state.notebookSchemaReady = hasNotebookSchema;

    const pendingNotebooks = hasNotebookSchema
      ? [...state.notebooks.values()].filter(notebook =>
          ["pending", "error"].includes(notebook.syncStatus),
        )
      : [];

    const pendingDays = [...state.days.values()].filter(day =>
      ["pending", "error"].includes(day.syncStatus),
    );

    const pendingNotes = [...state.notes.values()].filter(note =>
      ["pending", "error"].includes(note.syncStatus),
    );

    for (const notebook of pendingNotebooks) await pushNotebook(notebook);
    for (const day of pendingDays) await pushDay(day, hasNotebookSchema);
    for (const note of pendingNotes) {
      await pushNote(note, hasVisualColumns, hasNotebookSchema);
    }

    state.syncStatus = "synced";
  } catch (error) {
    state.syncStatus = "error";
    state.lastSyncError = errorText(error);
    throw error;
  } finally {
    syncing = false;
  }
}

async function mergeRemoteNotebook(remote) {
  const local = state.notebooks.get(remote.id);
  const incoming = remoteNotebookToLocal(remote);

  if (!local || remoteWins(local, incoming)) {
    await putNotebook(incoming);
  }
}

async function mergeRemoteDay(remote, hasNotebookSchema) {
  const notebookId = hasNotebookSchema
    ? (remote.notebook_id || DEFAULT_NOTEBOOK_ID)
    : DEFAULT_NOTEBOOK_ID;
  const local = state.days.get(dayKey(remote.fecha, notebookId));
  const incoming = remoteDayToLocal(remote, hasNotebookSchema);

  if (!local || remoteWins(local, incoming)) {
    await putDay(incoming);
  }
}

async function mergeRemoteNote(remote, hasNotebookSchema) {
  const local = state.notes.get(remote.id);
  const incoming = remoteNoteToLocal(remote, hasNotebookSchema);

  if (!local || remoteWins(local, incoming)) {
    await putNote(incoming);
  }
}

export async function pullAndMerge() {
  if (!state.user || !navigator.onLine) return;
  state.syncStatus = "syncing";

  const hasNotebookSchema = await detectNotebookSchema();
  state.notebookSchemaReady = hasNotebookSchema;

  const notebookPromise = hasNotebookSchema
    ? supabaseClient
        .from("cuadernos")
        .select("*")
        .eq("user_id", state.user.id)
        .order("created_at", { ascending: true })
    : Promise.resolve({ data: [], error: null });

  const [{ data: notebooks, error: notebooksError }, { data: days, error: daysError }, { data: notes, error: notesError }] =
    await Promise.all([
      notebookPromise,
      supabaseClient
        .from("cuaderno_dias")
        .select("*")
        .eq("user_id", state.user.id),
      supabaseClient
        .from("cuaderno_notas")
        .select("*")
        .eq("user_id", state.user.id)
        .order("updated_at", { ascending: true }),
    ]);

  if (notebooksError) throw notebooksError;
  if (daysError) throw daysError;
  if (notesError) throw notesError;

  for (const notebook of notebooks || []) {
    await mergeRemoteNotebook(notebook);
  }

  const remoteDayKeys = new Set();
  for (const day of days || []) {
    const notebookId = hasNotebookSchema
      ? (day.notebook_id || DEFAULT_NOTEBOOK_ID)
      : DEFAULT_NOTEBOOK_ID;
    remoteDayKeys.add(dayKey(day.fecha, notebookId));
    await mergeRemoteDay(day, hasNotebookSchema);
  }

  const remoteNoteIds = new Set();
  for (const note of notes || []) {
    remoteNoteIds.add(note.id);
    await mergeRemoteNote(note, hasNotebookSchema);
  }

  // A synced local item missing remotely is stale; pending/error items are preserved.
  for (const note of [...state.notes.values()]) {
    if (
      note.syncStatus === "synced" &&
      !note.deleted &&
      (hasNotebookSchema || note.notebookId === DEFAULT_NOTEBOOK_ID) &&
      !remoteNoteIds.has(note.id)
    ) {
      await deleteNoteLocal(note.id);
    }
  }

  state.syncStatus = "synced";
  state.lastSyncError = hasNotebookSchema
    ? null
    : "La migración de cuadernos todavía no está aplicada en Supabase.";
}

export async function syncNow() {
  if (!state.user || !navigator.onLine) return;
  await pushPending();
  await pullAndMerge();
  // A remote merge can leave a local pending record intentionally preserved.
  await pushPending();
}

function scheduleRealtimeRefresh(onChange) {
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(async () => {
    try {
      await pullAndMerge();
      onChange?.();
    } catch (error) {
      console.error("Realtime refresh failed", error);
    }
  }, 250);
}

export function startRealtime(onChange) {
  stopRealtime();
  if (!state.user) return;

  realtimeChannel = supabaseClient
    .channel(`cuaderno-${state.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cuadernos",
        filter: `user_id=eq.${state.user.id}`,
      },
      () => scheduleRealtimeRefresh(onChange),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cuaderno_dias",
        filter: `user_id=eq.${state.user.id}`,
      },
      () => scheduleRealtimeRefresh(onChange),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cuaderno_notas",
        filter: `user_id=eq.${state.user.id}`,
      },
      () => scheduleRealtimeRefresh(onChange),
    )
    .subscribe();
}

export function stopRealtime() {
  clearTimeout(realtimeRefreshTimer);
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

export function retryPendingLater(onChange) {
  let attempt = 0;

  const run = async () => {
    if (!navigator.onLine || !state.user) return;
    const pending = [
      ...state.notebooks.values(),
      ...state.notes.values(),
      ...state.days.values(),
    ].some(item =>
      ["pending", "error"].includes(item.syncStatus),
    );
    if (!pending) return;

    try {
      await pushPending();
      attempt = 0;
      onChange?.();
    } catch {
      attempt += 1;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      setTimeout(run, delay);
    }
  };

  return run;
}
