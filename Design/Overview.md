# Map Builder - Overview

> **How to read these docs.** Every file opens with a **Status** line saying how much
> of it is built. Statuses used: **Built** (matches the code today), **Partly built**
> (the file says which parts), **Designed** (agreed, not implemented), **Reference**
> (rules or facts, not a build claim).
>
> Design and code documentation live here. When behaviour changes, the file here
> changes in the same edit. Double-bracket links are Obsidian-style wiki links to
> other files in this folder.

**Status: Built.** Every mode described here runs today. The one document that
predates this folder is `docs/GameRules-and-MapTester-Spec.md` - the rules
specification the simulator was written from. It is still the authority on the
*board game's* rules; [[Game-Rules]] here restates what the **code** actually
enforces and flags where the two differ.

## What this is

Map Builder is a **desktop-local level editor for a physical board game**. It is not
the game. It is the tool the designers use to lay out map tiles, decorate them,
stamp gameplay data onto them, assemble four of them into a full board - and then
**simulate thousands of games on that board** to find out whether it plays well.

Two halves, one app:

```
   AUTHORING                              ANALYSIS
   ---------                              --------
   Sub-Board Editor  --save--> subboard \
                                         >-- Board Assembly --save--> board
   (paint, layers, cubes, tokens,       /                               |
    gameplay markers)                                                   v
                                                             Map Tester: extract
                                                             model -> simulate N
                                                             games -> stats + 3D
                                                             replay
```

The **gameplay markers** are the hinge between the halves. They are invisible in
the printed map but they are what turns a decorated grid into something a rules
engine can run on - see [[Gameplay-Markers]].

## The four modes

| Mode | What it does | Doc |
|------|--------------|-----|
| **Sub-Board Editor** | Design one grid board: ground paint, stacked art layers, 3D cubes, tokens, gameplay markers | [[Sub-Board-Editor]] |
| **Board Assembly** | Place, rotate and scale saved sub-boards into a full board; auto-arrange into the game's loop | [[Board-Assembly]] |
| **Game Assets** | Preview cards and character models at true physical scale next to a 5x5 cm tile | [[Game-Assets]] |
| **Map Tester** | Simulate full games on a saved board; stats, heatmap, and a video-player replay | [[Simulation-Engine]] |

## The stack, in one breath

A **zero-dependency Python 3 stdlib HTTP server** (`server.py`, 380 lines) serving a
**vanilla ES-module frontend** (`public/js/`, ~4,400 lines, no framework, no build
step) that renders with a **locally bundled Three.js**. Saves are plain JSON files
on disk. There is also a **server-less static build** of the same app for phones.
Details in [[Architecture]].

Nothing is installed. Nothing is compiled. `python server.py` and it runs; the
shipped `MapBuilder.exe` is the same server frozen with PyInstaller so the artists
do not need Python at all - [[Build-and-Run]].

## Established facts about the project

Measured on 2026-08-27, not assumed.

- **Code size: 6,666 lines** total. `server.py` 380 - `public/js` 4,398 across 9
  modules - `index.html` 227 - `style.css` 674 - `tools/build_static.py` ~110.
- **The simulator is the largest single thing in the project.** `sim/engine.js` is
  1,241 lines - bigger than the entire editor bootstrap (`main.js`, 975) and
  bigger than all the DOM UI (`ui.js`, 1,123). This is an analysis tool with an
  editor attached, not the other way round.
- **No package.json, no node_modules, no bundler.** Three.js ships as
  `public/lib/three.module.min.js` plus three addons (`OrbitControls`, `FBXLoader`,
  and the NURBS curve helpers `FBXLoader` imports). Module resolution is a plain
  `<script type="importmap">` in `index.html`.
- **79 PNG textures in 22 category folders**, 5 `.fbx` character models, 2 `.svg`,
  and one `.ai` source file that the build deliberately skips. `TextureAssets/` is
  51 MB on disk; the static build ships 26 MB of it.
