"""Watch links: match games to NFHS Network broadcasts (nfhsnetwork.com), using its public search API.

Schools are matched by name (MPSSAA name, its school-directory name, or with the county suffix like
"-AA" removed), with the city breaking ties between same-named schools. Each matched school's varsity
events this season are fetched, and a game gets the event link when the sport, gender, date (±1 day)
and both schools (when the opponent is matched too) agree. Any failure just means no watch links.
"""
import collections, datetime, json, re, subprocess, urllib.parse
from concurrent.futures import ThreadPoolExecutor

API = "https://search-api.nfhsnetwork.com/search/"


def get(path):
    out = subprocess.check_output(["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "30", API + path])
    return json.loads(out)


def pages(path):
    """All items of a paged search (cursor-based)."""
    items, cursor = [], None
    while True:
        d = get(path + "&size=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""))
        items += d.get("items") or []
        cursor = d.get("cursor")
        if not d.get("items") or len(items) >= d.get("total", 0) or not cursor:
            return items


def key(name):
    name = re.sub(r"\b(senior |sr\.? )?high school\b|\bhs\b|\bjr\.?/sr\.?\b", "", (name or "").lower())
    return re.sub(r"[^a-z0-9]", "", name.replace("&", "and"))


def match_names(names, alt_names, cities, candidates):
    """Our school name -> candidate["key"]. Candidates are dicts with key, name, optional short_name,
    city and is_network. Tries the MPSSAA name, its school-directory name and the name without a county
    suffix ("Chesapeake-AA"); the city breaks ties between same-named schools."""
    by = collections.defaultdict(list)
    for c in candidates:
        for n in {c.get("name"), c.get("short_name")}:
            if n:
                by[key(n)].append(c)
    out = {}
    for n in names:
        tries = [alt_names.get(n), n, re.sub(r"-(AA|B|C|G|PG|SD)$", "", n)]
        cands = next((by[key(t)] for t in tries if t and by.get(key(t))), [])
        city = (cities.get(n) or "").lower()
        # Same-named schools: prefer the one in our city, then a network school named "... High School"
        cands = sorted(cands, key=lambda c: ((c.get("city") or "").lower() != city, not c.get("is_network", True),
                                             "high school" not in (c.get("name") or "").lower()))
        if cands and (not city or (cands[0].get("city") or "").lower() == city or len({c["key"] for c in cands}) == 1):
            out[n] = cands[0]["key"]
    return out


def match_schools(names, alt_names, cities):
    """Our school name -> NFHS school key."""
    return match_names(names, alt_names, cities, pages("schools?state=MD"))


def events(school_key, since):
    return pages(f"events?school_key={school_key}&level=Varsity&from={since}")


def add_watch_links(sports, divisions, sport, alt_names, cities):
    """Set g["watch"] / u["watch"] on games and upcoming games that have an NFHS Network event."""
    names = sorted({t["school"] for s in sports.values() for t in s["teams"]})
    keys = match_schools(names, alt_names, cities)
    since = f"{datetime.date.today().year}-08-01"
    with ThreadPoolExecutor(8) as pool:
        found = dict(zip(keys.values(), pool.map(lambda k: events(k, since), keys.values())))
    # (school key, gender, date) -> [(opponent keys, url)]
    idx = collections.defaultdict(list)
    for evs in found.values():
        for e in evs:
            if e.get("sport") != sport or e.get("is_deleted") or not e.get("site_url"):
                continue
            local = e.get("local_start_time") or e["start_time"]
            day = datetime.date.fromisoformat(local[:10])
            time = None if e.get("time_to_be_determined") else local[11:16]  # "18:00", Eastern
            teams = {t["key"] for t in e.get("teams") or []}
            for k in teams:
                idx[(k, e.get("gender"), day)].append((teams - {k}, e["site_url"], time))
    linked = 0
    for div, s in sports.items():
        gender = divisions[div]["gender"]
        for t in s["teams"]:
            k = keys.get(t["school"])
            if not k:
                continue
            for g in t["games"] + t["upcoming"]:
                day, opp = datetime.date.fromisoformat(g["date"]), keys.get(g["opp"])
                for d in (day, day - datetime.timedelta(1), day + datetime.timedelta(1)):
                    hit = next(((url, time) for others, url, time in idx[(k, gender, d)] if not opp or opp in others), None)
                    if hit:
                        g["watch"] = hit[0]
                        if hit[1] and "time" not in g:  # MPSSAA has no start times; NFHS does
                            g["time"] = hit[1]
                        linked += 1
                        break
    print(f"  NFHS: {len(keys)}/{len(names)} schools matched, {linked} team-games with watch links")
