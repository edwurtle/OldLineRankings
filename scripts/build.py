#!/usr/bin/env python3
"""Fetch boys & girls soccer results and write site/data.js with power rankings.

Power points per game:
  win  = opponent class number (1A=1 .. 4A=4) + opponent's season wins
  tie  = half of what a win would have earned
  loss = 0
Opponent "wins" count each of the opponent's ties as half a win. Opponents outside
the state association count as class 1 with 0 wins. Teams are ranked by average
power points per game played. Strength of schedule (SOS) is the average a team
would have earned had it won every game.
"""
import collections, datetime, json, pathlib, re, subprocess

API = "https://www.mpssaa.org/wp-json/smartsheet-sports/v1/"
ROOT = pathlib.Path(__file__).resolve().parent.parent
SPORTS = {"boys": "boys-soccer", "girls": "girls-soccer"}

# Opponent spellings that refer to member schools
ALIAS = {"Mt. Hebron": "Mount Hebron", "Flowers HS": "Charles H. Flowers", "Wise HS": "Dr. Henry A. Wise",
         "Northern HS": "Northern-C", "NAF": "National Academy Foundation (NAF)"}
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


def rank_sport(raw_games, standings):
    std = {t["school"]: {"cls": c, "region": r["region"]}
           for c, rs in standings["classifications"].items() for r in rs for t in r["teams"]}

    def norm(name):
        name = name.strip()
        if name in ALIAS:
            return ALIAS[name]
        bare = re.sub(r"\s+HS$", "", name)
        return bare if bare in std else name

    # Games are listed under the home team; some are entered twice. Dedupe by
    # (date, teams) and take the most common result when entries disagree.
    entries = collections.defaultdict(list)
    for x in raw_games:
        r = RES.get(x["result"])
        if not r:
            continue
        a, b = norm(x["school"]), norm(x["opponent"])
        sa, sb, home = x["your_score"], x["opponent_score"], a
        if b in std and b < a:
            a, b, r, sa, sb = b, a, FLIP[r], sb, sa
        entries[(x["game_date"], a, b)].append((r, sa, sb, home, x["result"].startswith("Forfeit")))
    rec = collections.defaultdict(list)
    for (dt, a, b), es in entries.items():
        r, sa, sb, home, ff = collections.Counter(es).most_common(1)[0][0]
        rec[a].append(dict(date=dt, opp=b, res=r, gf=sa, ga=sb, home=home == a, ff=ff))
        if b in std:
            rec[b].append(dict(date=dt, opp=a, res=FLIP[r], gf=sb, ga=sa, home=home == b, ff=ff))

    record = {s: {k: sum(g["res"] == k for g in rec[s]) for k in "WLT"} for s in std}
    opp_wins = {s: r["W"] + 0.5 * r["T"] for s, r in record.items()}
    teams = []
    for s, info in std.items():
        games = []
        for g in sorted(rec[s], key=lambda g: g["date"]):
            member = g["opp"] in std
            cp = int(std[g["opp"]]["cls"][0]) if member else 1
            ow = opp_wins[g["opp"]] if member else 0
            mult = {"W": 1, "T": 0.5, "L": 0}[g["res"]]
            games.append(dict(g, member=member, cp=cp * mult, ow=ow * mult, pts=(cp + ow) * mult, max=cp + ow))
        gp = len(games)
        total = sum(g["pts"] for g in games)
        teams.append(dict(school=s, cls=info["cls"], region=info["region"], **record[s], gp=gp, pts=total,
                          avg=round(total / gp, 4) if gp else 0,
                          # Strength of schedule: average points per game had every game been a win
                          sos=round(sum(g["max"] for g in games) / gp, 4) if gp else 0,
                          gf=sum(g["gf"] or 0 for g in games), ga=sum(g["ga"] or 0 for g in games),
                          games=games))
    teams.sort(key=lambda t: (-t["avg"], -t["pts"]))
    for i, t in enumerate(teams, 1):
        t["stateRank"] = i
    for i, t in enumerate(sorted(teams, key=lambda t: -t["sos"]), 1):
        t["sosStateRank"] = i
    for c in {t["cls"] for t in teams}:
        for i, t in enumerate([t for t in teams if t["cls"] == c], 1):
            t["rank"] = i
        for i, t in enumerate(sorted((t for t in teams if t["cls"] == c), key=lambda t: -t["sos"]), 1):
            t["sosRank"] = i
    return teams


