"""Ticket links: match upcoming games to GoFan events (gofan.co), the ticketing service MD schools use.

GoFan has no school-name search, but its event search by school lists each event's host and opponent
school IDs (Maryland IDs look like "MD24853"). So Maryland schools are discovered by walking from known
schools to their opponents; the ID -> name/city directory is cached in scripts/cache/gofan_schools.json
and only re-walked when one of our schools is missing. Upcoming games get the event's ticket link when
the sport, gender (soccer), varsity level, date (±1 day, Eastern) and schools agree.
"""
import datetime, json, pathlib, subprocess, zoneinfo
from concurrent.futures import ThreadPoolExecutor
import nfhs

API = "https://api.gofan.co/v2/"
CACHE = pathlib.Path(__file__).resolve().parent / "cache" / "gofan_schools.json"
SEEDS = ["MD24853"]  # Walkersville; any Maryland school works as a starting point
EASTERN = zoneinfo.ZoneInfo("America/New_York")


def get(path):
    return json.loads(subprocess.check_output(["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "30", API + path]))


def school_events(school_id):
    try:
        out = get(f"events/search?schoolId={school_id}")
        return out if isinstance(out, list) else []
    except Exception:
        return []


def discover(directory, max_rounds=8):
    """Walk opponents of known Maryland schools to fill the ID -> {name, city} directory."""
    frontier = set(directory) or set(SEEDS)
    seen = set()
    with ThreadPoolExecutor(8) as pool:
        for _ in range(max_rounds):
            frontier -= seen
            if not frontier:
                break
            seen |= frontier
            found = set()
            for evs in pool.map(school_events, sorted(frontier)):
                for e in evs:
                    for sid in (e.get("schoolHuddleId"), e.get("opponentSchoolId"), *(e.get("taggedSchoolHuddleIds") or [])):
                        if sid and sid.startswith("MD") and sid not in directory:
                            found.add(sid)
            for sid, s in zip(sorted(found), pool.map(lambda i: get(f"schools/{i}"), sorted(found))):
                if s.get("name"):
                    directory[sid] = dict(name=s["name"], city=s.get("city"), type=s.get("gofanSchoolType"))
            frontier = found
    return directory


def add_ticket_links(sports, divisions, sport, alt_names, cities):
    """Set u["tickets"] on upcoming games that have a GoFan event."""
    directory = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    names = sorted({t["school"] for s in sports.values() for t in s["teams"]})
    candidates = [dict(key=sid, name=d["name"], city=d.get("city")) for sid, d in directory.items()]
    ids = nfhs.match_names(names, alt_names, cities, candidates)
    if len(ids) < 0.9 * len(names):  # schools missing from the cached directory: walk GoFan again
        directory = discover(directory)
        CACHE.write_text(json.dumps(directory, indent=1, sort_keys=True))
        candidates = [dict(key=sid, name=d["name"], city=d.get("city")) for sid, d in directory.items()]
        ids = nfhs.match_names(names, alt_names, cities, candidates)
    with ThreadPoolExecutor(8) as pool:
        events = dict(zip(ids.values(), pool.map(school_events, ids.values())))
    # (school id, gender, date) -> [(other school ids, url)]
    idx = {}
    for evs in events.values():
        for e in evs:
            if (e.get("activity") or {}).get("name") != sport or e.get("canceled") or e.get("archived"):
                continue
            # levels: [{"levelName": "Varsity", "genders": ["Boys"]}, ...]; gender may also be event-wide
            varsity = [lv for lv in e.get("resolvedLevels") or e.get("levels") or [] if lv.get("levelName") == "Varsity"]
            if not varsity:
                continue
            genders = {g for lv in varsity for g in lv.get("genders") or []} | set(e.get("resolvedGenders") or e.get("genders") or [])
            start = datetime.datetime.fromisoformat(e["startDateTime"]).astimezone(EASTERN)
            day, time = start.date(), start.strftime("%H:%M")
            time = None if time == "00:00" else time  # all-day events
            schools = {e.get("schoolHuddleId"), e.get("opponentSchoolId")} - {None}
            for gender in genders or {None}:
                for sid in schools:
                    idx.setdefault((sid, gender, day), []).append((schools - {sid}, f"https://gofan.co/event/{e['id']}", time))
    today, linked = datetime.datetime.now(zoneinfo.ZoneInfo("America/New_York")).date(), 0
    for div, s in sports.items():
        gender = divisions[div]["gender"]
        for t in s["teams"]:
            sid = ids.get(t["school"])
            if not sid:
                continue
            for u in t["upcoming"]:
                day, opp = datetime.date.fromisoformat(u["date"]), ids.get(u["opp"])
                if day < today or u["status"] == "postponed":
                    continue
                for d in (day, day - datetime.timedelta(1), day + datetime.timedelta(1)):
                    # Football events are often "Coed"; soccer must match the division's gender
                    entries = [x for g in ((gender,) if sport == "Soccer" else (gender, "Coed", None)) for x in idx.get((sid, g, d), [])]
                    hit = next(((url, time) for others, url, time in entries if not opp or opp in others), None)
                    if hit:
                        u["tickets"] = hit[0]
                        u.setdefault("time", hit[1])
                        linked += 1
                        break
    print(f"  GoFan: {len(ids)}/{len(names)} schools matched, {linked} upcoming team-games with ticket links")
