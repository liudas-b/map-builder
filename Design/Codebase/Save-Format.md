# Save Format

**Status: Built.** Five document types, all plain JSON, all under `saves/`.

Everything Map Builder produces is a JSON file on disk. There is no database, no
binary format, no migration layer and **no schema version field** - see the
warning at the bottom.

## The envelope

Every save type, without exception, has the same header. The server writes it
(`api_write_save`); the client never sets `created` or `modified` itself.

```json
{
  "id": "tile-2-1786118458025",
  "name": "Tile_2",
  "tags": [],
  "created": 1786118458025,
  "modified": 1786119072410,
  "thumb": "data:image/jpeg;base64,...",
  "data": { }
}
```

| Field | Meaning |
|-------|---------|
| `id` | filename stem. `slugify(name) + "-" + epoch_ms` on first save, then stable forever |
| `name` | display name, freely editable, **not** tied to the id |
| `tags` | free-text strings; the Load browser filters on them |
| `created` / `modified` | epoch ms. `created` survives overwrites |
| `thumb` | JPEG data URL, 320 px wide, q 0.65 - a viewport grab at save time |
| `data` | the type-specific payload below |

The `thumb` is typically the biggest thing in the file. `Main_Board`'s save is
699 bytes *without* one; a sub-board with a thumb runs a few tens of KB.

## `subboard` - one grid board

`data` is exactly what `newSubData()` produces.

```json
{
  "grid":     { "cols": 3, "rows": 6, "cell": 5 },
  "tiles":    { "0,0": { "tex": "GridTiles/Tiles/Grass.png", "rot": 0 } },
  "overlays": [ { "id": "msj4sizc-x", "type": "gameplay",
                  "tex": "GridTiles/Gameplay/Rails 1.png",
                  "rot": 270, "order": 1, "row": 5, "col": 0 } ],
  "cubes":    [ { "id": "...", "row": 2, "col": 1, "rot": 0,
                  "preset": { "name": "Mountain", "height": 5,
                              "top": "...", "bottom": "...",
                              "front": "...", "back": "...",
                              "left": "...", "right": "..." } } ],
  "tokens":   [ { "id": "...", "x": -2.5, "z": 7.5, "rot": 0,
                  "w": 3, "l": 3, "h": 0.5,
                  "top": "...", "bottom": "..." } ],
  "markers":  { "5,1": ["rail", "panel"] }
}
```

- **`grid.cell` is centimetres.** World coordinates are centimetres too, with the
  board centred on the origin: tile `(row, col)` sits at
  `x = (col+0.5)*cell - cols*cell/2`, `z = (row+0.5)*cell - rows*cell/2`.
- **`tiles` is keyed `"row,col"`** and a missing key means an unpainted tile.
  Resizing the grid does **not** prune out-of-range keys, so paint outside a
  shrunk board survives and reappears if you grow it again. The 3D builder and the
  marker renderer both range-check before drawing.
- **`overlays` is a flat list**, not per-tile, ordered by the `order` field.
  `type` is `gameplay` | `custom` | `label`. Tile-bound types carry `row`/`col`;
  `custom` carries free `x`/`z`/`w`/`h` instead. Labels get `order >= 1000` from
  `nextOverlayOrder`, which is how they land on top.
- **`cubes` embed a *copy* of the preset**, not a reference. Editing a cube preset
  later does not retroactively change placed cubes - deliberate, so a board cannot
  silently change under a designer.
- **`tokens` likewise embed** their size and faces.
- **`markers` is keyed `"row,col"` -> array of marker ids** and holds no geometry
  at all. It is pure game data for the simulator ([[Gameplay-Markers]]).

Ids inside a document come from `uid()` and only need to be unique within that
document.

## `board` - an assembly of sub-boards

```json
{ "subboards": [
  { "uid": "msj51w12-2n", "saveId": "afdsadfs-1785767539726", "name": "Tile_1",
    "x": -7.5, "z": -15, "rot": 180, "sx": 1, "sz": 1, "order": 1 } ] }
```

