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
import collections, datetime, html, json, pathlib, re, subprocess
import gofan, icons, nfhs, oldline

API = "https://www.mpssaa.org/wp-json/smartsheet-sports/v1/"
ROOT = pathlib.Path(__file__).resolve().parent.parent

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
    playoffs=dict(seed_by="winpct", min_games=9, region_seeds=8, per_region=1),
    # Old Line Rating as for football but on goals: margin capped at 4, no win bonus. Backtested on 2026
    # weeks 3+ (each week from earlier games): boys 73% of winners vs 70% for class+opponent-wins points;
    # girls 68% vs 70% (within noise). k is set per site below.
    olr=dict(cap=4, win_bonus=0, prior=3, ladder=50, k=1.0, digits=2, cap_note="so lopsided games don't count extra",
             example=[2, 1]),
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
        playoffs=dict(seed_by="mpssaa", region_seeds=8, per_region=2), first_meeting_only=True,
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
}

# Sports shown on the splash page and in the footer before they have a site
COMING = [dict(sport="Basketball", icon="basketball", note="Boys & girls · coming winter 2026–27"),
          dict(sport="Lacrosse", icon="lacrosse", note="Boys & girls · coming spring 2027")]

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


def project(raw_games, standings, class_pts, teams, first_meeting_only, wins, key="proj"):
    """Records and MPSSAA points as if every remaining (non-postponed) game went to the favorite;
    wins(team, opponent, team_home) says whether `team` is favored. Adds t[key] to each team."""
    extra = []
    for t in teams:
        for u in t["upcoming"]:
            if u["status"] == "postponed" or (u["member"] and u["opp"] < t["school"]):
                continue  # each member-vs-member game once
            won = wins(t["school"], u["opp"], u["home"])
            extra.append(dict(school=t["school"], opponent=u["opp"], result="Win" if won else "Loss",
                              your_score=None, opponent_score=None, game_date=u["date"]))
    projected = {p["school"]: p for p in rank_sport(raw_games + extra, standings, class_pts, first_meeting_only)}
    for t in teams:
        p = projected[t["school"]]
        t[key] = {k: p[k] for k in ("W", "L", "T", "gp", "pts", "avg")}


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
            ratings, home, class_means = oldline.rate(teams, cfg["olr"], list(cfg["classes"]))
            assign_ranks(teams)
            project(raw, standings, cfg["classes"], teams, cfg.get("first_meeting_only", False),
                    lambda a, b, a_home: oldline.win_prob(ratings[a], ratings[b], 1 if a_home else -1, home, cfg["olr"]["k"]) >= .5)
            oldline.simulate(teams, cfg["classes"], ratings, home, cfg["olr"], cfg["playoffs"], cfg["regions"])
            members = {t["school"] for t in teams}
            sports[div]["nonmember"] = {x: round(v, 2) for x, v in ratings.items() if x not in members}
            sports[div]["home"] = round(home, 2)
            # For the drawer's rating breakdown: each class's average and the non-member average
            sports[div]["classMeans"] = {k: round(v, 3) for k, v in class_means.items()}
        elif cfg.get("playoffs"):
            # No game-prediction model: the higher-rated team wins; members beat non-members
            rating = {t["school"]: t["rating"] for t in teams}
            project(raw, standings, cfg["classes"], teams, cfg.get("first_meeting_only", False),
                    lambda a, b, a_home: b not in rating or rating[a] >= rating[b])
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
    data = dict(updated=datetime.datetime.now().strftime("%b %-d, %Y"), config=config, schools=schools, sports=sports)
    (out / "data.js").write_text("window.DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
    # Every site shares one page shell; asset links are cache-busted so browsers pick up new data/code
    page = (ROOT / "scripts" / "page.html").read_text()
    for k, v in dict(root=root, sport=cfg["sport"], sport_lower=cfg["sport"].lower(), favicon=icons.favicon(cfg["icon"]), stamp=stamp).items():
        page = page.replace("{{" + k + "}}", v)
    (out / "index.html").write_text(page)
    print(f"Wrote {cfg['out']}/")
    return dict(cfg=cfg, sports=sports, schools=schools, href="/".join(pathlib.Path(cfg["out"]).parts[1:]) + "/")


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


def write_splash(built, stamp):
    """site/index.html: a card per sport with its current No. 1 team(s), plus coming-soon sports."""
    cards = []
    for b in built:
        cfg, multi = b["cfg"], len(b["cfg"]["divisions"]) > 1
        through = max(s["through"] for s in b["sports"].values() if s["through"])
        teams = sum(len(s["teams"]) for s in b["sports"].values())
        leaders = []
        for div, s in b["sports"].items():
            for c in cfg["classes"]:
                t = next((t for t in s["teams"] if t["cls"] == c), None)
                if not t:
                    continue
                logo = (b["schools"].get(t["school"]) or {}).get("logo")
                img = f'<img src="{esc(logo[3:])}" alt="" loading="lazy">' if logo else ""
                label = cfg.get("labels", {}).get(c, c) + (" " + cfg["divisions"][div]["label"] if multi else "")
                leaders.append(f'<li><span class="logo" style="--sz:26px">{img}</span><b>{esc(t["school"])}</b><small>{esc(label)}</small></li>')
        divs = " & ".join(d["label"] for d in cfg["divisions"].values()) if multi else ""
        date = datetime.date.fromisoformat(through).strftime("%b %-d")
        cards.append(f'''<a class="sport-card" href="{b["href"]}">
      <div class="sport-top"><span class="sport-icon">{icons.svg(cfg["icon"])}</span><div><h2>{esc(cfg["sport"])}</h2>
        <small>{esc(" · ".join(filter(None, [divs, cfg["season"] + " " + through[:4], f"{teams} teams", f"through {date}"])))}</small></div></div>
      <div class="leaders-head">Top Old Line Rating <span>· by class</span></div>
      <ul class="leaders">{"".join(leaders)}</ul>
      <span class="sport-go">Old Line {esc(cfg["sport"])} Rankings →</span></a>''')
    coming = [f'''<div class="sport-card soon"><div class="sport-top"><span class="sport-icon">{icons.svg(c["icon"])}</span>
      <div><h2>{esc(c["sport"])}</h2><small>{esc(c["note"])}</small></div></div></div>''' for c in COMING]
    page = (ROOT / "scripts" / "splash.html").read_text()
    for k, v in dict(cards="\n    ".join(cards), coming="\n    ".join(coming), favicon=icons.favicon(), stamp=stamp).items():
        page = page.replace("{{" + k + "}}", v)
    (ROOT / "site" / "index.html").write_text(page)
    print("Wrote site/index.html (splash)")


def main():
    page = curl("https://www.mpssaa.org/live-scores/")
    nonce = re.search(r'"nonce":"([a-z0-9]+)"', page).group(1)
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    built = [build_site(key, cfg, nonce, stamp) for key, cfg in SITES.items()]
    write_splash(built, stamp)


if __name__ == "__main__":
    main()
