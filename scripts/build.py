#!/usr/bin/env python3
"""Fetch results and write rankings for each site (site/football/, site/boys-soccer/, site/girls-soccer/)
and the splash page (site/).

Points per game (soccer's Old Line Rating; for football the same formula is the MPSSAA points):
  win  = opponent class points (soccer: 1A=5 .. 4A=8; football: MPSSAA seeding values 6/7/8)
         + opponent's season wins
  tie  = half of what a win would have earned
  loss = 0
Opponent "wins" count each of the opponent's ties as half a win. Opponents outside
the state association count as the lowest class with 0 wins. Teams are ranked by average
points per game played. Strength of schedule (SOS) is the average a team
would have earned had it won every game.

Football is ranked by the Old Line Rating instead (see oldline.py); its MPSSAA points are kept
for playoff seeding.
"""
import collections, datetime, html, json, pathlib, re, shutil, subprocess, time, urllib.parse, zoneinfo
import arbiter, brackets, gofan, icons, nfhs, oldline

API = "https://www.mpssaa.org/wp-json/smartsheet-sports/v1/"
ROOT = pathlib.Path(__file__).resolve().parent.parent

# Scores MPSSAA is missing, filled in by hand: site key -> {(date, team, opponent): (team score, opponent score)}.
# Only used when MPSSAA has no score for the game; its result still decides who won (the score does when it has none).
SCORE_FIXES = {
    "football": {
        ("2026-09-04", "Linganore", "Mergenthaler"): (29, 28),
        # Week 9 games MPSSAA hadn't posted by Oct 24 evening, from SI / MaxPreps / ArbiterLive / CSZ.
        # TODO: check against MPSSAA's official results once posted, then drop these.
        ("2026-10-23", "Parkville", "Kenwood"): (27, 26),
        ("2026-10-23", "Milford Mill Academy", "Randallstown"): (35, 24),
        ("2026-10-23", "Perryville", "Patterson Mill"): (49, 14),
        ("2026-10-23", "Rising Sun", "North East-C"): (40, 0),
        ("2026-10-23", "Clear Spring", "WV- Petersburg"): (13, 55),
        ("2026-10-24", "Wilde Lake", "Hammond"): (39, 0),
        ("2026-10-24", "DuVal", "Northwestern"): (35, 12),
        ("2026-10-24", "Crossland", "Central"): (38, 18),
        # Entered by Chopticon as a "Win" 14-14 (MPSSAA flags it as a mismatch); the final was 16-14 (MaxPreps, Yahoo)
        ("2026-10-23", "Chopticon", "Leonardtown"): (16, 14),
    },
}

# Maryland time: "today" and "updated" follow Eastern time, not the build server's clock (UTC)
ET = zoneinfo.ZoneInfo("America/New_York")


def now_et():
    return datetime.datetime.now(ET)


def updated_et():
    """'Oct 15, 2026, 11:19 PM ET': when this build ran, Eastern time."""
    t = now_et()
    return f"{t:%b} {t.day}, {t.year}, {t.hour % 12 or 12}:{t:%M} {'AM' if t.hour < 12 else 'PM'} ET"


# Canonical address of the site (search engines, link previews, sitemap)
SITE_URL = "https://oldlinerankings.com"

# Boys and girls soccer are separate sites that share everything but the division
SOCCER = dict(
    icon="soccer", season="Fall", activity="Soccer",   # activity: the sport's name on NFHS Network / GoFan
    ranked_by="Old Line Rating: capped goal margins + opponent strength",
    classes={"4A": 8, "3A": 7, "2A": 6, "1A": 5},
    regions=["East I", "East II", "North I", "North II", "South I", "South II", "West I", "West II"],
    score=dict(short="GF–GA", name="Goal difference", plural="goals"),
    ties=True, example=dict(cls="3A", W=7, L=2, T=1),
    # Soccer bulletin: every team is seeded in its region by winning percentage (fewer than 9 games
    # divide by 9); each region plays down to one champion; the 8 champions are reseeded by it
    # last_date: the bulletin's "last play date for seeding consideration"; later games don't count.
    # seed_date: the seeding meeting, where ties are broken (coin flips included) and brackets posted the same day
    playoffs=dict(seed_by="winpct", min_games=9, region_seeds=8, per_region=1, last_date="2026-10-24", seed_date="2026-10-26"),
    # Read MPSSAA's official bracket (scripts/brackets.py) once seeding has posted it
    brackets=True,
    # Dates whose games MPSSAA's standings leave out (Sat Sep 5: preseason jamborees and showcases, many teams
    # playing twice); they count for no one's record or rating
    uncounted_dates=["2026-09-05"],
    # Old Line Rating as for football but on goals: margin capped at 4, no win bonus. Backtested on 2026
    # weeks 3+ (each week from earlier games): boys 73% of winners vs 70% for class+opponent-wins points;
    # girls 68% vs 70% (within noise). k is set per site below.
    olr=dict(cap=4, win_bonus=0, prior=3, ladder=50, k=1.0, digits=2, cap_note="so lopsided games don't count extra",
             example=[2, 1]),
)

# Boys and girls basketball: seeded like soccer (winning percentage, 8 regions per class, each region plays down
# to one champion), rated on points. Winter bulletin: fewer than 15 games divide by 15 (max 20 games).
# Early season: no rankings or predictions before rank_date, no projected brackets or odds before project_date.
BASKETBALL = dict(
    icon="basketball", season="Winter", season_years="2026–27", activity="Basketball",
    ranked_by="Old Line Rating: capped point margins + opponent strength",
    classes={"4A": 8, "3A": 7, "2A": 6, "1A": 5},
    regions=SOCCER["regions"],
    score=dict(short="PF–PA", name="Point difference", plural="points"),
    ties=False, example=dict(cls="3A", W=14, L=6, T=0),
    # last_date: estimated from 2025-26 (Feb 23); update from the 2026-27 winter bulletin (and add its seed_date)
    playoffs=dict(seed_by="winpct", min_games=15, region_seeds=8, per_region=1, last_date="2027-02-22"),
    # Backtested on 2025-26 (each week from earlier games): bigger caps kept helping up to about 40, and a small
    # win bonus helped a little.
    olr=dict(cap=40, win_bonus=3, prior=3, ladder=50, k=0.145, digits=1, cap_note="so blowouts don't count extra",
             example=[12, 5]),
    # Rankings and predictions start rank_date (about when most teams have played 4 games, from the schedules);
    # projected brackets and odds start project_date (about 8 games)
    season_start="2026-11-15", rank_date="2026-12-15", project_date="2027-01-12",
    # Classes and regions from this fall's soccer standings while the basketball standings are last season's
    alignment="soccer",
    # Upcoming games from ArbiterLive until MPSSAA posts the season's schedule
    arbiter=True,
)

