const MOTION_VERSION = "38";
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const motionCss = `
:root{
  --cu-motion-fast:160ms;
  --cu-motion:300ms;
  --cu-motion-slow:460ms;
  --cu-spring:cubic-bezier(.2,.9,.24,1.08);
  --cu-ease:cubic-bezier(.22,.75,.24,1);
}
html{scroll-behavior:smooth}
body.motion-ready .app-shell{animation:cu-app-in 420ms var(--cu-ease) both}
@keyframes cu-app-in{from{opacity:.01;transform:translateY(7px) scale(.997)}to{opacity:1;transform:none}}

/* Shared active indicator: one piece of UI glides between tabs. */
.side-nav{position:relative;isolation:isolate}
.nav-motion-pill{
  position:absolute;left:0;top:0;z-index:-1;pointer-events:none;
  border-radius:14px;background:#f4f1e8;
  box-shadow:0 7px 20px rgba(0,0,0,.12), inset 0 0 0 1px rgba(17,17,17,.05);
  opacity:0;transform:translate3d(0,0,0);
  transition:transform 380ms var(--cu-spring),width 380ms var(--cu-spring),height 380ms var(--cu-spring),opacity 150ms ease;
  will-change:transform,width,height;
}
body.motion-ready .nav-item.active{background:transparent!important}
.nav-item{transition:color 220ms ease,transform 180ms var(--cu-spring),background-color 220ms ease!important;position:relative;z-index:1}
.nav-item .nav-icon{transition:transform 300ms var(--cu-spring),border-color 220ms ease,background-color 220ms ease!important}
.nav-item.active .nav-icon{transform:translateY(-1px) scale(1.08)}
.nav-item:active,.primary-btn:active,.ghost-btn:active,.circle-btn:active,.filter-chip:active,.mini-chip:active,.utility-btn:active{transform:scale(.965)}

/* Cards feel tactile instead of static. */
.notebook-card,.note-card,.visual-note-card,.link-card,.calendar-stat,.daily-card,.quick-box{
  transition:transform 240ms var(--cu-spring),box-shadow 240ms var(--cu-ease),border-color 220ms ease,filter 220ms ease;
}
@media (hover:hover){
  .notebook-card:hover,.note-card:hover,.visual-note-card:hover,.link-card:hover{
    transform:translateY(-3px);box-shadow:0 14px 34px rgba(17,17,17,.10);filter:saturate(1.015)
  }
}
.notebook-card:active,.note-card:active,.visual-note-card:active,.link-card:active{transform:scale(.975)}

/* Dialogs / sheets */
dialog[open]{animation:cu-dialog-shell 200ms ease both}
dialog[open]::backdrop{animation:cu-backdrop 260ms ease both}
dialog[open] > *{animation:cu-dialog-card 420ms var(--cu-spring) both;transform-origin:50% 90%}
@keyframes cu-dialog-shell{from{opacity:0}to{opacity:1}}
@keyframes cu-backdrop{from{background:rgba(0,0,0,0);backdrop-filter:blur(0)}to{background:rgba(0,0,0,.32);backdrop-filter:blur(5px)}}
@keyframes cu-dialog-card{from{opacity:.15;transform:translateY(22px) scale(.965)}to{opacity:1;transform:none}}

.toast{animation:cu-toast-in 420ms var(--cu-spring) both;transform-origin:50% 100%}
@keyframes cu-toast-in{from{opacity:0;transform:translateY(14px) scale(.94)}to{opacity:1;transform:none}}

.motion-notebook-clone{
  position:fixed!important;margin:0!important;z-index:9999!important;pointer-events:none!important;
  transform-origin:0 0!important;overflow:hidden!important;box-shadow:0 28px 80px rgba(17,17,17,.22)!important;
  will-change:transform,opacity,border-radius,filter;
}
.motion-ripple{position:absolute;border-radius:999px;background:currentColor;opacity:.10;pointer-events:none;transform:translate(-50%,-50%) scale(0)}
.motion-view-enter{will-change:transform,opacity,filter}

/* Keep motion cheap on iPhone. */
@media(max-width:720px){
  dialog[open] > *{animation-name:cu-sheet-in}
  @keyframes cu-sheet-in{from{opacity:.2;transform:translateY(34px) scale(.985)}to{opacity:1;transform:none}}
  .notebook-card,.note-card,.visual-note-card,.link-card{transition-duration:180ms}
}

@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
  .nav-motion-pill{display:none!important}
}
`;

