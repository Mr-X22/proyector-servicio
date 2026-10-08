// app.js v3 — LiteWorship
const channel = new BroadcastChannel('proyector-sync');
let projectorWindow = null;
let projTheme = 'dark';
let projFont = "'Space Grotesk',sans-serif";
let projSize = '5.2vw';
let _videoPlaying = true;

const state = {
  section: 'canciones',
  selectedId: null,
  currentList: null,
  liveRef: null,
  audio: { dirHandle:null, files:[], currentIndex:-1, el:new Audio(), scrubbing:false },
};

// ── UTILS ──
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.getElementById('toastRoot').appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
function el(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── BOOT ──
async function boot() {
  if (!storage.supported) {
    document.getElementById('editor').innerHTML='<div class="editor-empty"><p>Usa Chrome actualizado.</p></div>';
    return;
  }
  const status = await storage.restore();
  if (status===true) {
    const exists = await storage.folderExists();
    if (!exists) { showFolderGate('deleted'); return; }
    afterDataReady();
  } else if (status==='needs-permission') {
    showFolderGate('needs-permission');
  } else {
    showFolderGate('new');
  }
}

function showFolderGate(mode) {
  let overlay = document.getElementById('folderOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'folderOverlay';
    overlay.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:999;background:var(--bg);';
    document.body.appendChild(overlay);
  }
  const msgs = {
    new: { icon:'📁', title:'Bienvenido a LiteWorship', body:'Para empezar, elige o crea la carpeta donde se guardarán tus datos.', btn:'Elegir mi carpeta de datos' },
    'needs-permission': { icon:'🔑', title:'Un momento antes de continuar', body:'Chrome necesita confirmar el acceso a tu carpeta de datos. Solo toma un clic.', btn:'Conceder acceso' },
    deleted: { icon:'📂', title:'No encontramos tu carpeta de datos', body:'La carpeta fue borrada o movida. Elige una nueva para continuar.', btn:'Elegir carpeta de datos' },
  };
  const m = msgs[mode];
  overlay.innerHTML=`
    <div style="max-width:420px;width:90%;text-align:center;padding:20px;">
      <div style="width:68px;height:68px;border-radius:16px;background:linear-gradient(145deg,#E8AA4C,#b8821c);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-weight:800;color:#1a1005;font-size:30px;box-shadow:0 6px 20px rgba(232,170,76,.3);">P</div>
      <h2 style="margin:0 0 8px;font-size:22px;color:var(--text);">${m.title}</h2>
      <p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin:0 0 24px;">${m.body}</p>
      <button class="btn btn-primary" id="btnChooseFolder" style="width:100%;padding:13px;font-size:14px;border-radius:10px;">📁  ${m.btn}</button>
      ${mode==='new'?'<p style="margin-top:14px;font-size:11px;color:var(--text-faint);">Esta configuración solo se hace una vez.</p>':''}
    </div>`;
  document.getElementById('btnChooseFolder').onclick = async ()=>{
    try {
      if (mode==='needs-permission') { const ok=await storage.requestPermission(); if(!ok)return; }
      else { await storage.chooseFolder(); }
      overlay.remove();
      renderListSelect(); renderTimeline();
      afterDataReady();
    } catch(e){}
  };
}

function afterDataReady() {
  renderLibrary(); renderEditorEmpty(); renderListSelect(); renderTimeline();
  const room = getRemoteRoom();
  connectRemoteWS(room, handleRemoteMessage);
}

async function ensureDataFolder() {
  if (storage.dirHandle) return true;
  try {
    await storage.chooseFolder();
    renderListSelect(); renderTimeline();
    return true;
  } catch(e) { toast('Necesitas elegir una carpeta de datos.'); return false; }
}

// ── SECCIONES / RAIL ──
document.querySelectorAll('.rail-btn[data-section]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.rail-btn[data-section]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const prevSection = state.section;
    state.section = btn.dataset.section;
    state.selectedId = null;
    // Restaurar columna de biblioteca si venimos de Biblia
    document.querySelector('.library').style.display='';
    document.getElementById('editor').style.gridColumn='';
    // Si veníamos de Biblia y el panel de "Proyección" fue reemplazado por el de versículos, restaurarlo
    if (prevSection==='biblia' && state.section!=='biblia') restoreProjectionPanel();
    if (state.section==='audio') renderAudioSection();
    else if (state.section==='biblia') renderBibleSection();
    else { renderLibrary(); renderEditorEmpty(); }
  });
});

// ── LIBRARY ──
function renderLibrary() {
  const META = {
    canciones:{title:'Letras',addLabel:'+ Agregar letra'},
    anuncios:{title:'Anuncios',addLabel:'+ Agregar anuncio'},
    citas:{title:'Citas bíblicas',addLabel:'+ Agregar cita'},
    videos:{title:'Videos',addLabel:'+ Agregar video'},
    presentaciones:{title:'Presentaciones',addLabel:'+ Importar presentación'},
  };
  const meta = META[state.section];
  if (!meta) return;
  document.getElementById('libTitle').textContent = meta.title;
  const items = storage.list(state.section);
  document.getElementById('libCount').textContent = items.length;
  document.getElementById('btnAdd').textContent = meta.addLabel;

  const query = document.getElementById('libSearch').value.trim().toLowerCase();
  const filtered = items.filter(i=>(i.title||i.reference||'').toLowerCase().includes(query));
  const list = document.getElementById('libList');
  list.innerHTML='';
  if (!filtered.length) { list.appendChild(el(`<div class="lib-empty">${items.length?'Sin resultados.':'Todavía no hay elementos. Agrega el primero.'}</div>`)); return; }

  filtered.forEach(item=>{
    const title = item.title||item.reference;
    const sub = state.section==='canciones'
      ? (item.author||'Sin autor')+` · ${item.slides?item.slides.length:0} diap.`
      : state.section==='anuncios' ? (item.type==='image'?'Imagen':'Texto')
      : state.section==='videos' ? (item.fileName||'Video')
      : state.section==='presentaciones' ? `${item.sourceType==='pptx'?'PowerPoint':item.sourceType==='images'?'Imágenes':'PDF'} · ${item.slides?item.slides.length:0} diap.`
      : 'Cita bíblica';
    const row = el(`
      <div class="lib-item ${state.selectedId===item.id?'selected':''}">
        <div class="lib-item-row">
          <div><div class="t-title">${esc(title)}</div><div class="t-sub">${esc(sub)}</div></div>
          <div class="lib-item-actions">
            <button class="icon-btn" data-act="project" title="Proyectar">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg>
            </button>
            <button class="icon-btn danger" data-act="delete" title="Eliminar">✕</button>
          </div>
        </div>
      </div>`);
    row.addEventListener('click',e=>{
      if (e.target.closest('[data-act="delete"]')) { deleteItem(item.id); return; }
      if (e.target.closest('[data-act="project"]')) { projectItem(state.section,item,0); return; }
      state.selectedId = item.id;
      openEditorFor(item);
    });
    list.appendChild(row);
  });
}
document.getElementById('libSearch').addEventListener('input',()=>{ if(!['audio','biblia'].includes(state.section)) renderLibrary(); });

document.getElementById('btnAdd').addEventListener('click',async()=>{
  if (state.section==='audio') { await chooseAudioFolder(); return; }
  if (!(await ensureDataFolder())) return;
  openEditorFor(null);
});

async function deleteItem(id) {
  if (!confirm('¿Eliminar este elemento?')) return;
  if (state.section==='videos') await storage.removeFileHandle('videos', id);
  await storage.remove(state.section, id);
  if (state.selectedId===id) { state.selectedId=null; renderEditorEmpty(); }
  renderLibrary();
}

function renderEditorEmpty() {
  document.getElementById('editor').innerHTML=`
    <div class="editor-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p>Selecciona un elemento o agrega uno nuevo.</p>
    </div>`;
}

function openEditorFor(item) {
  if (state.section==='canciones') renderSongEditor(item);
  else if (state.section==='anuncios') renderAnnouncementEditor(item);
  else if (state.section==='citas') renderVerseEditor(item);
  else if (state.section==='videos') renderVideoEditor(item);
  else if (state.section==='presentaciones') renderPresentationEditor(item);
}

