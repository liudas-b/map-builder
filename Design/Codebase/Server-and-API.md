# Server and HTTP API

**Status: Built.** `server.py`, 380 lines, Python 3 standard library only.

The server does four jobs: serve `public/`, serve `TextureAssets/`, read and write
`saves/`, and accept texture uploads. It has no dependencies, no database, no
config file and no state beyond the filesystem.

## Starting up

```
ROOT    = folder containing server.py   (or the folder containing the .exe when frozen)
PUBLIC  = ROOT/public
ASSETS  = ROOT/TextureAssets
SAVES   = ROOT/saves
PORT    = $PORT, or --port N, default 8420
```

The frozen-exe branch matters: `sys.frozen` makes `ROOT` the folder next to
`MapBuilder.exe`, **not** PyInstaller's temp extraction dir. That is what lets the
whole thing be shared as a folder - the exe finds `public/`, `TextureAssets/` and
`saves/` sitting beside it. See [[Build-and-Run]].

`main()` creates `saves/`, runs `seed_presets()`, starts a `ThreadingHTTPServer` on
**127.0.0.1 only** (never `0.0.0.0` - this is a local tool, not a service), and
opens a browser after 400 ms unless `--no-browser` is passed.

## Routes

| Method | Path | Returns |
|--------|------|---------|
| GET | `/` and anything else | file under `public/` (`/` -> `index.html`) |
| GET | `/assets/<rel>` | file under `TextureAssets/` |
| GET | `/api/textures` | `{textures: [{path,name,category}], categories: [...]}` |
| GET | `/api/models` | `{models: [{path,name,category}]}` - `.fbx .glb .gltf .obj` |
| POST | `/api/upload` | `{ok, path}` - writes a base64 data URL into a category folder |
| GET | `/api/saves/<type>` | `{saves: [meta...]}` - metadata only, newest first |
| POST | `/api/saves/<type>` | `{ok, id, modified}` - create or overwrite |
| GET | `/api/saves/<type>/<id>` | the full save document |
| DELETE | `/api/saves/<type>/<id>` | `{ok: true}` |

`<type>` is validated against `SAVE_TYPES = ("subboard","board","tilepreset","cubepreset","tokenpreset")`;
anything else is a 400. Unknown API paths are a 404 JSON body, never an HTML error page.

Every handler is wrapped in try/except that returns `{"error": str(e)}` with a 500,
so a bad save on disk surfaces as a toast in the UI instead of a hung request.

## Path safety

Every filesystem path goes through one function:

```python
def safe_join(base, rel):
    rel = rel.replace("\\", "/").lstrip("/")
    path = os.path.normpath(os.path.join(base, rel))
    if os.path.commonpath([base, path]) != os.path.normpath(base):
        raise ValueError("path escapes base")
    return path
```

`..` traversal, absolute paths and backslash tricks all land in that
`commonpath` check. Save ids additionally get `os.path.basename()` applied on
write. **Any new route that touches disk must use `safe_join`** - it is the only
thing standing between a localhost tool and reading the rest of the drive.

## Listing behaviour

- **`list_saves`** opens every JSON in the folder and returns only the header
  (`id`, `name`, `tags`, `created`, `modified`, `thumb`) - the `data` blob stays on
  disk. A file that fails to parse is silently skipped rather than breaking the
  list. Sorted by `modified` descending.
- **`list_textures`** walks `TextureAssets/` recursively; the **relative folder
  path is the category** (`GridTiles/Tiles`, `Tokens/Player Token`, ...). Files at
  the root get the category `(root)`. Extensions: `.png .jpg .jpeg .webp .gif .svg`.
- **`list_models`** is the same walk filtered to `.fbx .glb .gltf .obj`.

There is no caching. The walk is cheap at this scale and it means dropping a PNG
into `TextureAssets/` and hitting refresh is all it takes to see it in the browser.

## Writing a save

`api_write_save` builds the document envelope itself and never trusts the client
with it:

```
id       = body.id  or  slugify(name) + "-" + now_ms      (then basename()'d)
created  = the existing file's created, if there is one, else now
modified = now
name/tags/thumb/data = from the body
```

So **the first save mints an id and every later save reuses it**, `created` is
preserved across overwrites, and "Save As" works simply by omitting `id`. Write is
a plain `open(...,"w")` + `json.dump` - not atomic. A crash mid-write can truncate
a save; at this size and audience that has been judged acceptable, but it is the
known weakness of the format ([[Save-Format]]).

## Upload

`POST /api/upload` takes `{category, filename, dataUrl}`. It rejects a data URL
with no comma, rejects any extension outside `TEXTURE_EXTS + MODEL_EXTS`, creates
the category folder if needed, and **never overwrites**: an existing name becomes
`name (1).png`, `name (2).png`, and so on. The response returns the new path
relative to `TextureAssets/`, which is exactly the form the frontend stores in
saves.

Cards and character models use this same endpoint with the categories `Cards` and
`Characters` - see [[Game-Assets]].

## Preset seeding

`seed_presets()` runs on every start but is guarded per folder: if
`saves/cubepreset/` does not exist it writes the three default cubes
(**Mountain** 5 cm, **Box** 2.5 cm, **Train Vagon** 2.5 cm), and if
`saves/tokenpreset/` does not exist it writes **17 token presets** - 4 player
tokens, 8 heart tokens, Star, Spawnpoint, 3 round tokens. All are tagged
`seeded`, and cubes additionally `full` / `half`, tokens `player` / `heart` /
`marker` / `round`.

Consequence worth knowing: **deleting a seeded preset in the UI brings it back on
the next restart only if you delete the whole folder.** Deleting one file leaves
the folder present, so the guard stays satisfied and nothing is re-seeded. That is
the intended behaviour - you can curate the list without it regenerating.

## Caching headers

`.html`, `.js` and `.css` get `Cache-Control: no-cache`; everything else (that is,
the art) gets `max-age=3600`. API responses are `no-store`. This is why editing a
JS file and refreshing always shows the new code.

## Related

[[Architecture]] | [[Save-Format]] | [[Static-Build-and-Deploy]] | [[Build-and-Run]] |
[[Presets-and-Textures]]
