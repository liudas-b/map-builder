// All DOM UI: panels, texture browser, presets, modals, save browser.
import { state, doc, uid, nextOverlayOrder, MARKER_TYPES } from './state.js';
import { api, texUrl, isStatic, downloadSave, importSaveFile } from './api.js';

let App = null;
let textureClickHook = null;   // when set, texture clicks go to a dialog slot

export function setTextureClickHook(fn) { textureClickHook = fn; }

// ------------------------------------------------------------ dom helpers
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}
const $ = (id) => document.getElementById(id);

export function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isErr);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2400);
}

export function setHint(html) {
  $('hintbar').innerHTML = html;
  document.body.classList.toggle('has-hintbar', !!html);
}

// ------------------------------------------------------------ modals
export function openModal({ title, body, foot, narrow = false, floating = false, onClose }) {
  let root;
  const close = () => { root.remove(); textureClickHook = null; onClose?.(); };
  const head = el('div', { class: 'modal-head' },
    el('h2', { text: title }),
    el('button', { class: 'modal-close', text: '✕', onclick: close }));
  const modal = el('div', { class: 'modal' + (narrow ? ' narrow' : '') + (floating ? ' modal-float' : '') },
    head,
    el('div', { class: 'modal-body' }, ...(Array.isArray(body) ? body : [body])),
    foot ? el('div', { class: 'modal-foot' }, ...(Array.isArray(foot) ? foot : [foot])) : null,
  );
  if (floating) {
    root = modal;
    // draggable by the header so it can be moved out of the way
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.modal-close')) return;
      const r = modal.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      modal.style.right = 'auto';
      const move = (ev) => {
        modal.style.left = Math.max(0, ev.clientX - ox) + 'px';
        modal.style.top = Math.max(0, ev.clientY - oy) + 'px';
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  } else {
    root = el('div', { class: 'modal-backdrop' });
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.append(modal);
  }
  $('modalRoot').append(root);
  return close;
}

// ------------------------------------------------------------ texture browser
export function refreshBrowser() {
  const search = $('texSearch').value.trim().toLowerCase();
  const cat = $('texCategory').value;
  const grid = $('texGrid');
  grid.innerHTML = '';
  const items = state.textures.filter(t =>
    (!cat || t.category === cat || t.category.startsWith(cat + '/')) &&
    (!search || t.name.toLowerCase().includes(search) || t.category.toLowerCase().includes(search)));
  for (const t of items.slice(0, 400)) {
    const item = el('div', {
      class: 'tex-item' + (state.activeTexture === t.path ? ' active' : ''),
      title: t.category + ' / ' + t.name,
      onclick: () => {
        if (textureClickHook) { textureClickHook(t); return; }
        state.activeTexture = t.path;
        refreshBrowser();
        App.onActiveTextureChanged?.();
      },
    },
      el('img', { src: texUrl(t.path), loading: 'lazy' }),
      el('div', { class: 'tex-name', text: t.name }));
    grid.append(item);
  }
  if (!items.length) grid.append(el('p', { class: 'note', text: 'No textures match.' }));
}

export function fillCategorySelect(sel = $('texCategory'), withAll = true) {
  const current = sel.value;
  sel.innerHTML = '';
  if (withAll) sel.append(el('option', { value: '', text: 'All categories' }));
  // include parent folders so e.g. "Tokens" groups all its sub-folders
  const all = new Set();
  for (const c of state.categories) {
    const parts = c.split('/');
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  for (const c of [...all].sort((a, b) => a.localeCompare(b))) {
    const depth = c.split('/').length - 1;
    sel.append(el('option', { value: c, text: '  '.repeat(depth) + c.split('/').pop() }));
  }
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

// jump the category filter to the most relevant folder for the current tool
const toolCategory = {
  paint: 'GridTiles/Tiles', gameplay: 'GridTiles/Gameplay',
  custom: 'GridTiles/Customization', label: 'GridTiles/Labels',
  cube: '3D elements', token: 'Tokens',
};
export function autoCategory(tool) {
  const want = toolCategory[tool];
  if (!want) return;
  const sel = $('texCategory');
  if ([...sel.options].some(o => o.value === want)) { sel.value = want; refreshBrowser(); }
}

// ------------------------------------------------------------ upload
export function openUploadDialog() {
  const file = el('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,.gif,.svg', multiple: '' });
  const catSel = el('select');
  for (const c of state.categories) catSel.append(el('option', { value: c, text: c }));
  catSel.append(el('option', { value: '__new__', text: '➕ New category…' }));
  const newCat = el('input', { type: 'text', placeholder: 'e.g. GridTiles/Tiles/Winter', class: 'hidden' });
  catSel.addEventListener('change', () => newCat.classList.toggle('hidden', catSel.value !== '__new__'));

  const close = openModal({
    title: '⬆ Upload textures',
    narrow: true,
    body: [
      el('p', { class: 'note', text: 'Pick one or more image files, choose which category they belong to (this decides where they show up in the texture browser), then upload.' }),
      el('div', { class: 'frow' }, el('label', { text: 'Files' }), file),
      el('div', { class: 'frow' }, el('label', { text: 'Category' }), catSel),
      newCat,
    ],
    foot: el('button', {
      class: 'tb primary', text: 'Upload',
      onclick: async () => {
        const files = [...file.files];
        if (!files.length) return toast('Choose at least one file', true);
        const category = catSel.value === '__new__' ? newCat.value.trim() : catSel.value;
        if (!category) return toast('Enter a category name', true);
        try {
          for (const f of files) {
            const dataUrl = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(r.result); r.onerror = rej;
              r.readAsDataURL(f);
            });
            await api.upload(category, f.name, dataUrl);
          }
          close();
          await App.reloadTextures();
          $('texCategory').value = [...$('texCategory').options].some(o => o.value === category) ? category : '';
          refreshBrowser();
          toast(`Uploaded ${files.length} texture${files.length > 1 ? 's' : ''} ✓`);
        } catch (e) { toast('Upload failed: ' + e.message, true); }
      },
    }),
  });
}

// ------------------------------------------------------------ game assets (cards & characters)
const CARDS_CAT = 'Cards';
const CHARS_CAT = 'Characters';
const inCat = (item, cat) => item.category === cat || item.category.startsWith(cat + '/');

