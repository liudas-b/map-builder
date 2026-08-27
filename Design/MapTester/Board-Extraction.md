# Board Extraction

**Status: Built.** `public/js/sim/model.js`, 127 lines.

One job: turn a saved **board** - four rotated, offset sub-board documents - into a
**single flat grid** the rules engine can index with one integer. Everything the
engine knows about the map comes out of this file.

## The projection

Sub-boards are placed in continuous world space with arbitrary rotation. The engine
wants `y*W + x`. So:

1. For every cell of every sub-board, compute its **local centre**
   (`(c+0.5)*cell - W/2`, `(r+0.5)*cell - D/2`), then rotate it by the
   sub-board's `-rot` and add the sub-board's `x`/`z`. That gives a world point per
   cell.
2. Take `minX` / `minZ` over all of them, and derive
   `W = round((maxX-minX)/cell)+1`, `H = round((maxZ-minZ)/cell)+1`.
3. Each cell lands at `gx = round((wx-minX)/cell)`, `gy = round((wz-minZ)/cell)`,
   index `gy*W + gx`.

**The rounding is what makes this work and what makes it fragile.** Sub-boards
snap to half-tile positions and 90 deg rotations while dragging, so cells land on
whole-cell centres and the rounding is exact. A sub-board rotated 15 deg, or scaled,
or dragged with the snap bypassed, will fold cells onto each other silently - the
last write wins and part of the map disappears with no warning. Keep assembled
boards axis-aligned.

`cell` is taken from the **first** sub-board. Mixing tile sizes on one board is not
supported.

## The model

```js
{
  boardId, boardName, cell, W, H, S = W*H,
  spaces:   Uint8Array(S),   // GROUND.VOID 0 | GRASS 1 | SKY 2
  tileOf:   Uint8Array(S),   // 1..4, 0 = no cell here
  mountains: Set<idx>,
  rails:     Set<idx>,
  panels:    Set<idx>,
  movables: [{ id, kind: 'box'|'train', at }],
  checkpoints: { tile: idx },
  spots:       { tile: { coin3, coin4, largeA, largeB } },
  world:    Float32Array(S*2),   // idx -> world x,z, for rendering
  boardDoc, subDocs,             // kept so the tester can draw the real 3D board
  tiles: [1,2,3,4],
  warnings: [ 'tile 3: largeB', ... ]
}
```

`spaces[i] === VOID` for any index the loop never wrote - the empty 3x3 centre and
anything outside the four strips. `VOID` is not standable and not enterable.

## Where the semantics come from

This is the part to know. **The simulator infers meaning from authoring
conventions, not from explicit flags.**

| Simulator concept | Inferred from | Code |
|-------------------|---------------|------|
| Sky | the tile's **ground texture path** matching `/sky/i` | `/sky/i.test(c.tex) ? SKY : GRASS` |
| Mountain (level 2, immovable) | a cube whose **height >= 5** | `(c.cube.height \|\| 5) >= 5` |
| Movable platform | a cube whose height < 5 | else branch |
| Train vs box | the cube **preset name** matching `/train/i` | `/train/i.test(c.cube.name)` |
| Map tile number | the placement's `order` | see below |
| Everything else (checkpoint, coins, panels, rails) | **explicit markers** | [[Gameplay-Markers]] |

Three consequences worth carrying:

- **Renaming the "Train Vagon" preset to something without "train" in it turns
  every placed train into a box.** Existing cubes embed a *copy* of the preset
  including its name, so the change only affects cubes placed afterwards - which is
  arguably worse, because the board would then contain both.
- **A sky tile is a texture filename.** `GridTiles/Tiles/Sky block.png` and
  `GridTiles/Sky.png` both match. A grass texture with "sky" in its name would
  become void.
- **A half-height decorative cube is a movable platform** to the simulator whether
  you meant it or not.

The tile number falls back in three steps:

```js
sb.order  ||  first number in the sub-board's name  ||  array index + 1
```

so `Tile_3` works even with `order` unset - which is what the shipped saves lean
on. It is still worth setting the field explicitly in Board Assembly, because the
tile number selects the large-coin values ([[Game-Rules]]).

## Also in this file

**`CARDS`** - the 13 card names, in the order that indexes the art
([[Cards]]).

**`cardArt(name)`** - name -> `Cards/Human Fall Flat - Card list-NN.png`, where
`NN = index + 2`.

**`LARGE_DEFS`** - the per-tile large coin faces, `{lo, hi}` or
`{mult: 'friend'|'small', lo, hi}`.

**`largeLabel(def)`** - a short display string (`4/6`, `♥x2/3`, `¢x2/3`).
Currently **exported and unused** - the report shows aggregated VP by source rather
than per-coin labels.

## Warnings

The last thing `extractModel` does is check every tile for a checkpoint and all
four coin spots, collecting `tile N: <what>` strings into `model.warnings`. The
tester toasts them and **continues anyway** - a partially marked board still
simulates, it just produces a lopsided report. Fixing the markers is the right
response, not ignoring the toast ([[Gameplay-Markers]]).

## Related

[[Simulation-Engine]] | [[Gameplay-Markers]] | [[Board-Assembly]] | [[Game-Rules]] |
[[Save-Format]] | [[Cards]]