// ── EDITOR CANCIONES (con slide cards) ──
function renderSongEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id:uid(), title:'', author:'', slides:[''] };
  const editor = document.getElementById('editor');
  editor.innerHTML=`
    <div class="editor-toolbar">
      <h2>${isNew?'Nueva letra':'Editar letra'}</h2>
      <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
    </div>
    <div class="field-row split">
      <div><label class="field-label">Título</label><input class="field-input" id="songTitle" value="${esc(draft.title)}" placeholder="Nombre de la canción"/></div>
      <div><label class="field-label">Autor</label><input class="field-input" id="songAuthor" value="${esc(draft.author)}" placeholder="Autor / intérprete"/></div>
    </div>
    <label class="field-label">Diapositivas — arrastra para reordenar</label>
    <p class="hint" style="margin-bottom:10px;">Cada tarjeta es una diapositiva. Haz clic en ella para editar el texto. La primera diapositiva (título) se genera automáticamente.</p>
    <div class="slides-grid" id="slidesGrid"></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveSong">Guardar letra</button>
      ${!isNew?'<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>':''}
    </div>`;

  document.getElementById('songTitle').addEventListener('input',e=>draft.title=e.target.value);
  document.getElementById('songAuthor').addEventListener('input',e=>draft.author=e.target.value);
  document.getElementById('btnCancelEdit').addEventListener('click',()=>item?openEditorFor(item):renderEditorEmpty());

  function renderSlideCards() {
    const grid = document.getElementById('slidesGrid');
    if (!grid) return;
    grid.innerHTML='';
    draft.slides.forEach((text,i)=>{
      const bg = projTheme==='light' ? 'light-bg' : 'dark-bg';
      const card = el(`
        <div class="slide-card" draggable="true" data-i="${i}">
          <div class="slide-card-preview ${bg}">
            <div class="slide-card-text">${esc(text)||'<span style="opacity:.35">Vacía</span>'}</div>
          </div>
          <div class="slide-card-footer">
            <span class="slide-card-num">DIAP. ${i+1}</span>
            <div class="slide-card-actions">
              <span class="slide-card-drag">⠿</span>
              <button class="icon-btn danger" title="Eliminar">✕</button>
            </div>
          </div>
        </div>`);
      card.querySelector('.icon-btn').addEventListener('click',()=>{
        if (draft.slides.length<=1){ toast('Debe quedar al menos una diapositiva.'); return; }
        draft.slides.splice(i,1); renderSlideCards();
      });
      card.querySelector('.slide-card-preview').addEventListener('click',()=>openSlideEdit(i));
      card.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);card.style.opacity='.4';});
      card.addEventListener('dragend',()=>card.style.opacity='1');
      card.addEventListener('dragover',e=>e.preventDefault());
      card.addEventListener('drop',e=>{
        e.preventDefault();
        const from=parseInt(e.dataTransfer.getData('text/plain'));
        if(from===i)return;
        const [moved]=draft.slides.splice(from,1);
        draft.slides.splice(i,0,moved);
        renderSlideCards();
      });
      grid.appendChild(card);
    });
    // Botón agregar
    const addCard = el(`
      <button class="slide-add-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
        Agregar diapositiva
      </button>`);
    addCard.addEventListener('click',()=>{ draft.slides.push(''); renderSlideCards(); });
    grid.appendChild(addCard);
  }

  function openSlideEdit(i) {
    const existing = document.getElementById('slideEditOverlay');
    if (existing) existing.remove();
    const overlay = el(`
      <div class="slide-edit-overlay" id="slideEditOverlay">
        <div class="slide-edit-box">
          <h4>Editar diapositiva ${i+1}</h4>
          <textarea class="field-input" id="slideEditText" rows="5" placeholder="Texto de esta diapositiva...">${esc(draft.slides[i])}</textarea>
          <div class="slide-edit-actions">
            <button class="btn btn-ghost btn-sm" id="slideEditCancel">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="slideEditSave">Guardar</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(overlay);
    document.getElementById('slideEditText').focus();
    document.getElementById('slideEditCancel').addEventListener('click',()=>overlay.remove());
    document.getElementById('slideEditSave').addEventListener('click',()=>{
      draft.slides[i]=document.getElementById('slideEditText').value;
      overlay.remove(); renderSlideCards();
    });
    overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });
  }

  renderSlideCards();

  document.getElementById('btnSaveSong').addEventListener('click',async()=>{
    if (!draft.title.trim()){ toast('Ponle un título a la canción.'); return; }
    draft.slides = draft.slides.filter(s=>s.trim()||draft.slides.length===1);
    try {
      await storage.save('canciones',draft);
      toast('Letra guardada.');
      state.selectedId=draft.id;
      renderLibrary(); renderSongEditor(draft);
    } catch(e){ toast(e.message); }
  });
  const pf=document.getElementById('btnProjectFromEditor');
  if(pf) pf.addEventListener('click',()=>projectItem('canciones',draft,0));
}

// ── EDITOR ANUNCIOS ──
function renderAnnouncementEditor(item) {
  const isNew=!item;
  const draft=item?JSON.parse(JSON.stringify(item)):{id:uid(),title:'',type:'text',text:'',imageData:''};
  const editor=document.getElementById('editor');
  editor.innerHTML=`
    <div class="editor-toolbar">
      <h2>${isNew?'Nuevo anuncio':'Editar anuncio'}</h2>
      <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
    </div>
    <div class="field-row"><label class="field-label">Título (referencia interna)</label><input class="field-input" id="annTitle" value="${esc(draft.title)}" placeholder="Ej: Reunión de jóvenes..."/></div>
    <div class="toggle-group" id="annToggle">
      <div class="toggle-opt ${draft.type==='text'?'active':''}" data-t="text">Texto</div>
      <div class="toggle-opt ${draft.type==='image'?'active':''}" data-t="image">Imagen</div>
    </div>
    <div id="annBody"></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveAnn">Guardar anuncio</button>
      ${!isNew?'<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>':''}
    </div>`;

  function renderBody(){
    const body=document.getElementById('annBody');
    if(draft.type==='text'){
      body.innerHTML='';
      const ta=el(`<textarea class="field-input" rows="8" placeholder="Texto del anuncio...">${esc(draft.text)}</textarea>`);
      ta.addEventListener('input',e=>draft.text=e.target.value);
      body.appendChild(ta);
    } else {
      body.innerHTML='';
      const zone=el(`<div class="drop-zone">Haz clic para elegir imagen<br><span style="font-size:11px;">JPG o PNG</span></div>`);
      const input=el(`<input type="file" accept="image/*" style="display:none;"/>`);
      zone.appendChild(input);
      zone.addEventListener('click',()=>input.click());
      input.addEventListener('change',()=>{
        const f=input.files[0]; if(!f)return;
        const r=new FileReader();
        r.onload=()=>{ draft.imageData=r.result; renderBody(); };
        r.readAsDataURL(f);
      });
      body.appendChild(zone);
      if(draft.imageData) body.appendChild(el(`<img class="img-preview" src="${draft.imageData}"/>`));
    }
  }
  renderBody();
  document.getElementById('annTitle').addEventListener('input',e=>draft.title=e.target.value);
  document.querySelectorAll('#annToggle .toggle-opt').forEach(o=>{
    o.addEventListener('click',()=>{ draft.type=o.dataset.t; document.querySelectorAll('#annToggle .toggle-opt').forEach(x=>x.classList.toggle('active',x===o)); renderBody(); });
  });
  document.getElementById('btnCancelEdit').addEventListener('click',()=>item?openEditorFor(item):renderEditorEmpty());
  document.getElementById('btnSaveAnn').addEventListener('click',async()=>{
    if(!draft.title.trim()){ toast('Ponle un título al anuncio.'); return; }
    if(draft.type==='text'&&!draft.text.trim()){ toast('Escribe el texto del anuncio.'); return; }
    if(draft.type==='image'&&!draft.imageData){ toast('Elige una imagen.'); return; }
    try{ await storage.save('anuncios',draft); toast('Anuncio guardado.'); state.selectedId=draft.id; renderLibrary(); renderAnnouncementEditor(draft); }
    catch(e){ toast(e.message); }
  });
  const pf=document.getElementById('btnProjectFromEditor');
  if(pf) pf.addEventListener('click',()=>projectItem('anuncios',draft,0));
}

// ── EDITOR CITAS ──
function renderVerseEditor(item) {
  const isNew=!item;
  const draft=item?JSON.parse(JSON.stringify(item)):{id:uid(),reference:'',text:''};
  document.getElementById('editor').innerHTML=`
    <div class="editor-toolbar"><h2>${isNew?'Nueva cita bíblica':'Editar cita'}</h2><button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button></div>
    <div class="field-row"><label class="field-label">Referencia</label><input class="field-input" id="verseRef" value="${esc(draft.reference)}" placeholder="Ej: Juan 3:16"/></div>
    <div class="field-row"><label class="field-label">Texto del versículo</label><textarea class="field-input" id="verseText" rows="6" placeholder="Escribe el texto...">${esc(draft.text)}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveVerse">Guardar cita</button>
      ${!isNew?'<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>':''}
    </div>`;
  document.getElementById('verseRef').addEventListener('input',e=>draft.reference=e.target.value);
  document.getElementById('verseText').addEventListener('input',e=>draft.text=e.target.value);
  document.getElementById('btnCancelEdit').addEventListener('click',()=>item?openEditorFor(item):renderEditorEmpty());
  document.getElementById('btnSaveVerse').addEventListener('click',async()=>{
    if(!draft.reference.trim()){ toast('Ponle una referencia a la cita.'); return; }
    try{ await storage.save('citas',draft); toast('Cita guardada.'); state.selectedId=draft.id; renderLibrary(); renderVerseEditor(draft); }
    catch(e){ toast(e.message); }
  });
  const pf=document.getElementById('btnProjectFromEditor');
  if(pf) pf.addEventListener('click',()=>projectItem('citas',draft,0));
}

// ── EDITOR VIDEO ──
// Los videos no se guardan dentro del JSON (serían enormes); solo se guarda una
// referencia {id, title, fileName} y el FileSystemFileHandle real se persiste
// aparte en IndexedDB (ver storage.saveFileHandle). Así, el video se vuelve a
// pedir permiso de lectura la próxima vez, pero no hay que volver a elegirlo.
const VIDEO_EXTS = /\.(mp4|webm|mov|m4v|ogv|avi|mkv|wmv)$/i;

function checkVideoPlayability(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = ok => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(ok); };
    v.addEventListener('loadedmetadata', () => finish(true));
    v.addEventListener('error', () => finish(false));
    v.preload = 'metadata';
    v.src = url;
    setTimeout(() => finish(null), 4000); // null = no se pudo determinar a tiempo
  });
}

function renderVideoEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), title: '', fileName: '' };
  let pickedFile = null; // File recién elegido en esta sesión de edición (si se cambia/agrega)
  const editor = document.getElementById('editor');

  function paint(statusHTML) {
    editor.innerHTML = `
      <div class="editor-toolbar">
        <h2>${isNew ? 'Nuevo video' : 'Editar video'}</h2>
        <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
      </div>
      <div class="field-row"><label class="field-label">Título</label><input class="field-input" id="videoTitle" value="${esc(draft.title)}" placeholder="Ej: Video aniversario 2026"/></div>
      <label class="field-label">Archivo de video</label>
      <p class="hint" style="margin-bottom:10px;">Recomendado: <b>MP4 (H.264)</b> o <b>WebM</b> — son los únicos formatos que Chrome garantiza reproducir. Otros formatos (MOV, AVI, MKV, WMV) pueden no funcionar según cómo estén codificados.</p>
      <div class="drop-zone" id="videoDropZone">${draft.fileName ? `Archivo actual: <b>${esc(draft.fileName)}</b><br><span style="font-size:11px;">Haz clic para reemplazarlo</span>` : 'Haz clic para elegir un archivo de video'}</div>
      ${statusHTML || ''}
      <div class="btn-row">
        <button class="btn btn-primary" id="btnSaveVideo">Guardar video</button>
        ${!isNew ? '<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>' : ''}
      </div>`;

    document.getElementById('videoTitle').addEventListener('input', e => draft.title = e.target.value);
    document.getElementById('btnCancelEdit').addEventListener('click', () => item ? openEditorFor(item) : renderEditorEmpty());

    document.getElementById('videoDropZone').addEventListener('click', async () => {
      if (!('showOpenFilePicker' in window)) { toast('Tu navegador no soporta elegir archivos de esta forma. Usa Chrome actualizado.'); return; }
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.avi', '.mkv', '.wmv'] } }],
        });
        const file = await handle.getFile();
        pickedFile = { handle, file };
        if (!draft.title.trim()) draft.title = file.name.replace(/\.[^.]+$/, '');
        draft.fileName = file.name;
        paint('<p class="hint">Comprobando el formato...</p>');
        const ok = await checkVideoPlayability(file);
        const msg = ok === true
          ? '<p class="hint" style="color:#7fd88f;">✅ Este archivo se reproduce correctamente en el navegador.</p>'
          : ok === false
          ? '<p class="hint" style="color:#e88;">⚠️ Este formato probablemente NO se reproduzca. Te recomendamos convertirlo a MP4 (H.264) antes de usarlo en el culto.</p>'
          : '<p class="hint">No se pudo confirmar el formato a tiempo; probá proyectarlo con anticipación para asegurarte.</p>';
        paint(msg);
      } catch (e) { /* el usuario canceló el selector de archivos */ }
    });

    document.getElementById('btnSaveVideo').addEventListener('click', async () => {
      if (!draft.title.trim()) { toast('Ponle un título al video.'); return; }
      if (!draft.fileName) { toast('Elige un archivo de video.'); return; }
      if (!(await ensureDataFolder())) return;
      try {
        if (pickedFile) await storage.saveFileHandle('videos', draft.id, pickedFile.handle);
        await storage.save('videos', draft);
        toast('Video guardado.');
        state.selectedId = draft.id;
        renderLibrary();
        renderVideoEditor(draft);
      } catch (e) { toast(e.message); }
    });
    const pf = document.getElementById('btnProjectFromEditor');
    if (pf) pf.addEventListener('click', () => projectItem('videos', draft, 0));
  }
  paint();
}

async function projectVideo(item) {
  const handle = await storage.getFileHandle('videos', item.id);
  if (!handle) { toast('No se encontró el archivo de este video. Ábrelo y vuelve a elegirlo.'); return; }
  let perm = await handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') { toast('Se necesita permiso para leer el archivo de video.'); return; }
  let file;
  try { file = await handle.getFile(); } catch (e) { toast('No se pudo abrir el archivo. Puede que se haya movido o borrado.'); return; }
  state.liveRef = { collection: 'videos', id: item.id, slideIndex: 0, snapshot: item };
  _videoPlaying = true;
  channel.postMessage({ type: 'content', payload: { kind: 'video', file, name: file.name } });
  publishRemoteState(); updateMobileProjBar();
  renderPreview(); updateLiveBadge(true); highlightTimelineLive();
}

// ── EDITOR PRESENTACIONES (PDF / PowerPoint experimental / imágenes) ──
function loadImageEl(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', cy = y, lines = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy); line = word; cy += lineHeight; lines++;
      if (maxLines && lines >= maxLines) { line=''; break; }
    } else line = test;
  }
  if (line) ctx.fillText(line, x, cy);
}

async function importPDFAsSlides(file, onProgress) {
  if (typeof pdfjsLib === 'undefined') throw new Error('No se pudo cargar el lector de PDF (revisa tu conexión a internet).');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const slides = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(`Procesando página ${i} de ${pdf.numPages}...`);
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = 1280 / base.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    slides.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  return slides;
}

async function importImagesAsSlides(files) {
  const slides = [];
  for (const f of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(f);
    });
    slides.push(dataUrl);
  }
  return slides;
}

// Renderizador experimental de .pptx: descomprime el archivo (es un .zip) y
// dibuja, diapositiva por diapositiva, las imágenes y cajas de texto en un
// canvas. No replica animaciones, transiciones, gráficos ni fuentes exactas —
// pero cubre bien el caso típico (texto + fotos + fondo de color).
async function importPPTXAsSlides(file, onProgress) {
  if (typeof JSZip === 'undefined') throw new Error('No se pudo cargar el lector de PowerPoint (revisa tu conexión a internet).');
  const zip = await JSZip.loadAsync(file);

  let sldW = 12192000, sldH = 6858000; // 16:9 por defecto, en EMU
  try {
    const presXml = await zip.file('ppt/presentation.xml').async('text');
    const presDoc = new DOMParser().parseFromString(presXml, 'application/xml');
    const sz = presDoc.getElementsByTagName('p:sldSz')[0];
    if (sz) { sldW = +sz.getAttribute('cx'); sldH = +sz.getAttribute('cy'); }
  } catch (e) {}

  let slideFiles = [];
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels').async('text');
    const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    const relMap = {};
    Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const presXml = await zip.file('ppt/presentation.xml').async('text');
    const presDoc = new DOMParser().parseFromString(presXml, 'application/xml');
    const ids = Array.from(presDoc.getElementsByTagName('p:sldId')).map(n => n.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id') || n.getAttribute('r:id'));
    slideFiles = ids.map(id => relMap[id]).filter(Boolean).map(p => 'ppt/' + p.replace(/^\.?\/?/, ''));
  } catch (e) {}
  if (!slideFiles.length) {
    const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    names.sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
    slideFiles = names;
  }
  if (!slideFiles.length) throw new Error('No se encontraron diapositivas dentro del archivo .pptx.');

  const CANVAS_W = 1280, CANVAS_H = Math.max(1, Math.round(1280 * sldH / sldW));
  const scaleX = CANVAS_W / sldW, scaleY = CANVAS_H / sldH;
  const slides = [];
  let n = 0;
  for (const slidePath of slideFiles) {
    n++;
    if (onProgress) onProgress(`Interpretando diapositiva ${n} de ${slideFiles.length}...`);
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    try {
      const slideXmlText = await zip.file(slidePath).async('text');
      const doc = new DOMParser().parseFromString(slideXmlText, 'application/xml');

      const bgNode = doc.getElementsByTagName('p:bg')[0];
      if (bgNode) {
        const srgb = bgNode.getElementsByTagName('a:srgbClr')[0];
        if (srgb) { ctx.fillStyle = '#' + srgb.getAttribute('val'); ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
      }

      const relsPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
      let imgRelMap = {};
      const relsFile = zip.file(relsPath);
      if (relsFile) {
        const relsDoc = new DOMParser().parseFromString(await relsFile.async('text'), 'application/xml');
        Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(r => { imgRelMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
      }

      const spTree = doc.getElementsByTagName('p:spTree')[0];
      const orderedNodes = spTree ? Array.from(spTree.childNodes).filter(n2 => n2.tagName === 'p:sp' || n2.tagName === 'p:pic') : [];

      for (const node of orderedNodes) {
        const xfrm = node.getElementsByTagName('a:xfrm')[0];
        let x = 0, y = 0, w = CANVAS_W, h = 100;
        if (xfrm) {
          const off = xfrm.getElementsByTagName('a:off')[0];
          const ext = xfrm.getElementsByTagName('a:ext')[0];
          if (off) { x = (+off.getAttribute('x')) * scaleX; y = (+off.getAttribute('y')) * scaleY; }
          if (ext) { w = (+ext.getAttribute('cx')) * scaleX; h = (+ext.getAttribute('cy')) * scaleY; }
        }
        if (node.tagName === 'p:pic') {
          try {
            const blip = node.getElementsByTagName('a:blip')[0];
            const rId = blip && (blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed') || blip.getAttribute('r:embed'));
            const target = rId && imgRelMap[rId];
            if (target) {
              const mediaPath = 'ppt/' + target.replace(/^\.?\.?\//, '').replace(/^slides\//, '');
              const mf = zip.file(mediaPath) || zip.file('ppt/media/' + target.split('/').pop());
              if (mf) {
                const base64 = await mf.async('base64');
                const ext2 = mediaPath.split('.').pop().toLowerCase();
                const mime = ext2 === 'png' ? 'image/png' : ext2 === 'gif' ? 'image/gif' : (ext2==='emf'||ext2==='wmf') ? null : 'image/jpeg';
                if (mime) { const img = await loadImageEl(`data:${mime};base64,${base64}`); ctx.drawImage(img, x, y, w, h); }
              }
            }
          } catch (e) { /* imagen individual ilegible: se omite, no se aborta la diapositiva */ }
        } else {
          const paragraphs = Array.from(node.getElementsByTagName('a:p'));
          let cy = y + 6;
          for (const p of paragraphs) {
            const runs = Array.from(p.getElementsByTagName('a:r'));
            const text = runs.map(r => (r.getElementsByTagName('a:t')[0]||{}).textContent || '').join('');
            if (!text.trim()) continue;
            const rPr = p.getElementsByTagName('a:rPr')[0] || (runs[0] && runs[0].getElementsByTagName('a:rPr')[0]);
            let fontSize = 24;
            if (rPr && rPr.getAttribute('sz')) fontSize = Math.max(10, (+rPr.getAttribute('sz')) / 100);
            fontSize = fontSize * (CANVAS_W/1280); // escala relativa consistente
            let color = '#222222';
            const clr = (rPr && rPr.getElementsByTagName('a:srgbClr')[0]);
            if (clr) color = '#' + clr.getAttribute('val');
            ctx.fillStyle = color;
            const bold = rPr && rPr.getAttribute('b') === '1';
            ctx.font = `${bold?'bold ':''}${Math.round(fontSize)}px 'Space Grotesk', Arial, sans-serif`;
            ctx.textBaseline = 'top';
            wrapCanvasText(ctx, text, x + 8, cy, Math.max(20,w - 16), fontSize * 1.3);
            cy += fontSize * 1.3 + 6;
          }
        }
      }
    } catch (e) {
      ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#E8AA4C'; ctx.font = '28px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No se pudo interpretar esta diapositiva', CANVAS_W / 2, CANVAS_H / 2);
      ctx.textAlign = 'left';
    }
    slides.push(canvas.toDataURL('image/jpeg', 0.88));
  }
  return slides;
}

function renderPresentationEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), title: '', slides: [], sourceType: '' };
  const editor = document.getElementById('editor');

  function paintSlideGrid() {
    const grid = document.getElementById('presSlidesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!draft.slides.length) { grid.appendChild(el('<div class="lib-empty">Todavía no importaste diapositivas.</div>')); return; }
    draft.slides.forEach((src, i) => {
      const card = el(`
        <div class="slide-card">
          <div class="slide-card-preview" style="padding:0;overflow:hidden;"><img src="${src}" style="width:100%;height:100%;object-fit:contain;background:#111;"/></div>
          <div class="slide-card-footer">
            <span class="slide-card-num">DIAP. ${i + 1}</span>
            <button class="icon-btn danger" title="Eliminar">✕</button>
          </div>
        </div>`);
      card.querySelector('.icon-btn').addEventListener('click', () => { draft.slides.splice(i, 1); paintSlideGrid(); });
      grid.appendChild(card);
    });
  }

  function paint(statusHTML) {
    editor.innerHTML = `
      <div class="editor-toolbar">
        <h2>${isNew ? 'Nueva presentación' : 'Editar presentación'}</h2>
        <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
      </div>
      <div class="field-row"><label class="field-label">Título</label><input class="field-input" id="presTitle" value="${esc(draft.title)}" placeholder="Ej: Anuncios de la semana"/></div>
      <label class="field-label">Importar desde</label>
      <div class="btn-row" style="margin-bottom:6px;">
        <button class="btn btn-ghost btn-sm" id="btnImportPDF">📄 PDF</button>
        <button class="btn btn-ghost btn-sm" id="btnImportPPTX">📊 PowerPoint (.pptx) — experimental</button>
        <button class="btn btn-ghost btn-sm" id="btnImportImgs">🖼️ Imágenes</button>
      </div>
      <p class="hint" style="margin-bottom:10px;">Para mejores resultados con PowerPoint o Canva: exportá como <b>PDF</b> desde el programa original — se ve 100% igual. La opción .pptx es experimental: interpreta texto e imágenes, pero no replica animaciones ni diseños complejos.</p>
      ${statusHTML || ''}
      <div class="slides-grid" id="presSlidesGrid"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="btnSavePres">Guardar presentación</button>
        ${!isNew ? '<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>' : ''}
      </div>`;

    document.getElementById('presTitle').addEventListener('input', e => draft.title = e.target.value);
    document.getElementById('btnCancelEdit').addEventListener('click', () => item ? openEditorFor(item) : renderEditorEmpty());
    paintSlideGrid();

    document.getElementById('btnImportPDF').addEventListener('click', () => {
      const input = el('<input type="file" accept="application/pdf" style="display:none;"/>');
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const f = input.files[0]; input.remove(); if (!f) return;
        paint('<p class="hint">Cargando PDF...</p>');
        try {
          const slides = await importPDFAsSlides(f, msg => paint(`<p class="hint">${msg}</p>`));
          draft.slides.push(...slides); draft.sourceType = 'pdf';
          if (!draft.title.trim()) draft.title = f.name.replace(/\.[^.]+$/, '');
          paint(`<p class="hint" style="color:#7fd88f;">✅ Se importaron ${slides.length} páginas.</p>`);
        } catch (e) { paint(`<p class="hint" style="color:#e88;">⚠️ ${esc(e.message)}</p>`); }
      });
      input.click();
    });

    document.getElementById('btnImportPPTX').addEventListener('click', () => {
      const input = el('<input type="file" accept=".pptx" style="display:none;"/>');
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const f = input.files[0]; input.remove(); if (!f) return;
        paint('<p class="hint">Descomprimiendo .pptx...</p>');
        try {
          const slides = await importPPTXAsSlides(f, msg => paint(`<p class="hint">${msg}</p>`));
          draft.slides.push(...slides); draft.sourceType = 'pptx';
          if (!draft.title.trim()) draft.title = f.name.replace(/\.[^.]+$/, '');
          paint(`<p class="hint" style="color:#e8c04c;">⚠️ Se importaron ${slides.length} diapositivas de forma experimental. Revisá que se vean bien — si no, exportá como PDF y volvé a intentar.</p>`);
        } catch (e) { paint(`<p class="hint" style="color:#e88;">⚠️ No se pudo leer el .pptx: ${esc(e.message)}</p>`); }
      });
      input.click();
    });

    document.getElementById('btnImportImgs').addEventListener('click', () => {
      const input = el('<input type="file" accept="image/*" multiple style="display:none;"/>');
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const files = Array.from(input.files); input.remove(); if (!files.length) return;
        const slides = await importImagesAsSlides(files);
        draft.slides.push(...slides); draft.sourceType = 'images';
        paintSlideGrid();
        toast(`${slides.length} imagen(es) agregadas.`);
      });
      input.click();
    });

    document.getElementById('btnSavePres').addEventListener('click', async () => {
      if (!draft.title.trim()) { toast('Ponle un título a la presentación.'); return; }
      if (!draft.slides.length) { toast('Importá al menos una diapositiva.'); return; }
      if (!(await ensureDataFolder())) return;
      try {
        await storage.save('presentaciones', draft);
        toast('Presentación guardada.');
        state.selectedId = draft.id;
        renderLibrary();
        renderPresentationEditor(draft);
      } catch (e) { toast(e.message); }
    });
    const pf = document.getElementById('btnProjectFromEditor');
    if (pf) pf.addEventListener('click', () => projectItem('presentaciones', draft, 0));
  }
  paint();
}

// ── MÓDULO BIBLIA ──
const bibleState = { bookIndex:0, chapterIndex:0, selectedVerses:new Set() };

function renderBibleSection() {
  // Solo ocultar biblioteca y expandir editor — no tocar el panel derecho
  document.querySelector('.library').style.display='none';
  document.getElementById('editor').style.gridColumn='2/4';

  const editor = document.getElementById('editor');
  editor.innerHTML=`<div class="bible-loading" id="bibleLoading"><div class="spinner"></div><span id="bibleLoadMsg">Cargando Biblia...</span></div>`;

  bible.load(msg=>{ const el=document.getElementById('bibleLoadMsg'); if(el)el.textContent=msg; }).then(ok=>{
    if (!ok) { editor.innerHTML='<div class="editor-empty"><p>No se pudo cargar la Biblia.<br>Verifica tu conexión a internet la primera vez.</p></div>'; return; }
    renderBibleBrowser();
    showBibleRightPanel();
  });
}

const MAX_VERSES = 3;

// Datos de libros con abreviatura y color por sección
const BIBLE_BOOK_DATA = [
  // Pentateuco
  {abbr:'Gn',color:'#7D5A2A'},{abbr:'Ex',color:'#7D5A2A'},{abbr:'Lv',color:'#7D5A2A'},
  {abbr:'Nm',color:'#7D5A2A'},{abbr:'Dt',color:'#7D5A2A'},
  // Históricos AT
  {abbr:'Jos',color:'#A0522D'},{abbr:'Jue',color:'#A0522D'},{abbr:'Rt',color:'#A0522D'},
  {abbr:'1Sm',color:'#A0522D'},{abbr:'2Sm',color:'#A0522D'},{abbr:'1Re',color:'#A0522D'},
  {abbr:'2Re',color:'#A0522D'},{abbr:'1Cr',color:'#A0522D'},{abbr:'2Cr',color:'#A0522D'},
  {abbr:'Esd',color:'#A0522D'},{abbr:'Ne',color:'#A0522D'},{abbr:'Est',color:'#A0522D'},
  // Poéticos
  {abbr:'Job',color:'#4A6741'},{abbr:'Sal',color:'#4A6741'},{abbr:'Pr',color:'#4A6741'},
  {abbr:'Ecl',color:'#4A6741'},{abbr:'Cant',color:'#4A6741'},
  // Profetas mayores
  {abbr:'Is',color:'#5C3D8C'},{abbr:'Jr',color:'#5C3D8C'},{abbr:'Lam',color:'#5C3D8C'},
  {abbr:'Ez',color:'#5C3D8C'},{abbr:'Dn',color:'#5C3D8C'},
  // Profetas menores
  {abbr:'Os',color:'#2E5F8C'},{abbr:'Jl',color:'#2E5F8C'},{abbr:'Am',color:'#2E5F8C'},
  {abbr:'Ab',color:'#2E5F8C'},{abbr:'Jon',color:'#2E5F8C'},{abbr:'Mi',color:'#2E5F8C'},
  {abbr:'Na',color:'#2E5F8C'},{abbr:'Ha',color:'#2E5F8C'},{abbr:'So',color:'#2E5F8C'},
  {abbr:'Hag',color:'#2E5F8C'},{abbr:'Za',color:'#2E5F8C'},{abbr:'Ml',color:'#2E5F8C'},
  // Evangelios
  {abbr:'Mt',color:'#2E7D32'},{abbr:'Mc',color:'#2E7D32'},{abbr:'Lc',color:'#2E7D32'},
  {abbr:'Jn',color:'#2E7D32'},
  // Hechos
  {abbr:'Hch',color:'#00838F'},
  // Epístolas paulinas
  {abbr:'Rom',color:'#B84B00'},{abbr:'1Co',color:'#B84B00'},{abbr:'2Co',color:'#B84B00'},
  {abbr:'Gal',color:'#B84B00'},{abbr:'Ef',color:'#B84B00'},{abbr:'Fil',color:'#B84B00'},
  {abbr:'Col',color:'#B84B00'},{abbr:'1Ts',color:'#B84B00'},{abbr:'2Ts',color:'#B84B00'},
  {abbr:'1Ti',color:'#B84B00'},{abbr:'2Ti',color:'#B84B00'},{abbr:'Tit',color:'#B84B00'},
  {abbr:'Flm',color:'#B84B00'},
  // Epístolas generales
  {abbr:'Heb',color:'#6B4226'},{abbr:'St',color:'#6B4226'},{abbr:'1Pe',color:'#6B4226'},
  {abbr:'2Pe',color:'#6B4226'},{abbr:'1Jn',color:'#6B4226'},{abbr:'2Jn',color:'#6B4226'},
  {abbr:'3Jn',color:'#6B4226'},{abbr:'Jud',color:'#6B4226'},
  // Apocalipsis
  {abbr:'Ap',color:'#8B6914'},
];

const BIBLE_SECTIONS = [
  { label:'Pentateuco', from:0, to:4 },
  { label:'Históricos', from:5, to:16 },
  { label:'Poéticos', from:17, to:21 },
  { label:'Profetas Mayores', from:22, to:26 },
  { label:'Profetas Menores', from:27, to:38 },
  { label:'Evangelios', from:39, to:42 },
  { label:'Hechos', from:43, to:43 },
  { label:'Epístolas Paulinas', from:44, to:56 },
  { label:'Epístolas Generales', from:57, to:64 },
  { label:'Apocalipsis', from:65, to:65 },
];

function renderBibleBrowser() {
  const editor = document.getElementById('editor');
  editor.innerHTML = '';

  const layout = document.createElement('div');
  layout.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

  // ── LIBROS: grid continuo sin etiquetas ──
  const booksArea = document.createElement('div');
  booksArea.className = 'bible-books-area';
  const bookGrid = document.createElement('div');
  bookGrid.className = 'bible-book-grid';

  for (let i = 0; i < 66; i++) {
    const bd = BIBLE_BOOK_DATA[i];
    const btn = document.createElement('button');
    btn.className = 'bible-book-btn' + (i === bibleState.bookIndex ? ' active' : '');
    btn.style.background = bd.color;
    btn.innerHTML = `<span class="bible-book-abbr">${bd.abbr}</span><span class="bible-book-name">${esc(bible.BOOK_NAMES[i])}</span>`;
    btn.title = bible.BOOK_NAMES[i];
    btn.addEventListener('click', () => {
      bibleState.bookIndex = i;
      bibleState.chapterIndex = 0;
      bibleState.selectedVerses.clear();
      bookGrid.querySelectorAll('.bible-book-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderBibleChapAndVerses(bottomArea);
      paintBibleRightPanel();
    });
    bookGrid.appendChild(btn);
  }
  booksArea.appendChild(bookGrid);
  layout.appendChild(booksArea);

  // ── ZONA INFERIOR: capítulos izq + versículos der ──
  const bottomArea = document.createElement('div');
  bottomArea.className = 'bible-bottom-area';
  bottomArea.style.flex = '1';
  bottomArea.style.minHeight = '0';
  layout.appendChild(bottomArea);

  if (bibleState.bookIndex >= 0) {
    renderBibleChapAndVerses(bottomArea);
  } else {
    bottomArea.className = 'bible-bottom-area empty';
    bottomArea.textContent = 'Selecciona un libro para continuar';
  }

  editor.appendChild(layout);
}

function renderBibleChapAndVerses(bottomArea) {
  bottomArea.className = 'bible-bottom-area single-col';
  bottomArea.innerHTML = '';

  const book = bible.getBook(bibleState.bookIndex);
  const bd = BIBLE_BOOK_DATA[bibleState.bookIndex];
  if (!book) return;

  // ── Columna capítulos (a todo lo ancho — los versículos van al panel derecho) ──
  const chapCol = document.createElement('div');
  chapCol.className = 'bible-chap-col no-border';

  const chapHeader = document.createElement('div');
  chapHeader.className = 'bible-chap-col-header';
  chapHeader.innerHTML = `<h3 style="color:${bd.color};">${esc(book.name)}</h3>`;
  chapCol.appendChild(chapHeader);

  const chapGrid = document.createElement('div');
  chapGrid.className = 'bible-chap-grid';

  book.chapters.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'bible-chap-btn' + (i === bibleState.chapterIndex ? ' active' : '');
    if (i === bibleState.chapterIndex) btn.style.background = bd.color;
    btn.textContent = i + 1;
    btn.addEventListener('click', () => {
      bibleState.chapterIndex = i;
      bibleState.selectedVerses.clear();
      chapGrid.querySelectorAll('.bible-chap-btn').forEach((b, j) => {
        b.classList.toggle('active', j === i);
        b.style.background = j === i ? bd.color : '';
      });
      paintBibleRightPanel();
    });
    chapGrid.appendChild(btn);
  });
  chapCol.appendChild(chapGrid);
  bottomArea.appendChild(chapCol);
}

function buildBiblePayload() {
  const sorted=[...bibleState.selectedVerses].sort((a,b)=>a-b);
  return bible.buildVersePayload(bibleState.bookIndex,bibleState.chapterIndex,sorted[0],sorted[sorted.length-1]);
}

function projectBibleSelection() {
  const payload=buildBiblePayload();
  state.liveRef={ collection:'biblia', id:'bible-current', slideIndex:0,
    snapshot:{ title:payload.reference, slides:[payload.text], reference:payload.reference, text:payload.text } };
  sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
}

// ── PANEL DERECHO EN MODO BIBLIA ──
// Mientras la sección "Biblia" está activa, la columna derecha (que normalmente
// muestra "Proyección") se reemplaza por la lista de versículos del capítulo
// seleccionado. Al salir de Biblia se restaura tal cual estaba.
let _origPreviewColHTML = null;

let _lwSearchTimer = null;

function showBibleRightPanel() {
  const prevCol = document.querySelector('.preview-col');
  if (!prevCol) return;
  if (_origPreviewColHTML === null) _origPreviewColHTML = prevCol.innerHTML;
  prevCol.innerHTML = `
    <div class="preview-head">
      <h2>Versículos</h2>
      <span style="font-size:10px;color:var(--text-faint);" id="bibleVerseLabel">—</span>
    </div>
    <div style="padding:5px 8px;border-bottom:1px solid var(--border-soft);flex-shrink:0;">
      <input id="bibleQuickSearch"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 9px;color:var(--text);font-size:12px;"
        placeholder="🔍 Buscar en la Biblia..." autocomplete="off"/>
      <div id="bibleSearchStatus" style="font-size:10px;color:var(--text-faint);min-height:13px;margin-top:2px;"></div>
    </div>
    <div class="bible-verse-list" id="bibleRightVerseList" style="flex:1;overflow-y:auto;padding:4px 6px;min-height:0;"></div>
    <div class="bible-proj-bar" id="bibleRightProjBar" style="flex-shrink:0;"></div>`;

  // Búsqueda en tiempo real
  const inp = document.getElementById('bibleQuickSearch');
  inp.addEventListener('input', () => {
    clearTimeout(_lwSearchTimer);
    const q = inp.value.trim();
    const status = document.getElementById('bibleSearchStatus');
    if (!q || q.length < 2) {
      if (status) status.textContent = '';
      paintBibleRightPanel();
      return;
    }
    if (status) status.textContent = 'Buscando...';
    _lwSearchTimer = setTimeout(() => _doBibleSearch(q), 280);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      inp.value = '';
      document.getElementById('bibleSearchStatus').textContent = '';
      paintBibleRightPanel();
    }
  });

  paintBibleRightPanel();
}

function _doBibleSearch(q) {
  const list = document.getElementById('bibleRightVerseList');
  const bar = document.getElementById('bibleRightProjBar');
  const status = document.getElementById('bibleSearchStatus');
  if (!list || !bible.data) return;
  const ql = q.toLowerCase();
  const results = [];

  bible.data.forEach((book, bi) => {
    book.chapters.forEach((chapter, ci) => {
      chapter.forEach((verse, vi) => {
        if (verse.toLowerCase().includes(ql)) results.push({ bi, ci, vi, book: book.name, text: verse });
      });
    });
  });

  if (status) status.textContent = results.length
    ? results.length.toLocaleString() + ' resultado' + (results.length !== 1 ? 's' : '') + (results.length > 80 ? ' · primeros 80' : '')
    : 'Sin resultados';
  if (bar) bar.innerHTML = '';

  list.innerHTML = '';
  const re = new RegExp('(' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');

  results.slice(0, 80).forEach(r => {
    const item = document.createElement('div');
    item.className = 'bible-verse-item';
    item.style.marginBottom = '2px';
    item.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:2px;width:100%;">' +
      '<span style="font-size:10px;font-weight:700;color:var(--amber);">' + esc(r.book) + ' ' + (r.ci+1) + ':' + (r.vi+1) + '</span>' +
      '<span style="font-size:12px;line-height:1.5;">' + r.text.replace(re, '<mark style="background:rgba(232,170,76,.2);color:var(--amber);border-radius:2px;padding:0 1px;">$1</mark>') + '</span>' +
      '</div>';
    item.addEventListener('click', () => {
      bibleState.bookIndex = r.bi;
      bibleState.chapterIndex = r.ci;
      bibleStartVerse = r.vi;
      bibleVerseCount = 1;
      const inp2 = document.getElementById('bibleQuickSearch');
      if (inp2) inp2.value = '';
      if (status) status.textContent = '';
      renderBibleBrowser();
    });
    list.appendChild(item);
  });
}

function restoreProjectionPanel() {
  if (_origPreviewColHTML === null) return; // no estaba reemplazado, nada que hacer
  const prevCol = document.querySelector('.preview-col');
  if (prevCol) prevCol.innerHTML = _origPreviewColHTML;
  _origPreviewColHTML = null;
  _reattachProjectionPanelEvents();
}

// Reconecta los controles de la columna derecha después de restaurar su HTML original
// (el innerHTML nuevo no conserva los listeners que estaban puestos en los nodos viejos).
function _reattachProjectionPanelEvents() {
  const btnClear = document.getElementById('btnClearProj');
  if (btnClear) btnClear.addEventListener('click', clearProjection);
  const btnOpen = document.getElementById('btnOpenProjector');
  if (btnOpen) btnOpen.addEventListener('click', openProjectorWindow);
  const btnTheme = document.getElementById('btnToggleTheme');
  if (btnTheme) { btnTheme.textContent = projTheme==='dark'?'☀️ Fondo blanco':'🌙 Fondo negro'; btnTheme.addEventListener('click', toggleProjTheme); }
  const fontSel = document.getElementById('projFont');
  if (fontSel) { fontSel.value = projFont; fontSel.addEventListener('change', e => { projFont = e.target.value; channel.postMessage({type:'settings',font:projFont,size:projSize}); }); }
  const sizeSel = document.getElementById('projSize');
  if (sizeSel) sizeSel.addEventListener('change', e => { projSize = e.target.value; channel.postMessage({type:'settings',font:projFont,size:projSize}); });
  const btnPrev = document.getElementById('btnPrevSlide');
  if (btnPrev) btnPrev.addEventListener('click', goPrevSlide);
  const btnNext = document.getElementById('btnNextSlide');
  if (btnNext) btnNext.addEventListener('click', goNextSlide);
  const btnPlay = document.getElementById('btnAudioPlay');
  if (btnPlay) { btnPlay.textContent = (state.audio.currentIndex>=0 && !state.audio.el.paused)?'⏸':'▶'; btnPlay.addEventListener('click', toggleAudioPlay); }
  const btnAudioNextEl = document.getElementById('btnAudioNext');
  if (btnAudioNextEl) btnAudioNextEl.addEventListener('click', audioNext);
  const btnAudioPrevEl = document.getElementById('btnAudioPrev');
  if (btnAudioPrevEl) btnAudioPrevEl.addEventListener('click', audioRestart);
  const btnFolder = document.getElementById('btnAudioFolder');
  if (btnFolder) btnFolder.addEventListener('click', chooseAudioFolder);
  const progressBar = document.getElementById('audioProgress');
  if (progressBar) progressBar.addEventListener('mousedown', e => {
    if (state.audio.currentIndex===-1) return;
    state.audio.scrubbing = true;
    seekFromEvent(e);
    const onMove = ev => seekFromEvent(ev);
    const onUp = () => { state.audio.scrubbing = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
  // Restaurar contenido dinámico
  const nowEl = document.getElementById('audioNow');
  if (nowEl && state.audio.currentIndex>=0) nowEl.textContent = state.audio.files[state.audio.currentIndex]?.name || 'Sin pista seleccionada';
  const fill = document.getElementById('audioProgressFill');
  if (fill && state.audio.el.duration) fill.style.width = `${(state.audio.el.currentTime/state.audio.el.duration)*100}%`;
  renderPreview();
  updateLiveBadge(!!state.liveRef);
}

// Versículo de inicio y cantidad a proyectar
let bibleStartVerse = -1;
let bibleVerseCount = 1;

function paintBibleRightPanel() {
  const list = document.getElementById('bibleRightVerseList');
  const bar = document.getElementById('bibleRightProjBar');
  const label = document.getElementById('bibleVerseLabel');
  if (!list || !bar) return;

  const book = bible.getBook(bibleState.bookIndex);
  if (!book) { list.innerHTML = ''; bar.innerHTML = ''; if (label) label.textContent = '—'; return; }

  const verses = bible.getChapter(bibleState.bookIndex, bibleState.chapterIndex);
  if (label) label.textContent = `${book.name} ${bibleState.chapterIndex + 1}`;

  function paintVerses() {
    list.innerHTML = '';
    if (!verses.length) { list.innerHTML = '<div class="bible-verse-empty">Sin versículos.</div>'; return; }
    verses.forEach((text, i) => {
      const isStart = i === bibleStartVerse;
      const inRange = bibleStartVerse >= 0 && i > bibleStartVerse && i < bibleStartVerse + bibleVerseCount;
      const item = el(`
        <div class="bible-verse-item ${isStart?'selected':''} ${inRange?'in-range':''}">
          <span class="bible-verse-num">${i+1}</span>
          <span class="bible-verse-text">${esc(text)}</span>
        </div>`);
      item.addEventListener('click', () => {
        bibleStartVerse = i;
        bibleVerseCount = Math.min(bibleVerseCount, verses.length - i);
        paintVerses(); paintBar();
      });
      list.appendChild(item);
    });
  }

  function paintBar() {
    const hasSel = bibleStartVerse >= 0;
    const maxCount = hasSel ? Math.min(3, verses.length - bibleStartVerse) : 3;
    const ref = hasSel
      ? `${book.name} ${bibleState.chapterIndex+1}:${bibleStartVerse+1}${bibleVerseCount>1?'–'+(bibleStartVerse+bibleVerseCount):''}`
      : '—';

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Versículos:</span>
        ${[1,2,3].map(n=>`
          <button class="bible-count-btn ${bibleVerseCount===n&&hasSel?'active':''}"
            data-n="${n}" ${!hasSel||n>maxCount?'disabled':''}>${n}</button>
        `).join('')}
        <span style="flex:1;font-size:10px;color:var(--text-faint);text-align:right;">${ref}</span>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm" id="bRightAddList" ${!hasSel?'disabled':''} style="flex:1;justify-content:center;">+ Lista</button>
        <button class="bible-proj-action" id="bRightProj" ${!hasSel?'disabled':''} style="flex:2;">Proyectar</button>
      </div>`;

    bar.querySelectorAll('.bible-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!hasSel) return;
        bibleVerseCount = parseInt(btn.dataset.n);
        paintVerses(); paintBar();
      });
    });

    bar.querySelector('#bRightProj').addEventListener('click', () => {
      if (bibleStartVerse < 0) return;
      const payload = bible.buildVersePayload(
        bibleState.bookIndex, bibleState.chapterIndex,
        bibleStartVerse, bibleStartVerse + bibleVerseCount - 1
      );
      state.liveRef = { collection:'biblia', id:'bible-current', slideIndex:0,
        snapshot:{ title:payload.reference, slides:[payload.text], reference:payload.reference, text:payload.text }};
      sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
    });

    bar.querySelector('#bRightAddList').addEventListener('click', () => {
      if (bibleStartVerse < 0) { toast('Selecciona un versículo primero.'); return; }
      const payload = bible.buildVersePayload(
        bibleState.bookIndex, bibleState.chapterIndex,
        bibleStartVerse, bibleStartVerse + bibleVerseCount - 1
      );
      const lst = getCurrentList();
      if (!lst) { toast('Crea una lista de servicio primero.'); return; }
      lst.items.push({ type:'citas', refId:'bible-'+uid(), title:payload.reference, biblePayload:payload });
      storage.saveList(lst).then(() => { renderTimeline(); toast('Añadido a la lista.'); });
    });
  }

  paintVerses();
  paintBar();
}