export function refreshGamePanels() {
  const cards = state.textures.filter(t => inCat(t, CARDS_CAT));
  const grid = $('cardsGrid');
  grid.innerHTML = '';
  for (const t of cards) {
    grid.append(el('div', {
      class: 'tex-item' + (state.gameSel?.kind === 'card' && state.gameSel.path === t.path ? ' active' : ''),
      title: t.name,
      onclick: () => App.selectGameAsset({ kind: 'card', path: t.path, name: t.name }),
    },
      el('img', { src: texUrl(t.path), loading: 'lazy' }),
      el('div', { class: 'tex-name', text: t.name })));
  }
  if (!cards.length) grid.append(el('p', { class: 'note', text: 'No cards yet. Upload card images below.' }));

  const chars = state.models.filter(m => inCat(m, CHARS_CAT));
  const list = $('charsList');
  list.innerHTML = '';
  for (const m of chars) {
    const isSel = state.gameSel?.kind === 'char' && state.gameSel.path === m.path;
    list.append(el('div', {
      class: 'lrow' + (isSel ? ' active' : ''),
      onclick: () => App.selectGameAsset({ kind: 'char', path: m.path, name: m.name }),
    },
      el('span', { class: 'char-ico', text: '🧍' }),
      el('span', { class: 'lname', text: m.name }),
      el('span', { class: 'badge cube', text: m.path.split('.').pop().toUpperCase() })));
  }
  if (!chars.length) list.append(el('p', { class: 'note', text: 'No character models yet. Upload .fbx / .glb files below.' }));
}

export function refreshGameInfo() {
  const body = $('gameInfoBody');
  body.innerHTML = '';
  const sel = state.gameSel;
  if (!sel) {
    body.append(el('p', { class: 'note', text: 'Select a card or character on the left to preview it in 3D.' }));
    return;
  }
  body.append(el('div', { class: 'props-head' },
    sel.kind === 'card' ? el('img', { class: 'props-thumb', src: texUrl(sel.path) })
      : el('div', { class: 'props-thumb char-thumb', text: '🧍' }),
    el('div', {},
      el('div', { class: 'kind', text: sel.name }),
      el('div', { class: 'sub', text: sel.kind === 'card' ? 'Card — 6.3 × 8.8 cm' : 'Character model' }))));
  body.append(el('p', { class: 'note', text: sel.kind === 'card'
    ? 'Cards are shown at physical size (63 × 88 mm) next to a 5 × 5 cm tile.'
    : 'Characters are auto-scaled to ≈4.2 cm tall on a 5 × 5 cm reference tile.' }));
  body.append(el('p', { class: 'note', text: sel.path }));
}

function openGameUploadDialog(kind) {
  const isCard = kind === 'card';
  const file = el('input', {
    type: 'file', multiple: '',
    accept: isCard ? '.png,.jpg,.jpeg,.webp' : '.fbx,.glb,.gltf,.obj',
  });
  const close = openModal({
    title: isCard ? '⬆ Upload cards' : '⬆ Upload characters',
    narrow: true,
    body: [
      el('p', { class: 'note', text: isCard
        ? `Card images (png/jpg). They are stored in TextureAssets/${CARDS_CAT} and appear in the Cards panel.`
        : `3D character models (.fbx, .glb, .obj). They are stored in TextureAssets/${CHARS_CAT} and appear in the Characters panel.` }),
      el('div', { class: 'frow' }, el('label', { text: 'Files' }), file),
    ],
    foot: el('button', {
      class: 'tb primary', text: 'Upload',
      onclick: async () => {
        const files = [...file.files];
        if (!files.length) return toast('Choose at least one file', true);
        try {
          for (const f of files) {
            const dataUrl = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(r.result); r.onerror = rej;
              r.readAsDataURL(f);
            });
            await api.upload(isCard ? CARDS_CAT : CHARS_CAT, f.name, dataUrl);
          }
          close();
          await App.reloadTextures();
          await App.reloadModels();
          refreshGamePanels();
          toast(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''} ✓`);
        } catch (e) { toast('Upload failed: ' + e.message, true); }
      },
    }),
  });
}
export const openCardUploadDialog = () => openGameUploadDialog('card');
export const openCharUploadDialog = () => openGameUploadDialog('char');

// ------------------------------------------------------------ preset panel (left)
const presetKindForTool = { cube: 'cubepreset', token: 'tokenpreset', stamp: 'tilepreset' };

export function refreshPresetPanel() {
  const kind = presetKindForTool[state.tool];
  const panel = $('presetPanel');
  if (!kind || state.mode !== 'sub') { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  $('presetTitle').textContent =
    kind === 'cubepreset' ? 'Cube Presets' : kind === 'tokenpreset' ? 'Token Presets' : 'Tile Presets';
  const list = $('presetList');
  list.innerHTML = '';
  const presets = state.presets[kind];
  if (!presets.length) {
    list.append(el('p', { class: 'note', text: kind === 'tilepreset'
      ? 'No tile presets yet. Select a painted tile and click "Save as tile preset".'
      : 'No presets yet. Click "New preset" below.' }));
  }
  for (const p of presets) {
    const thumbTex = p.data.top || p.data.ground?.tex || p.data.front;
    const card = el('div', {
      class: 'pcard' + (state.activePreset[kind]?.id === p.id ? ' active' : ''),
      title: p.name,
      onclick: () => { state.activePreset[kind] = p; refreshPresetPanel(); App.onPresetChanged?.(); },
    },
      thumbTex ? el('img', { src: texUrl(thumbTex), loading: 'lazy' }) : el('div', { class: 'pname', text: '∅' }),
      el('div', { class: 'pname', text: p.name }),
      el('button', {
        class: 'pdel', text: '✕', title: 'Delete preset',
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete preset "${p.name}"?`)) return;
          try {
            await api.deleteSave(kind, p.id);
            await App.reloadPresets();
          } catch (err) { toast(err.message, true); }
        },
      }));
    list.append(card);
  }
  $('btnNewPreset').classList.toggle('hidden', kind === 'tilepreset');
}

// ------------------------------------------------------------ marker panel (left)
export function refreshMarkerPanel() {
  const panel = $('markerPanel');
  const show = state.tool === 'marker' && state.mode === 'sub';
  panel.classList.toggle('hidden', !show);
  if (!show) return;
  const list = $('markerList');
  list.innerHTML = '';
  for (const m of MARKER_TYPES) {
    list.append(el('div', {
      class: 'lrow' + (state.activeMarker === m.id ? ' active' : ''),
      onclick: () => { state.activeMarker = m.id; refreshMarkerPanel(); App.onMarkerChanged?.(); },
    },
      el('span', { class: 'marker-chip', style: `background:${m.color}`, text: m.short }),
      el('span', { class: 'lname', text: m.label }),
      m.unique ? el('span', { class: 'badge ground', text: '1×' }) : null));
  }
}

