# TODO

1. ~~**Set up the domain**~~ Done 2026-10-12: `oldlinerankings.com` registered at Cloudflare and served by Cloudflare
   Pages (project `oldlinerankings`, connected to this repo; publishes `site/` on every push). Left: redirect
   `www.` to the bare domain, and decide whether to keep or redirect the GitHub Pages copy.
2. **Set up NFHS Network affiliate links**: apply to the NFHS Network affiliate program
   (https://nfhsnetwork.playonsports.com/affiliate-program, reportedly run on Impact), then add the
   tracking-link format to the ▶ Watch buttons (all watch links are built in `site/app.js`, `watchBtn`).
3. **Full team pages** (optional): the Schedule page is done (every game, filters, search, Watch/Tickets,
   team drawers). Still to do: a full page per team with "Subscribe to schedule" (each team already has a
   nightly-rebuilt `.ics` at `t.cal`, e.g. `football/cal/quince-orchard.ics`) and per-game add-to-calendar.
4. **Search visibility (Google, other search engines, AI assistants)**: per-page titles/descriptions,
   `sitemap.xml` + `robots.txt`, structured data (schema.org SportsEvent / SportsTeam), crawlable
   per-team URLs (done: every team and section has a real, pre-rendered page),
   an `llms.txt` summary, and submit to Google Search Console / Bing Webmaster Tools once the domain is live.
5. **More playoff simulations (later)**: 9,000 instead of 2,000 for steadier odds. Needs a faster simulator first:
   at 9,000 the nightly build ran several minutes per sport (`n` in `scripts/oldline.py` `simulate`, and the
   "2,000 simulated seasons" text in `site/app.js`).
6. ~~**Set up the Cloudflare nightly trigger**~~ Done 2026-10-16 (`cloudflare/refresh/`, Worker
   `oldlinerankings-refresh`). Renew the GitHub token before it expires, then `npx wrangler secret put GITHUB_TOKEN`
   from `cloudflare/refresh/`.
7. **Basketball, once MPSSAA posts the 2026-27 season** (sites live 2026-10-18; `BASKETBALL` in `scripts/build.py`):
   - Upcoming games come from ArbiterLive (`scripts/arbiter.py`) until MPSSAA has 100+ of the season's games scheduled,
     then MPSSAA only. Check the switch-over looks right.
   - Classes/regions come from this fall's soccer standings until the basketball standings are this season's; check
     them against the posted basketball standings.
   - Set `playoffs.last_date` from the 2026-27 winter bulletin (now an estimate, Feb 22).
   - Rankings start `rank_date` (Dec 15), projections `project_date` (Jan 12).
