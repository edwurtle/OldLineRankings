# Maryland Public High Schools · Soccer Power Rankings

Static site ranking every Maryland public high school soccer team (boys & girls, 1A–4A).

## Rating
- **Win:** opponent class (1A=1 … 4A=4) + opponent's season wins
- **Tie:** half of what a win would earn
- **Loss:** 0
- Opponent wins count their ties as half a win. Non-public / out-of-state opponents = class 1, 0 wins.
- Rating = total power points ÷ games played, ranked within class.
- SOS (strength of schedule) = the rating a team would have if it had won every game.

## Layout
- `site/` — the deployable site (`index.html`, `app.js`, `styles.css`, `data.js`, `logos/`)
- `scripts/build.py` — fetches results and writes `site/data.js`
- `scripts/schools.py` — downloads school logos, mascots and counties (needs Pillow: `.venv`)

## Update
```sh
python3 scripts/build.py              # refresh results (run anytime)
.venv/bin/python scripts/schools.py   # refresh logos/school info (rarely needed)
```

## View
Open `site/index.html` directly, or serve it: `python3 -m http.server -d site 8000` → http://localhost:8000

## Hosting
Deployed to GitHub Pages by `.github/workflows/deploy.yml`, which runs nightly (and on every push to `main`),
fetches fresh results with `scripts/build.py`, commits the updated `site/data.js`, and publishes `site/`.
Refresh on demand: `gh workflow run deploy.yml`.
