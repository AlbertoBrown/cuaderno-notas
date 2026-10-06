// Cuaderno v39 · bootstrap de aplicación + movimiento + correcciones móviles.
// La lógica principal se mantiene en app-core.js; motion.js añade microinteracciones y mobile-fix.js corrige iPhone.
import "./app-core.js?v=38";
import "./motion.js?v=38";
import "./mobile-fix.js?v=39";

requestAnimationFrame(() => {
  document.querySelector(".side-nav")?.removeAttribute("aria-hidden");
  const pill = document.querySelector(".nav-motion-pill");
  if (pill) pill.style.zIndex = "0";
});
