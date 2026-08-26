// App bootstrap and interaction logic.
import { state, doc, uid, newSubData, newBoardData, nextOverlayOrder, MARKER_TYPES } from './state.js';
import { api } from './api.js';
import { View, tileCenter } from './view3d.js';
import * as UI from './ui.js';
import * as Tester from './sim/tester.js';
import * as Mobile from './mobile.js';

const $ = (id) => document.getElementById(id);
const view = new View($('viewport'));

// ------------------------------------------------------------ App facade
const App = {
  select(sel) {
    state.selection = sel;
    view.refreshHelper();
    UI.refreshProps();
    UI.refreshLayers();
    Mobile.onSelectionChanged();
    if (state.mode === 'board') UI.refreshSbList();
  },

  commit() {
    this.validateSelection();
    doc().dirty = true;
    view.rebuild();
    UI.refreshProps();
    UI.refreshLayers();
    Mobile.onSelectionChanged();
    if (state.mode === 'board') UI.refreshSbList();
    updateTitle();
  },

  commitBoardTransform(sb) {
    state.board.dirty = true;
    view.updateSbTransform(sb);
    updateTitle();
  },

  validateSelection() {
    const s = state.selection;
    if (!s) return;
    const d = state.sub.data;
    const ok =
      s.kind === 'tile' ? true :
      s.kind === 'overlay' ? d.overlays.some(o => o.id === s.id) :
      s.kind === 'cube' ? d.cubes.some(c => c.id === s.id) :
      s.kind === 'token' ? d.tokens.some(t => t.id === s.id) :
      s.kind === 'sb' ? state.board.data.subboards.some(b => b.uid === s.uid) : false;
    if (!ok) state.selection = null;
  },

  deleteSelection() {
    const s = state.selection;
    if (!s) return;
    const d = state.sub.data;
    if (s.kind === 'overlay') d.overlays = d.overlays.filter(o => o.id !== s.id);
    else if (s.kind === 'cube') d.cubes = d.cubes.filter(c => c.id !== s.id);
    else if (s.kind === 'token') d.tokens = d.tokens.filter(t => t.id !== s.id);
    else if (s.kind === 'tile') delete d.tiles[`${s.row},${s.col}`];
    else if (s.kind === 'sb') {
      state.board.data.subboards = state.board.data.subboards.filter(b => b.uid !== s.uid);
    } else return;
    state.selection = null;
    this.commit();
  },

  async reloadTextures() {
    const r = await api.textures();
    state.textures = r.textures;
    state.categories = r.categories;
    UI.fillCategorySelect();
    UI.refreshBrowser();
  },

  async reloadModels() {
    const r = await api.models();
    state.models = r.models;
  },

  selectGameAsset(sel) {
    state.gameSel = sel;
    UI.refreshGamePanels();
    UI.refreshGameInfo();
    view.rebuild();
  },

  async reloadPresets() {
    for (const kind of ['cubepreset', 'tokenpreset', 'tilepreset']) {
      const list = await api.listSaves(kind);
      // preset lists are small: fetch full docs so data is at hand
      state.presets[kind] = await Promise.all(list.map(m => api.getSave(kind, m.id)));
      const active = state.activePreset[kind];
      if (!active || !state.presets[kind].some(p => p.id === active.id)) {
        state.activePreset[kind] = state.presets[kind][0] || null;
      }
    }
    UI.refreshPresetPanel();
  },

  onActiveTextureChanged() { Mobile.onTextureChanged(); },
  onPresetChanged() { Mobile.onPresetChanged(); },
  onMarkerChanged() { Mobile.onMarkerChanged(); },

  async applyRandomize(picks) {
    const slots = state.board.data.subboards;
    try {
      for (let i = 0; i < slots.length; i++) {
        const save = await api.getSave('subboard', picks[i].id);
        state.boardRuntime[save.id] = save.data;
        slots[i].saveId = save.id;
        slots[i].name = save.name;
      }
      this.commit();
      UI.toast('Board randomized 🎲');
    } catch (e) { UI.toast('Randomize failed: ' + e.message, true); }
  },

  async openSubInEditor(saveId) {
    try {
      const s = await api.getSave('subboard', saveId);
      state.sub = { id: s.id, name: s.name, tags: s.tags || [], data: s.data, dirty: false };
      setMode('sub');
      UI.toast(`Editing "${s.name}"`);
    } catch (e) { UI.toast('Could not open sub-board: ' + e.message, true); }
  },
};

// ------------------------------------------------------------ document title
function updateTitle() {
  if (state.mode === 'game') { document.title = 'Game Assets — Map Builder'; return; }
  if (state.mode === 'tester') { document.title = 'Map Tester — Map Builder'; return; }
  const d = doc();
  $('docName').value = d.name;
  document.title = (d.dirty ? '● ' : '') + d.name + ' — Map Builder';
}