# Everything that differs between the sites. Order here is the order on the splash page and footer. Shared by build.py and passed to app.js as DATA.config.
SITES = {
    "football": dict(
        out="site/football", sport="Football", icon="football", season="Fall",
        ranked_by="Old Line Rating: capped scoring margins + opponent strength",
        divisions={"football": dict(label="Football", api="football", gender="Boys")},
        # MPSSAA football seeding win points (Football Tournament Bulletin, "Classification Win Points")
        classes={"4A": 8, "4A_3A": 8, "3A": 7, "2A": 7, "2A_1A": 6, "1A": 6},
        labels={"4A_3A": "4A/3A", "2A_1A": "2A/1A"},
        regions=["East", "North", "South", "West"],
        score=dict(short="PF–PA", name="Point difference", plural="points"),
        ties=False, example=dict(cls="3A", W=5, L=2, T=0),
        # Football bulletin: region top 8 by MPSSAA points play two rounds; two per region reach the
        # 8-team state quarterfinal, reseeded by MPSSAA points
        playoffs=dict(seed_by="mpssaa", region_seeds=8, per_region=2, last_date="2026-10-31"), first_meeting_only=True,
        # Old Line Rating: margin capped at 28 (under the 35-point running clock), 4-point win bonus,
        # pulled toward class average by 3 games' worth; k = win-probability scale per rating point.
        # Backtested on 2026 weeks 3-6 (games after the week-2 fit): picks 75% of winners vs 70% for MPSSAA points.
        # ladder: class averages pulled toward an even class ladder by 50 games' worth (backtest: better
        # predictions, most on cross-class games)
        olr=dict(cap=28, win_bonus=4, prior=3, ladder=50, k=0.16, cap_note="just under the 35-point running clock",
                 example=[20, 14], tested="2026 weeks 3–6 using only earlier games: the Old Line Rating picked 75% of winners versus 70% for MPSSAA points"),
    ),
    "boys-soccer": dict(SOCCER, out="site/boys-soccer", sport="Boys Soccer", olr=dict(SOCCER["olr"], k=1.2, tested="2026 weeks 3 on using only earlier games: the Old Line Rating picked 73% of winners versus 70% for points from opponent class + opponent wins"),
                        divisions={"boys": dict(label="Boys Soccer", api="boys-soccer", gender="Boys")}),
    "girls-soccer": dict(SOCCER, out="site/girls-soccer", sport="Girls Soccer", olr=dict(SOCCER["olr"], k=0.95, tested="2026 weeks 3 on using only earlier games: the Old Line Rating picked 68% of winners versus 70% for points from opponent class + opponent wins, about even"),
                         divisions={"girls": dict(label="Girls Soccer", api="girls-soccer", gender="Girls")}),
    "boys-basketball": dict(BASKETBALL, out="site/boys-basketball", sport="Boys Basketball",
                            olr=dict(BASKETBALL["olr"], tested="2025-26 (part of the season's results) using only earlier games: the Old Line Rating picked 76% of winners versus 73% for the better record"),
                            divisions={"boys": dict(label="Boys Basketball", api="boys-basketball", gender="Boys")}),
    "girls-basketball": dict(BASKETBALL, out="site/girls-basketball", sport="Girls Basketball",
                             olr=dict(BASKETBALL["olr"], tested="2025-26 using only earlier games: the Old Line Rating picked 82% of winners versus 79% for the better record"),
                             divisions={"girls": dict(label="Girls Basketball", api="girls-basketball", gender="Girls")}),
}

# Sports shown on the splash page and in the footer before they have a site
COMING = [dict(sport="Lacrosse", icon="lacrosse", season="Spring", note="Boys & girls · coming spring 2027")]

# Opponent spellings that refer to member schools
ALIAS = {"Mt. Hebron": "Mount Hebron", "Flowers HS": "Charles H. Flowers", "Wise HS": "Dr. Henry A. Wise",
         "Northern HS": "Northern-C", "NAF": "National Academy Foundation (NAF)", "Duval": "DuVal",
         "OId Mill": "Old Mill"}   # capital I for l (girls soccer)
RES = {"Win": "W", "Forfeit-Win": "W", "Loss": "L", "Forfeit-Loss": "L", "Tie": "T"}
NO_GAME = {"BYE/No Game"}   # rows for an open date (opponent "No Game/Open Date", 0-0): not a game
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
        # Exact name, then a known alias, then without " HS", but only if that is a team in this sport
        name = name.strip()
        for cand in (name, ALIAS.get(name), re.sub(r"\s+HS$", "", name)):
            if cand and cand in std:
                return cand
        return ALIAS.get(name, name)

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
    times = {}     # (date, a, b) -> start time, where the source has one (ArbiterLive)
    sides = collections.defaultdict(set)  # (date, a, b) -> schools whose sheets report the result
    for x in raw_games:
        if x["result"] in NO_GAME:
            continue
        r = RES.get(x["result"])
        # Some games are posted as completed with a score but no result: take the result from the score
        if not r and x.get("status") == "completed" and x["your_score"] is not None and x["opponent_score"] is not None:
            r = "W" if x["your_score"] > x["opponent_score"] else "L" if x["your_score"] < x["opponent_score"] else "T"
        a, b = norm(x["school"]), norm(x["opponent"])
        x = dict(x, game_date=same_game.get((frozenset((a, b)), x["game_date"]), x["game_date"]))
        sa, sb, home = x["your_score"], x["opponent_score"], a
        if x.get("source") == "arbiter":  # ArbiterLive rows say who hosts; MPSSAA rows are entered by the host
            home = norm(x["home_team"])
        if b in std and b < a:
            a, b, sa, sb = b, a, sb, sa
            r = FLIP.get(r)
        # A result dated after today (Eastern) can't be real yet (entered early or by mistake): keep it upcoming
        # (project() adds future games on purpose; those are marked projected)
        if r and x["game_date"] and x["game_date"] > now_et().date().isoformat() and not x.get("projected"):
            unplayed[(x["game_date"], a, b)] = (home, False)
            continue
        if not r:
            if x["result"] != "Cancelled" and x["game_date"]:
                unplayed[(x["game_date"], a, b)] = (home, x["result"] == "Postponed")
                if x.get("time"):
                    times[(x["game_date"], a, b)] = x["time"]
            continue
        if not x["game_date"]:
            continue  # a result with no date anywhere can't be placed in the season
        entries[(x["game_date"], a, b)].append((r, sa, sb, home, (x["result"] or "").startswith("Forfeit")))
        sides[(x["game_date"], a, b)].add(norm(x["school"]))
    # The same game is sometimes entered by each school under a different date: two days apart, or the
    # right day in the wrong month. Two such dates for one matchup with the same result and score, each
    # reported by a different single school, are one game, dated by the earliest.
    def misdated(d1, d2):
        d1, d2 = datetime.date.fromisoformat(d1), datetime.date.fromisoformat(d2)
        return (d2 - d1).days <= 2 or (d1.day == d2.day and (d2.year * 12 + d2.month) - (d1.year * 12 + d1.month) == 1)
    top = lambda k: collections.Counter(entries[k]).most_common(1)[0][0][:3]
    for k1, k2 in sorted((k1, k2) for k1 in entries for k2 in entries
                      if k1[0] and k2[0] and k1[1:] == k2[1:] and k1[0] < k2[0]):
        if k1 in entries and k2 in entries and misdated(k1[0], k2[0]) and len(sides[k1]) == len(sides[k2]) == 1 \
                and sides[k1] != sides[k2] and None not in top(k1) and top(k1) == top(k2):
            del entries[k2]
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
        if sa is not None and sb is not None and ((r == "W" and sa < sb) or (r == "L" and sa > sb)):
            sa, sb = sb, sa  # score entered backwards (e.g. a "Win 1-2"): trust the result
        rec[a].append(dict(date=dt, opp=b, res=r, gf=sa, ga=sb, home=home == a, ff=ff))
        if b in std:
            rec[b].append(dict(date=dt, opp=a, res=FLIP[r], gf=sb, ga=sa, home=home == b, ff=ff))

    # Remaining schedule: unplayed games not already reported. A postponed game is dropped
    # once the same matchup appears again later (rescheduled or played).
    pairs = collections.defaultdict(list)
    for dt, a, b in list(entries) + list(unplayed):
        pairs[(a, b)].append(dt)
    today = now_et().date().isoformat()
    upcoming = collections.defaultdict(list)
    stale = (now_et().date() - datetime.timedelta(days=7)).isoformat()
    for (dt, a, b), (home, postponed) in unplayed.items():
        if (dt, a, b) in entries:
            continue
        # A game whose date has passed without a result is dropped if the same matchup appears again later
        # (rescheduled) or if it is more than a week old (cancelled or never reported); otherwise "pending"
        if (postponed or dt < today) and any(d > dt for d in pairs[(a, b)]):
            continue
        if dt < stale:
            continue
        status = "postponed" if postponed else ("pending" if dt < today else "scheduled")
        extra = {"time": times[(dt, a, b)]} if (dt, a, b) in times else {}
        upcoming[a].append(dict(date=dt, opp=b, home=home == a, status=status, **extra))
        if b in std:
            upcoming[b].append(dict(date=dt, opp=a, home=home == b, status=status, **extra))

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


