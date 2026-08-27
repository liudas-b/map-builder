# Game Assets

**Status: Partly built.** Preview and upload work. **Character models render in
flat white** - the real textures have not been added.

`state.mode === 'game'`. A read-only mode: the document controls, the tools, the
texture panel and the properties panel all hide, and the viewport becomes a
turntable for one asset at a time.

## What it is for

The board game has physical components that are not part of the map: **13
initiative cards** and **playable character miniatures**. This mode answers one
question - *does this thing read at its real size, next to a real tile?* - which is
why every preview is drawn against a **5 x 5 cm reference tile** and nothing is
auto-scaled to fill the frame.

## Cards

Any image in `TextureAssets/Cards` (or a subfolder). Shown in a 2-column grid at
the card aspect ratio `63/88` on a white backing, so transparent art does not read
as a hole.

Selecting one draws it as a `Plane(6.3, 8.8)` standing upright at y = 4.4 on the
tile: **63 x 88 mm, the physical card size**, double-sided so orbiting behind it
still shows something.

The 13 files present follow the naming
`Human Fall Flat - Card list-02.png` .. `-14.png`. That numbering is **not
decorative** - `sim/model.js` maps card name to art by index:

```js
export function cardArt(name) {
  const i = CARDS.indexOf(name);          // Trick, Jump, Parkour, Group Up, ...
  return i < 0 ? null : `Cards/Human Fall Flat - Card list-${String(i + 2).padStart(2, '0')}.png`;
}
```

so `-02` is Trick, `-03` is Jump, ... `-14` is Whine. **Renaming or reordering
those files silently breaks the replay's card strip** ([[Analysis-and-Replay]]).
The card list itself is in [[Cards]].

## Characters

Any `.fbx` / `.glb` / `.gltf` / `.obj` in `TextureAssets/Characters`. Five ship
today: `GreenGirl`, `Penguin`, `PoliceGuy`, `SimpleGuy`, `YellowDog`.

Loading goes through `loadModel(path)`, a promise cache over `FBXLoader`. The model
is then:

1. traversed and **retextured to flat white** (`MeshLambertMaterial 0xf2f2f2`),
2. measured with a `Box3` and **scaled so its height is 4.2 cm**,
3. recentred in x/z and seated with `box.min.y` on the tile.

The flat white is a placeholder, stated as such in the panel note. When real
character textures arrive, that traverse is the line to change.

A `_gameBuildId` counter guards the async load: if the user clicks another asset
while an FBX is still decoding, the stale result is dropped instead of appearing
over the new one.

## Uploading

**⬆ Upload cards…** and **⬆ Upload characters…** both use the same
`/api/upload` endpoint as the texture uploader, hard-coded to the `Cards` and
`Characters` categories. Cards accept `png/jpg/jpeg/webp`; characters accept
`fbx/glb/gltf/obj`. Both are hidden in the static build.

After upload both the texture list and the model list are reloaded, because a card
is a texture and a character is a model and the two catalogues are fetched
separately.

## Known gaps

- **Characters are untextured.** Flagged in the UI.
- **`.glb` / `.gltf` are accepted by the uploader and by `list_models`, but only
  `FBXLoader` is bundled.** A GLB would upload, list, and then fail to load with a
  console error. Adding `GLTFLoader` to `public/lib` and branching on the
  extension in `loadModel` is the fix.
- Cards have no data behind them here - the 13 effects are hard-coded rules in
  `sim/engine.js`, not map data ([[Cards]]).

## Related

[[Cards]] | [[Rendering-3D]] | [[Presets-and-Textures]] | [[Analysis-and-Replay]] |
[[Server-and-API]]
