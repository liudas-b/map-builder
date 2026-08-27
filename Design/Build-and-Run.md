# Building, Running and Sharing

**Status: Built.** Everything here works today.

## Running it

**The way the artists run it:** double-click **`MapBuilder.exe`**. It starts the
server and opens the browser. Nothing needs to be installed.

**With Python 3** (any 3.x - the server uses only the standard library):

```bash
python server.py
```

then open <http://localhost:8420>. `start-map-builder.bat` does the same and opens
the browser for you.

Options:

```bash
python server.py --port 8421 --no-browser
PORT=8421 python server.py
```

Three.js is bundled in `public/lib`, so **no internet connection is needed** in
either case.

For development there is `.claude/launch.json` with two entries:
`map-builder` (the real server on 8421, no browser) and `map-builder-static`
(a plain `http.server` over the folder on 8422).

## Rebuilding the exe

After changing `server.py`:

```bash
python -m PyInstaller --onefile --name MapBuilder --distpath . --workpath .build --specpath .build server.py
```

`--onefile` puts everything in one binary, and `--distpath .` drops it next to
`public/`. The important detail is in `server.py` itself:

```python
if getattr(sys, "frozen", False):
    ROOT = os.path.dirname(os.path.abspath(sys.executable))
```

so the frozen exe looks for `public/`, `TextureAssets/` and `saves/` **beside
itself**, not inside PyInstaller's temp extraction directory. That is what makes
the whole thing a portable folder.

`MapBuilder.exe` and `.build/` are both git-ignored - the exe is a build artefact,
rebuilt on demand.

## Sharing it

Copy or zip the whole `map-builder` folder. That is the exe, the app (`public/`),
the art (`TextureAssets/`) and the saves (`saves/`). `.git`, `.build/`, `dist/` and
`Design/` are not needed.

`make-build.ps1` does exactly that, into `builds/MapBuilder-<timestamp>.zip`, and
**skips zipping when nothing has changed** since the newest existing zip (`-Force`
overrides). It only picks up the seven shareable items:

```
MapBuilder.exe  server.py  start-map-builder.bat  README.md
public/  TextureAssets/  saves/
```

It runs automatically: `.claude/settings.json` registers it as an **async `Stop`
hook**, so a build zip appears at the end of every Claude Code session. That is why
`builds/` has eleven zips in it and why it is git-ignored.

## The web build

For phones, `tools/build_static.py` produces a server-less copy and a GitHub
Actions workflow publishes it to Pages. That has its own page -
[[Static-Build-and-Deploy]].

```bash
python tools/build_static.py          # writes dist/  (~26 MB)
python -m http.server -d dist 8422
```

## Git

The repository root is `map-builder/`. Two things are configured and both matter:

- **Git LFS** tracks `*.png *.jpg *.jpeg *.webp *.gif *.psd *.ai`. Cloning without
  LFS gives you pointer files and a completely untextured app. Same for CI - the
  Pages workflow checks out with `lfs: true` and fails loudly if a pointer reaches
  the build.
- **`.gitattributes` forces LF** on `.py .js .css .html .json .md`, so a Windows
  checkout does not produce whole-file diffs.

Git-ignored: `__pycache__/`, `.build/`, `MapBuilder.exe`, `builds/`, `dist/`,
`node_modules/`, editor folders and OS junk.

## Where the data lives

| What | Where |
|------|-------|
| Documents and presets | `saves/<type>/<id>.json` ([[Save-Format]]) |
| Art and models | `TextureAssets/<category>/...` |
| Scene background colour | the browser's `localStorage['mb-bg']` |
| Static-build saves | the browser's `localStorage['mb.save.<type>.<id>']` |

Backing up means copying `saves/` and `TextureAssets/`. There is nothing else.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Every texture is a grey box | LFS objects not fetched, or a texture was renamed after being referenced in a save |
| "Could not reach the server" toast on load | `server.py` is not running, or something else holds port 8420 |
| A board loads with sub-boards missing | their `subboard` saves were deleted or renamed - the toast names them |
| Simulation warnings on board select | markers are incomplete ([[Gameplay-Markers]]) |
| Upload buttons are missing | you are on the static build, which has nowhere to write |
| A `.glb` character will not display | only `FBXLoader` is bundled ([[Game-Assets]]) |

## Related

[[Overview]] | [[Server-and-API]] | [[Static-Build-and-Deploy]] | [[Save-Format]] |
[[AI-Instructions]]