// ------------------------------------------------------------ preset creation dialogs
function slotWidget(label, initial = null) {
  const img = el('img', { class: initial ? '' : 'hidden', src: initial ? texUrl(initial) : '' });
  const box = el('div', { class: 'slot' }, img,
    el('span', { class: 'slot-label', text: label }));
  const st = { value: initial, box };
  box.addEventListener('click', () => {
    document.querySelectorAll('.slot.armed').forEach(s => s.classList.remove('armed'));
    box.classList.add('armed');
    setTextureClickHook((t) => {
      st.value = t.path;
      img.src = texUrl(t.path);
      img.classList.remove('hidden');
    });
  });
  return st;
}

export function openCubePresetDialog(existing = null) {
  const d = existing?.data || {};
  const name = el('input', { type: 'text', placeholder: 'Preset name', value: existing?.name || '' });
  const height = el('select', {},
    el('option', { value: '5', text: 'Full cube — 5 × 5 × 5 cm' }),
    el('option', { value: '2.5', text: 'Half cube — 5 × 5 × 2.5 cm' }));
  height.value = String(d.height || 5);
  const slots = {
    top: slotWidget('Top', d.top), bottom: slotWidget('Bottom', d.bottom),
    front: slotWidget('Front', d.front), back: slotWidget('Back', d.back),
    left: slotWidget('Left', d.left), right: slotWidget('Right', d.right),
  };
  const allSides = el('button', {
    class: 'tb wide', text: '⿴ Use active texture for ALL four sides',
    onclick: () => {
      if (!state.activeTexture) return toast('Pick a texture in the browser first', true);
      for (const k of ['front', 'back', 'left', 'right']) {
        slots[k].value = state.activeTexture;
        const img = slots[k].box.querySelector('img');
        img.src = texUrl(state.activeTexture); img.classList.remove('hidden');
      }
    },
  });
  const close = openModal({
    title: existing ? 'Edit cube preset' : '🧊 New cube preset',
    floating: true,
    body: [
      el('div', { class: 'frow' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'frow' }, el('label', { text: 'Size' }), height),
      el('p', { class: 'slot-hint', text: '👉 Click a face slot below to arm it, then click a texture in the left-hand browser to assign it.' }),
      el('div', { class: 'slot-grid' }, ...Object.values(slots).map(s => s.box)),
      allSides,
    ],
    foot: el('button', {
      class: 'tb primary', text: 'Save preset',
      onclick: async () => {
        if (!name.value.trim()) return toast('Give the preset a name', true);
        const data = { height: parseFloat(height.value) };
        for (const [k, s] of Object.entries(slots)) data[k] = s.value || null;
        if (!data.bottom) data.bottom = data.top;
        await api.putSave('cubepreset', { id: existing?.id, name: name.value.trim(), tags: existing?.tags || [], data });
        close();
        await App.reloadPresets();
        toast('Cube preset saved ✓');
      },
    }),
  });
}

export function openTokenPresetDialog(existing = null) {
  const d = existing?.data || {};
  const name = el('input', { type: 'text', placeholder: 'Preset name', value: existing?.name || '' });
  const w = el('input', { type: 'number', step: '0.5', min: '0.5', value: d.w ?? 3 });
  const l = el('input', { type: 'number', step: '0.5', min: '0.5', value: d.l ?? 3 });
  const h = el('input', { type: 'number', step: '0.1', min: '0.1', value: d.h ?? 0.5 });
  const slots = { top: slotWidget('Top face', d.top), bottom: slotWidget('Bottom face (optional)', d.bottom) };
  const close = openModal({
    title: existing ? 'Edit token preset' : '🪙 New token preset',
    floating: true,
    body: [
      el('div', { class: 'frow' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'frow' }, el('label', { text: 'Width (cm)' }), w),
      el('div', { class: 'frow' }, el('label', { text: 'Length (cm)' }), l),
      el('div', { class: 'frow' }, el('label', { text: 'Height (cm)' }), h),
      el('p', { class: 'slot-hint', text: '👉 Click a slot to arm it, then click a texture in the left-hand browser. Token sides are automatically tinted to match the texture border.' }),
      el('div', { class: 'slot-grid' }, slots.top.box, slots.bottom.box),
    ],
    foot: el('button', {
      class: 'tb primary', text: 'Save preset',
      onclick: async () => {
        if (!name.value.trim()) return toast('Give the preset a name', true);
        if (!slots.top.value) return toast('Assign a top texture', true);
        const data = {
          w: parseFloat(w.value) || 3, l: parseFloat(l.value) || 3, h: parseFloat(h.value) || 0.5,
          top: slots.top.value, bottom: slots.bottom.value || slots.top.value,
        };
        await api.putSave('tokenpreset', { id: existing?.id, name: name.value.trim(), tags: existing?.tags || [], data });
        close();
        await App.reloadPresets();
        toast('Token preset saved ✓');
      },
    }),
  });
}

export function openNameDialog(title, placeholder, onOk) {
  const name = el('input', { type: 'text', placeholder });
  const close = openModal({
    title, narrow: true,
    body: [el('div', { class: 'frow' }, el('label', { text: 'Name' }), name)],
    foot: el('button', {
      class: 'tb primary', text: 'Save',
      onclick: () => { if (!name.value.trim()) return toast('Enter a name', true); close(); onOk(name.value.trim()); },
    }),
  });
  setTimeout(() => name.focus(), 50);
}

