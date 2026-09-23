const crypto = require("crypto");

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const forwarded =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "";

  const ip = String(forwarded).split(",")[0].trim();

  if (!ip) {
    return res.status(503).json({ error: "No se pudo detectar la red." });
  }

  // No devolvemos ni almacenamos la IP. Solo un identificador opaco de la red.
  // La seguridad real sigue siendo Supabase Auth + RLS por user_id.
  const token = crypto
    .createHash("sha256")
    .update("cuaderno-notas-network-v1:" + ip)
    .digest("hex");

  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({
    token,
    label: token.slice(0, 6).toUpperCase(),
  });
};