function installMotionStyles() {
  if (document.getElementById("cuadernoMotionStyles")) return;
  const style = document.createElement("style");
  style.id = "cuadernoMotionStyles";
  style.dataset.version = MOTION_VERSION;
  style.textContent = motionCss;
  document.head.appendChild(style);
}

function animateElement(node, keyframes, options) {
  if (reducedMotion || !node?.animate) return null;
  try { return node.animate(keyframes, options); } catch { return null; }
}

function activeView() {
  return ["notebooksView","calendarView","visualNotesView","linksView","mainNotebookView"]
    .map(id => document.getElementById(id))
    .find(node => node && !node.hidden);
}

function revealView(node, direction = 1) {
  if (!node || reducedMotion) return;
  node.classList.add("motion-view-enter");
  const animation = animateElement(node, [
    { opacity: .25, transform: `translate3d(${direction * 14}px,8px,0) scale(.995)`, filter: "blur(2px)" },
    { opacity: 1, transform: "translate3d(0,0,0) scale(1)", filter: "blur(0)" }
  ], { duration: 360, easing: "cubic-bezier(.22,.75,.24,1)", fill: "both" });
  animation?.finished.finally(() => node.classList.remove("motion-view-enter"));
}

function staggerChildren(container, selector = ":scope > *") {
  if (!container || reducedMotion) return;
  const items = [...container.querySelectorAll(selector)].slice(0, 12);
  items.forEach((item, index) => {
    if (item.dataset.motionSeen === MOTION_VERSION) return;
    item.dataset.motionSeen = MOTION_VERSION;
    animateElement(item, [
      { opacity: 0, transform: "translateY(10px) scale(.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ], { duration: 360, delay: Math.min(index * 38, 260), easing: "cubic-bezier(.2,.9,.24,1.08)", fill: "both" });
  });
}

let navPill;
function ensureNavPill() {
  const nav = document.querySelector(".side-nav");
  if (!nav) return null;
  navPill = nav.querySelector(".nav-motion-pill") || document.createElement("span");
  if (!navPill.isConnected) {
    navPill.className = "nav-motion-pill";
    nav.setAttribute("aria-hidden", "true");
    nav.prepend(navPill);
  }
  return navPill;
}

function placeNavPill(instant = false) {
  const nav = document.querySelector(".side-nav");
  const active = nav?.querySelector(".nav-item.active");
  const pill = ensureNavPill();
  if (!nav || !active || !pill || reducedMotion) return;
  const parent = nav.getBoundingClientRect();
  const rect = active.getBoundingClientRect();
  if (instant) pill.style.transition = "none";
  pill.style.width = `${rect.width}px`;
  pill.style.height = `${rect.height}px`;
  pill.style.transform = `translate3d(${rect.left - parent.left + nav.scrollLeft}px,${rect.top - parent.top + nav.scrollTop}px,0)`;
  pill.style.opacity = "1";
  if (instant) requestAnimationFrame(() => pill.style.removeProperty("transition"));
}

function morphNotebook(card) {
  if (!card || reducedMotion) return;
  const from = card.getBoundingClientRect();
  const target = document.querySelector(".workspace")?.getBoundingClientRect();
  if (!target || !from.width || !from.height) return;
  const clone = card.cloneNode(true);
  clone.classList.add("motion-notebook-clone");
  Object.assign(clone.style, {
    left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`
  });
  document.body.appendChild(clone);
  const dx = target.left - from.left;
  const dy = Math.max(0, target.top - from.top);
  const sx = Math.min(target.width / from.width, 2.2);
  const sy = Math.min(Math.max(target.height * .52, from.height) / from.height, 2.0);
  const animation = animateElement(clone, [
    { transform: "translate3d(0,0,0) scale(1)", opacity: .96, borderRadius: getComputedStyle(card).borderRadius || "18px", filter: "blur(0)" },
    { offset: .55, opacity: .68 },
    { transform: `translate3d(${dx}px,${dy}px,0) scale(${sx},${sy})`, opacity: 0, borderRadius: "24px", filter: "blur(3px)" }
  ], { duration: 480, easing: "cubic-bezier(.2,.82,.2,1)", fill: "forwards" });
  animation?.finished.finally(() => clone.remove());
  setTimeout(() => clone.remove(), 700);
}

function pulseButton(button, event) {
  if (!button || reducedMotion) return;
  if (getComputedStyle(button).position === "static") button.style.position = "relative";
  button.style.overflow = "hidden";
  const rect = button.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "motion-ripple";
  const x = event?.clientX ? event.clientX - rect.left : rect.width / 2;
  const y = event?.clientY ? event.clientY - rect.top : rect.height / 2;
  const size = Math.max(rect.width, rect.height) * 1.8;
  Object.assign(ripple.style, { left:`${x}px`, top:`${y}px`, width:`${size}px`, height:`${size}px` });
  button.appendChild(ripple);
  const a = animateElement(ripple, [
    { transform:"translate(-50%,-50%) scale(0)", opacity:.12 },
    { transform:"translate(-50%,-50%) scale(1)", opacity:0 }
  ], { duration: 500, easing:"ease-out" });
  a?.finished.finally(() => ripple.remove());
  setTimeout(() => ripple.remove(), 650);
}

let calendarDirection = 1;
function animateCalendar() {
  const grid = document.getElementById("calendarGrid");
  if (!grid || reducedMotion) return;
  animateElement(grid, [
    { opacity:.35, transform:`translateX(${calendarDirection * 18}px)` },
    { opacity:1, transform:"translateX(0)" }
  ], { duration:320, easing:"cubic-bezier(.22,.75,.24,1)" });
}

function wireMotion() {
  installMotionStyles();
  requestAnimationFrame(() => {
    document.body.classList.add("motion-ready");
    placeNavPill(true);
    staggerChildren(document.getElementById("notebooksGrid"));
  });

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const notebook = target.closest(".notebook-card");
    if (notebook) morphNotebook(notebook);

    const nav = target.closest(".nav-item");
    if (nav) {
      const buttons = [...document.querySelectorAll(".nav-item")];
      const currentIndex = buttons.findIndex(b => b.classList.contains("active"));
      const nextIndex = buttons.indexOf(nav);
      const direction = nextIndex >= currentIndex ? 1 : -1;
      requestAnimationFrame(() => {
        placeNavPill();
        revealView(activeView(), direction);
      });
    }

    if (target.closest("#calendarPrevMonth")) calendarDirection = -1;
    if (target.closest("#calendarNextMonth")) calendarDirection = 1;

    const button = target.closest("button,.notebook-card,.link-card,.visual-thumb-button");
    if (button) pulseButton(button, event);

    if (target.closest("#notebookBackBtn")) {
      const workspace = document.querySelector(".workspace");
      animateElement(workspace, [
        { transform:"translateX(0)", opacity:1 },
        { transform:"translateX(10px)", opacity:.72 }
      ], { duration:150, easing:"ease-out", direction:"alternate", iterations:2 });
      setTimeout(() => staggerChildren(document.getElementById("notebooksGrid")), 40);
    }

    if (target.closest(".visual-thumb-button")) {
      animateElement(target.closest(".visual-note-card"), [
        { transform:"scale(1)" }, { transform:"scale(.975)" }, { transform:"scale(1.012)" }, { transform:"scale(1)" }
      ], { duration:360, easing:"cubic-bezier(.2,.9,.24,1.08)" });
    }
  }, true);

  const observer = new MutationObserver(records => {
    let navChanged = false;
    let calendarChanged = false;
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target.classList?.contains("nav-item") && record.attributeName === "class") navChanged = true;
        if (record.attributeName === "hidden" && record.target instanceof HTMLElement && !record.target.hidden) {
          revealView(record.target, 1);
          if (record.target.id === "notebooksView") setTimeout(() => staggerChildren(document.getElementById("notebooksGrid")), 20);
        }
        if (record.target instanceof HTMLDialogElement && record.attributeName === "open" && record.target.open) {
          const card = record.target.firstElementChild;
          animateElement(card, [
            { opacity:.2, transform:"translateY(20px) scale(.97)" },
            { opacity:1, transform:"translateY(0) scale(1)" }
          ], { duration:420, easing:"cubic-bezier(.2,.9,.24,1.08)" });
        }
      }
      if (record.type === "childList") {
        const parent = record.target;
        if (parent?.id === "calendarGrid") calendarChanged = true;
        if (["notesList","linksList","visualNotesList","notebooksGrid","dailyPromptsList","tasksList"].includes(parent?.id)) {
          requestAnimationFrame(() => staggerChildren(parent));
        }
      }
    }
    if (navChanged) requestAnimationFrame(() => placeNavPill());
    if (calendarChanged) requestAnimationFrame(animateCalendar);
  });
  observer.observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:["class","hidden","open"] });

  const resize = () => placeNavPill(true);
  window.addEventListener("resize", resize, { passive:true });
  window.visualViewport?.addEventListener("resize", resize, { passive:true });
}

wireMotion();