// ------------------------------------------------------------ tools
const HINTS = {
  select: '<b>Select:</b> click an object, then use the <b>✥ move</b> / <b>⟳ rotate</b> handles above it · <b>right-drag</b> rotate view · <b>wheel</b> zoom',
  paint: '<b>Paint:</b> pick a texture on the left, then click or drag across tiles',
  stamp: '<b>Tile Preset:</b> pick a preset on the left, then click tiles to stamp it',
  gameplay: '<b>Gameplay:</b> pick a texture, click a tile — layer is centered on the tile (rotate after with R)',
  custom: '<b>Customize:</b> pick a texture, click anywhere on the board — then drag / resize freely',
  label: '<b>Label:</b> pick a texture, click a tile — labels go on top of all layers',
  cube: '<b>Cube:</b> pick a cube preset on the left, then click a tile to place it',
  token: '<b>Token:</b> pick a token preset on the left, then click anywhere on the board',
  marker: '<b>Marker:</b> pick a marker type on the left, click tiles to toggle it — invisible game data telling the Map Tester where checkpoints, coins, panels and rails are',
  erase: '<b>Erase:</b> click layers, cubes, tokens or markers to remove them',
  addsub: '',
};

function setTool(tool) {
  if (tool === 'addsub') { openAddSubBoard(); return; }
  if (tool === 'random') { UI.openRandomizeDialog(); return; }
  if (tool === 'arrange') { autoArrangeBoard(); return; }
  state.tool = tool;
  document.querySelectorAll('#toolbar .tool').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === tool));
  UI.setHint(HINTS[tool] || '');
  UI.refreshPresetPanel();
  UI.refreshMarkerPanel();
  UI.autoCategory(tool);
  Mobile.onToolChanged();
  $('viewport').style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

// ------------------------------------------------------------ placement helpers
function clampToBoard(p) {
  const g = state.sub.data.grid;
  const hw = g.cols * g.cell / 2, hd = g.rows * g.cell / 2;
  return {
    x: Math.min(hw, Math.max(-hw, p.x)),
    z: Math.min(hd, Math.max(-hd, p.z)),
  };
}

function paintTile(row, col) {
  if (!state.activeTexture) { UI.toast('Pick a texture in the browser first', true); return; }
  const key = `${row},${col}`;
  const prev = state.sub.data.tiles[key];
  if (prev?.tex === state.activeTexture) return;
  state.sub.data.tiles[key] = { tex: state.activeTexture, rot: prev?.rot || 0 };
  App.commit();
}

function stampTile(row, col) {
  const p = state.activePreset.tilepreset;
  if (!p) { UI.toast('Pick a tile preset on the left first', true); return; }
  const d = state.sub.data;
  const key = `${row},${col}`;
  if (p.data.ground) d.tiles[key] = { ...p.data.ground };
  d.overlays = d.overlays.filter(o => o.type === 'custom' || o.row !== row || o.col !== col);
  for (const o of (p.data.overlays || [])) {
    d.overlays.push({ id: uid(), type: o.type, tex: o.tex, rot: o.rot || 0, order: nextOverlayOrder(d, o.type), row, col });
  }
  App.commit();
}

function addTileOverlay(type, row, col) {
  if (!state.activeTexture) { UI.toast('Pick a texture in the browser first', true); return; }
  const d = state.sub.data;
  if (type === 'gameplay') {
    // one gameplay layer per tile — replace
    d.overlays = d.overlays.filter(o => o.type !== 'gameplay' || o.row !== row || o.col !== col);
  }
  const o = { id: uid(), type, tex: state.activeTexture, rot: 0, order: nextOverlayOrder(d, type), row, col };
  d.overlays.push(o);
  App.commit();
  App.select({ kind: 'overlay', id: o.id });
}

function addCustom(point) {
  if (!state.activeTexture) { UI.toast('Pick a texture in the browser first', true); return; }
  const d = state.sub.data;
  const p = clampToBoard(point);
  const o = {
    id: uid(), type: 'custom', tex: state.activeTexture, rot: 0,
    order: nextOverlayOrder(d, 'custom'),
    x: p.x, z: p.z, w: d.grid.cell, h: d.grid.cell,
  };
  d.overlays.push(o);
  App.commit();
  App.select({ kind: 'overlay', id: o.id });
}

function placeCube(row, col) {
  const p = state.activePreset.cubepreset;
  if (!p) { UI.toast('Pick a cube preset on the left first', true); return; }
  const d = state.sub.data;
  d.cubes = d.cubes.filter(c => c.row !== row || c.col !== col); // one cube per tile
  const c = { id: uid(), row, col, rot: 0, preset: { name: p.name, ...p.data } };
  d.cubes.push(c);
  App.commit();
  App.select({ kind: 'cube', id: c.id });
}

