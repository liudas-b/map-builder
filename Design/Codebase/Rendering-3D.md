# 3D Rendering

**Status: Built.** `public/js/view3d.js`, 629 lines, Three.js bundled locally.

Everything the user sees in the viewport is built here. The board is drawn from
the save document every time it changes; nothing incremental, nothing clever,
except in the three places where a full rebuild would be visibly wrong.

## Units

**One world unit = one centimetre.** A default tile is 5 x 5 cm, a full cube is
5 x 5 x 5, a half cube 2.5 tall, a default token 3 x 3 x 0.5, a playing card
6.3 x 8.8. The camera starts at `(28, 42, 46)` with a 50 deg FOV and near/far of
0.1 / 4000. Keeping physical units means the Game Assets preview can honestly
claim "this card next to this tile is what the table will look like".

## Scene setup

```
scene
 +- AmbientLight   0xffffff  1.6
 +- DirectionalLight 0xffffff 1.2  from (40, 80, 30)     key
 +- DirectionalLight 0xffffff 0.4  from (-30, 40, -50)   fill
 +- content   <- everything rebuildable lives under this one group
 +- helper    <- BoxHelper around the current selection (yellow 0xffc84f)
```

No shadows, no post-processing, no tone mapping. `MeshBasicMaterial` for anything
carrying a texture that should look like printed art (tiles, decals, cards) so the
lighting cannot tint it; `MeshLambertMaterial` for anything with volume (cubes,
token bodies, replay pieces) so the faces read apart.

Orbit controls are deliberately split so that **left-drag is always the tool**:

```js
controls.mouseButtons = { MIDDLE: PAN, RIGHT: ROTATE };      // no LEFT entry
controls.touches      = { ONE: null, TWO: DOLLY_PAN };       // one finger = the tool
```

`setTouchOrbit(true)` hands `ONE` back to `TOUCH.ROTATE` - that is the whole
implementation of the phone's hand/pencil toggle ([[UI-and-Input]]).

The render loop is a plain `requestAnimationFrame` that updates controls, updates
the selection helper and renders. A `ResizeObserver` on the canvas parent handles
sizing, so the drawers opening and closing on a phone do not stretch the view.

## `buildSubGroup(data, index, opts)`

The one function that turns a sub-board document into meshes. Board Assembly calls
it once per placed sub-board; the Map Tester calls it with `skipMovables` and
`skipMarkers` so it can draw the boxes and trains itself as animated pieces.

Draw order, bottom to top:

| Layer | Geometry | Notes |
|-------|----------|-------|
| Base plate | `Box(W+1.2, 0.8, D+1.2)` at y = -0.45 | `userData.kind = 'plate'` - deliberately **not** pickable as an object; it exists so an empty board still has a silhouette and so board mode has something to raycast |
| Tiles | unit `Plane` scaled to `cell` | textured, or `0x39404f` when unpainted. `renderOrder = 1` |
| Grid lines | `LineSegments` at y = 0.02 | `renderOrder = 1000`, `raycast` stubbed out so lines never block a click |
| Overlays | `Plane(w, h)` per layer | y = `0.06 + rank*0.02`, `renderOrder = 2 + rank` |
| Cubes | `Box(cell, h, cell)` with **six materials** | order `[right, left, top, bottom, front, back]` - Three's box face order |
| Marker badges | `Plane(1.6, 1.6)` in tile corners | canvas-drawn, lifted onto a cube's top if one is on that tile |
| Tokens | extruded silhouette | see below |

The `index` map (`"kind:id" -> mesh`) is filled only in sub mode. It is what
`moveMesh`, `rotateMesh` and `meshForSelection` use to avoid a rebuild.

**Two coincident-plane defences** run throughout: every decal gets
`depthWrite: false` plus an explicit `renderOrder`, and each stacked layer is
lifted 0.02 cm above the last. That combination is why a label on a gameplay layer
on painted ground does not z-fight.

