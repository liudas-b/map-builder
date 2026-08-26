// Data access for the editor.
//
// Two backends, chosen once at load time:
//
//   'server'  the local Python server — textures, models and saves all live on
//             disk and everything is read/write.
//   'static'  a built site with no backend (GitHub Pages). Bundled data comes
//             from data/manifest.json and is read-only; anything you save is
//             kept in this browser's localStorage and never leaves the device.
//
// Every URL is built relative to the document so the app works both at the
// server root (http://localhost:8420/) and under a project sub-path
// (https://user.github.io/map-builder/).

const BASE = new URL('.', document.baseURI).href;

export function url(rel) {
  return BASE + String(rel).replace(/^\//, '');
}

async function j(u, opts) {
  const res = await fetch(u, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ------------------------------------------------------------ backend pick
// The build writes data/manifest.json; the Python server has no such file.
let manifest = null;
try {
  const res = await fetch(url('data/manifest.json'), { cache: 'no-cache' });
  if (res.ok) manifest = await res.json();
} catch { /* offline, or no such file: fall back to the server backend */ }

export const MODE = manifest ? 'static' : 'server';
export const isStatic = MODE === 'static';

// ------------------------------------------------------------ local storage
// One key per save, so one big document can never take the whole store with it.
const LS_PREFIX = 'mb.save.';
const lsKey = (type, id) => `${LS_PREFIX}${type}.${id}`;

function localList(type) {
  const out = [];
  const head = `${LS_PREFIX}${type}.`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(head)) continue;
    try {
      const doc = JSON.parse(localStorage.getItem(k));
      if (doc && doc.id) out.push(doc);
    } catch { /* skip a corrupt entry rather than break the whole list */ }
  }
  return out;
}

function localGet(type, id) {
  const raw = localStorage.getItem(lsKey(type, id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

const meta = (doc, local) => ({
  id: doc.id,
  name: doc.name,
  tags: doc.tags || [],
  created: doc.created || 0,
  modified: doc.modified || 0,
  thumb: doc.thumb || '',
  local: !!local,
});

// ------------------------------------------------------------ static backend
const bundled = (type) => (manifest?.saves?.[type] || []);

const staticApi = {
  textures: async () => ({ textures: manifest.textures || [], categories: manifest.categories || [] }),
  models: async () => ({ models: manifest.models || [] }),

  upload: async () => {
    throw new Error('Uploads need the desktop Map Builder — this build has no server to store files on.');
  },

  listSaves: async (type) => {
    const byId = new Map();
    for (const doc of bundled(type)) byId.set(doc.id, meta(doc, false));
    for (const doc of localList(type)) byId.set(doc.id, meta(doc, true));
    return [...byId.values()].sort((a, b) => b.modified - a.modified);
  },

  getSave: async (type, id) => {
    const doc = localGet(type, id) || bundled(type).find(d => d.id === id);
    if (!doc) throw new Error('not found');
    return doc;
  },

  putSave: async (type, body) => {
    const now = Date.now();
    const id = body.id || `${slugify(body.name)}-${now}`;
    const prev = localGet(type, id) || bundled(type).find(d => d.id === id);
    const doc = {
      id,
      name: body.name || 'Untitled',
      tags: body.tags || [],
      created: prev?.created || now,
      modified: now,
      thumb: body.thumb || '',
      data: body.data || {},
    };
    try {
      localStorage.setItem(lsKey(type, id), JSON.stringify(doc));
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
      throw new Error(quota
        ? 'This browser is out of room for saves. Delete a save kept on this device, or export the ones you want to keep.'
        : 'Could not save on this device: ' + e.message);
    }
    return { ok: true, id, modified: now };
  },

  deleteSave: async (type, id) => {
    if (!localGet(type, id)) {
      throw new Error('This save ships with the site — it can only be changed in the desktop app.');
    }
    localStorage.removeItem(lsKey(type, id));
    return { ok: true };
  },
};

// ------------------------------------------------------------ server backend
const serverApi = {
  textures: () => j(url('api/textures')),
  models: () => j(url('api/models')),

  upload: (category, filename, dataUrl) =>
    j(url('api/upload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, filename, dataUrl }),
    }),

  listSaves: (type) => j(url(`api/saves/${type}`)).then(r => r.saves),
  getSave: (type, id) => j(url(`api/saves/${type}/${encodeURIComponent(id)}`)),
  putSave: (type, doc) =>
    j(url(`api/saves/${type}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),
  deleteSave: (type, id) =>
    j(url(`api/saves/${type}/${encodeURIComponent(id)}`), { method: 'DELETE' }),
};

const backend = isStatic ? staticApi : serverApi;

export const api = {
  mode: MODE,
  canUpload: !isStatic,
  textures: () => backend.textures(),
  models: () => backend.models(),
  upload: (category, filename, dataUrl) => backend.upload(category, filename, dataUrl),
  // server saves are all writable; static ones only when they live on this device
  listSaves: (type) => backend.listSaves(type).then(l => l.map(m => ({ local: !isStatic, ...m }))),
  getSave: (type, id) => backend.getSave(type, id),
  putSave: (type, doc) => backend.putSave(type, doc),
  deleteSave: (type, id) => backend.deleteSave(type, id),

  // Can this save be overwritten / deleted where it currently lives?
  isWritable: (m) => !isStatic || !!m.local,
};

// ------------------------------------------------------------ export / import
// In static mode saves live in the browser, so these are the way to move work
// between a phone and a machine running the desktop app.

export function downloadSave(doc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.id || slugify(doc.name)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importSaveFile(type, file) {
  const doc = JSON.parse(await file.text());
  if (!doc || typeof doc !== 'object' || !doc.data) throw new Error(`${file.name} is not a Map Builder save`);
  // A fresh id keeps an imported copy from silently shadowing a bundled save.
  const id = doc.id && !bundled(type).some(d => d.id === doc.id) ? doc.id : null;
  return api.putSave(type, {
    id,
    name: doc.name || file.name.replace(/\.json$/i, ''),
    tags: doc.tags || [],
    data: doc.data,
    thumb: doc.thumb || '',
  });
}

// URL for a texture path relative to TextureAssets
export function texUrl(path) {
  return url('assets/' + path.split('/').map(encodeURIComponent).join('/'));
}