// ------------------------------------------------------------ save browser
export function openSaveBrowser({ type, title, pickLabel, onPick }) {
  let saves = [];
  const search = el('input', { type: 'search', placeholder: '🔍 Search by name…' });
  const sort = el('select', {},
    el('option', { value: 'recent', text: 'Sort: Most recent' }),
    el('option', { value: 'oldest', text: 'Sort: Oldest first' }),
    el('option', { value: 'name', text: 'Sort: Name A–Z' }),
    el('option', { value: 'created', text: 'Sort: Recently created' }));
  const tagSel = el('select', {}, el('option', { value: '', text: 'All tags' }));
  const grid = el('div', { class: 'save-grid' });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const tag = tagSel.value;
    let items = saves.filter(s =>
      (!q || s.name.toLowerCase().includes(q)) &&
      (!tag || (s.tags || []).includes(tag)));
    const by = sort.value;
    items = [...items].sort((a, b) =>
      by === 'name' ? a.name.localeCompare(b.name)
        : by === 'oldest' ? a.modified - b.modified
        : by === 'created' ? b.created - a.created
        : b.modified - a.modified);
    grid.innerHTML = '';
    if (!items.length) {
      grid.append(el('div', { class: 'save-empty', text: 'No saves found.' }));
      return;
    }
    for (const s of items) {
      const date = new Date(s.modified).toLocaleString(undefined,
        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      grid.append(el('div', { class: 'scard' },
        s.thumb ? el('img', { class: 'sthumb', src: s.thumb }) : el('div', { class: 'sthumb' }),
        el('div', { class: 'sbody' },
          el('div', { class: 'sname', text: s.name }),
          el('div', { class: 'sdate', text: 'Modified ' + date }),
          el('div', { class: 'stags' },
            isStatic && s.local ? el('span', { class: 'stag local', text: '📱 on this device' }) : null,
            ...(s.tags || []).map(t => el('span', { class: 'stag', text: t })))),
        el('div', { class: 'sbtns' },
          el('button', { class: 'tb primary', text: pickLabel, onclick: () => { close(); onPick(s); } }),
          el('button', {
            class: 'tb', text: '⤓', title: 'Download this save as a .json file',
            onclick: async () => {
              try { downloadSave(await api.getSave(type, s.id)); }
              catch (e) { toast('Export failed: ' + e.message, true); }
            },
          }),
          api.isWritable(s) ? el('button', {
            class: 'tb danger', text: '🗑', title: 'Delete this save',
            onclick: async () => {
              if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
              try {
                await api.deleteSave(type, s.id);
                saves = saves.filter(x => x.id !== s.id);
                render();
              } catch (e) { toast(e.message, true); }
            },
          }) : null)));
    }
  };
  search.addEventListener('input', render);
  sort.addEventListener('change', render);
  tagSel.addEventListener('change', render);

  const importer = el('input', { type: 'file', accept: 'application/json,.json', multiple: 'multiple', class: 'hidden' });
  importer.addEventListener('change', async () => {
    const files = [...importer.files];
    importer.value = '';
    if (!files.length) return;
    try {
      for (const f of files) await importSaveFile(type, f);
      saves = await api.listSaves(type);
      render();
      toast(`Imported ${files.length} save${files.length > 1 ? 's' : ''} ✓`);
    } catch (e) { toast('Import failed: ' + e.message, true); }
  });

  const close = openModal({
    title,
    body: [
      isStatic ? el('div', { class: 'mode-note', html:
        'This is the web build. The saves that ship with the site are read-only — anything you save here is kept <b>in this browser</b> on this device. Use ⤓ to download a save and 📥 to bring one in.' }) : null,
      el('div', { class: 'save-toolbar' }, search, sort, tagSel), grid, importer,
    ],
    foot: el('button', {
      class: 'tb', text: '📥 Import save…', title: 'Load a .json save file',
      onclick: () => importer.click(),
    }),
  });

  api.listSaves(type).then(list => {
    saves = list;
    const tags = [...new Set(list.flatMap(s => s.tags || []))].sort();
    for (const t of tags) tagSel.append(el('option', { value: t, text: '🏷 ' + t }));
    render();
  }).catch(e => toast('Could not load saves: ' + e.message, true));
}

export function openSaveAsDialog(onOk) {
  const d = doc();
  const name = el('input', { type: 'text', value: d.name, placeholder: 'Name' });
  const tags = el('input', { type: 'text', value: (d.tags || []).join(', '), placeholder: 'e.g. desert, hard, level-2' });
  const close = openModal({
    title: '💾 Save as…',
    narrow: true,
    body: [
      el('div', { class: 'frow' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'frow' }, el('label', { text: 'Tags (comma-sep.)' }), tags),
      el('p', { class: 'note', text: 'Tags help you filter saves later in the Load browser.' }),
    ],
    foot: el('button', {
      class: 'tb primary', text: 'Save',
      onclick: () => {
        if (!name.value.trim()) return toast('Enter a name', true);
        close();
        onOk(name.value.trim(), tags.value.split(',').map(t => t.trim()).filter(Boolean));
      },
    }),
  });
  setTimeout(() => name.select(), 50);
}

// ------------------------------------------------------------ properties panel
function findOverlay(id) { return state.sub.data.overlays.find(o => o.id === id); }
function findCube(id) { return state.sub.data.cubes.find(c => c.id === id); }
function findToken(id) { return state.sub.data.tokens.find(t => t.id === id); }
function findSb(u) { return state.board.data.subboards.find(s => s.uid === u); }

function frow(label, input) {
  return el('div', { class: 'frow' }, el('label', { text: label }), input);
}
function num(value, step, oninput, min = null) {
  const i = el('input', { type: 'number', step: String(step), value: String(value) });
  if (min !== null) i.min = String(min);
  i.addEventListener('change', () => oninput(parseFloat(i.value) || 0));
  return i;
}

function overlayOrderButtons(o) {
  const move = (dir) => {
    const sorted = [...state.sub.data.overlays].sort((a, b) => a.order - b.order);
    const i = sorted.indexOf(o);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i].order, sorted[j].order] = [sorted[j].order, sorted[i].order];
    App.commit();
  };
  return el('div', { class: 'btn-row' },
    el('button', { class: 'tb', text: '⬆ Raise', title: 'Draw above the next layer', onclick: () => move(1) }),
    el('button', { class: 'tb', text: '⬇ Lower', title: 'Draw below the previous layer', onclick: () => move(-1) }));
}

function rotButtons(get, set, step = 90) {
  return el('div', { class: 'btn-row' },
    el('button', { class: 'tb', text: `⟲ ${step}°`, onclick: () => { set(((get() - step) % 360 + 360) % 360); } }),
    el('button', { class: 'tb', text: `⟳ ${step}°`, onclick: () => { set((get() + step) % 360); } }));
}

const KIND_LABEL = {
  tile: '🟩 Tile', overlay: '🖼 Layer', cube: '🧊 Cube', token: '🪙 Token', sb: '🗺 Sub-Board',
};

