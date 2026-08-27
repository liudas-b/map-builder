# Sub-Board Editor

**Status: Built.** The default mode. `state.mode === 'sub'`.

One sub-board is one printed map tile: a grid of cells, decorated in layers, with
3D pieces on it and invisible game data stamped into it.

## The grid

`Board Settings` on the right sets `cols`, `rows` and `cell` (tile size in cm).
Defaults are **3 x 6 cells of 5 cm** - which is what all four shipped tiles use,
and what makes four of them assemble into the 9x9 loop with an empty 3x3 centre.

Resizing keeps existing paint: `tiles` is a sparse `"row,col"` map, so shrinking
hides cells rather than deleting them and growing brings them back. Nothing is
pruned. That is convenient and it means a save can carry paint you cannot see.

The board is centred on the origin. Tile `(row, col)` is at

```
x = (col + 0.5) * cell - cols * cell / 2
z = (row + 0.5) * cell - rows * cell / 2
```

## The nine tools

Keys `1`-`9`, plus `V` for select, `E` for erase, `M` for marker.

| Tool | Key | What it does | Writes to |
|------|-----|--------------|-----------|
| **Select** | 1 / V | pick something, then use the ✥ / ⟳ handles | - |
| **Paint Ground** | 2 | click or **drag** across tiles with the active texture | `tiles` |
| **Tile Preset** | 3 | stamp a saved ground+layers combo onto a tile | `tiles` + `overlays` |
| **Gameplay** | 4 | a tile-centred layer - rails, control panels | `overlays` (`gameplay`) |
| **Customize** | 5 | free-placed, free-sized decorative art | `overlays` (`custom`) |
| **Label** | 6 | a tile-centred marker layer, added on top | `overlays` (`label`) |
| **Cube** | 7 | place a cube preset on a tile | `cubes` |
| **Token** | 8 | place a token preset anywhere | `tokens` |
| **Marker** | M | toggle invisible gameplay data on a tile | `markers` |
| **Erase** | 9 / E | remove a layer, cube, token or marker under the cursor | any |

Picking a tool auto-jumps the texture browser's category filter to the folder that
tool usually wants (`autoCategory`): Paint -> `GridTiles/Tiles`, Gameplay ->
`GridTiles/Gameplay`, Customize -> `GridTiles/Customization`, Label ->
`GridTiles/Labels`, Cube -> `3D elements`, Token -> `Tokens`.

## The three layer types

All three live in the same `overlays` array and are drawn in `order`. What differs
is how they are positioned and how they rotate:

| Type | Position | Size | Rotation | Uniqueness |
|------|----------|------|----------|-----------|
| `gameplay` | snapped to a tile (`row`/`col`) | always one cell | 90 deg steps | **one per tile** - placing replaces |
| `custom` | free (`x`/`z`), clamped to the board | free (`w`/`h`), default one cell | free, Ctrl = 15 deg | unlimited |
| `label` | snapped to a tile | always one cell | 90 deg steps | unlimited |

The only real difference between `gameplay` and `label` is `nextOverlayOrder`:
labels get `max(max+1, 1000)`, so a newly added label lands above every non-label
layer placed so far. After that, order is fully editable in the Layers panel.

**"One gameplay layer per tile" is enforced on placement, not as an invariant.**
`addTileOverlay` filters out an existing gameplay layer on that tile before
pushing. Reordering or moving layers afterwards can still leave two on one tile;
nothing rejects it.

## Cubes

A cube is placed from a **cube preset** and takes a **copy** of it - name, height
and six face textures ([[Presets-and-Textures]]). One cube per tile: placing
replaces. Rotation is 90 deg steps. Dragging a selected cube snaps it tile to
tile, and refuses to drop onto a tile that already has one.

Height carries meaning downstream: **5 cm reads as a mountain** (level 2,
immovable) to the simulator and anything less as a movable platform.
[[Board-Extraction]] has the details, and it is the reason "Mountain" is 5 and
"Box" / "Train Vagon" are 2.5.

## Tokens

A token is free-placed (`x`, `z`), free-rotating, and **rests on top of a cube if
one is under it** (`cubeTopAt`). Its size comes from the preset (default
3 x 3 x 0.5 cm). Its shape is traced from the top texture's alpha and its sides
are tinted from the texture's border - see [[Rendering-3D]].

Tokens are decoration and reference for the physical game. **The simulator ignores
them entirely** - a player piece in the editor is not a player in the sim.

## Markers

The Marker tool stamps invisible game data. It is documented on its own page,
[[Gameplay-Markers]], because it is the bridge between authoring and simulation.
Short version: seven types, five of them `unique: true` (stamping elsewhere moves
the single instance), rendered as small coloured corner badges.

## Moving and rotating

With **Select**, clicking anything shows two handles above it:

- **✥** - hold and drag. Ground paint and tile-bound layers **hop between tiles**;
  custom art and tokens move freely on a 0.25 cm grid; cubes snap tile to tile.
- **⟳** - **tap** for one 90 deg step; **drag it in a circle** for free rotation.
  What "free" means depends on the object (`rotSnap`): ground, gameplay, label and
  cube always snap to 90 deg; custom art and tokens turn freely, or in 15 deg steps
  with Ctrl held.

`R` rotates the selection 90 deg from the keyboard. `Del` deletes. `Esc` deselects.

Dragging deliberately does **not** rebuild the scene per frame - `view.moveMesh`
and `view.rotateMesh` nudge the existing mesh and a single `App.commit()` runs at
the end of the gesture.

## The Layers panel

The right-hand Layers panel is **per-tile, not per-board**. It follows whatever is
selected: select a tile, a layer, a cube or a token and the panel shows that
*tile's* full stack, top to bottom -

```
  [layers on this tile, highest order first]   ▲ ▼ ✕
  [cubes and tokens on this tile]              ✕
  [ground]                                     (always last)
```

▲ / ▼ swap `order` with the neighbouring layer **on that tile only**, so
reordering one tile's stack cannot disturb another's.

## Saving

`Ctrl+S` saves, `Ctrl+O` loads. A sub-board with no id opens the Save As dialog
(name + tags); after that Save overwrites. A viewport thumbnail is captured on
every save. `New` prompts before discarding a dirty document.

## Related

[[Overview]] | [[Board-Assembly]] | [[Presets-and-Textures]] |
[[Gameplay-Markers]] | [[Save-Format]] | [[UI-and-Input]] | [[Rendering-3D]]
