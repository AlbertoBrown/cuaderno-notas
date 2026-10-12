(() => {
  let queued = false;

  function injectStyles() {
    if (document.getElementById("visualCardUiStyles")) return;

    const style = document.createElement("style");
    style.id = "visualCardUiStyles";
    style.textContent = `
      /* Biblioteca visual · tarjetas más legibles y acciones siempre visibles */
      #visualNotesList.visual-notes-list{
        gap:14px;
      }

      #visualNotesList .visual-note-card{
        grid-template-columns:138px minmax(0,1fr);
        min-height:178px;
        border-radius:18px;
        border-color:#ddd5c8;
        background:#fffdf9;
        box-shadow:0 7px 20px rgba(45,36,25,.055);
        transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;
      }

      #visualNotesList .visual-note-card:hover{
        transform:translateY(-1px);
        border-color:#cfc5b6;
        box-shadow:0 11px 28px rgba(45,36,25,.09);
      }

      #visualNotesList .visual-thumb-button{
        min-height:100%;
        background:#eee8dc;
      }

      #visualNotesList .visual-note-thumb{
        width:100%;
        height:100%;
        object-fit:cover;
      }

      #visualNotesList .visual-note-body{
        min-width:0;
        padding:11px 12px 10px;
        display:flex;
        flex-direction:column;
      }

      #visualNotesList .visual-note-meta{
        align-items:center;
        gap:8px;
        margin-bottom:2px;
      }

      #visualNotesList .visual-note-body h3{
        margin:5px 0 5px;
        font-size:16px;
        line-height:1.18;
        white-space:normal;
        display:-webkit-box;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
        overflow:hidden;
      }

      #visualNotesList .visual-note-prompt{
        font-size:11px;
        line-height:1.42;
        -webkit-line-clamp:2;
      }

      #visualNotesList .vo-card-meta{
        margin:4px 0 2px;
      }

      #visualNotesList .vo-chip{
        padding:4px 8px;
        border:1px solid rgba(0,0,0,.035);
      }

      #visualNotesList .visual-note-actions{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        margin-top:auto;
        padding-top:10px;
      }

      #visualNotesList .visual-note-actions button{
        flex:0 1 auto;
        min-height:30px;
        padding:6px 9px;
        border-radius:10px;
        border:1px solid #ddd4c7;
        background:#fbf7ef;
        color:#29251f;
        font-size:10px;
        line-height:1;
        font-weight:650;
        white-space:nowrap;
        transition:background .14s ease,border-color .14s ease,transform .14s ease;
      }

      #visualNotesList .visual-note-actions button:hover{
        transform:translateY(-1px);
        border-color:#c8bdad;
        background:#fff;
      }

      #visualNotesList .visual-note-actions .view-visual{
        background:#171717;
        border-color:#171717;
        color:#fff;
      }

      #visualNotesList .visual-note-actions .edit-visual{
        background:#fff0df;
        border-color:#f0d6b8;
        color:#6d421e;
      }

      #visualNotesList .visual-note-actions .delete-visual{
        margin-left:0;
        background:#fff0ec;
        border-color:#efc7bb;
        color:#a23f28;
        font-weight:800;
      }

      #visualNotesList .visual-note-actions .delete-visual::before{
        content:"×";
        display:inline-grid;
        place-items:center;
        width:14px;
        height:14px;
        margin-right:4px;
        border-radius:50%;
        background:#d94b43;
        color:#fff;
        font-size:11px;
        line-height:1;
        vertical-align:-1px;
      }

      #visualLibraryFilters.vo-filters{
        gap:10px;
        padding:11px 12px;
        border-radius:16px;
        box-shadow:0 4px 14px rgba(45,36,25,.035);
      }

      #visualLibraryFilters .vo-reset{
        background:#fff;
        border-color:#ddd4c7;
      }

      @media (max-width:1200px){
        #visualNotesList.visual-notes-list{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }
      }

      @media (max-width:760px){
        #visualNotesList.visual-notes-list{
          grid-template-columns:1fr;
        }
        #visualNotesList .visual-note-card{
          grid-template-columns:120px minmax(0,1fr);
          min-height:170px;
        }
        #visualNotesList .visual-note-actions button{
          padding:7px 9px;
        }
      }

      @media (max-width:430px){
        #visualNotesList .visual-note-card{
          grid-template-columns:108px minmax(0,1fr);
        }
        #visualNotesList .visual-note-body{
          padding:10px;
        }
        #visualNotesList .visual-note-actions{
          gap:5px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function decorateCards() {
    document.querySelectorAll("#visualNotesList .visual-note-card").forEach(card => {
      if (card.dataset.cardUiReady === "1") return;
      card.dataset.cardUiReady = "1";

      const remove = card.querySelector(".delete-visual");
      if (remove) {
        remove.textContent = "Eliminar";
        remove.title = "Eliminar este apunte visual";
        remove.setAttribute("aria-label", "Eliminar este apunte visual");
      }

      const view = card.querySelector(".view-visual");
      if (view) view.title = "Abrir imagen";

      const copy = card.querySelector(".copy-visual");
      if (copy) copy.title = "Copiar prompt";

      const edit = card.querySelector(".edit-visual");
      if (edit) edit.title = "Editar apunte";
    });
  }

  function run() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorateCards();
    });
  }

  function init() {
    injectStyles();
    run();

    const list = document.getElementById("visualNotesList");
    if (list) {
      new MutationObserver(run).observe(list, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