function placeToken(point) {
  const p = state.activePreset.tokenpreset;
  if (!p) { UI.toast('Pick a token preset on the left first', true); return; }
  const d = state.sub.data;
  const pos = clampToBoard(point);
  const t = {
    id: uid(), x: pos.x, z: pos.z, rot: 0,
    w: p.data.w ?? 3, l: p.data.l ?? 3, h: p.data.h ?? 0.5,
    top: p.data.top, bottom: p.data.bottom || p.data.top,
  };
  d.tokens.push(t);
  App.commit();
  App.select({ kind: 'token', id: t.id });
}

function eraseAt(ev) {
  const hit = view.pick(ev);
  if (!hit) return;
  const d = state.sub.data;
  if (hit.kind === 'overlay') d.overlays = d.overlays.filter(o => o.id !== hit.id);
  else if (hit.kind === 'cube') d.cubes = d.cubes.filter(c => c.id !== hit.id);
  else if (hit.kind === 'token') d.tokens = d.tokens.filter(t => t.id !== hit.id);
  else if (hit.kind === 'marker') {
    const key = `${hit.row},${hit.col}`;
    const arr = d.markers?.[key];
    if (!arr) return;
    arr.splice(arr.indexOf(hit.type), 1);
    if (!arr.length) delete d.markers[key];
  }
  else return;
  App.commit();
}

// toggle the active marker type on a tile; unique markers move instead of duplicating
function stampMarker(row, col) {
  const type = state.activeMarker;
  const def = MARKER_TYPES.find(m => m.id === type);
  const d = state.sub.data;
  d.markers = d.markers || {};
  const key = `${row},${col}`;
  const arr = d.markers[key] || [];
  if (arr.includes(type)) {
    d.markers[key] = arr.filter(t => t !== type);
    if (!d.markers[key].length) delete d.markers[key];
  } else {
    if (def?.unique) {
      for (const k of Object.keys(d.markers)) {
        d.markers[k] = d.markers[k].filter(t => t !== type);
        if (!d.markers[k].length) delete d.markers[k];
      }
    }
    d.markers[key] = [...(d.markers[key] || []), type];
  }
  App.commit();
}

// ------------------------------------------------------------ pointer interaction
let drag = null; // { kind, item, offX, offZ } | { paint: true } | { kind:'ground', row, col }

function startMoveDragFromSelection(ev) {
  const s = state.selection;
  if (!s) return false;
  const g = view.groundPoint(ev);
  const d = state.sub.data;
  if (s.kind === 'sb') {
    const sb = state.board.data.subboards.find(b => b.uid === s.uid);
    if (sb && g) { drag = { kind: 'sb', item: sb, offX: sb.x - g.x, offZ: sb.z - g.z }; return true; }
  } else if (s.kind === 'overlay') {
    const o = d.overlays.find(x => x.id === s.id);
    if (!o) return false;
    if (o.type === 'custom') { if (g) drag = { kind: 'custom', item: o, offX: o.x - g.x, offZ: o.z - g.z }; }
    else drag = { kind: 'snapOverlay', item: o };
    return !!drag;
  } else if (s.kind === 'token') {
    const t = d.tokens.find(x => x.id === s.id);
    if (t && g) { drag = { kind: 'token', item: t, offX: t.x - g.x, offZ: t.z - g.z }; return true; }
  } else if (s.kind === 'cube') {
    const c = d.cubes.find(x => x.id === s.id);
    if (c) { drag = { kind: 'snapCube', item: c }; return true; }
  } else if (s.kind === 'tile') {
    if (d.tiles[`${s.row},${s.col}`]) { drag = { kind: 'ground', row: s.row, col: s.col }; return true; }
  }
  return !!drag;
}

$('viewport').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  if (state.mode === 'game' || state.mode === 'tester') return; // orbit camera only
  if (touchCamera && ev.pointerType !== 'mouse') return;        // finger belongs to the camera
  $('viewport').setPointerCapture(ev.pointerId);

  if (state.mode === 'board') {
    if (state.tool !== 'select') return;
    const hit = view.pick(ev);
    if (!hit) { App.select(null); return; }
    App.select({ kind: 'sb', uid: hit.uid });
    startMoveDragFromSelection(ev);
    return;
  }

  switch (state.tool) {
    case 'paint': {
      const t = view.pickTile(ev);
      if (t) paintTile(t.row, t.col);
      drag = { paint: true };
      break;
    }
    case 'stamp': {
      const t = view.pickTile(ev);
      if (t) stampTile(t.row, t.col);
      break;
    }
    case 'gameplay': case 'label': {
      const t = view.pickTile(ev);
      if (t) addTileOverlay(state.tool === 'label' ? 'label' : 'gameplay', t.row, t.col);
      break;
    }
    case 'custom': {
      const g = view.groundPoint(ev);
      if (g) addCustom(g);
      break;
    }
    case 'cube': {
      const t = view.pickTile(ev);
      if (t) placeCube(t.row, t.col);
      break;
    }
    case 'token': {
      const g = view.groundPoint(ev);
      if (g) placeToken(g);
      break;
    }
    case 'marker': {
      const t = view.pickTile(ev);
      if (t) stampMarker(t.row, t.col);
      break;
    }
    case 'erase': {
      eraseAt(ev);
      break;
    }
    case 'select': {
      const hit = view.pick(ev);
      if (!hit) { App.select(null); return; }
      if (hit.kind === 'marker') { App.select({ kind: 'tile', row: hit.row, col: hit.col }); return; }
      App.select({ kind: hit.kind, id: hit.id, uid: hit.uid, row: hit.row, col: hit.col });
      if (hit.kind !== 'tile') startMoveDragFromSelection(ev); // tiles move via the gizmo only
      break;
    }
  }
});

