// Thin wrappers around the local server API.

async function j(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const api = {
  textures: () => j('/api/textures'),

  upload: (category, filename, dataUrl) =>
    j('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, filename, dataUrl }),
    }),

  listSaves: (type) => j(`/api/saves/${type}`).then(r => r.saves),
  getSave: (type, id) => j(`/api/saves/${type}/${encodeURIComponent(id)}`),
  putSave: (type, doc) =>
    j(`/api/saves/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),
  deleteSave: (type, id) =>
    j(`/api/saves/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// URL for a texture path relative to TextureAssets
export function texUrl(path) {
  return '/assets/' + path.split('/').map(encodeURIComponent).join('/');
}
