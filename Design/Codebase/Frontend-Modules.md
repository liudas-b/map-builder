# Frontend Modules

**Status: Built.** Nine ES modules, 4,398 lines, no framework, no build step.

What each module owns, what it must never do, and where the seams are.

| Module | Lines | Owns |
|--------|------:|------|
| `state.js` | 64 | the mutable app state, data factories, `MARKER_TYPES` |
| `api.js` | 209 | all data access; the server / static backend choice |
| `main.js` | 975 | bootstrap, the `App` facade, tools, input, modes, save/load |
| `ui.js` | 1123 | every panel, modal, browser, dialog, properties and layers |
| `view3d.js` | 629 | the Three.js scene, board meshes, picking, camera, thumbnails |
| `mobile.js` | 258 | the phone dock, item strip and bottom sheet |
| `sim/model.js` | 127 | saved board -> flat grid model; card list; large-coin table |
| `sim/engine.js` | 1241 | rules, AI, simulation runner, aggregation |
| `sim/tester.js` | 572 | tester setup panel, report, heatmap, replay player |

## `state.js` - the bottom of the graph

Imports nothing. Exports:

- **`state`** - the single mutable object. Modes, tool, active texture / preset /
  marker, the texture and model catalogues, the two documents (`sub` and `board`),
  `boardRuntime` (the cache of sub-board data a board references), and `selection`.
- **`doc()`** - `state.mode === 'sub' ? state.sub : state.board`. The reason most
  save/load code does not care which mode it is in.
- **`newSubData()` / `newBoardData()`** - the shape of a fresh document. These are
  the *definition* of the save format; [[Save-Format]] documents them.
- **`uid()`** - `Date.now().toString(36) + '-' + counter.toString(36)`. Unique
  within a session, which is all an id inside one document needs to be.
- **`MARKER_TYPES`** - the seven gameplay markers, their colours, two-letter badge
  text and `unique` flag. Both the editor palette and the 3D badge renderer read
  this one list ([[Gameplay-Markers]]).
- **`nextOverlayOrder(data, type)`** - draw order for a new layer. Labels start at
  `max(max+1, 1000)`, which is the whole implementation of "labels go on top".

## `api.js` - the backend seam

Picks its backend **once, at module load**, with a top-level `await`:

```js
try { const res = await fetch(url('data/manifest.json')); if (res.ok) manifest = await res.json(); }
catch { /* no manifest -> the Python server is behind us */ }
export const MODE = manifest ? 'static' : 'server';
```

`staticApi` and `serverApi` implement the same seven calls; `api` is a thin facade
over whichever won, plus two flags the UI branches on - `api.canUpload` and
`api.isWritable(meta)`.

Everything else in the app calls `api.*` and never `fetch`. Two details that are
easy to miss:

- **`url(rel)`** builds every URL from `new URL('.', document.baseURI)`, so the app
  works both at `http://localhost:8420/` and under a Pages sub-path like
  `https://user.github.io/map-builder/`. Never hand-write a leading-slash URL.
- **`texUrl(path)`** encodes each path segment separately, because texture folders
  and files have spaces in them (`Tokens/Player Token/Human-Front.png`).

`downloadSave()` and `importSaveFile()` live here too - they are how work moves
between a phone and the desktop app ([[Static-Build-and-Deploy]]).

## `main.js` - bootstrap and input

Three responsibilities that grew together:

**The `App` facade.** `select`, `commit`, `commitBoardTransform`,
`validateSelection`, `deleteSelection`, `reloadTextures`, `reloadModels`,
`reloadPresets`, `selectGameAsset`, `applyRandomize`, `openSubInEditor`, plus the
`on*Changed` hooks that let `mobile.js` react. `ui.js` and `mobile.js` receive this
object at boot and call *through* it - they never import `main.js`.

**Tools and placement.** `setTool()` plus one small function per tool
(`paintTile`, `stampTile`, `addTileOverlay`, `addCustom`, `placeCube`,
`placeToken`, `stampMarker`, `eraseAt`). Each mutates `state.sub.data` and calls
`App.commit()`. Three tools are not tools at all - `addsub`, `arrange` and
`random` short-circuit in `setTool()` into board-assembly actions.

**Input.** Pointer handling for the viewport (place / paint / drag), the gizmo's
two handles, the keyboard map, the mode tabs, the background picker, and the phone
layout reflow (`placeDocControls`, which physically moves the mode tabs and
document buttons into the left drawer under 900 px and back out above it).

Boot order at the bottom of the file:

```js
window.MB = { state, view, App };   // console handle
UI.initUI(App); Tester.initTester(view); Tester.wireTesterUI();
await reloadTextures(); await reloadPresets(); await reloadModels();
setMode('sub');
```

## `ui.js` - all the DOM

One tiny helper does all element creation:

```js
el('div', { class: 'x', text: 'y', onclick: fn }, ...children)
```

Keys starting with `on` become listeners, `text`/`html`/`class` are special-cased,
everything else becomes an attribute. There is no templating and no innerHTML for
user data - except the analysis report and the help modal, which are static
strings.

The panel refreshers are all idempotent full redraws: `refreshBrowser`,
`refreshPresetPanel`, `refreshMarkerPanel`, `refreshProps`, `refreshLayers`,
`refreshSbList`, `refreshGamePanels`, `refreshGameInfo`. `refreshProps` is the big
one - a per-`selection.kind` branch producing the right form for a tile, layer,
cube, token or placed sub-board ([[UI-and-Input]]).

`openModal()` supports two flavours: a normal backdrop modal, and `floating: true`
which produces a **draggable, non-blocking** panel. The preset dialogs use the
floating flavour on purpose - you must be able to click textures in the left
browser while the dialog is open, which is how the "arm a face slot, then click a
texture" flow works ([[Presets-and-Textures]]).

`setTextureClickHook(fn)` is that flow's mechanism: while a hook is set, clicks in
the texture browser go to the dialog instead of setting `state.activeTexture`. The
hook is cleared whenever a modal closes.

## `view3d.js`

Documented on its own page - [[Rendering-3D]].

## `mobile.js`

Built on one idea: **do not duplicate the panels.** The bottom sheet *borrows* the
real panel node out of the drawer (`hostSlot` remembers where it came from) and
hands it back on close, so a control behaves identically in both layouts and there
is only one implementation of it. The rest is the dock (`tool | palette | hand-pen
| fit | hide`) and the strip - a horizontal row of the current tool's textures,
presets or markers, which turns into the selection's actions when something is
selected. See [[UI-and-Input]].

## `sim/*`

The simulator is a self-contained subsystem with one entry from the app
(`Tester.enterTesterMode()`) and one dependency out of it (`api.getSave`). Its
three files are documented in [[Board-Extraction]], [[Simulation-Engine]],
[[AI-Personas]] and [[Analysis-and-Replay]].

The one hard rule: `engine.js` and `model.js` must stay **pure and deterministic**.
No DOM, no `Math.random()` (the engine carries its own `mulberry32` seeded PRNG as
`st.rnd`), no clock. Determinism is load-bearing: the stats pass discards the event
log, and pressing Replay re-runs the same seed with logging on and expects the
identical game back.

## Related

[[Architecture]] | [[Rendering-3D]] | [[UI-and-Input]] | [[Save-Format]] |
[[Simulation-Engine]]
