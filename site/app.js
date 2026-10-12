(() => {
const D = window.DATA;
const C = D.config;                          // per-sport settings from scripts/build.py
const SCHOOLS = D.schools;
const CLASSES = Object.keys(C.classes);      // highest first
const GENDERS = C.divisions;                 // e.g. {boys: "Boys", girls: "Girls"} or {football: "Football"}
const DIVS = Object.keys(GENDERS), DEF = DIVS[0], MULTI = DIVS.length > 1;
const REGION_ORDER = C.regions;
const NONMEMBER_PTS = Math.min(...Object.values(C.classes));
// Football's playoffs are seeded by these very points; soccer's are seeded by winning percentage only
const SEEDS_BY_POINTS = C.playoffs?.seed_by === "mpssaa";
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
// NFHS Network broadcast link (live or replay) for a game, when one exists
const watchBtn = g => g.watch ? `<a class="watch" href="${esc(g.watch)}" target="_blank" rel="noopener" title="Watch on NFHS Network">▶ Watch</a>` : "";
// GoFan ticket link, only for games that haven't happened yet
const TODAY = new Date().toLocaleDateString("en-CA");
// `game` describes the matchup for the ticket warning ("Linganore vs Urbana")
const ticketBtn = (g, game) => g.tickets && g.date >= TODAY ? `<a class="tix" href="${esc(g.tickets)}" target="_blank" rel="noopener" title="Buy tickets on GoFan"
  data-game="${esc(game)}" data-when="${esc(fmtDate(g.date, {weekday: "long", month: "long", day: "numeric"}) + (g.time ? " · " + fmtTime(g.time) : ""))}">Tickets</a>` : "";
const fmtTime = t => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
// Ticket links are matched automatically, so every Tickets click first asks the buyer to check the game on GoFan
document.addEventListener("click", e => {
  const a = e.target.closest("a.tix");
  if (!a) return;
  e.preventDefault();
  let m = document.getElementById("tixModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "tixModal"; m.className = "modal";
    m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="tixTitle">
      <h3 id="tixTitle">Check the game before you buy</h3>
      <p class="tix-game"><b></b><br><span></span></p>
      <p>Tickets are sold by <b>GoFan</b>, not Old Line Rankings. We match games to GoFan automatically, so please make sure the
        teams, date and time on GoFan are the game you want before buying. Old Line Rankings isn't responsible for purchases made through these links.</p>
      <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><a class="btn gold" target="_blank" rel="noopener" data-go>Continue to GoFan →</a></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", ev => { if (ev.target === m || ev.target.closest("[data-close], [data-go]")) m.classList.remove("open"); });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") m.classList.remove("open"); });
  }
  m.querySelector(".tix-game b").textContent = a.dataset.game;
  m.querySelector(".tix-game span").textContent = a.dataset.when;
  m.querySelector("[data-go]").href = a.href;
  m.classList.add("open");
  m.querySelector("[data-go]").focus();
});
// Ranking number: MPSSAA points per game (soccer) or the Old Line Rating (football, C.olr)
const OLR = !!C.olr;
// Every sport's ranking number is its Old Line Rating; only the formula differs (see How it works)
const RATING = "Old Line Rating", RATING_SHORT = "OLR";
const fmtR = x => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(C.olr.digits || 1);
const pct = x => x >= 99.5 && x < 100 ? ">99%" : x > 0 && x < 0.5 ? "<1%" : Math.round(x) + "%";
// Chance team a beats b (football): logistic in the OLR difference, home edge from the fit
const oppRating = (g, name) => findTeam(g, name)?.rating ?? D.sports[g].nonmember?.[name] ?? 0;
// One game's contribution to the Old Line Rating: capped margin ± win bonus + opponent's rating − home edge
function gameScore(g, x) {
  const o = C.olr, margin = x.ff || x.gf == null || x.ga == null ? 0 : Math.max(-o.cap, Math.min(o.cap, x.gf - x.ga));
  const bonus = o.win_bonus * {W: 1, L: -1, T: 0}[x.res], opp = oppRating(g, x.opp), home = (D.sports[g].home || 0) * (x.home ? 1 : -1);
  return {margin, bonus, opp, home, score: margin + bonus + opp - home};
}
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
document.getElementById("navLinks").innerHTML = DIVS.map(g => `<a href="#/${g}/All" data-nav="${g}">${MULTI ? GENDERS[g] : "Rankings"}</a>`).join("") +
  `<a href="#/schedule" data-nav="schedule">Schedule</a>` +
  (C.playoffs ? `<a href="#/final8" data-nav="final8">Playoffs</a>` : "") + `<a href="#/how" data-nav="how">How it works</a>`;
// Footer sport switcher: every Old Line Rankings sport, current one highlighted, coming-soon ones dimmed
document.getElementById("family").innerHTML = C.family.sports.map(s => s.href
  ? `<a href="${esc(s.href)}" class="${s.current ? "on" : ""}"${s.current ? ` aria-current="page"` : ""}>${s.icon}${esc(s.sport)}</a>`
  : `<span class="soon" title="${esc(s.note || "")}">${s.icon}${esc(s.sport)} <small>soon</small></span>`).join("");

