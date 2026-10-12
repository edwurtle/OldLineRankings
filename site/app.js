(() => {
const D = window.DATA;
const C = D.config;                          // per-sport settings from scripts/build.py
const SCHOOLS = D.schools;
const CLASSES = Object.keys(C.classes);      // highest first
const GENDERS = C.divisions;                 // e.g. {boys: "Boys", girls: "Girls"} or {football: "Football"}
const DIVS = Object.keys(GENDERS), DEF = DIVS[0], MULTI = DIVS.length > 1;
const REGION_ORDER = C.regions;
const NONMEMBER_PTS = Math.min(...Object.values(C.classes));
const app = document.getElementById("app");

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmtDate = (d, opts = {month: "short", day: "numeric"}) => new Date(d + "T12:00:00").toLocaleDateString(undefined, opts);
const n2 = x => (Math.round(x * 100) / 100).toString();          // 3.75, 4.5, 6
const winPct = t => t.gp ? (t.W + 0.5 * t.T) / t.gp : 0;
const pctStr = t => winPct(t).toFixed(3).replace(/^0/, "");
const rec = t => `<span class="rec mono"><span class="w">${t.W}</span>-<span class="l">${t.L}</span>${C.ties || t.T ? `-<span class="t">${t.T}</span>` : ""}</span>`;
const recTxt = t => `${t.W}-${t.L}` + (C.ties || t.T ? `-${t.T}` : "");
const cl = c => (C.labels && C.labels[c]) || c;   // "4A_3A" -> "4A/3A"
// Section name for a class + division: "4A Boys" for soccer, "4A/3A" for football
const divName = (g, c) => [c && cl(c), MULTI ? GENDERS[g] : ""].filter(Boolean).join(" ");
const rkBadge = n => `<span class="rk mono">${n}</span>`;
// Ranking number: MPSSAA points per game (soccer) or the Old Line Rating (football, C.olr)
const OLR = !!C.olr;
const RATING = OLR ? "Old Line Rating" : "Rating", RATING_SHORT = OLR ? "OLR" : "avg";
const fmtR = x => OLR ? (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1) : x.toFixed(2);
const pct = x => x >= 99.5 && x < 100 ? ">99%" : x > 0 && x < 0.5 ? "<1%" : Math.round(x) + "%";
// Chance team a beats b (football): logistic in the OLR difference, home edge from the fit
const oppRating = (g, name) => findTeam(g, name)?.rating ?? D.sports[g].nonmember?.[name] ?? 0;
const winProb = (g, a, b, homeSign) => 1 / (1 + Math.exp(-C.olr.k * (oppRating(g, a) - oppRating(g, b) + (D.sports[g].home || 0) * homeSign)));
const initials = name => name.replace(/\(.*?\)/g, "").split(/[\s-]+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join("") || "?";
function logo(name, size = 32) {
  const s = SCHOOLS[name];
  return s && s.logo
    ? `<span class="logo" style="--sz:${size}px;--ring:${esc(s.color || "var(--border)")}"><img src="${esc(s.logo)}" alt="" loading="lazy"></span>`
    : `<span class="logo mono-logo" style="--sz:${size}px">${esc(initials(name))}</span>`;
}
const teamColor = name => (SCHOOLS[name] && SCHOOLS[name].color) || "#f2b705";
const subline = name => { const s = SCHOOLS[name] || {}; return [s.mascot, s.county].filter(Boolean).join(" · "); };


const teamsOf = (g, c) => c === "All" ? D.sports[g].teams : D.sports[g].teams.filter(t => t.cls === c);
const findTeam = (g, name) => D.sports[g].teams.find(t => t.school === name);
const throughAll = Object.values(D.sports).map(s => s.through).sort().pop();
document.getElementById("updated").textContent = `Games through ${fmtDate(throughAll, {month: "long", day: "numeric", year: "numeric"})} · updated ${D.updated}`;
document.getElementById("navLinks").innerHTML = DIVS.map(g => `<a href="#/${g}/${CLASSES[0]}" data-nav="${g}">${GENDERS[g]}</a>`).join("") +
  (C.playoffs ? `<a href="#/final8" data-nav="final8">Final 8</a>` : "") + `<a href="#/how" data-nav="how">How it works</a>`;
// Footer sport switcher: every Old Line Rankings sport, current one highlighted, coming-soon ones dimmed
document.getElementById("family").innerHTML = C.family.sports.map(s => s.href
  ? `<a href="${esc(s.href)}" class="${s.current ? "on" : ""}"${s.current ? ` aria-current="page"` : ""}>${s.icon} ${esc(s.sport)}</a>`
  : `<span class="soon" title="${esc(s.note || "")}">${s.icon} ${esc(s.sport)} <small>soon</small></span>`).join("");

// ---------- routing: #/  #/how  #/boys/2A?view=region&team=Glenelg  #/final8/4A?view=projected ----------
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const p = new URLSearchParams(qs || "");
  const cls = def => { const c = (parts[1] || def).toUpperCase(); return c === "ALL" ? "All" : c; };
  if (parts[0] in GENDERS)
    return {page: "rank", g: parts[0], c: cls(CLASSES[0]), view: p.get("view") || "overall", team: p.get("team")};
  if (parts[0] === "final8" && C.playoffs)
    return {page: "final8", g: DEF, c: cls(CLASSES[0]), view: p.get("view") || "current", team: p.get("team")};
  return {page: parts[0] === "how" ? "how" : "home", team: p.get("team"), g: p.get("g") || DEF};
}
function href(r) {
  const p = new URLSearchParams();
  if (r.page === "rank" || r.page === "final8") {
    if (r.view && r.view !== {rank: "overall", final8: "current"}[r.page]) p.set("view", r.view);
    if (r.team) p.set("team", r.team);
    return `#/${r.page === "rank" ? r.g : "final8"}/${r.c}` + (p.toString() ? "?" + p : "");
  }
  if (r.team) { p.set("team", r.team); if (MULTI) p.set("g", r.g); }
  return "#/" + (r.page === "how" ? "how" : "") + (p.toString() ? "?" + p : "");
}
function go(patch, replace = false) {
  const h = href(Object.assign(parseRoute(), patch));
  replace ? history.replaceState(null, "", h) : (location.hash = h);
  if (replace) render();
}

// ---------- state for the rankings page ----------
let sort = {key: "rank", dir: 1}, query = "", lastPage = "";
const SORTS = {
  rank: {val: t => t.__rank, asc: true},
  record: {val: winPct, tie: (a, b) => b.W - a.W || a.L - b.L},
  pts: {val: t => t.pts},
  avg: {val: t => t.avg},
  rating: {val: t => t.rating},
  sos: {val: t => t.sos},
  gp: {val: t => t.gp},
  gd: {val: t => t.gf - t.ga},
  school: {val: t => t.school, asc: true},
  region: {val: t => t.region, asc: true},
  cls: {val: t => t.cls, asc: false},
};
function sorted(list) {
  const s = SORTS[sort.key];
  return [...list].sort((a, b) => {
    const av = s.val(a), bv = s.val(b);
    const c = (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    return c || (s.tie ? s.tie(a, b) : 0) || a.__rank - b.__rank;
  });
}

// ---------- landing ----------
let homeGender = DEF;
function renderHome() {
  const totalTeams = Object.values(D.sports).reduce((s, x) => s + x.teams.length, 0);
  const totalGames = Object.values(D.sports).reduce((s, x) => s + new Set(x.teams.flatMap(t => t.games.map(g => g.date + [t.school, g.opp].sort().join("|")))).size, 0);
  const unbeatenCount = Object.values(D.sports).reduce((s, x) => s + x.teams.filter(t => t.L === 0 && t.gp >= 5).length, 0);
  app.innerHTML = `
  <section class="hero">
    <div class="hero-inner">
      <div>
        <div class="eyebrow">Fall ${throughAll.slice(0, 4)} · Maryland Public High School ${MULTI ? Object.values(GENDERS).join(" & ") + " " : ""}${C.sport}</div>
        <h1>Old Line<br><span>Rankings</span></h1>
        <p>${OLR ? `Every public high school ${C.sport.toLowerCase()} team in the state, ranked by the Old Line Rating: how much better than average a team is, built from capped scoring margins, wins and the strength of every opponent. MPSSAA playoff points are tracked alongside for seeding.`
          : `Every public high school ${C.sport.toLowerCase()} team in the state, ranked by who they beat. Strength of schedule is built in: a win over a ${CLASSES[0]} team with a winning record counts for more than a win over a winless ${CLASSES[CLASSES.length - 1]} team.`}</p>
        <div class="cta">
          ${DIVS.map((g, i) => `<a class="btn ${i ? "red" : "gold"}" href="#/${g}/${CLASSES[0]}">${MULTI ? GENDERS[g] + " rankings" : "Rankings"} →</a>`).join("")}
          ${C.playoffs ? `<a class="btn red" href="#/final8">Final 8 picture →</a>` : ""}
          <a class="btn ghost" href="#/how">How it works</a>
        </div>
        <div class="hero-stats">
          <div><b>${totalTeams}</b><span>Teams</span></div>
          <div><b>${totalGames.toLocaleString()}</b><span>Games</span></div>
          <div><b>${unbeatenCount}</b><span>Unbeaten</span></div>
          <div><b>${fmtDate(throughAll)}</b><span>Through</span></div>
        </div>
      </div>
      <div class="hero-flag">${flagSVG()}</div>
    </div>
  </section>

  <div class="wrap">
    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Choose a ${MULTI ? "division" : "class"}</div><h2>Jump to rankings</h2></div></div>
      <div class="picker" style="--picks:${DIVS.length}">${Object.entries(GENDERS).map(([g, label]) => `
        <div class="pick ${g}">
          <div class="pick-head"><h3><i></i>${label}</h3><a href="#/${g}/All">All classes →</a></div>
          <div class="pick-grid" style="--n:${CLASSES.length}">${CLASSES.map(c => {
            const ts = teamsOf(g, c), top = ts[0];
            return `<a class="cls-tile" href="#/${g}/${c}">
              <span class="cls-big">${cl(c)}</span>
              ${top ? logo(top.school, 40) : ""}
              <span class="lead">${top ? esc(top.school) : ""}</span>
              <small>${ts.length} teams</small></a>`;
          }).join("")}</div>
        </div>`).join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div><div class="eyebrow">Top of the table</div><h2>Leaders by class</h2><p>The top five in every class by ${OLR ? "Old Line Rating" : "average power points per game"}.</p></div>
        ${MULTI ? `<div class="gender-tabs" role="tablist">${Object.entries(GENDERS).map(([g, l]) => `<button data-hg="${g}" aria-selected="${g === homeGender}">${l}</button>`).join("")}</div>` : ""}
      </div>
      <div class="hl-grid" style="--n:${CLASSES.length > 4 ? 3 : CLASSES.length}">${CLASSES.map(c => highlightCard(homeGender, c)).join("")}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Still perfect</div><h2>Unbeaten ${MULTI ? GENDERS[homeGender] : "teams"}</h2><p>No losses with at least five games played, ordered by ${OLR ? "Old Line Rating" : "power rating"}.</p></div></div>
      <div class="unbeaten">${D.sports[homeGender].teams.filter(t => t.L === 0 && t.gp >= 5).map(t => `
        <div class="ub" data-team="${esc(t.school)}" data-g="${homeGender}">${logo(t.school, 34)}
          <div><b>${esc(t.school)}</b><br><small>${recTxt(t)} · ${fmtR(t.rating)} ${RATING_SHORT}</small></div>
          <span class="tag">${cl(t.cls)}</span></div>`).join("") || `<div class="muted">No unbeaten teams.</div>`}
      </div>
    </section>
  </div>`;
}
function highlightCard(g, c) {
  const ts = teamsOf(g, c);
  const [lead, ...rest] = ts;
  if (!lead) return "";
  return `<div class="hl">
    <div class="hl-top" style="--team:${teamColor(lead.school)}">
      <div class="row"><span class="hl-cls"><b>${cl(c)}</b> ${MULTI ? GENDERS[g] : ""}</span><span class="hl-crown">★ No. 1</span></div>
      <div class="hl-lead" data-team="${esc(lead.school)}" data-g="${g}">${logo(lead.school, 64)}
        <div><h4>${esc(lead.school)}</h4><div class="sub">${esc(subline(lead.school))}</div>
        <div class="big">${recTxt(lead)} · ${fmtR(lead.rating)} ${RATING_SHORT}</div></div></div>
    </div>
    <div class="hl-list">${rest.slice(0, 4).map((t, i) => `
      <div class="hl-row" data-team="${esc(t.school)}" data-g="${g}"><span class="n">${i + 2}</span>${logo(t.school, 30)}
        <span class="nm">${esc(t.school)}<small>${recTxt(t)} · ${esc(t.region)}</small></span><span class="avg mono">${fmtR(t.rating)}</span></div>`).join("")}
    </div>
    <a class="hl-foot" href="#/${g}/${c}">Full ${divName(g, c)} rankings →</a>
  </div>`;
}

// ---------- how it works ----------
function howOLR() {
  const o = C.olr, home = D.sports[DEF].home || 0, spread = 6, p = 1 / (1 + Math.exp(-o.k * spread));
  return `
    <div class="section-head" style="margin-top:0"><div><div class="eyebrow">The ranking</div><h2>Old Line Rating</h2>
      <p>How many points better than an average Maryland public school team a team is, judged by every game it has played.</p></div></div>
    <div class="how-grid">
      <div class="how-card w"><div class="k">Margin</div><h4>Capped at ${o.cap}</h4><p>Each game counts the scoring margin, capped at ${o.cap} points (just under the 35-point running clock), so running up the score doesn't help.</p></div>
      <div class="how-card w"><div class="k">Result</div><h4>±${o.win_bonus} for the win</h4><p>A win adds ${o.win_bonus} points and a loss subtracts ${o.win_bonus}, so a close win counts well ahead of a close loss.</p></div>
      <div class="how-card w"><div class="k">Opponents</div><h4>Strength built in</h4><p>A team's rating is its average game score plus the average rating of the teams it played, solved for every team at once. Beating a good team is worth more, by exactly how good it is.</p></div>
    </div>
    <div class="example"><b>Reading it:</b> +14 means about 14 points better than an average team. The difference between two ratings works like a point spread:
      a +20 team is about a ${spread}-point favorite over a +14 team, roughly a ${Math.round(100 * p)}% chance to win. Those chances drive the Final 8 predictions and playoff odds.</div>
    <div class="example"><b>Fine print:</b> Every rating is pulled toward its class average by ${o.prior} games' worth, so two big early wins don't make a team No. 1.
      Home field is measured from this season's results (currently ${home ? "+" + home.toFixed(1) + " points" : "no measurable edge"}).
      Out-of-state and private opponents are rated from their games against Maryland teams. Forfeits count as a win or loss with no margin.
      Tested on 2026 weeks 3–6 using only earlier games, the Old Line Rating picked 79% of winners versus 71% for MPSSAA points.</div>
    <div class="section-head"><div><div class="eyebrow">Playoff seeding</div><h2>MPSSAA points</h2>
      <p>The MPSSAA's own point system. It decides playoff seeding, so the Final 8 picture seeds by it.</p></div></div>`;
}
function renderHow() {
  // Group classes that share a value: "4A & 4A/3A = 8"
  const byPts = {};
  CLASSES.forEach(c => (byPts[C.classes[c]] = byPts[C.classes[c]] || []).push(cl(c)));
  const tiers = Object.entries(byPts).sort((a, b) => a[0] - b[0]);
  const tierText = tiers.map(([pts, cs], i) => `${pts}${i ? "" : pts == 1 ? " point" : " points"} for beating a ${cs.join(" or ")} team`).join(", ");
  const ex = C.example, exPts = C.classes[ex.cls], exW = ex.W + 0.5 * ex.T;
  const lowest = tiers[0][1].join(" / ");
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>How it works</span></div>
    <h1>How the <span>rankings</span> work</h1>
    <div class="sub">${OLR ? "Teams are ranked by the Old Line Rating. MPSSAA points, which decide playoff seeding, are shown alongside."
      : "Every game earns power points. A team's rating is its total points divided by games played, and teams are ranked by rating within their class."}</div>
  </div></section>
  <div class="wrap" style="margin-top:24px">
    ${OLR ? howOLR() : ""}
    <div class="how-grid" style="--n:${C.ties ? 3 : 2}">
      <div class="how-card w"><div class="k">Win</div><h4>Class + opponent's wins</h4><p>${tierText}, plus 1 point for every game your opponent has won this season.</p></div>
      ${C.ties ? `<div class="how-card t"><div class="k">Tie</div><h4>Half a win</h4><p>A tie earns half of what a win against that opponent would have earned. Ties also count as half a win in an opponent's win total.</p></div>` : ""}
      <div class="how-card l"><div class="k">Loss</div><h4>Zero points</h4><p>Losses earn nothing but still count as a game played, which pulls your average down.</p></div>
    </div>
    ${C.playoffs ? `<div class="example"><b>Same as MPSSAA playoff seeding:</b> these are the win points and bonus points the MPSSAA uses to seed the ${C.sport.toLowerCase()} playoffs
      (${tiers.slice().reverse().map(([pts, cs]) => `${cs.join(" & ")} = ${pts}`).join(", ")}).</div>` : ""}
    <div class="example">
      <b>Example:</b> A team beats a ${cl(ex.cls)} opponent that is ${recTxt(ex)} on the season. That win is worth <b>${exPts} + ${n2(exW)} = ${n2(exPts + exW)}</b> points.${C.ties ? ` Had it been a tie, it would be worth <b>${n2((exPts + exW) / 2)}</b>.` : ""}
      Each team's rating is its total power points divided by games played, and teams are ranked within their class.
    </div>
    <div class="example">
      <b>Strength of schedule (SOS):</b> the rating a team would have if it had won every game it played, i.e. the average of
      (opponent class points + opponent wins) across its schedule. It measures how tough the schedule is regardless of results.
      Comparing a team's rating to its SOS shows how much of the available credit it actually earned.
    </div>
    ${C.playoffs ? `<div class="example">
      <b>Final 8 picture:</b> in each class, the top ${C.playoffs.region_seeds} teams in each region by rating are seeded into a region bracket.
      Assuming the top seeds win, the No. 1 and No. 2 seeds from each of the ${REGION_ORDER.length} regions reach the state quarterfinals (the Final 8), which are reseeded 1–8 by rating.
      <b>Current</b> uses ratings as they stand today; <b>Projected</b> plays out the rest of the regular season assuming the higher-ranked team wins every game.
    </div>` : ""}
    <div class="example">
      <b>Fine print:</b> Opponent win totals are for the full season to date, so ratings keep changing as opponents play more games.
      Opponents from outside Maryland public schools (private schools, out of state) count as ${lowest} (${NONMEMBER_PTS} points) with 0 wins${C.playoffs ? "; the MPSSAA instead slots them into a class by enrollment and counts their wins, so official numbers can differ slightly. Official tiebreakers and 8- vs 9-game bonus adjustments are not applied" : ""}.
      Forfeits count as wins and losses. Records are calculated from game-by-game results, so they may differ slightly from official standings.
    </div>
  </div>`;
}

// ---------- rankings page ----------
function renderRank(r) {
  const key = r.g + r.c;
  if (key !== lastPage) { query = ""; sort = {key: "rank", dir: 1}; lastPage = key; }
  const ts = teamsOf(r.g, r.c).map(t => Object.assign(t, {__rank: r.c === "All" ? t.stateRank : t.rank}));
  const title = `${r.c === "All" ? "All Classes" : cl(r.c)} <span>${GENDERS[r.g]}</span>${MULTI && r.c !== "All" ? " " + C.sport : ""}`;
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/${r.g}/${CLASSES[0]}">${GENDERS[r.g]}</a><span>/</span><span>${r.c === "All" ? "All classes" : "Class " + cl(r.c)}</span></div>
    <h1>${title}</h1>
    <div class="sub">${ts.length} teams · games through ${fmtDate(D.sports[r.g].through, {month: "long", day: "numeric"})} · ranked by ${OLR ? "Old Line Rating" : "rating (power points per game)"}</div>
    <div class="switches">
      ${MULTI ? `<div class="pill-group ${r.g !== DEF ? "red" : ""}">${Object.entries(GENDERS).map(([g, l]) => `<a class="${g === r.g ? "on" : ""}" href="${href({...r, g, team: null})}">${l}</a>`).join("")}</div>` : ""}
      <div class="pill-group">${[...CLASSES, "All"].map(c => `<a class="${c === r.c ? "on" : ""}" href="${href({...r, c, team: null})}">${cl(c)}</a>`).join("")}</div>
    </div>
  </div></section>
  <div class="wrap">
    <div class="card">
      <div class="toolbar">
        <div class="seg" role="tablist">
          <button data-view="overall" aria-selected="${r.view !== "region"}">Overall</button>
          <button data-view="region" aria-selected="${r.view === "region"}">By Region</button>
        </div>
        <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="q" type="search" placeholder="Search teams, mascots, counties…" autocomplete="off" value="${esc(query)}"></label>
        <label class="sortsel">Sort by <select id="sortSel">
          <option value="rank">${OLR ? "Old Line Rating" : "Power ranking"}</option>${OLR ? `<option value="avg">MPSSAA points</option>` : ""}<option value="record">Record (win %)</option>
          <option value="sos">Strength of schedule</option><option value="pts">${OLR ? "Total MPSSAA points" : "Total points"}</option><option value="gd">${C.score.name}</option><option value="school">Team name</option>
        </select></label>
      </div>
      <div id="list"></div>
    </div>
  </div>`;
  const sel = document.getElementById("sortSel");
  sel.value = SORTS[sort.key] && [...sel.options].some(o => o.value === sort.key) ? sort.key : "";
  renderList(r, ts);
}

function filterTeams(ts) {
  const q = query.trim().toLowerCase();
  if (!q) return ts;
  return ts.filter(t => [t.school, t.region, t.cls, SCHOOLS[t.school]?.mascot, SCHOOLS[t.school]?.county, SCHOOLS[t.school]?.city]
    .some(v => v && v.toLowerCase().includes(q)));
}

function renderList(r, ts) {
  const el = document.getElementById("list");
  const list = filterTeams(ts);
  const lo = OLR ? Math.min(...ts.map(t => t.rating)) : 0, span = (Math.max(...ts.map(t => t.rating)) - lo) || 1;
  if (!list.length) { el.innerHTML = `<div class="empty">No teams match “${esc(query)}”.</div>`; return; }
  if (r.view === "region") {
    const classes = r.c === "All" ? CLASSES : [r.c];
    el.innerHTML = `<div class="regions">${classes.map(c => {
      const cards = REGION_ORDER.map(reg => {
        const all = ts.filter(t => t.cls === c && t.region === reg);
        const shown = sorted(list.filter(t => t.cls === c && t.region === reg));
        if (!shown.length) return "";
        const regAvg = all.reduce((s, t) => s + t.rating, 0) / all.length;
        return `<div class="rcard"><div class="rhead"><h3>${r.c === "All" ? `<span>${cl(c)}</span> ` : ""}${reg}</h3><small>${all.length} teams · avg ${fmtR(regAvg)}</small></div>
          ${shown.map(t => `<div class="rrow" data-team="${esc(t.school)}">
            ${rkBadge(all.indexOf(t) + 1)}${logo(t.school, 32)}
            <div><div class="nm">${esc(t.school)}</div><div class="meta">${rec(t)}<span class="pct mono">${pctStr(t)}</span> · SOS ${fmtR(t.sos)}</div></div>
            <div class="ov">#${t.rank}<br>in ${cl(t.cls)}</div><span class="avg mono">${fmtR(t.rating)}</span></div>`).join("")}</div>`;
      }).join("");
      return cards ? (r.c === "All" ? `<div class="class-label">Class ${cl(c)}</div>` : "") + cards : "";
    }).join("")}</div>`;
    return;
  }
  const cols = [
    {key: "rank", label: "#"}, {key: "school", label: "Team"},
    ...(r.c === "All" ? [{key: "cls", label: "Class", cls: "hide-xs"}] : []),
    {key: "region", label: "Region", cls: "hide-reg"}, {key: "record", label: "Record"},
    {key: "gp", label: "GP", cls: "num hide-md"}, {key: "gd", label: C.score.short, cls: "num hide-md"},
    {key: "pts", label: OLR ? "MPSSAA total" : "Points", cls: "num hide-lg"},
    ...(OLR ? [{key: "avg", label: "MPSSAA avg", cls: "num hide-sm", title: "MPSSAA playoff points per game (used for seeding)"}] : []),
    {key: "sos", label: "SOS", cls: "num hide-xs", title: OLR ? "Strength of schedule: average Old Line Rating of opponents played"
      : "Strength of schedule: average points per game if every game had been a win"},
    {key: "rating", label: OLR ? "OLR" : "Rating", cls: "num", title: OLR ? "Old Line Rating: points better than an average team" : ""},
  ];
  el.innerHTML = `<div class="table-wrap"><table><thead><tr>${cols.map(c =>
    `<th class="${c.cls || ""} ${sort.key === c.key ? "active" : ""}" data-sort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${c.label}<span class="arrow">${sort.key === c.key ? (sort.dir > 0 ? "▲" : "▼") : "↕"}</span></th>`).join("")}
  </tr></thead><tbody>${sorted(list).map(t => `
    <tr data-team="${esc(t.school)}">
      <td>${rkBadge(t.__rank)}</td>
      <td class="team-td"><div class="teamcell">${logo(t.school, 34)}<div><div class="nm">${esc(t.school)}</div><small>${esc(subline(t.school))}</small></div></div></td>
      ${r.c === "All" ? `<td class="hide-xs"><span class="tag cls">${cl(t.cls)}</span></td>` : ""}
      <td class="hide-reg"><span class="tag">${esc(t.region)}</span></td>
      <td>${rec(t)}<span class="pct mono">${pctStr(t)}</span></td>
      <td class="num mono hide-md">${t.gp}</td>
      <td class="num mono hide-md">${t.gf}–${t.ga}</td>
      <td class="num mono hide-lg">${n2(t.pts)}</td>
      ${OLR ? `<td class="num mono hide-sm">${t.avg.toFixed(2)}</td>` : ""}
      <td class="num hide-xs"><span class="sos mono">${fmtR(t.sos)}</span><span class="sosrk mono">#${r.c === "All" ? t.sosStateRank : t.sosRank}</span></td>
      <td class="num"><div class="avgcell"><div class="bar"><i style="width:${Math.max(2, (t.rating - lo) / span * 100).toFixed(1)}%"></i></div><span class="avg mono">${fmtR(t.rating)}</span></div></td>
    </tr>`).join("")}</tbody></table></div>`;
}

function setSort(key, toggle) {
  sort = toggle && sort.key === key ? {key, dir: -sort.dir} : {key, dir: SORTS[key].asc ? 1 : -1};
  const sel = document.getElementById("sortSel");
  if (sel) sel.value = [...sel.options].some(o => o.value === key) ? key : "";
  const r = parseRoute();
  renderList(r, teamsOf(r.g, r.c));
}

// ---------- final 8 picture ----------
// Seeding uses MPSSAA points (what the MPSSAA seeds by). Each region's top 8 play two rounds
// (1v8, 4v5, 2v7, 3v6), the two survivors reach the state quarterfinals, reseeded 1-8 by MPSSAA
// points. Every playoff game goes to the Old Line Rating favorite (higher seed hosts).
// "Projected" seeds from t.proj: the rest of the regular season won by the OLR favorite.
function seeding(c, projected) {
  const val = t => projected ? t.proj : t;
  const order = (a, b) => val(b).avg - val(a).avg || val(b).pts - val(a).pts || a.stateRank - b.stateRank;
  const ts = teamsOf(DEF, c);
  const regions = REGION_ORDER.map(reg => {
    const teams = ts.filter(t => t.region === reg).sort(order);
    // Current: the top seeds advance. Projected: region games go to the Old Line Rating favorite.
    const adv = projected ? playBracket(teams.slice(0, C.playoffs.region_seeds), 2).pop()?.map(m => m.w) || []
      : teams.slice(0, C.playoffs.per_region);
    return {reg, teams, adv: new Set(adv)};
  });
  const final8 = regions.flatMap(x => [...x.adv]).sort(order);
  const regionSeed = new Map(regions.flatMap(x => x.teams.map((t, i) => [t, i + 1])));
  return {val, regions, final8, regionSeed};
}
// Standard bracket over seeds (best first); a missing seed is a bye. Returns rounds of
// {a, b, w, p}: a = higher seed (hosts), p = chance a wins, w = predicted winner.
function playBracket(seeds, maxRounds) {
  let slots = [1, 8, 4, 5, 2, 7, 3, 6].map(i => seeds[i - 1] || null);
  const rounds = [];
  while (slots.length > 1 && rounds.length < maxRounds) {
    const games = [];
    for (let i = 0; i < slots.length; i += 2) {
      let [a, b] = [slots[i], slots[i + 1]];
      if (!a && !b) { games.push(null); continue; }
      if (!a || (b && seeds.indexOf(b) < seeds.indexOf(a))) [a, b] = [b, a];
      const p = b ? (OLR ? winProb(DEF, a.school, b.school, 1) : 1) : 1;
      games.push({a, b, p, w: p >= .5 ? a : b});
    }
    rounds.push(games.filter(Boolean));
    slots = games.map(m => m && m.w);
  }
  return rounds;
}
function renderFinal8(r) {
  const projected = r.view === "projected";
  const {val, regions, final8, regionSeed} = seeding(r.c, projected);
  // Projected view shows the projected record next to the actual one
  const recLine = t => projected ? `<span class="proj-tag">proj ${recTxt(t.proj)}</span> · now ${recTxt(t)}` : recTxt(t);
  const slot = (t, p, cls) => !t ? `<div class="slot tbd"><span class="seed mono"></span><span></span><span class="nm">Bye</span></div>`
    : `<div class="slot ${cls}" data-team="${esc(t.school)}"><span class="seed mono">${final8.indexOf(t) + 1}</span>${logo(t.school, 26)}
      <span class="nm">${esc(t.school)}<small>${esc(t.region)} #${regionSeed.get(t)} · ${recLine(t)} · MPSSAA ${val(t).avg.toFixed(2)}${projected ? " proj" : ""}</small></span>
      <span class="avg mono" title="Chance to win this game (Old Line Rating)">${p == null ? "" : pct(100 * p)}</span></div>`;
  // Current shows only the seeded quarterfinals; projected fills every round with the favorites.
  // Matches are grouped in feeding pairs so CSS can draw the bracket connectors.
  const rounds = playBracket(final8, 3);
  const champ = projected && rounds.length === 3 ? rounds[2][0].w : null;
  const names = ["State quarterfinals", "Semifinals", "Final"];
  const tbd = `<div class="slot tbd"><span class="seed mono"></span><span></span><span class="nm">TBD</span></div>`;
  const match = (m, show) => `<div class="match">${show && m
    ? slot(m.a, projected && m.b ? m.p : null, projected ? (m.w === m.a ? "win" : "lose") : "") + slot(m.b, projected && m.b ? 1 - m.p : null, projected ? (m.w === m.b ? "win" : "lose") : "")
    : tbd + tbd}</div>`;
  const cell = html => `<div class="bslot">${html}</div>`;
  const cols = [4, 2, 1].map((count, i) => {
    const ms = Array.from({length: count}, (_, j) => match((rounds[i] || [])[j], i === 0 || projected));
    const body = count === 1 ? cell(ms[0]) : Array.from({length: count / 2}, (_, j) => `<div class="bpair">${cell(ms[2 * j])}${cell(ms[2 * j + 1])}</div>`).join("");
    return `<div class="bcol${i ? " fed" : ""}"><h4>${names[i]}</h4><div class="bgames">${body}</div></div>`;
  }).join("");
  const bracket = `<div class="bracket">${cols}
    <div class="bcol fed champ"><h4>Champion</h4><div class="bgames">${cell(`<div class="match">${champ ? slot(champ, null, "win") : tbd}
      ${champ && champ.odds ? `<div class="champ-odds">Title odds ${pct(champ.odds.champ)}</div>` : ""}</div>`)}</div></div>
  </div>`;
  const regionCards = regions.map(({reg, teams, adv}) => {
    return `<div class="rcard"><div class="rhead"><h3>${reg}</h3><small>${teams.length} teams · top ${C.playoffs.region_seeds} make region playoffs · ${projected ? "projected " : ""}MPSSAA pts</small></div>
    ${teams.map((t, i) => {
      const inPO = i < C.playoffs.region_seeds;
      const tag = adv.has(t) ? `<span class="adv">Final 8 · #${final8.indexOf(t) + 1}</span>` : inPO ? "" : "Out";
      return `<div class="rrow ${inPO ? "" : "out"}" data-team="${esc(t.school)}">${rkBadge(i + 1)}${logo(t.school, 32)}
        <div><div class="nm">${esc(t.school)}</div><div class="meta">${projected ? `${recLine(t)}${t.proj.gp > t.gp ? ` (${t.proj.gp - t.gp} to play)` : ""}` : rec(t)} · OLR ${fmtR(t.rating)}${projected && t.odds ? ` · Final 8 odds ${pct(t.odds.f8)}` : ""}</div></div>
        <div class="ov">${tag}</div>
        <span class="avg mono mp" title="${projected ? "Projected " : ""}MPSSAA points per game (seeding)">${val(t).avg.toFixed(2)}<small>${projected ? "proj " : ""}MPSSAA</small></span></div>`;
    }).join("")}</div>`;
  }).join("");
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>Final 8</span><span>/</span><span>Class ${cl(r.c)}</span></div>
    <h1>${cl(r.c)} <span>Final 8</span> picture</h1>
    <div class="sub">${projected
      ? "Projected: seeds after the rest of the regular season is played out, each game won by the Old Line Rating favorite. Odds come from 2,000 simulated seasons and playoffs."
      : `Current: seeds from MPSSAA points through ${fmtDate(D.sports[DEF].through, {month: "long", day: "numeric"})}.`}
      ${projected ? "Each playoff game goes to the Old Line Rating favorite; percentages are each team's chance to win that game." : "Switch to Projected to see predicted winners."}</div>
    <div class="switches">
      <div class="pill-group">${CLASSES.map(c => `<a class="${c === r.c ? "on" : ""}" href="${href({...r, c, team: null})}">${cl(c)}</a>`).join("")}</div>
    </div>
  </div></section>
  <div class="wrap">
    <div class="card">
      <div class="toolbar">
        <div class="seg" role="tablist">
          <button data-view="current" aria-selected="${!projected}">Current</button>
          <button data-view="projected" aria-selected="${projected}">Projected</button>
        </div>
      </div>
      ${final8.length ? bracket : `<div class="empty">No teams yet.</div>`}
    </div>
    <div class="section-head"><div><div class="eyebrow">Region seeding · MPSSAA points</div><h2>${cl(r.c)} regions</h2>
      <p>Each region's top ${C.playoffs.region_seeds} by MPSSAA points play two rounds (1v8, 4v5, 2v7, 3v6); the two survivors reach the Final 8.
      ${projected ? "Marked teams are the Old Line Rating favorites to get there." : `Assuming the top seeds win, No. 1 and No. 2 advance.`}</p></div></div>
    <div class="regions f8-regions">${regionCards}</div>
  </div>`;
}

// ---------- team drawer ----------
const drawer = document.getElementById("drawer"), scrim = document.getElementById("scrim");
function openTeam(g, name) {
  const t = findTeam(g, name);
  if (!t) return closeDrawer();
  const s = SCHOOLS[name] || {};
  const regionRank = D.sports[g].teams.filter(x => x.cls === t.cls && x.region === t.region).indexOf(t) + 1;
  document.getElementById("dHead").style.setProperty("--team", teamColor(name));
  document.getElementById("dLogo").innerHTML = logo(name, 76);
  document.getElementById("dEyebrow").textContent = `${divName(g, t.cls)} · #${t.rank} in class · #${regionRank} in ${t.region} · #${t.stateRank} statewide`;
  document.getElementById("dName").textContent = name;
  document.getElementById("dMeta").textContent = [s.mascot, s.city, s.county && s.county + (/(City|County)$/.test(s.county) ? "" : " County")].filter(Boolean).join(" · ");
  document.getElementById("dForm").innerHTML = t.games.map(x => `<i class="${x.res}" title="${esc(fmtDate(x.date) + " vs " + x.opp)}">${x.res}</i>`).join("") +
    t.upcoming.filter(u => u.status !== "postponed").map(u => `<i class="U" title="${esc(fmtDate(u.date) + (u.home ? " vs " : " @ ") + u.opp)}"></i>`).join("");
  const scoring = t.games.filter(x => x.pts > 0);
  const best = scoring.length ? scoring.reduce((a, b) => b.pts > a.pts ? b : a) : null;
  document.getElementById("dBody").innerHTML = `
    <div class="tiles">
      <div class="tile"><b class="mono">${fmtR(t.rating)}</b><span>${RATING}</span></div>
      ${OLR ? `<div class="tile"><b class="mono">${t.avg.toFixed(2)}</b><span title="MPSSAA playoff points per game (seeding)">MPSSAA avg</span></div>` : ""}
      <div class="tile"><b class="mono">${fmtR(t.sos)}</b><span title="Strength of schedule">SOS · #${t.sosRank} in ${cl(t.cls)}</span></div>
      ${OLR ? "" : `<div class="tile"><b class="mono">${n2(t.pts)}</b><span>Power points</span></div>`}
      <div class="tile"><b class="mono">${recTxt(t)}</b><span>Record · ${pctStr(t)}</span></div>
      <div class="tile"><b class="mono">${t.gf}–${t.ga}</b><span>${C.score.short}</span></div>
    </div>
    ${t.odds ? `<div class="sect">Playoff odds · 2,000 simulated seasons</div><div class="tiles odds">
      ${[["po", "Region playoffs"], ["f8", "Final 8"], ["fin", "State final"], ["champ", "State champion"]].map(([k, l]) =>
        `<div class="tile"><b class="mono">${pct(t.odds[k])}</b><span>${l}</span></div>`).join("")}</div>` : ""}
    ${best ? `<div class="sect">Best result</div><div class="best">${logo(best.opp, 40)}<div><b>${best.res === "W" ? "Beat" : "Tied"} ${esc(best.opp)}</b> ${best.gf}–${best.ga} on ${fmtDate(best.date)}<div class="muted" style="font-size:13px">Worth ${n2(best.pts)} ${OLR ? "MPSSAA" : "power"} points</div></div></div>` : ""}
    ${t.upcoming.length ? `<div class="sect">Upcoming (${t.upcoming.length})</div>${t.upcoming.map(u => upcomingRow(g, t, u)).join("")}<div style="height:10px"></div>` : ""}
    <div class="sect">Games played (${t.gp})</div>
    ${[...t.games].reverse().map(x => gameRow(g, t, x)).join("") || `<div class="muted">No games yet.</div>`}`;
  document.getElementById("dBody").scrollTop = 0;
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); scrim.classList.add("open");
}
function gameRow(g, t, x) {
  const opp = x.member ? findTeam(g, x.opp) : null;
  const name = opp && x.opp !== t.school ? `<button data-team="${esc(x.opp)}">${esc(x.opp)}</button>` : esc(x.opp);
  const ctag = opp ? `<span class="ctag">${cl(opp.cls)}</span>` : `<span class="ctag nm">Non-public / out of state</span>`;
  const orec = opp ? `<span class="mono">${recTxt(opp)}</span><span>${esc(opp.region)}</span>` : "";
  const raw = x.res === "T" ? [x.cp * 2, x.ow * 2] : [x.cp, x.ow];
  const calc = x.res === "W" ? `<span class="mono">${n2(raw[0])} + ${n2(raw[1])} =</span> <b class="mono">${n2(x.pts)}</b>`
    : x.res === "T" ? `<span class="mono">½ × (${n2(raw[0])} + ${n2(raw[1])}) =</span> <b class="mono">${n2(x.pts)}</b>` : `<b class="mono">0</b>`;
  return `<div class="game">
    <div class="res ${x.res}">${x.res}</div>${logo(x.opp, 34)}
    <div><div class="opp">${x.home ? "vs" : "@"} ${name}</div>
      <div class="det"><span>${fmtDate(x.date)}</span>${ctag}${orec}${x.ff ? "<span>Forfeit</span>" : ""}</div></div>
    <div class="right"><div class="score mono">${x.gf ?? "–"}–${x.ga ?? "–"}</div><div class="pts">${calc} pts</div>${x.res === "L" ? `<div class="pts missed">win worth ${n2(x.max)}</div>` : ""}</div>
  </div>`;
}
function upcomingRow(g, t, u) {
  const opp = u.member ? findTeam(g, u.opp) : null;
  const name = opp ? `<button data-team="${esc(u.opp)}">${esc(u.opp)}</button>` : esc(u.opp);
  const ctag = opp ? `<span class="ctag">${cl(opp.cls)}</span>` : `<span class="ctag nm">Non-public / out of state</span>`;
  const orec = opp ? `<span class="mono">${recTxt(opp)}</span><span>${esc(opp.region)}</span>` : "";
  const status = {postponed: `<span class="stat">Postponed</span>`, pending: `<span class="stat">Result pending</span>`}[u.status] || "";
  // A win would be worth opponent class + opponent wins (to date)
  const worth = opp ? C.classes[opp.cls] + opp.W + 0.5 * opp.T : NONMEMBER_PTS;
  const d = new Date(u.date + "T12:00:00");
  return `<div class="game upcoming">
    <div class="when"><small>${d.toLocaleDateString(undefined, {weekday: "short"})}</small><b class="mono">${d.getDate()}</b></div>${logo(u.opp, 34)}
    <div><div class="opp">${u.home ? "vs" : "@"} ${name}</div>
      <div class="det"><span>${fmtDate(u.date)}</span>${ctag}${orec}${status}</div></div>
    <div class="right">${OLR ? `<div class="prob mono" title="Chance to win (Old Line Rating)">${pct(100 * winProb(g, t.school, u.opp, u.home ? 1 : -1))} to win</div>` : ""}<div class="pts">win worth</div><div class="mono worth">${n2(worth)} <span class="pts">pts</span></div></div>
  </div>`;
}
function closeDrawer() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); scrim.classList.remove("open"); }