| Field | Meaning |
|-------|---------|
| `uid` | identity of this *placement* within the board |
| `saveId` | **reference** to a `subboard` save - the content is not copied |
| `name` | cached display name, refreshed on load |
| `x`, `z` | world position in cm, snapped to half-tile steps while dragging |
| `rot` | degrees, 90 deg steps (15 deg with Ctrl) |
| `sx`, `sz` | scale; the vertical scale is the mean of the two |
| `order` | **map tile number 1-4**: reveal order for the simulator. `null` when unset |

Because content is referenced, **editing a sub-board updates every board using
it**. The flip side: a board whose sub-board save was deleted loads with that
entry silently dropped and a toast naming what went missing.

`performSave` explicitly re-projects each entry to just these fields, so the
runtime-only cache in `state.boardRuntime` never leaks into the file.

## `cubepreset`

```json
{ "height": 5, "top": "...", "bottom": "...",
  "front": "...", "back": "...", "left": "...", "right": "..." }
```

`height` is 5 (full) or 2.5 (half) in the UI, but the field is a free number and
the simulator's only test is `>= 5`. Any face may be `null` and renders as flat
grey. `bottom` defaults to `top` on save.

**The height is semantic, not just visual**: >= 5 becomes an immovable mountain
(level 2) in the simulator, anything less becomes a movable platform
([[Board-Extraction]]).

## `tokenpreset`

```json
{ "top": "...", "bottom": "...", "w": 3, "l": 3, "h": 0.5 }
```

Dimensions in cm. `top` is required; `bottom` defaults to it. The side colour is
**not** stored - it is sampled from the top texture's border at render time
([[Rendering-3D]]).

## `tilepreset`

```json
{ "ground": { "tex": "...", "rot": 0 },
  "overlays": [ { "type": "gameplay", "tex": "...", "rot": 0 } ] }
```

A stamp: ground plus the tile-bound layers, with no `row`/`col` (they are supplied
when stamped). `ground` may be `null`. `custom` layers are never captured - they
are not tile-bound. **Zero of these exist on disk today.**

## Texture paths

Every texture reference in every save is a **path relative to `TextureAssets/`**,
using forward slashes, with the extension, e.g. `GridTiles/Tiles/Grass.png`.
`texUrl()` turns it into a request URL; the static build resolves the same string
against `dist/assets/`. **Renaming or moving a file in `TextureAssets/` breaks
every save that referenced it**, silently - the texture just fails to load and the
mesh shows grey.

## What is *not* in a save

- No schema version. Adding a required field means old saves load without it -
  every reader must default. The code does this consistently today
  (`data.markers || {}`, `p.height || 5`, `tk.w ?? 3`) and new code must too.
- No author, no history, no undo stack.
- No camera position and no background colour. The background is per-browser
  (`localStorage['mb-bg']`).

## Storage locations

| Backend | Where saves live |
|---------|------------------|
| Local server | `saves/<type>/<id>.json` |
| Static build | bundled read-only in `data/manifest.json`; anything you save goes to `localStorage` under `mb.save.<type>.<id>` |

In the static build a locally-saved document **shadows** a bundled one of the same
id, and the Load browser tags it *"on this device"*. Moving work between the two is
the `download` / `import` pair in `api.js` - [[Static-Build-and-Deploy]].

## Known weaknesses

- **Writes are not atomic.** `open(w)` + `json.dump`. A crash mid-write truncates
  a save. Accepted at this scale; the fix is write-temp-then-replace.
- **No versioning**, as above.
- **Path-fragile references** to textures and to sub-board saves.

## Related

[[Server-and-API]] | [[Sub-Board-Editor]] | [[Board-Assembly]] |
[[Presets-and-Textures]] | [[Gameplay-Markers]] | [[Static-Build-and-Deploy]]
