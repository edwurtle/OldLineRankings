#!/usr/bin/env python3
"""Fetch results and write power rankings for each site (soccer at site/, football at site/football/).

Power points per game:
  win  = opponent class points (soccer: 1A=5 .. 4A=8; football: MPSSAA seeding values 6/7/8)
         + opponent's season wins
  tie  = half of what a win would have earned
  loss = 0
Opponent "wins" count each of the opponent's ties as half a win. Opponents outside
the state association count as the lowest class with 0 wins. Teams are ranked by average
power points per game played. Strength of schedule (SOS) is the average a team
would have earned had it won every game.

Football is ranked by the Old Line Rating instead (see oldline.py); its MPSSAA points are kept
for playoff seeding.
"""
import collections, datetime, json, pathlib, re, subprocess
import oldline

API = "https://www.mpssaa.org/wp-json/smartsheet-sports/v1/"
ROOT = pathlib.Path(__file__).resolve().parent.parent

# Everything that differs between the sites. Shared by build.py and passed to app.js as DATA.config.
SITES = {
    "soccer": dict(
        out="site", sport="Soccer", icon="⚽",
        divisions={"boys": dict(label="Boys", api="boys-soccer"), "girls": dict(label="Girls", api="girls-soccer")},
        classes={"4A": 8, "3A": 7, "2A": 6, "1A": 5},
        regions=["East I", "East II", "North I", "North II", "South I", "South II", "West I", "West II"],
        score=dict(short="GF–GA", name="Goal difference", plural="goals"),
        ties=True, example=dict(cls="3A", W=7, L=2, T=1),
    ),
    "football": dict(
        out="site/football", sport="Football", icon="🏈",
        divisions={"football": dict(label="Football", api="football")},
        # MPSSAA football seeding win points (Football Tournament Bulletin, "Classification Win Points")
        classes={"4A": 8, "4A_3A": 8, "3A": 7, "2A": 7, "2A_1A": 6, "1A": 6},
        labels={"4A_3A": "4A/3A", "2A_1A": "2A/1A"},
        regions=["East", "North", "South", "West"],
        score=dict(short="PF–PA", name="Point difference", plural="points"),
        ties=False, example=dict(cls="3A", W=5, L=2, T=0),
        # Region top 8 play two rounds; two per region reach the 8-team state quarterfinal, reseeded by rating
        playoffs=dict(region_seeds=8, per_region=2), first_meeting_only=True,
        # Old Line Rating: margin capped at 28 (under the 35-point running clock), 4-point win bonus,
        # pulled toward class average by 3 games' worth; k = win-probability scale per rating point.
        # Backtested on 2026 weeks 3-6: picks 79% of winners vs 71% for MPSSAA points.
        olr=dict(cap=28, win_bonus=4, prior=3, k=0.175),
    ),
}

# Opponent spellings that refer to member schools
ALIAS = {"Mt. Hebron": "Mount Hebron", "Flowers HS": "Charles H. Flowers", "Wise HS": "Dr. Henry A. Wise",
         "Northern HS": "Northern-C", "NAF": "National Academy Foundation (NAF)", "Duval": "DuVal"}
RES = {"Win": "W", "Forfeit-Win": "W", "Loss": "L", "Forfeit-Loss": "L", "Tie": "T"}
FLIP = {"W": "L", "L": "W", "T": "T"}


