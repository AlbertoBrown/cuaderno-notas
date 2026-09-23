const SUPABASE_URL = "https://hafjrfpnmvyvrcyrqglb.supabase.co";
const SUPABASE_KEY = "sb_publishable_2yVzzQ5Jwpqjl1MnAYzqRg_evnyGVyw";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);
const STORAGE_KEY = "cuaderno-notas:v1";

const TYPE_META = {
  incident: { label: "Incidencia", tone: "orange" },
  error: { label: "Error", tone: "blue" },
  note: { label: "Apunte", tone: "green" },
  prompt: { label: "Prompt", tone: "yellow" }
};

const seed = {
  "2026-09-23": {
    prompt: "Analiza los errores de hoy. ¿Qué patrones se repiten en las lecturas de las sondas y qué debería comprobar antes de sacar conclusiones sobre una diferencia de carga?",
    notesHtml: "<b>Resumen del día:</b><br>• Revisar cualquier lectura por debajo de la zona fiable de la sonda.<br>• Separar diferencia real de combustible y error de lectura.<br>• Dejar apuntado depósito, litros antes, litros después y albarán relacionado.",
    conclusions: "No considerar una diferencia como faltante real si el nivel inicial está dentro de una zona de lectura conocida como no fiable.",
    tasks: [
      { id: crypto.randomUUID(), text: "Revisar zona baja de GOA y GOB", done: false },
      { id: crypto.randomUUID(), text: "Relacionar nuevas entradas con albaranes", done: false }
    ],
    items: [
      { id: crypto.randomUUID(), type: "error", title: "Error de sonda en nivel bajo", tag: "GOA / GOB", body: "Por debajo de aproximadamente 1.300 L la lectura puede quedar inflada y falsear la diferencia de carga.", time: "09:15" },
      { id: crypto.randomUUID(), type: "incident", title: "Diferencias de carga", tag: "Control Veeder", body: "Comparar siempre litros detectados frente a litros del albarán y anotar el nivel previo del depósito.", time: "10:30" }
    ]
  },
  "2026-09-22": {
    prompt: "Compara la entrada detectada por Veeder con el albarán y ten en cuenta si el nivel inicial de la sonda está en zona de error.",
    notesHtml: "<b>22/09</b><br>• GOB: nivel inicial 1.477,2 L, entrada detectada 15.721 L, albarán 15.999 L.<br>• GOA: nivel inicial indicado 1.300 L, entrada detectada 15.166 L, albarán 15.999 L.<br>• Revisar si el nivel inicial está afectado por error de sonda.",
    conclusions: "Las diferencias aparentes pueden estar muy condicionadas por la lectura inicial en nivel bajo.",
    tasks: [],
    items: [
      { id: crypto.randomUUID(), type: "incident", title: "Entrada GOB", tag: "6600657", body: "Diferencia aparente: -278 L.", time: "21:18" },
      { id: crypto.randomUUID(), type: "incident", title: "Entrada GOA", tag: "6602106", body: "Diferencia aparente: -833 L; revisar lectura inicial.", time: "21:18" }
    ]
  }
};

let data = loadData();
let selectedDate = toKey(new Date());
if (!data[selectedDate]) selectedDate = "2026-09-23";
let currentFilter = "all";
let searchTerm = "";

const el = id => document.getElementById(id);

function loadData(){
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : structuredClone(seed);
  } catch {
    return structuredClone(seed);
  }
}
function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  el("saveStatus").textContent = "Guardado · " + new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});
}
function toKey(date){
  const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,"0"), d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function fromKey(key){
  const [y,m,d]=key.split("-").map(Number);
  return new Date(y,m-1,d);
}
function ensureDay(key){
  if(!data[key]) data[key]={prompt:"",notesHtml:"",conclusions:"",tasks:[],items:[]};
  return data[key];
}
function formatDate(date, opts){
  return new Intl.DateTimeFormat("es-ES",opts).format(date);
}
function escapeHtml(str=""){
  return str.replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s]));
}

