/* ============================================================================
   RoScouting — collecteur
   Un cycle = découvrir, mesurer, filtrer, noter, exporter data/radar.json.
   Le workflow lance un run qui enchaîne les cycles toutes les CYCLE_MS.

   Priorités, dans l'ordre :
     1. voir les jeux LE PLUS TÔT possible (découverte agressive et ciblée)
     2. ne jamais laisser passer un jeu modded / clone bas de gamme
     3. tenir un cycle en moins de 5 minutes
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("data");
const DAY = 86400000;
const CYCLE_MS = +(process.env.CYCLE_MS || 300000);    // 5 min entre deux cycles
const RUN_MS = +(process.env.RUN_MS || 3000000);       // 50 min par run GitHub
const MAX_DETAIL = +(process.env.MAX_DETAIL || 2600);  // jeux rafraîchis par cycle
const HISTORY_DAYS = 14;

/* ------------------------------------------------------------------ réseau */
const PROXIES = [u => u,
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://corsproxy.io/?" + encodeURIComponent(u)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let netErr = {};

async function rget(url, { tries = 2, quiet = false } = {}) {
  for (let p = 0; p < PROXIES.length; p++) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(PROXIES[p](url), {
          headers: { "User-Agent": "RoScouting/3.0", Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (r.status === 429) { await sleep(900 * (i + 1)); continue; }
        if (r.status === 404 || r.status === 400) return null;
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) {
        if (!quiet) {
          const k = url.split("/")[2] + " " + String(e.message).slice(0, 30);
          netErr[k] = (netErr[k] || 0) + 1;
        }
        await sleep(250 * (i + 1));
      }
    }
  }
  return null;
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i*n, i*n+n));

async function batched(ids, urlFor, key = "data", size = 50, par = 4) {
  const parts = chunk(ids, size), out = [];
  for (const group of chunk(parts, par)) {
    const res = await Promise.all(group.map(p => rget(urlFor(p))));
    res.forEach((r, i) => {
      if (r?.[key]) out.push(...r[key]);
      else if (group[i].length > 1) parts.push(...chunk(group[i], Math.ceil(group[i].length/2)));
    });
  }
  return out;
}

/* --------------------------------------------------- listes éditables */

/* Recherches lancées sur Roblox pour DÉCOUVRIR des jeux. Rotation à chaque cycle. */
const SEED_QUERIES = [
  "egg","eggs","hatch","egg simulator","steal a","grow a","build a","brainrot","plant",
  "garden","fish","fishing","anime","tycoon","obby","survive","horror","rng","luck","aura",
  "pet","trading","simulator","roleplay","99 nights","sea","clicker","merge","backrooms",
  "car","football","tower defense","dig","mine","escape","find the","sword","gacha","idle",
];

/* Mots-clés porteurs pour un jeu tout jeune. Le collecteur en calcule d'autres
   automatiquement à chaque cycle (voir trendingAuto). */
const TREND_SEED = ["egg","eggs","hatch","hatching","nest","steal","grow","build","brainrot",
  "plant","garden","rng","luck","aura","merge","fish","fishing","dig","99","nights"];