def curl(url, nonce=None):
    cmd = ["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "60"]
    if nonce:
        cmd += ["-H", f"X-WP-Nonce: {nonce}"]
    return subprocess.check_output(cmd + [url]).decode()


def fetch(sport, nonce):
    games, off = [], 0
    while True:
        d = json.loads(curl(f"{API}recent-results?sport={sport}&limit=100&offset={off}&status=", nonce))
        games += d["games"]
        off += d["count"]
        if d["count"] == 0 or off >= d["total"]:
            break
    return games, json.loads(curl(f"{API}standings?sport={sport}", nonce))


def rank_sport(raw_games, standings, class_pts, first_meeting_only=False):
    std = {t["school"]: {"cls": c, "region": r["region"]}
           for c, rs in standings["classifications"].items() for r in rs for t in r["teams"]}

    def norm(name):
        name = name.strip()
        if name in ALIAS:
            return ALIAS[name]
        bare = re.sub(r"\s+HS$", "", name)
        return bare if bare in std else name

    # Some football rows have only a week number. Date them from the same matchup's other
    # entry in that week, else from the most common date that week.
    week_dates = collections.defaultdict(collections.Counter)
    pair_dates = {}
    for x in raw_games:
        if x["game_date"] and x.get("week"):
            week_dates[x["week"]][x["game_date"]] += 1
            pair_dates[(x["week"], frozenset((norm(x["school"]), norm(x["opponent"]))))] = x["game_date"]
    for x in raw_games:
        if not x["game_date"] and x.get("week") in week_dates:
            x["game_date"] = pair_dates.get((x["week"], frozenset((norm(x["school"]), norm(x["opponent"])))),
                                            week_dates[x["week"]].most_common(1)[0][0])

    # Each school may enter the same game, sometimes a day apart (Fri vs Sat). Entries for
    # the same matchup within a day of each other are one game, dated by the earliest.
    pair_days = collections.defaultdict(set)
    for x in raw_games:
        if x["game_date"]:
            pair_days[frozenset((norm(x["school"]), norm(x["opponent"])))].add(x["game_date"])
    same_game = {}
    for pair, days in pair_days.items():
        first = prev = None
        for d in sorted(days):
            if not prev or (datetime.date.fromisoformat(d) - datetime.date.fromisoformat(prev)).days > 1:
                first = d
            same_game[(pair, d)] = first
            prev = d

    # Dedupe by (date, teams) and take the most common result when entries disagree.
    entries = collections.defaultdict(list)
    unplayed = {}  # (date, a, b) -> (home team, postponed?)
    for x in raw_games:
        r = RES.get(x["result"])
        a, b = norm(x["school"]), norm(x["opponent"])
        x = dict(x, game_date=same_game.get((frozenset((a, b)), x["game_date"]), x["game_date"]))
        sa, sb, home = x["your_score"], x["opponent_score"], a
        if b in std and b < a:
            a, b, sa, sb = b, a, sb, sa
            r = FLIP.get(r)
        if not r:
            if x["result"] != "Cancelled" and x["game_date"]:
                unplayed[(x["game_date"], a, b)] = (home, x["result"] == "Postponed")
            continue
        entries[(x["game_date"], a, b)].append((r, sa, sb, home, x["result"].startswith("Forfeit")))
    if first_meeting_only:
        # Only the first meeting between two teams counts (football bulletin II.A.2.h); this also
        # drops repeat entries the source has under the wrong date. Later scheduled repeats are dropped too.
        first = {}
        for dt, a, b in sorted(list(entries) + list(unplayed)):
            first.setdefault((a, b), dt)
        entries = {k: v for k, v in entries.items() if first[k[1:]] == k[0]}
        unplayed = {k: v for k, v in unplayed.items() if first[k[1:]] == k[0]}
    rec = collections.defaultdict(list)
    for (dt, a, b), es in entries.items():
        r, sa, sb, home, ff = collections.Counter(es).most_common(1)[0][0]
        rec[a].append(dict(date=dt, opp=b, res=r, gf=sa, ga=sb, home=home == a, ff=ff))
        if b in std:
            rec[b].append(dict(date=dt, opp=a, res=FLIP[r], gf=sb, ga=sa, home=home == b, ff=ff))

    # Remaining schedule: unplayed games not already reported. A postponed game is dropped
    # once the same matchup appears again later (rescheduled or played).
    pairs = collections.defaultdict(list)
    for dt, a, b in list(entries) + list(unplayed):
        pairs[(a, b)].append(dt)
    today = datetime.date.today().isoformat()
    upcoming = collections.defaultdict(list)
    for (dt, a, b), (home, postponed) in unplayed.items():
        if (dt, a, b) in entries or (postponed and any(d > dt for d in pairs[(a, b)])):
            continue
        status = "postponed" if postponed else ("pending" if dt < today else "scheduled")
        upcoming[a].append(dict(date=dt, opp=b, home=home == a, status=status))
        if b in std:
            upcoming[b].append(dict(date=dt, opp=a, home=home == b, status=status))

    record = {s: {k: sum(g["res"] == k for g in rec[s]) for k in "WLT"} for s in std}
    opp_wins = {s: r["W"] + 0.5 * r["T"] for s, r in record.items()}
    teams = []
    for s, info in std.items():
        games = []
        for g in sorted(rec[s], key=lambda g: g["date"]):
            member = g["opp"] in std
            cp = class_pts[std[g["opp"]]["cls"]] if member else min(class_pts.values())
            ow = opp_wins[g["opp"]] if member else 0
            mult = {"W": 1, "T": 0.5, "L": 0}[g["res"]]
            games.append(dict(g, member=member, cp=cp * mult, ow=ow * mult, pts=(cp + ow) * mult, max=cp + ow))
        gp = len(games)
        total = sum(g["pts"] for g in games)
        avg = round(total / gp, 4) if gp else 0
        teams.append(dict(school=s, cls=info["cls"], region=info["region"], **record[s], gp=gp, pts=total,
                          avg=avg, rating=avg,
                          # Strength of schedule: average points per game had every game been a win
                          sos=round(sum(g["max"] for g in games) / gp, 4) if gp else 0,
                          gf=sum(g["gf"] or 0 for g in games), ga=sum(g["ga"] or 0 for g in games),
                          games=games,
                          upcoming=[dict(u, member=u["opp"] in std) for u in sorted(upcoming[s], key=lambda u: u["date"])]))
    assign_ranks(teams)
    return teams


def assign_ranks(teams):
    """Order teams by rating and number them statewide and within class, by rating and by SOS."""
    teams.sort(key=lambda t: (-t["rating"], -t["pts"]))
    for i, t in enumerate(teams, 1):
        t["stateRank"] = i
    for i, t in enumerate(sorted(teams, key=lambda t: -t["sos"]), 1):
        t["sosStateRank"] = i
    for c in {t["cls"] for t in teams}:
        for i, t in enumerate([t for t in teams if t["cls"] == c], 1):
            t["rank"] = i
        for i, t in enumerate(sorted((t for t in teams if t["cls"] == c), key=lambda t: -t["sos"]), 1):
            t["sosRank"] = i


# Results/standings name -> school directory name, where they differ beyond punctuation
DIRECTORY_NAME = {
    "ACCE": "Academy for College & Career Exploration (ACCE)", "Baltimore Polytechnic": "Baltimore Polytechnic Institute",
    "Bethesda-CC": "Bethesda-Chevy Chase", "CMIT - North": "Chesapeake Math & IT Academy – North",
    "CMIT - South": "Chesapeake Math & IT Academy – South", "Carver A&T": "Carver Center for Arts & Technology",
    "Charles H. Flowers": "Charles Herbert Flowers", "Col. Zadok Magruder": "Colonel Zadok Magruder",
    "Dr. Henry A. Wise": "Dr. Henry A. Wise, Jr.", "Eastern Tech": "Eastern Technical",
    "Gov. Thomas Johnson": "Governor Thomas Johnson", "Harford Tech": "Harford Technical", "Mardela": "Mardela Jr./Sr.",
    "McDonough": "Maurice J. McDonough", "Mergenthaler": "Mergenthaler Vocational-Technical",
    "North East-C": "North East", "SEED School": "The SEED School of Maryland", "Northeast-AA": "Northeast", "Northern-C": "Northern-Cal",
    "Northern-G": "Northern-Garrett", "Northwood": "Northwood \n(@ Woodward)", "Reginald Lewis": "Reginald F. Lewis",
    "Southern-G": "Southern-Garrett", "St. Charles": "Saint Charles", "St. Michael's": "Saint Michaels",
    "Western Tech": "Western School of Technology & Environmental Science", "Western-B": "Western",
}


def school_key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower().replace("&", "and"))