function renderAll(){
  renderDateHeader();
  renderDay();
  renderNotes();
}

function renderDateHeader(){
  const d=fromKey(selectedDate);
  el("selectedDateLabel").textContent=formatDate(d,{day:"2-digit",month:"2-digit",year:"numeric"});
  el("selectedDateSub").textContent=formatDate(d,{weekday:"long",day:"numeric",month:"long"});
  el("dailyTitle").innerHTML=`Cuaderno diario<span>.</span>`;

  const monday=new Date(d);
  const wd=(monday.getDay()+6)%7;
  monday.setDate(monday.getDate()-wd);
  el("weekRow").innerHTML="";
  for(let i=0;i<7;i++){
    const x=new Date(monday); x.setDate(monday.getDate()+i);
    const key=toKey(x), count=data[key]?.items?.length || 0;
    const btn=document.createElement("button");
    btn.className="week-day"+(key===selectedDate?" active":"");
    btn.innerHTML=`<span>${formatDate(x,{weekday:"short"}).replace(".","")}</span><strong>${x.getDate()}</strong><small>${count} nota${count===1?"":"s"}</small>`;
    btn.onclick=()=>{selectedDate=key; renderAll();};
    el("weekRow").appendChild(btn);
  }
}

function renderDay(){
  const day=ensureDay(selectedDate);
  el("promptInput").value=day.prompt||"";
  el("notesEditor").innerHTML=day.notesHtml||"";
  el("conclusionsInput").value=day.conclusions||"";
  renderTasks();
}

function renderNotes(){
  const list=el("notesList");
  list.innerHTML="";
  let entries=[];
  if(searchTerm){
    for(const [date,day] of Object.entries(data)){
      for(const item of day.items||[]){
        const hay=`${item.title} ${item.body} ${item.tag} ${date}`.toLowerCase();
        if(hay.includes(searchTerm)) entries.push({...item,date});
      }
    }
  } else {
    entries=(ensureDay(selectedDate).items||[]).map(x=>({...x,date:selectedDate}));
  }

  if(currentFilter!=="all") entries=entries.filter(x=>x.type===currentFilter);

  entries.sort((a,b)=>(b.time||"").localeCompare(a.time||""));
  if(!entries.length){
    list.innerHTML=`<div class="empty-state">No hay notas que coincidan.<br><small>Usa “Nueva nota” para registrar una incidencia, error o apunte.</small></div>`;
    return;
  }

  entries.forEach((item,index)=>{
    const meta=TYPE_META[item.type]||TYPE_META.note;
    const card=document.createElement("article");
    card.className=`note-card ${meta.tone}`;
    card.innerHTML=`
      <div class="meta"><span>${meta.label}</span><span>${item.time||""}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body||"")}</p>
      <span class="tag">${escapeHtml(item.tag||formatDate(fromKey(item.date),{day:"2-digit",month:"2-digit"}))}</span>
      <button class="delete-note" title="Eliminar">×</button>`;
    card.querySelector(".delete-note").onclick=(e)=>{
      e.stopPropagation();
      if(!confirm("¿Eliminar esta nota?")) return;
      const day=data[item.date];
      day.items=day.items.filter(n=>n.id!==item.id);
      saveData(); renderNotes(); renderDateHeader();
    };
    list.appendChild(card);
  });
}

function renderTasks(){
  const box=el("tasksList");
  box.innerHTML="";
  const tasks=ensureDay(selectedDate).tasks||[];
  tasks.forEach(task=>{
    const row=document.createElement("div");
    row.className="task"+(task.done?" done":"");
    row.innerHTML=`<input type="checkbox" ${task.done?"checked":""}><span>${escapeHtml(task.text)}</span><button>×</button>`;
    row.querySelector("input").onchange=e=>{task.done=e.target.checked;saveData();renderTasks();};
    row.querySelector("button").onclick=()=>{ensureDay(selectedDate).tasks=tasks.filter(t=>t.id!==task.id);saveData();renderTasks();};
    box.appendChild(row);
  });
}

