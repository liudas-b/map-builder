# UI and Input

**Status: Built.** `index.html` (227 lines) + `ui.js` (1,123) + `mobile.js` (258)
+ `style.css` (674).

## Layout

```
+--------------------------------------------------------------------------+
| ☰  🗺 Map Builder | [mode tabs] | name New Save SaveAs Load | BG ❓ ⚙     |
+----------------+---------------------------------------+-----------------+
| LEFT           |            #viewport (canvas)          | RIGHT           |
|  Tools         |     gizmo ✥ ⟳   hintbar   toast        |  Board Settings |
|  Presets       |     player aid / replay bar (tester)   |  Sub-Boards     |
|  Markers       |                                        |  Analysis       |
|  Tester setup  |                                        |  Selection      |
|  Cards / Chars |                                        |  Layers         |
|  Textures      |                                        |                 |
+----------------+---------------------------------------+-----------------+
```

Panels are shown and hidden by class - `.sub-only`, `.board-only`, `.game-only`,
`.tester-only` - toggled wholesale in `setMode()`. There is exactly one instance of
each panel in the DOM; nothing is duplicated per mode, and the phone sheet
*borrows* the same nodes rather than cloning them.

The dark palette lives in `:root` custom properties in `style.css`. The scene
background is separate and per-browser: a preset dropdown plus a colour picker,
persisted to `localStorage['mb-bg']`.

## Selection and the gizmo

`state.selection` is one of:

```js
{ kind: 'tile',    row, col }
{ kind: 'overlay', id }
{ kind: 'cube',    id }
{ kind: 'token',   id }
{ kind: 'sb',      uid }        // board mode
```

A yellow `BoxHelper` wraps the selected mesh, and two HTML buttons float above it
in screen space. `updateGizmo()` runs every frame, projecting the selection's
bounding-box top into canvas coordinates; the gizmo hides when the selection is
behind the camera or gone.

**✥ move** captures the pointer on the button itself, so a finger sliding off it
keeps steering the drag instead of the browser stealing the gesture.

**⟳ rotate** is two gestures in one control. A press that moves less than 8 px is a
**tap** and turns 90 deg. Past 8 px it becomes a **circular drag**: the angle from
the selection's screen anchor to the pointer, snapped by `rotSnap(sel, ctrlKey)`:

| Selected | Snap |
|----------|------|
| ground / gameplay / label / cube | 90 deg always |
| custom art / token | free, or 15 deg with Ctrl |
| sub-board | 90 deg, or 15 deg with Ctrl |

## The Selection panel

`refreshProps()` is a branch per `selection.kind`. Highlights:

- **Tile** - rotate, apply the active texture, clear the ground, **📋 save as tile
  preset**, the tile's gameplay markers (removable individually), and its layers.
- **Layer** - texture thumbnail, rotate, raise / lower, and for `custom` also x, z,
  width and height as numeric fields.
- **Cube** - the preset name, height, rotation, and the face textures.
- **Token** - w / l / h, free rotation, position.
- **Sub-board** (board mode) - x, z, rotation, sx / sz, and **Map tile # (1-4)**,
  which is the reveal-order field the simulator reads ([[Board-Assembly]]).

## Keyboard

| Key | Action |
|-----|--------|
| `1`-`9` | tools (select, paint, stamp, gameplay, custom, label, cube, token, erase) |
| `V` / `E` / `M` | select / erase / marker |
| `R` | rotate the selection 90 deg |
| `Del` / `Backspace` | delete the selection |
| `Esc` | deselect - or close the open modal |
| `F` | frame the whole board |
| `Ctrl+S` / `Ctrl+O` | save / load |

Handled by one `keydown` listener that bails out when focus is in an
`INPUT`/`TEXTAREA`/`SELECT`, and while a modal is open passes only `Escape`. Tool
keys other than select are ignored outside sub mode.

## Modals

`openModal({title, body, foot, narrow, floating})` builds everything. Two flavours:

- **backdrop** (default) - click-outside and ✕ both close.
- **floating** - no backdrop, draggable by its header, and **does not block the
  rest of the UI**. The cube and token preset dialogs use this so the texture
  browser stays clickable, which the armed-slot flow depends on
  ([[Presets-and-Textures]]).

The **Load browser** (`openSaveBrowser`) is shared by every save type: search by
name, filter by tag, sort by recency / creation date / name, and per-row buttons
for load, **⤓ download as `.json`**, and delete. In the static build the delete
button only appears for saves that live on that device, and bundled ones carry a
*"📱 on this device"* tag when a local copy shadows them.

## Phones

Below 900 px the layout changes shape rather than shrinking.

**The side panels become drawers** (`☰` and `⚙`) with a scrim. Because a phone top
bar only fits the name and Save, `placeDocControls()` **physically moves** the mode
tabs and the New / Save As / Load / Help buttons into a Document panel at the top
of the left drawer, and moves them back above 900 px. Same nodes, same listeners.

**A dock sits at the bottom, in thumb reach:**

```
[ 🎨 Ground ▴ ][ 🖼 ][ 🖐 ][ ⛶ ][ ⌄ ]
   tool sheet   palette  mode  fit  hide
```

Above it, **the strip** - a horizontal row of whatever the current tool needs:
textures for the paint-like tools, presets for cube / token / stamp, marker types
for the marker tool. One tap switches, no panel needed. **With something selected
the strip becomes that selection's actions** (⟳ 90 deg, ⚙ properties, 🗑, ✕) -
except while a placing tool is active, where the palette stays put so you can place
the next one.

**🖐 / ✏️ decides what one finger does.** This is the core touch decision:

```js
controls.touches = { ONE: camera ? TOUCH.ROTATE : null, TWO: TOUCH.DOLLY_PAN };
```

Two fingers always pinch-zoom and pan, in both modes. In 🖐 mode a **quick tap**
(under 400 ms, under 10 px) still selects, so you can grab something and move it
with the gizmo without leaving the camera. Coarse pointers start in 🖐.

The bottom sheet does not reimplement panels: `openSheet(title, panelId)` remembers
where the real panel node lives (`hostSlot`), moves it into the sheet, and puts it
back on close. So a control behaves identically on desktop and phone because it *is*
the same control.

`⌄` hides the dock entirely for showing a board off - and `sync()` refuses to leave
the UI collapsed when the dock itself is hidden by a mode change, since the chevron
that would restore it lives in the dock.

## Feedback

- **`toast(msg, isErr)`** - one transient element, 2.4 s, red when it is an error.
  Every failed API call ends here rather than in the console.
- **`setHint(html)`** - the persistent one-line hint under the viewport, set per
  tool from the `HINTS` table in `main.js`.
- **`❓ Help`** - a two-column modal covering camera, touch, every tool, selection
  handles, board assembly and saving.

## Related

[[Frontend-Modules]] | [[Sub-Board-Editor]] | [[Board-Assembly]] |
[[Presets-and-Textures]] | [[Rendering-3D]] | [[Analysis-and-Replay]]