def match_schools(team_names, logo_prefix=""):
    directory = json.loads((ROOT / "scripts" / "cache" / "schools.json").read_text())
    by_key = {school_key(s["name"]): s for s in directory}
    out, missing = {}, []
    for n in team_names:
        s = by_key.get(school_key(DIRECTORY_NAME.get(n, n)))
        if not s:
            missing.append(n)
            continue
        city = (s.get("address") or "").split(",")[-1].strip()
        out[n] = dict(logo=s.get("logo") and logo_prefix + s["logo"], color=s.get("color"), mascot=s.get("mascot"),
                      county=s.get("school_system"), city=re.sub(r"\s*\d{5}.*$", "", city) or None)
    return out, missing


def project(raw_games, standings, class_pts, teams, first_meeting_only, ratings, home, olr):
    """MPSSAA points as if every remaining (non-postponed) game were won by the OLR favorite.
    Adds t["proj"] to each team."""
    extra = []
    for t in teams:
        for u in t["upcoming"]:
            if u["status"] == "postponed" or (u["member"] and u["opp"] < t["school"]):
                continue  # each member-vs-member game once
            won = oldline.win_prob(ratings[t["school"]], ratings[u["opp"]], 1 if u["home"] else -1, home, olr["k"]) >= .5
            extra.append(dict(school=t["school"], opponent=u["opp"], result="Win" if won else "Loss",
                              your_score=None, opponent_score=None, game_date=u["date"]))
    projected = {p["school"]: p for p in rank_sport(raw_games + extra, standings, class_pts, first_meeting_only)}
    for t in teams:
        p = projected[t["school"]]
        t["proj"] = {k: p[k] for k in ("W", "L", "T", "gp", "pts", "avg")}