function handleDragMove(ev) {
  if (!drag) return;
  if (drag.paint) {
    const t = view.pickTile(ev);
    if (t) paintTile(t.row, t.col);
    return;
  }
  if (drag.kind === 'ground') {
    // move the painted ground texture from tile to tile
    const t = view.pickTile(ev);
    if (t && (t.row !== drag.row || t.col !== drag.col)) {
      const d = state.sub.data;
      const src = d.tiles[`${drag.row},${drag.col}`];
      if (!src) return;
      delete d.tiles[`${drag.row},${drag.col}`];
      d.tiles[`${t.row},${t.col}`] = src;
      drag.row = t.row; drag.col = t.col;
      state.selection = { kind: 'tile', row: t.row, col: t.col };
      App.commit();
    }
    return;
  }
  const g = view.groundPoint(ev);
  if (!g) return;

  if (drag.kind === 'sb') {
    // snap to half-tile so sub-board grids line up edge to edge
    const snap = (state.boardRuntime[drag.item.saveId]?.grid?.cell || 5) / 2;
    drag.item.x = Math.round((g.x + drag.offX) / snap) * snap;
    drag.item.z = Math.round((g.z + drag.offZ) / snap) * snap;
    App.commitBoardTransform(drag.item);
    drag.moved = true;
    return;
  }
  if (drag.kind === 'custom' || drag.kind === 'token') {
    const p = clampToBoard({ x: g.x + drag.offX, z: g.z + drag.offZ });
    drag.item.x = Math.round(p.x * 4) / 4;
    drag.item.z = Math.round(p.z * 4) / 4;
    view.moveMesh({ kind: drag.kind === 'token' ? 'token' : 'overlay', id: drag.item.id }, drag.item.x, drag.item.z);
    drag.moved = true;
    return;
  }
  if (drag.kind === 'snapOverlay' || drag.kind === 'snapCube') {
    const t = view.pickTile(ev);
    if (t && (t.row !== drag.item.row || t.col !== drag.item.col)) {
      if (drag.kind === 'snapCube' &&
          state.sub.data.cubes.some(c => c !== drag.item && c.row === t.row && c.col === t.col)) return;
      drag.item.row = t.row; drag.item.col = t.col;
      const c = tileCenter(state.sub.data.grid, t.row, t.col);
      const key = drag.kind === 'snapCube' ? `cube:${drag.item.id}` : `overlay:${drag.item.id}`;
      const mesh = view.index.get(key);
      if (mesh) { mesh.position.x = c.x; mesh.position.z = c.z; }
      drag.moved = true;
    }
  }
}

function finishDrag() {
  if (!drag) return;
  const moved = drag.moved || drag.paint;
  drag = null;
  if (moved) App.commit();
  else UI.refreshProps();
}

$('viewport').addEventListener('pointermove', handleDragMove);
$('viewport').addEventListener('pointerup', finishDrag);
$('viewport').addEventListener('pointercancel', finishDrag);

// ------------------------------------------------------------ gizmo (move / rotate handles)
const gizmoEl = $('gizmo');

function selItem() {
  const s = state.selection;
  if (!s) return null;
  const d = state.sub.data;
  if (s.kind === 'overlay') return d.overlays.find(x => x.id === s.id);
  if (s.kind === 'cube') return d.cubes.find(x => x.id === s.id);
  if (s.kind === 'token') return d.tokens.find(x => x.id === s.id);
  if (s.kind === 'tile') return d.tiles[`${s.row},${s.col}`];
  if (s.kind === 'sb') return state.board.data.subboards.find(x => x.uid === s.uid);
  return null;
}

// how rotation snaps for the selected thing:
// ground / gameplay / label / cube -> always 90°; custom art & tokens -> free (Ctrl = 15°);
// sub-boards -> 90° (Ctrl = 15°) so grids stay aligned
function rotSnap(sel, ctrl) {
  if (sel.kind === 'token') return ctrl ? 15 : 1;
  if (sel.kind === 'overlay') {
    const o = state.sub.data.overlays.find(x => x.id === sel.id);
    return o?.type === 'custom' ? (ctrl ? 15 : 1) : 90;
  }
  if (sel.kind === 'sb') return ctrl ? 15 : 90;
  return 90; // tile ground, cube
}

