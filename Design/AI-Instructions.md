# AI Instructions

**Status: Built.** Read this before changing code in this repository.

House rules for an AI agent (or a new human) working on Map Builder. They are not
style preferences; each one exists because the codebase is shaped a particular way
and violating it breaks something quietly.

## Orient first

Read [[Overview]], then the page for the area you are touching. The index at the
bottom of [[Overview]] maps every area to a file. `docs/GameRules-and-MapTester-Spec.md`
is the tabletop rules authority; [[Game-Rules]] is what the code actually does.

The whole app is 6,666 lines. **Read the file you are editing, in full, before
editing it.** There is no framework hiding behind anything, so reading is cheap and
guessing is expensive.

## The non-negotiables

**1. Mutate, then `App.commit()`.** There is no reactivity. Changing
`state.sub.data` without committing leaves the 3D view and every panel stale. The
only exceptions are the deliberate no-rebuild paths used during a drag
(`view.moveMesh`, `view.rotateMesh`, `view.updateSbTransform`), and they are always
followed by one `commit()` at the end of the gesture.

**2. `sim/engine.js` and `sim/model.js` stay pure and deterministic.** No DOM, no
`Date`, no `Math.random()`. All randomness goes through `st.rnd` (seeded
`mulberry32`). Replay works by re-simulating a seed and expecting the identical
game; a stray `Math.random()` breaks that silently, and the failure looks like "the
replay does not match the report" three weeks later.

**3. Never build a URL outside `api.js`.** Use `url()` and `texUrl()`. A
hard-coded `/assets/...` works on localhost and 404s on GitHub Pages, where the app
lives under a sub-path.

**4. Never touch the filesystem in `server.py` without `safe_join`.** It is the only
thing between a localhost tool and the rest of the drive.

**5. Defaults everywhere on read.** Saves have no schema version, so an old
document can be missing any field added since. Follow the existing pattern:
`data.markers || {}`, `preset.height || 5`, `tk.w ?? 3`, `sb.rot || 0`.

**6. `ui.js` builds DOM with `el()`,** not template strings, for anything carrying
user data. The analysis report and the help modal are the two accepted exceptions.

## Things that look like data but are conventions

The simulator infers meaning from authoring habits, so a rename can change how a
map plays. Before touching any of these, read [[Board-Extraction]]:

| Meaning | Encoded as |
|---------|-----------|
| a space is sky | the tile texture path matching `/sky/i` |
| a cube is a mountain | `height >= 5` |
| a cube is a train rather than a box | the preset **name** matching `/train/i` |
| which card art goes with which card | the **index** of the name in `CARDS`, mapped to `Card list-NN.png` |
| a sub-board's map tile number | `order`, falling back to the first digits in its name |

Renaming a texture, a preset or a card file is a **gameplay change**, not a
cosmetic one.

## Where to make a given change

| Change | File |
|--------|------|
| A new tool | `main.js` (`HINTS`, `setTool`, the pointer switch, the tool key map), `index.html` (button), `ui.js` if it needs a panel |
| A new document field | `state.js` factory, whatever reads it, and [[Save-Format]] |
| A new marker type | `MARKER_TYPES` in `state.js` - the palette and the 3D badges both read it - then `sim/model.js` to give it meaning |
| A rules change | `sim/engine.js`, then [[Game-Rules]]'s divergence table |
| A new card effect | `cardOption()` in `sim/engine.js`, and [[Cards]] |
| A new report metric | `aggregate()` in `sim/engine.js` and `renderResults()` in `sim/tester.js` |
| A new API route | `route_api()` in `server.py`, both backends in `api.js`, and `tools/build_static.py` if it is data the static build must bake |
| Anything visual in the board | `buildSubGroup()` in `view3d.js` |

## Testing

**There is no test suite.** Verification is manual and it has a shape:

1. Start the server (`.claude/launch.json` -> `map-builder`, port 8421) and open it.
2. For an editor change: load `Tile_1`, exercise the tool, save, reload, confirm
   the document round-trips.
3. For a simulator change: open Map Tester, pick `Main_Board`, **confirm there are
   no extraction warnings**, run 200 games, and compare the headline numbers to the
   previous run. `baseSeed` is fixed at 1000, so an unchanged engine must produce
   identical numbers. **If the report moved and you did not intend it to, stop.**
4. Replay one game and watch it. Numbers hide behaviour; the replay does not.
5. For a phone-layout change, use the browser's device emulation at <900 px, and
   check both 🖐 and ✏️ modes.

`window.MB = { state, view, App }` is exposed for the console.

## Do not

- Do not add a build step, a bundler, `node_modules` or a framework. The zero-install
  property is why the artists can run this.
- Do not add a runtime dependency to `server.py`. Standard library only - it has to
  freeze into a single portable exe.
- Do not fetch anything from a CDN. Three.js is bundled deliberately; the app must
  work offline.
- Do not rename or move files in `TextureAssets/` without checking `saves/` for
  references. There is no indirection layer; a path in a save is a path on disk.
- Do not commit `MapBuilder.exe`, `dist/`, `builds/` or `.build/`.
- Do not "fix" the empty-tile keys left behind by a grid resize. That is deliberate:
  shrinking the grid hides paint, growing it brings the paint back.

## Keep the docs true

This folder is documentation of a live codebase, not a historical record. **When
behaviour changes, the relevant file here changes in the same edit.** Two habits
carry that:

- Every file opens with a **Status** line. If a page starts describing something
  that is only half built, say which half.
- The "known gaps" and "divergence" sections are load-bearing. They are the reason
  a reader can trust the rest of the page. Adding a gap is not an admission of
  failure; leaving a stale claim in place is.

Counts, sizes and measured facts in [[Overview]] carry the date they were measured.
Re-measure rather than repeat.

## Related

[[Overview]] | [[Architecture]] | [[Frontend-Modules]] | [[Board-Extraction]] |
[[Game-Rules]] | [[Build-and-Run]] | [[Save-Format]]