def official_records(teams, standings):
    """Records from MPSSAA's standings (winning-percentage seeding). They leave out each team's one extra tournament
    and city, county or conference championship games (the bulletin's seeding rule), which the game rows don't mark.
    Every game still counts for the rating; W/L/T/gp, the projected record and the title-odds simulation's seeding
    (seed_adj) use the official record. all_games keeps the record of every game. Returns how many teams changed."""
    off = {t["school"]: tuple(t.get(k) or 0 for k in ("wins", "losses", "ties"))
           for rs in standings["classifications"].values() for r in rs for t in r["teams"]}
    changed = 0
    for t in teams:
        if t["school"] not in off or off[t["school"]] == (t["W"], t["L"], t["T"]):
            continue
        d = dict(zip("WLT", (o - t[k] for o, k in zip(off[t["school"]], "WLT"))))
        t["all_games"] = {k: t[k] for k in ("W", "L", "T", "gp")}
        for k in "WLT":
            t[k] += d[k]
            if t.get("proj"):
                t["proj"][k] += d[k]
        t["gp"] += sum(d.values())
        if t.get("proj"):
            t["proj"]["gp"] += sum(d.values())
        t["seed_adj"] = {"w": d["W"] + .5 * d["T"], "gp": sum(d.values())}
        changed += 1
    return changed


def project(raw_games, standings, class_pts, teams, first_meeting_only, wins, last_date, key="proj"):
    """Records and MPSSAA points as if every remaining (non-postponed) game through last_date went to the favorite;
    wins(team, opponent, team_home) says whether `team` is favored. Adds t[key] to each team."""
    extra = []
    for t in teams:
        for u in t["upcoming"]:
            if u["status"] == "postponed" or u["date"] > last_date or (u["member"] and u["opp"] < t["school"]):
                continue  # each member-vs-member game once
            won = wins(t["school"], u["opp"], u["home"])
            extra.append(dict(school=t["school"], opponent=u["opp"], result="Win" if won else "Loss",
                              your_score=None, opponent_score=None, game_date=u["date"], projected=True))
    projected = {p["school"]: p for p in rank_sport(raw_games + extra, standings, class_pts, first_meeting_only)}
    for t in teams:
        p = projected[t["school"]]
        t[key] = {k: p[k] for k in ("W", "L", "T", "gp", "pts", "avg")}


def realign(standings, sport, nonce):
    """Standings with each school's class and region taken from another sport's standings (this season's alignment),
    for a sport whose own standings are still last season's. Schools the other sport doesn't have keep theirs."""
    other = {t["school"]: (c, r["region"]) for c, rs in json.loads(curl(f"{API}standings?sport={sport}", nonce))["classifications"].items()
             for r in rs for t in r["teams"]}
    groups = collections.defaultdict(list)
    for c, rs in standings["classifications"].items():
        for r in rs:
            for t in r["teams"]:
                groups[other.get(t["school"], (c, r["region"]))].append(dict(school=t["school"]))
    out = collections.defaultdict(list)
    for (c, reg), ts in sorted(groups.items()):
        out[c].append(dict(region=reg, teams=ts))
    return dict(standings, classifications=dict(out))


def arbiter_games(raw, standings, gender, cfg):
    """Upcoming games from ArbiterLive while MPSSAA has few of the season's games scheduled (it is the
    official source, so once its schedule is posted ArbiterLive is not used)."""
    today = now_et().date().isoformat()
    if sum(1 for x in raw if not x["result"] and (x["game_date"] or "") >= today) >= 100:
        return []
    names = {t["school"] for rs in standings["classifications"].values() for r in rs for t in r["teams"]}
    try:
        arbiter.match(sorted(names), {})   # only searches schools not yet matched
        schools, _ = match_schools(names)
        rows, n = arbiter.upcoming(names, gender, datetime.date.fromisoformat(cfg["season_start"]), today,
                                   {v: k for k, v in DIRECTORY_NAME.items()} | ALIAS, {k: v["county"] for k, v in schools.items()})
        print(f"  ArbiterLive: {len(rows)} upcoming game entries from {n} teams")
        return rows
    except Exception as e:
        print("  ArbiterLive schedules skipped:", e)
        return []


def preseason(cfg):
    """Hold dates for a sport with rank_date / project_date: no rankings or game predictions before rank_date, no
    projected brackets or odds before project_date. Returns {"ranks": d, "proj": d}, each None once that date arrives."""
    if not cfg.get("rank_date"):
        return {}
    today = now_et().date().isoformat()
    return dict(ranks=None if today >= cfg["rank_date"] else cfg["rank_date"],
                proj=None if today >= cfg["project_date"] else cfg["project_date"])


