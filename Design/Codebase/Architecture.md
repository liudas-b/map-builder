# Architecture

**Status: Built.** Describes the code as it stands.

How the whole thing is wired, from the folder on disk to the pixel on screen.

## Folder map

```
map-builder/
  server.py              zero-dependency stdlib HTTP server + JSON API
  MapBuilder.exe         the same server, frozen with PyInstaller (git-ignored)
  start-map-builder.bat  alternative launcher for anyone who has Python
  make-build.ps1         zips the shareable folder into builds/ (run by a Stop hook)

  public/                THE APP. served at /
    index.html           all the DOM, all the panels, the importmap
    css/style.css        one stylesheet, dark theme, phone media queries
    js/
      main.js            bootstrap, tools, pointer/keyboard input, modes, save/load
      state.js           the mutable app state + data factories + MARKER_TYPES
      api.js             data access; picks the server or the static backend
      ui.js              every panel, modal, browser and dialog
      view3d.js          Three.js scene, board construction, picking, camera
      mobile.js          the phone dock, strip and bottom sheet
      sim/
        model.js         saved board -> flat simulable grid model
        engine.js        rules engine + AI personas + simulation runner
        tester.js        Map Tester UI: setup, report, heatmap, replay player
    lib/                 bundled Three.js + OrbitControls + FBXLoader (+NURBS)

  TextureAssets/         all art, organised into category folders. Git LFS.
  saves/                 all documents as JSON: subboard/ board/ *preset/
  tools/build_static.py  bakes the app + assets + saves into a server-less dist/
  dist/                  static build output (git-ignored)
  docs/                  the original game rules & Map Tester spec
  Design/                you are here
  .github/workflows/     GitHub Pages deploy
```

## The runtime picture

```
                      +-------------------- browser --------------------+
                      |                                                 |
 server.py  <--HTTP-->|  api.js  <--  state.js  -->  view3d.js  --> WebGL|
   |                  |     ^            ^  ^            ^              |
 saves/*.json         |     |            |  |            |              |
 TextureAssets/       |   ui.js       main.js  mobile.js  |              |
                      |     ^            |               |              |
                      |     +-- sim/tester.js -- sim/engine.js           |
                      |              ^                                   |
                      |         sim/model.js (reads saves via api.js)     |
                      +-------------------------------------------------+
```

Four rules hold this together:

1. **`state.js` imports nothing.** It is the bottom of the dependency graph - a
   plain object plus factory functions. Everything else imports it.
2. **`api.js` is the only module that touches the network or `localStorage`.**
   Swap its backend and the whole app moves from "local server" to "static site"
   with no other edit ([[Static-Build-and-Deploy]]).
3. **`main.js` owns the `App` facade** and hands it to `ui.js`, `mobile.js` and
   `sim/tester.js` at boot (`UI.initUI(App)`, `Mobile.initMobile({App, view, ...})`,
   `Tester.initTester(view)`). Those modules never import `main.js` back - the
   dependency arrow points one way and the facade is the seam.
4. **`view3d.js` never reads UI state and never writes document state.** It reads
   `state.mode` / `state.sub` / `state.board` and draws them.

## The commit cycle

There is no reactive framework. The contract is explicit and it is the thing to
learn first:

```js
mutateSomething(state.sub.data);   //  1. change the document
App.commit();                      //  2. tell the app
```

`App.commit()` (`main.js`) does, in order:

| Step | Why |
|------|-----|
| `validateSelection()` | drops a selection whose object no longer exists |
| `doc().dirty = true` | drives the `*` in the window title and the discard prompt |
| `view.rebuild()` | tears down and rebuilds the whole Three.js content group |
| `UI.refreshProps()` / `UI.refreshLayers()` | redraw the right-hand panels |
| `Mobile.onSelectionChanged()` | redraw the phone selection strip |
| `UI.refreshSbList()` (board mode) | redraw the sub-board list |
| `updateTitle()` | window + input field |

**`rebuild()` is a full teardown.** That is fine for a 3x6 board with a few dozen
meshes and it is the reason the code stays simple. Where full rebuild would be
visibly wrong - dragging, live rotation - there are surgical escape hatches:
`view.moveMesh()`, `view.rotateMesh()` and `view.updateSbTransform()` move an
existing mesh without a rebuild, and `commit()` is called once at the end of the
gesture (`finishDrag()`).

## Modes

`state.mode` is one of `'sub' | 'board' | 'game' | 'tester'`. `setMode()` in
`main.js` is a big deliberate switchboard: it toggles `.sub-only`, `.board-only`,
`.game-only` and `.tester-only` classes across the DOM, hides the document
controls in the two read-only modes, and hands the viewport over.

The two analysis/preview modes take the viewport away from the editor entirely:

- `view.rebuild()` **returns immediately when `state.mode === 'tester'`** - the
  tester owns `view.content` for as long as it is open.
- Pointer handlers in `main.js` bail out in `game` and `tester` mode, so the
  camera is all you get.

## Where a click goes

Worth tracing once, because it touches most of the codebase:

```
pointerdown on #viewport (main.js)
  -> touchCamera? finger belongs to OrbitControls, stop
  -> board mode? view.pick() -> select the sub-board, maybe start a drag
  -> switch (state.tool)
       paint    -> view.pickTile() -> paintTile() -> state.sub.data.tiles[...] -> commit
       cube     -> view.pickTile() -> placeCube()  -> state.sub.data.cubes.push -> commit
       custom   -> view.groundPoint() (ray x ground plane) -> addCustom() -> commit
       marker   -> view.pickTile() -> stampMarker() -> state.sub.data.markers -> commit
       select   -> view.pick() -> App.select() -> gizmo appears -> maybe start drag
```

`pick()` raycasts `view.content` and walks up to the first object carrying a
`userData.kind`; `pickTile()` is the same raycast filtered to tiles so painting
cannot be blocked by a decal sitting on top. `groundPoint()` skips geometry
entirely and intersects the infinite y=0 plane, which is how free-placed art and
tokens can be dropped anywhere including off the painted area (then clamped by
`clampToBoard`).

## Related

[[Overview]] | [[Frontend-Modules]] | [[Server-and-API]] | [[Rendering-3D]] |
[[Save-Format]] | [[UI-and-Input]]
