// Map Tester — board model extraction.
// Projects a saved board (4 rotated sub-boards) onto one global grid the
// rules engine can run on. All positions are integer cell indices y*W+x.
import { api } from '../api.js';

export const CARDS = [
  'Trick', 'Jump', 'Parkour', 'Group Up', 'Motivate', 'Command', 'Hug',
  'Hack', 'Mislead', 'Confuse', 'Pickpocket', 'Trample', 'Whine',
];

// card name -> art file (Cards/…-02.png … -14.png follow the list order)
export function cardArt(name) {
  const i = CARDS.indexOf(name);
  return i < 0 ? null : `Cards/Human Fall Flat - Card list-${String(i + 2).padStart(2, '0')}.png`;
}

// Large coin faces per tile, in platform order [A, B]
export const LARGE_DEFS = {
  1: [{ lo: 4, hi: 6 }, { lo: 5, hi: 7 }],
  2: [{ lo: 5, hi: 7 }, { lo: 6, hi: 8 }],
  3: [{ lo: 6, hi: 8 }, { mult: 'friend', lo: 2, hi: 3 }],
  4: [{ lo: 7, hi: 9 }, { mult: 'small', lo: 2, hi: 3 }],
};

export function largeLabel(def) {
  return def.mult === 'friend' ? `♥×${def.lo}/${def.hi}`
    : def.mult === 'small' ? `¢×${def.lo}/${def.hi}`
    : `${def.lo}/${def.hi}`;
}

const GROUND = { VOID: 0, GRASS: 1, SKY: 2 };
export { GROUND };

export async function extractModel(boardId) {
  const board = await api.getSave('board', boardId);
  const sbs = board.data.subboards || [];
  const subs = await Promise.all(sbs.map(sb => api.getSave('subboard', sb.saveId)));

  // world-space centers of every cell
  const raw = [];
  sbs.forEach((sb, i) => {
    const data = subs[i].data;
    const g = data.grid;
    const W = g.cols * g.cell, D = g.rows * g.cell;
    const th = -((sb.rot || 0) * Math.PI / 180);
    const markers = data.markers || {};
    const cubes = {};
    for (const c of data.cubes || []) cubes[`${c.row},${c.col}`] = c.preset;
    const order = sb.order || (parseInt((sb.name.match(/(\d+)/) || [])[1], 10) || i + 1);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const lx = (c + 0.5) * g.cell - W / 2;
        const lz = (r + 0.5) * g.cell - D / 2;
        const wx = lx * Math.cos(th) + lz * Math.sin(th) + sb.x;
        const wz = -lx * Math.sin(th) + lz * Math.cos(th) + sb.z;
        const t = (data.tiles || {})[`${r},${c}`];
        raw.push({
          wx, wz, tile: order,
          tex: t?.tex || '',
          markers: markers[`${r},${c}`] || [],
          cube: cubes[`${r},${c}`] || null,
        });
      }
    }
  });
  if (!raw.length) throw new Error('board has no sub-boards');

  const cell = subs[0].data.grid.cell || 5;
  const minX = Math.min(...raw.map(c => c.wx));
  const minZ = Math.min(...raw.map(c => c.wz));
  const W = Math.round((Math.max(...raw.map(c => c.wx)) - minX) / cell) + 1;
  const H = Math.round((Math.max(...raw.map(c => c.wz)) - minZ) / cell) + 1;
  const S = W * H;

  const model = {
    boardId, boardName: board.name, cell, W, H, S,
    spaces: new Uint8Array(S),      // GROUND.*
    tileOf: new Uint8Array(S),      // 1..4
    mountains: new Set(),
    rails: new Set(),
    panels: new Set(),
    movables: [],                   // {id, kind:'box'|'train', at}
    checkpoints: {},                // tile -> idx
    spots: {},                      // tile -> {coin3, coin4, largeA, largeB}
    world: new Float32Array(S * 2), // idx -> world x,z (for rendering)
    boardDoc: board, subDocs: subs, // for static 3D rendering
  };

  for (const c of raw) {
    const gx = Math.round((c.wx - minX) / cell);
    const gy = Math.round((c.wz - minZ) / cell);
    const i = gy * W + gx;
    model.spaces[i] = /sky/i.test(c.tex) ? GROUND.SKY : GROUND.GRASS;
    model.tileOf[i] = c.tile;
    model.world[i * 2] = c.wx;
    model.world[i * 2 + 1] = c.wz;
    for (const m of c.markers) {
      if (m === 'rail') model.rails.add(i);
      else if (m === 'panel') model.panels.add(i);
      else if (m === 'checkpoint') model.checkpoints[c.tile] = i;
      else {
        const key = { coin3: 'coin3', coin4: 'coin4', 'large-a': 'largeA', 'large-b': 'largeB' }[m];
        if (key) (model.spots[c.tile] = model.spots[c.tile] || {})[key] = i;
      }
    }
    if (c.cube) {
      if ((c.cube.height || 5) >= 5) model.mountains.add(i);
      else model.movables.push({
        id: model.movables.length,
        kind: /train/i.test(c.cube.name || '') ? 'train' : 'box',
        at: i,
      });
    }
  }

  const tiles = [...new Set(Array.from(model.tileOf).filter(Boolean))].sort();
  model.tiles = tiles;
  const missing = [];
  for (const t of tiles) {
    if (model.checkpoints[t] == null) missing.push(`tile ${t}: checkpoint`);
    for (const k of ['coin3', 'coin4', 'largeA', 'largeB']) {
      if (model.spots[t]?.[k] == null) missing.push(`tile ${t}: ${k}`);
    }
  }
  model.warnings = missing;
  return model;
}