function shiftDay(delta){
  const d=fromKey(selectedDate); d.setDate(d.getDate()+delta); selectedDate=toKey(d); renderAll();
}

el("prevDay").onclick=()=>shiftDay(-1);
el("nextDay").onclick=()=>shiftDay(1);
el("todayBtn").onclick=()=>{selectedDate=toKey(new Date());renderAll();};
el("newNoteBtn").onclick=()=>{el("noteForm").reset();el("noteDialog").showModal();};

el("saveNoteBtn").addEventListener("click",e=>{
  e.preventDefault();
  const title=el("noteTitle").value.trim();
  if(!title){el("noteTitle").focus();return;}
  const now=new Date();
  ensureDay(selectedDate).items.push({
    id:crypto.randomUUID(),
    type:el("noteType").value,
    title,
    tag:el("noteTag").value.trim(),
    body:el("noteBody").value.trim(),
    time:now.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})
  });
  saveData(); el("noteDialog").close(); renderNotes(); renderDateHeader();
});

el("promptInput").addEventListener("input",e=>{ensureDay(selectedDate).prompt=e.target.value;saveData();});
el("notesEditor").addEventListener("input",e=>{ensureDay(selectedDate).notesHtml=e.target.innerHTML;saveData();});
el("conclusionsInput").addEventListener("input",e=>{ensureDay(selectedDate).conclusions=e.target.value;saveData();});

document.querySelectorAll("[data-command]").forEach(btn=>btn.onclick=()=>{
  document.execCommand(btn.dataset.command,false,null);
  el("notesEditor").focus();
  ensureDay(selectedDate).notesHtml=el("notesEditor").innerHTML; saveData();
});
el("clearEditorBtn").onclick=()=>{
  if(confirm("¿Limpiar los apuntes de este día?")){
    el("notesEditor").innerHTML="";ensureDay(selectedDate).notesHtml="";saveData();
  }
};

document.querySelectorAll(".mini-chip").forEach(btn=>btn.onclick=()=>{
  const current=el("promptInput").value.trim();
  el("promptInput").value=current ? current+"\n\n"+btn.dataset.prompt : btn.dataset.prompt;
  ensureDay(selectedDate).prompt=el("promptInput").value;saveData();
});

el("copyPromptBtn").onclick=async()=>{
  await navigator.clipboard.writeText(el("promptInput").value);
  el("copyPromptBtn").textContent="✓";
  setTimeout(()=>el("copyPromptBtn").textContent="⧉",1000);
};

document.querySelectorAll(".filter-chip").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".filter-chip").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  currentFilter=btn.dataset.filter;renderNotes();
});

el("searchInput").addEventListener("input",e=>{searchTerm=e.target.value.trim().toLowerCase();renderNotes();});

el("addTaskBtn").onclick=()=>{
  const input=el("taskInput"), text=input.value.trim(); if(!text)return;
  ensureDay(selectedDate).tasks.push({id:crypto.randomUUID(),text,done:false});
  input.value="";saveData();renderTasks();
};
el("taskInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();el("addTaskBtn").click();}});

document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  const view=btn.dataset.view;
  if(view==="today"){selectedDate=toKey(new Date());if(!data[selectedDate])selectedDate="2026-09-23";currentFilter="all";}
  if(view==="notes") currentFilter="note";
  if(view==="prompts") currentFilter="prompt";
  if(view==="incidents") currentFilter="incident";
  if(view==="days") currentFilter="all";
  document.querySelectorAll(".filter-chip").forEach(x=>x.classList.toggle("active",x.dataset.filter===currentFilter));
  renderAll();
});

el("exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`cuaderno-notas-${toKey(new Date())}.json`;a.click();URL.revokeObjectURL(a.href);
};
el("importBtn").onclick=()=>el("importInput").click();
el("importInput").onchange=async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    data=parsed;saveData();renderAll();
  }catch{alert("No se pudo importar el archivo.");}
  e.target.value="";
};

if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
renderAll();
