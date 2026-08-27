# Static Build and Deploy

**Status: Built.** `tools/build_static.py` + `.github/workflows/deploy-pages.yml`.

The same app, with the server removed, so a phone anywhere can open a URL. No
Python, no PC left running, no second codebase.

## The idea

`server.py` answers exactly four kinds of question: what textures exist, what
models exist, what saves exist, and what is in one save. All four answers are
**static for a given repo state**, so the build bakes them into one file:

```
dist/
  index.html  css/  js/  lib/     <- copied verbatim from public/
  assets/                          <- TextureAssets, minus source art
  data/manifest.json               <- the baked answers
  .nojekyll                        <- stop Pages running Jekyll over it
```

`api.js` probes for `data/manifest.json` at load. Present -> static backend;
absent -> server backend. **That probe is the entire switch.** No build flag, no
environment variable, no separate entry point.

## `tools/build_static.py`

Imports `server.py` as a module and reuses its own listing functions, so the
manifest cannot drift from what the server would have said:

```python
import server
manifest = {
  "generated":  epoch_ms,
  "textures":   server.list_textures()["textures"],
  "categories": server.list_textures()["categories"],
  "models":     server.list_models()["models"],
  "saves":      { stype: [server.read_save(stype, m["id"]) for m in server.list_saves(stype)]
                  for stype in server.SAVE_TYPES },
}
```

Note that saves are baked **in full** - `data` included - not just their headers.
A phone opening the site can load any board without a second request.

Assets are copied with a filter: only `TEXTURE_EXTS + MODEL_EXTS` survive.
`.ai` and `.psd` source art is skipped, which is why 51 MB on disk becomes a
**26 MB site**. The script prints what it kept and what it dropped.

```bash
python tools/build_static.py          # writes dist/
python -m http.server -d dist 8422    # then open http://localhost:8422
```

`dist/` is git-ignored. There is also a `map-builder-static` entry in
`.claude/launch.json` that serves it on port 8422 for preview.

## What changes for the user in that build

| | Local server | Static site |
|---|---|---|
| Textures, models, bundled saves | read/write on disk | **read-only**, from the manifest |
| New saves | `saves/*.json` | `localStorage`, per browser, per device |
| Deleting a bundled save | works | refused - *"ships with the site"* |
| Texture / card / character upload | works | **buttons hidden** (`api.canUpload` is false) |
| Moving work in or out | copy the file | **download** a save as `.json`, **import** one back |

Local saves are stored **one key per document** (`mb.save.<type>.<id>`), never as
one big blob, so a single oversized board cannot take the whole store down with
it. A quota failure is caught and reported in plain language rather than as a
`QuotaExceededError`.

A locally saved document **shadows** a bundled one with the same id: the Load
browser merges bundled first, then local over the top, and tags local ones
*"on this device"*. `importSaveFile()` deliberately mints a **fresh id** when the
incoming id collides with a bundled save, so an import can never silently mask the
shipped copy.

## The Pages workflow

`.github/workflows/deploy-pages.yml`, triggered by pushes touching `public/`,
`TextureAssets/`, `saves/`, `server.py`, the build script or the workflow itself -
plus `workflow_dispatch` for a manual run.

```
checkout (lfs: true)  ->  setup-python 3.12  ->  build_static.py --out dist
  ->  fail if dist/assets contains "git-lfs.github.com/spec"
  ->  configure-pages -> upload-pages-artifact -> deploy-pages
```

Two guards are worth keeping:

- **`lfs: true` plus the pointer check.** The art is LFS-tracked
  (`*.png *.jpg *.jpeg *.webp *.gif *.psd *.ai`). Without the LFS fetch the build
  happily copies 130-byte pointer text files and publishes a site where every
  texture is broken - and nothing errors. The `grep -rlq` step turns that into a
  loud failure.
- **`concurrency: { group: pages, cancel-in-progress: true }`** so two pushes
  cannot race and publish out of order.

Repo settings that must be right, once: **Settings -> Pages -> Source = GitHub
Actions**. "Deploy from a branch" serves the repo as-is and would publish the LFS
pointer files.

Costs to be aware of: each build pulls ~25 MB of LFS objects against the free
1 GB/month bandwidth - roughly 40 deploys a month. Private repos need GitHub Pro
for Pages.

## Sub-path safety

The site lives at `https://<user>.github.io/map-builder/`, not at a domain root.
Every URL in the app is therefore built from
`new URL('.', document.baseURI)` in `api.js`. **A hard-coded `/assets/...` or
`/api/...` would work locally and 404 on Pages** - which is why nothing outside
`api.js` builds URLs.

## Related

[[Server-and-API]] | [[Save-Format]] | [[Frontend-Modules]] | [[Build-and-Run]] |
[[UI-and-Input]]
