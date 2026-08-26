// Phone UI.
//
// On a narrow screen the side panels are drawers, which is fine for settings
// but hopeless for the actual work: picking a texture and painting meant four
// taps at the top of the screen. So on phones the working controls live in a
// dock at the bottom, inside thumb reach:
//
//   [ current tool ▲ ][ palette ▲ ][ 🖐/✏️ ][ ⛶ ][ ⌄ ]
//
// and above it a strip of whatever the current tool needs — textures, presets
// or markers — so switching is one tap. With something selected, that strip
// becomes the selection's actions instead. The panels themselves are not
// duplicated: a sheet borrows the real panel from the drawer and hands it back.

import { state, MARKER_TYPES } from './state.js';
import { texUrl } from './api.js';
import * as UI from './ui.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}

export const narrow = matchMedia('(max-width: 900px)');

let ctx = null;          // { App, view, setTool, rotateSelection, saveDoc }
let dock, strip, selBar, sheet, sheetBody, sheetTitle;
let btnTool, btnPalette, btnMode, btnFit, btnHide;
let hostSlot = null;     // where a borrowed panel came from
let sheetPanel = null;

const TOOL_ICON = {
  select: '🖱️', paint: '🎨', stamp: '📋', gameplay: '🎯', custom: '🌸', label: '🏷️',
  cube: '🧊', token: '🪙', marker: '📍', erase: '🧹', addsub: '➕', arrange: '⊞', random: '🎲',
};
const TOOL_NAME = {
  select: 'Select', paint: 'Ground', stamp: 'Tile Preset', gameplay: 'Gameplay', custom: 'Art',
  label: 'Label', cube: 'Cube', token: 'Token', marker: 'Marker', erase: 'Erase',
};
const PRESET_KIND = { cube: 'cubepreset', token: 'tokenpreset', stamp: 'tilepreset' };
const TEXTURE_TOOLS = ['paint', 'gameplay', 'custom', 'label'];

// ------------------------------------------------------------ bottom sheet
function openSheet(title, panelId) {
  const panel = $(panelId);
  if (!panel) return;
  if (sheetPanel === panel) return closeSheet();
  closeSheet();
  hostSlot = { parent: panel.parentElement, next: panel.nextElementSibling };
  sheetPanel = panel;
  panel.classList.remove('hidden');
  sheetTitle.textContent = title;
  sheetBody.append(panel);
  document.body.classList.add('sheet-open');
}

export function closeSheet() {
  if (sheetPanel && hostSlot) hostSlot.parent.insertBefore(sheetPanel, hostSlot.next);
  sheetPanel = null;
  hostSlot = null;
  document.body.classList.remove('sheet-open');
}

// What the palette button opens for the current tool.
function paletteTarget() {
  if (state.mode !== 'sub') return null;
  if (TEXTURE_TOOLS.includes(state.tool)) return { title: '🖼 Textures', panel: 'texPanel' };
  if (PRESET_KIND[state.tool]) return { title: '📦 Presets', panel: 'presetPanel' };
  if (state.tool === 'marker') return { title: '📍 Markers', panel: 'markerPanel' };
  return null;
}

// ------------------------------------------------------------ the strip
function textureItems() {
  const q = $('texSearch').value.trim().toLowerCase();
  const cat = $('texCategory').value;
  return state.textures
    .filter(t => (!cat || t.category === cat || t.category.startsWith(cat + '/')) &&
                 (!q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)))
    .slice(0, 80)
    .map(t => ({
      key: t.path, label: t.name, img: texUrl(t.path),
      active: state.activeTexture === t.path,
      pick: () => { state.activeTexture = t.path; UI.refreshBrowser(); refreshStrip(); },
    }));
}

function presetItems(kind) {
  return (state.presets[kind] || []).map(p => {
    const tex = p.data.top || p.data.ground?.tex || p.data.front;
    return {
      key: p.id, label: p.name, img: tex ? texUrl(tex) : null,
      active: state.activePreset[kind]?.id === p.id,
      pick: () => { state.activePreset[kind] = p; UI.refreshPresetPanel(); refreshStrip(); },
    };
  });
}

function markerItems() {
  return MARKER_TYPES.map(m => ({
    key: m.id, label: m.label, chip: m,
    active: state.activeMarker === m.id,
    pick: () => { state.activeMarker = m.id; UI.refreshMarkerPanel(); refreshStrip(); },
  }));
}

function currentItems() {
  if (state.mode !== 'sub') return null;
  if (TEXTURE_TOOLS.includes(state.tool)) return textureItems();
  if (PRESET_KIND[state.tool]) return presetItems(PRESET_KIND[state.tool]);
  if (state.tool === 'marker') return markerItems();
  return null;
}