// ── AUDIO ──
function renderAudioSection() {
  document.getElementById('libTitle').textContent='Audio';
  document.getElementById('libCount').textContent=state.audio.files.length;
  document.getElementById('btnAdd').textContent='+ Elegir carpeta de audio';
  document.getElementById('btnAdd').style.display='';
  document.getElementById('libSearch').style.display='';
  const list=document.getElementById('libList');
  list.innerHTML='';
  if(!state.audio.files.length){ list.appendChild(el('<div class="lib-empty">No hay carpeta de audio seleccionada.<br>Usa el botón de arriba.</div>')); }
  else {
    state.audio.files.forEach((f,i)=>{
      const item=el(`<div class="lib-item ${state.audio.currentIndex===i?'selected':''}"><div class="lib-item-row"><div><div class="t-title">${esc(f.name)}</div><div class="t-sub">Pista ${i+1}</div></div></div></div>`);
      item.addEventListener('click',()=>playAudioAt(i));
      list.appendChild(item);
    });
  }
  document.getElementById('editor').innerHTML=`<div class="editor-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg><p>Reproductor de audio independiente.<br>Elige una pista para reproducirla.</p></div>`;
}

async function chooseAudioFolder() {
  try {
    const handle=await window.showDirectoryPicker();
    state.audio.dirHandle=handle; state.audio.files=[];
    for await (const [name,h] of handle.entries()) {
      if(h.kind==='file'&&/\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) state.audio.files.push({name,handle:h});
    }
    state.audio.files.sort((a,b)=>a.name.localeCompare(b.name));
    state.audio.currentIndex=-1;
    renderAudioSection(); toast(`${state.audio.files.length} pistas encontradas.`);
  } catch(e){}
}
document.getElementById('btnAudioFolder').addEventListener('click',chooseAudioFolder);

