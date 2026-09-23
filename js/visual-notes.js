import { supabaseClient, VISUAL_BUCKET } from "./supabase.js";

const signedUrlCache = new Map();

export async function filePreviewUrl(file) {
  return URL.createObjectURL(file);
}

export function revokePreviewUrl(url) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {}
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

export async function optimizeImage(file, { maxSide = 1600, quality = 0.78 } = {}) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("El archivo seleccionado no es una imagen.");
  }

  const bitmap = await loadBitmap(file);
  const width0 = bitmap.width || bitmap.naturalWidth;
  const height0 = bitmap.height || bitmap.naturalHeight;
  const ratio = Math.min(1, maxSide / Math.max(width0, height0));
  const width = Math.max(1, Math.round(width0 * ratio));
  const height = Math.max(1, Math.round(height0 * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise(resolve => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) throw new Error("No se pudo optimizar la imagen.");
  return { blob, width, height };
}

export async function uploadImage({ userId, fecha, noteId, blob }) {
  const path = `${userId}/${fecha}/${noteId}.jpg`;
  const { error } = await supabaseClient.storage
    .from(VISUAL_BUCKET)
    .upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: true,
    });

  if (error) throw error;
  signedUrlCache.delete(path);
  return path;
}

export async function removeImage(path) {
  if (!path) return;
  const { error } = await supabaseClient.storage.from(VISUAL_BUCKET).remove([path]);
  if (error) throw error;
  signedUrlCache.delete(path);
}

export async function getSignedImageUrl(path) {
  if (!path) return "";
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabaseClient.storage
    .from(VISUAL_BUCKET)
    .createSignedUrl(path, 3600);

  if (error) throw error;
  const url = data?.signedUrl || "";
  if (url) signedUrlCache.set(path, { url, expiresAt: Date.now() + 55 * 60 * 1000 });
  return url;
}

export function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const [header, body] = dataUrl.split(",");
  if (!body) return null;
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || "image/jpeg";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function migrateLegacyVisualImage(note, userId) {
  if (!note?.legacyImageData || note.imagenPath || !userId) return note;
  const blob = dataUrlToBlob(note.legacyImageData);
  if (!blob) return note;
  const path = await uploadImage({
    userId,
    fecha: note.fecha,
    noteId: note.id,
    blob,
  });
  return {
    ...note,
    imagenPath: path,
    imagenNombre: note.imagenNombre || `${note.id}.jpg`,
    legacyImageData: null,
  };
}