function refreshStrip() {
  const items = currentItems();
  strip.innerHTML = '';
  if (!items || !items.length) { strip.classList.add('hidden'); return refreshPaletteButton(); }
  strip.classList.remove('hidden');
  for (const it of items) {
    strip.append(el('button', {
      class: 'strip-item' + (it.active ? ' active' : ''),
      title: it.label,
      onclick: () => { it.pick(); },
    },
      it.chip
        ? el('span', { class: 'marker-chip', style: `background:${it.chip.color}`, text: it.chip.short })
        : it.img ? el('img', { src: it.img, loading: 'lazy' }) : el('span', { class: 'strip-empty', text: '∅' }),
      el('span', { class: 'strip-name', text: it.label })));
  }
  const active = strip.querySelector('.strip-item.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  refreshPaletteButton();
}

function refreshPaletteButton() {
  const target = paletteTarget();
  btnPalette.classList.toggle('hidden', !target);
  if (!target) return;
  const items = currentItems() || [];
  const active = items.find(i => i.active);
  btnPalette.innerHTML = '';
  btnPalette.append(
    active?.img ? el('img', { src: active.img })
      : active?.chip ? el('span', { class: 'marker-chip', style: `background:${active.chip.color}`, text: active.chip.short })
      : el('span', { class: 'mb-ico', text: '🖼' }));
}

// ------------------------------------------------------------ selection bar
function refreshSelBar() {
  const sel = state.selection;
  const items = currentItems();
  // Placing a cube or a token selects it, so the strip must survive that or
  // placing a second one would cost an extra tap. The actions take the strip's
  // place only when there is no palette to lose.
  const keepStrip = !!(items && items.length) && state.tool !== 'select';
  const show = !!sel && (state.mode === 'sub' || state.mode === 'board') && !keepStrip;
  selBar.classList.toggle('hidden', !show);
  if (show) strip.classList.add('hidden');
  else refreshStrip();
  if (!show) return;
  const kind = sel.kind === 'sb' ? 'Sub-board' : sel.kind[0].toUpperCase() + sel.kind.slice(1);
  selBar.innerHTML = '';
  selBar.append(
    el('span', { class: 'sel-what', text: kind }),
    el('button', { class: 'tb', text: '⟳ 90°', title: 'Rotate', onclick: () => ctx.rotateSelection() }),
    el('button', { class: 'tb', text: '⚙', title: 'Properties', onclick: () => ctx.openDrawer('right') }),
    el('button', { class: 'tb danger', text: '🗑', title: 'Delete', onclick: () => ctx.App.deleteSelection() }),
    el('button', { class: 'tb', text: '✕', title: 'Deselect', onclick: () => ctx.App.select(null) }));
}

// ------------------------------------------------------------ build & sync
function build() {
  sheetTitle = el('h3', { text: '' });
  sheetBody = el('div', { class: 'sheet-body' });
  sheet = el('div', { id: 'sheet' },
    el('div', { class: 'sheet-head' },
      el('span', { class: 'sheet-grab' }),
      sheetTitle,
      el('button', { class: 'sheet-close', text: '✕', onclick: closeSheet })),
    sheetBody);

  strip = el('div', { id: 'mbStrip', class: 'hidden' });
  selBar = el('div', { id: 'mbSelBar', class: 'hidden' });

  btnTool = el('button', { class: 'mb-tool', onclick: () => openSheet('🧰 Tools', 'toolsPanel') });
  btnPalette = el('button', { class: 'mb-palette', onclick: () => {
    const t = paletteTarget();
    if (t) openSheet(t.title, t.panel);
  } });
  btnMode = el('button', { class: 'mb-btn', onclick: () => ctx.toggleTouchMode() });
  btnFit = el('button', { class: 'mb-btn', text: '⛶', title: 'Frame the whole board',
    onclick: () => ctx.view.frame() });
  btnHide = el('button', { class: 'mb-btn mb-hide', text: '⌄', title: 'Hide the controls',
    onclick: () => {
      closeSheet();
      document.body.classList.toggle('dock-hidden');
      btnHide.textContent = document.body.classList.contains('dock-hidden') ? '⌃' : '⌄';
    } });

  dock = el('div', { id: 'mbDock' },
    selBar, strip,
    el('div', { id: 'mbBar' }, btnTool, btnPalette, btnMode, btnFit, btnHide));

  const scrim = el('div', { id: 'sheetScrim', onclick: closeSheet });
  $('viewportWrap').append(dock, scrim, sheet);

  // a tap on the backdrop or on a tool closes the sheet again
  document.querySelectorAll('#toolbar .tool').forEach(b =>
    b.addEventListener('click', () => closeSheet()));
}

export function setTouchModeIcon(camera) {
  if (!btnMode) return;
  btnMode.textContent = camera ? '🖐' : '✏️';
  btnMode.title = camera ? 'One finger moves the camera — tap to edit instead' : 'One finger uses the tool — tap to look around instead';
  btnMode.classList.toggle('editing', !camera);
}

export function sync() {
  if (!dock) return;
  const editable = state.mode === 'sub' || state.mode === 'board';
  dock.classList.toggle('hidden', !editable);
  if (!editable) {
    closeSheet();
    // the chevron lives in the dock, so never leave the UI collapsed without it
    document.body.classList.remove('dock-hidden');
    if (btnHide) btnHide.textContent = '⌄';
  }
  btnTool.innerHTML = '';
  btnTool.append(
    el('span', { class: 'mb-ico', text: TOOL_ICON[state.tool] || '🖱️' }),
    el('span', { class: 'mb-lbl', text: TOOL_NAME[state.tool] || 'Tool' }),
    el('span', { class: 'mb-caret', text: '▴' }));
  refreshSelBar();
}

export function initMobile(context) {
  ctx = context;
  build();
  sync();
}

// hooks called from main.js when the app state changes underneath us
export const onTextureChanged = () => { refreshStrip(); closeSheet(); };
export const onPresetChanged = () => { refreshStrip(); closeSheet(); };
export const onMarkerChanged = () => { refreshStrip(); closeSheet(); };
export const onSelectionChanged = () => refreshSelBar();
export const onToolChanged = () => { sync(); refreshStrip(); };
