// bible.js — Módulo Biblia RVR60
// Descarga los datos de la Biblia una sola vez y los guarda en IndexedDB para uso offline.

const BIBLE_URL = './bible_rv1960.json';

const bible = {
  data: null,        // array de libros
  loading: false,
  loaded: false,

  BOOK_NAMES: [
    'Génesis','Éxodo','Levítico','Números','Deuteronomio','Josué','Jueces','Rut',
    '1 Samuel','2 Samuel','1 Reyes','2 Reyes','1 Crónicas','2 Crónicas','Esdras',
    'Nehemías','Ester','Job','Salmos','Proverbios','Eclesiastés','Cantares','Isaías',
    'Jeremías','Lamentaciones','Ezequiel','Daniel','Oseas','Joel','Amós','Abdías',
    'Jonás','Miqueas','Nahúm','Habacuc','Sofonías','Hageo','Zacarías','Malaquías',
    'Mateo','Marcos','Lucas','Juan','Hechos','Romanos','1 Corintios','2 Corintios',
    'Gálatas','Efesios','Filipenses','Colosenses','1 Tesalonicenses','2 Tesalonicenses',
    '1 Timoteo','2 Timoteo','Tito','Filemón','Hebreos','Santiago','1 Pedro','2 Pedro',
    '1 Juan','2 Juan','3 Juan','Judas','Apocalipsis'
  ],

  OT_COUNT: 39,  // primeros 39 libros = Antiguo Testamento

  // Versión del archivo de la Biblia — cambiar cuando se actualice el JSON
  CACHE_VERSION: 'rv1960-local-v1',

  async load(onProgress) {
    if (this.loaded) return true;
    if (this.loading) return false;
    this.loading = true;

    // Intentar desde caché IndexedDB solo si es la versión correcta
    try {
      const cached = await bibleCache.get();
      if (cached && cached.version === this.CACHE_VERSION && Array.isArray(cached.data) && cached.data.length >= 66) {
        this.data = cached.data;
        this.loaded = true;
        this.loading = false;
        return true;
      }
    } catch (e) {}

    // Cargar desde el archivo local incluido en la app
    try {
      if (onProgress) onProgress('Cargando Biblia RVR60...');
      const res = await fetch(BIBLE_URL);
      if (!res.ok) throw new Error('Error al cargar el archivo de la Biblia');
      const raw = await res.json();
      this.data = this._normalize(raw);

      // Guardar en caché con versión
      if (onProgress) onProgress('Preparando para uso offline...');
      await bibleCache.set({ version: this.CACHE_VERSION, data: this.data });
      this.loaded = true;
      this.loading = false;
      return true;
    } catch (e) {
      this.loading = false;
      return false;
    }
  },

  _normalize(raw) {
    // El JSON local ya tiene el formato {name, chapters} correcto
    return raw;
  },

  getBook(bookIndex) {
    if (!this.data || !this.data[bookIndex]) return null;
    return this.data[bookIndex];
  },

  getChapter(bookIndex, chapterIndex) {
    const book = this.getBook(bookIndex);
    if (!book || !book.chapters[chapterIndex]) return [];
    return book.chapters[chapterIndex];
  },

  getVerse(bookIndex, chapterIndex, verseIndex) {
    const ch = this.getChapter(bookIndex, chapterIndex);
    return ch[verseIndex] || '';
  },

  // Construir el texto para proyección
  buildVersePayload(bookIndex, chapterIndex, verseStart, verseEnd) {
    const book = this.getBook(bookIndex);
    const chapter = this.getChapter(bookIndex, chapterIndex);
    const start = Math.min(verseStart, verseEnd);
    const end = Math.max(verseStart, verseEnd);
    const verses = chapter.slice(start, end + 1);
    const text = verses.map((v, i) => `${start + i + 1} ${v}`).join('\n');
    const reference = `${book.name} ${chapterIndex + 1}:${start + 1}${end > start ? '-' + (end + 1) : ''}`;
    return { kind: 'verse', text, reference };
  },
};
