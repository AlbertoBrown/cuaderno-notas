const SUPABASE_URL = "https://hafjrfpnmvyvrcyrqglb.supabase.co";
const SUPABASE_KEY = "sb_publishable_2yVzzQ5Jwpqjl1MnAYzqRg_evnyGVyw";

if (!window.supabase) {
  throw new Error("Supabase no se ha cargado.");
}

export const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      storage: window.localStorage,
      storageKey: "cuaderno-notas:auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export const VISUAL_BUCKET = "cuaderno-imagenes";

let visualColumnsPromise;
let notebookSchemaPromise;

export function detectNotebookSchema() {
  if (!notebookSchemaPromise) {
    notebookSchemaPromise = Promise.all([
      supabaseClient.from("cuadernos").select("id").limit(1),
      supabaseClient.from("cuaderno_dias").select("notebook_id").limit(1),
      supabaseClient.from("cuaderno_notas").select("notebook_id").limit(1),
    ]).then(results => {
      const error = results.find(item => item.error)?.error;
      if (!error) return true;
      const message = String(error.message || "").toLowerCase();
      if (
        message.includes("cuadernos") ||
        message.includes("notebook_id") ||
        message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("could not find")
      ) {
        return false;
      }
      throw error;
    });
  }
  return notebookSchemaPromise;
}

export function detectVisualColumns() {
  if (!visualColumnsPromise) {
    visualColumnsPromise = supabaseClient
      .from("cuaderno_notas")
      .select("imagen_path,imagen_nombre")
      .limit(1)
      .then(({ error }) => {
        if (!error) return true;
        const message = String(error.message || "").toLowerCase();
        if (
          message.includes("imagen_path") ||
          message.includes("imagen_nombre") ||
          message.includes("schema cache")
        ) {
          return false;
        }
        throw error;
      });
  }
  return visualColumnsPromise;
}

function serializeDayPromptItems(day) {
  let items = Array.isArray(day.prompts) ? day.prompts : [];
  if (!items.length && typeof day.prompt === "string" && day.prompt.trim()) {
    items = [{
      id: `legacy-${day.fecha}`,
      text: day.prompt.trim(),
      createdAt: day.updatedAt || new Date().toISOString(),
    }];
  }

  const safeItems = items
    .map(item => ({
      id: String(item?.id || crypto.randomUUID()),
      text: String(item?.text || "").trim(),
      createdAt: item?.createdAt || new Date().toISOString(),
    }))
    .filter(item => item.text);

  return JSON.stringify({ version: 2, items: safeItems });
}

export function buildNotebookRow(notebook, userId) {
  return {
    user_id: userId,
    id: notebook.id,
    nombre: notebook.nombre || "Nuevo cuaderno",
    icono: notebook.icono || "▤",
    color: notebook.color || "sand",
    is_default: Boolean(notebook.isDefault),
    created_at: notebook.createdAt || new Date().toISOString(),
    updated_at: notebook.updatedAt || new Date().toISOString(),
  };
}

export function buildDayRow(day, userId, hasNotebookSchema = true) {
  const row = {
    user_id: userId,
    fecha: day.fecha,
    prompt: serializeDayPromptItems(day),
    apuntes: day.apuntes || "",
    conclusiones: day.conclusiones || "",
    tareas: Array.isArray(day.tareas) ? day.tareas : [],
    updated_at: day.updatedAt || new Date().toISOString(),
  };

  if (hasNotebookSchema) row.notebook_id = day.notebookId;
  return row;
}

export function buildNoteRow(note, userId, hasVisualColumns, hasNotebookSchema = true) {
  const row = {
    id: note.id,
    user_id: userId,
    fecha: note.fecha,
    tipo: note.tipo || "note",
    titulo: note.titulo || "",
    etiqueta: note.etiqueta || "",
    contenido: note.contenido || "",
    created_at: note.createdAt || new Date().toISOString(),
    updated_at: note.updatedAt || new Date().toISOString(),
  };

  if (hasNotebookSchema) row.notebook_id = note.notebookId;

  if (hasVisualColumns) {
    row.imagen_path = note.imagenPath || null;
    row.imagen_nombre = note.imagenNombre || null;
  }

  return row;
}
