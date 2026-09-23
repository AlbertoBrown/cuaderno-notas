const SUPABASE_URL = "https://hafjrfpnmvyvrcyrqglb.supabase.co";
const SUPABASE_KEY = "sb_publishable_2yVzzQ5Jwpqjl1MnAYzqRg_evnyGVyw";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      storage: window.localStorage,
      storageKey: "cuaderno-notas:auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
const STORAGE_KEY = "cuaderno-notas:v1";

const PENDING_DELETES_KEY = "cuaderno-notas:pending-deletes:v1";
let currentUser = null;
let cloudReady = false;
let syncTimers = new Map();
let syncingAll = false;

function saveLocalOnly(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function setCloudState(state, title, subtitle=""){
  const box=el("cloudStatus");
  if(box){
    box.dataset.state=state;
    const strong=box.querySelector("strong"), small=box.querySelector("small");
    if(strong) strong.textContent=title;
    if(small) small.textContent=subtitle;
  }
  if(el("saveStatus")){
    if(state==="sync") el("saveStatus").textContent="Sincronizando…";
    else if(state==="ok") el("saveStatus").textContent="Sincronizado · "+new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});
    else if(state==="error") el("saveStatus").textContent="Guardado local · pendiente de sincronizar";
    else el("saveStatus").textContent="Guardado en este dispositivo";
  }
}
function updateAccountUI(){
  const btn=el("accountBtn");
  if(!btn) return;
  if(currentUser){
    btn.textContent="✓ "+(currentUser.email||"Cuenta");
    btn.title="Pulsa para cerrar sesión";
  }else{
    btn.textContent="Iniciar sesión";
    btn.title="Sincronizar entre dispositivos";
  }
}
function getPendingDeletes(){
  try{return JSON.parse(localStorage.getItem(PENDING_DELETES_KEY)||"[]");}catch{return [];}
}
function setPendingDeletes(ids){
  localStorage.setItem(PENDING_DELETES_KEY,JSON.stringify([...new Set(ids)]));
}
function queueDelete(id){
  const ids=getPendingDeletes();
  if(!ids.includes(id)) ids.push(id);
  setPendingDeletes(ids);
}
async function flushPendingDeletes(){
  if(!currentUser) return;
  const ids=getPendingDeletes();
  if(!ids.length) return;
  const {error}=await supabaseClient.from("cuaderno_notas").delete().in("id",ids).eq("user_id",currentUser.id);
  if(error) throw error;
  setPendingDeletes([]);
}
function noteCreatedAt(dateKey,item){
  if(item.createdAt) return item.createdAt;
  const time=(item.time&&/^\d{2}:\d{2}$/.test(item.time))?item.time:"12:00";
  const d=new Date(dateKey+"T"+time+":00");
  return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();
}
function dayRow(dateKey){
  const day=ensureDay(dateKey);
  return {
    user_id:currentUser.id,
    fecha:dateKey,
    prompt:day.prompt||"",
    apuntes:day.notesHtml||"",
    conclusiones:day.conclusions||"",
    tareas:Array.isArray(day.tasks)?day.tasks:[],
    updated_at:new Date().toISOString()
  };
}
function noteRow(dateKey,item){
  return {
    id:item.id,
    user_id:currentUser.id,
    fecha:dateKey,
    tipo:item.type||"note",
    titulo:item.title||"",
    etiqueta:item.tag||"",
    contenido:item.body||"",
    created_at:noteCreatedAt(dateKey,item),
    updated_at:new Date().toISOString()
  };
}
function scheduleDaySync(dateKey){
  if(!currentUser||!cloudReady) return;
  if(syncTimers.has(dateKey)) clearTimeout(syncTimers.get(dateKey));
  setCloudState("sync","Sincronizando","Guardando cambios");
  syncTimers.set(dateKey,setTimeout(()=>syncDayToCloud(dateKey),650));
}
async function syncDayToCloud(dateKey){
  if(!currentUser||!cloudReady) return;
  try{
    const {error}=await supabaseClient.from("cuaderno_dias").upsert(dayRow(dateKey),{onConflict:"user_id,fecha"});
    if(error) throw error;
    setCloudState("ok","En la nube",currentUser.email||"Sincronizado");
  }catch(error){
    console.error("Error sincronizando día",error);
    const detail=(error&&error.message)?error.message:"Error al guardar";
    setCloudState("error","Error Supabase",detail);
  }
}
async function upsertNoteToCloud(dateKey,item){
  if(!currentUser||!cloudReady) return;
  try{
    const {error}=await supabaseClient.from("cuaderno_notas").upsert(noteRow(dateKey,item),{onConflict:"id"});
    if(error) throw error;
    setCloudState("ok","En la nube",currentUser.email||"Sincronizado");
  }catch(error){
    console.error("Error sincronizando nota",error);
    const detail=(error&&error.message)?error.message:"Error al guardar nota";
    setCloudState("error","Error Supabase",detail);
  }
}
async function syncAllLocalToCloud(){
  if(!currentUser||syncingAll) return;
  syncingAll=true;
  setCloudState("sync","Sincronizando","Subiendo datos locales");
  try{
    await flushPendingDeletes();
    const days=Object.entries(data).map(([dateKey])=>dayRow(dateKey));
    const notes=[];
    for(const [dateKey,day] of Object.entries(data)){
      for(const item of day.items||[]) notes.push(noteRow(dateKey,item));
    }
    if(days.length){
      const {error}=await supabaseClient.from("cuaderno_dias").upsert(days,{onConflict:"user_id,fecha"});
      if(error) throw error;
    }
    if(notes.length){
      const {error}=await supabaseClient.from("cuaderno_notas").upsert(notes,{onConflict:"id"});
      if(error) throw error;
    }
    setCloudState("ok","En la nube",currentUser.email||"Sincronizado");
  }catch(error){
    console.error("Error sincronizando todo",error);
    const detail=(error&&error.message)?error.message:"No se pudo completar la sincronización";
    setCloudState("error","Error Supabase",detail);
  }finally{
    syncingAll=false;
  }
}
async function pullCloudData(){
  if(!currentUser) return;
  setCloudState("sync","Sincronizando","Descargando tus notas");
  try{
    await flushPendingDeletes();
    const [{data:days,error:daysError},{data:notes,error:notesError}]=await Promise.all([
      supabaseClient.from("cuaderno_dias").select("*").eq("user_id",currentUser.id),
      supabaseClient.from("cuaderno_notas").select("*").eq("user_id",currentUser.id).order("created_at",{ascending:true})
    ]);
    if(daysError) throw daysError;
    if(notesError) throw notesError;

    const hasRemote=(days&&days.length)||(notes&&notes.length);
    const hadSavedLocal=!!localStorage.getItem(STORAGE_KEY);

    if(hasRemote){
      const cloud={};
      for(const row of days||[]){
        cloud[row.fecha]={
          prompt:row.prompt||"",
          notesHtml:row.apuntes||"",
          conclusions:row.conclusiones||"",
          tasks:Array.isArray(row.tareas)?row.tareas:[],
          items:[]
        };
      }
      for(const row of notes||[]){
        if(!cloud[row.fecha]) cloud[row.fecha]={prompt:"",notesHtml:"",conclusions:"",tasks:[],items:[]};
        const dt=new Date(row.created_at);
        cloud[row.fecha].items.push({
          id:row.id,
          type:row.tipo||"note",
          title:row.titulo||"",
          tag:row.etiqueta||"",
          body:row.contenido||"",
          time:Number.isNaN(dt.getTime())?"":dt.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}),
          createdAt:row.created_at
        });
      }
      data=cloud;
      saveLocalOnly();
    }else if(hadSavedLocal){
      cloudReady=true;
      await syncAllLocalToCloud();
    }else{
      data={};
      saveLocalOnly();
    }

    cloudReady=true;
    selectedDate=toKey(new Date());
    ensureDay(selectedDate);
    saveLocalOnly();
    renderAll();
    setCloudState("ok","En la nube",currentUser.email||"Sincronizado");
  }catch(error){
    console.error("Error cargando Supabase",error);
    cloudReady=false;
    const detail=(error&&error.message)?error.message:"No se pudo conectar con Supabase";
    setCloudState("error","Error Supabase",detail);
    const msg=el("authMessage");
    if(msg){
      msg.className="auth-message error";
      msg.textContent=detail;
    }
  }
}
async function activateUser(user){
  currentUser=user;
  cloudReady=false;
  updateAccountUI();
  await pullCloudData();
}
function openAuth(message=""){
  const dialog=el("authDialog");
  if(message) el("authMessage").textContent=message;
  if(dialog&&!dialog.open) dialog.showModal();
}
async function initAuth(){
  try{
    setCloudState("sync","Comprobando sesión","Recuperando tu cuenta");
    const {data:sessionData,error}=await supabaseClient.auth.getSession();
    if(error) throw error;

    if(sessionData.session?.user){
      await activateUser(sessionData.session.user);
      return;
    }

    currentUser=null;
    cloudReady=false;
    updateAccountUI();
    setCloudState("local","Inicia sesión","Sincroniza PC ↔ móvil");
    setTimeout(()=>openAuth(),250);
  }catch(error){
    console.error("Error iniciando autenticación",error);
    setCloudState("error","Solo local","No se pudo iniciar Supabase");
  }
}


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
function saveData(syncDate=selectedDate){
  saveLocalOnly();
  if(currentUser&&cloudReady) scheduleDaySync(syncDate);
  else setCloudState("local","Solo local","Inicia sesión para sincronizar");
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
      queueDelete(item.id);
      saveData(item.date);
      flushPendingDeletes().catch(()=>{});
      renderNotes(); renderDateHeader();
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

el("refreshBtn").onclick=async()=>{
  const btn=el("refreshBtn");
  btn.classList.add("is-refreshing");
  const old=btn.innerHTML;
  btn.innerHTML="↻ <span>Actualizando…</span>";
  try{
    if(currentUser){
      if(cloudReady) await syncAllLocalToCloud();
      await pullCloudData();
    }else{
      location.reload();
      return;
    }
  }catch(error){
    console.error("Error al actualizar",error);
    setCloudState("error","Error Supabase",(error&&error.message)||"No se pudo actualizar");
  }finally{
    btn.classList.remove("is-refreshing");
    btn.innerHTML=old;
  }
};
el("newNoteBtn").onclick=()=>{el("noteForm").reset();el("noteDialog").showModal();};

el("saveNoteBtn").addEventListener("click",e=>{
  e.preventDefault();
  const title=el("noteTitle").value.trim();
  if(!title){el("noteTitle").focus();return;}
  const now=new Date();
  const item={
    id:crypto.randomUUID(),
    type:el("noteType").value,
    title,
    tag:el("noteTag").value.trim(),
    body:el("noteBody").value.trim(),
    time:now.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}),
    createdAt:now.toISOString()
  };
  ensureDay(selectedDate).items.push(item);
  saveData();
  upsertNoteToCloud(selectedDate,item);
  el("noteDialog").close(); renderNotes(); renderDateHeader();
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
    if(currentUser&&cloudReady) await syncAllLocalToCloud();
  }catch{alert("No se pudo importar el archivo.");}
  e.target.value="";
};

