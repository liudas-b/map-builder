// Central application state + data factories.

let uidCounter = 0;
export function uid() {
  return Date.now().toString(36) + '-' + (uidCounter++).toString(36);
}

export function newSubData(cols = 3, rows = 6, cell = 5) {
  return {
    grid: { cols, rows, cell },
    tiles: {},      // "row,col" -> { tex, rot }
    overlays: [],   // { id, type: gameplay|custom|label, tex, rot, order, row?, col?, x?, z?, w?, h? }
    cubes: [],      // { id, row, col, rot, preset: {name, height, top, bottom, front, back, left, right} }
    tokens: [],     // { id, x, z, w, l, h, rot, top, bottom }
  };
}

export function newBoardData() {
  return {
    // { uid, saveId, name, x, z, rot, sx, sz }
    subboards: [],
  };
}

export const state = {
  mode: 'sub',            // 'sub' | 'board'
  tool: 'select',
  activeTexture: null,    // texture path (relative to TextureAssets)
  activePreset: { cubepreset: null, tokenpreset: null, tilepreset: null }, // full docs
  textures: [],           // [{path, name, category}]
  categories: [],
  presets: { cubepreset: [], tokenpreset: [], tilepreset: [] }, // full docs
  sub:   { id: null, name: 'Untitled Sub-Board', tags: [], data: newSubData(), dirty: false },
  board: { id: null, name: 'Untitled Board',     tags: [], data: newBoardData(), dirty: false },
  boardRuntime: {},       // saveId -> sub-board data (loaded content for assembly)
  selection: null,        // { kind: tile|overlay|cube|token|sb, id?, row?, col? }
};

export function doc() {
  return state.mode === 'sub' ? state.sub : state.board;
}

export function nextOverlayOrder(data, type) {
  const orders = data.overlays.map(o => o.order);
  const max = orders.length ? Math.max(...orders) : 0;
  // labels always start on top of everything placed so far
  return type === 'label' ? Math.max(max + 1, 1000) : max + 1;
}