function updateGizmo() {
  requestAnimationFrame(updateGizmo);
  const s = state.selection;
  if (!s || !selItem()) { gizmoEl.classList.add('hidden'); return; }
  const p = view.selectionScreenPos(s);
  if (!p) { gizmoEl.classList.add('hidden'); return; }
  gizmoEl.classList.remove('hidden');
  gizmoEl.style.left = p.x + 'px';
  gizmoEl.style.top = p.y + 'px';
}
updateGizmo();

$('gizMove').addEventListener('pointerdown', (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  if (!startMoveDragFromSelection(ev)) return;
  const move = (e) => handleDragMove(e);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    finishDrag();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

$('gizRotate').addEventListener('pointerdown', (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  const sel = state.selection;
  const item = selItem();
  if (!sel || !item) return;
  const r = $('viewport').getBoundingClientRect();
  const c = view.selectionScreenPos(sel);
  if (!c) return;
  const angAt = (e) => Math.atan2((e.clientY - r.top) - c.y, (e.clientX - r.left) - c.x) * 180 / Math.PI;
  const startAng = angAt(ev);
  const startRot = item.rot || 0;
  let changed = false;
  const move = (e) => {
    const snap = rotSnap(sel, e.ctrlKey);
    let deg = startRot + (angAt(e) - startAng);
    deg = Math.round(deg / snap) * snap;
    deg = ((deg % 360) + 360) % 360;
    if (deg === item.rot) return;
    item.rot = deg;
    changed = true;
    if (sel.kind === 'sb') view.updateSbTransform(item);
    else view.rotateMesh(sel, deg);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!changed) return;
    if (sel.kind === 'sb') { state.board.dirty = true; updateTitle(); UI.refreshProps(); }
    else App.commit();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// ------------------------------------------------------------ mode switching
// boards reference sub-board saves: refetch them so edits show up immediately
async function refreshBoardRuntime() {
  const ids = [...new Set(state.board.data.subboards.map(s => s.saveId))];
  await Promise.all(ids.map(async (id) => {
    try { state.boardRuntime[id] = (await api.getSave('subboard', id)).data; } catch {}
  }));
}

function setMode(mode) {
  if (state.mode === 'tester' && mode !== 'tester') Tester.stopReplay();
  state.mode = mode;
  state.selection = null;
  const game = mode === 'game';
  const tester = mode === 'tester';
  document.querySelectorAll('.mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.sub-only').forEach(e => e.classList.toggle('hidden', mode !== 'sub'));
  document.querySelectorAll('.board-only').forEach(e => e.classList.toggle('hidden', mode !== 'board'));
  document.querySelectorAll('.game-only').forEach(e => e.classList.toggle('hidden', !game));
  document.querySelectorAll('.tester-only').forEach(e => e.classList.toggle('hidden', !tester));
  $('gridPanel').classList.toggle('hidden', mode !== 'sub');
  $('sbListPanel').classList.toggle('hidden', mode !== 'board');
  $('layersPanel').classList.toggle('hidden', mode !== 'board' ? false : true);
  // game & tester modes swap out the map-editing chrome entirely
  $('toolsPanel').classList.toggle('hidden', game || tester);
  $('texPanel').classList.toggle('hidden', game || tester);
  $('propsPanel').classList.toggle('hidden', game || tester);
  document.querySelector('.doc-controls').classList.toggle('hidden', game || tester);
  if (game) {
    setTool('select');
    UI.setHint('<b>Game Assets:</b> pick a card or character on the left · <b>right-drag</b> rotate · <b>wheel</b> zoom');
    UI.refreshGamePanels();
    UI.refreshGameInfo();
    App.reloadModels().then(() => UI.refreshGamePanels()).catch(() => {});
    view.rebuild();
    view.frame(10);
    updateTitle();
    return;
  }
  if (tester) {
    setTool('select');
    UI.setHint('<b>Map Tester:</b> set up players on the left, ▶ Calculate, then replay games from the results panel');
    UI.refreshPresetPanel();
    UI.refreshMarkerPanel();
    UI.refreshLayers();
    Tester.enterTesterMode().catch(e => UI.toast('Tester: ' + e.message, true));
    updateTitle();
    return;
  }
  syncGridInputs();
  setTool('select');
  view.rebuild();
  view.frame();
  UI.refreshProps();
  UI.refreshLayers();
  if (mode === 'board') {
    UI.refreshSbList();
    refreshBoardRuntime().then(() => { view.rebuild(); view.frame(); });
  }
  Mobile.sync();
  Mobile.closeSheet();
  updateTitle();
}

function syncGridInputs() {
  const g = state.sub.data.grid;
  $('gridCols').value = g.cols; $('gridRows').value = g.rows; $('gridCell').value = g.cell;
}

// ------------------------------------------------------------ save / load
async function performSave(name, tags) {
  const d = doc();
  const type = state.mode === 'sub' ? 'subboard' : 'board';
  d.name = name; d.tags = tags;
  let data = d.data;
  if (type === 'board') {
    data = { subboards: d.data.subboards.map(({ uid: u, saveId, name: n, x, z, rot, sx, sz, order }) =>
      ({ uid: u, saveId, name: n, x, z, rot, sx, sz, order: order || null })) };
  }
  try {
    const r = await api.putSave(type, { id: d.id, name, tags, data, thumb: view.captureThumb() });
    d.id = r.id; d.dirty = false;
    updateTitle();
    UI.toast(`Saved "${name}" ✓`);
  } catch (e) { UI.toast('Save failed: ' + e.message, true); }
}

function saveDoc(saveAs = false) {
  if (state.mode === 'game' || state.mode === 'tester') return;
  const d = doc();
  if (state.mode === 'board' && !d.data.subboards.length) {
    return UI.toast('Add at least one sub-board before saving the board', true);
  }
  if (!d.id || saveAs) UI.openSaveAsDialog((name, tags) => performSave(name, tags));
  else performSave(d.name, d.tags);
}

function loadDoc() {
  if (state.mode === 'game' || state.mode === 'tester') return;
  if (state.mode === 'sub') {
    UI.openSaveBrowser({
      type: 'subboard', title: '📂 Load a sub-board', pickLabel: 'Load',
      onPick: async (meta) => {
        const s = await api.getSave('subboard', meta.id);
        state.sub = { id: s.id, name: s.name, tags: s.tags || [], data: s.data, dirty: false };
        setMode('sub');
        UI.toast(`Loaded "${s.name}"`);
      },
    });
  } else {
    UI.openSaveBrowser({
      type: 'board', title: '📂 Load a board', pickLabel: 'Load',
      onPick: async (meta) => {
        const s = await api.getSave('board', meta.id);
        const entries = s.data.subboards || [];
        const missing = [];
        await Promise.all(entries.map(async (sb) => {
          try {
            const sub = await api.getSave('subboard', sb.saveId);
            state.boardRuntime[sb.saveId] = sub.data;
          } catch { missing.push(sb.name); }
        }));
        s.data.subboards = entries.filter(sb => state.boardRuntime[sb.saveId]);
        state.board = { id: s.id, name: s.name, tags: s.tags || [], data: s.data, dirty: false };
        setMode('board');
        if (missing.length) UI.toast(`Missing sub-board saves: ${missing.join(', ')}`, true);
        else UI.toast(`Loaded "${s.name}"`);
      },
    });
  }
}

// Snap the four sub-boards into the game's pinwheel loop: strips around an
// empty W×W center (W = strip width), tile 1 left, then clockwise 2/3/4.
// Matches the hand-built Main_Board layout, centered on the origin.
function autoArrangeBoard() {
  const sbs = state.board.data.subboards;
  if (sbs.length !== 4) {
    return UI.toast(`Auto-arrange needs exactly 4 sub-boards (board has ${sbs.length})`, true);
  }
  const sorted = [...sbs].sort((a, b) =>
    (a.order || 99) - (b.order || 99) ||
    a.name.localeCompare(b.name, undefined, { numeric: true }));
  const g = state.boardRuntime[sorted[0].saveId]?.grid;
  const W = (g?.cols || 3) * (g?.cell || 5);
  const slots = [
    { x: -W,     z: W / 2,  rot: 180 },
    { x: -W / 2, z: -W,     rot: 270 },
    { x: W,      z: -W / 2, rot: 0 },
    { x: W / 2,  z: W,      rot: 90 },
  ];
  sorted.forEach((sb, i) => Object.assign(sb, slots[i], { sx: 1, sz: 1, order: i + 1 }));
  App.commit();
  view.frame();
  UI.toast('Sub-boards snapped into the game loop ⊞ (tile 1 → 4 clockwise)');
}

function openAddSubBoard() {
  UI.openSaveBrowser({
    type: 'subboard', title: '➕ Add a sub-board to this board', pickLabel: 'Add',
    onPick: async (meta) => {
      try {
        const s = await api.getSave('subboard', meta.id);
        state.boardRuntime[s.id] = s.data;
        // auto-arrange in a 2x2 layout so four sub-boards tile into one big board
        const n = state.board.data.subboards.length;
        const g = s.data.grid;
        const w = g.cols * g.cell, d = g.rows * g.cell;
        const sb = {
          uid: uid(), saveId: s.id, name: s.name,
          x: ((n % 2) - 0.5) * w,
          z: (Math.floor(n / 2) % 2 - 0.5) * d + Math.floor(n / 4) * (d * 2 + 6),
          rot: 0, sx: 1, sz: 1,
        };
        state.board.data.subboards.push(sb);
        App.commit();
        view.frame();
        App.select({ kind: 'sb', uid: sb.uid });
        UI.toast(`Added "${s.name}" — drag it into position`);
      } catch (e) { UI.toast('Could not add: ' + e.message, true); }
    },
  });
}

function newDoc() {
  if (state.mode === 'game' || state.mode === 'tester') return;
  const d = doc();
  if (d.dirty && !confirm('Discard unsaved changes?')) return;
  if (state.mode === 'sub') {
    state.sub = { id: null, name: 'Untitled Sub-Board', tags: [], data: newSubData(), dirty: false };
  } else {
    state.board = { id: null, name: 'Untitled Board', tags: [], data: newBoardData(), dirty: false };
  }
  setMode(state.mode);
}

// ------------------------------------------------------------ keyboard
window.addEventListener('keydown', (ev) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.querySelector('.modal-backdrop')) {
    if (ev.key === 'Escape') document.querySelector('.modal-backdrop .modal-close')?.click();
    return;
  }
  if (ev.ctrlKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveDoc(); return; }
  if (ev.ctrlKey && ev.key.toLowerCase() === 'o') { ev.preventDefault(); loadDoc(); return; }
  if (ev.ctrlKey) return;

  const toolKeys = { 1: 'select', 2: 'paint', 3: 'stamp', 4: 'gameplay', 5: 'custom', 6: 'label', 7: 'cube', 8: 'token', 9: 'erase', v: 'select', e: 'erase', m: 'marker' };
  const k = ev.key.toLowerCase();
  if (toolKeys[k] && (state.mode === 'sub' || toolKeys[k] === 'select')) { setTool(toolKeys[k]); return; }

  if (k === 'f') { view.frame(); return; }
  if (k === 'escape') { App.select(null); return; }
  if (k === 'delete' || k === 'backspace') { App.deleteSelection(); return; }
  if (k === 'r') rotateSelection();
});

function rotateSelection() {
  const s = state.selection;
  if (!s) return;
  const d = state.sub.data;
  const bump = (obj) => { obj.rot = ((obj.rot || 0) + 90) % 360; };
  if (s.kind === 'overlay') { const o = d.overlays.find(x => x.id === s.id); if (o) { bump(o); App.commit(); } }
  else if (s.kind === 'cube') { const c = d.cubes.find(x => x.id === s.id); if (c) { bump(c); App.commit(); } }
  else if (s.kind === 'token') { const t = d.tokens.find(x => x.id === s.id); if (t) { bump(t); App.commit(); } }
  else if (s.kind === 'tile') { const t = d.tiles[`${s.row},${s.col}`]; if (t) { bump(t); App.commit(); } }
  else if (s.kind === 'sb') {
    const sb = state.board.data.subboards.find(x => x.uid === s.uid);
    if (sb) { bump(sb); App.commitBoardTransform(sb); UI.refreshProps(); }
  }
}

// ------------------------------------------------------------ topbar wiring
document.querySelectorAll('.mode-tab').forEach(b =>
  b.addEventListener('click', () => {
    if (b.dataset.mode !== state.mode) setMode(b.dataset.mode);
    if (narrow.matches) closeDrawers();
  }));
document.querySelectorAll('#toolbar .tool').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));

