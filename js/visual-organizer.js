import { state, allVisualNotes, putNote, nowIso } from "./store.js";
import { pushPending } from "./sync.js";

const GENERAL = "General";
const LAST = "cuaderno-notas:visual-last-category:v1";
const LEGACY = /^Imagen\s*\+\s*prompt(?:\s*·.*)?$/i;
const $ = id => document.getElementById(id);
let editingId = null;

function key(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function cat(n) {
  const v = String(n?.etiqueta || "").trim().replace(/\s+/g," ").slice(0,48);
  return !v || LEGACY.test(v) ? GENERAL : v;
}
function date(n) {
  const v = String(n?.fecha || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : String(n?.createdAt || "").slice(0,10) || key();
}
function norm(v) { return String(v || "").trim().replace(/\s+/g," ").toLowerCase(); }
function fmt(v, year=false) {
  const [y,m,d] = String(v).split("-").map(Number);
  return y ? new Intl.DateTimeFormat("es-ES",{day:"2-digit",month:"short",...(year?{year:"numeric"}:{})}).format(new Date(y,m-1,d)).replace(/\./g,"") : v;
}
function notes() { return allVisualNotes(); }
function cats() {
  const s = new Set([GENERAL]); notes().forEach(n=>s.add(cat(n)));
  return [...s].sort((a,b)=>a===GENERAL?-1:b===GENERAL?1:a.localeCompare(b,"es",{sensitivity:"base"}));
}
function remembered(){ try{return localStorage.getItem(LAST)||GENERAL}catch{return GENERAL} }
function remember(v){ try{localStorage.setItem(LAST,v||GENERAL)}catch{} }
function fill(select, selected, addNew=false){
  if(!select)return; const cur=selected||GENERAL, values=cats(); if(!values.includes(cur))values.push(cur);
  select.replaceChildren(...values.map(v=>new Option(v,v))); if(addNew)select.append(new Option("+ Nueva categoría…","__new__")); select.value=cur;
}

function styles(){
  if($("visualOrganizerStyles"))return;
  const s=document.createElement("style"); s.id="visualOrganizerStyles"; s.textContent=`
  .vo-fields{display:grid;grid-template-columns:1fr .75fr;gap:10px}.vo-stack{display:grid;gap:7px}.vo-help{margin-top:5px;color:#8e877d;font-size:10px;font-weight:650}
  .vo-fields select,.vo-fields input,.vo-filters select,.vo-filters input{height:38px;border:1px solid #dcd5c9;border-radius:12px;background:#fffdf8;color:#29251f;padding:0 11px;font:650 13px system-ui;outline:none}
  .vo-fields select:focus,.vo-fields input:focus,.vo-filters select:focus,.vo-filters input:focus{border-color:#ff9b72;box-shadow:0 0 0 3px rgba(255,126,72,.12)}
  .vo-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 13px;padding:10px 11px;border:1px solid #e1dbcf;border-radius:15px;background:rgba(255,253,248,.72)}
  .vo-filter{display:flex;align-items:center;gap:6px}.vo-filter>span{font-size:10px;font-weight:800;color:#81796f;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
  .vo-reset{height:38px;border:1px solid #ded7ca;border-radius:999px;background:#fffaf1;padding:0 12px;font:750 12px system-ui;color:#6c645b;cursor:pointer}
  .vo-card-meta{display:flex;gap:6px;flex-wrap:wrap;margin:1px 0 7px}.vo-chip{border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;line-height:1.1}.vo-chip.cat{background:#f0eadf;color:#655d53}.vo-chip.date{background:#eef3e8;color:#5c704d}
  #visualNotesList .visual-note-card[hidden]{display:none!important}
  @media(max-width:720px){.vo-fields{grid-template-columns:1fr}.vo-filters{overflow-x:auto;flex-wrap:nowrap}.vo-filter{flex:0 0 auto}.vo-filters select,.vo-filters input{max-width:155px}}
  `; document.head.appendChild(s);
}

function form(){
  if($("visualOrganizerFields"))return;
  const prompt=$("visualPromptInput")?.closest("label"); if(!prompt?.parentElement)return;
  const x=document.createElement("div"); x.id="visualOrganizerFields"; x.className="vo-fields"; x.innerHTML=`
    <label class="visual-field"><span class="visual-label">⌑ Categoría</span><span class="vo-stack"><select id="visualCategorySelect"></select><input id="visualCategoryNew" maxlength="48" placeholder="Nueva categoría" hidden></span><small class="vo-help">Elige una categoría existente o crea una nueva.</small></label>
    <label class="visual-field"><span class="visual-label">◷ Fecha</span><input id="visualNoteDate" type="date"><small class="vo-help">Fecha de organización del apunte.</small></label>`;
  prompt.parentElement.insertBefore(x,prompt); fill($("visualCategorySelect"),remembered(),true); $("visualNoteDate").value=state.selectedDate||key();
  $("visualCategorySelect").onchange=()=>{const n=$("visualCategoryNew"), creating=$("visualCategorySelect").value==="__new__"; n.hidden=!creating; if(creating){n.value="";n.focus()}};
}

function filters(){
  if($("visualLibraryFilters"))return;
  const head=document.querySelector(".visual-library-head"); if(!head)return;
  const x=document.createElement("div"); x.id="visualLibraryFilters"; x.className="vo-filters"; x.innerHTML=`
    <label class="vo-filter"><span>Categoría</span><select id="visualCategoryFilter"></select></label>
    <label class="vo-filter"><span>Fecha</span><select id="visualDateFilter"><option value="all">Todas</option><option value="today">Hoy</option><option value="week">Esta semana</option><option value="month">Este mes</option><option value="exact">Elegir fecha…</option></select><input id="visualDateExact" type="date" hidden></label>
    <button id="visualFiltersReset" class="vo-reset" type="button">Limpiar filtros</button>`;
  head.insertAdjacentElement("afterend",x); $("visualCategoryFilter").onchange=applyFilters; $("visualDateFilter").onchange=()=>{const e=$("visualDateExact");e.hidden=$("visualDateFilter").value!=="exact";if(!e.hidden&&!e.value)e.value=key();applyFilters()}; $("visualDateExact").onchange=applyFilters;
  $("visualFiltersReset").onclick=()=>{$("visualCategoryFilter").value="all";$("visualDateFilter").value="all";$("visualDateExact").hidden=true;$("visualDateExact").value="";applyFilters()};
}

function noteFor(card){
  const id=card.dataset.voId, existing=id&&state.notes.get(id); if(existing&&!existing.deleted)return existing;
  const title=norm(card.querySelector("h3")?.textContent), prompt=norm(card.querySelector(".visual-note-prompt")?.textContent);
  const n=notes().find(x=>norm(x.titulo||"Apunte visual")===title&&norm(x.contenido)===prompt); if(n)card.dataset.voId=n.id; return n||null;
}
function decorate(card){
  const n=noteFor(card); if(!n)return; card.dataset.voId=n.id;
  let row=card.querySelector(".vo-card-meta"); if(!row){row=document.createElement("div");row.className="vo-card-meta";row.innerHTML='<span class="vo-chip cat"></span><span class="vo-chip date"></span>';const body=card.querySelector(".visual-note-body"),h=body?.querySelector("h3");if(body&&h)body.insertBefore(row,h)}
  if(row){const a=row.querySelector(".cat"),b=row.querySelector(".date"),av=cat(n),bv=fmt(date(n),true);if(a.textContent!==av)a.textContent=av;if(b.textContent!==bv)b.textContent=bv}
}
function refreshOptions(){
  const s=$("visualCategoryFilter"); if(!s)return; const cur=s.value||"all"; s.replaceChildren(new Option("Todas","all"),...cats().map(v=>new Option(v,v))); s.value=[...s.options].some(o=>o.value===cur)?cur:"all";
}
function week(){const d=new Date(),a=new Date(d.getFullYear(),d.getMonth(),d.getDate());a.setDate(a.getDate()-((a.getDay()+6)%7));const b=new Date(a);b.setDate(b.getDate()+6);return[key(a),key(b)]}
function dateMatch(v,mode,exact){if(mode==="all")return true;if(mode==="today")return v===key();if(mode==="month")return v.slice(0,7)===key().slice(0,7);if(mode==="week"){const[a,b]=week();return v>=a&&v<=b}return mode==="exact"?Boolean(exact)&&v===exact:true}
function applyFilters(){
  const c=$("visualCategoryFilter")?.value||"all",mode=$("visualDateFilter")?.value||"all",exact=$("visualDateExact")?.value||"";let total=0,visible=0;
  document.querySelectorAll("#visualNotesList .visual-note-card").forEach(card=>{const n=noteFor(card);if(!n)return;total++;const show=(c==="all"||cat(n)===c)&&dateMatch(date(n),mode,exact);card.hidden=!show;if(show)visible++});
  const count=$("visualLibraryCount");if(count)count.textContent=(c!=="all"||mode!=="all")?`${visible} de ${total} apuntes`:`${total} apunte${total===1?"":"s"} guardado${total===1?"":"s"}`;
}
function refresh(){document.querySelectorAll("#visualNotesList .visual-note-card").forEach(decorate);refreshOptions();applyFilters()}
function setForm(n=null){form();fill($("visualCategorySelect"),n?cat(n):remembered(),true);$("visualCategoryNew").hidden=true;$("visualCategoryNew").value="";$("visualNoteDate").value=n?date(n):(state.selectedDate||key())}
function chosen(){if($("visualCategorySelect")?.value!=="__new__")return $("visualCategorySelect")?.value||GENERAL;return String($("visualCategoryNew")?.value||"").trim().replace(/\s+/g," ").slice(0,48)}

async function waitSaved(edit,before,old,title,prompt){
  const start=Date.now();while(Date.now()-start<10000){let n;if(edit){const x=state.notes.get(edit);if(x&&x.updatedAt!==old)n=x}else n=notes().find(x=>!before.has(x.id)&&norm(x.titulo||"Apunte visual")===norm(title)&&norm(x.contenido)===norm(prompt));if(n&&!$("visualSaveBtn")?.disabled)return n;await new Promise(r=>setTimeout(r,80))}return null;
}
async function persist(n,c,d){
  const current=state.notes.get(n.id)||n;await putNote({...current,fecha:d,etiqueta:c||GENERAL,updatedAt:nowIso(),syncStatus:"pending",syncError:null});remember(c||GENERAL);
  if(state.user&&navigator.onLine){try{await pushPending()}catch(e){console.warn("Categoría/fecha pendientes de sincronizar",e)}}
  editingId=null;setForm();refresh();
}
function bind(){
  const list=$("visualNotesList");if(list&&!list.dataset.voBound){list.dataset.voBound="1";list.addEventListener("click",e=>{const card=e.target.closest(".visual-note-card"),n=card&&noteFor(card);if(n&&e.target.closest(".edit-visual")){editingId=n.id;queueMicrotask(()=>setForm(n))}},true)}
  const cancel=$("visualCancelEditBtn");if(cancel&&!cancel.dataset.voBound){cancel.dataset.voBound="1";cancel.addEventListener("click",()=>{editingId=null;setTimeout(()=>setForm(),0)})}
  const save=$("visualSaveBtn");if(save&&!save.dataset.voBound){save.dataset.voBound="1";save.addEventListener("click",e=>{const c=chosen();if($("visualCategorySelect")?.value==="__new__"&&!c){e.preventDefault();e.stopImmediatePropagation();$("visualCategoryNew")?.focus();return}const d=$("visualNoteDate")?.value||state.selectedDate||key(),title=$("visualTitleInput")?.value.trim()||"Apunte visual",prompt=$("visualPromptInput")?.value.trim()||"",edit=editingId,old=edit?state.notes.get(edit)?.updatedAt:null,before=new Set(notes().map(n=>n.id));setTimeout(async()=>{const n=await waitSaved(edit,before,old,title,prompt);if(n)await persist(n,c||GENERAL,d)},0)},true)}
}
function init(){
  if(window.__cuadernoVisualOrganizerV2)return;window.__cuadernoVisualOrganizerV2=true;styles();form();filters();bind();setForm();refresh();
  const list=$("visualNotesList");if(list)new MutationObserver(refresh).observe(list,{childList:true});
  const view=$("visualNotesView");if(view)new MutationObserver(()=>{if(!view.hidden){bind();if(!editingId)setForm();refresh()}}).observe(view,{attributes:true,attributeFilter:["hidden"]});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