async function playAudioAt(i) {
  state.audio.currentIndex=i;
  const f=state.audio.files[i];
  const file=await f.handle.getFile();
  const url=URL.createObjectURL(file);
  state.audio.el.src=url; state.audio.el.play();
  const nowEl=document.getElementById('audioNow'); if(nowEl) nowEl.textContent=f.name;
  const playBtn=document.getElementById('btnAudioPlay'); if(playBtn) playBtn.textContent='⏸';
  if(state.section==='audio') renderAudioSection();
  publishRemoteState();
}

// Reutilizable: se usa desde el botón local, el control remoto y el panel de audio.
function toggleAudioPlay(){
  if(state.audio.currentIndex===-1&&state.audio.files.length){ playAudioAt(0); return; }
  if(state.audio.el.paused) state.audio.el.play(); else state.audio.el.pause();
  const btn=document.getElementById('btnAudioPlay'); if(btn) btn.textContent=state.audio.el.paused?'▶':'⏸';
}
function audioNext(){ if(!state.audio.files.length)return; playAudioAt((state.audio.currentIndex+1)%state.audio.files.length); }
function audioRestart(){
  if(state.audio.currentIndex===-1)return;
  state.audio.el.currentTime=0; state.audio.el.play();
  const btn=document.getElementById('btnAudioPlay'); if(btn) btn.textContent='⏸';
}

