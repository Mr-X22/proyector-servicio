// storage.js — maneja la carpeta de datos local (File System Access API)
const DB_NAME = 'proyector-db';
const STORE = 'handles';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains('bible')) db.createObjectStore('bible');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value, storeName) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName || STORE, 'readwrite');
    tx.objectStore(storeName || STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key, storeName) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName || STORE, 'readonly');
    const req = tx.objectStore(storeName || STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Bible cache in IndexedDB
const bibleCache = {
  async get() { return idbGet('bibleData', 'bible'); },
  async set(data) { return idbSet('bibleData', data, 'bible'); },
};

const DEFAULTS = {
  'canciones.json': { items: [] },
  'anuncios.json':  { items: [] },
  'citas.json':     { items: [] },
  'listas.json':    { items: [] },
};

class Storage {
  constructor() { this.dirHandle = null; this.cache = {}; }

  get supported() { return 'showDirectoryPicker' in window; }

  async restore() {
    const handle = await idbGet('rootDir');
    if (!handle) return false;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      this.dirHandle = handle;
      await this._loadAll();
      return true;
    }
    this.dirHandle = handle;
    return 'needs-permission';
  }

  async requestPermission() {
    if (!this.dirHandle) return false;
    const perm = await this.dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { await this._loadAll(); return true; }
    return false;
  }

  async chooseFolder() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    this.dirHandle = handle;
    await idbSet('rootDir', handle);
    await this._loadAll();
    return true;
  }

  async folderExists() {
    if (!this.dirHandle) return false;
    try { for await (const _ of this.dirHandle.values()) { break; } return true; }
    catch (e) { return false; }
  }

  async _loadAll() {
    for (const fname of Object.keys(DEFAULTS)) {
      this.cache[fname] = await this._readFile(fname);
    }
  }

  async _readFile(fname) {
    try {
      const fh = await this.dirHandle.getFileHandle(fname, { create: true });
      const file = await fh.getFile();
      const text = await file.text();
      if (!text.trim()) return JSON.parse(JSON.stringify(DEFAULTS[fname]));
      return JSON.parse(text);
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS[fname])); }
  }

  async _writeFile(fname) {
    const fh = await this.dirHandle.getFileHandle(fname, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(this.cache[fname], null, 2));
    await writable.close();
  }

  // Sin límites de elementos
  list(collection) {
    const fname = `${collection}.json`;
    return (this.cache[fname] && this.cache[fname].items) || [];
  }

  async save(collection, item) {
    const fname = `${collection}.json`;
    if (!this.cache[fname]) this.cache[fname] = { items: [] };
    const items = this.cache[fname].items;
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    await this._writeFile(fname);
  }

  async remove(collection, id) {
    const fname = `${collection}.json`;
    if (!this.cache[fname]) return;
    this.cache[fname].items = this.cache[fname].items.filter((i) => i.id !== id);
    await this._writeFile(fname);
  }

  getLists() { return (this.cache['listas.json'] && this.cache['listas.json'].items) || []; }

  async saveList(list) {
    if (!this.cache['listas.json']) this.cache['listas.json'] = { items: [] };
    const items = this.cache['listas.json'].items;
    const idx = items.findIndex((i) => i.id === list.id);
    if (idx >= 0) items[idx] = list; else items.push(list);
    await this._writeFile('listas.json');
  }

  async removeList(id) {
    this.cache['listas.json'].items = this.cache['listas.json'].items.filter((i) => i.id !== id);
    await this._writeFile('listas.json');
  }
}

const storage = new Storage();
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
