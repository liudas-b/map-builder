# Textures and Presets

**Status: Built.** 79 textures in 22 categories; 3 cube presets, 17 token presets,
0 tile presets on disk.

## Textures

Everything visual comes from `TextureAssets/`. **The folder path is the category** -
there is no metadata file, no tagging, no database. Drop a PNG into
`TextureAssets/GridTiles/Tiles/` and it appears under that category on the next
refresh.

Recognised extensions: `.png .jpg .jpeg .webp .gif .svg` (textures) and
`.fbx .glb .gltf .obj` (models).

The categories in use today:

```
3D elements/3D - Mountain      3D elements/3D Box      3D elements/3D Train Vagon
Cards                          Characters
GridTiles/Tiles                GridTiles/Gameplay      GridTiles/Customization
GridTiles/Labels
Heart Tokens/{Blue,Green,Red,Yellow}
Round token                    Spawnpoint              Tokens/Star token
Tokens/Player Token            Tokens/Heart Token
```

The browser's category dropdown **synthesises parent folders**, so selecting
`Tokens` matches `Tokens/Player Token` and `Tokens/Heart Token` too. Search matches
name or category. The grid is capped at 400 items - a soft cap that has never been
reached and would silently hide textures if it were.

### Uploading

**⬆ Upload textures** takes one or more files, an existing category or a new one
(free-text path, e.g. `GridTiles/Tiles/Winter`), reads each as a data URL and
POSTs to `/api/upload`. The server never overwrites - a clash becomes
`name (1).png`. After upload the browser reloads and jumps to that category.

Upload is **hidden entirely in the static build** - there is nowhere to write
([[Static-Build-and-Deploy]]).

## Presets

Three kinds, all stored as ordinary saves under `saves/*preset/`, all listed in
the left panel when their tool is active.

| Preset | Tool | Seeded on first run |
|--------|------|---------------------|
| `cubepreset` | Cube (7) | Mountain, Box, Train Vagon |
| `tokenpreset` | Token (8) | 17: 4 players, 8 hearts, Star, Spawnpoint, 3 round |
| `tilepreset` | Tile Preset (3) | none - you create these |

Seeding is guarded per folder and only fires when the folder is **absent**, so
curating the list is durable ([[Server-and-API]]).

### Cube presets

A name, a height, and six face textures. Height is offered as **Full 5x5x5** or
**Half 5x5x2.5**, and that choice is load-bearing: the simulator reads
`height >= 5` as an immovable mountain and anything less as a movable platform
([[Board-Extraction]]).

The dialog has a shortcut - **⿴ Use active texture for ALL four sides** - because
boxes and train vagons usually have one side art repeated.

The three seeded cubes:

| Preset | Height | Faces |
|--------|-------:|-------|
| Mountain | 5 | four distinct side arts + Mountain Top on top and bottom |
| Box | 2.5 | Box - Top on top/bottom, Box - Sides on all four |
| Train Vagon | 2.5 | Train-Top, Train-Front-Back on front/back, Train-Sides on sides |

### Token presets

A name, `w` / `l` / `h` in cm (default 3 x 3 x 0.5), a **top** texture and an
optional **bottom** (defaults to the top). No side texture: the sides are tinted
automatically from the top texture's border ([[Rendering-3D]]).

The seeded set is tagged so it filters well: `player`, `heart`, `marker`, `round`,
all plus `seeded`.

### Tile presets

Made from a *result*, not in a dialog: select a painted tile, press **📋 Save tile
as preset**, name it. It captures the ground (texture + rotation) and every
tile-bound layer on that tile (`gameplay` and `label`, never `custom`). Stamping it
replaces that tile's ground and its tile-bound layers.

This is the tool for repeated compositions - "grass + rails + checkpoint marker
art" - and nobody has used it yet.

## The armed-slot flow

Cube and token preset dialogs need a texture per face, and there is no file picker
for something already in the library. The solution is deliberately unusual:

1. The dialogs open as **floating, non-blocking** modals (`openModal({floating: true})`),
   draggable by their header, so the left-hand texture browser stays live.
2. Clicking a face slot **arms** it and registers a `setTextureClickHook`.
3. While a hook is set, a click in the texture browser goes to the dialog slot
   instead of setting `state.activeTexture`.
4. Closing any modal clears the hook.

If a texture click ever seems to "not work", an orphaned hook is the first thing to
check.

## Related

[[Sub-Board-Editor]] | [[Rendering-3D]] | [[Server-and-API]] | [[Save-Format]] |
[[Game-Assets]] | [[Board-Extraction]]
