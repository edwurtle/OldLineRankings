#!/usr/bin/env python3
"""Scrape the state school directory for logos, mascots and school systems.

Writes circular avatars to site/logos/<slug>.webp and scripts/cache/schools.json.
Source images are cached in scripts/cache/raw/ so re-runs don't re-download.
"""
import colorsys, html, io, json, pathlib, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGOS = ROOT / "site" / "logos"
CACHE = ROOT / "scripts" / "cache"
DIRECTORY = "https://www.mpssaa.org/school-directory/"
# Schools with no logo in the directory; logos found on MaxPreps
FALLBACK_LOGOS = {
    "Crossland": "https://image.maxpreps.io/school-mascot/a/c/9/ac92607b-f0c9-4f36-b129-035efd5b06ca.gif?width=512&height=512",
    "High Point": "https://image.maxpreps.io/school-mascot/d/a/1/da19d885-2cf5-48be-9b4f-b862f248a17f.gif?width=512&height=512",
}


def curl(url, binary=False):
    out = subprocess.check_output(["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "60", url])
    return out if binary else out.decode("utf-8", "replace")


def parse_directory(page):
    schools = []
    for card in re.findall(r"<article\s+class=\"archive-card\"\s+data-school-card(.*?)</article>", page, re.S):
        name = html.unescape(re.search(r'class="archive-card-title">\s*<a[^>]*>(.*?)</a>', card, re.S).group(1).strip())
        url = re.search(r'href="(https://www\.mpssaa\.org/school-directory/[^"]+)"', card).group(1)
        system = re.search(r'data-school-system="([^"]*)"', card)
        srcset = re.search(r'srcset="([^"]+)"', card)
        src = re.search(r'<img[^>]+src="([^"]+)"', card)
        logo = None
        if srcset:  # smallest candidate that's at least 300px wide
            cands = sorted((int(w), u) for u, w in re.findall(r"(\S+)\s+(\d+)w", srcset.group(1)))
            logo = next((u for w, u in cands if w >= 300), cands[-1][1])
        elif src:
            logo = src.group(1)
        slug = url.rstrip("/").rsplit("/", 1)[1]
        schools.append(dict(name=name, slug=slug, url=url, logo_src=logo, system=system.group(1) if system else None))
    return schools


def detail(s):
    page = curl(s["url"])
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " | ", page)))
    for field in ("Mascot", "Address", "School System"):
        m = re.search(rf"\| {field} \|[ |]*([^|]+?) \|", text)
        s[field.lower().replace(" ", "_")] = m.group(1).strip() if m else None
    return s