// ---------- routing: #/  #/how  #/boys/2A?view=region&team=Glenelg  #/final8/4A?view=projected ----------
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const p = new URLSearchParams(qs || "");
  const cls = def => { const c = (parts[1] || def).toUpperCase(); return c === "ALL" ? "All" : c; };
  if (parts[0] in GENDERS)
    return {page: "rank", g: parts[0], c: cls("All"), view: p.get("view") || "overall", team: p.get("team")};
  if (parts[0] === "final8" && C.playoffs)
    return {page: "final8", g: p.get("g") in GENDERS ? p.get("g") : DEF, c: cls(CLASSES[0]), view: p.get("view") || "current", team: p.get("team")};
  return {page: ["how", "schedule"].includes(parts[0]) ? parts[0] : "home", team: p.get("team"), g: p.get("g") || DEF};
}
function href(r) {
  const p = new URLSearchParams();
  if (r.page === "rank" || r.page === "final8") {
    if (r.page === "final8" && MULTI && r.g !== DEF) p.set("g", r.g);
    if (r.view && r.view !== {rank: "overall", final8: "current"}[r.page]) p.set("view", r.view);
    if (r.team) p.set("team", r.team);
    return `#/${r.page === "rank" ? r.g : "final8"}/${r.c}` + (p.toString() ? "?" + p : "");
  }
  if (r.team) { p.set("team", r.team); if (MULTI) p.set("g", r.g); }
  return "#/" + (["how", "schedule"].includes(r.page) ? r.page : "") + (p.toString() ? "?" + p : "");
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
        <h1>Old Line<br><span>${C.sport} Rankings</span></h1>
        <p>${OLR ? `Every public high school ${C.sport.toLowerCase()} team in the state, ranked by the Old Line Rating: how much better than average a team is, built from capped scoring margins and the strength of every opponent.${SEEDS_BY_POINTS ? " MPSSAA playoff points are tracked alongside for seeding." : ""}`
          : `Every public high school ${C.sport.toLowerCase()} team in the state, ranked by who they beat. Strength of schedule is built in: a win over a ${CLASSES[0]} team with a winning record counts for more than a win over a winless ${CLASSES[CLASSES.length - 1]} team.`}</p>
        <div class="cta">
          ${DIVS.map((g, i) => `<a class="btn ${i ? "red" : "gold"}" href="#/${g}/All">${MULTI ? GENDERS[g] + " rankings" : "Rankings"} →</a>`).join("")}
          ${C.playoffs ? `<a class="btn red" href="#/final8">Playoffs →</a>` : ""}
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
        <div><div class="eyebrow">Top of the table</div><h2>Leaders by class</h2><p>The top five in every class by Old Line Rating.</p></div>
        ${MULTI ? `<div class="gender-tabs" role="tablist">${Object.entries(GENDERS).map(([g, l]) => `<button data-hg="${g}" aria-selected="${g === homeGender}">${l}</button>`).join("")}</div>` : ""}
      </div>
      <div class="hl-grid" style="--n:${CLASSES.length > 4 ? 3 : CLASSES.length}">${CLASSES.map(c => highlightCard(homeGender, c)).join("")}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Still perfect</div><h2>Unbeaten ${MULTI ? GENDERS[homeGender] : "teams"}</h2><p>No losses with at least five games played, ordered by Old Line Rating.</p></div></div>
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
// Sections: Old Line Rating (every sport, worded from C.olr), MPSSAA points (sports seeded by them), Playoffs.
const howHead = (eyebrow, title, blurb) => `<div class="section-head"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2><p>${blurb}</p></div></div>`;
function howOLR() {
  const o = C.olr, u = C.score.plural, one = u.replace(/s$/, ""), home = D.sports[DEF].home || 0;
  const [hi, lo] = o.example, spread = hi - lo, p = 1 / (1 + Math.exp(-o.k * spread));
  const r = x => fmtR(x);
  return `<section class="how-section">
    ${howHead("The ranking", "Old Line Rating", `How many ${u} better than an average Maryland public school team a team is, judged by every game it has played.`)}
    <div class="how-grid" style="--n:${o.win_bonus ? 3 : 2}">
      <div class="how-card w"><div class="k">Margin</div><h4>Capped at ${o.cap}</h4><p>Each game counts the ${one} margin, capped at ${o.cap} ${u} (${o.cap_note}), so running up the score doesn't help.</p></div>
      ${o.win_bonus ? `<div class="how-card w"><div class="k">Result</div><h4>±${o.win_bonus} for the win</h4><p>A win adds ${o.win_bonus} ${u} and a loss subtracts ${o.win_bonus}, so a close win counts well ahead of a close loss.</p></div>` : ""}
      <div class="how-card w"><div class="k">Opponents</div><h4>Strength built in</h4><p>A team's Old Line Rating is its average game score plus the average Old Line Rating of the teams it played, solved for every team at once. Beating a good team is worth more, by exactly how good it is.</p></div>
    </div>
    <div class="example"><b>Reading it:</b> ${r(hi)} means about ${hi} ${u} better than an average team. The difference between two Old Line Ratings works like a point spread:
      a ${r(hi)} team is about a ${spread}-${one} favorite over a ${r(lo)} team, roughly a ${Math.round(100 * p)}% chance to win. Those chances drive the projected playoff brackets and each team's Final 8 odds.
      Tap a team's Old Line Rating in its team card to see every game that went into it.</div>
    <div class="example"><b>Strength of schedule (SOS):</b> the average Old Line Rating of the teams a team has played.</div>
    <div class="example"><b>Fine print:</b> Every Old Line Rating is pulled toward its class average by ${o.prior} games' worth, so two big early wins don't make a team No. 1.
      Home field is measured from this season's results (currently ${home ? "+" + home.toFixed(1) + " " + u : "no measurable edge"}).
      Out-of-state and private opponents are rated from their games against Maryland teams. Forfeits count as a win or loss with no margin.
      Tested on ${o.tested}.</div>
  </section>`;
}
function howFinal8() {
  const pl = C.playoffs, champs = pl.per_region === 1;
  return `<section class="how-section">
    ${howHead("Playoffs page", OLR ? "Playoffs & odds" : "Playoffs", "Region play and the Final 8 (state quarterfinals), seeded the way the MPSSAA seeds.")}
    <div class="example"><b>Seeding:</b> ${champs
      ? `every team is seeded in its region by regular-season winning percentage (ties count as half a win; teams with fewer than ${pl.min_games} games divide by ${pl.min_games}).
         Each of the ${REGION_ORDER.length} regions plays a single-elimination bracket down to one champion, with byes for the top seeds in smaller regions.
         The ${REGION_ORDER.length} region champions make the Final 8 and are reseeded 1–8 by winning percentage.`
      : `in each class, the top ${pl.region_seeds} teams in each of the ${REGION_ORDER.length} regions by MPSSAA points play two region rounds (1v8, 4v5, 2v7, 3v6).
         The two survivors from each region reach the state quarterfinals (the Final 8), which are reseeded 1–8 by MPSSAA points.`}
      Teams tied on ${SEED.name} are separated by head-to-head result; if they didn't play each other the MPSSAA flips a coin,
      and we use the Old Line Rating in its place.</div>
    <div class="example"><b>Current:</b> today's seeds and first-round matchups for every region. Later rounds and the Final 8 bracket stay empty until games are played.</div>
    <div class="example"><b>Projected:</b> every remaining game, regular season and playoffs, goes to the team with the higher Old Line Rating, and teams are seeded by
      the ${SEED.name} those results produce, the way the MPSSAA seeds.${OLR ? " The % next to each team is its chance to win that game." : ""}</div>
    ${OLR ? `<div class="example"><b>Final 8 odds:</b> every team makes its region playoffs (no region has more than ${pl.region_seeds} teams), so the question is how far it goes.
      The rest of the season and the playoffs are simulated 2,000 times, each game decided by the Old Line Rating win chance. A team's Final 8 odds are the share of
      simulations in which it wins its region bracket; its team page also shows its odds of reaching the semifinals and state final and of winning the title.</div>` : ""}
  </section>`;
}
function renderHow() {
  // Group classes that share a value: "4A & 4A/3A = 8"
  const byPts = {};
  CLASSES.forEach(c => (byPts[C.classes[c]] = byPts[C.classes[c]] || []).push(cl(c)));
  const tiers = Object.entries(byPts).sort((a, b) => a[0] - b[0]);
  const tierText = tiers.map(([pts, cs], i) => `${pts}${i ? "" : " points"} for beating a ${cs.join(" or ")} team`).join(", ");
  const ex = C.example, exPts = C.classes[ex.cls], exW = ex.W + 0.5 * ex.T;
  const lowest = tiers[0][1].join(" / ");
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>How it works</span></div>
    <h1>How the <span>rankings</span> work</h1>
    <div class="sub">${SEEDS_BY_POINTS
      ? "Every team has two numbers. The <b>Old Line Rating</b> ranks the teams. <b>MPSSAA points</b> are the state's own formula, used to seed the playoffs."
      : `Every team has an <b>Old Line Rating</b>, built from capped ${C.score.plural.replace(/s$/, "")} margins and the strength of every opponent. Playoffs are seeded by <b>${SEED.name}</b>.`}</div>
  </div></section>
  <div class="wrap how-page">
    <div class="note-fun"><b>Just for fun.</b> The Old Line Rating is a computer ranking built only from scores and schedules.
      It doesn't know about injuries, weather, lineups or anything else that happens on the field.
      This site is for fun and curiosity, and no offense is meant to any team, player or coach.
      <b>The outcome is always decided on the field, not by a computer.</b></div>
    ${howOLR()}
    ${SEEDS_BY_POINTS ? `<section class="how-section">
      ${howHead("Playoff seeding", "MPSSAA points", "The MPSSAA's own point system. It decides playoff seeding, so the Final 8 seeds by it.")}
      <div class="how-grid" style="--n:${C.ties ? 3 : 2}">
        <div class="how-card w"><div class="k">Win</div><h4>Class + opponent's wins</h4><p>${tierText}, plus 1 point for every game your opponent has won this season.</p></div>
        ${C.ties ? `<div class="how-card t"><div class="k">Tie</div><h4>Half a win</h4><p>A tie earns half of what a win against that opponent would have earned. Ties also count as half a win in an opponent's win total.</p></div>` : ""}
        <div class="how-card l"><div class="k">Loss</div><h4>Zero points</h4><p>Losses earn nothing but still count as a game played, which pulls your average down.</p></div>
      </div>
      <div class="example"><b>Same as MPSSAA playoff seeding:</b> these are the win points and bonus points the MPSSAA uses to seed the ${C.sport.toLowerCase()} playoffs
        (${tiers.slice().reverse().map(([pts, cs]) => `${cs.join(" & ")} = ${pts}`).join(", ")}).</div>
      <div class="example">
        <b>Example:</b> A team beats a ${cl(ex.cls)} opponent that is ${recTxt(ex)} on the season. That win is worth <b>${exPts} + ${n2(exW)} = ${n2(exPts + exW)}</b> points.${C.ties ? ` Had it been a tie, it would be worth <b>${n2((exPts + exW) / 2)}</b>.` : ""}
        Each team's MPSSAA average is its total MPSSAA points divided by games played.
      </div>
      <div class="example">
        <b>Fine print:</b> Opponent win totals are for the full season to date, so MPSSAA points keep changing as opponents play more games.
        Opponents from outside Maryland public schools (private schools, out of state) count as ${lowest} (${NONMEMBER_PTS} points) with 0 wins; the MPSSAA instead slots them into a class by enrollment and counts their wins, so official numbers can differ slightly. Official tiebreakers and 8- vs 9-game bonus adjustments are not applied.
        Forfeits count as wins and losses. Records are calculated from game-by-game results, so they may differ slightly from official standings.
      </div>
    </section>` : ""}
    ${C.playoffs ? howFinal8() : ""}
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
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/${r.g}/All">${GENDERS[r.g]}</a><span>/</span><span>${r.c === "All" ? "All classes" : "Class " + cl(r.c)}</span></div>
    <h1>${title}</h1>
    <div class="sub">${ts.length} teams · games through ${fmtDate(D.sports[r.g].through, {month: "long", day: "numeric"})} · ranked by Old Line Rating</div>
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
          <option value="rank">Old Line Rating</option>${SEEDS_BY_POINTS ? `<option value="avg">MPSSAA points</option>` : ""}<option value="record">Record (win %)</option>
          <option value="sos">Strength of schedule</option>${SEEDS_BY_POINTS ? `<option value="pts">Total MPSSAA points</option>` : ""}<option value="gd">${C.score.name}</option><option value="school">Team name</option>
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
    ...(SEEDS_BY_POINTS ? [{key: "pts", label: "MPSSAA total", cls: "num hide-lg"},
      {key: "avg", label: "MPSSAA avg", cls: "num hide-sm", title: "MPSSAA playoff points per game (used for seeding)"}] : []),
    {key: "sos", label: "SOS", cls: "num hide-xs", title: "Strength of schedule: average Old Line Rating of opponents played"},
    {key: "rating", label: "OLR", cls: "num", title: `Old Line Rating: ${C.score.plural} better than an average team`},
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
      ${SEEDS_BY_POINTS ? `<td class="num mono hide-lg">${n2(t.pts)}</td><td class="num mono hide-sm">${t.avg.toFixed(2)}</td>` : ""}
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
// Each sport seeds the way its MPSSAA bulletin says (C.playoffs):
//   football: MPSSAA points; each region's top 8 play two rounds and two per region reach the Final 8.
//   soccer:   winning percentage (fewer than min_games games divide by min_games); every team plays,
//             each region plays down to one champion, and the 8 champions make the Final 8.
// The Final 8 is reseeded 1-8 by the same number. Current: the top seeds advance and only the
// quarterfinals are filled in. Projected: seeds from t.proj (rest of the season played out), and every
// playoff game goes to the team with the higher Old Line Rating.
const PL = C.playoffs;
const SEED = PL && PL.seed_by === "winpct"
  ? {name: "winning percentage", unit: "win pct", val: x => (x.W + 0.5 * x.T) / Math.max(x.gp, PL.min_games), fmt: v => v.toFixed(3).replace(/^0/, "")}
  : {name: "MPSSAA points", unit: "MPSSAA pts", val: x => x.avg, fmt: v => v.toFixed(2)};
// Views: "current", and "projected" (every remaining game goes to the higher Old Line Rating; t.proj).
const F8_VIEWS = {current: "Current", projected: "Projected"};
function seeding(g, c, view) {
  const projected = view !== "current";
  const val = t => projected ? t.proj : t;
  // Who wins a projected game: OLR win chance, or the higher (projected) MPSSAA-style average
  const pick = !projected ? null : OLR
    ? (a, b) => { const p = winProb(g, a.school, b.school, 1); return {p, w: p >= .5 ? a : b}; }
    : (a, b) => ({p: null, w: val(b).avg > val(a).avg ? b : a});
  // MPSSAA tiebreak: head-to-head winner first; otherwise a coin flip, which we stand in for with the
  // Old Line Rating (higher first)
  const h2h = (a, b) => { const g = a.games.find(x => x.opp === b.school); return g ? {W: -1, L: 1, T: 0}[g.res] : 0; };
  const order = (a, b) => SEED.val(val(b)) - SEED.val(val(a)) || h2h(a, b) || b.rating - a.rating || a.stateRank - b.stateRank;
  const ts = teamsOf(g, c);
  const regionRounds = Math.log2(8 / PL.per_region);   // rounds until per_region teams are left
  const regions = REGION_ORDER.map(reg => {
    const teams = ts.filter(t => t.region === reg).sort(order);
    const rounds = playBracket(teams.slice(0, PL.region_seeds), regionRounds, pick);
    // Current: assume the top seeds advance. Projected: the predicted region winners advance.
    const adv = projected ? rounds[rounds.length - 1].map(m => m.w).filter(isTeam) : teams.slice(0, PL.per_region);
    return {reg, teams, rounds, adv: new Set(adv)};
  }).filter(x => x.teams.length);
  const final8 = regions.flatMap(x => [...x.adv]).sort(order);
  const regionSeed = new Map(regions.flatMap(x => x.teams.map((t, i) => [t, i + 1])));
  return {val, pick, regions, final8, regionSeed};
}
// Bracket slots hold a team, BYE (no team at that seed), a {label} placeholder, or null (winner TBD).
const BYE = {bye: true};
const isTeam = x => x && x.school;
// Standard 8-line bracket over seeds (best first): 1v8, 4v5, 2v7, 3v6, then winners. Returns every round
// as games {a, b, p, w} in bracket order; a is the higher seed (hosts). With pick(a, b) -> {p, w}, w is the
// predicted winner (p = chance a wins, Old Line Rating only); without it only byes advance, others are TBD.
function playBracket(seeds, rounds, pick) {
  const rank = x => isTeam(x) || (x && x.label) ? seeds.indexOf(x) : Infinity;
  let slots = [1, 8, 4, 5, 2, 7, 3, 6].map(i => seeds[i - 1] || BYE);
  const out = [];
  for (let r = 0; r < rounds; r++) {
    const games = [];
    for (let i = 0; i < slots.length; i += 2) {
      let [a, b] = [slots[i], slots[i + 1]];
      if (rank(b) < rank(a)) [a, b] = [b, a];
      let w = null, p = null;
      if (a === BYE && b === BYE) w = BYE;
      else if (b === BYE) w = a;
      else if (a === BYE) w = b;
      else if (pick && isTeam(a) && isTeam(b)) ({p, w} = pick(a, b));
      games.push({a, b, p, w});
    }
    out.push(games);
    slots = games.map(m => m.w);
  }
  return out;
}
// Bracket columns (one per round, then the survivors). Pairs of games that feed one game are grouped so
// CSS can draw the connectors; the last round connects straight across to the survivors column
// (omitted when endName is null: the last round's winners are then just shown in bold).
function bracketHTML(rounds, names, endName, slot, opts = {}) {
  const cell = html => `<div class="bslot">${html}</div>`;
  const match = m => {
    const decided = isTeam(m.a) && isTeam(m.b) && m.w;
    const cls = x => decided ? (m.w === x ? "win" : "lose") : "";
    return `<div class="match">${slot(m.a, m.p, cls(m.a))}${slot(m.b, m.p == null ? null : 1 - m.p, cls(m.b))}</div>`;
  };
  const cols = rounds.map((games, i) => {
    const last = i === rounds.length - 1;
    const body = last ? games.map(m => cell(match(m))).join("")
      : Array.from({length: games.length / 2}, (_, j) => `<div class="bpair">${cell(match(games[2 * j]))}${cell(match(games[2 * j + 1]))}</div>`).join("");
    return `<div class="bcol${i ? " fed" : ""}${last && endName ? " to-next" : ""}"><h4>${names[i]}${opts.pct ? `<span class="h4-pct">win %</span>` : ""}</h4><div class="bgames">${body}</div></div>`;
  });
  const end = rounds[rounds.length - 1].map(m => cell(`<div class="match">${slot(m.w === BYE ? null : m.w, null, isTeam(m.w) ? "win" : "")}${opts.endExtra ? opts.endExtra(m.w) : ""}</div>`)).join("");
  return `<div class="bracket ${opts.cls || ""}" style="grid-template-columns:repeat(${rounds.length + (endName ? 1 : 0)}, minmax(var(--colw), var(--colmax, 1fr)))">${cols.join("")}
    ${endName ? `<div class="bcol fed end ${opts.endCls || ""}"><h4>${endName}</h4><div class="bgames">${end}</div></div>` : ""}</div>`;
}
function renderFinal8(r) {
  const view = r.view in F8_VIEWS ? r.view : "current", projected = view !== "current";
  const {val, pick, regions, final8, regionSeed} = seeding(r.g, r.c, view);
  // Each record carries its own seeding number where that isn't just the record (football's MPSSAA points)
  const pts = (x, label) => SEEDS_BY_POINTS ? ` · ${x.avg.toFixed(2)} ${label}` : "";
  const nowLine = t => `${projected ? "now " : ""}${recTxt(t)}${pts(t, "MPSSAA")}`;
  const projLine = t => `<span class="proj-tag">proj ${recTxt(t.proj)}</span>${pts(t.proj, "proj MPSSAA")}`;
  // Projected view shows the projected record next to the actual one
  // Region (mini) brackets get a short detail line: record and seeding number
  const slotFor = (seedOf, mini) => (x, p, cls) => {
    if (x === BYE) return `<div class="slot tbd"><span class="seed mono"></span><span></span><span class="nm">Bye</span></div>`;
    if (!isTeam(x)) return `<div class="slot tbd"><span class="seed mono"></span><span></span><span class="nm">${x && x.label ? esc(x.label) : "TBD"}</span></div>`;
    return `<div class="slot ${cls}" data-team="${esc(x.school)}"><span class="seed mono">${seedOf(x)}</span>${logo(x.school, 24)}
      <span class="nm" title="${esc(x.school)}">${esc(x.school)}<small>${mini ? (projected ? projLine(x) : nowLine(x))
        : projected ? `${esc(x.region)}<br>${projLine(x)}<br>${nowLine(x)}` : `${esc(x.region)} · ${nowLine(x)}`}</small></span>
      <span class="avg mono" title="Chance to win this game (Old Line Rating)">${p == null ? "" : pct(100 * p)}</span></div>`;
  };
  const stateSeed = t => final8.indexOf(t) + 1;
  // Region play: each region's own bracket
  const regionRounds = Math.log2(8 / PL.per_region);
  const regionNames = regionRounds === 3 ? ["Quarterfinals", "Semifinals", "Region final"] : ["Round 1", "Round 2"];
  const regionCards = regions.map(({reg, teams, rounds}) => `<div class="rcard"><div class="rhead"><h3>${reg}</h3>
      <small>${teams.length} teams · seeded by ${projected ? "projected " : ""}${SEED.name}</small></div>
      ${bracketHTML(rounds, regionNames, PL.per_region === 1 ? null : "To Final 8", slotFor(t => regionSeed.get(t), true), {cls: "mini", pct: projected && OLR})}</div>`).join("");
  // State tournament: current shows only the seed lines; projected plays it out
  const stateRounds = projected ? playBracket(final8, 3, pick)
    : playBracket(Array.from({length: 8}, (_, i) => ({label: `No. ${i + 1} seed`})), 3, null);
  const bracket = bracketHTML(stateRounds, ["State quarterfinals", "Semifinals", "Final"], "Champion", slotFor(stateSeed),
    {endCls: "champ", pct: projected && OLR, endExtra: w => isTeam(w) && w.odds && view === "projected" ? `<div class="champ-odds">Title odds ${pct(w.odds.champ)}</div>` : ""});
  const regionHow = PL.per_region === 1
    ? `Every team is seeded in its region by ${SEED.name}, and each region plays down to one champion (in a 6-team region the top 2 seeds get byes).`
    : `Each region's top ${PL.region_seeds} by ${SEED.name} play two rounds (1v8, 4v5, 2v7, 3v6); the two survivors reach the Final 8.`;
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>Playoffs</span><span>/</span><span>${divName(r.g, r.c)}</span></div>
    <h1>${divName(r.g, r.c)} <span>Playoffs</span></h1>
    <div class="switches">
      ${MULTI ? `<div class="pill-group ${r.g !== DEF ? "red" : ""}">${Object.entries(GENDERS).map(([g, l]) => `<a class="${g === r.g ? "on" : ""}" href="${href({...r, g, team: null})}">${l}</a>`).join("")}</div>` : ""}
      <div class="pill-group">${CLASSES.map(c => `<a class="${c === r.c ? "on" : ""}" href="${href({...r, c, team: null})}">${cl(c)}</a>`).join("")}</div>
    </div>
  </div></section>
  <div class="wrap">
    <div class="card f8-toggle">
      <div class="toolbar">
        <div class="seg" role="tablist">
          ${Object.entries(F8_VIEWS).map(([v, l]) => `<button data-view="${v}" aria-selected="${v === view}">${l}</button>`).join("")}
        </div>
        <span class="muted f8-note">${projected
          ? `Every remaining game, regular season and playoffs, goes to the team with the higher Old Line Rating · seeded by ${SEED.name}`
          : `Today's seeds by ${SEED.name}, through ${fmtDate(D.sports[r.g].through, {month: "long", day: "numeric"})}`}</span>
      </div>
    </div>
    <div class="section-head"><div><div class="eyebrow">Step 1 · Region play</div><h2>${divName(r.g, r.c)} regions</h2>
      <p>${regionHow} ${projected ? "" : "Later rounds fill in as games are played."}</p></div></div>
    <div class="regions f8-regions">${regionCards}</div>
    <div class="section-head"><div><div class="eyebrow">Step 2 · State tournament</div><h2>Final 8</h2>
      <p>The ${regions.length * PL.per_region} region ${PL.per_region === 1 ? "champions" : "survivors"} are reseeded 1–8 by ${SEED.name}: 1v8, 4v5, 2v7, 3v6.
      ${projected ? "" : "The bracket fills in once region play is done; switch to Projected for a prediction."}</p></div></div>
    <div class="card">${bracket}</div>
  </div>`;
}

// ---------- schedule ----------
// Every game once (each is listed under both teams when both are MPSSAA members), as home/away.
let schedFilter = {when: "upcoming", c: "All", q: "", watch: false};
function allGames(g) {
  const games = new Map();
  for (const t of D.sports[g].teams) {
    for (const x of [...t.games, ...t.upcoming]) {
      const home = x.home ? t.school : x.opp, away = x.home ? x.opp : t.school;
      const key = x.date + "|" + [home, away].sort().join("|");
      const played = "res" in x;
      const prev = games.get(key);
      const game = prev || {date: x.date, home, away, played, status: x.status,
        hs: played ? (x.home ? x.gf : x.ga) : null, as: played ? (x.home ? x.ga : x.gf) : null, ff: x.ff};
      // Watch/ticket links and times may come from either team's side
      game.time = game.time || x.time; game.watch = game.watch || x.watch; game.tickets = game.tickets || x.tickets;
      games.set(key, game);
    }
  }
  return [...games.values()];
}
function renderSchedule(r) {
  app.innerHTML = `
  <section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>Schedule</span></div>
    <h1>${GENDERS[r.g]} <span>Schedule</span></h1>
    <div class="sub">Every game, with start times, live streams and tickets where available. Tap a team for its full schedule.</div>
    <div class="switches"><div class="pill-group" id="schedCls">${["All", ...CLASSES].map(c =>
      `<a href="javascript:void 0" data-sc="${c}" class="${c === schedFilter.c ? "on" : ""}">${cl(c)}</a>`).join("")}</div></div>
  </div></section>
  <div class="wrap"><div class="card">
    <div class="toolbar">
      <div class="seg" role="tablist">${[["upcoming", "Upcoming"], ["results", "Results"], ["all", "All"]].map(([v, l]) =>
        `<button data-sw="${v}" aria-selected="${v === schedFilter.when}">${l}</button>`).join("")}</div>
      <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="sq" type="search" placeholder="Search teams, mascots, counties…" autocomplete="off" value="${esc(schedFilter.q)}"></label>
      <label class="check"><input type="checkbox" id="swatch" ${schedFilter.watch ? "checked" : ""}> Streaming only</label>
    </div>
    <div id="schedList"></div>
  </div></div>`;
  renderScheduleList(r);
}
function renderScheduleList(r) {
  const f = schedFilter, q = f.q.trim().toLowerCase();
  const info = name => findTeam(r.g, name);
  const matches = name => { const s = SCHOOLS[name] || {}, t = info(name);
    return [name, s.mascot, s.county, s.city, t && t.region].some(v => v && v.toLowerCase().includes(q)); };
  let games = allGames(r.g).filter(x =>
    (f.when === "all" || (f.when === "upcoming" ? !x.played && x.status !== "postponed" : x.played)) &&
    (f.c === "All" || [x.home, x.away].some(n => info(n)?.cls === f.c)) &&
    (!q || matches(x.home) || matches(x.away)) && (!f.watch || x.watch));
  const asc = f.when === "upcoming";
  games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "99") < (b.time || "99") ? -1 : 1) * (asc ? 1 : -1));
  const el = document.getElementById("schedList");
  if (!games.length) { el.innerHTML = `<div class="empty">No games match.</div>`; return; }
  const team = (side, name, score, won) => {
    const t = info(name);
    const label = t ? `<button class="tm" data-team="${esc(name)}">${esc(name)}</button>` : `<span class="tm nm">${esc(name)}</span>`;
    const meta = t ? `<small><span class="ctag">${cl(t.cls)}</span> #${t.rank} · ${recTxt(t)}</small>` : `<small>Non-public / out of state</small>`;
    return `<div class="side ${side} ${won === true ? "won" : won === false ? "lost" : ""}">${logo(name, 30)}<div class="who">${label}${meta}</div>${score == null ? "" : `<b class="sc mono">${score}</b>`}</div>`;
  };
  let day = "", rows = "";
  for (const x of games.slice(0, 600)) {
    if (x.date !== day) {
      day = x.date;
      rows += `<div class="sday">${fmtDate(day, {weekday: "long", month: "long", day: "numeric"})}</div>`;
    }
    const hw = x.played ? (x.hs > x.as ? true : x.hs < x.as ? false : null) : null;
    // Football: each side's chance to win (home team hosts)
    const p = !x.played && OLR && info(x.home) ? winProb(r.g, x.home, x.away, 1) : null;
    const mid = x.played ? `<span class="fin">${x.ff ? "Forfeit" : "Final"}</span>`
      : p != null ? `<span class="odds mono" title="Chance to win (Old Line Rating)">${pct(100 * (1 - p))} · ${pct(100 * p)}</span>` : `<span class="at">@</span>`;
    rows += `<div class="srow">
      <div class="stime mono">${x.played ? "" : x.date < TODAY ? "Pending" : x.time ? fmtTime(x.time) : "TBA"}</div>
      ${team("away", x.away, x.played ? x.as : null, hw == null ? null : !hw)}
      <div class="smid">${mid}</div>
      ${team("home", x.home, x.played ? x.hs : null, hw)}
      <div class="sact">${watchBtn(x)}${ticketBtn(x, `${x.away} at ${x.home}`)}</div>
    </div>`;
  }
  el.innerHTML = `<div class="sched">${rows}</div>${games.length > 600 ? `<div class="empty">Showing the first 600 of ${games.length} games. Search or filter to narrow it down.</div>` : ""}`;
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
  const scoring = t.games.filter(x => x.res !== "L").map(x => Object.assign(x, {__gs: gameScore(g, x).score}));
  const best = scoring.length ? scoring.reduce((a, b) => b.__gs > a.__gs ? b : a) : null;
  document.getElementById("dBody").innerHTML = `
    <div class="tiles">
      <div class="tile tile-olr" id="olrTile">
        <button class="olr-head" id="olrBtn" aria-expanded="false" title="Show how this rating is calculated">
          <b class="mono">${fmtR(t.rating)}</b><span>${RATING}</span>
          <svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="olr-body" hidden>${olrBreakdown(g, t)}</div>
      </div>
      ${PL ? `<div class="tile"><b class="mono">${SEED.fmt(SEED.val(t))}</b><span title="Playoff seeding: ${SEED.name}">${SEED.unit} · seeding</span></div>` : ""}
      <div class="tile"><b class="mono">${fmtR(t.sos)}</b><span title="Strength of schedule">SOS · #${t.sosRank} in ${cl(t.cls)}</span></div>
      <div class="tile"><b class="mono">${recTxt(t)}</b><span>Record · ${pctStr(t)}</span></div>
      <div class="tile"><b class="mono">${t.gf}–${t.ga}</b><span>${C.score.short}</span></div>
    </div>
    ${t.odds ? `<div class="sect">Odds to reach · 2,000 simulated seasons</div><div class="tiles odds">
      ${[["f8", "Final 8"], ["sf", "Semifinals"], ["fin", "State final"], ["champ", "State champion"]].map(([k, l]) =>
        `<div class="tile"><b class="mono">${pct(t.odds[k])}</b><span>${l}</span></div>`).join("")}</div>` : ""}
    ${best ? `<div class="sect">Best result</div><div class="best">${logo(best.opp, 40)}<div><b>${best.res === "W" ? "Beat" : "Tied"} ${esc(best.opp)}</b> ${best.gf}–${best.ga} on ${fmtDate(best.date)}<div class="muted" style="font-size:13px">Game score ${fmtR(best.__gs)} (its contribution to the Old Line Rating)</div></div></div>` : ""}
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
    <div class="right"><div class="links">${watchBtn(x)}</div><div class="score mono">${x.gf ?? "–"}–${x.ga ?? "–"}</div>${SEEDS_BY_POINTS ? `<div class="pts">${calc} MPSSAA pts</div>` : ""}<div class="pts">game score <b class="mono">${fmtR(gameScore(g, x).score)}</b></div></div>
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
    <div class="right"><div class="links">${watchBtn(u)}${ticketBtn(u, u.home ? `${u.opp} at ${t.school}` : `${t.school} at ${u.opp}`)}</div>${OLR ? `<div class="prob mono" title="Chance to win (Old Line Rating)">${pct(100 * winProb(g, t.school, u.opp, u.home ? 1 : -1))} to win</div>` : ""}${SEEDS_BY_POINTS ? `<div class="pts">win worth</div><div class="mono worth">${n2(worth)} <span class="pts">MPSSAA pts</span></div>` : ""}</div>
  </div>`;
}
// The full Old Line Rating calculation for one team: each game's score, then the blend with the class average.
// Ratings are solved for all teams together, so this reproduces the shown rating up to rounding.
function olrBreakdown(g, t) {
  const o = C.olr, cm = D.sports[g].classMeans || {}, avg = cm[t.cls] || 0, u = C.score.plural;
  const rows = t.games.map(x => ({x, ...gameScore(g, x)}));
  const total = rows.reduce((s, r) => s + r.score, 0), n = rows.length;
  const result = (total + o.prior * avg) / (n + o.prior);
  const sgn = v => fmtR(v);
  return `<div class="olr-break">
    <div class="olr-title">How ${esc(t.school)}'s Old Line Rating is calculated</div>
    <p class="muted">Each game's <b>game score</b> = ${u.replace(/s$/, "")} margin (capped at ±${o.cap})${o.win_bonus ? ` ± ${o.win_bonus} for the win or loss` : ""} + the opponent's Old Line Rating${D.sports[g].home ? " − home edge" : ""}.</p>
    <div class="table-wrap"><table class="olr-table"><thead><tr><th>Date</th><th>Opponent</th><th class="num">Score</th><th class="num">Margin</th>${o.win_bonus ? `<th class="num">Win/loss</th>` : ""}<th class="num">Opp. OLR</th>${D.sports[g].home ? `<th class="num">Home</th>` : ""}<th class="num">Game score</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${fmtDate(r.x.date)}</td><td>${r.x.home ? "vs" : "@"} ${esc(r.x.opp)}</td>
      <td class="num mono">${r.x.res} ${r.x.gf ?? "–"}–${r.x.ga ?? "–"}</td><td class="num mono">${sgn(r.margin)}${r.x.gf != null && Math.abs(r.x.gf - r.x.ga) > o.cap ? "*" : ""}</td>
      ${o.win_bonus ? `<td class="num mono">${sgn(r.bonus)}</td>` : ""}<td class="num mono">${sgn(r.opp)}</td>${D.sports[g].home ? `<td class="num mono">${sgn(-r.home)}</td>` : ""}
      <td class="num mono"><b>${sgn(r.score)}</b></td></tr>`).join("")}</tbody></table></div>
    <div class="olr-math">
      <div>Total of ${n} game score${n === 1 ? "" : "s"}: <b class="mono">${sgn(total)}</b>${n ? ` (average <b class="mono">${sgn(total / n)}</b>)` : ""}</div>
      <div>Plus the ${cl(t.cls)} class average <b class="mono">${sgn(avg)}</b>, counted as ${o.prior} games so early results don't swing too far</div>
      <div class="eq mono">(${sgn(total)} + ${o.prior} × ${sgn(avg)}) ÷ (${n} + ${o.prior}) = <b>${sgn(result)}</b></div>
      ${rows.some(r => r.x.gf != null && Math.abs(r.x.gf - r.x.ga) > o.cap) ? `<div class="muted">* margin capped at ${o.cap} ${u}</div>` : ""}
      <div class="muted">Every team's rating depends on its opponents' ratings, so all ratings are solved together each night; small rounding differences are expected.</div>
    </div></div>`;
}
document.getElementById("dBody").addEventListener("click", e => {
  const btn = e.target.closest("#olrBtn");
  if (!btn) return;
  const tile = document.getElementById("olrTile"), open = !tile.classList.contains("open");
  tile.classList.toggle("open", open);
  tile.querySelector(".olr-body").hidden = !open;
  btn.setAttribute("aria-expanded", open);
});
function closeDrawer() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); scrim.classList.remove("open"); }

// ---------- render & events ----------
function render() {
  const r = parseRoute();
  const pageKey = r.page + (r.page === "rank" || r.page === "final8" ? r.g + r.c + r.view : "") + (r.page === "home" ? homeGender : "");
  if (pageKey !== render.lastKey) {
    ({rank: renderRank, final8: renderFinal8, how: renderHow, schedule: renderSchedule}[r.page] || renderHome)(r);
    if (render.lastKey && r.page !== render.lastPage) window.scrollTo(0, 0);
    render.lastKey = pageKey; render.lastPage = r.page;
  }
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", r.page === "rank" ? a.dataset.nav === r.g : a.dataset.nav === r.page));
  document.title = (r.page === "rank" ? `${r.c === "All" ? "All Classes" : cl(r.c)} ${GENDERS[r.g]}${MULTI ? " " + C.sport : ""} · `
    : r.page === "final8" ? `${divName(r.g, r.c)} Playoffs · ` : "") + `Old Line ${C.sport} Rankings`;
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
app.addEventListener("click", e => {
  const sc = e.target.closest("[data-sc]"), sw = e.target.closest("[data-sw]");
  if (!sc && !sw) return;
  if (sc) { schedFilter.c = sc.dataset.sc; document.querySelectorAll("#schedCls a").forEach(a => a.classList.toggle("on", a === sc)); }
  if (sw) { schedFilter.when = sw.dataset.sw; document.querySelectorAll("[data-sw]").forEach(b => b.setAttribute("aria-selected", b === sw)); }
  renderScheduleList(parseRoute());
});
app.addEventListener("input", e => { if (e.target.id === "sq") { schedFilter.q = e.target.value; renderScheduleList(parseRoute()); } });
app.addEventListener("change", e => { if (e.target.id === "swatch") { schedFilter.watch = e.target.checked; renderScheduleList(parseRoute()); } });
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