export function refreshProps() {
  const body = $('propsBody');
  body.innerHTML = '';
  const sel = state.selection;
  if (!sel) {
    body.append(el('p', { class: 'note', text: 'Nothing selected. Use the Select tool (1) and click a tile, layer, cube or token.' }));
    return;
  }
  const delBtn = (onDel) => el('button', { class: 'tb danger wide', text: '🗑 Delete (Del)', onclick: onDel });

  // ---------- tile ----------
  if (sel.kind === 'tile') {
    const key = `${sel.row},${sel.col}`;
    const t = state.sub.data.tiles[key];
    body.append(el('div', { class: 'props-head' },
      t?.tex ? el('img', { class: 'props-thumb', src: texUrl(t.tex) }) : el('div', { class: 'props-thumb' }),
      el('div', {},
        el('div', { class: 'kind', text: `Tile ${sel.row + 1} · ${sel.col + 1}` }),
        el('div', { class: 'sub', text: t?.tex ? t.tex.split('/').pop() : 'No ground texture' }))));
    if (t) {
      body.append(rotButtons(() => t.rot || 0, (v) => { t.rot = v; App.commit(); }));
    }
    body.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'tb', text: '🎨 Apply active texture',
        title: 'Paint this tile with the texture selected in the browser',
        onclick: () => {
          if (!state.activeTexture) return toast('Pick a texture in the browser first', true);
          state.sub.data.tiles[key] = { tex: state.activeTexture, rot: t?.rot || 0 };
          App.commit();
        },
      }),
      el('button', {
        class: 'tb', text: '✖ Clear ground',
        onclick: () => { delete state.sub.data.tiles[key]; App.commit(); },
      })));
    body.append(el('button', {
      class: 'tb wide', text: '📋 Save tile as preset',
      title: 'Store this tile (ground + layers) as a reusable preset for the Tile Preset tool',
      onclick: () => {
        openNameDialog('Save tile preset', 'e.g. Checkpoint tile', async (nm) => {
          const overlays = state.sub.data.overlays
            .filter(o => o.type !== 'custom' && o.row === sel.row && o.col === sel.col)
            .map(o => ({ type: o.type, tex: o.tex, rot: o.rot }));
          await api.putSave('tilepreset', {
            name: nm, tags: [],
            data: { ground: t ? { tex: t.tex, rot: t.rot || 0 } : null, overlays },
          });
          await App.reloadPresets();
          toast('Tile preset saved ✓ — use the Tile Preset tool to stamp it');
        });
      },
    }));
    // gameplay markers on this tile
    const mk = state.sub.data.markers?.[key] || [];
    if (mk.length) {
      body.append(el('p', { class: 'note', text: 'Gameplay markers:' }));
      for (const tp of mk) {
        const def = MARKER_TYPES.find(m => m.id === tp);
        body.append(el('div', { class: 'lrow' },
          el('span', { class: 'marker-chip', style: `background:${def?.color || '#888'}`, text: def?.short || '?' }),
          el('span', { class: 'lname', text: def?.label || tp }),
          el('button', {
            class: 'mini del', text: '✕', title: 'Remove marker',
            onclick: (e) => {
              e.stopPropagation();
              const arr = state.sub.data.markers[key];
              arr.splice(arr.indexOf(tp), 1);
              if (!arr.length) delete state.sub.data.markers[key];
              App.commit();
            },
          })));
      }
    }
    // layers on this tile
    const here = state.sub.data.overlays.filter(o => o.type !== 'custom' && o.row === sel.row && o.col === sel.col);
    if (here.length) {
      body.append(el('p', { class: 'note', text: 'Layers on this tile:' }));
      for (const o of here) {
        body.append(el('div', {
          class: 'lrow', onclick: () => App.select({ kind: 'overlay', id: o.id }),
        },
          el('img', { src: texUrl(o.tex) }),
          el('span', { class: `badge ${o.type}`, text: o.type }),
          el('span', { class: 'lname', text: o.tex.split('/').pop() })));
      }
    }
    return;
  }

  // ---------- overlay ----------
  if (sel.kind === 'overlay') {
    const o = findOverlay(sel.id);
    if (!o) return;
    const typeName = o.type === 'gameplay' ? 'Gameplay layer' : o.type === 'label' ? 'Label' : 'Customization';
    body.append(el('div', { class: 'props-head' },
      el('img', { class: 'props-thumb', src: texUrl(o.tex) }),
      el('div', {},
        el('div', { class: 'kind', text: typeName }),
        el('div', { class: 'sub', text: o.tex.split('/').pop() }))));
    body.append(rotButtons(() => o.rot || 0, (v) => { o.rot = v; App.commit(); }));
    body.append(overlayOrderButtons(o));
    if (o.type === 'custom') {
      body.append(
        frow('X (cm)', num(o.x, 0.5, v => { o.x = v; App.commit(); })),
        frow('Z (cm)', num(o.z, 0.5, v => { o.z = v; App.commit(); })),
        frow('Width (cm)', num(o.w, 0.5, v => { o.w = Math.max(0.5, v); App.commit(); }, 0.5)),
        frow('Height (cm)', num(o.h, 0.5, v => { o.h = Math.max(0.5, v); App.commit(); }, 0.5)),
        el('p', { class: 'note', text: 'Tip: drag it in the 3D view with the Select tool to move it freely.' }));
    }
    body.append(el('button', {
      class: 'tb wide', text: '🖼 Swap to active texture',
      onclick: () => {
        if (!state.activeTexture) return toast('Pick a texture in the browser first', true);
        o.tex = state.activeTexture; App.commit();
      },
    }));
    body.append(delBtn(() => App.deleteSelection()));
    return;
  }

  // ---------- cube ----------
  if (sel.kind === 'cube') {
    const c = findCube(sel.id);
    if (!c) return;
    body.append(el('div', { class: 'props-head' },
      c.preset.top ? el('img', { class: 'props-thumb', src: texUrl(c.preset.top) }) : el('div', { class: 'props-thumb' }),
      el('div', {},
        el('div', { class: 'kind', text: c.preset.name || 'Cube' }),
        el('div', { class: 'sub', text: `${c.preset.height === 5 ? 'Full' : 'Half'} cube · tile ${c.row + 1}·${c.col + 1}` }))));
    body.append(rotButtons(() => c.rot || 0, (v) => { c.rot = v; App.commit(); }));
    const hSel = el('select', {},
      el('option', { value: '5', text: 'Full (5 cm)' }),
      el('option', { value: '2.5', text: 'Half (2.5 cm)' }));
    hSel.value = String(c.preset.height || 5);
    hSel.addEventListener('change', () => { c.preset.height = parseFloat(hSel.value); App.commit(); });
    body.append(frow('Height', hSel));
    body.append(el('p', { class: 'note', text: 'Set a face to the active texture:' }));
    const setFace = (faces) => () => {
      if (!state.activeTexture) return toast('Pick a texture in the browser first', true);
      for (const f of faces) c.preset[f] = state.activeTexture;
      App.commit();
    };
    body.append(el('div', { class: 'btn-row' },
      el('button', { class: 'tb', text: 'Top', onclick: setFace(['top']) }),
      el('button', { class: 'tb', text: 'All sides', onclick: setFace(['front', 'back', 'left', 'right']) })));
    body.append(el('div', { class: 'btn-row' },
      el('button', { class: 'tb', text: 'Front', onclick: setFace(['front']) }),
      el('button', { class: 'tb', text: 'Back', onclick: setFace(['back']) }),
      el('button', { class: 'tb', text: 'Left', onclick: setFace(['left']) }),
      el('button', { class: 'tb', text: 'Right', onclick: setFace(['right']) })));
    body.append(delBtn(() => App.deleteSelection()));
    return;
  }

  // ---------- token ----------
  if (sel.kind === 'token') {
    const t = findToken(sel.id);
    if (!t) return;
    body.append(el('div', { class: 'props-head' },
      el('img', { class: 'props-thumb', src: texUrl(t.top) }),
      el('div', {},
        el('div', { class: 'kind', text: 'Token' }),
        el('div', { class: 'sub', text: t.top.split('/').pop() }))));
    body.append(
      frow('Width (cm)', num(t.w, 0.5, v => { t.w = Math.max(0.5, v); App.commit(); }, 0.5)),
      frow('Length (cm)', num(t.l, 0.5, v => { t.l = Math.max(0.5, v); App.commit(); }, 0.5)),
      frow('Height (cm)', num(t.h, 0.1, v => { t.h = Math.max(0.1, v); App.commit(); }, 0.1)),
      frow('Rotation (°)', num(t.rot || 0, 5, v => { t.rot = v; App.commit(); })));
    body.append(rotButtons(() => t.rot || 0, (v) => { t.rot = v; App.commit(); }));
    body.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'tb', text: 'Top ← active tex',
        onclick: () => { if (!state.activeTexture) return toast('Pick a texture first', true); t.top = state.activeTexture; App.commit(); },
      }),
      el('button', {
        class: 'tb', text: 'Bottom ← active tex',
        onclick: () => { if (!state.activeTexture) return toast('Pick a texture first', true); t.bottom = state.activeTexture; App.commit(); },
      })));
    body.append(el('p', { class: 'note', text: 'Sides are tinted automatically from the top texture border. Drag with the Select tool to move.' }));
    body.append(delBtn(() => App.deleteSelection()));
    return;
  }

  // ---------- sub-board (assembly) ----------
  if (sel.kind === 'sb') {
    const sb = findSb(sel.uid);
    if (!sb) return;
    body.append(el('div', { class: 'props-head' },
      el('div', {},
        el('div', { class: 'kind', text: sb.name }),
        el('div', { class: 'sub', text: 'Sub-board placement' }))));
    const orderIn = num(sb.order || 0, 1, v => {
      sb.order = Math.max(0, Math.round(v)) || null;
      state.board.dirty = true;
      App.commitBoardTransform(sb);
      refreshSbList();
    }, 0);
    body.append(
      frow('Map tile # (1–4)', orderIn),
      el('p', { class: 'note', text: 'Reveal order for the Map Tester: 1 = starting tile, then clockwise. 0 = unset.' }),
      frow('X (cm)', num(sb.x, 1, v => { sb.x = v; App.commitBoardTransform(sb); })),
      frow('Z (cm)', num(sb.z, 1, v => { sb.z = v; App.commitBoardTransform(sb); })),
      frow('Angle (°)', num(sb.rot || 0, 5, v => { sb.rot = v; App.commitBoardTransform(sb); })),
      frow('Scale X', num(sb.sx || 1, 0.05, v => { sb.sx = Math.max(0.05, v); App.commitBoardTransform(sb); }, 0.05)),
      frow('Scale Z', num(sb.sz || 1, 0.05, v => { sb.sz = Math.max(0.05, v); App.commitBoardTransform(sb); }, 0.05)));
    body.append(rotButtons(() => sb.rot || 0, (v) => { sb.rot = v; App.commitBoardTransform(sb); }));
    body.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'tb', text: '⤢ Scale ×1.1',
        onclick: () => { sb.sx = (sb.sx || 1) * 1.1; sb.sz = (sb.sz || 1) * 1.1; App.commitBoardTransform(sb); },
      }),
      el('button', {
        class: 'tb', text: '⤡ Scale ×0.9',
        onclick: () => { sb.sx = (sb.sx || 1) * 0.9; sb.sz = (sb.sz || 1) * 0.9; App.commitBoardTransform(sb); },
      }),
      el('button', {
        class: 'tb', text: '1:1',
        onclick: () => { sb.sx = 1; sb.sz = 1; App.commitBoardTransform(sb); },
      })));
    body.append(el('button', {
      class: 'tb wide', text: '✏ Open in Sub-Board Editor',
      onclick: () => App.openSubInEditor(sb.saveId),
    }));
    body.append(delBtn(() => App.deleteSelection()));
    return;
  }
}