- **Saves on disk today:** 4 sub-boards (`Tile_1`..`Tile_4`), 1 board
  (`Main_Board`), 3 cube presets, 17 token presets, **0 tile presets**. The tile
  preset feature works and nobody has used it yet.
- **All four sub-boards are fully marked up** for the simulator: each has exactly
  one checkpoint, one `coin3`, one `coin4`, one `large-a`, one `large-b`, one
  control panel, and 11-13 rail spaces. That means `Main_Board` produces **zero
  extraction warnings** - see [[Board-Extraction]].
- **Every tile is 3 x 6 cells of 5 cm**, so the assembled board is the 9x9 loop
  with an empty 3x3 centre that the rules describe. `Main_Board` was hand-placed,
  not auto-arranged: its four entries sit at (-7.5, -15, 180 deg), (0, -37.5, 270 deg),
  (22.5, -30, 0 deg) and (15, -7.5, 90 deg) - the same pinwheel Auto-Arrange now
  generates, just not centred on the origin.
- **Art is Git LFS-tracked** (`*.png`, `*.jpg`, `*.psd`, `*.ai`). The Pages workflow
  checks out with `lfs: true` and **fails the build** if a pointer file reaches
  `dist/`, because that failure is otherwise silent and produces a site with every
  texture broken.
- **A `Stop` hook zips a build after every Claude Code session**
  (`.claude/settings.json` -> `make-build.ps1`). That is why `builds/` has eleven
  zips in it. The script no-ops when nothing changed.

## Things worth knowing before you touch the code

- **`state.js` is the single source of truth** and it is a plain mutable object.
  There is no reactivity: mutate, then call `App.commit()`, which rebuilds the
  scene and refreshes the panels. Forgetting the commit is the classic bug here.
- **Boards reference sub-boards by save id, they do not copy them.** Editing
  `Tile_2` changes every board using it, immediately, with no migration step.
  `state.boardRuntime` is the in-memory cache of those referenced documents and it
  is refetched on every mode switch.
- **The simulator is deterministic per seed.** `simulate(model, cfg, seed)` replays
  identically, which is why the stats pass stores only summaries: a replay
  re-simulates the same seed with logging switched on. Never introduce
  `Math.random()` into `sim/`.
- **A cube's *height* is its meaning.** 5 cm = mountain (level 2, immovable),
  anything under 5 = a movable platform, and whether that platform is a train or a
  box is decided by a **regex on the preset name** (`/train/i`). See
  [[Board-Extraction]], "Where the semantics come from".
- **A tile is sky if its texture path matches `/sky/i`.** Same trick, same
  fragility.

## Design index

| Area | File |
|------|------|
| How the pieces fit, module by module | [[Architecture]] |
| The Python server, the HTTP API, path safety, preset seeding | [[Server-and-API]] |
| What each JS module owns and how they call each other | [[Frontend-Modules]] |
| Three.js scene construction, picking, silhouettes, thumbnails | [[Rendering-3D]] |
| The JSON on disk - every field of every save type | [[Save-Format]] |
| The server-less phone build and the Pages deploy | [[Static-Build-and-Deploy]] |
| Designing one grid board | [[Sub-Board-Editor]] |
| Combining sub-boards into a board | [[Board-Assembly]] |
| Textures, tile / cube / token presets | [[Presets-and-Textures]] |
| Cards and character models at physical scale | [[Game-Assets]] |
| Panels, gizmo, keyboard, and the phone dock | [[UI-and-Input]] |
| The board game's rules **as the code enforces them** | [[Game-Rules]] |
| The 13 initiative cards and how each is modelled | [[Cards]] |
| The marker vocabulary that makes a map simulable | [[Gameplay-Markers]] |
| Turning a saved board into a grid the engine can run | [[Board-Extraction]] |
| The rules engine: state, movement, trains, turns | [[Simulation-Engine]] |
| The three AI personas and how they choose | [[AI-Personas]] |
| The analysis report, heatmap and replay player | [[Analysis-and-Replay]] |
| Running it, building the exe, sharing it | [[Build-and-Run]] |
| **How an AI agent should work in this repo** | [[AI-Instructions]] |
