"""Map Builder - local server.

Zero-dependency Python server. Serves the editor UI from /public,
texture assets from /assets/, and a small JSON API for saves,
presets and texture uploads.

Run:  python server.py   ->  http://localhost:8420
"""
import base64
import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if getattr(sys, "frozen", False):
    # running as a PyInstaller exe: data folders live next to the exe
    ROOT = os.path.dirname(os.path.abspath(sys.executable))
else:
    ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
ASSETS = os.path.join(ROOT, "TextureAssets")
SAVES = os.path.join(ROOT, "saves")

SAVE_TYPES = ("subboard", "board", "tilepreset", "cubepreset", "tokenpreset")
TEXTURE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")
PORT = 8420


# ---------------------------------------------------------------- helpers

def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "untitled"


def safe_join(base, rel):
    """Join and refuse to escape base."""
    rel = rel.replace("\\", "/").lstrip("/")
    path = os.path.normpath(os.path.join(base, rel))
    if os.path.commonpath([base, path]) != os.path.normpath(base):
        raise ValueError("path escapes base")
    return path


def save_dir(stype):
    d = os.path.join(SAVES, stype)
    os.makedirs(d, exist_ok=True)
    return d


def read_save(stype, sid):
    path = safe_join(save_dir(stype), sid + ".json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_save(stype, doc):
    path = safe_join(save_dir(stype), doc["id"] + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)


def list_saves(stype):
    out = []
    d = save_dir(stype)
    for fn in os.listdir(d):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, fn), "r", encoding="utf-8") as f:
                doc = json.load(f)
            out.append({
                "id": doc.get("id", fn[:-5]),
                "name": doc.get("name", fn[:-5]),
                "tags": doc.get("tags", []),
                "created": doc.get("created", 0),
                "modified": doc.get("modified", 0),
                "thumb": doc.get("thumb", ""),
            })
        except Exception:
            pass
    out.sort(key=lambda m: m.get("modified", 0), reverse=True)
    return out


def list_textures():
    items = []
    cats = set()
    for dirpath, _dirs, files in os.walk(ASSETS):
        rel_dir = os.path.relpath(dirpath, ASSETS).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        for fn in sorted(files):
            if os.path.splitext(fn)[1].lower() not in TEXTURE_EXTS:
                continue
            cat = rel_dir or "(root)"
            cats.add(cat)
            items.append({
                "path": (rel_dir + "/" + fn) if rel_dir else fn,
                "name": os.path.splitext(fn)[0],
                "category": cat,
            })
    return {"textures": items, "categories": sorted(cats, key=str.lower)}


# ---------------------------------------------------------------- seeding

def seed_presets():
    """Create default cube/token presets on first run (folder missing)."""
    now = int(time.time() * 1000)

    def doc(stype, name, data, tags):
        return {"id": slugify(name), "name": name, "tags": tags,
                "created": now, "modified": now, "thumb": "", "data": data}

    if not os.path.isdir(os.path.join(SAVES, "cubepreset")):
        m = "3D elements/3D - Mountain/"
        b = "3D elements/3D Box/"
        t = "3D elements/3D Train Vagon/"
        cubes = [
            doc("cubepreset", "Mountain", {
                "height": 5,
                "top": m + "Mountain Top.png", "bottom": m + "Mountain Top.png",
                "front": m + "Mountain - Side 1.png", "right": m + "Mountain - Side 2.png",
                "back": m + "Mountain - Side 3.png", "left": m + "Mountain - Side 4.png",
            }, ["full", "seeded"]),
            doc("cubepreset", "Box", {
                "height": 2.5,
                "top": b + "Box - Top.png", "bottom": b + "Box - Top.png",
                "front": b + "Box - Sides.png", "back": b + "Box - Sides.png",
                "left": b + "Box - Sides.png", "right": b + "Box - Sides.png",
            }, ["half", "seeded"]),
            doc("cubepreset", "Train Vagon", {
                "height": 2.5,
                "top": t + "Train-Top.png", "bottom": t + "Train-Top.png",
                "front": t + "Train-Front-Back.png", "back": t + "Train-Front-Back.png",
                "left": t + "Train-Sides.png", "right": t + "Train-Sides.png",
            }, ["half", "seeded"]),
        ]
        for c in cubes:
            write_save("cubepreset", c)

    if not os.path.isdir(os.path.join(SAVES, "tokenpreset")):
        def tok(name, top, bottom=None, w=3, l=3, h=0.5, tags=None):
            return doc("tokenpreset", name, {
                "top": top, "bottom": bottom or top, "w": w, "l": l, "h": h,
            }, (tags or []) + ["seeded"])

        pt = "Tokens/Player Token/"
        ht = "Tokens/Heart Token/"
        hc = "Heart Tokens/"
        tokens = [
            tok("Cop", pt + "Cop-Front.png", pt + "Cop-Back.png", tags=["player"]),
            tok("Dog", pt + "Dog-Front.png", pt + "Dog-Back.png", tags=["player"]),
            tok("Girl", pt + "Girl-Front.png", pt + "Girl-Back.png", tags=["player"]),
            tok("Human", pt + "Human-Front.png", pt + "Human-Back.png", tags=["player"]),
            tok("Cop Heart", ht + "Cop-Heart-Front.png", ht + "Cop-Heart-Back.png", tags=["heart"]),
            tok("Dog Heart", ht + "Dog-Heart-Front.png", ht + "Dog-Heart-Back.png", tags=["heart"]),
            tok("Girl Heart", ht + "Girl-Heart-Front.png", ht + "Girl-Heart-Back.png", tags=["heart"]),
            tok("Human Heart", ht + "Human-Heart-Front.png", ht + "Human-Heart-Back.png", tags=["heart"]),
            tok("Heart Yellow", hc + "Yellow/Human Fall Flat - Player Aid-11.png",
                hc + "Yellow/Human Fall Flat - Player Aid-12.png", tags=["heart"]),
            tok("Heart Blue", hc + "Blue/Human Fall Flat - Player Aid-13.png",
                hc + "Blue/Human Fall Flat - Player Aid-14.png", tags=["heart"]),
            tok("Heart Green", hc + "Green/Human Fall Flat - Player Aid-15.png",
                hc + "Green/Human Fall Flat - Player Aid-16.png", tags=["heart"]),
            tok("Heart Red", hc + "Red/Human Fall Flat - Player Aid-17.png",
                hc + "Red/Human Fall Flat - Player Aid-18.png", tags=["heart"]),
            tok("Star", "Tokens/Star token/Star_1.png", tags=["marker"]),
            tok("Spawnpoint", "Spawnpoint/Spawnpoint.png", tags=["marker"]),
            tok("Round Token 43", "Round token/Human Fall Flat - Player Aid-43.png", tags=["round"]),
            tok("Round Token 44", "Round token/Human Fall Flat - Player Aid-44.png", tags=["round"]),
            tok("Round Token 45", "Round token/Human Fall Flat - Player Aid-45.png", tags=["round"]),
        ]
        for tkn in tokens:
            write_save("tokenpreset", tkn)

    for st in SAVE_TYPES:
        save_dir(st)