$('docName').addEventListener('input', () => {
  doc().name = $('docName').value;
  doc().dirty = true;
  document.title = '● ' + doc().name + ' — Map Builder';
});
$('btnNew').addEventListener('click', newDoc);
$('btnSave').addEventListener('click', () => saveDoc(false));
$('btnSaveAs').addEventListener('click', () => saveDoc(true));
$('btnLoad').addEventListener('click', loadDoc);
$('btnHelp').addEventListener('click', UI.openHelp);
if (api.canUpload) {
  $('btnUpload').addEventListener('click', UI.openUploadDialog);
  $('btnUploadCards').addEventListener('click', UI.openCardUploadDialog);
  $('btnUploadChars').addEventListener('click', UI.openCharUploadDialog);
} else {
  // the static build has no server to store files on
  for (const id of ['btnUpload', 'btnUploadCards', 'btnUploadChars']) $(id).classList.add('hidden');
}
$('btnNewPreset').addEventListener('click', () => {
  if (state.tool === 'cube') UI.openCubePresetDialog();
  else if (state.tool === 'token') UI.openTokenPresetDialog();
});

$('texSearch').addEventListener('input', UI.refreshBrowser);
$('texCategory').addEventListener('change', UI.refreshBrowser);

// grid settings
for (const [id, prop] of [['gridCols', 'cols'], ['gridRows', 'rows'], ['gridCell', 'cell']]) {
  $(id).addEventListener('change', () => {
    const v = parseFloat($(id).value);
    if (!v || v <= 0) return;
    state.sub.data.grid[prop] = prop === 'cell' ? v : Math.round(v);
    App.commit();
    view.frame();
  });
}

