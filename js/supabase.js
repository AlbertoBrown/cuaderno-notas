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

export function buildDayRow(day, userId) {
  return {
    user_id: userId,
    fecha: day.fecha,
    prompt: day.prompt || "",
    apuntes: day.apuntes || "",
    conclusiones: day.conclusiones || "",
    tareas: Array.isArray(day.tareas) ? day.tareas : [],
    updated_at: day.updatedAt || new Date().toISOString(),
  };
}

export function buildNoteRow(note, userId, hasVisualColumns) {
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

  if (hasVisualColumns) {
    row.imagen_path = note.imagenPath || null;
    row.imagen_nombre = note.imagenNombre || null;
  }

  return row;
}
