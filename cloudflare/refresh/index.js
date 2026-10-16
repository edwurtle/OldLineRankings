// Starts the site's "Refresh results & deploy" workflow (.github/workflows/deploy.yml) at 4:17 AM Eastern.
// Needs a GitHub token with Actions read/write on edwurtle/OldLineRankings, stored as the GITHUB_TOKEN secret.
const WORKFLOW = "https://api.github.com/repos/edwurtle/OldLineRankings/actions/workflows/deploy.yml/dispatches";

export default {
  async scheduled(event, env) {
    const hour = Number(new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", hour: "numeric", hourCycle: "h23"})
      .format(new Date(event.scheduledTime)));
    if (hour !== 4) return;   // the other cron time is 3:17 or 5:17 AM Eastern, depending on daylight time
    const r = await fetch(WORKFLOW, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "oldlinerankings-refresh",
      },
      body: JSON.stringify({ref: "main"}),
    });
    if (!r.ok) throw new Error(`GitHub workflow dispatch failed: ${r.status} ${await r.text()}`);
    console.log("Started Refresh results & deploy");
  },
};