document.getElementById('btnAudioPlay').addEventListener('click',toggleAudioPlay);
document.getElementById('btnAudioNext').addEventListener('click',audioNext);
document.getElementById('btnAudioPrev').addEventListener('click',audioRestart);

let _lastAudioPublish=0;
state.audio.el.addEventListener('timeupdate',()=>{
  const{currentTime,duration}=state.audio.el;
  const fill=document.getElementById('audioProgressFill');
  if(duration&&!state.audio.scrubbing&&fill) fill.style.width=`${(currentTime/duration)*100}%`;
  const now=Date.now();
  if(now-_lastAudioPublish>3000){ _lastAudioPublish=now; publishRemoteState(); }
});
state.audio.el.addEventListener('ended',audioNext);

function seekFromEvent(e){
  const audioProgressBar=document.getElementById('audioProgress');
  if(!state.audio.el.duration||!audioProgressBar)return;
  const rect=audioProgressBar.getBoundingClientRect();
  const ratio=Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
  const fill=document.getElementById('audioProgressFill'); if(fill) fill.style.width=`${ratio*100}%`;
  state.audio.el.currentTime=ratio*state.audio.el.duration;
}
document.getElementById('audioProgress').addEventListener('mousedown',e=>{
  if(state.audio.currentIndex===-1)return;
  state.audio.scrubbing=true;
  seekFromEvent(e);
  const onMove=ev=>seekFromEvent(ev);
  const onUp=()=>{ state.audio.scrubbing=false; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp);
});