// ------------------------------------------------------------ layers panel (per tile)
function tileOfPoint(x, z) {
  const g = state.sub.data.grid;
  const col = Math.floor((x + g.cols * g.cell / 2) / g.cell);
  const row = Math.floor((z + g.rows * g.cell / 2) / g.cell);
  if (row < 0 || col < 0 || row >= g.rows || col >= g.cols) return null;
  return { row, col };
}

// which tile is the selection "about"?
function focusTile() {
  const s = state.selection;
  if (!s) return null;
  if (s.kind === 'tile') return { row: s.row, col: s.col };
  if (s.kind === 'cube') {
    const c = state.sub.data.cubes.find(x => x.id === s.id);
    return c ? { row: c.row, col: c.col } : null;
  }
  if (s.kind === 'overlay') {
    const o = state.sub.data.overlays.find(x => x.id === s.id);
    if (!o) return null;
    return o.type === 'custom' ? tileOfPoint(o.x, o.z) : { row: o.row, col: o.col };
  }
  if (s.kind === 'token') {
    const t = state.sub.data.tokens.find(x => x.id === s.id);
    return t ? tileOfPoint(t.x, t.z) : null;
  }
  return null;
}

export function refreshLayers() {
  const list = $('layersList');
  list.innerHTML = '';
  if (state.mode !== 'sub') { $('layersPanel').classList.add('hidden'); return; }
  $('layersPanel').classList.remove('hidden');
  const data = state.sub.data;
  const ft = focusTile();
  const title = $('layersPanel').querySelector('h3');
  title.innerHTML = ft
    ? `Tile ${ft.row + 1} · ${ft.col + 1} Layers <span class="note-inline">(top → bottom)</span>`
    : 'Layers';
  if (!ft) {
    list.append(el('p', { class: 'note', text: 'Select a tile (or anything on it) to see and reorder its layers.' }));
    return;
  }

  // everything stacked on this tile
  const onTile = data.overlays.filter(o =>
    o.type === 'custom'
      ? (() => { const t = tileOfPoint(o.x, o.z); return t && t.row === ft.row && t.col === ft.col; })()
      : (o.row === ft.row && o.col === ft.col));
  const sorted = [...onTile].sort((a, b) => b.order - a.order); // top first

  const row = (o) => {
    const isSel = state.selection?.kind === 'overlay' && state.selection.id === o.id;
    const move = (dir) => (e) => {
      e.stopPropagation();
      // reorder relative to the other layers on THIS tile
      const asc = [...onTile].sort((a, b) => a.order - b.order);
      const i = asc.indexOf(o), j = i + dir;
      if (j < 0 || j >= asc.length) return;
      [asc[i].order, asc[j].order] = [asc[j].order, asc[i].order];
      App.commit();
    };
    return el('div', {
      class: 'lrow' + (isSel ? ' active' : ''),
      onclick: () => App.select({ kind: 'overlay', id: o.id }),
    },
      el('img', { src: texUrl(o.tex), loading: 'lazy' }),
      el('span', { class: `badge ${o.type}`, text: o.type }),
      el('span', { class: 'lname', text: o.tex.split('/').pop().replace(/\.[^.]+$/, '') }),
      el('button', { class: 'mini', text: '▲', title: 'Raise layer', onclick: move(1) }),
      el('button', { class: 'mini', text: '▼', title: 'Lower layer', onclick: move(-1) }),
      el('button', {
        class: 'mini del', text: '✕', title: 'Delete layer',
        onclick: (e) => { e.stopPropagation(); data.overlays = data.overlays.filter(x => x.id !== o.id); if (isSel) state.selection = null; App.commit(); },
      }));
  };

  // cubes + tokens on this tile (not part of the draw-order stack)
  const extras = [
    ...data.cubes.filter(c => c.row === ft.row && c.col === ft.col)
      .map(c => ({ kind: 'cube', id: c.id, tex: c.preset.top, label: c.preset.name || 'Cube' })),
    ...data.tokens.filter(t => { const p = tileOfPoint(t.x, t.z); return p && p.row === ft.row && p.col === ft.col; })
      .map(t => ({ kind: 'token', id: t.id, tex: t.top, label: 'Token' })),
  ];
  for (const x of extras) {
    const isSel = state.selection?.kind === x.kind && state.selection.id === x.id;
    list.append(el('div', {
      class: 'lrow' + (isSel ? ' active' : ''),
      onclick: () => App.select({ kind: x.kind, id: x.id }),
    },
      x.tex ? el('img', { src: texUrl(x.tex), loading: 'lazy' }) : el('span'),
      el('span', { class: `badge ${x.kind}`, text: x.kind }),
      el('span', { class: 'lname', text: x.label }),
      el('button', {
        class: 'mini del', text: '✕', title: 'Delete',
        onclick: (e) => {
          e.stopPropagation();
          if (x.kind === 'cube') data.cubes = data.cubes.filter(c => c.id !== x.id);
          else data.tokens = data.tokens.filter(t => t.id !== x.id);
          if (isSel) state.selection = null;
          App.commit();
        },
      })));
  }

  for (const o of sorted) list.append(row(o));

  // ground always at the bottom of the stack
  const ground = data.tiles[`${ft.row},${ft.col}`];
  if (ground) {
    list.append(el('div', {
      class: 'lrow' + (state.selection?.kind === 'tile' ? ' active' : ''),
      onclick: () => App.select({ kind: 'tile', row: ft.row, col: ft.col }),
    },
      el('img', { src: texUrl(ground.tex), loading: 'lazy' }),
      el('span', { class: 'badge ground', text: 'ground' }),
      el('span', { class: 'lname', text: ground.tex.split('/').pop().replace(/\.[^.]+$/, '') })));
  }

  if (!sorted.length && !extras.length && !ground) {
    list.append(el('p', { class: 'note', text: 'This tile is empty.' }));
  }
}

