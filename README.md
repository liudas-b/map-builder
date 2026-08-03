# Map Builder

A localhost 3D map builder for the board game. Design **sub-boards** (grid boards
with painted tiles, layers, cubes and tokens), then combine them into full
**boards** in Assembly mode. Everything is saved as JSON files on disk.

## Run it

Double-click **`MapBuilder.exe`** — it starts the server and opens the browser
automatically. No Python or anything else needs to be installed.

Alternatives (need Python 3): double-click `start-map-builder.bat`, or run
`python server.py`, then open <http://localhost:8420>. Three.js is bundled
locally in `public/lib`, so no internet is needed either way.

## Sharing with someone else

Copy (or zip) the whole `map-builder` folder — that's everything: the exe, the
app (`public/`), the art (`TextureAssets/`), and the saves (`saves/`). On the
other computer they just double-click `MapBuilder.exe`. The `.git` folder and
`.build/` are not needed and can be left out of the zip.

To rebuild the exe after changing `server.py`:

```bash
python -m PyInstaller --onefile --name MapBuilder --distpath . --workpath .build --specpath .build server.py
```

## The two modes

- **Sub-Board Editor** — design one grid board. Control columns / rows / tile
  size (default 5 × 5 cm tiles). Paint each tile's ground texture, stack
  gameplay layers (centered, 90° rotation), customization art (free position
  and size), and labels (default on top). Place cubes (full 5×5×5 or half
  5×5×2.5) and tokens (default 3×3×0.5, sides auto-tinted from the texture
  border). Reorder any layer in the Layers panel.
- **Board Assembly** — add saved sub-boards, then drag / rotate / scale each
  one freely and save the arrangement as a board. Boards reference sub-board
  saves, so editing a sub-board updates every board that uses it.

## Saves & presets

Everything lives in `saves/` as JSON:

| Folder | What |
|---|---|
| `saves/subboard/` | Sub-board saves |
| `saves/board/` | Board (assembly) saves |
| `saves/tilepreset/` | Tile presets (ground + layers stamps) |
| `saves/cubepreset/` | Cube presets (Mountain, Box, Train + your own) |
| `saves/tokenpreset/` | Token presets (players, hearts, markers + your own) |

The Load browser supports search, tag filtering, and sorting by
recency / creation date / name. Default cube & token presets are seeded on
first run from `TextureAssets/`.

## Textures

All textures live in `TextureAssets/`, categorized by folder. Upload new ones
from the app (⬆ Upload textures) into any existing or new category — they are
written into `TextureAssets/` and show up in the browser immediately.

## Controls

- **Right-drag** rotate · **middle-drag** pan · **wheel** zoom · `F` frame board
- `1`–`9` tools · `R` rotate selection 90° · `Del` delete · `Esc` deselect
- `Ctrl+S` save · `Ctrl+O` load — full list under **❓ Help** in the app