el("cloudStatus").onclick=()=>{ if(!currentUser) openAuth(); };
el("accountBtn").onclick=async()=>{
  if(currentUser){
    if(!confirm("¿Cerrar sesión de "+(currentUser.email||"esta cuenta")+"?")) return;
    await supabaseClient.auth.signOut();
    currentUser=null; cloudReady=false; updateAccountUI();
    setCloudState("local","Inicia sesión","Sincroniza PC ↔ móvil");
    openAuth();
  }else openAuth();
};
el("authCloseBtn").onclick=()=>el("authDialog").close();
el("authLocalBtn").onclick=()=>el("authDialog").close();
el("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=el("authEmail").value.trim();
  const password=el("authPassword").value;
  const msg=el("authMessage");
  msg.className="auth-message"; msg.textContent="Entrando…";
  const {data:authData,error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){msg.className="auth-message error";msg.textContent=error.message;return;}
  msg.className="auth-message ok";msg.textContent="Sesión iniciada.";
  el("authDialog").close();
  await activateUser(authData.user);
});
el("authSignupBtn").onclick=async()=>{
  const email=el("authEmail").value.trim();
  const password=el("authPassword").value;
  const msg=el("authMessage");
  if(!email||password.length<6){msg.className="auth-message error";msg.textContent="Introduce un email y una contraseña de al menos 6 caracteres.";return;}
  msg.className="auth-message";msg.textContent="Creando cuenta…";
  const {data:authData,error}=await supabaseClient.auth.signUp({email,password});
  if(error){msg.className="auth-message error";msg.textContent=error.message;return;}
  if(authData.session&&authData.user){
    msg.className="auth-message ok";msg.textContent="Cuenta creada.";
    el("authDialog").close();
    await activateUser(authData.user);
  }else{
    msg.className="auth-message ok";msg.textContent="Cuenta creada. Revisa tu correo para confirmar el acceso y después pulsa Entrar.";
  }
};
supabaseClient.auth.onAuthStateChange(async (event, session)=>{
  if(session?.user){
    if(!currentUser || currentUser.id!==session.user.id){
      await activateUser(session.user);
    }else{
      currentUser=session.user;
      updateAccountUI();
      if(cloudReady) setCloudState("ok","En la nube",currentUser.email||"Sincronizado");
    }
  }else if(event==="SIGNED_OUT"){
    currentUser=null;
    cloudReady=false;
    updateAccountUI();
    setCloudState("local","Inicia sesión","Sincroniza PC ↔ móvil");
  }
});

document.addEventListener("visibilitychange",async()=>{
  if(document.visibilityState!=="visible") return;
  try{
    const {data}=await supabaseClient.auth.getSession();
    if(data.session?.user){
      currentUser=data.session.user;
      updateAccountUI();
      if(!cloudReady) await pullCloudData();
    }
  }catch(error){
    console.error("No se pudo recuperar la sesión",error);
  }
});

window.addEventListener("online",()=>{if(currentUser&&cloudReady) syncAllLocalToCloud();});
window.addEventListener("offline",()=>setCloudState("error","Guardado local","Sin conexión"));
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
renderAll();
initAuth();