// ------------------------------------------------------------ sub-board list (assembly)
export function refreshSbList() {
  const list = $('sbList');
  list.innerHTML = '';
  for (const sb of state.board.data.subboards) {
    const isSel = state.selection?.kind === 'sb' && state.selection.uid === sb.uid;
    list.append(el('div', {
      class: 'lrow' + (isSel ? ' active' : ''),
      onclick: () => App.select({ kind: 'sb', uid: sb.uid }),
    },
      el('span', { class: 'badge ground', text: 'board' }),
      sb.order ? el('span', { class: 'badge gameplay', text: '#' + sb.order }) : null,
      el('span', { class: 'lname', text: sb.name }),
      el('button', {
        class: 'mini del', text: '✕', title: 'Remove from board',
        onclick: (e) => {
          e.stopPropagation();
          state.board.data.subboards = state.board.data.subboards.filter(x => x.uid !== sb.uid);
          if (isSel) state.selection = null;
          App.commit();
        },
      })));
  }
  if (!state.board.data.subboards.length) {
    list.append(el('p', { class: 'note', text: 'Empty board. Use ➕ Add Sub-Board on the left.' }));
  }
}

// ------------------------------------------------------------ randomize (board assembly)
export function openRandomizeDialog() {
  const slots = state.board.data.subboards;
  if (!slots.length) {
    return toast('First lay out the board: add sub-boards and position them — those become the slots.', true);
  }
  const listBox = el('div', { class: 'row-list' });
  const warn = el('p', { class: 'note', style: 'color:var(--bad)' });
  const checks = [];
  const updateWarn = () => {
    const n = checks.filter(c => c.checked).length;
    warn.textContent =
      n < slots.length ? `⚠ Select at least ${slots.length} — the board has ${slots.length} slots and no sub-board can appear twice.`
      : n < 4 ? '⚠ Fewer than four selected — there can\'t be two of the same sub-board on a board.'
      : '';
  };
  const close = openModal({
    title: '🎲 Randomize board',
    narrow: true,
    body: [
      el('p', { class: 'note', text: `The current arrangement defines ${slots.length} slots (position + rotation). Pick which saved sub-boards may be drawn — each slot gets a different random one.` }),
      listBox, warn,
    ],
    foot: el('button', {
      class: 'tb primary', text: '🎲 Randomize',
      onclick: () => {
        const picked = checks.filter(c => c.checked).map(c => c._meta);
        if (picked.length < slots.length) {
          return toast(`Select at least ${slots.length} sub-boards`, true);
        }
        for (let i = picked.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [picked[i], picked[j]] = [picked[j], picked[i]];
        }
        close();
        App.applyRandomize(picked.slice(0, slots.length));
      },
    }),
  });
  api.listSaves('subboard').then(saves => {
    if (!saves.length) { listBox.append(el('p', { class: 'note', text: 'No sub-board saves yet.' })); return; }
    const used = new Set(slots.map(s => s.saveId));
    for (const s of saves) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = used.has(s.id);
      cb._meta = s;
      cb.addEventListener('change', updateWarn);
      checks.push(cb);
      listBox.append(el('label', { class: 'lrow' }, cb,
        s.thumb ? el('img', { src: s.thumb }) : el('span'),
        el('span', { class: 'lname', text: s.name })));
    }
    updateWarn();
  });
}

