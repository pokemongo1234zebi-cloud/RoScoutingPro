/* RoScouting — front. Rendu par chaînes de gabarits, aucune dépendance.
   Les données viennent de radar.json, produit par collector/collect.mjs. */

/* ----------------------------------------------------------------- outils */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1000 ? (n/1000).toFixed(n>=1e4?0:1)+"K" : String(Math.round(n||0));
const nbsp = n => String(Math.round(n||0)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
const usd = n => n >= 1000 ? "$"+(n/1000).toFixed(1)+"K" : "$"+Math.round(n||0);
const ageF = d => d >= 365 ? (d/365).toFixed(1)+" a" : Math.round(d)+" j";
const pct = v => v == null ? "—" : (v>0?"+":"")+Math.round(v)+" %";
const grade = s => s >= 68 ? "A" : s >= 58 ? "B" : "C";
const GRADE = { A:"#3ddc84", B:"#f5c451", C:"#7fd3e8" };
const STAGE = {
  Ignition:["#f0a35a","#3a1e08","IGNITION"], Climbing:["#3ddc84","#0b3a22","CLIMBING"],
  Trending:["#c47cf2","#2a1050","TRENDING"], "High Growth":["#3ddc84","#0b3a22","HIGH GROWTH"],
  Warming:["#f0c46a","#3d2a0a","WARMING"], Steady:["#b2b6ca","#1e1733","STEADY"],
  Established:["#6aa6ff","#0b2f6b","ÉTABLI"],
};
const BAR_LABELS = ["Momentum","Trafic","Qualité","Rétention","Fraîcheur","Demande"];
const GENRES = [
  ["Tous les jeux","controller"],["Simulateur","sparkle"],["Tycoon","gift"],["RNG & Chance","dice"],
  ["Anime","star"],["Fighting","sword"],["Obby & Parkour","trend"],["Tower Defense","castle"],
  ["Horreur","ghost"],["Brainrot & Steal","bolt"],["Survie & Évasion","shield"],["Roleplay & Vie","users"],
];
const svg = (p, sz = 18, fill = "currentColor", style = "") =>
  `<svg width="${sz}" height="${sz}" viewBox="0 0 256 256" fill="${fill}" style="${style}"><path d="${p}"/></svg>`;
const tagStyle = st => { const [c,bg] = STAGE[st] || STAGE.Steady;
  return `color:${c};background:${bg};box-shadow:inset 0 0 0 1px color-mix(in srgb,${c} 45%,transparent)`; };
const stageLabel = st => (STAGE[st] || STAGE.Steady)[2];
const thumbCss = (g, size, r) => g.thumb
  ? `width:${size}px;height:${size}px;border-radius:${r}px;background-image:url('${g.thumb}')`
  : `width:${size}px;height:${size}px;border-radius:${r}px;background:linear-gradient(135deg,oklch(55% .14 ${g.hue||280}),oklch(32% .09 ${(g.hue||280)+40}))`;

function spark(s, h) {
  const w = 300, pad = 4, max = Math.max(...s), min = Math.min(...s);
  const pts = s.map((v,i) => [i*w/(s.length-1), pad + (h-2*pad)*(1-(v-min)/((max-min)||1))]);
  const line = "M" + pts.map(p => p[0].toFixed(1)+","+p[1].toFixed(1)).join("L");
  return { line, area: line+`L${w},${h}L0,${h}Z` };
}
function sparkSvg(s, w, h, id) {
  if (!s || s.length < 2) return `<span style="width:${w}px"></span>`;
  const { line, area } = spark(s, h);
  return `<svg viewBox="0 0 300 ${h}" preserveAspectRatio="none" style="width:${w}px;height:${h}px;flex:none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c43ee0" stop-opacity=".45"/><stop offset="1" stop-color="#c43ee0" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="#d05fe8" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ------------------------------------------------------------------- état */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("rs_"+k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rs_"+k, JSON.stringify(v)); } catch {} },
};
const st = {
  view:"radar", mode: store.get("mode","cards"), tab:"all", genre:"", stageF:"", query:"",
  sortKey:"score", minCcu:"0", groupClones:true,
  watch: store.get("watch", []), compare: [], sel: null,
};
let DATA = null, ERR = null;

/* --------------------------------------------------------------- données */
async function load() {
  for (const url of window.RS_CONFIG.urls) {
    try {
      const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
      if (!r.ok) continue;
      const d = await r.json();
      if (d && Array.isArray(d.games)) { DATA = d; ERR = null; return true; }
    } catch {}
  }
  ERR = "Aucune donnée accessible.";
  return false;
}
load().then(render);
setInterval(() => load().then(() => { if (DATA) render(); }), window.RS_CONFIG.refreshMs);

/* -------------------------------------------------------------- sélection */
const byId = id => (DATA.games || []).find(g => g.id === id);

function visible() {
  let g = DATA.games.slice();
  if (st.groupClones) g = g.filter(x => !x.cloneOf);
  if (st.genre) g = g.filter(x => x.genre === st.genre);
  if (st.stageF) g = g.filter(x => x.stage === st.stageF);
  const min = parseInt(st.minCcu, 10) || 0;
  if (min) g = g.filter(x => x.ccu >= min);
  if (st.query) {
    const q = st.query.toLowerCase();
    g = g.filter(x => x.name.toLowerCase().includes(q) || x.creator.toLowerCase().includes(q));
  }
  if (st.tab === "climbing") g = g.filter(x => x.stage === "Climbing");
  if (st.tab === "new") g = g.filter(x => x.age <= 21);
  if (st.tab === "growth") g = g.filter(x => x.mult >= 10);
  if (st.tab === "under") g = g.filter(x => x.ccu > 0 && x.usd / x.ccu < 0.5);
  if (st.tab === "watch") g = g.filter(x => st.watch.includes(x.id));
  const S = {
    score:(a,b)=>b.score-a.score, ccu:(a,b)=>b.ccu-a.ccu, usd:(a,b)=>b.usd-a.usd,
    momentum:(a,b)=>b.mult-a.mult, age:(a,b)=>a.age-b.age,
  };
  return g.sort(S[st.sortKey] || S.score);
}
const ranked = () => {
  const all = DATA.games.filter(g => !st.groupClones || !g.cloneOf).sort((a,b)=>b.score-a.score);
  const r = new Map(); all.forEach((g,i) => r.set(g.id, i+1)); return r;
};

/* ----------------------------------------------------------------- rendu */
function render() {
  if (!DATA) {
    $("#main").innerHTML = `<main class="rs-body"><div class="empty"><h3>Le radar n'a pas encore de données</h3>
      <p>${esc(ERR || "Chargement…")} Lance le collecteur : onglet <b>Actions</b> → <b>RoScouting collector</b> →
      <b>Run workflow</b>, puis recharge la page. Le premier relevé prend deux à trois minutes.</p></div></main>`;
    return;
  }
  renderSide(); renderMain(); renderRail(); bind();
}

/* — sidebar — */
function renderSide() {
  const items = [
    ["radar","Découvrir","compass",null],
    ["trends","Tendances","chart",null],
    ["soon","À venir","sparkle",null],
    ["compare","Comparer","grid",st.compare.length||null],
    ["watch","Watchlist","eye",st.watch.length||null],
    ["scans","Mes scans","scan",null],
  ];
  $("#side").innerHTML = `
  <div class="logo-row"><div class="logo">${svg(I.compass,20,"#fff")}</div>
    <div style="display:flex;align-items:center;gap:6px"><h1>RoScouting</h1><span class="beta">BETA</span></div></div>
  <nav class="rs-nav">${items.map(([v,l,ic,c]) => `
    <button class="nav-item" data-view="${v}" aria-current="${st.view===v || (v==="radar"&&st.view==="detail")}">
      ${svg(I[ic])}<span class="lbl">${l}</span>${c?`<span class="nav-count">${c}</span>`:""}</button>`).join("")}
  </nav>
  <div class="side-foot"><div class="avatar"></div>
    <div style="line-height:1.2;flex:1"><div style="font-size:13px;font-weight:600">Scout</div>
    <div class="muted" style="font-size:11px">Analyste</div></div>${svg(I.scan,18,"currentColor","opacity:.6")}</div>`;
}

/* — corps — */
function renderMain() {
  const v = st.view;
  const body = v === "detail" ? viewDetail() : v === "compare" ? viewCompare()
    : v === "watch" ? viewWatch() : v === "scans" ? viewScans() : viewRadar();
  $("#main").innerHTML =
    (v === "radar" || v === "trends" || v === "soon"
      ? `<div class="hero-bg"><div class="img"></div><div class="veil"></div></div>` : "") +
    `<main class="rs-body">${body}</main>`;
}

function headerBlock() {
  const c = DATA.counts || {}, mins = Math.round((Date.now() - DATA.generatedAt)/60000);
  const titles = {
    radar:["Trouvez le prochain <em>hit Roblox</em>.","Données réelles, analyses plus fines. Repérez les jeux à fort potentiel avant qu'ils n'explosent."],
    trends:["Ce qui <em>monte</em> en ce moment.","Les jeux dont le trafic accélère le plus sur les dernières 24 heures."],
    soon:["Les <em>graines</em> du moment.","Jeux de moins de 21 jours portant un mot-clé qui marche. Signal fragile, potentiel maximal."],
  }[st.view] || titles_default();
  return `<header class="page-head">
    <div style="max-width:640px"><h1>${titles[0]}</h1><p>${titles[1]}</p></div>
    <div class="statpill">
      <div>${svg(I.grid,18,"#a06be0")}<div><b>${nbsp(c.universe||0)}</b><span class="muted">jeux suivis</span></div></div>
      <div><span class="livedot"></span><div><b>Données live</b><span class="muted">relevé il y a ${mins<1?"moins d'1":mins} min</span></div></div>
      <div>${svg(I.chart,18,"#a06be0")}<div><b>${DATA.historyDays||7} jours</b><span class="muted">d'historique</span></div></div>
    </div></header>`;
}
const titles_default = () => ["Radar",""];

function viewRadar() {
  const list = visible(), rk = ranked();
  const genreCounts = DATA.genreCounts || {};
  const total = DATA.games.filter(g => !st.groupClones || !g.cloneOf).length;
  const feat = st.view === "radar" && st.tab === "all" && !st.genre && !st.query && !st.stageF
    ? list.slice(0,3) : [];
  const grid = feat.length ? list.slice(3) : list;
  const s = DATA.stats || {};

  return `${headerBlock()}
  <label class="searchbox">${svg(I.search||I.compass,18)}
    <input class="input" id="q" value="${esc(st.query)}"
      placeholder="Rechercher ${nbsp(DATA.counts?.universe||0)} jeux Roblox par nom ou créateur…"></label>

  <div class="chiprow rs-scroll">${GENRES.map(([n,ic]) => {
    const on = st.genre === n || (n === "Tous les jeux" && !st.genre);
    const c = n === "Tous les jeux" ? total : (genreCounts[n] || 0);
    return `<button class="gchip" data-genre="${esc(n)}" aria-pressed="${on}">${svg(I[ic],14,"currentColor","opacity:.85")}${n}<span class="c">${fmt(c)}</span></button>`;
  }).join("")}</div>

  <div class="filters">
    <label><span class="muted">Trier</span><select class="input" id="sort">
      ${[["score","⚡ Score de percée"],["ccu","Joueurs en ligne"],["usd","Revenu / jour"],["momentum","Momentum"],["age","Plus récents"]]
        .map(([v,l])=>`<option value="${v}"${st.sortKey===v?" selected":""}>${l}</option>`).join("")}
    </select></label>
    <label><span class="muted">CCU min</span><input class="input" id="minccu" value="${esc(st.minCcu)}"></label>
    <label><span class="muted">Stade</span><select class="input" id="stagef">
      ${["","Ignition","Climbing","Warming","Trending","High Growth"].map(v=>`<option value="${v}"${st.stageF===v?" selected":""}>${v||"Tous"}</option>`).join("")}
    </select></label>
    <button class="switch" id="clones" aria-pressed="${st.groupClones}"><span class="track"><span class="knob"></span></span>Regrouper les clones</button>
    <button class="btn btn-secondary" id="reset" style="margin-left:auto;font-size:12.5px;background:var(--surface)">
      ${svg(I.refresh,14)}Réinitialiser</button>
  </div>

  <div class="statcards">
    ${[[I.controller,fmt(total),"jeux retenus",""],
       [I.shield,nbsp(s.newToday||0),"nouveaux aujourd'hui",s.newDelta?`(${s.newDelta})`:""],
       [I.bolt,nbsp(s.trending||0),"en tendance",""],
       [I.users,fmt(s.players||0),"joueurs suivis",""],
       [I.star,nbsp(s.hits||0),"hits potentiels",""]]
      .map(([ic,v,l,d])=>`<div class="statcard"><div class="ico">${svg(ic,20)}</div>
        <div style="min-width:0"><div class="v">${v}</div><div class="l">${l} <span class="d">${d}</span></div></div></div>`).join("")}
  </div>

  ${feat.length ? `<section class="block">
    <div class="block-head"><div><h2>Opportunités à la une</h2>
      <p>Sélection de jeux à fort potentiel de croissance d'après notre analyse.</p></div></div>
    <div class="featured">${feat.map((g,i)=>featCard(g,i+1)).join("")}</div></section>` : ""}

  <div class="tabbar">
    <div class="seg">${[["all","Tous les jeux",""],["climbing","Climbing",""],["new","Nouveaux (≤ 21 j)",""],
      ["growth","Forte croissance",""],["under","Sous-évalués",""],["watch","Watchlist","eye"]]
      .map(([id,l,ic])=>`<button data-tab="${id}" aria-pressed="${st.tab===id}">${ic?svg(I[ic],14):""}${l}</button>`).join("")}</div>
    <div class="seg icons">
      <button data-mode="cards" aria-pressed="${st.mode==="cards"}" title="Grille">${svg(I.grid,16)}</button>
      <button data-mode="compact" aria-pressed="${st.mode==="compact"}" title="Liste">${svg(I.list||I.chart,16)}</button>
    </div>
  </div>

  ${grid.length
    ? (st.mode === "cards"
        ? `<div class="gamegrid">${grid.map(g=>gameCard(g, rk.get(g.id))).join("")}</div>`
        : listTable(grid, rk))
    : `<div class="empty"><h3>Aucun jeu avec ces filtres</h3>
        <p>Baisse le CCU minimum, enlève le stade ou reviens à « Tous les jeux ».</p></div>`}`;
}

function featCard(g, rank) {
  const gr = grade(g.score);
  return `<button class="feat" data-open="${g.id}">
    <span class="rank">#${rank}</span>
    <div class="thumb" style="${thumbCss(g,72,10)}"></div>
    <div class="meta"><div><div class="nm">${esc(g.name)}</div><div class="cr">par ${esc(g.creator)}</div></div>
      <span class="tag" style="${tagStyle(g.stage)}">${stageLabel(g.stage)}</span></div>
    ${sparkSvg(g.s,96,36,"fg"+g.id)}
    <div class="sc"><div class="n" style="color:${GRADE[gr]}">${g.score}</div>
      <div class="g" style="color:${GRADE[gr]}">${gr}</div></div></button>`;
}

function gameCard(g, rank) {
  const gr = grade(g.score), inW = st.watch.includes(g.id), inC = st.compare.includes(g.id);
  return `<div class="gcard">
    <div class="r1">
      <div style="position:relative;flex:none"><div class="thumb" style="${thumbCss(g,72,10)}"></div>
        <span class="rank">#${rank}</span></div>
      <button data-open="${g.id}" style="flex:1;min-width:0;text-align:left">
        <div class="nm">${esc(g.name)}</div><div class="cr">par ${esc(g.creator)}</div>
        <span class="tag" style="${tagStyle(g.stage)};margin-top:6px">${stageLabel(g.stage)}</span></button>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <button class="iconbtn" data-cmp="${g.id}" aria-pressed="${inC}" title="Comparer">${svg(I.plus||I.grid,14)}</button>
        <div style="text-align:center;line-height:1"><div style="font-size:22px;font-weight:700;color:${GRADE[gr]}">${g.score}</div>
          <div style="font-size:11px;font-weight:600;color:${GRADE[gr]}">${gr}</div></div></div>
    </div>
    <div class="r2">
      ${[[fmt(g.ccu),"Joueurs"],[fmt(g.visits),"Visites"],[g.likes+" %","Likes"],[ageF(g.age),"Âge"]]
        .map(([v,l])=>`<div><div class="v">${v}</div><div class="l">${l}</div></div>`).join("")}
    </div>
    <div class="r3">${sparkSvg(g.s,90,28,"gc"+g.id)}
      <div style="flex:1;min-width:0"><span class="mult">+${(g.mult||0).toFixed(1)}×</span>
        <span class="muted" style="font-size:10.5px"> vs moy. vie</span></div>
      <button class="iconbtn" data-watch="${g.id}" aria-pressed="${inW}" title="Suivre">${svg(I.eye,14)}</button>
    </div></div>`;
}

function listTable(list, rk) {
  return `<div class="tablewrap"><table class="rs-table">
    <thead><tr>${["#","Jeu","Stade","Score","Joueurs","Visites","Likes","Âge","USD/j","Momentum","14 j",""]
      .map(h=>`<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${list.map(g => { const gr = grade(g.score); return `<tr data-open="${g.id}">
      <td class="muted">${rk.get(g.id)}</td>
      <td><div style="display:flex;gap:9px;align-items:center"><div class="thumb" style="${thumbCss(g,28,7)}"></div>
        <div style="min-width:0"><div style="font-weight:500;max-width:230px;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</div>
        <div class="muted" style="font-size:11.5px">${esc(g.creator)} · ${esc(g.genre)}</div></div></div></td>
      <td><span class="tag" style="${tagStyle(g.stage)}">${stageLabel(g.stage)}</span></td>
      <td style="font-size:15px;font-weight:700;color:${GRADE[gr]}">${g.score}</td>
      <td>${fmt(g.ccu)}</td><td>${fmt(g.visits)}</td><td>${g.likes} %</td><td>${ageF(g.age)}</td>
      <td>${usd(g.usd)}</td>
      <td><span class="bar"><i style="width:${Math.min(100,(g.bars?.[0]||0))}%"></i></span>
        <span style="margin-left:7px">+${(g.mult||0).toFixed(1)}×</span></td>
      <td>${sparkSvg(g.s,90,24,"lt"+g.id)}</td>
      <td><div style="display:flex;gap:6px">
        <button class="iconbtn" data-watch="${g.id}" aria-pressed="${st.watch.includes(g.id)}">${svg(I.eye,14)}</button>
        <button class="iconbtn" data-cmp="${g.id}" aria-pressed="${st.compare.includes(g.id)}">${svg(I.plus||I.grid,14)}</button>
      </div></td></tr>`; }).join("")}</tbody></table></div>`;
}

/* — fiche jeu — */
function viewDetail() {
  const g = byId(st.sel);
  if (!g) return `<div class="empty"><h3>Jeu introuvable</h3><p>Il a peut-être quitté le radar au dernier relevé.</p></div>`;
  const gr = grade(g.score), d24 = g.d24;
  return `<div><button class="btn btn-ghost" data-view="radar">← Retour au radar</button></div>
  <div class="detail-head">
    <div class="thumb" style="${thumbCss(g,120,14)}"></div>
    <div style="min-width:0;flex:1">
      <h1>${esc(g.name)}</h1>
      <p class="muted" style="margin:0 0 10px;font-size:13.5px">par ${esc(g.creator)} · ${esc(g.genre)} · sortie il y a ${ageF(g.age)}</p>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">
        <span class="tag" style="${tagStyle(g.stage)}">${stageLabel(g.stage)}</span>
        ${(g.kw||[]).map(k=>`<span class="tag" style="color:#c47cf2;background:#2a1050">${esc(k.toUpperCase())}</span>`).join("")}
        ${g.clones ? `<span class="tag" style="color:#b2b6ca;background:#1e1733">${g.clones} CLONES DÉTECTÉS</span>`:""}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" data-watch="${g.id}">${svg(I.eye,16)}${st.watch.includes(g.id)?"Suivi":"Suivre"}</button>
        <button class="btn btn-secondary" data-cmp="${g.id}">${svg(I.grid,16)}Comparer</button>
        <a class="btn btn-secondary" target="_blank" rel="noopener" href="https://www.roblox.com/games/${g.root}">Ouvrir sur Roblox</a>
      </div></div>
    <div class="scorecard"><div class="k">Score de percée</div>
      <div class="v" style="color:${GRADE[gr]}">${g.score}</div>
      <div class="g" style="color:${GRADE[gr]}">GRADE ${gr}</div></div>
  </div>

  <div class="kpis">
    ${[["Joueurs en ligne",fmt(g.ccu),`<span style="color:${d24>=0?"#3ddc84":"#f06060"}">${pct(d24)} / 24 h</span>`],
       ["Visites",fmt(g.visits),`+${fmt(g.vpd)} / jour`],
       ["Ratio likes",g.likes+" %",`${fmt(g.votes||0)} votes`],
       ["Revenu estimé / j",usd(g.usd),`≈ ${usd(g.usd*30)} / mois`],
       ["Engagement",(g.ret||0)+" %",`indice, pas la rétention J1`],
       ["Âge",ageF(g.age),`mis à jour il y a ${ageF(g.sinceUpdate||0)}`]]
      .map(([l,v,s])=>`<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s muted">${s}</div></div>`).join("")}
  </div>

  <div class="split">
    <div class="panel"><div class="phead"><h3>Joueurs connectés — ${DATA.historyDays||7} derniers jours</h3></div>
      ${bigChart(g)}</div>
    <div>
      <div class="panel"><div class="phead"><h3>Signaux</h3></div>
        <div class="sigrow">${(g.bars||[]).map((v,i)=>`<span class="muted">${BAR_LABELS[i]}</span>
          <span class="t"><i style="width:${Math.max(2,Math.min(100,v))}%"></i></span>
          <span style="text-align:right">${Math.round(v)}</span>`).join("")}</div></div>
      <div class="panel" style="margin-top:var(--s3)"><div class="phead"><h3>Lecture</h3></div>
        ${(g.insights||[]).map(t=>`<div class="insight">${esc(t)}</div>`).join("")}</div>
    </div>
  </div>`;
}
function bigChart(g) {
  const s = g.s || [];
  if (s.length < 2) return `<p class="muted" style="font-size:13px">Pas encore assez d'historique : il faut deux relevés pour tracer une courbe.</p>`;
  const w = 600, h = 190, { line, area } = spark(s, h);
  const max = Math.max(...s);
  return `<svg viewBox="0 0 300 ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px">
    <defs><linearGradient id="big" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c43ee0" stop-opacity=".4"/><stop offset="1" stop-color="#c43ee0" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#big)"/>
    <path d="${line}" fill="none" stroke="#d05fe8" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div style="display:flex;justify-content:space-between;font-size:11.5px" class="muted">
      <span>il y a ${DATA.historyDays||7} j</span><span>pic ${fmt(max)} joueurs</span><span>maintenant</span></div>`;
}

/* — comparateur — */
function viewCompare() {
  const games = st.compare.map(byId).filter(Boolean);
  if (!games.length) return `${headTitle("Comparer","Jusqu'à 4 jeux côte à côte. Ajoute-les avec le bouton + sur les cartes.")}
    <div class="empty"><h3>Aucun jeu sélectionné</h3><p>Retourne au radar et clique le + d'une carte.</p></div>`;
  const rows = [
    ["Score", g=>g.score, "max"], ["Stade", g=>stageLabel(g.stage), null],
    ["Joueurs", g=>fmt(g.ccu), "max", g=>g.ccu], ["Visites", g=>fmt(g.visits), "max", g=>g.visits],
    ["Ratio likes", g=>g.likes+" %", "max", g=>g.likes], ["Revenu / j", g=>usd(g.usd), "max", g=>g.usd],
    ["Engagement", g=>(g.ret||0)+" %", "max", g=>g.ret], ["Momentum", g=>"+"+(g.mult||0).toFixed(1)+"×", "max", g=>g.mult],
    ["Âge", g=>ageF(g.age), "min", g=>g.age], ["Clones", g=>g.clones||0, "min", g=>g.clones||0],
    ["Genre", g=>g.genre, null], ["Créateur", g=>g.creator, null],
    ["Tendance", g=>sparkSvg(g.s,110,30,"cp"+g.id), null],
  ];
  return `${headTitle("Comparer", games.length+" jeu"+(games.length>1?"x":"")+" sélectionné"+(games.length>1?"s":"")+" sur 4.")}
  <div class="tablewrap"><table class="cmp"><thead><tr><th class="lbl"></th>
    ${games.map(g=>`<th><div style="display:flex;gap:9px;align-items:center">
      <div class="thumb" style="${thumbCss(g,34,8)}"></div>
      <div style="min-width:0"><div style="font-weight:600;font-size:13px">${esc(g.name)}</div>
        <div class="muted" style="font-size:11.5px">${esc(g.creator)}</div></div>
      <button class="btn btn-ghost" data-cmp="${g.id}" style="margin-left:auto">×</button></div></th>`).join("")}
  </tr></thead><tbody>
    ${rows.map(([label, f, dir, raw]) => {
      const vals = games.map(raw || f);
      let best = null;
      if (dir) { const nums = vals.map(Number); best = dir==="max" ? Math.max(...nums) : Math.min(...nums); }
      return `<tr><td class="lbl">${label}</td>${games.map((g,i)=>{
        const isBest = dir && Number(vals[i]) === best && games.length > 1;
        return `<td class="${isBest?"best":""}">${f(g)}</td>`; }).join("")}</tr>`;
    }).join("")}
  </tbody></table></div>`;
}
const headTitle = (t, s) => `<header class="page-head"><div><h1 style="font-size:28px">${t}</h1>
  <p>${s}</p></div></header>`;

/* — watchlist — */
function viewWatch() {
  const games = st.watch.map(byId).filter(Boolean).sort((a,b)=>b.score-a.score);
  if (!games.length) return `${headTitle("Watchlist","Les jeux que tu suis, avec leurs chiffres du dernier relevé.")}
    <div class="empty"><h3>Watchlist vide</h3><p>Clique l'œil sur une carte du radar pour y ajouter un jeu.</p></div>`;
  return `<header class="page-head"><div><h1 style="font-size:28px">Watchlist</h1>
    <p>${games.length} jeu${games.length>1?"x":""} suivi${games.length>1?"s":""}.</p></div>
    <button class="btn btn-secondary" id="csv">${svg(I.scan,15)}Exporter CSV</button></header>
  ${games.map(g=>`<div class="wl">
    <div class="thumb" style="${thumbCss(g,28,7)}"></div>
    <div style="min-width:160px;flex:1"><div style="font-weight:600;font-size:13.5px">${esc(g.name)}</div>
      <div class="muted" style="font-size:11.5px">${esc(g.creator)} · ${esc(g.genre)}</div></div>
    <span class="tag" style="${tagStyle(g.stage)}">${stageLabel(g.stage)}</span>
    ${[["Joueurs",fmt(g.ccu)],["USD/j",usd(g.usd)],["Momentum","+"+(g.mult||0).toFixed(1)+"×"],
       ["Δ 24 h",`<span style="color:${g.d24>=0?"#3ddc84":"#f06060"}">${pct(g.d24)}</span>`]]
      .map(([l,v])=>`<div class="st"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("")}
    ${sparkSvg(g.s,100,32,"wl"+g.id)}
    <div style="font-size:24px;font-weight:700;color:${GRADE[grade(g.score)]}">${g.score}</div>
    <button class="btn btn-ghost" data-watch="${g.id}">Retirer</button>
  </div>`).join("")}`;
}

/* — journal des scans — */
function viewScans() {
  const runs = DATA.runs || [];
  return `${headTitle("Mes scans","Journal du collecteur : ce qu'il a vu à chaque passage.")}
  ${runs.length ? `<div class="tablewrap"><table class="rs-table" style="min-width:600px">
    <thead><tr><th>Heure</th><th>Jeux analysés</th><th>Nouveaux détectés</th><th>Modded écartés</th><th>Durée</th></tr></thead>
    <tbody>${runs.slice().reverse().map(r=>`<tr style="cursor:default">
      <td>${new Date(r.t).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</td>
      <td>${nbsp(r.scanned)}</td><td style="color:#3ddc84">+${nbsp(r.discovered)}</td>
      <td class="muted">${nbsp(r.modded)}</td><td class="muted">${r.sec} s</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><h3>Aucun passage enregistré</h3><p>Le journal se remplit au premier relevé.</p></div>`}`;
}

/* — rail droite — */
function renderRail() {
  if (!DATA) return;
  const tags = DATA.trending || [], acts = DATA.activity || [], creators = DATA.creators || [];
  const actIcon = { new:["bell","#f06060","#3a0f1a"], spike:["trend","#3ddc84","#0b3a22"],
    update:["refresh","#6aa6ff","#0b2f6b"], detect:["shield","#c47cf2","#2a1050"] };
  $("#rail").innerHTML = `
  <div class="panel"><div class="phead"><h3>Tags tendance</h3></div>
    ${tags.slice(0,10).map(t=>`<button class="tagrow" data-tag="${esc(t.tag)}">
      <span class="h">#</span><span class="n">${esc(t.tag)}</span><span class="c">${fmt(t.count)}</span></button>`).join("")
      || `<p class="muted" style="font-size:12.5px;margin:0">Les tags apparaissent après quelques relevés.</p>`}</div>

  <div class="panel"><div class="phead"><h3><span class="livedot"></span>Activité live</h3></div>
    ${acts.slice(0,6).map(a => { const [ic,c,bg] = actIcon[a.type] || actIcon.detect;
      return `<div class="act"><div class="ico" style="background:${bg};color:${c}">${svg(I[ic],14)}</div>
        <div style="min-width:0"><div class="t">${esc(a.title)}</div>
          <div class="s" style="color:${a.type==="spike"?"#3ddc84":"var(--n500)"}">${esc(a.sub)}</div></div>
        <span class="w">${esc(a.when)}</span></div>`; }).join("")
      || `<p class="muted" style="font-size:12.5px;margin:0">Rien depuis le dernier relevé.</p>`}</div>

  <div class="panel"><div class="phead"><h3>Top créateurs (7 j)</h3></div>
    ${creators.slice(0,5).map((c,i)=>`<div class="creator"><span class="rk">${i+1}</span>
      <span class="av" style="background:linear-gradient(135deg,oklch(55% .14 ${(i*67)%360}),oklch(32% .09 ${(i*67+40)%360}))"></span>
      <span class="n">${esc(c.name)}</span><span class="g">${c.games} jeu${c.games>1?"x":""}</span></div>`).join("")
      || `<p class="muted" style="font-size:12.5px;margin:0">—</p>`}</div>`;
}

/* ------------------------------------------------------------- événements */
function bind() {
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
    const v = b.dataset.view;
    st.view = v;
    if (v === "trends") { st.sortKey = "momentum"; st.tab = "growth"; }
    if (v === "soon") { st.sortKey = "age"; st.tab = "new"; }
    if (v === "radar") { st.tab = "all"; }
    render();
  });
  document.querySelectorAll("[data-open]").forEach(b => b.onclick = e => {
    if (e.target.closest("[data-watch],[data-cmp]")) return;
    st.sel = +b.dataset.open; st.view = "detail"; render(); window.scrollTo(0,0);
  });
  document.querySelectorAll("[data-watch]").forEach(b => b.onclick = e => {
    e.stopPropagation(); const id = +b.dataset.watch;
    st.watch = st.watch.includes(id) ? st.watch.filter(x=>x!==id) : [...st.watch, id];
    store.set("watch", st.watch); render();
  });
  document.querySelectorAll("[data-cmp]").forEach(b => b.onclick = e => {
    e.stopPropagation(); const id = +b.dataset.cmp;
    if (st.compare.includes(id)) st.compare = st.compare.filter(x=>x!==id);
    else if (st.compare.length < 4) st.compare = [...st.compare, id];
    render();
  });
  document.querySelectorAll("[data-genre]").forEach(b => b.onclick = () => {
    const n = b.dataset.genre; st.genre = n === "Tous les jeux" ? "" : n; render();
  });
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(); });
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
    st.mode = b.dataset.mode; store.set("mode", st.mode); render();
  });
  document.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => {
    st.query = b.dataset.tag; st.view = "radar"; render();
  });
  const q = $("#q");
  if (q) q.oninput = () => { const p = q.selectionStart; st.query = q.value; render();
    const n = $("#q"); if (n) { n.focus(); n.setSelectionRange(p,p); } };
  const sel = $("#sort"); if (sel) sel.onchange = e => { st.sortKey = e.target.value; render(); };
  const sf = $("#stagef"); if (sf) sf.onchange = e => { st.stageF = e.target.value; render(); };
  const mc = $("#minccu"); if (mc) mc.onchange = e => { st.minCcu = e.target.value; render(); };
  const cl = $("#clones"); if (cl) cl.onclick = () => { st.groupClones = !st.groupClones; render(); };
  const rs = $("#reset"); if (rs) rs.onclick = () => {
    Object.assign(st, { tab:"all", genre:"", stageF:"", query:"", sortKey:"score", minCcu:"0", groupClones:true });
    render();
  };
  const csv = $("#csv"); if (csv) csv.onclick = exportCsv;
}

function exportCsv() {
  const games = st.watch.map(byId).filter(Boolean);
  const head = ["nom","createur","genre","stade","score","joueurs","visites","likes","age_jours","usd_jour","momentum","lien"];
  const rows = games.map(g => [g.name, g.creator, g.genre, g.stage, g.score, g.ccu, g.visits, g.likes,
    g.age, g.usd, g.mult, "https://www.roblox.com/games/"+g.root]);
  const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8" }));
  a.download = "watchlist-roscouting.csv"; a.click();
}

document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); $("#q")?.focus(); }
  if (e.key === "Escape" && st.view === "detail") { st.view = "radar"; render(); }
});
