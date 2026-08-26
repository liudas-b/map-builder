"""Build the static (server-less) Map Builder site into dist/.

The editor normally talks to server.py for textures, models and saves. This
script bakes those answers into one data/manifest.json and copies the assets
next to it, so the whole app can be served as plain files from GitHub Pages.

In that build the bundled data is read-only and anything the user saves is kept
in their browser (see public/js/api.js).

Run:  python tools/build_static.py  [--out dist]
"""
import argparse
import json
import os
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import server  # noqa: E402  (needs ROOT on the path first)

# Source art the editor never loads (.ai, .psd) is skipped: it is over half the
# folder by size and would only slow the deploy down.
WEB_EXTS = server.TEXTURE_EXTS + server.MODEL_EXTS


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def copy_public(out):
    shutil.copytree(os.path.join(ROOT, "public"), out, dirs_exist_ok=True)


def copy_assets(out):
    """Copy TextureAssets to dist/assets, keeping only what the app can load."""
    dest_root = os.path.join(out, "assets")
    total = kept = skipped = 0
    for dirpath, _dirs, files in os.walk(server.ASSETS):
        rel = os.path.relpath(dirpath, server.ASSETS)
        for fn in files:
            src = os.path.join(dirpath, fn)
            if os.path.splitext(fn)[1].lower() not in WEB_EXTS:
                skipped += os.path.getsize(src)
                continue
            dest_dir = dest_root if rel == "." else os.path.join(dest_root, rel)
            os.makedirs(dest_dir, exist_ok=True)
            shutil.copy2(src, os.path.join(dest_dir, fn))
            total += os.path.getsize(src)
            kept += 1
    return kept, total, skipped


def build_manifest():
    tex = server.list_textures()
    saves = {}
    for stype in server.SAVE_TYPES:
        docs = []
        for m in server.list_saves(stype):
            try:
                docs.append(server.read_save(stype, m["id"]))
            except Exception as e:                     # noqa: BLE001
                print(f"  ! skipping {stype}/{m['id']}: {e}")
        saves[stype] = docs
    return {
        "generated": int(time.time() * 1000),
        "textures": tex["textures"],
        "categories": tex["categories"],
        "models": server.list_models()["models"],
        "saves": saves,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
    args = ap.parse_args()
    out = os.path.abspath(args.out)

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    print(f"Building static Map Builder -> {out}")
    copy_public(out)

    kept, size, skipped = copy_assets(out)
    print(f"  assets   {kept} files, {human(size)} (skipped {human(skipped)} of source art)")

    manifest = build_manifest()
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    with open(os.path.join(out, "data", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    counts = ", ".join(f"{len(v)} {k}" for k, v in manifest["saves"].items() if v)
    print(f"  manifest {len(manifest['textures'])} textures, "
          f"{len(manifest['models'])} models, {counts or 'no saves'}")

    # tell GitHub Pages to serve the folder as-is rather than run Jekyll on it
    open(os.path.join(out, ".nojekyll"), "w").close()

    grand = sum(os.path.getsize(os.path.join(d, f))
                for d, _s, fs in os.walk(out) for f in fs)
    print(f"  total    {human(grand)}")
    print("Done. Serve dist/ with any static host.")


if __name__ == "__main__":
    main()
