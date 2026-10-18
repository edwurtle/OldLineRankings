#!/usr/bin/env python3
"""Basketball schedules from ArbiterLive, used until MPSSAA posts the season's schedule.

Schools enter their own schedules on ArbiterLive, so coverage is uneven: these are used only for
upcoming games (results always come from MPSSAA). Each MPSSAA school is matched to its ArbiterLive
school once (cached in scripts/cache/arbiter.json); its boys and girls varsity basketball schedules
are then read every build.

    python3 scripts/arbiter.py      # refresh the school match cache and print coverage
"""
import collections, datetime, html, json, pathlib, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "arbiter.json"
BASE = "https://www.arbiterlive.com"

# MPSSAA name -> search text, where the plain name doesn't find the school on ArbiterLive
SEARCH = {"Southern-G": "Southern Garrett", "Northern-G": "Northern Garrett", "St. Michael's": "St. Michaels",
          "Thomas S. Wootton": "Wootton", "Albert Einstein": "Einstein", "Montgomery Blair": "Blair",
          "Charles H. Flowers": "Flowers", "Dr. Henry A. Wise": "Wise", "Carver A&T": "Carver A & T",
          "James M. Bennett": "Bennett", "Henry E. Lackey": "Lackey", "Central": "Central High"}
# MPSSAA name -> ArbiterLive school id, where search picks the wrong school
FIXED = {"Annapolis": "604", "Frederick": "7985", "Gov. Thomas Johnson": "8744", "Largo": "12428",
         "Loch Raven": "13099", "Patterson": "17670", "Severna Park": "20729", "Thomas Stone": "23356",
         "Southern-G": "21552", "St. Michael's": "20116", "Carver A&T": "3405", "Dr. Henry A. Wise": "6120",
         "Baltimore City College": "1153", "John F. Kennedy": "11330", "North East-C": "16190", "Northeast-AA": "16438",
         "Northern-C": "16470", "Northern-B": "16471", "Walt Whitman": "24670", "Middletown": "14644",
         "Northern-G": "16208", "Southwestern": "21654"}
# Opponent spellings on ArbiterLive schedules -> MPSSAA name
OPP_ALIAS = {"Fairmount Heights": "Fairmont Heights", "Thomas Johnson": "Gov. Thomas Johnson"}
# Schedule entries that are events, not opponents
EVENT = re.compile(r"\bTBA\b|tournament|challenge|classic|showcase|invitational|jamboree", re.I)
NOT_HS = re.compile(r"middle|elementary|\bES\b|college|homeschool|home school|christian|adventist|university|"
                    r"civitas|waldorf|lab school|montessori|catholic|junior high|charter", re.I)


def curl(url, form=None):
    cmd = ["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "60"]
    if form:
        cmd += ["-X", "POST", "--data-urlencode", "searchString=" + form, "-d", "redirect=true"]
    return subprocess.check_output(cmd + [url]).decode("utf-8", "replace")


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def key(name):
    """Comparable school name: no 'High School'/'HS', team labels, punctuation or case."""
    name = re.sub(r"\s+with \d+ others?$|\s+-\s*\w*var$|\(.*?\)", "", name.lower())
    name = re.sub(r"\b(senior |sr )?(high school|high|hs|h\.\s*s\.?|shs)(\b|$).*$", "", name)
    return re.sub(r"[^a-z0-9]", "", name.replace("&", "and"))


def search(name, zip_code=None):
    """ArbiterLive id of the Maryland high school best matching name (None if nothing fits)."""
    q = SEARCH.get(name, re.sub(r"\(.*?\)|-[A-Z]+$", "", name).strip())
    page = curl(f"{BASE}/School/Search", q)
    hits = []
    for sid, nm, rest in re.findall(r'href="/School/(\d+)"[^>]*>(.*?)</a>(.*?)(?=href="/School/|\Z)', page, re.S):
        nm, addr = text(nm), text(rest[:300])
        if ", MD" in addr and not NOT_HS.search(nm):
            hits.append((sid, nm, addr))
    score = lambda h: (bool(zip_code and zip_code in h[2]), key(h[1]) == key(q), bool(re.search(r"high|\bHS\b", h[1], re.I)))
    hits.sort(key=score, reverse=True)
    return (hits[0][0], hits[0][1]) if hits else (None, None)


def teams(school_id):
    """{"boys": team id, "girls": team id} of the school's varsity basketball teams."""
    page = curl(f"{BASE}/School/{school_id}")
    i = page.find("Basketball\r\n") if "Basketball\r\n" in page else page.find("\t\t\t\t\tBasketball")
    if i < 0:
        return {}
    seg = page[i:i + 4000]
    out = {}
    for tid, label in re.findall(r'href="/Teams/Schedule/(\d+)\?activeEntityId=\d+"[^>]*>(.*?)</a>', seg, re.S):
        label = text(label)
        if label in ("Boys Varsity", "Girls Varsity"):
            out.setdefault(label.split()[0].lower(), tid)
    return out


def schedule(team_id, season_start):
    """Games on a team's ArbiterLive schedule for the season starting in season_start's year:
    [{date, time, home, opp, kind}], kind "L" league / "N" non-league / "T" tournament / "S" scrimmage (Arbiter's Type)."""
    page = curl(f"{BASE}/Teams/Schedule/{team_id}")
    i = page.find('id="tabSchedule"')
    games = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page[i:i + 60000], re.S):
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 6:
            continue
        m = re.match(r"\w{3} (\w{3}) (\d+)(?: (\d+:\d+ [AP]M))?", cells[0])
        if not m:
            continue
        month = datetime.datetime.strptime(m.group(1), "%b").month
        year = season_start.year + (1 if month < 7 else 0)
        logo = re.search(r"SchoolLogos/logo(\d+)\.", row)  # the opponent's ArbiterLive school id, when shown
        time = m.group(3) and datetime.datetime.strptime(m.group(3), "%I:%M %p").strftime("%H:%M")  # 24-hour, like NFHS
        games.append(dict(date=datetime.date(year, month, int(m.group(2))).isoformat(), time=time,
                          home=cells[1] == "vs", opp=cells[2], opp_id=logo and logo.group(1), kind=cells[5][:1] or None))
    return games


