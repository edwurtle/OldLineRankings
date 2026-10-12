# Old Line Rankings

Static sites ranking every Maryland public high school team. A splash page at the root links to each sport:
football (4A, 4A/3A, 3A, 2A, 2A/1A, 1A) at `/football/`, boys soccer at `/boys-soccer/` and girls soccer at
`/girls-soccer/` (1A–4A);
lacrosse is listed as coming soon. Every site's footer has a sport switcher. Old soccer links (`/#/boys/4A`, `/soccer/…`)
redirect to the right soccer site.

## Rating
- **Win:** opponent class points + opponent's season wins
  - Soccer: 1A=5, 2A=6, 3A=7, 4A=8 (modeled on football's system; MPSSAA seeds soccer by winning percentage only)
  - Football: MPSSAA playoff seeding values: 4A & 4A/3A = 8, 3A & 2A = 7, 2A/1A & 1A = 6
- **Tie:** half of what a win would earn
- **Loss:** 0
- Opponent wins count their ties as half a win. Non-public / out-of-state opponents = lowest class, 0 wins.
- Football counts only the first meeting between two teams (MPSSAA football bulletin).
- Soccer's Old Line Rating = total points ÷ games played, ranked within class. For football the same formula
  is the MPSSAA points (football's Old Line Rating is margin-based; see below).
- SOS (strength of schedule) = the rating a team would have if it had won every game.

## Old Line Rating (all sports)
Every sport is ranked by the Old Line Rating (`scripts/oldline.py`): football on points (cap 28, ±4 win bonus),
soccer on goals (cap 4, no win bonus). Football keeps MPSSAA points for seeding; soccer is seeded by winning percentage.
The team drawer's "See calculation" shows every game that went into a team's rating.
- Each game counts the scoring margin capped at 28, plus 4 for a win (minus 4 for a loss).
- A team's rating is its average game value plus its opponents' average rating, solved for all teams at
  once, pulled toward its class average by 3 games' worth. Home edge is measured from the data (floored at 0).
- Rating differences work like point spreads; win chance = 1 / (1 + e^(−0.16 × difference)).
- Backtested on 2026 weeks 3–6 using only earlier games: 75% of winners picked vs 70% for MPSSAA points.

## Playoffs page (football and soccer)
Each sport seeds the way its MPSSAA bulletin says (`playoffs` in `SITES`):
- **Football:** each region's top 8 by MPSSAA points play two rounds (1v8, 4v5, 2v7, 3v6); two per region reach the Final 8.
- **Soccer:** every team is seeded in its region by winning percentage (fewer than 9 games divide by 9) and each region
  plays down to one champion; the 8 champions make the Final 8.

The Final 8 is reseeded 1–8 by the same number. The page shows each region's mini bracket, then the state bracket:
- **Current:** today's seeds and first-round matchups only; later rounds and the Final 8 bracket stay empty.
- **Projected:** the rest of the regular season and every playoff game go to the favorite and every game is shown.
  Every remaining game goes to the team with the higher Old Line Rating (football also shows each team's win chance).
- **Final 8 odds (football):** every team makes its region playoffs (regions have at most 8 teams), so odds measure how
  far it goes (Final 8, semifinals, state final, title), from 2,000 simulated seasons and playoffs.

## Watch links
`scripts/nfhs.py` matches schools to NFHS Network (by name, county suffix removed, city as tiebreak) and each game to
a varsity broadcast by sport, gender, date (±1 day) and both schools. Games with a broadcast get a ▶ Watch button in
the team drawer (live or replay). If NFHS can't be reached the build continues without watch links.

## Layout
- `site/` — the deployable site: splash `index.html` and shared `app.js`, `flag.js`, `styles.css`, `logos/`
- `site/football/`, `site/boys-soccer/`, `site/girls-soccer/` — each site's `index.html`, `data.js` and `cal/` team calendars
- `site/soccer/` — redirect for old soccer links
- `scripts/build.py` — fetches results and writes each site's `data.js` and `index.html`. Sport differences
  (divisions, classes and points, regions, labels) live in its `SITES` config and are passed to `app.js`.
- `scripts/page.html` — page template for every sport; `scripts/splash.html` — splash template
  (edit these, not the generated `index.html` files). Add coming-soon sports to `COMING` in `build.py`.
- `scripts/oldline.py` — Old Line Rating and simulations; `scripts/nfhs.py` — watch links; `scripts/icons.py` — sport icons
- `scripts/schools.py` — downloads school logos, mascots and counties (needs Pillow: `.venv`)

## Update
```sh
python3 scripts/build.py              # refresh results for both sites (run anytime)
.venv/bin/python scripts/schools.py   # refresh logos/school info (rarely needed)
```

## View
Serve it: `python3 -m http.server -d site 8000` → http://localhost:8000 (splash), `/soccer/`, `/football/`

## Hosting
Deployed to GitHub Pages by `.github/workflows/deploy.yml`, which runs nightly (and on every push to `main`),
fetches fresh results with `scripts/build.py`, commits the updated data for both sites, and publishes `site/`.
Refresh on demand: `gh workflow run deploy.yml`.