/* ------------------------------------------------------------ anti-modded */
const MOD_PATTERNS = [
  [/\bmodded\b|\bmods?\b|\bunmodded\b/i, "modded"],
  [/\bunlimited\b|\binfinite\b|\bunli\b/i, "unlimited"],
  [/\bx\s?\d{2,}\b|\b\d{2,}\s?x\b/i, "multiplicateur"],
  [/\bfree\s?(gamepass|admin|vip|robux|items?|pets?|spawner)\b/i, "free gamepass"],
  [/\ball\s?(unlocked|items?|pets?|weapons?)\b|\bmax(ed)?\s?(stats?|level|luck)\b/i, "all unlocked"],
  [/\bhacked?\b|\bcracked?\b|\bexploits?\b|\bcheats?\b|\bscripts?\b/i, "exploit"],
  [/\bauto\s?farm\b|\bafk\s?farm\b|\bno\s?cooldown\b|\bdup(e|ing)\b/i, "auto farm"],
  [/\bprivate\s?server\b|\buncopylocked\b|\btest(ing)?\s?(place|game|server)\b/i, "place de test"],
  [/\bremake\b|\bclone\b|\bcopy\b|\b(fan|free)\s?made\b|\bfangame\b/i, "remake"],
  [/\[[^\]]*(mod|free|unlimited|admin|x\d|spawner)[^\]]*\]/i, "balise [MOD]"],
  [/\bop\s?(admin|script|gui)\b|\badmin\s?panel\b/i, "admin panel"],
];
/* Gros jeux : un titre qui les reprend en ajoutant autre chose est un clone. */
const BIG_TITLES = ["grow a garden","steal a brainrot","99 nights in the forest","blox fruits",
  "adopt me","brookhaven","dress to impress","fisch","murder mystery","doors","rivals",
  "blade ball","pet simulator","jailbreak","arsenal","bee swarm","tower defense simulator",
  "anime vanguards","forsaken","steal a fish","plants vs brainrots","dead rails","natural disaster"];

const norm = s => String(s||"").toLowerCase().replace(/[_\-–—|]+/g," ").replace(/\s+/g," ").trim();

function moddedReason(g) {
  const t = norm(g.name), d = norm(g.description).slice(0, 400);
  for (const [rx, label] of MOD_PATTERNS) if (rx.test(t)) return label;
  for (const big of BIG_TITLES) if (t.includes(big) && t.replace(big, "").trim().length > 0)
    return "clone de « " + big + " »";
  if (/\b(modded|unlimited|free gamepass|all unlocked|auto ?farm|dupe|exploit)\b/.test(d)) return "description modded";
  if (t.length < 3) return "titre vide";
  if ((String(g.name).match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length >= 5) return "spam emoji";
  return null;
}

/* ----------------------------------------------------------------- genres */
const GENRE_RULES = [
  ["Brainrot & Steal", /\b(brainrot|steal a|steal an|steal the|stealing)\b/i],
  ["RNG & Chance", /\b(rng|luck|aura|roll|gacha|hatch|egg|unbox|chance)\b/i],
  ["Tower Defense", /\b(tower defense|defend|defense|survive the waves?)\b/i],
  ["Horreur", /\b(horror|scary|nextbot|backrooms|escape the|haunted|zombie|piggy|doors)\b/i],
  ["Obby & Parkour", /\b(obby|parkour|speed ?run|tower of|jump|climb|find the)\b/i],
  ["Anime", /\b(anime|ninja|saiyan|demon|slayer|manga|jujutsu|battlegrounds)\b/i],
  ["Fighting", /\b(fight|combat|battle|pvp|arena|war|sword|blade|boxing)\b/i],
  ["Tycoon", /\b(tycoon|empire|factory|business|shop|restaurant|store)\b/i],
  ["Simulateur", /\b(simulator|clicker|mining|mine|dig|farm|grow|merge|collect|idle)\b/i],
  ["Survie & Évasion", /\b(survive|survival|escape|prison|raft|island|hunger|nights)\b/i],
  ["Roleplay & Vie", /\b(roleplay|life|city|town|school|family|house|home|hangout)\b/i],
];
const GENRE_FROM_ROBLOX = {
  "Simulation":"Simulateur", "Strategy":"Tower Defense", "Fighting":"Fighting",
  "Horror":"Horreur", "Obby & Platformer":"Obby & Parkour", "Survival":"Survie & Évasion",
  "Roleplay & Avatar Sim":"Roleplay & Vie", "RPG":"Anime", "Adventure":"Survie & Évasion",
  "Shooter":"Fighting", "Sports & Racing":"Fighting", "Party & Casual":"Obby & Parkour",
};
function genreOf(g) {
  for (const [label, rx] of GENRE_RULES) if (rx.test(g.name)) return label;
  return GENRE_FROM_ROBLOX[g.genre_l1] || GENRE_FROM_ROBLOX[g.genre] || "Simulateur";
}

/* ------------------------------------------------------------- découverte */
const okUid = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 1e13; };
const sid = () => "rs-" + Math.random().toString(36).slice(2, 10);