// background
const savedBg = localStorage.getItem('mb-bg') || '#14161c';
function applyBg(hex) {
  view.setBackground(hex);
  $('bgColor').value = hex;
  localStorage.setItem('mb-bg', hex);
}
$('bgSelect').addEventListener('change', () => {
  if ($('bgSelect').value !== 'custom') applyBg($('bgSelect').value);
});
$('bgColor').addEventListener('input', () => {
  $('bgSelect').value = 'custom';
  applyBg($('bgColor').value);
});
if ([...$('bgSelect').options].some(o => o.value === savedBg)) $('bgSelect').value = savedBg;
else $('bgSelect').value = 'custom';
applyBg(savedBg);

// ------------------------------------------------------------ phone layout
// Narrow screens turn the side panels into drawers, and one finger has to be
// told what it is for: moving the camera, or using the current tool.
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = matchMedia('(max-width: 900px)');

function setDrawer(side, open) {
  if (open) Mobile.closeSheet();
  document.body.classList.toggle('drawer-' + side, open);
  if (open) document.body.classList.remove('drawer-' + (side === 'left' ? 'right' : 'left'));
}
function closeDrawers() {
  document.body.classList.remove('drawer-left', 'drawer-right');
}
$('btnLeftDrawer').addEventListener('click', () =>
  setDrawer('left', !document.body.classList.contains('drawer-left')));
