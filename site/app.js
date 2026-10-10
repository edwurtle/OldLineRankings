(() => {
const D = window.DATA;
const SCHOOLS = D.schools;
const CLASSES = ["4A", "3A", "2A", "1A"];
const GENDERS = {boys: "Boys", girls: "Girls"};
const REGION_ORDER = ["East I", "East II", "North I", "North II", "South I", "South II", "West I", "West II"];
const app = document.getElementById("app");

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmtDate = (d, opts = {month: "short", day: "numeric"}) => new Date(d + "T12:00:00").toLocaleDateString(undefined, opts);
const n2 = x => (Math.round(x * 100) / 100).toString();          // 3.75, 4.5, 6
const winPct = t => t.gp ? (t.W + 0.5 * t.T) / t.gp : 0;
const pctStr = t => winPct(t).toFixed(3).replace(/^0/, "");
const rec = t => `<span class="rec mono"><span class="w">${t.W}</span>-<span class="l">${t.L}</span>-<span class="t">${t.T}</span></span>`;
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

// ---------- routing: #/  #/how  #/boys/2A?view=region&team=Glenelg ----------
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const p = new URLSearchParams(qs || "");
  if (parts[0] in GENDERS) {
    const c = (parts[1] || "4A").toUpperCase();
    return {page: "rank", g: parts[0], c: c === "ALL" ? "All" : c, view: p.get("view") || "overall", team: p.get("team")};
  }
  return {page: parts[0] === "how" ? "how" : "home", team: p.get("team"), g: p.get("g") || "boys"};
}
function href(r) {
  if (r.page !== "rank") return "#/" + (r.page === "how" ? "how" : "");
  const p = new URLSearchParams();
  if (r.view && r.view !== "overall") p.set("view", r.view);
  if (r.team) p.set("team", r.team);
  return `#/${r.g}/${r.c}` + (p.toString() ? "?" + p : "");
}
function go(patch, replace = false) {
  const r = Object.assign(parseRoute(), patch);
  let h;
  if (r.page === "rank") h = href(r);
  else { const p = new URLSearchParams(); if (r.team) { p.set("team", r.team); p.set("g", r.g); } h = "#/" + (r.page === "how" ? "how" : "") + (p.toString() ? "?" + p : ""); }
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
let homeGender = "boys";
function renderHome() {
  const totalTeams = Object.values(D.sports).reduce((s, x) => s + x.teams.length, 0);
  const totalGames = Object.values(D.sports).reduce((s, x) => s + new Set(x.teams.flatMap(t => t.games.map(g => g.date + [t.school, g.opp].sort().join("|")))).size, 0);
  const unbeatenCount = Object.values(D.sports).reduce((s, x) => s + x.teams.filter(t => t.L === 0 && t.gp >= 5).length, 0);
  app.innerHTML = `
  <section class="hero">
    <div class="hero-inner">
      <div>
        <div class="eyebrow">Fall ${throughAll.slice(0, 4)} · Boys & Girls Soccer</div>
        <h1>Maryland Public<br>High Schools <span>Power Rankings</span></h1>
        <p>Every public high school soccer team in the state, ranked by who they beat. Strength of schedule is built in: a win over a 4A team with a winning record counts for more than a win over a winless 1A team.</p>
        <div class="cta">
          <a class="btn gold" href="#/boys/4A">Boys rankings →</a>
          <a class="btn red" href="#/girls/4A">Girls rankings →</a>
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
      <div class="section-head"><div><div class="eyebrow">Choose a division</div><h2>Jump to rankings</h2></div></div>
      <div class="picker">${Object.entries(GENDERS).map(([g, label]) => `
        <div class="pick ${g}">
          <div class="pick-head"><h3><i></i>${label}</h3><a href="#/${g}/All">All classes →</a></div>
          <div class="pick-grid">${CLASSES.map(c => {
            const ts = teamsOf(g, c), top = ts[0];
            return `<a class="cls-tile" href="#/${g}/${c}">
              <span class="cls-big">${c}</span>
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
        <div class="gender-tabs" role="tablist">${Object.entries(GENDERS).map(([g, l]) => `<button data-hg="${g}" aria-selected="${g === homeGender}">${l}</button>`).join("")}</div>
      </div>
      <div class="hl-grid">${CLASSES.map(c => highlightCard(homeGender, c)).join("")}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Still perfect</div><h2>Unbeaten ${GENDERS[homeGender]}</h2><p>No losses with at least five games played, ordered by power rating.</p></div></div>
      <div class="unbeaten">${D.sports[homeGender].teams.filter(t => t.L === 0 && t.gp >= 5).map(t => `
        <div class="ub" data-team="${esc(t.school)}" data-g="${homeGender}">${logo(t.school, 34)}
          <div><b>${esc(t.school)}</b><br><small>${t.W}-${t.L}-${t.T} · ${t.avg.toFixed(2)} avg</small></div>
          <span class="tag">${t.cls}</span></div>`).join("") || `<div class="muted">No unbeaten teams.</div>`}
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
      <div class="row"><span class="hl-cls"><b>${c}</b> ${GENDERS[g]}</span><span class="hl-crown">★ No. 1</span></div>
      <div class="hl-lead" data-team="${esc(lead.school)}" data-g="${g}">${logo(lead.school, 64)}
        <div><h4>${esc(lead.school)}</h4><div class="sub">${esc(subline(lead.school))}</div>
        <div class="big">${lead.W}-${lead.L}-${lead.T} · ${lead.avg.toFixed(2)} avg</div></div></div>
    </div>
    <div class="hl-list">${rest.slice(0, 4).map((t, i) => `
      <div class="hl-row" data-team="${esc(t.school)}" data-g="${g}"><span class="n">${i + 2}</span>${logo(t.school, 30)}
        <span class="nm">${esc(t.school)}<small>${t.W}-${t.L}-${t.T} · ${esc(t.region)}</small></span><span class="avg mono">${t.avg.toFixed(2)}</span></div>`).join("")}
    </div>
    <a class="hl-foot" href="#/${g}/${c}">Full ${c} ${GENDERS[g].toLowerCase()} rankings →</a>
  </div>`;
}

// ---------- how it works ----------
function renderHow() {
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>How it works</span></div>
    <h1>How the <span>power rankings</span> work</h1>
    <div class="sub">One number per team: average power points earned per game played.</div>
  </div></section>
  <div class="wrap" style="margin-top:-40px;position:relative;z-index:2">
    <div class="how-grid">
      <div class="how-card w"><div class="k">Win</div><h4>Class + opponent's wins</h4><p>1 point for beating a 1A team, 2 for 2A, 3 for 3A, 4 for 4A, plus 1 point for every game your opponent has won this season.</p></div>
      <div class="how-card t"><div class="k">Tie</div><h4>Half a win</h4><p>A tie earns half of what a win against that opponent would have earned. Ties also count as half a win in an opponent's win total.</p></div>
      <div class="how-card l"><div class="k">Loss</div><h4>Zero points</h4><p>Losses earn nothing but still count as a game played, which pulls your average down.</p></div>
    </div>
    <div class="example">
      <b>Example:</b> A 2A team beats a 3A opponent that is 7-2-1 on the season. That win is worth <b>3 + 7.5 = 10.5</b> points. Had it been a tie, it would be worth <b>5.25</b>.
      Each team's rating is its total power points divided by games played, and teams are ranked within their class.
    </div>
    <div class="example">
      <b>Strength of schedule (SOS):</b> the rating a team would have if it had won every game it played, i.e. the average of
      (opponent class + opponent wins) across its schedule. It measures how tough the schedule is regardless of results.
      Comparing a team's rating to its SOS shows how much of the available credit it actually earned.
    </div>
    <div class="example">
      <b>Fine print:</b> Opponent win totals are for the full season to date, so ratings keep changing as opponents play more games.
      Opponents from outside Maryland public schools (private schools, out of state) count as class 1 with 0 wins.
      Forfeits count as wins and losses. Records are calculated from game-by-game results, so they may differ slightly from official standings.
    </div>
  </div>`;
}

// ---------- rankings page ----------
function renderRank(r) {
  const key = r.g + r.c;
  if (key !== lastPage) { query = ""; sort = {key: "rank", dir: 1}; lastPage = key; }
  const ts = teamsOf(r.g, r.c).map(t => Object.assign(t, {__rank: r.c === "All" ? t.stateRank : t.rank}));
  const title = r.c === "All" ? `All Classes <span>${GENDERS[r.g]}</span>` : `${r.c} <span>${GENDERS[r.g]}</span> Soccer`;
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/${r.g}/4A">${GENDERS[r.g]}</a><span>/</span><span>${r.c === "All" ? "All classes" : "Class " + r.c}</span></div>
    <h1>${title}</h1>
    <div class="sub">${ts.length} teams · games through ${fmtDate(D.sports[r.g].through, {month: "long", day: "numeric"})} · ranked by average power points per game</div>
    <div class="switches">
      <div class="pill-group ${r.g === "girls" ? "red" : ""}">${Object.entries(GENDERS).map(([g, l]) => `<a class="${g === r.g ? "on" : ""}" href="${href({...r, g, team: null})}">${l}</a>`).join("")}</div>
      <div class="pill-group">${[...CLASSES, "All"].map(c => `<a class="${c === r.c ? "on" : ""}" href="${href({...r, c, team: null})}">${c}</a>`).join("")}</div>
    </div>
  </div></section>
  <div class="wrap">
    <div class="podium">${ts.slice(0, 3).map((t, i) => `
      <div class="pod" style="--team:${teamColor(t.school)}" data-team="${esc(t.school)}">
        ${logo(t.school, 56)}
        <div><div class="place">${["1st", "2nd", "3rd"][i]}${r.c === "All" ? " · " + t.cls : ""} · ${esc(t.region)}</div><h3>${esc(t.school)}</h3><div class="stats">${t.W}-${t.L}-${t.T} · SOS ${t.sos.toFixed(2)}</div></div>
        <div class="avg-big"><b>${t.avg.toFixed(2)}</b><small>avg</small></div>
      </div>`).join("")}
    </div>
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
          <option value="sos">Strength of schedule</option><option value="pts">Total points</option><option value="gd">Goal difference</option><option value="school">Team name</option>
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
        return `<div class="rcard"><div class="rhead"><h3>${r.c === "All" ? `<span>${c}</span> ` : ""}${reg}</h3><small>${all.length} teams · avg ${regAvg.toFixed(2)}</small></div>
          ${shown.map(t => `<div class="rrow" data-team="${esc(t.school)}">
            ${rkBadge(all.indexOf(t) + 1)}${logo(t.school, 32)}
            <div><div class="nm">${esc(t.school)}</div><div class="meta">${rec(t)}<span class="pct mono">${pctStr(t)}</span> · SOS ${t.sos.toFixed(2)}</div></div>
            <div class="ov">#${t.rank}<br>in ${t.cls}</div><span class="avg mono">${t.avg.toFixed(2)}</span></div>`).join("")}</div>`;
      }).join("");
      return cards ? (r.c === "All" ? `<div class="class-label">Class ${c}</div>` : "") + cards : "";
    }).join("")}</div>`;
    return;
  }
  const cols = [
    {key: "rank", label: "#"}, {key: "school", label: "Team"},
    ...(r.c === "All" ? [{key: "cls", label: "Class"}] : []),
    {key: "region", label: "Region", cls: "hide-sm"}, {key: "record", label: "Record"},
    {key: "gp", label: "GP", cls: "num hide-sm"}, {key: "gd", label: "GF–GA", cls: "num hide-sm"},
    {key: "pts", label: "Points", cls: "num hide-sm"},
    {key: "sos", label: "SOS", cls: "num", title: "Strength of schedule: average points per game if every game had been a win"},
    {key: "avg", label: "Rating", cls: "num"},
  ];
  el.innerHTML = `<div class="table-wrap"><table><thead><tr>${cols.map(c =>
    `<th class="${c.cls || ""} ${sort.key === c.key ? "active" : ""}" data-sort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${c.label}<span class="arrow">${sort.key === c.key ? (sort.dir > 0 ? "▲" : "▼") : "↕"}</span></th>`).join("")}
  </tr></thead><tbody>${sorted(list).map(t => `
    <tr data-team="${esc(t.school)}">
      <td>${rkBadge(t.__rank)}</td>
      <td><div class="teamcell">${logo(t.school, 34)}<div><div class="nm">${esc(t.school)}</div><small>${esc(subline(t.school))}</small></div></div></td>
      ${r.c === "All" ? `<td><span class="tag cls">${t.cls}</span></td>` : ""}
      <td class="hide-sm"><span class="tag">${esc(t.region)}</span></td>
      <td>${rec(t)}<span class="pct mono">${pctStr(t)}</span></td>
      <td class="num mono hide-sm">${t.gp}</td>
      <td class="num mono hide-sm">${t.gf}–${t.ga}</td>
      <td class="num mono hide-sm">${n2(t.pts)}</td>
      <td class="num"><span class="sos mono">${t.sos.toFixed(2)}</span><span class="sosrk mono">#${r.c === "All" ? t.sosStateRank : t.sosRank}</span></td>
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

// ---------- team drawer ----------
const drawer = document.getElementById("drawer"), scrim = document.getElementById("scrim");
function openTeam(g, name) {
  const t = findTeam(g, name);
  if (!t) return closeDrawer();
  const s = SCHOOLS[name] || {};
  const regionRank = D.sports[g].teams.filter(x => x.cls === t.cls && x.region === t.region).indexOf(t) + 1;
  document.getElementById("dHead").style.setProperty("--team", teamColor(name));
  document.getElementById("dLogo").innerHTML = logo(name, 76);
  document.getElementById("dEyebrow").textContent = `${GENDERS[g]} ${t.cls} · #${t.rank} in class · #${regionRank} in ${t.region} · #${t.stateRank} statewide`;
  document.getElementById("dName").textContent = name;
  document.getElementById("dMeta").textContent = [s.mascot, s.city, s.county && s.county + (/(City|County)$/.test(s.county) ? "" : " County")].filter(Boolean).join(" · ");
  document.getElementById("dForm").innerHTML = t.games.map(x => `<i class="${x.res}" title="${esc(fmtDate(x.date) + " vs " + x.opp)}">${x.res}</i>`).join("");
  const scoring = t.games.filter(x => x.pts > 0);
  const best = scoring.length ? scoring.reduce((a, b) => b.pts > a.pts ? b : a) : null;
  document.getElementById("dBody").innerHTML = `
    <div class="tiles">
      <div class="tile"><b class="mono">${t.avg.toFixed(2)}</b><span>Rating</span></div>
      <div class="tile"><b class="mono">${t.sos.toFixed(2)}</b><span title="Strength of schedule">SOS · #${t.sosRank} in ${t.cls}</span></div>
      <div class="tile"><b class="mono">${n2(t.pts)}</b><span>Power points</span></div>
      <div class="tile"><b class="mono">${t.W}-${t.L}-${t.T}</b><span>Record · ${pctStr(t)}</span></div>
      <div class="tile"><b class="mono">${t.gf}–${t.ga}</b><span>GF–GA</span></div>
    </div>
    ${best ? `<div class="sect">Best result</div><div class="best">${logo(best.opp, 40)}<div><b>${best.res === "W" ? "Beat" : "Tied"} ${esc(best.opp)}</b> ${best.gf}–${best.ga} on ${fmtDate(best.date)}<div class="muted" style="font-size:13px">Worth ${n2(best.pts)} power points</div></div></div>` : ""}
    <div class="sect">Games played (${t.gp})</div>
    ${[...t.games].reverse().map(x => gameRow(g, t, x)).join("") || `<div class="muted">No games yet.</div>`}`;
  document.getElementById("dBody").scrollTop = 0;
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); scrim.classList.add("open");
}
function gameRow(g, t, x) {
  const opp = x.member ? findTeam(g, x.opp) : null;
  const name = opp && x.opp !== t.school ? `<button data-team="${esc(x.opp)}">${esc(x.opp)}</button>` : esc(x.opp);
  const ctag = opp ? `<span class="ctag">${opp.cls}</span>` : `<span class="ctag nm">Non-public / out of state</span>`;
  const orec = opp ? `<span class="mono">${opp.W}-${opp.L}-${opp.T}</span><span>${esc(opp.region)}</span>` : "";
  const raw = x.res === "T" ? [x.cp * 2, x.ow * 2] : [x.cp, x.ow];
  const calc = x.res === "W" ? `<span class="mono">${n2(raw[0])} + ${n2(raw[1])} =</span> <b class="mono">${n2(x.pts)}</b>`
    : x.res === "T" ? `<span class="mono">½ × (${n2(raw[0])} + ${n2(raw[1])}) =</span> <b class="mono">${n2(x.pts)}</b>` : `<span class="mono">of ${n2(x.max)}</span> <b class="mono">0</b>`;
  return `<div class="game">
    <div class="res ${x.res}">${x.res}</div>${logo(x.opp, 34)}
    <div><div class="opp">${x.home ? "vs" : "@"} ${name}</div>
      <div class="det"><span>${fmtDate(x.date)}</span>${ctag}${orec}${x.ff ? "<span>Forfeit</span>" : ""}</div></div>
    <div class="right"><div class="score mono">${x.gf ?? "–"}–${x.ga ?? "–"}</div><div class="pts">${calc} pts</div></div>
  </div>`;
}
function closeDrawer() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); scrim.classList.remove("open"); }

// ---------- render & events ----------
function render() {
  const r = parseRoute();
  const pageKey = r.page + (r.page === "rank" ? r.g + r.c + r.view : "") + (r.page === "home" ? homeGender : "");
  if (pageKey !== render.lastKey) {
    if (r.page === "rank") renderRank(r); else if (r.page === "how") renderHow(); else renderHome();
    if (render.lastKey && r.page !== render.lastPage) window.scrollTo(0, 0);
    render.lastKey = pageKey; render.lastPage = r.page;
  }
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", r.page === "rank" ? a.dataset.nav === r.g : a.dataset.nav === r.page));
  document.title = (r.page === "rank" ? `${r.c === "All" ? "All Classes" : r.c} ${GENDERS[r.g]} Soccer · ` : "") + "Maryland Public High Schools Power Rankings";
  if (r.team) openTeam(r.page === "rank" ? r.g : r.g || "boys", r.team); else closeDrawer();
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