def accent(img):
    """Most common saturated color in the logo (ignores white/black/grey), as hex."""
    small = img.convert("RGBA").resize((48, 48))
    buckets = {}
    for r, g, b, a in small.get_flattened_data():
        if a < 200:
            continue
        h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if sat < 0.25 or l < 0.12 or l > 0.9:
            continue
        key = (r // 24, g // 24, b // 24)
        n, tot = buckets.get(key, (0, (0, 0, 0)))
        buckets[key] = (n + 1, (tot[0] + r, tot[1] + g, tot[2] + b))
    if not buckets:
        return None
    n, (r, g, b) = max(buckets.values())
    return "#%02x%02x%02x" % (r // n, g // n, b // n)


SIZE = 192  # output px (2x for the largest on-screen avatar)


def main_span(counts, total):
    """(start, end) spanning the logo's non-empty rows/columns, ignoring thin detached
    slivers (stray border lines in some source images)."""
    runs, start, gap = [], None, 0
    for i, c in enumerate(counts + [0]):
        if c:
            start = i if start is None else start
            gap = 0
        elif start is not None:
            gap += 1
            if gap > max(2, total * .02) or i == len(counts):
                runs.append((start, i - gap))
                start, gap = None, 0
    # Keep every run except thin ones (stray lines); text and separate design elements are thicker
    keep = [r for r in runs if r[1] - r[0] + 1 > max(3, total * .03)] or runs
    return (min(r[0] for r in keep), max(r[1] for r in keep)) if keep else (0, total - 1)


def remove_slivers(img, bg):
    """Erase ink outside the main body of the logo (fill with bg, or make transparent)."""
    w, h = img.size
    px = img.load()
    ink = lambda c: c[3] >= 60 and not (bg and abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) < 70)
    cols = [sum(ink(px[x, y]) for y in range(0, h, 2)) for x in range(w)]
    rows = [sum(ink(px[x, y]) for x in range(0, w, 2)) for y in range(h)]
    (x0, x1), (y0, y1) = main_span(cols, w), main_span(rows, h)
    fill = (*bg, 255) if bg else (0, 0, 0, 0)
    for x in range(w):
        for y in range(h):
            if not (x0 <= x <= x1 and y0 <= y <= y1) and ink(px[x, y]):
                px[x, y] = fill
    return img


def content_circle(img, bg):
    """Center and radius of the logo's visible ink: opaque pixels that differ from the background."""
    small = img.copy()
    small.thumbnail((96, 96))
    sx, sy = img.width / small.width, img.height / small.height
    pts = []
    for i, (r, g, b, a) in enumerate(small.get_flattened_data()):
        if a < 60:
            continue
        if bg and abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) < 70:
            continue
        pts.append(((i % small.width + .5) * sx, (i // small.width + .5) * sy))
    if not pts:
        return img.width / 2, img.height / 2, max(img.size) / 2
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return cx, cy, max(((x - cx) ** 2 + (y - cy) ** 2) ** .5 for x, y in pts) + max(sx, sy)


def make_logo(s):
    """Circular avatar: logos with a solid background fill the circle with that color;
    transparent logos sit on white. Either way the ink is scaled to fit inside the circle."""
    from PIL import ImageDraw
    out = LOGOS / f"{s['slug']}.webp"
    s["logo_src"] = s.get("logo_src") or FALLBACK_LOGOS.get(s["name"])
    if not s.get("logo_src"):
        return s
    raw = CACHE / "raw" / s["slug"]
    if not raw.exists():
        raw.parent.mkdir(exist_ok=True)
        raw.write_bytes(curl(s["logo_src"], binary=True))
    img = Image.open(raw).convert("RGBA")
    w, h = img.size
    px = img.load()
    # Knock out near-white backgrounds that touch the corners
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    if all(c[3] > 200 and min(c[:3]) > 235 for c in corners):
        for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
            ImageDraw.floodfill(img, xy, (255, 255, 255, 0), thresh=28)
    # A logo whose border is mostly opaque has its own background color
    border = [px[x, y] for x in range(0, w, 3) for y in (0, h - 1)] + [px[x, y] for y in range(0, h, 3) for x in (0, w - 1)]
    opaque = [c for c in border if c[3] > 200]
    bg = None
    if len(opaque) > .85 * len(border):
        bg = tuple(sorted(c[i] for c in opaque)[len(opaque) // 2] for i in range(3))
    img = remove_slivers(img, bg)
    cx, cy, radius = content_circle(img, bg)
    big = SIZE * 2  # supersample for smooth edges
    scale = (big * .42) / radius
    logo = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (big, big), (*(bg or (255, 255, 255)), 255))
    canvas.paste(logo, (round(big / 2 - cx * scale), round(big / 2 - cy * scale)), logo)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    canvas.putalpha(mask)
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(out, "WEBP", quality=90)
    s["logo"] = f"logos/{s['slug']}.webp"
    s["logo_bg"] = "#%02x%02x%02x" % bg if bg else None
    s["color"] = accent(img)
    return s


def main():
    LOGOS.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    schools = parse_directory(curl(DIRECTORY))
    print(f"{len(schools)} schools in directory")
    with ThreadPoolExecutor(8) as ex:
        schools = list(ex.map(detail, schools))
        schools = list(ex.map(make_logo, schools))
    for s in schools:
        if not s.get("logo"):
            print("  no logo:", s["name"], file=sys.stderr)
    (CACHE / "schools.json").write_text(json.dumps(schools, indent=1))
    print(f"logos: {sum(1 for s in schools if s.get('logo'))}")


if __name__ == "__main__":
    main()
