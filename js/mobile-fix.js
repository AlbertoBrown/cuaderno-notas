// Cuaderno v39 · correcciones específicas para iPhone / móvil.
// Se carga después del sistema de movimiento para poder corregir la cascada móvil sin tocar la lógica de datos.

const mobileFixCss = `
@media (max-width: 720px) {
  html, body {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }

  body {
    background: #f3f1eb;
  }

  .app-shell {
    display: block !important;
    min-height: 100svh;
    width: 100%;
  }

  .workspace {
    width: 100%;
    min-width: 0;
    max-width: 100vw;
    overflow-x: clip;
    padding:
      calc(10px + env(safe-area-inset-top))
      12px
      calc(102px + env(safe-area-inset-bottom)) !important;
  }

  /* Cabecera compacta y estable en iPhone */
  .topbar {
    position: sticky !important;
    top: 0 !important;
    z-index: 30 !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center !important;
    gap: 8px !important;
    min-height: 58px !important;
    height: auto !important;
    margin:
      calc(-10px - env(safe-area-inset-top))
      -12px
      12px !important;
    padding:
      calc(10px + env(safe-area-inset-top))
      12px
      10px !important;
    background: rgba(244, 241, 232, .94) !important;
    border-bottom: 1px solid rgba(17, 17, 17, .07) !important;
    backdrop-filter: blur(16px) saturate(1.05);
    -webkit-backdrop-filter: blur(16px) saturate(1.05);
  }

  .topbar-title-wrap {
    min-width: 0;
  }

  .topbar h1 {
    margin: 2px 0 0 !important;
    font-size: clamp(30px, 9.3vw, 38px) !important;
    line-height: .96 !important;
    letter-spacing: -.05em !important;
    overflow-wrap: anywhere;
  }

  .topbar .eyebrow {
    display: none !important;
  }

  .top-actions {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    gap: 7px !important;
    min-width: 0;
    margin: 0 !important;
  }

  .top-actions .ghost-btn,
  .top-actions .account-btn,
  .top-actions .refresh-btn {
    min-width: 44px !important;
    width: 44px;
    height: 44px;
    min-height: 44px !important;
    padding: 0 !important;
    border-radius: 50% !important;
    display: grid !important;
    place-items: center;
    overflow: hidden;
  }

  .top-actions .ghost-btn span,
  .top-actions .account-btn {
    font-size: 0;
  }

  .top-actions .account-btn::after {
    content: "◉";
    font-size: 21px;
    line-height: 1;
  }

  .refresh-btn {
    font-size: 23px !important;
  }

  .search-box,
  #todayBtn {
    display: none !important;
  }

  /* Selector de cuadernos: elimina el gran hueco superior que aparecía en iPhone */
  body.notebook-picker-open .workspace {
    padding:
      calc(8px + env(safe-area-inset-top))
      16px
      calc(28px + env(safe-area-inset-bottom)) !important;
  }

  body.notebook-picker-open .topbar {
    position: static !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    min-height: 48px !important;
    height: 48px !important;
    margin: 0 0 8px !important;
    padding: 0 !important;
    background: transparent !important;
    border: 0 !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  body.notebook-picker-open .topbar-title-wrap {
    display: none !important;
  }

  body.notebook-picker-open .top-actions {
    width: 100%;
    justify-content: flex-end !important;
  }

  body.notebook-picker-open .notebooks-view {
    padding: 0 0 18px !important;
    margin: 0 !important;
  }

  .notebooks-hero {
    display: block !important;
    margin: 0 0 18px !important;
    padding: 0 !important;
  }

  .notebooks-hero > div:first-child {
    min-width: 0;
  }

  .notebooks-hero .eyebrow {
    display: block !important;
    margin-bottom: 6px;
    font-size: 10px !important;
  }

  .notebooks-hero h2 {
    margin: 0 0 8px !important;
    max-width: 100%;
    font-size: clamp(36px, 11vw, 46px) !important;
    line-height: .96 !important;
    letter-spacing: -.055em !important;
  }

  .notebooks-hero p {
    margin: 0 !important;
    max-width: 36rem;
    color: #746f66;
    font-size: 15px !important;
    line-height: 1.42 !important;
  }

  .notebook-new-btn {
    width: 100% !important;
    min-height: 54px !important;
    margin-top: 18px !important;
    font-size: 17px !important;
  }

  .notebooks-grid {
    grid-template-columns: 1fr !important;
    gap: 14px !important;
    width: 100%;
  }

  .notebook-card {
    width: 100% !important;
    min-height: 178px !important;
    padding: 17px !important;
    border-radius: 24px !important;
    text-align: left;
    overflow: hidden;
  }

  .notebook-card-top {
    min-height: 47px;
  }

  .notebook-card-icon,
  .notebook-card-arrow {
    width: 48px !important;
    height: 48px !important;
  }

  .notebook-card-body h3 {
    margin: 12px 0 4px !important;
    font-size: clamp(24px, 7.2vw, 30px) !important;
    line-height: 1 !important;
    letter-spacing: -.04em;
  }

  .notebook-card-body p {
    margin: 0 !important;
    font-size: 14px !important;
    line-height: 1.35;
  }

  .notebook-card-meta {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 7px !important;
    margin-top: 14px !important;
  }

  .notebook-card-meta span {
    min-height: 29px;
    padding: 6px 10px !important;
    font-size: 10px !important;
    line-height: 1;
    white-space: nowrap;
  }

  /* Navegación inferior: ahora hay 7 pestañas; antes seguía maquetada a 6 columnas. */
  body:not(.notebook-picker-open) .sidebar {
    position: fixed !important;
    top: auto !important;
    left: 7px !important;
    right: 7px !important;
    bottom: calc(7px + env(safe-area-inset-bottom)) !important;
    z-index: 80 !important;
    width: auto !important;
    min-height: 0 !important;
    height: auto !important;
    padding: 6px !important;
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 24px !important;
    background: rgba(13, 13, 13, .94) !important;
    box-shadow: 0 12px 34px rgba(0,0,0,.24);
    backdrop-filter: blur(18px) saturate(1.05);
    -webkit-backdrop-filter: blur(18px) saturate(1.05);
  }

  body:not(.notebook-picker-open) .sidebar .brand,
  body:not(.notebook-picker-open) .sidebar .sidebar-footer {
    display: none !important;
  }

  .side-nav {
    display: grid !important;
    grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
    gap: 0 !important;
    width: 100%;
  }

  .nav-item,
  .nav-item:nth-child(n) {
    display: flex !important;
    width: 100% !important;
    min-width: 0 !important;
    height: 58px !important;
    min-height: 58px !important;
    padding: 5px 1px 4px !important;
    flex-direction: column !important;
    justify-content: center !important;
    gap: 3px !important;
    border-radius: 15px !important;
    overflow: hidden;
  }

  .nav-item .nav-icon {
    width: 26px !important;
    height: 26px !important;
    flex: 0 0 26px !important;
    font-size: 12px !important;
  }

  .nav-item .nav-label {
    display: block !important;
    width: 100% !important;
    overflow: hidden;
    color: inherit;
    font-size: 8px !important;
    font-weight: 650;
    line-height: 1 !important;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-motion-pill {
    border-radius: 15px !important;
  }

  /* Salvaguardas generales de responsive */
  .content-grid,
  .visual-compose-grid,
  .calendar-layout,
  .quick-sections {
    grid-template-columns: 1fr !important;
  }

  .visual-notes-list,
  .links-list {
    max-width: 100%;
  }

  .daily-card,
  .visual-upload-card,
  .visual-form-card,
  .calendar-month-card,
  .calendar-day-panel,
  .link-card,
  .note-card {
    max-width: 100%;
  }

  /* En iPhone dejamos la transición de apertura sutil; el morph gigante quedaba aparatoso. */
  .motion-notebook-clone {
    display: none !important;
  }
}

@media (max-width: 390px) {
  .workspace {
    padding-left: 10px !important;
    padding-right: 10px !important;
  }

  body.notebook-picker-open .workspace {
    padding-left: 12px !important;
    padding-right: 12px !important;
  }

  .notebooks-hero h2 {
    font-size: 39px !important;
  }

  .notebook-card {
    min-height: 168px !important;
    padding: 15px !important;
  }

  .notebook-card-body h3 {
    font-size: 25px !important;
  }

  .nav-item .nav-label {
    font-size: 7.5px !important;
  }
}
`;

const style = document.createElement("style");
style.id = "cuadernoMobileFixV39";
style.textContent = mobileFixCss;
document.head.appendChild(style);