async function discover(state) {
  const found = new Set();
  const add = arr => (arr || []).forEach(g => {
    const u = g.universeId ?? g.universeID ?? g.id ?? g.contentId;
    if (okUid(u)) found.add(Number(u));
  });

  /* a. classements publics : ce que Roblox pousse en ce moment */
  const sorts = await rget(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${sid()}&device=computer&country=all`);
  await Promise.all((sorts?.sorts || []).map(async s => {
    add(s.games);
    if (!s.sortId && !s.topicId) return;
    const c = await rget(`https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${sid()}` +
      `&sortId=${encodeURIComponent(s.sortId||"")}&topicId=${encodeURIComponent(s.topicId||"")}` +
      `&device=computer&country=all`, { quiet: true });
    add(c?.games);
  }));

  /* b. recherche par mots-clés, en rotation, plus les tendances du cycle précédent */
  const off = state.cycle * 12;
  const queries = [...Array(12)].map((_, i) => SEED_QUERIES[(off + i) % SEED_QUERIES.length])
    .concat((state.trending || []).slice(0, 6).map(t => t.tag));
  await Promise.all([...new Set(queries)].map(async q => {
    const r = await rget(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}` +
      `&sessionId=${sid()}&pageType=all`, { quiet: true });
    for (const grp of (r?.searchResults || [])) add(grp.contents);
  }));

  /* c. « jeux similaires » des 30 jeux les plus chauds : c'est là que sortent les
        nouveautés d'une niche, souvent avant qu'elles n'atteignent un classement */
  await Promise.all((state.hotIds || []).slice(0, 30).map(async id => {
    const r = await rget(`https://games.roblox.com/v1/games/recommendations/game/${id}?maxRows=20`, { quiet: true });
    add(r?.games);
  }));

  /* d. veille créateurs : un studio qui a déjà un hit sort souvent le suivant */
  await Promise.all((state.watchDevs || []).slice(0, 25).map(async d => {
    const url = d.type === "Group"
      ? `https://games.roblox.com/v2/groups/${d.id}/games?accessFilter=Public&sortOrder=Desc&limit=25`
      : `https://games.roblox.com/v2/users/${d.id}/games?accessFilter=Public&sortOrder=Desc&limit=25`;
    const r = await rget(url, { quiet: true });
    add(r?.data);
  }));

  return found;
}

/* ------------------------------------------------------------ gamepasses */
async function fetchPasses(ids, cache, now) {
  const todo = ids.filter(id => !cache[id] || now - cache[id].t > DAY).slice(0, 260);
  for (const group of chunk(todo, 6)) {
    await Promise.all(group.map(async id => {
      const r = await rget(`https://games.roblox.com/v1/games/${id}/game-passes?limit=100&sortOrder=Asc`, { quiet: true });
      const prices = (r?.data || []).map(p => p.price).filter(p => typeof p === "number" && p > 0).sort((a,b) => a-b);
      cache[id] = { t: now, n: prices.length, med: prices.length ? prices[Math.floor(prices.length/2)] : 0 };
    }));
  }
  return cache;
}

/* ---------------------------------------------------------------- outils */
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const log10 = v => Math.log10(Math.max(1, v));
const STOP = new Set(["the","and","for","you","your","with","new","get","all","best","game",
  "play","beta","update","updated","roblox","official","release","simulator","tycoon","obby"]);
