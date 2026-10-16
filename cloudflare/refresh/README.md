# Nightly refresh trigger (Cloudflare Worker)

Starts the **Refresh results & deploy** GitHub workflow at **4:17 AM Eastern** every day. GitHub's own
scheduled runs were starting hours late; Cloudflare's run on time. The workflow keeps a GitHub schedule
as a later backup.

## One-time setup

1. **GitHub token**: https://github.com/settings/personal-access-tokens/new (fine-grained). Repository
   access: only `edwurtle/OldLineRankings`. Permissions: **Actions: Read and write**. Copy the token.
   It expires; renew it here and repeat step 3 before then.
2. **Sign in to Cloudflare** (opens the browser): `cd cloudflare/refresh && npx wrangler login`
3. **Deploy and store the token**:
   `npx wrangler deploy` then `npx wrangler secret put GITHUB_TOKEN` (paste the token when asked).

Check it's working: the next morning the repo's Actions tab shows a "Refresh results & deploy" run started
by `workflow_dispatch` at about 4:17 AM. Logs: Cloudflare dashboard → Workers & Pages → oldlinerankings-refresh.
