// app.js — lógica de la ventana de Control

const channel = new BroadcastChannel('proyector-sync');
let projectorWindow = null;

const state = {
  section: 'canciones', // canciones | anuncios | citas | audio
  selectedId: null,
  editingDraft: null, // item siendo editado (objeto temporal)
  currentList: null,
  liveRef: null, // { kind, collection, id, slideIndex }
  audio: {
    dirHandle: null,
    files: [], // [{name, handle}]
    queue: [], // indices en files
    currentIndex: -1,
    el: new Audio(),
  },
};

const SECTION_META = {
  canciones: { title: 'Letras de canciones', collection: 'canciones', limit: 10, addLabel: '+ Agregar letra nueva' },
  anuncios: { title: 'Anuncios', collection: 'anuncios', limit: 10, addLabel: '+ Agregar anuncio' },
  citas: { title: 'Citas bíblicas', collection: 'citas', limit: 10, addLabel: '+ Agregar cita' },
};

// ---------- util ----------
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('toastRoot').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstChild;
}

// ---------- arranque / carpeta ----------
async function boot() {
  if (!storage.supported) {
    document.getElementById('editor').innerHTML = `<div class="editor-empty"><p>Este navegador no soporta acceso a carpetas locales (File System Access API). Usa Chrome/ChromeOS actualizado.</p></div>`;
    return;
  }
  const status = await storage.restore();
  if (status === true) {
    // Aunque tengamos handle y permiso, verificar que la carpeta aún exista físicamente
    const exists = await storage.folderExists();
    if (!exists) {
      showFolderGate('deleted');
      return;
    }
    afterDataReady();
  } else if (status === 'needs-permission') {
    showFolderGate('needs-permission');
  } else {
    showFolderGate('new');
  }
}