const tokens = n => norm(n).replace(/[^a-z0-9 ]/g," ").split(" ")
  .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA,f),"utf8")); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(path.join(DATA,f), JSON.stringify(v));

/* ================================================================ cycle */
async function cycle(state) {
  const t0 = Date.now(), now = t0;
  netErr = {};
  fs.mkdirSync(DATA, { recursive: true });

  /* 1. découverte */
  const found = await discover(state);
  const known = new Set(state.universe);
  const fresh = [...found].filter(id => !known.has(id));
  fresh.forEach(id => known.add(id));

  /* 2. priorités de rafraîchissement : nouveaux, chauds, jeunes, puis rotation */
  const prio = new Set(fresh);
  for (const id of state.hotIds || []) prio.add(id);
  for (const id of state.youngIds || []) prio.add(id);
  const rest = [...known].filter(id => !prio.has(id));
  const start = rest.length ? (state.cycle * 1500) % rest.length : 0;
  const ids = [...prio, ...rest.slice(start), ...rest.slice(0, start)].slice(0, MAX_DETAIL);

  /* 3. mesures */
  const games = await batched(ids, p => "https://games.roblox.com/v1/games?universeIds=" + p.join(","));
  if (!games.length) { console.log("⚠️ aucune donnée reçue", netErr); return state; }
  const gids = games.map(g => g.id);

  const [votes, icons] = await Promise.all([
    batched(gids, p => "https://games.roblox.com/v1/games/votes?universeIds=" + p.join(",")),
    batched(gids, p => "https://thumbnails.roblox.com/v1/games/icons?universeIds=" + p.join(",") +
      "&size=256x256&format=Png&isCircular=false"),
  ]);
  const voteBy = new Map(votes.map(v => [v.id, v]));
  const iconBy = new Map(icons.map(t => [t.targetId, t.state === "Completed" ? t.imageUrl : null]));

  /* 4. historique */
  const hist = state.hist;
  for (const g of games) {
    const k = String(g.id);
    (hist[k] ||= []).push([Math.round(now/60000), g.playing || 0]);
    hist[k] = hist[k].filter(p => now - p[0]*60000 < HISTORY_DAYS*DAY).slice(-400);
  }
  for (const k of Object.keys(hist))
    if (now - (hist[k].at(-1)?.[0] || 0)*60000 > (HISTORY_DAYS+2)*DAY) delete hist[k];

  const at = (id, hoursAgo) => {
    const arr = hist[String(id)] || [], target = now/60000 - hoursAgo*60;
    let best = null, bd = Infinity;
    for (const p of arr) { const d = Math.abs(p[0]-target); if (d < bd) { bd = d; best = p; } }
    return bd <= Math.max(40, hoursAgo*22) ? best : null;
  };
  const series = id => {                       // 14 points quotidiens pour la sparkline
    const raw = [];
    for (let d = 13; d >= 0; d--) { const p = at(id, d*24); raw.push(p ? p[1] : null); }
    if (raw.filter(v => v != null).length < 2) return null;
    let last = raw.find(v => v != null);
    return raw.map(v => (v == null ? last : (last = v)));
  };

  /* 5. mots-clés tendance calculés sur les données du cycle */
  const tok = new Map();
  for (const g of games) {
    const age = (now - Date.parse(g.created)) / DAY;
    if (!(age > 0 && age < 120) || (g.playing||0) < 100) continue;
    if (moddedReason(g)) continue;              // un mot de jeu modded n'est pas une tendance
    const p6 = at(g.id, 6);
    const w = log10(g.playing) * clamp(p6 ? (g.playing+1)/(p6[1]+1) : 1, .5, 4);
    for (const t of new Set(tokens(g.name))) {
      const e = tok.get(t) || { w:0, devs:new Set() };
      e.w += w; e.devs.add(g.creator?.id || g.creator?.name); tok.set(t, e);
    }
  }
  const trendingAuto = [...tok.entries()]
    .filter(([,e]) => e.w >= 8 && e.devs.size >= 4)      // au moins 4 studios différents
    .sort((a,b) => b[1].w - a[1].w).slice(0, 16)
    .map(([tag,e]) => ({ tag, count: e.devs.size }));
  const TREND = new Set([...TREND_SEED, ...trendingAuto.map(t => t.tag)]);

  /* 6. gamepasses des candidats sérieux (pour l'estimation de revenus) */
  const candidates = games.filter(g => (g.playing||0) >= 40 && !moddedReason(g))
    .sort((a,b) => (b.playing||0) - (a.playing||0)).slice(0, 260).map(g => g.id);
  state.passes = await fetchPasses(candidates, state.passes, now);

  /* 7. fiches */
  const out = [];
  let modded = 0;
  for (const g of games) {
    const created = Date.parse(g.created), updated = Date.parse(g.updated) || created;
    if (!created) continue;
    if (moddedReason(g)) { modded++; continue; }

    const age = (now - created) / DAY;
    const ccu = g.playing || 0, visits = g.visits || 0;
    const v = voteBy.get(g.id) || {};
    const up = v.upVotes || 0, down = v.downVotes || 0, votesN = up + down;
    const likes = votesN >= 15 ? Math.round(up / votesN * 1000) / 10 : null;

    const p6 = at(g.id, 6), p24 = at(g.id, 24), p72 = at(g.id, 72);
    const gr = p => (p ? (ccu - p[1]) / Math.max(8, p[1]) * 100 : null);
    const d6 = gr(p6), d24 = gr(p24), d72 = gr(p72);

    const vpd = visits / Math.max(1, age);          // visites/jour moyennes sur la vie
    const dayVisits = ccu * 24 * 6;                 // trafic du jour, estimé depuis le CCU
    const mult = vpd > 0 ? clamp(dayVisits / vpd, 0, 999) : 0;
    const favRate = visits > 2000 ? (g.favoritedCount||0) / visits : 0;
    const ret = visits > 3000 ? clamp(Math.round(ccu / Math.max(1, vpd/24) * 100), 0, 99) : 0;

    const pass = state.passes[g.id];
    const robuxDay = pass && pass.n
      ? Math.round(dayVisits * 0.006 * pass.med * clamp(pass.n/3, .4, 1.6))
      : Math.round(dayVisits * 0.006 * 35);
    const usdDay = Math.round(robuxDay * 0.0035);

    const words = norm(g.name).split(" ");
    const kw = [...TREND].filter(t => words.includes(t));

    const bars = [
      clamp(50 + (d24 ?? d6 ?? 0) * 0.9, 0, 100),                        // momentum
      clamp(log10(vpd) * 22, 0, 100),                                    // trafic
      likes == null ? 45 : clamp((likes - 70) * 3.2, 0, 100),            // qualité
      clamp(ret * 1.6, 0, 100),                                          // rétention (indice)
      clamp(100 - age/1.2 + (now - updated < 3*DAY ? 12 : 0), 0, 100),   // fraîcheur
      clamp(log10(ccu) * 24 + favRate * 600, 0, 100),                    // demande
    ].map(Math.round);

    const W = [.32,.20,.14,.12,.12,.10];
    let score = bars.reduce((s,b,i) => s + b*W[i], 0);
    if (kw.length) score += 3 + Math.min(4, kw.length*2);
    if (age < 3 && ccu < 15) score -= 10;
    score = Math.round(clamp(score, 0, 100));

    const stage =
      age <= 21 && ccu < 900 && (d24 ?? 0) > 20 ? "Ignition"
      : (d24 ?? 0) > 45 ? "Climbing"
      : (d24 ?? 0) > 12 ? "Warming"
      : kw.length && age <= 45 ? "Trending"
      : age > 200 && ccu > 6000 ? "Established" : "Steady";

    const insights = [];
    if (mult >= 5) insights.push(`Trafic du jour à ${mult.toFixed(1)}× la moyenne vie du jeu`);
    if (age <= 21) insights.push(`Seulement ${Math.round(age)} jours d'existence`);
    if (likes != null && likes >= 92) insights.push(`${likes} % de likes sur ${votesN} votes`);
    if (kw.length) insights.push(`Mot-clé porteur dans le titre : ${kw.join(", ")}`);
    if (d24 != null && d24 >= 30) insights.push(`+${Math.round(d24)} % de joueurs en 24 h`);
    if (ret >= 40) insights.push(`Indice d'engagement élevé (${ret}/99)`);
    if (age < 4) insights.push("Base très faible — signal fragile");
    if (!insights.length) insights.push("Progression régulière, sans pic marqué");

    out.push({
      id: g.id, root: g.rootPlaceId, name: g.name,
      creator: g.creator?.name || "?", creatorId: g.creator?.id, creatorType: g.creator?.type,
      genre: genreOf(g), score, stage,
      ccu, visits, likes: likes == null ? 0 : likes, votes: votesN,
      age: Math.round(age*10)/10, usd: usdDay, robux: robuxDay, ret,
      clones: 0, hue: (g.id * 47) % 360,
      s: series(g.id), bars, mult: Math.round(mult*10)/10, insights: insights.slice(0,3),
      d24: d24 == null ? null : Math.round(d24),
      d6: d6 == null ? null : Math.round(d6),
      d72: d72 == null ? null : Math.round(d72),
      vpd: Math.round(vpd), favs: g.favoritedCount || 0, kw,
      sinceUpdate: Math.round((now - updated)/DAY*10)/10,
      thumb: iconBy.get(g.id) || null, created, updated,
    });
  }

  /* 8. clones : titres quasi identiques regroupés sous le meilleur */
  const sig = new Map();
  for (const g of out) {
    const key = tokens(g.name).sort().slice(0,4).join(" ");
    if (!key) continue;
    if (!sig.has(key)) sig.set(key, []);
    sig.get(key).push(g);
  }
  for (const group of sig.values()) {
    if (group.length < 2) continue;
    group.sort((a,b) => b.score - a.score);
    group[0].clones = group.length - 1;
    for (let i = 1; i < group.length; i++) group[i].cloneOf = group[0].id;
  }

  out.sort((a,b) => b.score - a.score);
  const kept = out.slice(0, 1200);

  /* 9. activité, créateurs, statistiques */
  const seen = state.seen || {};
  const activity = state.activity || [];
  let newSpots = 0;
  for (const g of kept.slice(0, 400)) {
    if (!seen[g.id]) {
      if (g.age <= 30 && newSpots++ < 6) activity.unshift({ type:"new", title:"Nouveau jeu détecté", sub:g.name, ts:now });
      seen[g.id] = { first: now };
    } else if (g.d24 != null && g.d24 >= 60 && g.ccu >= 150 && now - (seen[g.id].spike||0) > 6*3600000) {
      activity.unshift({ type:"spike", title:"Pic de joueurs", sub:`+${Math.round(g.d24)} % · ${g.name}`, ts:now });
      seen[g.id].spike = now;
    } else if (now - g.updated < CYCLE_MS*2) {
      activity.unshift({ type:"update", title:"Jeu mis à jour", sub:g.name, ts:now });
    }
  }
  for (const g of kept) seen[g.id] = seen[g.id] || { first: now };
  state.seen = seen;
  state.activity = activity.slice(0, 40);

  const devs = new Map();
  for (const g of kept.slice(0, 300)) {
    const e = devs.get(g.creator) || { name:g.creator, games:0, score:0 };
    e.games++; e.score += g.score; devs.set(g.creator, e);
  }
  const creators = [...devs.values()].sort((a,b) => b.score - a.score).slice(0, 8);

  const genreCounts = {};
  for (const g of kept) if (!g.cloneOf) genreCounts[g.genre] = (genreCounts[g.genre]||0) + 1;

  const newToday = kept.filter(g => g.age <= 1).length;
  const stats = {
    newToday,
    trending: kept.filter(g => g.kw.length && g.age <= 45).length,
    players: kept.reduce((s,g) => s + g.ccu, 0),
    hits: kept.filter(g => g.score >= 68 && g.age <= 45).length,
    newDelta: state.lastNewToday
      ? (newToday >= state.lastNewToday ? "+" : "−") +
        Math.abs(Math.round((newToday - state.lastNewToday)/Math.max(1,state.lastNewToday)*100)) + " %"
      : "",
  };
  state.lastNewToday = newToday;

  /* 10. export */
  const sec = Math.round((Date.now()-t0)/1000);
  state.runs = [...(state.runs||[]), { t: now, scanned: games.length, discovered: fresh.length, modded, sec }].slice(-120);
  const when = ms => { const m = Math.round(ms/60000); return m < 60 ? `il y a ${Math.max(1,m)} min` : `il y a ${Math.round(m/60)} h`; };

  writeJson("radar.json", {
    generatedAt: now, historyDays: HISTORY_DAYS,
    counts: { scanned: games.length, universe: known.size, rejectedModded: modded, kept: kept.length },
    stats, genreCounts, creators, trending: trendingAuto,
    activity: state.activity.slice(0, 8).map(a => ({ ...a, when: when(now - a.ts) })),
    runs: state.runs.slice(-40),
    games: kept,
  });

  /* 11. état pour le cycle suivant */
  state.universe = [...known].slice(-60000);
  state.hotIds = kept.slice(0, 500).map(g => g.id);
  state.youngIds = kept.filter(g => g.age <= 30).map(g => g.id).slice(0, 700);
  state.watchDevs = [...new Map(kept.slice(0,120).filter(g => g.creatorId)
    .map(g => [g.creatorId, { id:g.creatorId, type:g.creatorType }])).values()];
  state.trending = trendingAuto;
  state.cycle++;
  writeJson("state.json", {
    universe: state.universe, cycle: state.cycle, passes: state.passes, seen: state.seen,
    activity: state.activity, runs: state.runs, hotIds: state.hotIds, youngIds: state.youngIds,
    watchDevs: state.watchDevs, trending: state.trending, lastNewToday: state.lastNewToday,
  });
  writeJson("history.json", hist);

  console.log(`cycle ${state.cycle} · ${sec}s · ${games.length} analysés · ${fresh.length} nouveaux · ` +
    `${modded} modded écartés · ${kept.length} retenus · univers ${known.size}` +
    (Object.keys(netErr).length ? ` · réseau ${JSON.stringify(netErr)}` : ""));
  return state;
}

/* ================================================================ boucle */
async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const saved = readJson("state.json", {});
  let state = {
    universe: saved.universe || [], cycle: saved.cycle || 0, passes: saved.passes || {},
    seen: saved.seen || {}, activity: saved.activity || [], runs: saved.runs || [],
    hotIds: saved.hotIds || [], youngIds: saved.youngIds || [], watchDevs: saved.watchDevs || [],
    trending: saved.trending || [], lastNewToday: saved.lastNewToday || 0,
    hist: readJson("history.json", {}),
  };

  const deadline = Date.now() + RUN_MS;
  const once = process.env.ONCE === "1";
  do {
    const t = Date.now();
    try { state = await cycle(state); } catch (e) { console.error("cycle KO:", e.message); }
    if (once) break;
    const wait = CYCLE_MS - (Date.now() - t);
    if (Date.now() + Math.max(0, wait) > deadline) break;
    if (wait > 0) await sleep(wait);
  } while (Date.now() < deadline);
  console.log("run terminé");
}

export { moddedReason, genreOf, tokens, main, cycle };
if (!process.env.RADAR_TEST) main();
