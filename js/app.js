// Cuaderno v38 · bootstrap de aplicación + sistema de movimiento.
// La lógica principal se mantiene en app-core.js; motion.js añade microinteracciones sin tocar datos ni sincronización.
import "./app-core.js?v=38";
import "./motion.js?v=38";

requestAnimationFrame(() => {
  document.querySelector(".side-nav")?.removeAttribute("aria-hidden");
  const pill = document.querySelector(".nav-motion-pill");
  if (pill) pill.style.zIndex = "0";
});