$('btnRightDrawer').addEventListener('click', () =>
  setDrawer('right', !document.body.classList.contains('drawer-right')));
$('drawerScrim').addEventListener('click', closeDrawers);

// A phone top bar only has room for the name and Save, so the rest of the
// document actions move into the tools drawer while the screen is narrow.
const docPanel = document.createElement('section');
docPanel.className = 'panel';
docPanel.id = 'docPanel';
docPanel.innerHTML = '<h3>Document</h3>';
const docRow = document.createElement('div');
docRow.className = 'btn-row';
docPanel.append(docRow);

let docsInDrawer = null;
function placeDocControls() {
  if (narrow.matches === docsInDrawer) return;
  docsInDrawer = narrow.matches;
  if (docsInDrawer) {
    $('leftPanel').prepend(docPanel);
    docPanel.insertBefore($('modeTabs'), docRow);
    docRow.append($('btnNew'), $('btnSaveAs'), $('btnLoad'), $('btnHelp'));
  } else {
    docPanel.remove();
    $('topbar').insertBefore($('modeTabs'), document.querySelector('.doc-controls'));
    document.querySelector('.doc-controls').append($('btnNew'), $('btnSave'), $('btnSaveAs'), $('btnLoad'));
    $('topbar').insertBefore($('btnHelp'), $('btnRightDrawer'));
  }
}
placeDocControls();
narrow.addEventListener('change', () => { closeDrawers(); placeDocControls(); });
window.addEventListener('resize', placeDocControls);   // belt and braces on rotate

// picking a tool means you want the board: get out of the way
document.querySelectorAll('#toolbar .tool').forEach(b =>
  b.addEventListener('click', () => { if (narrow.matches) closeDrawers(); }));

let touchCamera = coarse;   // mouse users always edit with the left button

function setTouchMode(camera, quiet = false) {
  touchCamera = camera;
  view.setTouchOrbit(camera);
  $('btnTouchCam').classList.toggle('active', camera);
  $('btnTouchEdit').classList.toggle('active', !camera);
  Mobile.setTouchModeIcon(camera);
  if (!quiet) {
    UI.toast(camera ? '🖐 One finger moves the camera' : '✏️ One finger uses the tool — two fingers move the camera');
  }
}
$('btnTouchCam').addEventListener('click', () => setTouchMode(true));
$('btnTouchEdit').addEventListener('click', () => setTouchMode(false));

Mobile.initMobile({
  App, view,
  rotateSelection,
  toggleTouchMode: () => setTouchMode(!touchCamera),
  openDrawer: (side) => setDrawer(side, true),
});

if (coarse) {
  $('touchMode').classList.remove('hidden');   // hidden by CSS on phones: the dock has it
  setTouchMode(true, true);
}

// In camera mode a quick tap still selects, so you can grab something and move
// it with the gizmo without leaving the camera.
let tap = null;
$('viewport').addEventListener('pointerdown', (ev) => {
  tap = (touchCamera && ev.pointerType !== 'mouse' && ev.isPrimary)
    ? { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId }
    : null;
});
$('viewport').addEventListener('pointerup', (ev) => {
  const t = tap;
  tap = null;
  if (!t || ev.pointerId !== t.id) return;
  if (performance.now() - t.t > 400) return;
  if (Math.hypot(ev.clientX - t.x, ev.clientY - t.y) > 10) return;
  if (state.mode === 'game' || state.mode === 'tester' || state.tool !== 'select') return;
  const hit = view.pick(ev);
  if (!hit) return App.select(null);
  if (hit.kind === 'marker') return App.select({ kind: 'tile', row: hit.row, col: hit.col });
  App.select({ kind: hit.kind, id: hit.id, uid: hit.uid, row: hit.row, col: hit.col });
});

// ------------------------------------------------------------ boot
window.MB = { state, view, App };   // console/debug handle
UI.initUI(App);
Tester.initTester(view);
Tester.wireTesterUI();
(async () => {
  try {
    await App.reloadTextures();
    await App.reloadPresets();
    await App.reloadModels();
  } catch (e) {
    UI.toast('Could not reach the server: ' + e.message, true);
  }
  setMode('sub');
})();
