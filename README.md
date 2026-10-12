# Old Line Rankings

Static sites ranking every Maryland public high school team. A splash page at the root links to each sport:
soccer (boys & girls, 1A–4A) at `/soccer/` and football (4A, 4A/3A, 3A, 2A, 2A/1A, 1A) at `/football/`;
lacrosse is listed as coming soon. Every site's footer has a sport switcher. Old soccer links at the root
(`/#/boys/4A`) redirect to `/soccer/`.

## Rating
- **Win:** opponent class points + opponent's season wins
  - Soccer: 1A=5, 2A=6, 3A=7, 4A=8
  - Football: MPSSAA playoff seeding values: 4A & 4A/3A = 8, 3A & 2A = 7, 2A/1A & 1A = 6
- **Tie:** half of what a win would earn
- **Loss:** 0
- Opponent wins count their ties as half a win. Non-public / out-of-state opponents = lowest class, 0 wins.
- Football counts only the first meeting between two teams (MPSSAA football bulletin).
- Rating = total power points ÷ games played, ranked within class.
- SOS (strength of schedule) = the rating a team would have if it had won every game.

## Old Line Rating (football)
Football is ranked by the Old Line Rating (`scripts/oldline.py`); MPSSAA points are kept for seeding.
- Each game counts the scoring margin capped at 28, plus 4 for a win (minus 4 for a loss).
- A team's rating is its average game value plus its opponents' average rating, solved for all teams at
  once, pulled toward its class average by 3 games' worth. Home edge is measured from the data (floored at 0).
- Rating differences work like point spreads; win chance = 1 / (1 + e^(−0.175 × difference)).
- Backtested on 2026 weeks 3–6 using only earlier games: 79% of winners picked vs 71% for MPSSAA points.

## Final 8 (football)
Seeds use MPSSAA points. **Current**: today's seeds; the No. 1 and No. 2 seeds in each of the 4 regions reach the
8-team state quarterfinal bracket (later rounds left open). **Projected**: the rest of the regular season and every
playoff game go to the Old Line Rating favorite, with the full bracket filled in. Playoff odds come from 2,000
simulated seasons and playoffs.

## Layout
- `site/` — the deployable site: splash `index.html` and shared `app.js`, `flag.js`, `styles.css`, `logos/`
- `site/soccer/`, `site/football/` — each sport's `index.html` + `data.js` (use the shared assets)
- `scripts/build.py` — fetches results and writes each site's `data.js` and `index.html`. Sport differences
  (divisions, classes and points, regions, labels) live in its `SITES` config and are passed to `app.js`.
- `scripts/page.html` — page template for every sport; `scripts/splash.html` — splash template
  (edit these, not the generated `index.html` files). Add coming-soon sports to `COMING` in `build.py`.
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