def load():
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def match(names, zips):
    """Match MPSSAA school names to ArbiterLive schools and their basketball teams; cached."""
    cache = load()
    todo = [n for n in names if n not in cache]

    def one(n):
        sid, nm = (FIXED[n], None) if n in FIXED else search(n, zips.get(n))
        return n, dict(id=sid, name=nm, **(teams(sid) if sid else {}))
    with ThreadPoolExecutor(6) as ex:
        for n, v in ex.map(one, todo):
            cache[n] = v
    CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True))
    return cache


def upcoming(names, gender, season_start, today, aliases=None, county=None):
    """MPSSAA-style unplayed game rows from ArbiterLive for these schools' varsity teams (gender "boys"/"girls").
    Opponents are given MPSSAA names when they are member schools (by ArbiterLive id, else by name; aliases maps
    other spellings to MPSSAA names; a name that fits several schools, like "Frederick Douglass", goes to the one in the
    listing school's county, per county). Each game appears once per school listing it."""
    county = county or {}
    cache = load()
    by_key = collections.defaultdict(set)
    for a, n in ((aliases or {}) | OPP_ALIAS).items():
        by_key[key(a)].add(n)
    by_id = {v["id"]: n for n, v in cache.items() if v.get("id")}
    for n, v in cache.items():
        by_key[key(n)].add(n)
        if v.get("name"):
            by_key[key(v["name"])].add(n)

    def by_name(opp, school):
        cands = sorted(by_key.get(key(opp), ()))
        near = [c for c in cands if county.get(c) and county.get(c) == county.get(school)]
        return (near or cands or [None])[0]
    ids = {n: v[gender] for n, v in cache.items() if n in names and v.get(gender)}
    with ThreadPoolExecutor(6) as ex:
        scheds = dict(zip(ids, ex.map(lambda t: schedule(t, season_start), ids.values())))
    rows = []
    for n, games in scheds.items():
        for g in games:
            # Skip past games, scrimmages (type S), events, and anything dated before the season (entry mistakes)
            if g["date"] < max(today, season_start.isoformat()) or g["kind"] == "S" or EVENT.search(g["opp"]):
                continue
            opp = by_id.get(g["opp_id"]) or by_name(g["opp"], n) or re.sub(r"\s+(High School|HS)$", "", g["opp"])
            rows.append(dict(school=n, opponent=opp, your_score=None, opponent_score=None, result=None,
                             game_date=g["date"], home_team=n if g["home"] else opp, source="arbiter",
                             kind=g["kind"], time=g["time"]))
    return rows, len(scheds)


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "scripts"))
    import build
    nonce = build.get_nonce()
    names, zips = set(), {}
    directory = {build.school_key(s["name"]): s for s in json.loads((ROOT / "scripts/cache/schools.json").read_text())}
    for sport in ("boys-basketball", "girls-basketball"):
        std = json.loads(build.curl(f"{build.API}standings?sport={sport}", nonce))
        for rs in std["classifications"].values():
            for r in rs:
                for t in r["teams"]:
                    names.add(t["school"])
                    d = directory.get(build.school_key(build.DIRECTORY_NAME.get(t["school"], t["school"])))
                    z = re.search(r"\d{5}", (d or {}).get("address") or "")
                    if z:
                        zips[t["school"]] = z.group(0)
    cache = match(sorted(names), zips)
    print(f"{sum(bool(v.get('id')) for v in cache.values())}/{len(names)} schools on ArbiterLive; "
          f"boys teams {sum('boys' in v for v in cache.values())}, girls {sum('girls' in v for v in cache.values())}")
    for n in sorted(names):
        v = cache.get(n, {})
        if not v.get("id"):
            print("  not found:", n)
        elif v.get("name") and key(v["name"]) != key(SEARCH.get(n, n)):
            print(f"  check: {n} -> {v['name']}")
