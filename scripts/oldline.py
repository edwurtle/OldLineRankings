"""Old Line Ranking (OLR) and season/playoff simulation for football.

OLR is a margin-based rating: each game is worth the capped point margin plus a bonus for the
win (minus for the loss). Ratings are solved jointly so that, across a team's games,
    game value ≈ team rating − opponent rating + home edge
i.e. a team's rating is its average game value plus its opponents' average rating. Each rating is
pulled toward its class average by `prior` games' worth (so early-season ratings aren't driven by
one or two results); non-member opponents get their own group. Class averages are in turn pulled
toward an evenly spaced ladder (4A > 4A/3A > 3A > 2A > 2A/1A > 1A, step fitted from the data) by
`ladder` games' worth, because classes mostly play their own and neighbouring classes: the few
cross-class games alone leave the gaps between classes noisy. Ratings are centred so the average
member team is 0, and a rating difference is roughly a point spread.

Win probability for a game is logistic in the rating difference (scale `k`, fitted by backtesting
earlier weeks). Seeding still uses MPSSAA points; OLR only decides who is likely to win.
"""
import collections, math, random


def game_value(g, cfg):
    sign = {"W": 1, "L": -1, "T": 0}[g["res"]]
    margin = 0 if g["ff"] or g["gf"] is None else max(-cfg["cap"], min(cfg["cap"], g["gf"] - g["ga"]))
    return margin + cfg["win_bonus"] * sign


def rate(teams, cfg, class_order, iters=200):
    """Set t["rating"] (OLR) and t["sos"] (average opponent OLR). class_order is highest class first.
    Returns (ratings incl. non-members, home edge)."""
    cls = {t["school"]: t["cls"] for t in teams}
    rung = {c: (len(class_order) - 1) / 2 - i for i, c in enumerate(class_order)}  # 4A +2.5 .. 1A -2.5
    step = 0.0
    games = []  # (team, opp, value, +1 home / -1 away), each game once
    for t in teams:
        for g in t["games"]:
            if not g["member"] or t["school"] < g["opp"]:
                games.append((t["school"], g["opp"], game_value(g, cfg), 1 if g["home"] else -1))
    by = collections.defaultdict(list)
    for a, b, v, s in games:
        by[a].append((b, v, s))
        by[b].append((a, -v, -s))
    group = {x: cls.get(x, "nonmember") for x in by}
    u = dict.fromkeys(by, 0.0)            # team's offset from its group
    mean = collections.defaultdict(float)  # group (class) average
    home = 0.0
    r = lambda x: mean[group[x]] + u[x]
    for _ in range(iters):
        for x, gl in by.items():
            u[x] = sum(v + r(o) - home * s - mean[group[x]] for o, v, s in gl) / (len(gl) + cfg["prior"])
        for k in set(group.values()):
            num = sum(v + r(o) - home * s - u[x] for x in by if group[x] == k for o, v, s in by[x])
            den = sum(len(by[x]) for x in by if group[x] == k)
            if k in rung:
                mean[k] = (num + cfg["ladder"] * step * rung[k]) / (den + cfg["ladder"])
            else:
                mean[k] = num / (den + 1)
        step = sum(rung[k] * mean[k] for k in mean if k in rung) / sum(rung[k] ** 2 for k in mean if k in rung)
        # Home edge measured from the data, but never negative (an away "advantage" is noise)
        home = max(0.0, sum(s * (v - r(a) + r(b)) for a, b, v, s in games) / max(1, len(games)))
        centre = sum(r(x) for x in by if x in cls) / max(1, sum(x in cls for x in by))
        for k in mean:
            mean[k] -= centre
    nonmember = mean["nonmember"] if "nonmember" in mean else 0.0
    # Unrated non-members (no games yet) get the non-member average
    ratings = collections.defaultdict(lambda: nonmember, {x: r(x) for x in by})
    for t in teams:
        t["rating"] = round(ratings.get(t["school"], mean.get(t["cls"], 0.0)), 2)
        opps = [ratings[g["opp"]] for g in t["games"]]
        t["sos"] = round(sum(opps) / len(opps), 2) if opps else 0
    return ratings, home


