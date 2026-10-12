# TODO

1. **Set up the domain**: buy `oldlinerankings.com` (was unregistered on 2026-10-12, as were .org/.net)
   and serve the site from it: add `site/CNAME`, set the custom domain in the repo's GitHub Pages settings,
   add the DNS records at the registrar (4 A records + `www` CNAME), turn on HTTPS. The
   `edwurtle.github.io/OldLineRankings/` links will redirect.
2. **Set up NFHS Network affiliate links**: apply to the NFHS Network affiliate program
   (https://nfhsnetwork.playonsports.com/affiliate-program, reportedly run on Impact), then add the
   tracking-link format to the ▶ Watch buttons (all watch links are built in `site/app.js`, `watchBtn`).
3. **Full team pages** (optional): the Schedule page is done (every game, filters, search, Watch/Tickets,
   team drawers). Still to do: a full page per team with "Subscribe to schedule" (each team already has a
   nightly-rebuilt `.ics` at `t.cal`, e.g. `football/cal/quince-orchard.ics`) and per-game add-to-calendar.
4. **Search visibility (Google, other search engines, AI assistants)**: per-page titles/descriptions,
   `sitemap.xml` + `robots.txt`, structured data (schema.org SportsEvent / SportsTeam), crawlable
   per-team URLs (hash routes like `#/team/...` aren't indexed: needs real paths or pre-rendered pages),
   an `llms.txt` summary, and submit to Google Search Console / Bing Webmaster Tools once the domain is live.