// mode: 'new' | 'needs-permission' | 'deleted'
function showFolderGate(mode) {
  const messages = {
    'new': {
      icon: '📁',
      title: 'Bienvenido a Proyector de Servicio',
      body: 'Para empezar, crea o elige la carpeta donde se guardarán tus canciones, anuncios, citas y listas de servicio. Esta carpeta quedará fija y no debes borrarla.',
      btn: 'Crear / Elegir carpeta de datos',
    },
    'needs-permission': {
      icon: '🔑',
      title: 'Se necesita acceso a tu carpeta',
      body: 'La app recuerda tu carpeta de datos, pero necesita que confirmes el acceso cada vez que se abre. Dale clic al botón para continuar.',
      btn: 'Conceder acceso a mi carpeta',
    },
    'deleted': {
      icon: '⚠️',
      title: 'No se encontró la carpeta de datos',
      body: 'La carpeta donde se guardaban tus datos fue borrada o movida. Debes crear o elegir una nueva carpeta para poder usar la aplicación. Si la moviste a otro lugar, búscala y selecciónala.',
      btn: 'Crear / Elegir carpeta de datos',
    },
  };
  const m = messages[mode];

  // Bloquea toda la interfaz con un overlay hasta que se resuelva
  let overlay = document.getElementById('folderOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'folderOverlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','background:rgba(20,24,31,.92)',
      'display:flex','align-items:center','justify-content:center',
      'z-index:999','flex-direction:column','gap:0',
    ].join(';');
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:38px 40px;max-width:420px;width:90%;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">${m.icon}</div>
      <h2 style="margin:0 0 12px;font-size:19px;color:var(--text);">${m.title}</h2>
      <p style="color:var(--text-muted);font-size:13.5px;line-height:1.6;margin:0 0 28px;">${m.body}</p>
      <button class="btn btn-primary" id="btnChooseFolder" style="width:100%;justify-content:center;padding:12px;">
        ${m.btn}
      </button>
      ${mode === 'deleted' ? `<p style="margin-top:14px;font-size:11.5px;color:var(--text-faint);">Si no recuerdas dónde estaba, crea una carpeta nueva — el sistema pedirá que la confirmes cada vez que abras la app, igual que siempre.</p>` : ''}
    </div>`;

  document.getElementById('btnChooseFolder').onclick = async () => {
    try {
      let success = false;
      if (mode === 'needs-permission') {
        success = await storage.requestPermission();
        if (!success) { return; } // usuario canceló, dejar el overlay visible
      } else {
        await storage.chooseFolder();
        success = true;
      }
      if (success) {
        overlay.remove();
        afterDataReady();
      }
    } catch (e) {
      // usuario canceló el selector de carpeta — el overlay permanece visible
    }
  };
}

function afterDataReady() {
  renderLibrary();
  renderEditorEmpty();
  renderListSelect();
  renderTimeline();
}

// ---------- secciones / rail ----------
document.querySelectorAll('.rail-btn[data-section]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rail-btn[data-section]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.section = btn.dataset.section;
    state.selectedId = null;
    if (state.section === 'audio') {
      renderAudioSection();
    } else {
      renderLibrary();
      renderEditorEmpty();
    }
  });
});

function renderAudioSection() {
  document.getElementById('libTitle').textContent = 'Carpeta de audio';
  document.getElementById('libCount').textContent = `${state.audio.files.length}`;
  document.getElementById('btnAdd').textContent = '+ Elegir carpeta de audio';
  document.getElementById('libSearch').value = '';
  const list = document.getElementById('libList');
  list.innerHTML = '';
  if (!state.audio.files.length) {
    list.appendChild(el(`<div class="lib-empty">No hay carpeta de audio seleccionada todavía. Usa "Elegir carpeta de audio".</div>`));
  } else {
    state.audio.files.forEach((f, i) => {
      const item = el(`
        <div class="lib-item ${state.audio.currentIndex === i ? 'selected' : ''}">
          <div class="lib-item-row">
            <div>
              <div class="t-title">${escapeHtml(f.name)}</div>
              <div class="t-sub">Pista de audio</div>
            </div>
            <div class="lib-item-actions">
              <button class="icon-btn" title="Reproducir">▶</button>
            </div>
          </div>
        </div>`);
      item.addEventListener('click', () => playAudioAt(i));
      list.appendChild(item);
    });
  }
  document.getElementById('editor').innerHTML = `
    <div class="editor-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <p>El reproductor de audio es independiente de las letras de canciones.<br>Elige una pista de la lista para reproducirla. Usa los controles del panel derecho para pausar, avanzar o retroceder.</p>
    </div>`;
}

async function ensureDataFolder() {
  if (storage.dirHandle) return true;
  try {
    await storage.chooseFolder();
    renderListSelect();
    renderTimeline();
    return true;
  } catch (e) {
    toast('Necesitas elegir una carpeta para poder guardar.');
    return false;
  }
}

document.getElementById('btnAdd').addEventListener('click', async () => {
  if (state.section === 'audio') {
    await chooseAudioFolder();
    return;
  }
  if (!(await ensureDataFolder())) return;
  openEditorFor(null);
});

// ---------- biblioteca (lista izquierda) ----------
function renderLibrary() {
  const meta = SECTION_META[state.section];
  document.getElementById('libTitle').textContent = meta.title;
  const items = storage.list(meta.collection);
  document.getElementById('libCount').textContent = `${items.length}/${meta.limit}`;
  document.getElementById('btnAdd').textContent = meta.addLabel;
  document.getElementById('btnAdd').disabled = storage.limitReached(meta.collection);

  const query = document.getElementById('libSearch').value.trim().toLowerCase();
  const filtered = items.filter((i) => {
    const t = (i.title || i.reference || '').toLowerCase();
    return t.includes(query);
  });

  const list = document.getElementById('libList');
  list.innerHTML = '';
  if (!filtered.length) {
    list.appendChild(el(`<div class="lib-empty">${items.length ? 'Sin resultados.' : 'Todavía no hay elementos. Agrega el primero.'}</div>`));
    return;
  }
  filtered.forEach((item) => {
    const title = item.title || item.reference;
    const sub = state.section === 'canciones' ? (item.author || 'Sin autor') + ` · ${item.slides.length} diapositiva(s)`
      : state.section === 'anuncios' ? (item.type === 'image' ? 'Imagen' : 'Texto')
      : 'Cita bíblica';
    const row = el(`
      <div class="lib-item ${state.selectedId === item.id ? 'selected' : ''}">
        <div class="lib-item-row">
          <div>
            <div class="t-title">${escapeHtml(title)}</div>
            <div class="t-sub">${escapeHtml(sub)}</div>
          </div>
          <div class="lib-item-actions">
            <button class="icon-btn" data-act="project" title="Proyectar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg></button>
            <button class="icon-btn danger" data-act="delete" title="Eliminar">✕</button>
          </div>
        </div>
      </div>`);
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="delete"]')) {
        deleteItem(item.id);
        return;
      }
      if (e.target.closest('[data-act="project"]')) {
        projectItem(meta.collection, item, 0);
        return;
      }
      state.selectedId = item.id;
      openEditorFor(item);
    });
    list.appendChild(row);
  });
}

document.getElementById('libSearch').addEventListener('input', () => { if (state.section !== 'audio') renderLibrary(); });

async function deleteItem(id) {
  const meta = SECTION_META[state.section];
  if (!confirm('¿Eliminar este elemento? Esta acción no se puede deshacer.')) return;
  await storage.remove(meta.collection, id);
  if (state.selectedId === id) { state.selectedId = null; renderEditorEmpty(); }
  renderLibrary();
}

function renderEditorEmpty() {
  document.getElementById('editor').innerHTML = `
    <div class="editor-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p>Selecciona un elemento de la lista o agrega uno nuevo.</p>
    </div>`;
}

// ---------- editor ----------
function openEditorFor(item) {
  if (state.section === 'canciones') return renderSongEditor(item);
  if (state.section === 'anuncios') return renderAnnouncementEditor(item);
  if (state.section === 'citas') return renderVerseEditor(item);
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- canciones -----
function renderSongEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), title: '', author: '', slides: [''] };
  const editor = document.getElementById('editor');
  editor.innerHTML = `
    <div class="editor-toolbar">
      <h2>${isNew ? 'Nueva letra' : 'Editar letra'}</h2>
      <button class="btn btn-ghost" id="btnCancelEdit">Cancelar</button>
    </div>
    <div class="field-row split">
      <div>
        <label class="field-label">Título</label>
        <input class="field-input" id="songTitle" value="${escapeHtml(draft.title)}" placeholder="Nombre de la canción" />
      </div>
      <div>
        <label class="field-label">Autor</label>
        <input class="field-input" id="songAuthor" value="${escapeHtml(draft.author)}" placeholder="Autor / interprete" />
      </div>
    </div>
    <label class="field-label">Letra — distribuida en diapositivas (sin límite)</label>
    <div class="hint" style="margin-bottom:10px;">Divide la letra en bloques cortos para que no se vea saturada al proyectarse. Cada bloque es una diapositiva. Arrastra el encabezado "⠿" de un bloque para reordenarlo si escribiste una estrofa en el orden equivocado.</div>
    <div id="slideContainer"></div>
    <button class="btn" id="btnAddSlide">+ Agregar diapositiva</button>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveSong">Guardar letra</button>
      ${!isNew ? '<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar primera diapositiva</button>' : ''}
    </div>
  `;
  const container = document.getElementById('slideContainer');
  function renderSlides() {
    container.innerHTML = '';
    draft.slides.forEach((s, i) => {
      const block = el(`
        <div class="slide-block" draggable="true" data-i="${i}">
          <div class="slide-block-head">
            <span class="drag-handle" style="cursor:grab;">⠿ DIAPOSITIVA ${i + 1}</span>
            <button class="icon-btn danger" data-i="${i}" title="Eliminar diapositiva">✕</button>
          </div>
          <textarea class="field-input" rows="3" data-i="${i}" placeholder="Texto de esta diapositiva...">${escapeHtml(s)}</textarea>
        </div>`);
      block.querySelector('textarea').addEventListener('input', (e) => { draft.slides[i] = e.target.value; });
      block.querySelector('[data-act], .icon-btn').addEventListener('click', () => {
        if (draft.slides.length <= 1) { toast('Debe quedar al menos una diapositiva.'); return; }
        draft.slides.splice(i, 1);
        renderSlides();
      });
      block.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', i);
        block.style.opacity = '0.4';
      });
      block.addEventListener('dragend', () => { block.style.opacity = '1'; });
      block.addEventListener('dragover', (e) => e.preventDefault());
      block.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const to = i;
        if (from === to) return;
        const [moved] = draft.slides.splice(from, 1);
        draft.slides.splice(to, 0, moved);
        renderSlides();
      });
      container.appendChild(block);
    });
  }
  renderSlides();

  document.getElementById('btnAddSlide').addEventListener('click', () => { draft.slides.push(''); renderSlides(); });
  document.getElementById('btnCancelEdit').addEventListener('click', () => { state.selectedId = item ? item.id : null; if(item) openEditorFor(item); else renderEditorEmpty(); });
  document.getElementById('songTitle').addEventListener('input', (e) => draft.title = e.target.value);
  document.getElementById('songAuthor').addEventListener('input', (e) => draft.author = e.target.value);
  document.getElementById('btnSaveSong').addEventListener('click', async () => {
    if (!draft.title.trim()) { toast('Ponle un título a la canción.'); return; }
    draft.slides = draft.slides.filter((s) => s.trim().length || draft.slides.length === 1);
    try {
      await storage.save('canciones', draft);
      toast('Letra guardada.');
      state.selectedId = draft.id;
      renderLibrary();
      renderSongEditor(draft);
    } catch (e) { toast(e.message); }
  });
  const pf = document.getElementById('btnProjectFromEditor');
  if (pf) pf.addEventListener('click', () => projectItem('canciones', draft, 0));
}

// ----- anuncios -----
function renderAnnouncementEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), title: '', type: 'text', text: '', imageData: '' };
  const editor = document.getElementById('editor');
  editor.innerHTML = `
    <div class="editor-toolbar">
      <h2>${isNew ? 'Nuevo anuncio' : 'Editar anuncio'}</h2>
      <button class="btn btn-ghost" id="btnCancelEdit">Cancelar</button>
    </div>
    <label class="field-label">Título (referencia interna)</label>
    <div class="field-row"><input class="field-input" id="annTitle" value="${escapeHtml(draft.title)}" placeholder="Ej: Bienvenida, Reunión de jóvenes..." /></div>
    <div class="toggle-group" id="annToggle">
      <div class="toggle-opt ${draft.type === 'text' ? 'active' : ''}" data-t="text">Texto</div>
      <div class="toggle-opt ${draft.type === 'image' ? 'active' : ''}" data-t="image">Imagen</div>
    </div>
    <div id="annBody"></div>
    <div class="hint" style="margin-top:6px;">Cada anuncio se proyecta en una sola diapositiva.</div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveAnn">Guardar anuncio</button>
      ${!isNew ? '<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>' : ''}
    </div>
  `;
  function renderBody() {
    const body = document.getElementById('annBody');
    if (draft.type === 'text') {
      body.innerHTML = '';
      const ta = el(`<textarea class="field-input" rows="8" placeholder="Texto del anuncio...">${escapeHtml(draft.text)}</textarea>`);
      ta.addEventListener('input', (e) => draft.text = e.target.value);
      body.appendChild(ta);
    } else {
      body.innerHTML = '';
      const zone = el(`<div class="drop-zone">Haz clic para elegir una imagen<br><span style="font-size:11px;">JPG o PNG</span></div>`);
      const input = el(`<input type="file" accept="image/*" style="display:none;" />`);
      zone.appendChild(input);
      zone.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const f = input.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { draft.imageData = reader.result; renderBody(); };
        reader.readAsDataURL(f);
      });
      body.appendChild(zone);
      if (draft.imageData) {
        body.appendChild(el(`<img class="img-preview" src="${draft.imageData}" />`));
      }
    }
  }
  renderBody();
  document.querySelectorAll('#annToggle .toggle-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      draft.type = opt.dataset.t;
      document.querySelectorAll('#annToggle .toggle-opt').forEach((o) => o.classList.toggle('active', o === opt));
      renderBody();
    });
  });
  document.getElementById('annTitle').addEventListener('input', (e) => draft.title = e.target.value);
  document.getElementById('btnCancelEdit').addEventListener('click', () => { if(item) openEditorFor(item); else renderEditorEmpty(); });
  document.getElementById('btnSaveAnn').addEventListener('click', async () => {
    if (!draft.title.trim()) { toast('Ponle un título al anuncio.'); return; }
    if (draft.type === 'text' && !draft.text.trim()) { toast('Escribe el texto del anuncio.'); return; }
    if (draft.type === 'image' && !draft.imageData) { toast('Elige una imagen.'); return; }
    try {
      await storage.save('anuncios', draft);
      toast('Anuncio guardado.');
      state.selectedId = draft.id;
      renderLibrary();
      renderAnnouncementEditor(draft);
    } catch (e) { toast(e.message); }
  });
  const pf = document.getElementById('btnProjectFromEditor');
  if (pf) pf.addEventListener('click', () => projectItem('anuncios', draft, 0));
}

// ----- citas bíblicas -----
function renderVerseEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), reference: '', text: '' };
  const editor = document.getElementById('editor');
  editor.innerHTML = `
    <div class="editor-toolbar">
      <h2>${isNew ? 'Nueva cita bíblica' : 'Editar cita'}</h2>
      <button class="btn btn-ghost" id="btnCancelEdit">Cancelar</button>
    </div>
    <label class="field-label">Referencia</label>
    <div class="field-row"><input class="field-input" id="verseRef" value="${escapeHtml(draft.reference)}" placeholder="Ej: Juan 3:16" /></div>
    <label class="field-label">Texto del versículo</label>
    <div class="field-row"><textarea class="field-input" id="verseText" rows="6" placeholder="Escribe el texto del versículo...">${escapeHtml(draft.text)}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveVerse">Guardar cita</button>
      ${!isNew ? '<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>' : ''}
    </div>
  `;
  document.getElementById('verseRef').addEventListener('input', (e) => draft.reference = e.target.value);
  document.getElementById('verseText').addEventListener('input', (e) => draft.text = e.target.value);
  document.getElementById('btnCancelEdit').addEventListener('click', () => { if(item) openEditorFor(item); else renderEditorEmpty(); });
  document.getElementById('btnSaveVerse').addEventListener('click', async () => {
    if (!draft.reference.trim()) { toast('Ponle una referencia a la cita.'); return; }
    try {
      await storage.save('citas', draft);
      toast('Cita guardada.');
      state.selectedId = draft.id;
      renderLibrary();
      renderVerseEditor(draft);
    } catch (e) { toast(e.message); }
  });
  const pf = document.getElementById('btnProjectFromEditor');
  if (pf) pf.addEventListener('click', () => projectItem('citas', draft, 0));
}

// ---------- proyección ----------
function kindForCollection(collection) {
  return collection === 'canciones' ? 'song' : collection === 'anuncios' ? 'announcement' : 'verse';
}

// Construye las diapositivas que realmente se proyectan de una canción:
// la diapositiva 0 es automática (título + autor), seguida de las diapositivas de letra del usuario.
function songDisplaySlides(song) {
  return [{ isTitle: true, title: song.title, author: song.author }, ...song.slides.map((text) => ({ text }))];
}

function projectItem(collection, item, slideIndex) {
  state.liveRef = { collection, id: item.id, slideIndex: slideIndex || 0, snapshot: item };
  sendCurrentSlide();
  renderPreview();
  updateLiveBadge(true);
  highlightTimelineLive();
}

function buildPayloadFromLive() {
  const { collection, snapshot, slideIndex } = state.liveRef;
  const kind = kindForCollection(collection);
  if (kind === 'announcement' && snapshot.type === 'image') {
    return { kind: 'image', imageData: snapshot.imageData };
  }
  if (kind === 'song') {
    const slides = songDisplaySlides(snapshot);
    const s = slides[slideIndex] || slides[0];
    if (s.isTitle) {
      return { kind: 'song', text: s.title, reference: s.author ? s.author : undefined };
    }
    return { kind: 'song', text: s.text };
  }
  if (kind === 'verse') {
    return { kind: 'verse', text: snapshot.text, reference: snapshot.reference };
  }
  return { kind: 'announcement', text: snapshot.text };
}

function sendCurrentSlide() {
  if (!state.liveRef) {
    channel.postMessage({ type: 'content', payload: { kind: 'blank' } });
    return;
  }
  channel.postMessage({ type: 'content', payload: buildPayloadFromLive() });
}

function clearProjection() {
  state.liveRef = null;
  sendCurrentSlide();
  renderPreview();
  updateLiveBadge(false);
  highlightTimelineLive();
}

document.getElementById('btnClearProj').addEventListener('click', clearProjection);

function updateLiveBadge(on) {
  document.getElementById('liveBadge').classList.toggle('on', on);
  document.getElementById('liveText').textContent = on ? 'EN VIVO' : 'SIN SEÑAL';
  document.getElementById('dotLive').classList.toggle('on', on);
  document.getElementById('dotLive2').classList.toggle('on', on);
}

function renderPreview() {
  const frame = document.getElementById('projFrame');
  const slideNav = document.getElementById('slideNav');
  if (!state.liveRef) {
    frame.innerHTML = `<span class="ph-text" id="projFrameText">Nada en proyección</span>`;
    slideNav.classList.add('hidden');
    return;
  }
  const { collection, snapshot, slideIndex } = state.liveRef;
  const kind = kindForCollection(collection);
  if (kind === 'announcement' && snapshot.type === 'image') {
    frame.innerHTML = `<img src="${snapshot.imageData}" />`;
    slideNav.classList.add('hidden');
    return;
  }
  let text = '';
  let totalSlides = 1;
  if (kind === 'song') {
    const slides = songDisplaySlides(snapshot);
    totalSlides = slides.length;
    const s = slides[slideIndex] || slides[0];
    text = s.isTitle ? s.title + (s.author ? `\n${s.author}` : '') : s.text;
  } else if (kind === 'verse') {
    text = (snapshot.text || '') + (snapshot.reference ? `\n— ${snapshot.reference}` : '');
  } else {
    text = snapshot.text || '';
  }
  frame.innerHTML = `<span class="ph-text">${escapeHtml(text)}</span>`;

  if (kind === 'song' && totalSlides > 1) {
    slideNav.classList.remove('hidden');
    document.getElementById('slideCounter').textContent = `${slideIndex + 1}/${totalSlides}`;
  } else {
    slideNav.classList.add('hidden');
  }
}

document.getElementById('btnPrevSlide').addEventListener('click', () => {
  if (!state.liveRef) return;
  state.liveRef.slideIndex = Math.max(0, state.liveRef.slideIndex - 1);
  sendCurrentSlide(); renderPreview();
});
document.getElementById('btnNextSlide').addEventListener('click', () => {
  if (!state.liveRef) return;
  const max = songDisplaySlides(state.liveRef.snapshot).length - 1;
  state.liveRef.slideIndex = Math.min(max, state.liveRef.slideIndex + 1);
  sendCurrentSlide(); renderPreview();
});

channel.onmessage = (e) => {
  if (e.data && e.data.type === 'request-state') sendCurrentSlide();
};

// abrir ventana de proyección
function openProjectorWindow() {
  projectorWindow = window.open('projection.html', 'proyeccion', 'width=1280,height=720');
}
document.getElementById('btnProjectorWindow').addEventListener('click', openProjectorWindow);
document.getElementById('btnOpenProjector').addEventListener('click', openProjectorWindow);

// ---------- listas de servicio ----------
function renderListSelect() {
  const sel = document.getElementById('listSelect');
  const lists = storage.getLists();
  sel.innerHTML = lists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  if (!state.currentList && lists.length) state.currentList = lists[0].id;
  if (state.currentList) sel.value = state.currentList;
  if (!lists.length) sel.innerHTML = `<option>Sin listas — crea una</option>`;
}
document.getElementById('listSelect').addEventListener('change', (e) => {
  state.currentList = e.target.value;
  renderTimeline();
});
document.getElementById('btnNewList').addEventListener('click', async () => {
  if (!(await ensureDataFolder())) return;
  const name = prompt('Nombre de la nueva lista de servicio:', `Servicio ${new Date().toLocaleDateString('es-MX')}`);
  if (!name) return;
  const list = { id: uid(), name, items: [] };
  await storage.saveList(list);
  state.currentList = list.id;
  renderListSelect();
  renderTimeline();
});
document.getElementById('btnDeleteList').addEventListener('click', async () => {
  if (!state.currentList) return;
  if (!confirm('¿Borrar esta lista de servicio?')) return;
  await storage.removeList(state.currentList);
  state.currentList = null;
  renderListSelect();
  renderTimeline();
});

function getCurrentList() {
  return storage.getLists().find((l) => l.id === state.currentList) || null;
}

function renderTimeline() {
  const tl = document.getElementById('timeline');
  const list = getCurrentList();
  tl.innerHTML = '';
  if (!list) { tl.appendChild(el(`<div class="tl-empty">Crea una lista de servicio para empezar a organizar el orden del culto.</div>`)); return; }
  if (!list.items.length) { tl.appendChild(el(`<div class="tl-empty">Lista vacía — usa "Agregar a la lista" para sumar canciones, anuncios o citas.</div>`)); return; }

  list.items.forEach((it, idx) => {
    const isLive = state.liveRef && state.liveRef.collection === it.type && state.liveRef.id === it.refId;
    const node = el(`
      <div class="tl-item ${isLive ? 'live' : ''}" draggable="true" data-idx="${idx}">
        <button class="tl-remove" title="Quitar de la lista">✕</button>
        <div class="tl-type">${it.type}</div>
        <div class="tl-title">${escapeHtml(it.title)}</div>
      </div>`);
    node.addEventListener('click', (e) => {
      if (e.target.closest('.tl-remove')) {
        list.items.splice(idx, 1);
        storage.saveList(list).then(renderTimeline);
        return;
      }
      const item = storage.list(it.type).find((x) => x.id === it.refId);
      if (item) {
        projectItem(it.type, item, 0);
        renderTimeline();
      } else {
        toast('Este elemento ya no existe en la biblioteca.');
      }
    });
    node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', idx); });
    node.addEventListener('dragover', (e) => e.preventDefault());
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = idx;
      if (from === to) return;
      const [moved] = list.items.splice(from, 1);
      list.items.splice(to, 0, moved);
      storage.saveList(list).then(renderTimeline);
    });
    tl.appendChild(node);
  });
}

function highlightTimelineLive() { renderTimeline(); }

document.getElementById('btnAddToList').addEventListener('click', (e) => {
  const list = getCurrentList();
  if (!list) { toast('Primero crea una lista de servicio.'); return; }
  openAddMenu(e.currentTarget);
});

function openAddMenu(anchor) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = el(`
    <div class="menu" style="left:${rect.left - 320}px; top:${rect.top - 180}px;">
      <button data-c="canciones">🎵 Canción...</button>
      <button data-c="anuncios">📢 Anuncio...</button>
      <button data-c="citas">📖 Cita bíblica...</button>
    </div>`);
  document.body.appendChild(menu);
  const closeMenu = () => menu.remove();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  menu.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { openPickerModal(b.dataset.c); menu.remove(); });
  });
}

function openPickerModal(collection) {
  const items = storage.list(collection);
  const root = document.getElementById('modalRoot');
  const labelMap = { canciones: 'canción', anuncios: 'anuncio', citas: 'cita bíblica' };
  root.innerHTML = `
    <div class="modal-bg" id="modalBg">
      <div class="modal">
        <h3>Elige una ${labelMap[collection]}</h3>
        <div class="modal-list">
          ${items.length ? items.map((i) => `<div class="lib-item" data-id="${i.id}"><div class="t-title">${escapeHtml(i.title || i.reference)}</div></div>`).join('') : `<div class="lib-empty">No hay elementos guardados todavía.</div>`}
        </div>
        <div class="btn-row"><button class="btn btn-ghost" id="modalCancel">Cancelar</button></div>
      </div>
    </div>`;
  document.getElementById('modalCancel').addEventListener('click', () => root.innerHTML = '');
  document.getElementById('modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') root.innerHTML = ''; });
  root.querySelectorAll('.modal-list .lib-item').forEach((row) => {
    row.addEventListener('click', async () => {
      const item = items.find((i) => i.id === row.dataset.id);
      const list = getCurrentList();
      list.items.push({ type: collection, refId: item.id, title: item.title || item.reference });
      await storage.saveList(list);
      renderTimeline();
      root.innerHTML = '';
    });
  });
}

// ---------- audio ----------
async function chooseAudioFolder() {
  try {
    const handle = await window.showDirectoryPicker();
    state.audio.dirHandle = handle;
    state.audio.files = [];
    for await (const [name, h] of handle.entries()) {
      if (h.kind === 'file' && /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) {
        state.audio.files.push({ name, handle: h });
      }
    }
    state.audio.files.sort((a, b) => a.name.localeCompare(b.name));
    state.audio.queue = state.audio.files.map((_, i) => i);
    state.audio.currentIndex = -1;
    renderAudioSection();
    toast(`${state.audio.files.length} pistas encontradas.`);
  } catch (e) { /* cancelado */ }
}
document.getElementById('btnAudioFolder').addEventListener('click', chooseAudioFolder);

async function playAudioAt(i) {
  state.audio.currentIndex = i;
  const f = state.audio.files[i];
  const file = await f.handle.getFile();
  const url = URL.createObjectURL(file);
  state.audio.el.src = url;
  state.audio.el.play();
  document.getElementById('audioNow').textContent = f.name;
  document.getElementById('btnAudioPlay').textContent = '⏸';
  if (state.section === 'audio') renderAudioSection();
}

document.getElementById('btnAudioPlay').addEventListener('click', () => {
  if (state.audio.currentIndex === -1 && state.audio.files.length) { playAudioAt(0); return; }
  if (state.audio.el.paused) { state.audio.el.play(); document.getElementById('btnAudioPlay').textContent = '⏸'; }
  else { state.audio.el.pause(); document.getElementById('btnAudioPlay').textContent = '▶'; }
});
document.getElementById('btnAudioNext').addEventListener('click', () => {
  if (!state.audio.files.length) return;
  const next = (state.audio.currentIndex + 1) % state.audio.files.length;
  playAudioAt(next);
});
document.getElementById('btnAudioPrev').addEventListener('click', () => {
  // Reinicia la pista actual desde el principio, en vez de saltar a la pista anterior.
  if (state.audio.currentIndex === -1) return;
  state.audio.el.currentTime = 0;
  state.audio.el.play();
  document.getElementById('btnAudioPlay').textContent = '⏸';
});
state.audio.el.addEventListener('timeupdate', () => {
  const { currentTime, duration } = state.audio.el;
  if (duration && !state.audio.scrubbing) document.getElementById('audioProgressFill').style.width = `${(currentTime / duration) * 100}%`;
});
state.audio.el.addEventListener('ended', () => {
  document.getElementById('btnAudioNext').click();
});

// Permite hacer clic o arrastrar sobre la barra para moverse a cualquier punto de la pista.
const audioProgressBar = document.getElementById('audioProgress');
function seekFromEvent(e) {
  if (!state.audio.el.duration) return;
  const rect = audioProgressBar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  document.getElementById('audioProgressFill').style.width = `${ratio * 100}%`;
  state.audio.el.currentTime = ratio * state.audio.el.duration;
}
audioProgressBar.addEventListener('mousedown', (e) => {
  if (state.audio.currentIndex === -1) return;
  state.audio.scrubbing = true;
  seekFromEvent(e);
  const onMove = (ev) => seekFromEvent(ev);
  const onUp = () => {
    state.audio.scrubbing = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

// ---------- inicio ----------
boot();
