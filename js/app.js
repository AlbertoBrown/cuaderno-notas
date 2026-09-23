import { supabaseClient } from "./supabase.js";
import {
  state,
  loadCache,
  migrateLegacyLocalStorage,
  ensureDay,
  notesForDate,
  allVisualNotes,
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
  getSignedImageUrl,
  filePreviewUrl,
  revokePreviewUrl,
} from "./visual-notes.js";

const el = id => document.getElementById(id);
const blobUrlCache = new Map();
const daySaveTimers = new Map();
let visualDraft = {
  previewUrl: "",
  blob: null,
  fileName: "",
  width: 0,
  height: 0,
  busy: false,
};
let retryPending = () => {};

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
    box.querySelector("small").textContent = "Pulsa actualizar para reintentar";
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

function renderDay() {
  const day = ensureDay(state.selectedDate);
  el("promptInput").value = day.prompt || "";
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
      const haystack = `${note.titulo} ${note.contenido} ${note.etiqueta} ${note.fecha}`.toLowerCase();
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
    card.innerHTML = `
      <div class="meta">
        <span>${meta.label}</span>
        <span class="note-sync ${syncClass(note.syncStatus)}">● ${syncLabel(note.syncStatus)}</span>
      </div>
      <h3>${escapeHtml(note.titulo)}</h3>
      <p>${escapeHtml(note.contenido || "")}</p>
      <span class="tag">${escapeHtml(note.etiqueta || note.fecha)}</span>
      <button class="delete-note" title="Eliminar">×</button>
    `;
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

async function imageUrlForNote(note) {
  if (note.pendingBlob) {
    if (!blobUrlCache.has(note.id)) {
      blobUrlCache.set(note.id, URL.createObjectURL(note.pendingBlob));
    }
    return blobUrlCache.get(note.id);
  }
  if (note.legacyImageData) return note.legacyImageData;
  if (note.imagenPath) {
    try {
      return await getSignedImageUrl(note.imagenPath);
    } catch (error) {
      console.warn("No se pudo cargar la imagen", error);
    }
  }
  return "";
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
        <img class="visual-note-thumb" loading="lazy" decoding="async" alt="" hidden>
      </button>
      <div class="visual-note-body">
        <div class="visual-note-meta">
          <span>${formatDate(fromKey(note.fecha), { day: "2-digit", month: "short" })} · ${timeLabel(note.createdAt)}</span>
          <span class="note-sync ${syncClass(note.syncStatus)}">● ${syncLabel(note.syncStatus)}</span>
        </div>
        <h3>${escapeHtml(note.titulo || "Apunte visual")}</h3>
        <div class="visual-note-prompt">${escapeHtml(note.contenido || "")}</div>
        <div class="visual-note-actions">
          <button class="view-visual" type="button">Ver</button>
          <button class="copy-visual" type="button">Copiar</button>
          <button class="delete-visual" type="button">Eliminar</button>
        </div>
      </div>
    `;

    const img = card.querySelector(".visual-note-thumb");
    const skeleton = card.querySelector(".visual-thumb-skeleton");

    imageUrlForNote(note).then(url => {
      if (!url) {
        skeleton.textContent = "Sin vista previa";
        skeleton.classList.add("visual-thumb-empty");
        return;
      }
      img.onload = () => {
        img.hidden = false;
        skeleton.hidden = true;
      };
      img.onerror = () => {
        skeleton.textContent = "No se pudo cargar";
        skeleton.classList.add("visual-thumb-empty");
      };
      img.src = url;
    });

    const open = () => openVisualViewer(note);
    card.querySelector(".visual-thumb-button").onclick = open;
    card.querySelector(".view-visual").onclick = open;
    card.querySelector(".copy-visual").onclick = async () => {
      await navigator.clipboard.writeText(note.contenido || "");
      toast("Prompt copiado", "success");
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

async function openVisualViewer(note) {
  el("visualViewerTitle").textContent = note.titulo || "Apunte visual";
  el("visualViewerPrompt").textContent = note.contenido || "";
  const image = el("visualViewerImage");
  image.removeAttribute("src");
  image.classList.add("is-loading");
  const url = await imageUrlForNote(note);
  if (url) image.src = url;
  image.classList.remove("is-loading");
  const dialog = el("visualViewerDialog");
  if (!dialog.open) dialog.showModal();
}

function showView(view) {
  state.currentView = view;
  const visual = view === "visual";
  el("mainNotebookView").hidden = visual;
  el("visualNotesView").hidden = !visual;
  el("pageTitle").innerHTML = visual ? "Apuntes visuales<span>.</span>" : "Mis notas<span>.</span>";
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function renderAll() {
  renderDateHeader();
  if (state.currentView === "visual") renderVisualNotes();
  else {
    renderDay();
    renderNotes();
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
    }
    setCloudUI();
    if (state.currentView === "visual") renderVisualNotes();
    else renderNotes();
  });
}

function clearVisualDraft() {
  revokePreviewUrl(visualDraft.previewUrl);
  visualDraft = {
    previewUrl: "",
    blob: null,
    fileName: "",
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
  el("visualPromptInput").value = "";
  el("visualPromptCount").textContent = "0/2000";
  el("visualImageInput").value = "";
  el("visualCameraInput").value = "";
}

async function handleImageSelection(file) {
  if (!file) return;

  revokePreviewUrl(visualDraft.previewUrl);
  const previewUrl = await filePreviewUrl(file);
  visualDraft = {
    previewUrl,
    blob: null,
    fileName: file.name || "imagen.jpg",
    width: 0,
    height: 0,
    busy: true,
  };

  el("visualImagePreview").src = previewUrl;
  el("visualImagePreview").hidden = false;
  el("visualImagePlaceholder").hidden = true;
  el("visualRemoveImageBtn").hidden = false;
  el("visualImageInfo").textContent = "Preparando imagen…";

  try {
    const optimized = await optimizeImage(file);
    visualDraft.blob = optimized.blob;
    visualDraft.width = optimized.width;
    visualDraft.height = optimized.height;
    visualDraft.busy = false;
    const kb = Math.round(optimized.blob.size / 1024);
    el("visualImageInfo").textContent = `Lista · ${optimized.width}×${optimized.height} · ${kb} KB`;
  } catch (error) {
    visualDraft.busy = false;
    visualDraft.blob = file;
    el("visualImageInfo").textContent = "Usando imagen original";
    console.warn(error);
  }
}

async function saveVisualNote() {
  const title = el("visualTitleInput").value.trim() || "Apunte visual";
  const prompt = el("visualPromptInput").value.trim();
  const button = el("visualSaveBtn");

  if (!visualDraft.previewUrl) {
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
  button.innerHTML = "Guardando…";

  try {
    const now = nowIso();
    const note = markNotePending(
      {
        id: crypto.randomUUID(),
        fecha: state.selectedDate,
        tipo: "visual",
        titulo: title,
        etiqueta: "Imagen + prompt",
        contenido: prompt,
        imagenPath: null,
        imagenNombre: visualDraft.fileName,
        pendingBlob: visualDraft.blob,
        legacyImageData: null,
        createdAt: now,
        updatedAt: now,
        syncStatus: "pending",
        deleted: false,
      },
      {},
    );

    await putNote(note);
    renderVisualNotes();
    toast("Guardado · pendiente de sincronizar", "success");
    clearVisualDraft();
    syncSoon();
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar · Reintentar", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = old;
  }
}

async function addNormalNote() {
  const title = el("noteTitle").value.trim();
  if (!title) {
    el("noteTitle").focus();
    return;
  }

  const now = nowIso();
  await putNote({
    id: crypto.randomUUID(),
    fecha: state.selectedDate,
    tipo: el("noteType").value,
    titulo: title,
    etiqueta: el("noteTag").value.trim(),
    contenido: el("noteBody").value.trim(),
    imagenPath: null,
    imagenNombre: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    deleted: false,
  });

  el("noteDialog").close();
  renderNotes();
  renderDateHeader();
  syncSoon();
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
    renderAll();
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
      setCloudUI();
      toast("No se pudo sincronizar", "error", {
        label: "Reintentar",
        onClick: () => el("refreshBtn").click(),
      });
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  };

  el("newNoteBtn").onclick = () => {
    el("noteForm").reset();
    el("noteDialog").showModal();
  };
  el("saveNoteBtn").onclick = event => {
    event.preventDefault();
    addNormalNote();
  };

  el("promptInput").addEventListener("input", event => updateDay({ prompt: event.target.value }));
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
      updateDay({ prompt: next });
    };
  });

  el("copyPromptBtn").onclick = async () => {
    await navigator.clipboard.writeText(el("promptInput").value);
    toast("Prompt copiado", "success");
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

  el("visualImageInput").addEventListener("change", event => handleImageSelection(event.target.files?.[0]));
  el("visualCameraInput").addEventListener("change", event => handleImageSelection(event.target.files?.[0]));
  el("visualRemoveImageBtn").onclick = clearVisualDraft;
  el("visualPromptInput").addEventListener("input", event => {
    el("visualPromptCount").textContent = `${event.target.value.length}/2000`;
  });
  el("visualCopyDraftBtn").onclick = async () => {
    await navigator.clipboard.writeText(el("visualPromptInput").value || "");
    toast("Prompt copiado", "success");
  };
  el("visualSaveBtn").onclick = saveVisualNote;
  el("visualViewerClose").onclick = () => el("visualViewerDialog").close();

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
      else if (view === "days") state.currentFilter = "all";
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
