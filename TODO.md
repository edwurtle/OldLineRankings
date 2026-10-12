# TODO

1. **Set up the domain**: buy `oldlinerankings.com` (was unregistered on 2026-10-12, as were .org/.net)
   and serve the site from it: add `site/CNAME`, set the custom domain in the repo's GitHub Pages settings,
   add the DNS records at the registrar (4 A records + `www` CNAME), turn on HTTPS. The old
   `edwurtle.github.io/md-soccer-rankings/` links will redirect.
2. **Set up NFHS Network affiliate links**: apply to the NFHS Network affiliate program
   (https://nfhsnetwork.playonsports.com/affiliate-program, reportedly run on Impact), then add the
   tracking-link format to the ▶ Watch buttons (all watch links are built in `site/app.js`, `watchBtn`).
3. **Schedule page + full team pages** (in progress): per sport, a schedule page with every game (Upcoming /
   Results / All, filter by class and boys/girls, search by school) showing time, ▶ Watch, Tickets and
   add-to-calendar; clicking a team opens a full team page (ratings, odds, full schedule, "Subscribe to
   schedule"). Data is ready: games carry `time`, `watch`, `tickets`; each team has `cal` (a nightly-rebuilt
   `.ics` under `site/<sport>/cal/`). Front end still to build.
4. **Search visibility (Google, other search engines, AI assistants)**: per-page titles/descriptions,
   `sitemap.xml` + `robots.txt`, structured data (schema.org SportsEvent / SportsTeam), crawlable
   per-team URLs (hash routes like `#/team/...` aren't indexed: needs real paths or pre-rendered pages),
   an `llms.txt` summary, and submit to Google Search Console / Bing Webmaster Tools once the domain is live.
