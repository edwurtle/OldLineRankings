"""Official playoff brackets: MPSSAA's bracket pages (mpssaa.org/brackets/…) load them from the tournament-bracket
block of its sports-data API, as HTML. That HTML is the same shape for every sport: a tab per class, then each class's
state bracket and one bracket per region, each a list of rounds of games. Before seeding every slot reads "TBD".

parse() turns it into a flat list of games. A team slot is {seed, name, score}; name is None for a slot still waiting
on an earlier game ("TBD", "Winner QF Game 1") and "Bye" for a bye. Names are MPSSAA's spellings, matched to our
schools by the caller.
"""
import datetime, html, re

BLOCK = "blocks/tournament-bracket?sport={sport}&sheet_id=&class=&year="


def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def chunks(s, cls):
    """The pieces of s that each start with an element of class `cls` (exact class, not a BEM suffix of it)."""
    parts = re.split(rf'(?=<div class="{cls}[ "])', s)
    return parts[1:]


def iso(d):
    try:
        return datetime.datetime.strptime(d, "%m-%d-%Y").date().isoformat()
    except ValueError:
        return None


def slot(s):
    seed = re.search(r'bracket__seed">([^<]*)<', s)
    spans = re.findall(r"<span>([^<]*)</span>", s)
    name = text(spans[-1]) if spans else ""
    score = text(re.search(r'bracket__score">(.*?)</div>', s).group(1))
    placeholder = not name or name == "TBD" or name.startswith("Winner ")
    return dict(seed=int(seed.group(1)) if seed and seed.group(1).strip().isdigit() else None,
                name=None if placeholder else name,
                score=int(score) if re.fullmatch(r"\d+", score) else None)


def game(s):
    teams = [slot(t) for t in chunks(s, "smartsheet-bracket__team")]
    won = [i for i, t in enumerate(chunks(s, "smartsheet-bracket__team")) if "bracket__team--winner" in t[:120]]
    info = re.search(r'bracket__info">(.*?)</div>', s)
    # "📅 02-27-2026 ⏰ 6:45pm 📍 Glen Burnie"
    m = re.match(r"📅\s*(.*?)\s*⏰\s*(.*?)\s*📍\s*(.*)$", text(info.group(1))) if info else None
    date, time, site = [None if not v or v == "TBD" else v for v in (m.groups() if m else (None,) * 3)]
    return dict(teams=teams, winner=won[0] if len(won) == 1 else None,
                completed="bracket__game--completed" in s[:120],
                date=date and iso(date), time=time, site=site)


def parse(page, classes):
    """{updated, games} from the block's HTML; games are dicts of game() plus c (one of `classes`), level ("State"
    or a region), round (MPSSAA's name, e.g. "Region QF") and n (1-based within the round). The tab "Class 4A3A" maps
    to the class "4A/3A"."""
    by_tab = {"Class " + c.replace("/", ""): c for c in classes}
    updated = re.search(r'data-smartsheet-modified-at="([^"]*)"', page)
    games = []
    for content in chunks(page, "smartsheet-bracket__content"):
        head = re.match(r'<div class="[^"]*" data-class="([^"]*)" data-level="([^"]*)"', content)
        c = by_tab.get(head.group(1))
        if not c:
            raise ValueError(f"bracket class {head.group(1)!r} is not one of {classes}")
        level = "State" if head.group(2) == "state" else head.group(2)
        for rnd in chunks(content, "smartsheet-bracket__round"):
            name = re.search(r'data-round="([^"]*)"', rnd).group(1)
            for n, g in enumerate(chunks(rnd, "smartsheet-bracket__game"), 1):
                games.append(dict(c=c, level=level, round=name, n=n) | game(g))
    return dict(updated=updated and updated.group(1), games=games)


def posted(b):
    """Whether seeding is out: any slot names a team."""
    return any(t["name"] for g in b["games"] for t in g["teams"])