def win_prob(ra, rb, home_sign, home, k):
    """Chance team A beats team B; home_sign is +1 if A is home, -1 if away, 0 neutral."""
    return 1 / (1 + math.exp(-k * (ra - rb + home * home_sign)))


def mpssaa_points(results, member, class_pts):
    """MPSSAA points and games played from (a, b, result for a) tuples (same rules as build.rank_sport)."""
    low = min(class_pts.values())
    wins, gp, pts = collections.Counter(), collections.Counter(), collections.Counter()
    for a, b, res in results:
        gp[a] += 1
        gp[b] += 1
        wins[a] += {"W": 1, "T": .5, "L": 0}[res]
        wins[b] += {"W": 0, "T": .5, "L": 1}[res]
    for a, b, res in results:
        for x, o, mult in ((a, b, {"W": 1, "T": .5, "L": 0}[res]), (b, a, {"W": 0, "T": .5, "L": 1}[res])):
            if mult and x in member:
                pts[x] += mult * ((class_pts[member[o]["cls"]] + wins[o]) if o in member else low)
    return pts, gp


def simulate(teams, class_pts, ratings, home, cfg, playoffs, regions, n=2000, seed=1):
    """Play out the rest of the regular season and the playoffs n times. Regular-season and playoff
    games are decided by OLR win probability; seeding uses MPSSAA points. Sets t["odds"], the percentage
    chance to reach each stage: f8 = Final 8 (won two region games), sf = state semifinal, fin = state
    final, champ = state champion. (Every team makes its region playoffs: regions have at most 8 teams.)"""
    rng = random.Random(seed)
    member = {t["school"]: t for t in teams}
    rating = ratings.__getitem__
    played = []  # (a, b, result for a), each game once
    for t in teams:
        for g in t["games"]:
            if not g["member"] or t["school"] < g["opp"]:
                played.append((t["school"], g["opp"], g["res"]))
    remaining = []  # (a, b, a home?)
    for t in teams:
        for x in t["upcoming"]:
            if x["status"] != "postponed" and (not x["member"] or t["school"] < x["opp"]):
                remaining.append((t["school"], x["opp"], x["home"]))
    tally = {s: collections.Counter() for s in member}

    def play(a, b):  # a is the higher seed and hosts
        return a if rng.random() < win_prob(rating(a), rating(b), 1, home, cfg["k"]) else b

    def bracket(seeds, rounds):
        """seeds: list best-first. Standard 1v8, 4v5, 2v7, 3v6 bracket; a missing seed is a bye.
        Returns the survivors after each round."""
        slots = [seeds[i - 1] if i <= len(seeds) else None for i in (1, 8, 4, 5, 2, 7, 3, 6)]
        rank = {s: i for i, s in enumerate(seeds)}
        survivors = []
        for _ in range(rounds):
            nxt = []
            for a, b in zip(slots[::2], slots[1::2]):
                if a is None or b is None:
                    nxt.append(a or b)
                else:
                    hi, lo = (a, b) if rank[a] < rank[b] else (b, a)
                    nxt.append(play(hi, lo))
            slots = nxt
            survivors.append([s for s in slots if s])
        return survivors

    for _ in range(n):
        results = list(played)
        for a, b, a_home in remaining:
            p = win_prob(rating(a), rating(b), 1 if a_home else -1, home, cfg["k"])
            results.append((a, b, "W" if rng.random() < p else "L"))
        pts, gp = mpssaa_points(results, member, class_pts)
        order = lambda s: (-(pts[s] / gp[s] if gp[s] else 0), -pts[s])
        for c in class_pts:
            final8 = []
            for reg in regions:
                seeds = sorted((s for s, t in member.items() if t["cls"] == c and t["region"] == reg), key=order)
                final8 += bracket(seeds[:playoffs["region_seeds"]], 2)[-1]
            final8.sort(key=order)
            for stage, survivors in zip(("f8", "sf", "fin", "champ"), [final8] + bracket(final8, 3)):
                for s in survivors:
                    tally[s][stage] += 1
    for s, t in member.items():
        t["odds"] = {k: round(100 * tally[s][k] / n, 1) for k in ("f8", "sf", "fin", "champ")}