# Results/standings name -> school directory name, where they differ beyond punctuation
DIRECTORY_NAME = {
    "ACCE": "Academy for College & Career Exploration (ACCE)", "Baltimore Polytechnic": "Baltimore Polytechnic Institute",
    "Bethesda-CC": "Bethesda-Chevy Chase", "CMIT - North": "Chesapeake Math & IT Academy – North",
    "CMIT - South": "Chesapeake Math & IT Academy – South", "Carver A&T": "Carver Center for Arts & Technology",
    "Charles H. Flowers": "Charles Herbert Flowers", "Col. Zadok Magruder": "Colonel Zadok Magruder",
    "Dr. Henry A. Wise": "Dr. Henry A. Wise, Jr.", "Eastern Tech": "Eastern Technical",
    "Gov. Thomas Johnson": "Governor Thomas Johnson", "Harford Tech": "Harford Technical", "Mardela": "Mardela Jr./Sr.",
    "McDonough": "Maurice J. McDonough", "Mergenthaler": "Mergenthaler Vocational-Technical",
    "North East-C": "North East", "Northeast-AA": "Northeast", "Northern-C": "Northern-Cal",
    "Northern-G": "Northern-Garrett", "Northwood": "Northwood \n(@ Woodward)", "Reginald Lewis": "Reginald F. Lewis",
    "Southern-G": "Southern-Garrett", "St. Charles": "Saint Charles", "St. Michael's": "Saint Michaels",
    "Western Tech": "Western School of Technology & Environmental Science", "Western-B": "Western",
}


def school_key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower().replace("&", "and"))


def match_schools(team_names):
    directory = json.loads((ROOT / "scripts" / "cache" / "schools.json").read_text())
    by_key = {school_key(s["name"]): s for s in directory}
    out, missing = {}, []
    for n in team_names:
        s = by_key.get(school_key(DIRECTORY_NAME.get(n, n)))
        if not s:
            missing.append(n)
            continue
        city = (s.get("address") or "").split(",")[-1].strip()
        out[n] = dict(logo=s.get("logo"), color=s.get("color"), mascot=s.get("mascot"),
                      county=s.get("school_system"), city=re.sub(r"\s*\d{5}.*$", "", city) or None)
    return out, missing


def main():
    page = curl("https://www.mpssaa.org/live-scores/")
    nonce = re.search(r'"nonce":"([a-z0-9]+)"', page).group(1)
    sports = {}
    for key, sport in SPORTS.items():
        teams = rank_sport(*fetch(sport, nonce))
        sports[key] = dict(teams=teams, through=max(g["date"] for t in teams for g in t["games"]))
        print(f"{key}: {len(teams)} teams, games through {sports[key]['through']}")
    names = sorted({t["school"] for s in sports.values() for t in s["teams"]})
    schools, missing = match_schools(names)
    if missing:
        print("No directory match for:", missing)
    data = dict(updated=datetime.datetime.now().strftime("%b %-d, %Y"), schools=schools, sports=sports)
    (ROOT / "site" / "data.js").write_text("window.DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
    # Cache-bust asset links so browsers pick up new data/code after a rebuild
    index = ROOT / "site" / "index.html"
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    index.write_text(re.sub(r'(href="styles\.css|src="data\.js|src="app\.js)(\?v=\d+)?"', rf'\1?v={stamp}"', index.read_text()))
    print("Wrote site/data.js")


if __name__ == "__main__":
    main()
