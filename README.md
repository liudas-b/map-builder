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

## On a phone: the web build

The same app can be published as a **static site** — no server, no Python, no
PC left running. GitHub Actions builds it on every push to `main` and GitHub
Pages hosts it, so a phone anywhere just opens a URL.

What changes in that build:

- Textures, models, sub-boards, boards and presets are **baked in and
  read-only** — they come from `data/manifest.json` instead of the API.
- Anything you save there is kept **in that browser**, on that device, and is
  labelled *📱 on this device* in the Load browser.
- **⤓** downloads any save as `.json` and **📥 Import save…** brings one back
  in — that is how work moves between a phone and this desktop app (drop the
  file into `saves/subboard/` here, or import it there).
- Texture upload is hidden: there is nowhere to write files to.

### Enabling it on GitHub (one time)

1. Push this repo to GitHub (`main` branch) with `.github/` and `tools/`
   included.
2. On github.com open the repo → **Settings** → **Pages**.
3. Under **Build and deployment → Source**, pick **GitHub Actions**. Do *not*
   pick "Deploy from a branch" — that mode serves the repo as-is and would
   publish Git LFS pointer files instead of the textures.
4. Open the **Actions** tab. The `Deploy Map Builder to Pages` workflow runs on
   every push that touches `public/`, `TextureAssets/`, `saves/`, `server.py`
   or the build script; press **Run workflow** to trigger it by hand.
5. When it finishes, the URL appears on Settings → Pages, and in the workflow's
   `deploy` job. For this repo it is
   `https://<user>.github.io/map-builder/`.

Notes:

- **Private repos need GitHub Pro** for Pages. A public repo works on the free
  plan.
- The workflow checks out with `lfs: true` and fails loudly if any LFS pointer
  reaches `dist/`, because the art (`*.png`, `*.jpg`) is LFS-tracked.
- Each build pulls ~25 MB of LFS objects, which counts against the free 1 GB /
  month LFS bandwidth — roughly 40 deploys a month.
- To update the published boards, save them here and push: the deploy is the
  only step.

### Building it locally

```bash
python tools/build_static.py          # writes dist/
python -m http.server -d dist 8422    # then open http://localhost:8422
```

`dist/` is git-ignored. Source art (`.ai`, `.psd`) is left out of the build, so
the site is ~25 MB rather than 51 MB.

## Touch controls

On a phone the working controls sit in a **dock at the bottom**, in thumb reach,
rather than in the top bar:

```
[ 🎨 Ground ▴ ][ 🖼 ][ 🖐 ][ ⛶ ][ ⌄ ]
```

- **Tool** — tap to open the tool sheet; picking one closes it again.
- **Palette** — opens the textures, presets or markers for that tool, whichever
  applies. Above the dock, a **strip** of those same items switches with a
  single tap, so painting never needs a panel.
- **🖐 / ✏️** — what one finger does: orbit the camera, or use the tool. Two
  fingers always pinch-zoom and pan. In 🖐 a quick tap still selects.
- **⛶** frames the whole board · **⌄** hides the dock for showing a board off.

Select something and the strip becomes its actions — **⟳ 90°**, **⚙**
properties, **🗑**, **✕** — except while a placing tool is active, where the
palette stays put so you can place the next one.

**☰** holds the mode tabs, document actions and the full side panels; **⚙**
opens board settings, selection details and layers. The sheets borrow the real
panels, so everything behaves exactly as it does on the desktop.

## Controls

- **Right-drag** rotate · **middle-drag** pan · **wheel** zoom · `F` frame board
- `1`–`9` tools · `R` rotate selection 90° · `Del` delete · `Esc` deselect
- `Ctrl+S` save · `Ctrl+O` load — full list under **❓ Help** in the app