// ── PROYECCIÓN ──
function kindForCollection(c){
  return c==='canciones'?'song'
    : c==='anuncios'?'announcement'
    : c==='videos'?'video'
    : c==='presentaciones'?'presentation'
    : 'verse'; // biblia, citas
}

function songDisplaySlides(song) {
  return [{ isTitle:true, title:song.title, author:song.author }, ...song.slides.map(text=>({text}))];
}

function buildPayloadFromLive() {
  const{collection,snapshot,slideIndex}=state.liveRef;
  const kind=kindForCollection(collection);
  if(kind==='announcement'&&snapshot.type==='image') return{kind:'image',imageData:snapshot.imageData};
  if(kind==='presentation'){
    const slides=snapshot.slides||[];
    return{kind:'image',imageData:slides[slideIndex]||slides[0]};
  }
  if(kind==='video'){
    // El archivo real se transmite aparte (ver projectVideo); esto es solo
    // para el estado del remoto/mini-preview.
    return{kind:'video',title:snapshot.title};
  }
  if(kind==='song'){
    const slides=songDisplaySlides(snapshot);
    const s=slides[slideIndex]||slides[0];
    if(s.isTitle) return{kind:'song',text:s.title,reference:s.author||undefined};
    return{kind:'song',text:s.text};
  }
  return{kind:'verse',text:snapshot.text||snapshot.slides?.[slideIndex]||'',reference:snapshot.reference};
}

function projectItem(collection,item,slideIndex){
  if (collection === 'videos') { projectVideo(item); return; }
  state.liveRef={collection,id:item.id,slideIndex:slideIndex||0,snapshot:item};
  sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
}

function clearProjection(){
  state.liveRef=null;
  sendCurrentSlide(); renderPreview(); updateLiveBadge(false); highlightTimelineLive();
  publishRemoteState();
}
document.getElementById('btnClearProj').addEventListener('click',clearProjection);

// Calcula el tamaño de fuente automáticamente según la longitud del texto
function autoFontSize(text) {
  const len = (text || '').length;
  if (len <= 80)  return '6.5vw';
  if (len <= 160) return '5.2vw';
  if (len <= 260) return '4.2vw';
  if (len <= 380) return '3.4vw';
  return '2.8vw';
}

function sendCurrentSlide(){
  if(!state.liveRef){ channel.postMessage({type:'content',payload:{kind:'blank'}}); publishRemoteState(); updateMobileProjBar(); return; }
  if(kindForCollection(state.liveRef.collection)==='video'){
    // El video ya se está proyectando; no hay "diapositiva" que reenviar aquí
    // (ver el manejo de 'request-state' más abajo para el caso de reabrir la ventana).
    publishRemoteState(); updateMobileProjBar(); return;
  }
  const payload = buildPayloadFromLive();
  // Tamaño automático basado en el contenido (no editable por el usuario)
  const autoSize = payload.kind !== 'image' ? autoFontSize(payload.text) : projSize;
  channel.postMessage({type:'content',payload,font:projFont,size:autoSize});
  publishRemoteState(); updateMobileProjBar();
}

function updateLiveBadge(on){
  // Nota: estos elementos viven dentro de .preview-col, que se reemplaza
  // temporalmente por el panel de versículos al usar la sección Biblia.
  // Si no están presentes ahora mismo, simplemente no hay nada que actualizar.
  const badge=document.getElementById('liveBadge'); if(badge) badge.classList.toggle('on',on);
  const text=document.getElementById('liveText'); if(text) text.textContent=on?'EN VIVO':'SIN SEÑAL';
  const dot=document.getElementById('dotLive'); if(dot) dot.classList.toggle('on',on);
  const dot2=document.getElementById('dotLive2'); if(dot2) dot2.classList.toggle('on',on);
}

function renderPreview(){
  const frame=document.getElementById('projFrame');
  const slideNav=document.getElementById('slideNav');
  if(!frame||!slideNav) return; // panel de proyección no visible ahora (p.ej. estamos en Biblia)
  if(!state.liveRef){ frame.innerHTML='<span class="ph-text">Nada en proyección</span>'; slideNav.classList.add('hidden'); return; }
  const{collection,snapshot,slideIndex}=state.liveRef;
  const kind=kindForCollection(collection);
  if(kind==='announcement'&&snapshot.type==='image'){ frame.innerHTML=`<img src="${snapshot.imageData}"/>`; slideNav.classList.add('hidden'); return; }
  if(kind==='presentation'){
    const slides=snapshot.slides||[];
    const img=slides[slideIndex]||slides[0];
    frame.innerHTML = img ? `<img src="${img}"/>` : '<span class="ph-text">Presentación vacía</span>';
    if(slides.length>1){ slideNav.classList.remove('hidden'); document.getElementById('slideCounter').textContent=`${slideIndex+1}/${slides.length}`; }
    else slideNav.classList.add('hidden');
    return;
  }
  if(kind==='video'){
    frame.innerHTML=`
      <div class="video-live-badge">
        <div style="font-size:38px;">🎬</div>
        <div style="margin-top:8px;font-weight:600;max-width:90%;overflow:hidden;text-overflow:ellipsis;">${esc(snapshot.title)}</div>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;">
          <button class="nav-btn" id="btnVideoRestart" title="Reiniciar">↺</button>
          <button class="nav-btn" id="btnVideoPlayPause" title="Pausar/Reanudar">${_videoPlaying?'⏸':'▶'}</button>
        </div>
      </div>`;
    slideNav.classList.add('hidden');
    const bR=document.getElementById('btnVideoRestart');
    if(bR) bR.addEventListener('click',()=>{ _videoPlaying=true; renderPreview(); channel.postMessage({type:'video-control',action:'restart'}); });
    const bP=document.getElementById('btnVideoPlayPause');
    if(bP) bP.addEventListener('click',()=>{ _videoPlaying=!_videoPlaying; channel.postMessage({type:'video-control',action:_videoPlaying?'play':'pause'}); renderPreview(); });
    return;
  }
  let text='',totalSlides=1;
  if(kind==='song'){
    const slides=songDisplaySlides(snapshot); totalSlides=slides.length;
    const s=slides[slideIndex]||slides[0];
    text=s.isTitle?s.title+(s.author?`\n${s.author}`:''):s.text;
  } else { text=(snapshot.text||snapshot.slides?.[slideIndex]||'')+(snapshot.reference?`\n— ${snapshot.reference}`:''); }
  const textColor = projTheme === 'light' ? '#111' : '#fff';
  frame.innerHTML=`<span class="ph-text" style="color:${textColor}">${esc(text)}</span>`;
  if(kind==='song'&&totalSlides>1){ slideNav.classList.remove('hidden'); document.getElementById('slideCounter').textContent=`${slideIndex+1}/${totalSlides}`; }
  else slideNav.classList.add('hidden');
}

