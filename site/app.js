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
const initials = name => name.replace(/\(.*?\)/g, "").split(/[\s-]+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join("") || "?";
function logo(name, size = 32) {
  const s = SCHOOLS[name];
  return s && s.logo
    ? `<span class="logo" style="--sz:${size}px;--ring:${esc(s.color || "var(--border)")}"><img src="${esc(s.logo)}" alt="" loading="lazy"></span>`
    : `<span class="logo mono-logo" style="--sz:${size}px">${esc(initials(name))}</span>`;
}
const teamColor = name => (SCHOOLS[name] && SCHOOLS[name].color) || "#f2b705";
const subline = name => { const s = SCHOOLS[name] || {}; return [s.mascot, s.county].filter(Boolean).join(" · "); };

// Maryland flag: Calvert (paly of six or and sable, a bend counterchanged) and
// Crossland (quarterly argent and gules, a cross bottony counterchanged).
let flagId = 0;
function flagSVG() {
  const id = "f" + (flagId++);
  const G = "#f2b705", K = "#111", R = "#c8102e", W = "#fff";
  const calvert = (x, y) => {
    const pales = swap => [0, 1, 2, 3, 4, 5].map(i => `<rect x="${x + i * 25}" y="${y}" width="25" height="100" fill="${(i % 2 === 0) !== swap ? G : K}"/>`).join("");
    return `<clipPath id="${id}b${x}${y}"><polygon points="${x},${y} ${x + 34},${y} ${x + 150},${y + 77} ${x + 150},${y + 100} ${x + 116},${y + 100} ${x},${y + 23}"/></clipPath>
      ${pales(false)}<g clip-path="url(#${id}b${x}${y})">${pales(true)}</g>`;
  };
  const crossland = (x, y) => {
    const quarters = swap => [[0, 0, W], [75, 0, R], [0, 50, R], [75, 50, W]]
      .map(([dx, dy, c]) => `<rect x="${x + dx}" y="${y + dy}" width="75" height="50" fill="${swap ? (c === W ? R : W) : c}"/>`).join("");
    const cx = x + 75, cy = y + 50;
    const cross = `<rect x="${cx - 8}" y="${y + 14}" width="16" height="72"/><rect x="${x + 22}" y="${cy - 8}" width="106" height="16"/>` +
      [[cx, y + 12], [cx, y + 88], [x + 20, cy], [x + 130, cy]].map(([px, py]) =>
        `<circle cx="${px}" cy="${py}" r="7"/><circle cx="${px + (px === cx ? -7 : 0)}" cy="${py + (px === cx ? 0 : -7)}" r="6"/><circle cx="${px + (px === cx ? 7 : 0)}" cy="${py + (px === cx ? 0 : 7)}" r="6"/>`).join("");
    return `<clipPath id="${id}c${x}${y}">${cross}</clipPath>${quarters(false)}<g clip-path="url(#${id}c${x}${y})">${quarters(true)}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice">${calvert(0, 0)}${crossland(150, 0)}${crossland(0, 100)}${calvert(150, 100)}</svg>`;
}
document.querySelectorAll("[data-flag]").forEach(el => el.innerHTML = flagSVG());
document.documentElement.style.setProperty("--flag-url", `url("data:image/svg+xml,${encodeURIComponent(flagSVG())}")`);

const teamsOf = (g, c) => c === "All" ? D.sports[g].teams : D.sports[g].teams.filter(t => t.cls === c);
const findTeam = (g, name) => D.sports[g].teams.find(t => t.school === name);
const throughAll = Object.values(D.sports).map(s => s.through).sort().pop();
document.getElementById("updated").textContent = `Games through ${fmtDate(throughAll, {month: "long", day: "numeric", year: "numeric"})} · updated ${D.updated}`;
document.getElementById("navLinks").innerHTML = DIVS.map(g => `<a href="#/${g}/${CLASSES[0]}" data-nav="${g}">${GENDERS[g]}</a>`).join("") +
  (C.playoffs ? `<a href="#/final8" data-nav="final8">Final 8</a>` : "") + `<a href="#/how" data-nav="how">How it works</a>`;
document.getElementById("otherSites").innerHTML = C.others.map(o => `<a class="other-site" href="${esc(o.href)}">${o.icon} ${esc(o.sport)} rankings →</a>`).join("");

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
        <div class="eyebrow">Fall ${throughAll.slice(0, 4)} · ${MULTI ? Object.values(GENDERS).join(" & ") + " " : ""}${C.sport}</div>
        <h1>Maryland Public<br>High Schools <span>Power Rankings</span></h1>
        <p>Every public high school ${C.sport.toLowerCase()} team in the state, ranked by who they beat. Strength of schedule is built in: a win over a ${CLASSES[0]} team with a winning record counts for more than a win over a winless ${CLASSES[CLASSES.length - 1]} team.</p>
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
        <div><div class="eyebrow">Top of the table</div><h2>Leaders by class</h2><p>The top five in every class by average power points per game.</p></div>
        ${MULTI ? `<div class="gender-tabs" role="tablist">${Object.entries(GENDERS).map(([g, l]) => `<button data-hg="${g}" aria-selected="${g === homeGender}">${l}</button>`).join("")}</div>` : ""}
      </div>
      <div class="hl-grid" style="--n:${CLASSES.length > 4 ? 3 : CLASSES.length}">${CLASSES.map(c => highlightCard(homeGender, c)).join("")}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Still perfect</div><h2>Unbeaten ${MULTI ? GENDERS[homeGender] : "teams"}</h2><p>No losses with at least five games played, ordered by power rating.</p></div></div>
      <div class="unbeaten">${D.sports[homeGender].teams.filter(t => t.L === 0 && t.gp >= 5).map(t => `
        <div class="ub" data-team="${esc(t.school)}" data-g="${homeGender}">${logo(t.school, 34)}
          <div><b>${esc(t.school)}</b><br><small>${recTxt(t)} · ${t.avg.toFixed(2)} avg</small></div>
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
        <div class="big">${recTxt(lead)} · ${lead.avg.toFixed(2)} avg</div></div></div>
    </div>
    <div class="hl-list">${rest.slice(0, 4).map((t, i) => `
      <div class="hl-row" data-team="${esc(t.school)}" data-g="${g}"><span class="n">${i + 2}</span>${logo(t.school, 30)}
        <span class="nm">${esc(t.school)}<small>${recTxt(t)} · ${esc(t.region)}</small></span><span class="avg mono">${t.avg.toFixed(2)}</span></div>`).join("")}
    </div>
    <a class="hl-foot" href="#/${g}/${c}">Full ${divName(g, c)} rankings →</a>
  </div>`;
}

// ---------- how it works ----------
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
    <h1>How the <span>power rankings</span> work</h1>
    <div class="sub">Every game earns power points. A team's rating is its total points divided by games played, and teams are ranked by rating within their class.</div>
  </div></section>
  <div class="wrap" style="margin-top:24px">
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
    <div class="sub">${ts.length} teams · games through ${fmtDate(D.sports[r.g].through, {month: "long", day: "numeric"})} · ranked by rating (power points per game)</div>
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
          <option value="rank">Power ranking</option><option value="record">Record (win %)</option>
          <option value="sos">Strength of schedule</option><option value="pts">Total points</option><option value="gd">${C.score.name}</option><option value="school">Team name</option>
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
  const maxAvg = Math.max(...ts.map(t => t.avg)) || 1;
  if (!list.length) { el.innerHTML = `<div class="empty">No teams match “${esc(query)}”.</div>`; return; }
  if (r.view === "region") {
    const classes = r.c === "All" ? CLASSES : [r.c];
    el.innerHTML = `<div class="regions">${classes.map(c => {
      const cards = REGION_ORDER.map(reg => {
        const all = ts.filter(t => t.cls === c && t.region === reg);
        const shown = sorted(list.filter(t => t.cls === c && t.region === reg));
        if (!shown.length) return "";
        const regAvg = all.reduce((s, t) => s + t.avg, 0) / all.length;
        return `<div class="rcard"><div class="rhead"><h3>${r.c === "All" ? `<span>${cl(c)}</span> ` : ""}${reg}</h3><small>${all.length} teams · avg ${regAvg.toFixed(2)}</small></div>
          ${shown.map(t => `<div class="rrow" data-team="${esc(t.school)}">
            ${rkBadge(all.indexOf(t) + 1)}${logo(t.school, 32)}
            <div><div class="nm">${esc(t.school)}</div><div class="meta">${rec(t)}<span class="pct mono">${pctStr(t)}</span> · SOS ${t.sos.toFixed(2)}</div></div>
            <div class="ov">#${t.rank}<br>in ${cl(t.cls)}</div><span class="avg mono">${t.avg.toFixed(2)}</span></div>`).join("")}</div>`;
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
    {key: "pts", label: "Points", cls: "num hide-lg"},
    {key: "sos", label: "SOS", cls: "num hide-xs", title: "Strength of schedule: average points per game if every game had been a win"},
    {key: "avg", label: "Rating", cls: "num"},
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
      <td class="num hide-xs"><span class="sos mono">${t.sos.toFixed(2)}</span><span class="sosrk mono">#${r.c === "All" ? t.sosStateRank : t.sosRank}</span></td>
      <td class="num"><div class="avgcell"><div class="bar"><i style="width:${(t.avg / maxAvg * 100).toFixed(1)}%"></i></div><span class="avg mono">${t.avg.toFixed(2)}</span></div></td>
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
// Region seeds by rating; the top seeds win out, so No. 1 and No. 2 in each region reach the
// state quarterfinals, which are reseeded 1-8 by rating. "Projected" uses ratings after the
// rest of the regular season is played out with the higher-ranked team winning (t.proj).
function seeding(c, projected) {
  const val = t => projected ? t.proj : t;
  const order = (a, b) => val(b).avg - val(a).avg || val(b).pts - val(a).pts || a.stateRank - b.stateRank;
  const ts = teamsOf(DEF, c);
  const regions = REGION_ORDER.map(reg => ({reg, teams: ts.filter(t => t.region === reg).sort(order)}));
  const final8 = regions.flatMap(x => x.teams.slice(0, C.playoffs.per_region)).sort(order);
  const regionSeed = new Map(regions.flatMap(x => x.teams.map((t, i) => [t, i + 1])));
  return {val, regions, final8, regionSeed};
}
// Rounds of seed matchups (1v8, 4v5, 2v7, 3v6, then winners), higher seed advancing
function bracketRounds(n) {
  let games = [[1, 8], [4, 5], [2, 7], [3, 6]].filter(([a]) => a <= n);
  const rounds = [];
  while (games.length) {
    rounds.push(games);
    if (games.length === 1) break;
    const w = games.map(g => Math.min(...g));
    games = w.reduce((acc, x, i) => (i % 2 ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);
  }
  return rounds;
}
function renderFinal8(r) {
  const projected = r.view === "projected";
  const {val, regions, final8, regionSeed} = seeding(r.c, projected);
  const slot = (seed, cls = "") => {
    const t = final8[seed - 1];
    if (!t) return `<div class="slot tbd ${cls}"><span class="seed mono">${seed}</span><span class="nm">TBD</span></div>`;
    return `<div class="slot ${cls}" data-team="${esc(t.school)}"><span class="seed mono">${seed}</span>${logo(t.school, 26)}
      <span class="nm">${esc(t.school)}<small>${esc(t.region)} #${regionSeed.get(t)} · ${recTxt(val(t))}</small></span>
      <span class="avg mono">${val(t).avg.toFixed(2)}</span></div>`;
  };
  const rounds = bracketRounds(final8.length);
  const champ = rounds.length ? Math.min(...rounds[rounds.length - 1][0]) : null;
  const names = ["State quarterfinals", "Semifinals", "Final"];
  const bracket = `<div class="bracket">${rounds.map((games, i) => `
    <div class="bcol"><h4>${names[i]}</h4><div class="bgames">${games.map(([a, b]) => `
      <div class="match">${slot(a, a < b ? "win" : "lose")}${slot(b, b < a ? "win" : "lose")}</div>`).join("")}</div></div>`).join("")}
    <div class="bcol champ"><h4>Champion</h4><div class="bgames">${champ ? `<div class="match">${slot(champ, "win")}</div>` : ""}</div></div>
  </div>`;
  const regionCards = regions.map(({reg, teams}) => `<div class="rcard"><div class="rhead"><h3>${reg}</h3><small>${teams.length} teams · top ${C.playoffs.region_seeds} make region playoffs</small></div>
    ${teams.map((t, i) => {
      const adv = i < C.playoffs.per_region, inPO = i < C.playoffs.region_seeds;
      return `<div class="rrow ${inPO ? "" : "out"}" data-team="${esc(t.school)}">${rkBadge(i + 1)}${logo(t.school, 32)}
        <div><div class="nm">${esc(t.school)}</div><div class="meta">${rec(val(t))} · ${val(t).gp} GP${projected && t.upcoming.length ? ` · ${t.gp} played` : ""}</div></div>
        <div class="ov">${adv ? `<span class="adv">Final 8 · #${final8.indexOf(t) + 1}</span>` : inPO ? "" : "Out"}</div>
        <span class="avg mono">${val(t).avg.toFixed(2)}</span></div>`;
    }).join("")}</div>`).join("");
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>Final 8</span><span>/</span><span>Class ${cl(r.c)}</span></div>
    <h1>${cl(r.c)} <span>Final 8</span> picture</h1>
    <div class="sub">${projected ? "Projected: the rest of the regular season played out with the higher-ranked team winning every game."
      : `Current: ratings through ${fmtDate(D.sports[DEF].through, {month: "long", day: "numeric"})}.`}
      Top ${C.playoffs.per_region} per region advance; the Final 8 are reseeded by rating.</div>
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
    <div class="section-head"><div><div class="eyebrow">Region seeding</div><h2>${cl(r.c)} regions</h2>
      <p>Each region's top ${C.playoffs.region_seeds} play two rounds (1v8, 4v5, 2v7, 3v6). Assuming the top seeds win, No. 1 and No. 2 advance to the Final 8.</p></div></div>
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
      <div class="tile"><b class="mono">${t.avg.toFixed(2)}</b><span>Rating</span></div>
      <div class="tile"><b class="mono">${t.sos.toFixed(2)}</b><span title="Strength of schedule">SOS · #${t.sosRank} in ${cl(t.cls)}</span></div>
      <div class="tile"><b class="mono">${n2(t.pts)}</b><span>Power points</span></div>
      <div class="tile"><b class="mono">${recTxt(t)}</b><span>Record · ${pctStr(t)}</span></div>
      <div class="tile"><b class="mono">${t.gf}–${t.ga}</b><span>${C.score.short}</span></div>
    </div>
    ${best ? `<div class="sect">Best result</div><div class="best">${logo(best.opp, 40)}<div><b>${best.res === "W" ? "Beat" : "Tied"} ${esc(best.opp)}</b> ${best.gf}–${best.ga} on ${fmtDate(best.date)}<div class="muted" style="font-size:13px">Worth ${n2(best.pts)} power points</div></div></div>` : ""}
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
    <div class="right"><div class="pts">win worth</div><div class="mono worth">${n2(worth)} <span class="pts">pts</span></div></div>
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
    : r.page === "final8" ? `${cl(r.c)} Final 8 · ` : "") + `Maryland Public High Schools ${C.sport} Power Rankings`;
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
