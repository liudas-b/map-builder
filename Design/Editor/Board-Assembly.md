# Board Assembly

**Status: Built.** `state.mode === 'board'`.

A board is four (or any number of) saved sub-boards, positioned, rotated and
numbered. It is the thing the Map Tester runs on.

## References, not copies

A board entry stores a `saveId` and a transform. The sub-board's content is
fetched at load time into `state.boardRuntime[saveId]` and re-fetched on every
entry into board mode (`refreshBoardRuntime`).

**So editing `Tile_2` updates every board that uses it, with no migration and no
prompt.** That is the point: designers iterate on one tile and immediately see it
in the assembled loop. The cost is that deleting a sub-board save quietly removes
it from every board - `loadDoc` filters out entries whose sub-board is missing and
toasts *"Missing sub-board saves: ..."*.

## The three board tools

The left toolbar swaps to three buttons in this mode. None of them is really a
tool - `setTool` short-circuits all three into an action.

### ➕ Add Sub-Board

Opens the save browser. On pick, the sub-board is fetched, cached in
`boardRuntime`, and placed in a rough 2x2 tiling so four of them do not land on
top of each other:

```
x = ((n % 2) - 0.5) * w
z = (floor(n/2) % 2 - 0.5) * d + floor(n/4) * (d*2 + 6)
```

It is then selected so you can drag it straight away.

### ⊞ Auto-Arrange

**Requires exactly four sub-boards.** Sorts them by `order` (falling back to a
numeric-aware name compare), then snaps them into the game's pinwheel loop -
strips around an empty W x W centre, where `W = cols * cell` of the first
sub-board's grid:

| Slot | x | z | rot |
|------|---|---|-----|
| 1 | -W | W/2 | 180 deg |
| 2 | -W/2 | -W | 270 deg |
| 3 | W | -W/2 | 0 deg |
| 4 | W/2 | W | 90 deg |

and writes `order = 1..4` as it goes. With the shipped 3 x 6 tiles, W = 15 cm, and
the result is the 9x9 grid with the empty 3x3 centre the rules describe - centred
on the origin.

The shipped `Main_Board` was hand-placed before this tool existed. Its geometry is
the same pinwheel, just offset; running Auto-Arrange on it would re-centre it
without changing how it plays.

### 🎲 Randomize

Keeps the current **slots** - position and rotation - and deals different
sub-boards into them. The dialog lists every saved sub-board with the currently
used ones pre-ticked; you must select at least as many as there are slots, because
**no sub-board may appear twice on a board**. It shuffles the picks, takes the
first N, and swaps each slot's `saveId`/`name`.

This is the map-variety tool: build a library of tiles, then generate boards to
test with.

## Placing and transforming

- **Drag** a sub-board to move it. Position snaps to **half a tile**
  (`cell / 2`, so 2.5 cm) precisely so grids line up edge to edge.
- **⟳** rotates in 90 deg steps; Ctrl gives 15 deg for deliberate off-grid looks.
- **Scale** `sx` / `sz` are in the Selection panel. The vertical scale is the mean
  of the two, so a non-uniform scale does not produce absurdly stretched cubes.

Transforms during a drag go through `App.commitBoardTransform()`, which calls
`view.updateSbTransform()` - a single group transform, no rebuild.

Picking is different in this mode: `view.pick()` walks *up* from whatever mesh was
hit to the `kind: 'sb'` wrapper group, so clicking any tile, cube or token selects
the whole sub-board. There is no way to edit a sub-board's contents from here;
that is the Sub-Board Editor's job.

## Map tile # - the field that matters for simulation

The Selection panel has **Map tile # (1-4)**, which writes `order`. It is not
cosmetic:

- It is the **reveal order** for the simulator - 1 is the starting tile, then
  clockwise ([[Game-Rules]]).
- It decides which row of `LARGE_DEFS` the tile's two large coins use, so it sets
  their VP values ([[Cards]] and [[Board-Extraction]]).
- Auto-Arrange writes it. `0` means unset.

If `order` is missing, [[Board-Extraction]] falls back to the **first number in
the sub-board's name** (`Tile_3` -> 3), and only then to the array index. Naming
tiles `Tile_1`..`Tile_4` is therefore a working safety net - which is what the
shipped saves rely on.

The sub-board list on the right shows `#n` badges so mis-numbering is visible at a
glance.

## Saving

Same `Ctrl+S` / `Ctrl+O` as the editor, but a board with no sub-boards refuses to
save. `performSave` re-projects each entry down to
`{uid, saveId, name, x, z, rot, sx, sz, order}` so the runtime cache never reaches
disk.

## Related

[[Sub-Board-Editor]] | [[Board-Extraction]] | [[Game-Rules]] | [[Save-Format]] |
[[Simulation-Engine]]
