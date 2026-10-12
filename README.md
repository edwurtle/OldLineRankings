# Maryland Public High Schools · Power Rankings

Static sites ranking every Maryland public high school team: soccer (boys & girls, 1A–4A) at the root and
football (4A, 4A/3A, 3A, 2A, 2A/1A, 1A) at `/football/`. Each site's footer links to the other.

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

## Final 8 (football)
In each class, region seeds are ranked by rating. Assuming the top seeds win, the No. 1 and No. 2 seeds from each of the
4 regions reach the state quarterfinals, which are reseeded 1–8 by rating and shown as a bracket. **Current** uses ratings
as they stand today. **Projected** plays out the rest of the regular season with the higher-ranked team winning every game.

## Layout
- `site/` — the deployable site: shared `app.js`, `styles.css`, `logos/`; soccer's `index.html` + `data.js`
- `site/football/` — football's `index.html` + `data.js` (uses the shared assets)
- `scripts/build.py` — fetches results and writes each site's `data.js` and `index.html`. Sport differences
  (divisions, classes and points, regions, labels) live in its `SITES` config and are passed to `app.js`.
- `scripts/page.html` — page template for both sites (edit this, not the generated `index.html` files)
- `scripts/schools.py` — downloads school logos, mascots and counties (needs Pillow: `.venv`)

## Update
```sh
python3 scripts/build.py              # refresh results for both sites (run anytime)
.venv/bin/python scripts/schools.py   # refresh logos/school info (rarely needed)
```

## View
Open `site/index.html` directly, or serve it: `python3 -m http.server -d site 8000` → http://localhost:8000

## Hosting
Deployed to GitHub Pages by `.github/workflows/deploy.yml`, which runs nightly (and on every push to `main`),
fetches fresh results with `scripts/build.py`, commits the updated data for both sites, and publishes `site/`.
Refresh on demand: `gh workflow run deploy.yml`.