// ---------- render & events ----------
function render() {
  const r = parseRoute();
  const pageKey = r.page + (r.page === "rank" || r.page === "final8" ? r.g + r.c + r.view : "") + (r.page === "home" ? homeGender : "");
  if (pageKey !== render.lastKey) {
    ({rank: renderRank, final8: renderFinal8, how: renderHow}[r.page] || renderHome)(r);
    if (render.lastKey && r.page !== render.lastPage) window.scrollTo(0, 0);
    render.lastKey = pageKey; render.lastPage = r.page;
  }
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", r.page === "rank" ? a.dataset.nav === r.g : a.dataset.nav === r.page));
  document.title = (r.page === "rank" ? `${r.c === "All" ? "All Classes" : cl(r.c)} ${GENDERS[r.g]}${MULTI ? " " + C.sport : ""} · `
    : r.page === "final8" ? `${cl(r.c)} Final 8 · ` : "") + `Old Line Rankings · ${C.sport}`;
  if (r.team) openTeam(r.g || DEF, r.team); else closeDrawer();
}

app.addEventListener("click", e => {
  const hg = e.target.closest("[data-hg]");
  if (hg) { homeGender = hg.dataset.hg; render.lastKey = null; return render(); }
  const view = e.target.closest("[data-view]");
  if (view) return go({view: view.dataset.view});
  const th = e.target.closest("th[data-sort]");
  if (th) return setSort(th.dataset.sort, true);
  const team = e.target.closest("[data-team]");
  if (team) return go({team: team.dataset.team, ...(team.dataset.g ? {g: team.dataset.g} : {})});
});
app.addEventListener("input", e => {
  if (e.target.id !== "q") return;
  query = e.target.value;
  const r = parseRoute();
  renderList(r, teamsOf(r.g, r.c));
});
app.addEventListener("change", e => { if (e.target.id === "sortSel") setSort(e.target.value, false); });
document.getElementById("dBody").addEventListener("click", e => {
  const b = e.target.closest("button[data-team]");
  if (b) go({team: b.dataset.team});
});
const close = () => go({team: null});
scrim.addEventListener("click", close);
document.getElementById("close").addEventListener("click", close);
document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer.classList.contains("open")) close(); });
window.addEventListener("hashchange", render);
render();
})();