def build_site(key, cfg, nonce, stamp):
    out = ROOT / cfg["out"]
    out.mkdir(parents=True, exist_ok=True)
    root = "../" * (len(pathlib.Path(cfg["out"]).parts) - 1)  # path from this site back to site/
    sports = {}
    for div, d in cfg["divisions"].items():
        raw, standings = fetch(d["api"], nonce)
        teams = rank_sport(raw, standings, cfg["classes"], cfg.get("first_meeting_only", False))
        sports[div] = dict(teams=teams, through=max((g["date"] for t in teams for g in t["games"]), default=None))
        if cfg.get("olr"):
            ratings, home = oldline.rate(teams, cfg["olr"])
            assign_ranks(teams)
            project(raw, standings, cfg["classes"], teams, cfg.get("first_meeting_only", False), ratings, home, cfg["olr"])
            oldline.simulate(teams, cfg["classes"], ratings, home, cfg["olr"], cfg["playoffs"], cfg["regions"])
            members = {t["school"] for t in teams}
            sports[div]["nonmember"] = {x: round(v, 2) for x, v in ratings.items() if x not in members}
            sports[div]["home"] = round(home, 2)
        print(f"{key}/{div}: {len(teams)} teams, games through {sports[div]['through']}")
    names = sorted({t["school"] for s in sports.values() for t in s["teams"]})
    schools, missing = match_schools(names, root)
    if missing:
        print("No directory match for:", missing)
    # Links to the other sites, relative to this one (footer)
    others = [dict(sport=c["sport"], icon=c["icon"], href=root + "".join(p + "/" for p in pathlib.Path(c["out"]).parts[1:]))
              for k, c in SITES.items() if k != key]
    config = {k: v for k, v in cfg.items() if k not in ("out", "divisions")} | dict(
        others=others, divisions={k: d["label"] for k, d in cfg["divisions"].items()})
    data = dict(updated=datetime.datetime.now().strftime("%b %-d, %Y"), config=config, schools=schools, sports=sports)
    (out / "data.js").write_text("window.DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
    # Every site shares one page shell; asset links are cache-busted so browsers pick up new data/code
    page = (ROOT / "scripts" / "page.html").read_text()
    for k, v in dict(root=root, sport=cfg["sport"], sport_lower=cfg["sport"].lower(), icon=cfg["icon"], stamp=stamp).items():
        page = page.replace("{{" + k + "}}", v)
    (out / "index.html").write_text(page)
    print(f"Wrote {cfg['out']}/")


def main():
    page = curl("https://www.mpssaa.org/live-scores/")
    nonce = re.search(r'"nonce":"([a-z0-9]+)"', page).group(1)
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    for key, cfg in SITES.items():
        build_site(key, cfg, nonce, stamp)


if __name__ == "__main__":
    main()