// Reutilizables: botón local, botones móviles y control remoto los llaman a todos.
function goPrevSlide(){
  if(!state.liveRef)return;
  state.liveRef.slideIndex=Math.max(0,state.liveRef.slideIndex-1);
  sendCurrentSlide(); renderPreview();
}
function goNextSlide(){
  if(!state.liveRef)return;
  const kind=kindForCollection(state.liveRef.collection);
  const max = kind==='song' ? songDisplaySlides(state.liveRef.snapshot).length-1
            : kind==='presentation' ? Math.max(0,(state.liveRef.snapshot.slides||[]).length-1)
            : 0;
  state.liveRef.slideIndex=Math.min(max,state.liveRef.slideIndex+1);
  sendCurrentSlide(); renderPreview();
}
document.getElementById('btnPrevSlide').addEventListener('click',goPrevSlide);
document.getElementById('btnNextSlide').addEventListener('click',goNextSlide);

channel.onmessage=e=>{
  if(!e.data||e.data.type!=='request-state')return;
  if(state.liveRef&&kindForCollection(state.liveRef.collection)==='video'){
    // Reabrieron/recargaron la ventana de proyección con un video en curso: reenviarlo.
    projectVideo(state.liveRef.snapshot);
  } else {
    sendCurrentSlide();
  }
};

// Tema y fuente
function toggleProjTheme(){
  projTheme=projTheme==='dark'?'light':'dark';
  const btn=document.getElementById('btnToggleTheme'); if(btn) btn.textContent=projTheme==='dark'?'☀️ Fondo blanco':'🌙 Fondo negro';
  channel.postMessage({type:'theme',theme:projTheme});
  const frame=document.getElementById('projFrame'); if(frame) frame.style.background=projTheme==='light'?'#fff':'#000';
  renderPreview();
}
document.getElementById('btnToggleTheme').addEventListener('click',toggleProjTheme);
document.getElementById('projFont').addEventListener('change',e=>{
  projFont=e.target.value;
  channel.postMessage({type:'settings',font:projFont,size:projSize});
});
document.getElementById('projSize').addEventListener('change',e=>{
  projSize=e.target.value;
  channel.postMessage({type:'settings',font:projFont,size:projSize});
});

// ── PROYECTOR WINDOW ──
function openProjectorWindow(){ projectorWindow=window.open('projection.html','proyeccion','width=1280,height=720'); }
document.getElementById('btnProjectorWindow').addEventListener('click',openProjectorWindow);
document.getElementById('btnOpenProjector').addEventListener('click',openProjectorWindow);

// ── LISTA DE SERVICIO ──
function renderListSelect(){
  const sel=document.getElementById('listSelect');
  const lists=storage.getLists();
  sel.innerHTML=lists.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');
  if(!state.currentList&&lists.length) state.currentList=lists[0].id;
  if(state.currentList) sel.value=state.currentList;
  if(!lists.length) sel.innerHTML='<option>Sin listas — crea una</option>';
}
document.getElementById('listSelect').addEventListener('change',e=>{ state.currentList=e.target.value; renderTimeline(); });
document.getElementById('btnNewList').addEventListener('click',async()=>{
  if(!(await ensureDataFolder()))return;
  const name=prompt('Nombre de la lista:',`Servicio ${new Date().toLocaleDateString('es-MX')}`);
  if(!name)return;
  const list={id:uid(),name,items:[]};
  await storage.saveList(list); state.currentList=list.id; renderListSelect(); renderTimeline();
});
document.getElementById('btnDeleteList').addEventListener('click',async()=>{
  if(!state.currentList)return;
  if(!confirm('¿Borrar esta lista?'))return;
  await storage.removeList(state.currentList); state.currentList=null; renderListSelect(); renderTimeline();
});

function getCurrentList(){ return storage.getLists().find(l=>l.id===state.currentList)||null; }

function renderTimeline(){
  const tl=document.getElementById('timeline');
  const list=getCurrentList();
  tl.innerHTML='';
  if(!list){ tl.appendChild(el('<div class="tl-empty">Crea una lista de servicio para organizar el culto.</div>')); return; }
  if(!list.items.length){ tl.appendChild(el('<div class="tl-empty">Lista vacía — usa "+ Agregar a la lista".</div>')); return; }
  list.items.forEach((it,idx)=>{
    const isLive=state.liveRef&&state.liveRef.collection===it.type&&state.liveRef.id===it.refId;
    const node=el(`
      <div class="tl-item ${isLive?'live':''}" draggable="true" data-idx="${idx}">
        <button class="tl-remove" title="Quitar">✕</button>
        <div class="tl-type">${it.type}</div>
        <div class="tl-title">${esc(it.title)}</div>
      </div>`);
    node.addEventListener('click',e=>{
      if(e.target.closest('.tl-remove')){ list.items.splice(idx,1); storage.saveList(list).then(renderTimeline); return; }
      if(it.biblePayload){
        state.liveRef={collection:'biblia',id:it.refId,slideIndex:0,snapshot:{title:it.title,text:it.biblePayload.text,reference:it.biblePayload.reference,slides:[it.biblePayload.text]}};
        sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive(); return;
      }
      const item=storage.list(it.type).find(x=>x.id===it.refId);
      if(item){ projectItem(it.type,item,0); renderTimeline(); } else toast('Este elemento ya no existe en la biblioteca.');
    });
    node.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',idx); });
    node.addEventListener('dragover',e=>e.preventDefault());
    node.addEventListener('drop',e=>{ e.preventDefault(); const from=parseInt(e.dataTransfer.getData('text/plain')); if(from===idx)return; const[moved]=list.items.splice(from,1); list.items.splice(idx,0,moved); storage.saveList(list).then(renderTimeline); });
    tl.appendChild(node);
  });
}
function highlightTimelineLive(){ renderTimeline(); }

document.getElementById('btnAddToList').addEventListener('click',e=>{ const list=getCurrentList(); if(!list){ toast('Crea una lista de servicio primero.'); return; } openAddMenu(e.currentTarget); });

function openAddMenu(anchor){
  document.querySelectorAll('.menu').forEach(m=>m.remove());
  const rect=anchor.getBoundingClientRect();
  const menu=el(`<div class="menu" style="position:fixed;left:${rect.left-200}px;top:${rect.top-200}px;background:var(--panel-raised);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:50;min-width:170px;padding:6px;">
    <button data-c="canciones" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">🎵 Canción...</button>
    <button data-c="anuncios" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">📢 Anuncio...</button>
    <button data-c="citas" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">📖 Cita...</button>
    <button data-c="videos" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">🎬 Video...</button>
    <button data-c="presentaciones" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">🖥️ Presentación...</button>
  </div>`);
  document.body.appendChild(menu);
  const close=()=>menu.remove();
  setTimeout(()=>document.addEventListener('click',close,{once:true}),0);
  menu.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ openPickerModal(b.dataset.c); menu.remove(); }));
}

function openPickerModal(collection){
  const items=storage.list(collection);
  const root=document.getElementById('modalRoot');
  const labelMap={canciones:'canción',anuncios:'anuncio',citas:'cita bíblica',videos:'video',presentaciones:'presentación'};
  root.innerHTML=`
    <div class="modal-bg" id="modalBg"><div class="modal">
      <h3>Elige una ${labelMap[collection]}</h3>
      <div class="modal-list">
        ${items.length?items.map(i=>`<div class="lib-item" data-id="${i.id}"><div class="t-title">${esc(i.title||i.reference)}</div></div>`).join(''):'<div class="lib-empty">No hay elementos guardados todavía.</div>'}
      </div>
      <div class="btn-row"><button class="btn btn-ghost" id="modalCancel">Cancelar</button></div>
    </div></div>`;
  document.getElementById('modalCancel').addEventListener('click',()=>root.innerHTML='');
  document.getElementById('modalBg').addEventListener('click',e=>{ if(e.target.id==='modalBg') root.innerHTML=''; });
  root.querySelectorAll('.modal-list .lib-item').forEach(row=>{
    row.addEventListener('click',async()=>{
      const item=items.find(i=>i.id===row.dataset.id);
      const list=getCurrentList();
      list.items.push({type:collection,refId:item.id,title:item.title||item.reference});
      await storage.saveList(list); renderTimeline(); root.innerHTML='';
    });
  });
}

// ── MOBILE BAR ──
function updateMobileProjBar(){
  const dot=document.getElementById('dotLiveMobile');
  const title=document.getElementById('mobileProjTitle');
  const counter=document.getElementById('slideCounterMobile');
  if(!dot)return;
  if(!state.liveRef){ dot.classList.remove('on'); title.textContent='Sin proyección'; counter.textContent='-'; return; }
  dot.classList.add('on');
  title.textContent=state.liveRef.snapshot.title||state.liveRef.snapshot.reference||'Proyectando';
  const kind=kindForCollection(state.liveRef.collection);
  if(kind==='song'){ const total=songDisplaySlides(state.liveRef.snapshot).length; counter.textContent=`${state.liveRef.slideIndex+1}/${total}`; }
  else if(kind==='presentation'){ const total=(state.liveRef.snapshot.slides||[]).length; counter.textContent=`${state.liveRef.slideIndex+1}/${total}`; }
  else counter.textContent='1/1';
}
document.getElementById('btnPrevSlideMobile').addEventListener('click',goPrevSlide);
document.getElementById('btnNextSlideMobile').addEventListener('click',goNextSlide);
document.getElementById('btnClearMobile').addEventListener('click',clearProjection);

// ── CONTROL REMOTO MQTT ──
const REMOTE_KEY='liteworship-remote-state';
let mqttClient=null,remoteConnected=false,_remoteRoom=null,_onRemoteMessage=null;

function getRemoteRoom(){ let r=localStorage.getItem('liteworship-room'); if(!r){ r='ps-'+Math.random().toString(36).slice(2,10); localStorage.setItem('liteworship-room',r); } return r; }