// ------------------------------------------------------------ help
export function openHelp() {
  openModal({
    title: '❓ How to use Map Builder',
    body: [el('div', { class: 'help-cols', html: `
      <div>
        <h4>Camera</h4>
        <ul>
          <li><b>Right-drag</b> — rotate the view</li>
          <li><b>Middle-drag</b> — pan</li>
          <li><b>Scroll wheel</b> — zoom</li>
          <li><kbd>F</kbd> — frame the whole board</li>
        </ul>
        <h4>Touch &amp; phones</h4>
        <ul>
          <li>The <b>dock at the bottom</b> holds everything you need while working:
            the current <b>tool</b> (tap to change), the <b>palette</b> (texture, preset
            or marker for that tool), <b>🖐/✏️</b>, <b>⛶</b> frame board, and <b>⌄</b> to
            hide the dock when showing a board off.</li>
          <li>The <b>strip</b> above the dock is whatever the tool needs — tap a texture
            or preset to switch, no panel required.</li>
          <li><b>🖐 / ✏️</b> decides what one finger does: move the camera, or use the
            tool. <b>Two fingers</b> always pinch-zoom and pan, in both modes.</li>
          <li>In 🖐, a <b>quick tap</b> still selects. With something selected the strip
            becomes its actions: <b>⟳ 90°</b>, <b>⚙</b> properties, <b>🗑</b>, <b>✕</b>.</li>
          <li><b>☰</b> holds the modes, document actions and the full panels; <b>⚙</b>
            opens board settings, selection details and layers.</li>
        </ul>
        <h4>Sub-Board Editor</h4>
        <ul>
          <li><b>Paint Ground</b> — pick a texture, then click / drag over tiles.</li>
          <li><b>Gameplay</b> — adds a layer centered on a tile (tracks, buttons). Rotate in 90° steps.</li>
          <li><b>Customize</b> — decorative art, placed anywhere, moved and resized freely.</li>
          <li><b>Label</b> — corner markers; always added on top (order can be changed later).</li>
          <li><b>Cube</b> — pick a cube preset (Mountain, Box, Train…), click a tile.</li>
          <li><b>Token</b> — pick a token preset, click anywhere on the board.</li>
          <li><b>Tile Preset</b> — stamp a saved tile (ground + layers) onto tiles.</li>
          <li><b>Marker</b> — invisible gameplay data for the Map Tester: checkpoint, coin piles, large-coin platforms, control panels, rails. Click a tile to toggle.</li>
          <li><b>Erase</b> — click layers / cubes / tokens / markers to remove them.</li>
        </ul>
      </div>
      <div>
        <h4>Selection &amp; handles</h4>
        <ul>
          <li>With <b>Select</b>, click anything — <b>✥ move</b> and <b>⟳ rotate</b> handles appear above it.</li>
          <li>Drag <b>⟳</b> to rotate: ground, gameplay, labels and cubes snap to 90°; customization art and tokens rotate freely (hold <kbd>Ctrl</kbd> for 15° steps).</li>
          <li>Drag <b>✥</b> to move — ground paint and tile layers hop between tiles, art and tokens move freely.</li>
          <li><kbd>R</kbd> — rotate 90° &nbsp;·&nbsp; <kbd>Del</kbd> — delete &nbsp;·&nbsp; <kbd>Esc</kbd> — deselect</li>
          <li>The <b>Layers</b> panel shows the selected tile's stack — reorder with ▲▼.</li>
        </ul>
        <h4>Board Assembly</h4>
        <ul>
          <li><b>➕ Add Sub-Board</b> places saved sub-boards; drag them — they snap to half-tile steps so grids line up edge to edge.</li>
          <li>Rotate with the ⟳ handle (90° steps, <kbd>Ctrl</kbd> = 15°); scale in the right panel.</li>
          <li><b>🎲 Randomize</b> keeps the slot positions/rotations and randomly deals selected sub-boards into them.</li>
          <li>Boards reference sub-board saves — edit a sub-board and every board updates.</li>
        </ul>
        <h4>Saving</h4>
        <ul>
          <li><kbd>Ctrl+S</kbd> save · <kbd>Ctrl+O</kbd> load. Sub-boards and boards are separate save lists.</li>
          <li>Add <b>tags</b> when saving, then filter and sort in the Load browser.</li>
        </ul>
      </div>` })],
  });
}

export function initUI(app) { App = app; }