# ---------------------------------------------------------------- handler

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    # -- responses
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        if not os.path.isfile(path):
            return self.send_json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        cache = "no-cache" if path.endswith((".html", ".js", ".css")) else "max-age=3600"
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # -- routing
    def do_GET(self):
        try:
            self.route("GET")
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_POST(self):
        try:
            self.route("POST")
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_DELETE(self):
        try:
            self.route("DELETE")
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path.startswith("/api/"):
            return self.route_api(method, path)

        if method != "GET":
            return self.send_json({"error": "method not allowed"}, 405)

        if path.startswith("/assets/"):
            return self.send_file(safe_join(ASSETS, path[len("/assets/"):]))

        rel = path.lstrip("/") or "index.html"
        return self.send_file(safe_join(PUBLIC, rel))

    def route_api(self, method, path):
        parts = [p for p in path.split("/") if p][1:]  # drop 'api'

        if parts == ["textures"] and method == "GET":
            return self.send_json(list_textures())

        if parts == ["upload"] and method == "POST":
            return self.api_upload()

        if parts and parts[0] == "saves":
            stype = parts[1] if len(parts) > 1 else ""
            if stype not in SAVE_TYPES:
                return self.send_json({"error": "unknown save type"}, 400)
            if len(parts) == 2 and method == "GET":
                return self.send_json({"saves": list_saves(stype)})
            if len(parts) == 2 and method == "POST":
                return self.api_write_save(stype)
            if len(parts) == 3:
                sid = parts[2]
                if method == "GET":
                    try:
                        return self.send_json(read_save(stype, sid))
                    except FileNotFoundError:
                        return self.send_json({"error": "not found"}, 404)
                if method == "DELETE":
                    try:
                        os.remove(safe_join(save_dir(stype), sid + ".json"))
                        return self.send_json({"ok": True})
                    except FileNotFoundError:
                        return self.send_json({"error": "not found"}, 404)

        return self.send_json({"error": "unknown endpoint"}, 404)

    # -- api impl
    def api_upload(self):
        body = self.read_body()
        category = body.get("category", "Uploads").strip() or "Uploads"
        filename = os.path.basename(body.get("filename", "texture.png"))
        data_url = body.get("dataUrl", "")
        if "," not in data_url:
            return self.send_json({"error": "bad dataUrl"}, 400)
        if os.path.splitext(filename)[1].lower() not in TEXTURE_EXTS:
            return self.send_json({"error": "unsupported file type"}, 400)
        raw = base64.b64decode(data_url.split(",", 1)[1])
        folder = safe_join(ASSETS, category)
        os.makedirs(folder, exist_ok=True)
        # avoid overwriting an existing file
        target = os.path.join(folder, filename)
        stem, ext = os.path.splitext(filename)
        n = 1
        while os.path.exists(target):
            target = os.path.join(folder, f"{stem} ({n}){ext}")
            n += 1
        with open(target, "wb") as f:
            f.write(raw)
        rel = os.path.relpath(target, ASSETS).replace("\\", "/")
        return self.send_json({"ok": True, "path": rel})

    def api_write_save(self, stype):
        body = self.read_body()
        now = int(time.time() * 1000)
        sid = body.get("id") or f"{slugify(body.get('name', 'untitled'))}-{now}"
        sid = os.path.basename(sid)
        created = now
        try:
            created = read_save(stype, sid).get("created", now)
        except Exception:
            pass
        doc = {
            "id": sid,
            "name": body.get("name", "Untitled"),
            "tags": body.get("tags", []),
            "created": created,
            "modified": now,
            "thumb": body.get("thumb", ""),
            "data": body.get("data", {}),
        }
        write_save(stype, doc)
        return self.send_json({"ok": True, "id": sid, "modified": now})


def main():
    os.makedirs(SAVES, exist_ok=True)
    seed_presets()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Map Builder running at  http://localhost:{PORT}")
    print("Press Ctrl+C to stop (or just close this window).")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.4, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