function connectRemoteWS(room,onMessage){
  _remoteRoom=room; _onRemoteMessage=onMessage;
  if(typeof Paho==='undefined')return;
  if(mqttClient&&mqttClient.isConnected())return;
  const clientId='chromebook-'+Math.random().toString(36).slice(2,8);
  mqttClient=new Paho.Client('broker.hivemq.com',8884,'/mqtt',clientId);
  mqttClient.onConnectionLost=()=>{ remoteConnected=false; setTimeout(()=>connectRemoteWS(room,onMessage),3000); };
  mqttClient.onMessageArrived=msg=>{ try{ onMessage(JSON.parse(msg.payloadString)); }catch(_){} };
  mqttClient.connect({ useSSL:true, keepAliveInterval:30,
    onSuccess:function(){ remoteConnected=true; mqttClient.subscribe('liteworship/'+room+'/cmd'); },
    onFailure:function(){ remoteConnected=false; setTimeout(()=>connectRemoteWS(room,onMessage),4000); }
  });
}

function sendRemote(data){
  if(!mqttClient||!mqttClient.isConnected()||!_remoteRoom)return;
  const msg=new Paho.Message(JSON.stringify(data));
  msg.destinationName='liteworship/'+_remoteRoom+'/state';
  msg.retained=true;
  try{ mqttClient.send(msg); }catch(_){}
}

function publishRemoteState(){
  if(!mqttClient||!mqttClient.isConnected())return;
  const payload=state.liveRef?buildPayloadFromLive():{kind:'blank'};
  const full={
    type:'state', payload,
    slideIndex:state.liveRef?state.liveRef.slideIndex:0,
    totalSlides:state.liveRef&&state.liveRef.snapshot&&state.liveRef.snapshot.slides?songDisplaySlides(state.liveRef.snapshot).length:1,
    title:state.liveRef?(state.liveRef.snapshot.title||state.liveRef.snapshot.reference||''):'',
    list:(()=>{ const l=getCurrentList(); if(!l)return[]; return l.items.map(it=>({ type:it.type, title:it.title, refId:it.refId, biblePayload:it.biblePayload||null, isLive:!!(state.liveRef&&state.liveRef.collection===it.type&&state.liveRef.id===it.refId) })); })(),
    library:{ canciones:storage.list('canciones'), anuncios:storage.list('anuncios').map(a=>({id:a.id,title:a.title,type:a.type})), citas:storage.list('citas') },
    audio:{ files:state.audio.files.map((f,i)=>({name:f.name,index:i})), currentIndex:state.audio.currentIndex, playing:!state.audio.el.paused, currentTime:state.audio.el.currentTime, duration:state.audio.el.duration||0 },
    bibleState:{ bookIndex:bibleState.bookIndex, chapterIndex:bibleState.chapterIndex },
    ts:Date.now(),
  };
  sendRemote(full);
}

function handleRemoteMessage(msg){
  if(msg.type!=='cmd')return;
  // Nota: estas acciones pueden llegar en cualquier momento (p.ej. mientras
  // la pantalla local está en la sección Biblia, con el panel de proyección
  // reemplazado por el de versículos), así que nunca dependen de que un
  // botón concreto exista en el DOM en ese instante.
  if(msg.action==='prev') goPrevSlide();
  else if(msg.action==='next') goNextSlide();
  else if(msg.action==='clear') clearProjection();
  else if(msg.action==='project'&&msg.collection&&msg.refId){
    if(msg.collection==='biblia'&&msg.biblePayload){
      state.liveRef={collection:'biblia',id:msg.refId,slideIndex:0,snapshot:{title:msg.biblePayload.reference,text:msg.biblePayload.text,reference:msg.biblePayload.reference,slides:[msg.biblePayload.text]}};
      sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
    } else {
      const item=storage.list(msg.collection).find(x=>x.id===msg.refId);
      if(item){ projectItem(msg.collection,item,0); renderTimeline(); }
    }
  }
  else if(msg.action==='request-state') publishRemoteState();
  else if(msg.action==='audio-play'){ toggleAudioPlay(); publishRemoteState(); }
  else if(msg.action==='audio-next') audioNext();
  else if(msg.action==='audio-prev') audioRestart();
  else if(msg.action==='audio-select'&&typeof msg.index==='number') playAudioAt(msg.index);
  else if(msg.action==='audio-seek'&&typeof msg.ratio==='number'){
    if(state.audio.el.duration){ state.audio.el.currentTime=msg.ratio*state.audio.el.duration; publishRemoteState(); }
  }
  else if(msg.action==='bible-project'&&msg.biblePayload){
    state.liveRef={collection:'biblia',id:'bible-remote',slideIndex:0,snapshot:{title:msg.biblePayload.reference,text:msg.biblePayload.text,reference:msg.biblePayload.reference,slides:[msg.biblePayload.text]}};
    sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
  }
}

// Botón de control remoto
document.getElementById('btnRemoteControl').addEventListener('click',()=>{
  const existing=document.getElementById('qrOverlay');
  if(existing){ existing.remove(); document.getElementById('btnRemoteControl').classList.remove('active'); return; }
  state.audio.el.play().then(()=>{ state.audio.el.pause(); state.audio.el.currentTime=0; }).catch(()=>{});
  const room=getRemoteRoom();
  if(!mqttClient||!mqttClient.isConnected()) connectRemoteWS(room,handleRemoteMessage);
  const base=window.location.href.split('?')[0].replace(/\/[^/]*$/,'/');
  const remoteUrl=base+'remote.html?room='+room;
  const overlay=document.createElement('div');
  overlay.id='qrOverlay'; overlay.className='qr-overlay';
  overlay.innerHTML=`<div class="qr-card"><h3>📱 Control Remoto</h3><p>Escanea con la cámara del celular o tablet. Ambos dispositivos necesitan internet.</p><div id="qrCanvas"></div><div class="qr-url">${remoteUrl}</div><button class="btn btn-ghost" id="btnCloseQR" style="width:100%;justify-content:center;">Cerrar</button></div>`;
  document.body.appendChild(overlay);
  try{ new QRCode(document.getElementById('qrCanvas'),{text:remoteUrl,width:200,height:200,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}); }
  catch(e){ document.getElementById('qrCanvas').textContent='Copia el enlace de abajo.'; }
  document.getElementById('btnCloseQR').addEventListener('click',()=>{ overlay.remove(); document.getElementById('btnRemoteControl').classList.remove('active'); });
  overlay.addEventListener('click',e=>{ if(e.target===overlay){ overlay.remove(); document.getElementById('btnRemoteControl').classList.remove('active'); } });
  document.getElementById('btnRemoteControl').classList.add('active');
});

// ── ACERCA DE / LICENCIA ──
document.getElementById('btnAbout').addEventListener('click', () => {
  const existing = document.getElementById('aboutModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'aboutModal';
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" style="width:520px;max-width:92vw;max-height:85vh;overflow-y:auto;">
      <div style="text-align:center;margin-bottom:18px;">
        <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(145deg,#E8AA4C,#b8821c);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-weight:800;color:#1a1005;font-size:22px;">LW</div>
        <h2 style="margin:0 0 4px;font-size:20px;">LiteWorship</h2>
        <p style="margin:0;font-size:12px;color:var(--text-faint);">Versión 1.0 &nbsp;·&nbsp; © 2026 Emanuel Marzano</p>
      </div>
      <div style="font-size:12.5px;line-height:1.7;color:var(--text-muted);border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--bg);">
        <p style="font-weight:700;color:var(--text);margin-bottom:12px;">LICENCIA DE USO — LiteWorship v1.0</p>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">1. Propiedad intelectual</p>
        <p style="margin-bottom:12px;">LiteWorship, incluyendo su código fuente, diseño, interfaz gráfica, estructura, arquitectura, documentación y demás elementos que lo integran, es una obra intelectual creada y desarrollada por <strong style="color:var(--amber);">Emanuel Marzano (Mr.X)</strong>. Todos los derechos de propiedad intelectual pertenecen exclusivamente al autor.</p>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">2. Licencia de uso</p>
        <p style="margin-bottom:12px;">Se concede al usuario una licencia personal, limitada, no exclusiva, revocable e intransferible para utilizar LiteWorship conforme a los términos de este documento. La presente licencia no transfiere la propiedad del software ni concede derechos sobre su código fuente o elementos internos.</p>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">3. Usos permitidos</p>
        <p style="margin-bottom:4px;">El usuario puede:</p>
        <ul style="margin:0 0 12px 18px;">
          <li>Utilizar LiteWorship para la proyección y administración de contenido en iglesias u organizaciones autorizadas.</li>
          <li>Instalar el software en los equipos necesarios para su funcionamiento.</li>
          <li>Recibir las actualizaciones que el autor publique, cuando estén disponibles.</li>
        </ul>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">4. Restricciones</p>
        <p style="margin-bottom:4px;">Queda estrictamente prohibido:</p>
        <ul style="margin:0 0 12px 18px;">
          <li>Copiar total o parcialmente el código fuente.</li>
          <li>Descompilar, modificar o crear versiones derivadas del software.</li>
          <li>Distribuir el software como propio.</li>
          <li>Comercializar, vender, alquilar o sublicenciar el software sin autorización escrita del autor.</li>
          <li>Eliminar o modificar los créditos, avisos de copyright o referencias al autor.</li>
          <li>Utilizar el software como base para desarrollar un producto similar con fines comerciales.</li>
        </ul>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">5. Distribución</p>
        <p style="margin-bottom:12px;">LiteWorship únicamente podrá distribuirse por los medios autorizados por el autor. Cualquier distribución realizada por terceros requerirá autorización expresa y por escrito del autor.</p>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">6. Actualizaciones</p>
        <p style="margin-bottom:12px;">El autor podrá publicar nuevas versiones, corregir errores, incorporar nuevas funciones, modificar la forma de distribución y crear versiones gratuitas o comerciales. No existe obligación de proporcionar actualizaciones permanentes.</p>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">7. Limitación de responsabilidad</p>
        <p style="margin-bottom:12px;">LiteWorship se proporciona "tal cual", sin garantías explícitas o implícitas respecto a su funcionamiento en todos los entornos. El autor no será responsable por pérdidas de información, interrupciones del servicio o daños derivados del uso del software.</p>

        <p style="font-weight:600;color:var(--text);margin-bottom:4px;">8. Derechos reservados</p>
        <p>Todos los derechos que no sean expresamente otorgados mediante esta licencia permanecen reservados al autor.</p>
      </div>
      <p style="text-align:center;margin-top:14px;font-size:11px;color:var(--text-faint);">Autor y desarrollador: <strong style="color:var(--amber);">Emanuel Marzano (Mr.X)</strong><br>© 2026 Todos los derechos reservados.</p>
      <div class="btn-row" style="justify-content:center;margin-top:14px;">
        <button class="btn btn-ghost" id="btnCloseAbout">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('btnCloseAbout').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
});

// ── TECLADO: flechas para navegar diapositivas ──
document.addEventListener('keydown', (e) => {
  // Ignorar si el foco está en un input, textarea o select
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    document.getElementById('btnNextSlide')?.click();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    document.getElementById('btnPrevSlide')?.click();
  } else if (e.key === 'Escape') {
    // Limpiar proyección con Escape
    clearProjection();
  }
});

// ── INICIO ──
boot();