def build_site(key, cfg, nonce, stamp):
    out = ROOT / cfg["out"]
    out.mkdir(parents=True, exist_ok=True)
    root = "../" * (len(pathlib.Path(cfg["out"]).parts) - 1)  # path from this site back to site/
    sports = {}
    for div, d in cfg["divisions"].items():
        raw, standings = fetch(d["api"], nonce)
        stale = False
        if cfg.get("season_start"):
            raw = [x for x in raw if (x["game_date"] or "") >= cfg["season_start"]]   # drop last season's games
            # Standings with games played but no results this season are last season's: use this season's alignment
            stale = not any(x["result"] for x in raw) and any(t["games_played"] for rs in standings["classifications"].values()
                                                               for r in rs for t in r["teams"])
            if stale and cfg.get("alignment"):
                standings = realign(standings, f'{d["gender"].lower()}-{cfg["alignment"]}', nonce)
        if cfg.get("arbiter"):
            raw += arbiter_games(raw, standings, d["gender"].lower(), cfg)
        # A result entered without a date takes the date of the same matchup's only dated entry (the other school's)
        dated = collections.defaultdict(set)
        for x in raw:
            if x["game_date"]:
                dated[frozenset((x["school"], x["opponent"]))].add(x["game_date"])
        for x in raw:
            ds = dated[frozenset((x["school"], x["opponent"]))]
            if not x["game_date"] and len(ds) == 1:
                x["game_date"] = next(iter(ds))
        raw = [x for x in raw if x["game_date"] not in cfg.get("uncounted_dates", [])]
        fill_scores(raw, SCORE_FIXES.get(key, {}))
        teams = rank_sport(raw, standings, cfg["classes"], cfg.get("first_meeting_only", False))
        for t in teams:
            t["slug"] = slug(t["school"])   # the team's own page: /<sport>/<slug>/
        sports[div] = dict(teams=teams, through=max((g["date"] for t in teams for g in t["games"]), default=None))
        if cfg.get("brackets") and (bracket := official_bracket(cfg, d["api"], teams, nonce)):
            sports[div]["bracket"] = bracket
            print(f"  Official bracket: {sum(1 for g in bracket['games'] if g['completed'])} of {len(bracket['games'])} games played")
        hold = sports[div]["hold"] = preseason(cfg)
        if cfg.get("olr"):
            ratings, home, class_means = oldline.rate(teams, cfg["olr"], list(cfg["classes"]))
            assign_ranks(teams)
            project(raw, standings, cfg["classes"], teams, cfg.get("first_meeting_only", False),
                    lambda a, b, a_home: oldline.win_prob(ratings[a], ratings[b], 1 if a_home else -1, home, cfg["olr"]["k"]) >= .5,
                    cfg["playoffs"]["last_date"])
            if cfg["playoffs"]["seed_by"] == "winpct" and not stale:
                print(f"  Official MPSSAA records: {official_records(teams, standings)} teams differ from their games")
            if hold.get("proj") is None:   # title odds only once projections are live
                oldline.simulate(teams, cfg["classes"], ratings, home, cfg["olr"], cfg["playoffs"], cfg["regions"],
                                 official=sports[div].get("bracket"))
            members = {t["school"] for t in teams}
            sports[div]["nonmember"] = {x: round(v, 2) for x, v in ratings.items() if x not in members}
            sports[div]["home"] = round(home, 2)
            # For the drawer's rating breakdown: each class's average and the non-member average
            sports[div]["classMeans"] = {k: round(v, 3) for k, v in class_means.items()}
        elif cfg.get("playoffs"):
            # No game-prediction model: the higher-rated team wins; members beat non-members
            rating = {t["school"]: t["rating"] for t in teams}
            project(raw, standings, cfg["classes"], teams, cfg.get("first_meeting_only", False),
                    lambda a, b, a_home: b not in rating or rating[a] >= rating[b], cfg["playoffs"]["last_date"])
        print(f"{key}/{div}: {len(teams)} teams, games through {sports[div]['through']}")
    names = sorted({t["school"] for s in sports.values() for t in s["teams"]})
    schools, missing = match_schools(names, root)
    if missing:
        print("No directory match for:", missing)
    # Watch (NFHS Network) and ticket (GoFan) links are nice-to-haves: never fail the build over them
    cities = {n: s["city"] for n, s in schools.items()}
    for name, add in (("NFHS watch", nfhs.add_watch_links), ("GoFan ticket", gofan.add_ticket_links)):
        try:
            add(sports, cfg["divisions"], cfg.get("activity", cfg["sport"]), DIRECTORY_NAME, cities)
        except Exception as e:
            print(f"  {name} links skipped:", e)
    write_calendars(out, sports, cfg)
    # Every sport, for the footer switcher (paths relative to this site)
    family = dict(home=root, sports=[dict(sport=c["sport"], icon=icons.svg(c["icon"]), current=k == key,
                                          href=root + "".join(p + "/" for p in pathlib.Path(c["out"]).parts[1:]))
                                     for k, c in SITES.items()] + [c | dict(icon=icons.svg(c["icon"])) for c in COMING])
    config = {k: v for k, v in cfg.items() if k not in ("out", "divisions")} | dict(
        family=family, divisions={k: d["label"] for k, d in cfg["divisions"].items()})
    data = dict(updated=updated_et(), config=config, schools=schools, sports=sports)
    (out / "data.js").write_text("window.DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
    # Every site shares one page shell; asset links are cache-busted so browsers pick up new data/code
    page = (ROOT / "scripts" / "page.html").read_text()
    rel = "".join(p + "/" for p in pathlib.Path(cfg["out"]).parts[1:])
    description = (f"Rankings, schedules, playoff brackets and live-stream links for every Maryland public high school "
                   f"{cfg['sport'].lower()} team, Class 1A through 4A, updated nightly from MPSSAA results.")
    for k, v in dict(root=root, sport=cfg["sport"], sport_lower=cfg["sport"].lower(), favicon=icons.favicon(cfg["icon"]), stamp=stamp,
                     description=description, url=f"{SITE_URL}/{rel}", site_url=SITE_URL,
                     family=footer_sports(root, key), year=str(now_et().year)).items():
        page = page.replace("{{" + k + "}}", v)
    (out / "index.html").write_text(page)
    # A page for every team (for search engines and sharing); old team folders are cleared first
    for d in out.iterdir():
        if d.is_dir() and d.name != "cal":
            shutil.rmtree(d)
    for div, s in sports.items():
        for t in s["teams"]:
            if t["slug"] in SECTIONS or t["slug"] == "cal":
                raise SystemExit(f"Team page {t['slug']}/ would collide with a section page")
            write_team_page(out, page, cfg, div, s, t, schools, rel, description)
    pages = write_section_pages(out, page, cfg, sports, rel, description)
    print(f"Wrote {cfg['out']}/")
    return dict(cfg=cfg, sports=sports, schools=schools, pages=pages, href="/".join(pathlib.Path(cfg["out"]).parts[1:]) + "/")


def write_team_page(out, page, cfg, div, s, t, schools, rel, sport_description):
    """/<sport>/<slug>/index.html: the sport page with the team's title, description, canonical address, link
    preview and structured data, plus a plain-HTML summary and schedule (what search engines read). In the
    browser app.js replaces the summary with the full team page (window.TEAM_PAGE)."""
    school, info = t["school"], schools.get(t["school"]) or {}
    mascot, city = info.get("mascot"), info.get("city")
    sport, cls = cfg["sport"], cfg.get("labels", {}).get(t["cls"], t["cls"])
    rec = f'{t["W"]}-{t["L"]}' + (f'-{t["T"]}' if cfg.get("ties") else "")
    region_rank = [x for x in s["teams"] if x["cls"] == t["cls"] and x["region"] == t["region"]].index(t) + 1
    rating = f'{t["rating"]:+.{cfg["olr"].get("digits", 1)}f}' if cfg.get("olr") else f'{t["rating"]:.2f}'
    year = (s["through"] or now_et().date().isoformat())[:4]
    name = f"{school} {mascot}" if mascot else school
    title = f"{name} {sport} · Rankings, Schedule & Scores · Old Line Rankings"
    ranked = (s.get("hold") or {}).get("ranks") is None   # no rankings yet early in the season
    desc = (f"{school} ({cls} {t['region']}) is {rec}" + (f", #{t['rank']} in {cls} by Old Line Rating. " if ranked else ". ") +
            f"{year} {sport.lower()} schedule, scores, playoff odds and where to watch.")
    url = f"{SITE_URL}/{rel}{t['slug']}/"
    when = lambda g: datetime.date.fromisoformat(g["date"]).strftime("%b %-d")
    rows = []
    for g in t["games"]:
        rows.append(f'<tr><td>{when(g)}</td><td>{"vs" if g["home"] else "@"} {esc(g["opp"])}</td>'
                    f'<td>{g["res"]}{f" {g['gf']}–{g['ga']}" if g["gf"] is not None and g["ga"] is not None else (" (forfeit)" if g.get("ff") else "")}</td></tr>')
    for u in t["upcoming"]:
        if u["status"] == "postponed":
            continue
        extra = (f' · {u["time"]}' if u.get("time") else "") + (f' · <a href="{esc(u["watch"])}">Watch on NFHS Network</a>' if u.get("watch") else "")
        rows.append(f'<tr><td>{when(u)}</td><td>{"vs" if u["home"] else "@"} {esc(u["opp"])}</td><td>Upcoming{extra}</td></tr>')
    static = (f'<article class="wrap seo"><h1>{esc(name)} {esc(sport)}</h1><p>{esc(desc)}</p>'
              + (f'<p>Record {rec} · Old Line Rating {rating} · #{t["rank"]} in {esc(cls)} · #{region_rank} in {esc(t["region"])} · '
                 f'#{t["stateRank"]} statewide{f" · {esc(city)}" if city else ""}</p>' if ranked else
                 f'<p>Record {rec} · {esc(cls)} {esc(t["region"])}{f" · {esc(city)}" if city else ""}</p>') +
              f'<h2>{year} schedule and results</h2><table>{"".join(rows)}</table></article>')
    team_ld = {"@type": "SportsTeam", "name": f"{name} {sport}"}
    ld = {"@context": "https://schema.org", **team_ld, "sport": cfg.get("activity", sport), "url": url,
          "memberOf": {"@type": "SportsOrganization", "name": "Maryland Public Secondary Schools Athletic Association (MPSSAA)"},
          "event": [{"@type": "SportsEvent", "name": f'{u["opp"] if u["home"] else school} at {school if u["home"] else u["opp"]}',
                     "startDate": u["date"] + (f'T{u["time"]}' if u.get("time") else ""), "sport": cfg.get("activity", sport),
                     "homeTeam": {"@type": "SportsTeam", "name": school if u["home"] else u["opp"]},
                     "awayTeam": {"@type": "SportsTeam", "name": u["opp"] if u["home"] else school},
                     "location": {"@type": "Place", "name": school if u["home"] else u["opp"]}}
                    for u in t["upcoming"] if u["status"] != "postponed"]}
    if city:
        ld["location"] = {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": city, "addressRegion": "MD"}}
    html_out = page_variant(page, cfg, rel, sport_description, t["slug"] + "/", title, desc, f"{name} {sport}", static,
                            f'<script type="application/ld+json">{json.dumps(ld)}</script>')
    html_out = html_out.replace('<script src="data.js', f'<script>window.TEAM_PAGE = {json.dumps(dict(g=div, school=school))};</script>\n<script src="data.js', 1)
    (out / t["slug"]).mkdir(exist_ok=True)
    (out / t["slug"] / "index.html").write_text(html_out)


def page_variant(page, cfg, rel, sport_description, path, title, desc, og_title, static, head="", canonical=None):
    """The sport page served at /<sport>/<path>: its own title, description, canonical address and link preview,
    plus plain-HTML content for search engines (app.js replaces it). <base> keeps links relative to the sport."""
    sport_url, url = f"{SITE_URL}/{rel}", f"{SITE_URL}/{rel}{canonical or path}"
    html_out = page.replace("<head>\n", f'<head>\n<base href="{"../" * path.count("/")}">\n', 1)
    html_out = re.sub(r"<title>.*?</title>", f"<title>{esc(title)}</title>", html_out, count=1)
    html_out = html_out.replace(f'content="{sport_description}"', f'content="{esc(desc)}"')
    html_out = html_out.replace(f'href="{sport_url}"', f'href="{url}"').replace(f'content="{sport_url}"', f'content="{url}"')
    html_out = html_out.replace(f'<meta property="og:title" content="Old Line {cfg["sport"]} Rankings">', f'<meta property="og:title" content="{esc(og_title)}">')
    if head:
        html_out = html_out.replace("</head>", head + "\n</head>", 1)
    return html_out.replace('<main id="app"></main>', f'<main id="app">{static}</main>', 1)


# The app's sections, each with its own address (/<sport>/rankings/3a/ etc.; app.js SECTIONS); team slugs can't use these
SECTIONS = ("rankings", "schedule", "playoffs", "how-it-works")


def hold_text(date):
    """'Rankings start December 15, once teams have a few games played.'"""
    return f"Rankings start {datetime.date.fromisoformat(date):%B %-d}, once teams have a few games played."


def write_section_pages(out, page, cfg, sports, rel, sport_description):
    """Real pages for the app's sections (rankings overall and by class, schedule, playoffs by class, how it works),
    each with its own title and description and, for rankings, a plain ranked list linking every team's page."""
    sport, lower = cfg["sport"], cfg["sport"].lower()
    label = lambda c: cfg.get("labels", {}).get(c, c)
    cslug = lambda c: c.lower().replace("_", "-")
    rated = lambda t: f'{t["rating"]:+.{cfg["olr"].get("digits", 1)}f}' if cfg.get("olr") else f'{t["rating"]:.2f}'
    rec = lambda t: f'{t["W"]}-{t["L"]}' + (f'-{t["T"]}' if cfg.get("ties") else "")
    teams = [t for s in sports.values() for t in s["teams"]]
    held = next((s["hold"]["ranks"] for s in sports.values() if (s.get("hold") or {}).get("ranks") is not None), None)

    def ranked(ts, key):
        if held is not None:
            return f"<p>{esc(hold_text(held))}</p>"
        return "<ol>" + "".join(f'<li><a href="{t["slug"]}/">{esc(t["school"])}</a> ({esc(label(t["cls"]))} {esc(t["region"])}) '
                                f'{rec(t)} · Old Line Rating {rated(t)}</li>' for t in sorted(ts, key=lambda t: t[key])) + "</ol>"
    pages = []   # (path, title, description, h1, body, canonical)
    pages.append(("rankings/", f"Maryland {sport} Rankings, All Classes · Old Line Rankings",
                  f"Every Maryland public high school {lower} team, 1A through 4A, ranked statewide by Old Line Rating. Updated nightly from MPSSAA results.",
                  f"Maryland {sport} Rankings", ranked(teams, "stateRank"), None))
    for c in cfg["classes"]:
        pages.append((f"rankings/{cslug(c)}/", f"Maryland {label(c)} {sport} Rankings · Old Line Rankings",
                      f"Class {label(c)} Maryland public high school {lower} rankings by Old Line Rating, with records, strength of schedule and region standings. Updated nightly.",
                      f"Maryland {label(c)} {sport} Rankings", ranked([t for t in teams if t["cls"] == c], "rank"), None))
    pages.append(("schedule/", f"Maryland {sport} Schedule & Scores · Old Line Rankings",
                  f"Every Maryland public high school {lower} game: scores, upcoming games, live streams on NFHS Network and tickets.",
                  f"Maryland {sport} Schedule & Scores", "", None))
    if cfg.get("playoffs"):
        for i, c in enumerate(cfg["classes"]):
            p = (f"playoffs/{cslug(c)}/", f"Maryland {label(c)} {sport} Playoff Picture · Old Line Rankings",
                 f"Class {label(c)} Maryland {lower} playoff picture: region seeds and brackets as they stand today, plus projections and title odds from Old Line Ratings.",
                 f"Maryland {label(c)} {sport} Playoff Picture", "", None)
            pages.append(p)
            if i == 0:   # /playoffs/ shows the top class
                pages.append(("playoffs/",) + p[1:5] + (p[0],))
    pages.append(("how-it-works/", f"How the {sport} Rankings Work · Old Line Rankings",
                  f"How Old Line Ratings rank Maryland high school {lower} teams, how playoff seeding works, and how the projections are made.",
                  f"How the {sport} Rankings Work", "", None))
    for path, title, desc, h1, body, canonical in pages:
        static = f'<article class="wrap seo"><h1>{esc(h1)}</h1><p>{esc(desc)}</p>{body}</article>'
        (out / path).mkdir(parents=True, exist_ok=True)
        (out / path / "index.html").write_text(
            page_variant(page, cfg, rel, sport_description, path, title, desc, title.split(" · ")[0], static, canonical=canonical))
    # The sport's home (/<sport>/): each class's top teams (every team before rankings start) and a link to every
    # section, so search engines reach the whole sport from its front page
    classes = []
    for c in cfg["classes"]:
        ts = [t for t in teams if t["cls"] == c]
        body = (ranked(sorted(ts, key=lambda t: t["rank"])[:5], "rank") if held is None else
                "<ul>" + "".join(f'<li><a href="{t["slug"]}/">{esc(t["school"])}</a> ({esc(t["region"])})</li>'
                                 for t in sorted(ts, key=lambda t: t["school"])) + "</ul>")
        classes.append(f'<h2><a href="rankings/{cslug(c)}/">Maryland {esc(label(c))} {esc(sport)} Rankings</a></h2>{body}')
    links = "".join(f'<li><a href="{path}">{esc(h1)}</a></li>' for path, _, _, h1, _, canonical in pages if not canonical)
    static = (f'<article class="wrap seo"><h1>Maryland {esc(sport)} Rankings</h1><p>{esc(sport_description)}</p>'
              + (f"<p>{esc(hold_text(held))}</p>" if held is not None else "")
              + "".join(classes) + f"<h2>More {esc(lower)}</h2><ul>{links}</ul></article>")
    (out / "index.html").write_text(page.replace('<main id="app"></main>', f'<main id="app">{static}</main>', 1))
    return [path for path, *_, canonical in pages if not canonical]


def official_bracket(cfg, api, teams, nonce):
    """MPSSAA's posted bracket (scripts/brackets.py) with its names matched to our schools, or None before seeding.
    A name we can't match keeps MPSSAA's spelling. Never fails the build."""
    try:
        b = brackets.parse(curl(API + brackets.BLOCK.format(sport=api), nonce), list(cfg["classes"]))
    except Exception as e:
        print("  Official bracket skipped:", e)
        return None
    if not brackets.posted(b):
        return None
    by_key = {school_key(t["school"]): t["school"] for t in teams}
    unmatched = set()
    for g in b["games"]:
        for t in g["teams"]:
            if t["name"] and t["name"] != "Bye":
                school = by_key.get(school_key(ALIAS.get(t["name"], t["name"])))
                if not school:
                    unmatched.add(t["name"])
                t["name"] = school or t["name"]
    if unmatched:
        print("  Bracket names with no school match:", sorted(unmatched))
    return b


def fill_scores(raw, fixes):
    """Fill in hand-entered scores (SCORE_FIXES) where MPSSAA's entry has none, or has a tied score for a game it
    calls a win or loss, from either team's side."""
    for x in raw:
        for (date, a, b), (sa, sb) in fixes.items():
            contradicts = x["your_score"] == x["opponent_score"] and x.get("result") in ("Win", "Loss")
            if x["game_date"] != date or (x["your_score"] is not None and not contradicts):
                continue
            if (x["school"], x["opponent"]) == (a, b):
                x["your_score"], x["opponent_score"] = sa, sb
            elif (x["school"], x["opponent"]) == (b, a):
                x["your_score"], x["opponent_score"] = sb, sa
            else:
                continue
            if not x.get("result"):  # no result posted either: the game counts as played, decided by the score
                x["status"] = "completed"
            home = x.get("home_team")
            if home and x.get("home_score") is None:
                x["home_score"], x["away_score"] = (x["your_score"], x["opponent_score"]) if home == x["school"] else (x["opponent_score"], x["your_score"])


def footer_sports(root, current):
    """Footer sport links in one column per season (Fall, Winter, Spring); the current site is marked."""
    sports = [dict(sport=c["sport"], season=c["season"], on=k == current,
                   href=root + "".join(p + "/" for p in pathlib.Path(c["out"]).parts[1:])) for k, c in SITES.items()]
    sports += [dict(c, on=False, href=None) for c in COMING]
    cols = []
    for season in ("Fall", "Winter", "Spring"):
        items = []
        for s in (s for s in sports if s["season"] == season):
            on = ' class="on" aria-current="page"' if s["on"] else ""
            items.append(f'<li><a href="{s["href"]}"{on}>{esc(s["sport"])}</a></li>' if s["href"] else
                         f'<li><span class="soon" title="{esc(s["note"])}">{esc(s["sport"])} <small>soon</small></span></li>')
        if items:
            cols.append(f'<div><h4>{season}</h4><ul>{"".join(items)}</ul></div>')
    return "".join(cols)


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-")


def ics_text(s):
    return str(s).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def write_calendars(out, sports, cfg):
    """One subscribable .ics per team (site/<sport>/cal/<team>.ics), rebuilt nightly, so subscribers
    get new games, start times and results. Sets t["cal"] to the file's path within the site."""
    (out / "cal").mkdir(exist_ok=True)
    multi = len(cfg["divisions"]) > 1
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for div, s in sports.items():
        label = (cfg["divisions"][div]["label"] + " " if multi else "") + cfg["sport"]
        for t in s["teams"]:
            name = slug((div + "-" if multi else "") + t["school"])
            lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Old Line Rankings//EN", "CALSCALE:GREGORIAN",
                     f"X-WR-CALNAME:{ics_text(t['school'] + ' ' + label)}", "X-WR-TIMEZONE:America/New_York"]
            for g in t["games"] + t["upcoming"]:
                home, away = (t["school"], g["opp"]) if g["home"] else (g["opp"], t["school"])
                day = datetime.date.fromisoformat(g["date"])
                if g.get("time"):
                    start = datetime.datetime.combine(day, datetime.time.fromisoformat(g["time"]))
                    when = [f"DTSTART;TZID=America/New_York:{start:%Y%m%dT%H%M%S}",
                            f"DTEND;TZID=America/New_York:{start + datetime.timedelta(hours=2):%Y%m%dT%H%M%S}"]
                else:
                    when = [f"DTSTART;VALUE=DATE:{day:%Y%m%d}", f"DTEND;VALUE=DATE:{day + datetime.timedelta(1):%Y%m%d}"]
                notes = []
                if "res" in g:
                    notes.append(f"Final: {t['school']} {g['gf'] if g['gf'] is not None else '-'}, {g['opp']} {g['ga'] if g['ga'] is not None else '-'}")
                if g.get("watch"):
                    notes.append("Watch: " + g["watch"])
                if g.get("tickets"):
                    notes.append("Tickets: " + g["tickets"])
                lines += ["BEGIN:VEVENT", f"UID:{g['date']}-{slug(home)}-{slug(away)}-{slug(label)}@oldlinerankings", f"DTSTAMP:{stamp}",
                          *when, f"SUMMARY:{ics_text(f'{label}: {away} at {home}')}", f"LOCATION:{ics_text(home)}"]
                if notes:
                    lines.append("DESCRIPTION:" + ics_text("\n".join(notes)))
                if g.get("watch"):
                    lines.append(f"URL:{g['watch']}")
                lines.append("END:VEVENT")
            lines.append("END:VCALENDAR")
            (out / "cal" / f"{name}.ics").write_text("\r\n".join(lines) + "\r\n")
            t["cal"] = f"cal/{name}.ics"


def esc(s):
    return html.escape(str(s), quote=True)


def games_of_week(b, days=7):
    """The sport's games of the week, best first: upcoming games in the next `days` days between two MPSSAA teams
    with an NFHS Network broadcast, close enough to be a real contest (favorites at most 75% by highest average
    Old Line Rating, then those up to 85%), with no team in two of them. Empty when no game qualifies."""
    cfg = b["cfg"]
    if not cfg.get("olr") or any((s.get("hold") or {}).get("ranks") is not None for s in b["sports"].values()):
        return []
    today = now_et().date()
    best = {}
    for div, s in b["sports"].items():
        teams = {t["school"]: t for t in s["teams"]}
        home_edge = s.get("home", 0)
        for t in s["teams"]:
            for u in t["upcoming"]:
                if not u.get("watch") or u["status"] != "scheduled" or u["opp"] not in teams:
                    continue
                if not today <= datetime.date.fromisoformat(u["date"]) <= today + datetime.timedelta(days):
                    continue
                home, away = (t, teams[u["opp"]]) if u["home"] else (teams[u["opp"]], t)
                key = (u["date"], home["school"], away["school"])
                p = oldline.win_prob(home["rating"], away["rating"], 1, home_edge, cfg["olr"]["k"])
                best[key] = dict(div=div, date=u["date"], time=u.get("time"), watch=u["watch"], tickets=u.get("tickets"), home=home, away=away, p=p,
                                 fav=max(p, 1 - p), strength=(home["rating"] + away["rating"]) / 2)
    ranked = sorted((g for g in best.values() if g["fav"] <= .85), key=lambda g: (g["fav"] > .75, -g["strength"]))
    picks, used = [], set()
    for g in ranked:
        if not {g["home"]["school"], g["away"]["school"]} & used:
            picks.append(g)
            used |= {g["home"]["school"], g["away"]["school"]}
    return picks


def write_splash(built, stamp):
    """site/index.html: a card per sport with its current No. 1 team(s), plus coming-soon sports."""
    cards = []
    for b in built:
        cfg, multi = b["cfg"], len(b["cfg"]["divisions"]) > 1
        through = max((s["through"] for s in b["sports"].values() if s["through"]), default=None)
        teams = sum(len(s["teams"]) for s in b["sports"].values())
        leaders = []
        for div, s in b["sports"].items():
            held = (s.get("hold") or {}).get("ranks")
            if held is not None:   # early season: no No. 1s yet
                leaders.append(f'<li class="hold">{esc(hold_text(held))}</li>')
                continue
            for c in cfg["classes"]:
                t = next((t for t in s["teams"] if t["cls"] == c), None)
                if not t:
                    continue
                logo = (b["schools"].get(t["school"]) or {}).get("logo")
                img = f'<img src="{esc(logo[3:])}" alt="" loading="lazy">' if logo else ""
                label = cfg.get("labels", {}).get(c, c) + (" " + cfg["divisions"][div]["label"] if multi else "")
                leaders.append(f'<li><span class="logo" style="--sz:26px">{img}</span><b>{esc(t["school"])}</b><small>{esc(label)}</small></li>')
        divs = " & ".join(d["label"] for d in cfg["divisions"].values()) if multi else ""
        date = through and datetime.date.fromisoformat(through).strftime("%b %-d")
        season = cfg["season"] + " " + (cfg.get("season_years") or (through or now_et().date().isoformat())[:4])
        cards.append(f'''<a class="sport-card" href="{b["href"]}">
      <div class="sport-top"><span class="sport-icon">{icons.svg(cfg["icon"])}</span><div><h2>{esc(cfg["sport"])}</h2>
        <small>{esc(" · ".join(filter(None, [divs, season, f"{teams} teams", date and f"through {date}"])))}</small></div></div>
      <ul class="leaders">{"".join(leaders)}</ul>
      <span class="sport-go">Old Line {esc(cfg["sport"])} Rankings →</span></a>''')
    coming = [f'''<div class="sport-card soon"><div class="sport-top"><span class="sport-icon">{icons.svg(c["icon"])}</span>
      <div><h2>{esc(c["sport"])}</h2><small>{esc(c["note"])}</small></div></div></div>''' for c in COMING]
    # Games of the week: one per sport, and at least 3 in all, so a sport between seasons (or out of
    # streamed games) hands its slot to the next-best games of the others
    ranked = [(b, games_of_week(b)) for b in built]
    picks = [(b, gs[0]) for b, gs in ranked if gs]
    extras = sorted(((b, g) for b, gs in ranked for g in gs[1:]), key=lambda bg: (bg[1]["fav"] > .75, -bg[1]["strength"]))
    picks += extras[:max(0, 3 - len(picks))]
    picks.sort(key=lambda bg: built.index(bg[0]))
    gotw = []
    for b, g in picks:
        cfg = b["cfg"]
        def side(t, chance):
            logo = (b["schools"].get(t["school"]) or {}).get("logo")
            img = f'<img src="{esc(logo[3:])}" alt="" loading="lazy">' if logo else ""
            rec = f'{t["W"]}-{t["L"]}' + (f'-{t["T"]}' if cfg.get("ties") else "")
            cls = cfg.get("labels", {}).get(t["cls"], t["cls"])
            # data-panel: the splash page opens this team's drawer in a side panel instead of leaving the page
            # (the plain link, for new tabs, is the team's own page)
            return (f'<a class="gw-team" href="{esc(b["href"] + t["slug"] + "/")}" data-panel="{esc(b["href"] + "?embed=1&team=" + urllib.parse.quote(t["school"]))}"><span class="logo" style="--sz:40px">{img}</span>'
                    f'<span class="gw-who"><b>{esc(t["school"])}</b><small>{esc(cls)} · #{t["rank"]} in class · {rec}</small></span>'
                    f'<span class="gw-p">{round(100 * chance)}%</span></a>')
        day = datetime.date.fromisoformat(g["date"])
        when = day.strftime("%A, %b %-d")
        if g["time"]:
            h, m = map(int, g["time"].split(":"))
            when += f' · {h % 12 or 12}:{m:02d} {"AM" if h < 12 else "PM"}'
        gotw.append(f'''<div class="gw-card">
      <div class="gw-top"><span class="gw-sport">{icons.svg(cfg["icon"])}{esc(cfg["sport"])}</span><span class="gw-when">{esc(when)}</span></div>
      {side(g["away"], 1 - g["p"])}
      <div class="gw-at">at</div>
      {side(g["home"], g["p"])}
      <div class="gw-actions"><a class="gw-watch" href="{esc(g["watch"])}" target="_blank" rel="noopener">▶ Watch on NFHS Network</a>{
        f'<a class="gw-tix" href="{esc(g["tickets"])}" target="_blank" rel="noopener" title="Tickets on GoFan" aria-label="Tickets on GoFan" data-game="{esc(g["away"]["school"] + " at " + g["home"]["school"])}" data-when="{esc(when)}">{icons.svg("ticket")}Tickets</a>' if g["tickets"] else ""}</div>
    </div>''')
    page = (ROOT / "scripts" / "splash.html").read_text()
    gotw_html = ('<section class="section"><div class="section-head"><div><div class="eyebrow">This week</div><h2>Games of the week</h2>'
                 '<p>The best matchups with a live stream, picked by Old Line Rankings.</p></div></div>'
                 f'<div class="gw-grid">{"".join(gotw)}</div></section>') if gotw else ""
    links = "".join(f'<a class="btn ghost" href="{b["href"]}">{icons.svg(b["cfg"]["icon"])}{esc(b["cfg"]["sport"])}</a>'
                    for b in built)
    # Footer: the same sport links as the sport pages, plus when results were last updated
    family = footer_sports("", None)
    updated = f'Updated {updated_et()}'
    description = ("Rankings, schedules, playoff brackets and games of the week for every Maryland public high school team: "
                   + ", ".join(b["cfg"]["sport"].lower() for b in built) + ". Updated nightly from MPSSAA results.")
    for k, v in dict(cards="\n    ".join(cards), coming="\n    ".join(coming), gotw=gotw_html, sportlinks=links, family=family, updated=updated, year=str(now_et().year),
                     description=description, site_url=SITE_URL,
                     favicon=icons.favicon(), stamp=stamp).items():
        page = page.replace("{{" + k + "}}", v)
    (ROOT / "site" / "index.html").write_text(page)
    print("Wrote site/index.html (splash)")
    # Search engines: every page's address, and where to find that list
    today = now_et().date().isoformat()
    urls = [f"{SITE_URL}/"] + [f"{SITE_URL}/{b['href']}{p}" for b in built for p in [""] + b["pages"]] + [
        f"{SITE_URL}/{b['href']}{t['slug']}/" for b in built for s in b["sports"].values() for t in s["teams"]]
    (ROOT / "site" / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod><changefreq>daily</changefreq></url>\n" for u in urls) + "</urlset>\n")
    (ROOT / "site" / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /soccer/\n\nSitemap: {SITE_URL}/sitemap.xml\n")


def get_nonce():
    """MPSSAA's scores page carries the key for its score data; it occasionally comes back without it, so retry."""
    for attempt in range(5):
        m = re.search(r'"nonce":"([a-z0-9]+)"', curl("https://www.mpssaa.org/live-scores/"))
        if m:
            return m.group(1)
        print("MPSSAA scores page had no nonce; retrying in 60s")
        time.sleep(60)
    raise SystemExit("MPSSAA scores page never returned a nonce")


def main():
    nonce = get_nonce()
    stamp = now_et().strftime("%Y%m%d%H%M%S")
    built = [build_site(key, cfg, nonce, stamp) for key, cfg in SITES.items()]
    write_splash(built, stamp)


if __name__ == "__main__":
    main()