Rotation is applied as `rotation.order = 'YXZ'` then `rotation.x = -PI/2` and
`rotation.y = -deg2rad(rot)`. The **negative** y is what makes a positive `rot`
value turn clockwise when you look down at the board, which is what a designer
expects from a top-down map.

## Tokens: the silhouette trick

A token is not a box. `silhouette(path)` loads the texture into a 96 x 96 canvas,
finds the centroid of the opaque pixels, then does a **radial scan** - 90 rays out
from the centroid, each stopping at the outermost pixel with alpha > 60 - and
smooths the resulting radii with a 1-2-1 kernel to take the pixel stair-stepping
off. The result is a `THREE.Shape` in image space.

That shape becomes three meshes in a scaled group: an `ExtrudeGeometry` side wall
and two `ShapeGeometry` caps (top and bottom faces, at y = 1.001 and -0.001 in the
group's unit space, so they cover the extrusion's own caps). A star token is
star-shaped; a heart is heart-shaped; a fully opaque rectangle degenerates
gracefully back to the old box look.

`sideColor(path)` does the complementary job for the side wall: it samples a
**band near the image border** (inset 8%, band 10% of a 48 px downscale), averages
the pixels with alpha > 200, and converts sRGB to linear. So a red heart token gets
red sides automatically and nobody has to author a side texture.

Both results are promise-cached by path. Because they resolve after the group is
already in the scene, the token build checks `if (!grp.parent) return` - the board
may have been rebuilt while the image was decoding.

## Marker badges

`markerTexture(type)` draws a rounded square in the marker's colour with its
two-letter code centred, into a 96 x 96 canvas, once per type, and caches it. The
badges are placed in **tile corners**, cycling through the four corners so several
markers on one tile do not overlap; a fifth would stack 0.02 above the first.
They sit on top of a cube if there is one on the tile, which is what makes an
`LA` marker on a mountain readable.

## Picking

Three entry points, deliberately different:

- **`pick(ev)`** - raycast `content`, return the first hit whose `userData.kind` is
  set and is not `'plate'`. In board mode it instead walks *up* the parent chain to
  the `kind: 'sb'` wrapper, so clicking any part of a sub-board selects the whole
  sub-board.
- **`pickTile(ev)`** - same raycast filtered to `kind === 'tile'`. Painting uses
  this so a decal lying on the tile cannot shield it.
- **`groundPoint(ev)`** - no geometry at all; intersect the infinite y=0 plane.
  Free-placed art and tokens use this, then `clampToBoard()` pulls the result back
  inside the board extents.

## Camera framing

`frame(minSpan = 20)` measures `content`'s bounding box and places the camera at
`center + (span*0.55, span*1.05, span*0.95)` with the target on the centre.
`span` is `max(size.x, size.z, size.y*1.2, minSpan)`. The `minSpan` argument is why
the Game Assets preview (`frame(10)`) does not zoom absurdly far out for a single
card.

## Thumbnails

`captureThumb()` forces a render, then draws the WebGL canvas into a 320 px-wide
2D canvas and returns a JPEG data URL at quality 0.65. That string is stored in
the save's `thumb` field and is what the Load browser shows. It is also, at a few
KB, the largest field in most save headers - see [[Save-Format]].

## Game Assets preview

`buildGamePreview()` puts a 5 x 5 x 0.4 reference tile down, then either a
`Plane(6.3, 8.8)` at y = 4.4 with the card art (double-sided, transparent), or an
FBX loaded through the cached `loadModel()`, retextured to flat white
(`0xf2f2f2`), **normalised to 4.2 cm tall** and seated with its feet on the tile.
A `_gameBuildId` counter guards against a slow model arriving after the user has
clicked something else.

## Related

[[Architecture]] | [[Frontend-Modules]] | [[Sub-Board-Editor]] | [[Game-Assets]] |
[[Analysis-and-Replay]] | [[Presets-and-Textures]]
