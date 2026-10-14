#!/usr/bin/env python3
"""Build the two distributable forms of the Intelligent Zoning add-in.

  intelligentZoning.standalone.html  - single file (CSS + JS inlined) for
                                       hosting on GitHub Pages / jsDelivr
  config.packed.json                 - config.json with all three files
                                       base64-inlined for upload-and-go installs

Run from the add-in folder:  python3 build.py
"""
import base64
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
html = (HERE / "intelligentZoning.html").read_text(encoding="utf-8")
js = (HERE / "intelligentZoning.js").read_text(encoding="utf-8")
css = (HERE / "styles.css").read_text(encoding="utf-8")

# --- standalone ------------------------------------------------------------
body = html.replace('<head>\n  <link rel="stylesheet" type="text/css" href="styles.css" />\n</head>\n', "")
body = body.replace('<script src="intelligentZoning.js"></script>', "")
standalone = (
    "<!DOCTYPE html>\n<html>\n<head>\n"
    '  <meta charset="utf-8">\n'
    '  <meta http-equiv="x-ua-compatible" content="ie=edge">\n'
    '  <meta name="viewport" content="width=device-width,initial-scale=1">\n'
    "  <title>Intelligent Zoning</title>\n"
    '  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" data-iz-leaflet="1">\n'
    "  <style>\n" + css + "\n  </style>\n"
    "</head>\n<body>\n" + body.rstrip() + "\n"
    '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>\n'
    "<script>\n" + js + "\n</script>\n</body>\n</html>\n"
)
(HERE / "intelligentZoning.standalone.html").write_text(standalone, encoding="utf-8")

# --- packed ----------------------------------------------------------------
def data_uri(mime: str, text: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(text.encode("utf-8")).decode("ascii")

cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
cfg["files"] = {
    "intelligentZoning.html": data_uri("text/html", html),
    "intelligentZoning.js": data_uri("text/javascript", js),
    "styles.css": data_uri("text/css", css),
}
(HERE / "config.packed.json").write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")

print("wrote intelligentZoning.standalone.html (%d bytes) and config.packed.json (%d bytes)" % (
    len(standalone), (HERE / "config.packed.json").stat().st_size))
