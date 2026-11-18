// Monthly simulation: traffic (gravity model routed over the network), finances,
// and population / economic growth that follows accessibility.
import { TYPE, costIndex, techSpeed, roadSpeed, airAvailable, interp } from './railtypes.js';
import { heapPush, heapPop, segName } from './network.js';
import { EVENTS } from './places.js';

const FARE_P = 1.6e-7; // Rp miliar per passenger-km (≈ Rp160)
const FARE_F = 5e-7;   // Rp miliar per tonne-km (≈ Rp500)
const START_PAX = 260000, START_FR = 26000; // per day, used to calibrate the gravity constants

const POP_RATE = [[1945, 0.010], [1950, 0.019], [1960, 0.023], [1975, 0.024], [1990, 0.016], [2005, 0.013], [2020, 0.009], [2045, 0.005]];
const GDP_RATE = [[1945, -0.02], [1949, 0.0], [1950, 0.045], [1957, 0.04], [1958, 0.015], [1966, 0.01], [1967, 0.065], [1996, 0.07], [1997, 0.04],
  [1998, -0.13], [1999, 0.01], [2000, 0.048], [2019, 0.05], [2020, -0.02], [2021, 0.04], [2022, 0.05], [2045, 0.05]];
function stepRate(tbl, y) { let r = tbl[0][1]; for (const [yy, v] of tbl) if (y >= yy) r = v; return r; }
const LOAN_RATE = [[1945, 0.05], [1960, 0.08], [1965, 0.2], [1970, 0.1], [1998, 0.18], [2001, 0.09], [2010, 0.07], [2045, 0.06]];
export function loanRate(y) { return stepRate(LOAN_RATE, y); }
export function yearFrac(S) { return S.y + (S.m - 1) / 12; }

export function poiActive(p, y) { return y >= p.year && y < (p.until || 9999); }

// ---------------- traffic ----------------
export function runTraffic(S, W) {
  const y = yearFrac(S);
  const nodes = [], nodeOf = new Map();
  const live = S.segs.filter((g) => g.build <= 0);
  for (const g of live) for (const sid of [g.a, g.b]) if (!nodeOf.has(sid)) { nodeOf.set(sid, nodes.length); nodes.push(S.stById.get(sid)); }
  const N = nodes.length;
  for (const s of S.stations) { s.rid = 0; s.fr = 0; s.acc = 0; }
  if (!N) { for (const g of S.segs) { g.loadP = g.loadF = g.sP = g.sF = g.rev = 0; } return { pax: 0, fr: 0, revDay: 0, pkm: 0, tkm: 0 }; }

  // catchment: own kecamatan fully, unserved neighbours shared between adjacent stations
  const share = new Map();
  for (let i = 0; i < N; i++) {
    const k = nodes[i].k;
    for (const j of W.nbr[k]) if (!S.stByKec.has(j) || !nodeOf.has(S.stByKec.get(j).id)) {
      if (!share.has(j)) share.set(j, []);
      share.get(j).push(i);
    }
  }
  const P = new Float64Array(N), G = new Float64Array(N), GOODS = new Float64Array(N);
  for (let i = 0; i < N; i++) { const k = nodes[i].k; P[i] = W.pop[k]; G[i] = W.grdp[k]; GOODS[i] = W.grdp[k] * W.goods[k]; }
  for (const [j, list] of share) {
    const w = 0.4 / list.length;
    for (const i of list) { P[i] += W.pop[j] * w; G[i] += W.grdp[j] * w; GOODS[i] += W.grdp[j] * W.goods[j] * w; }
  }
  let natPop = 0, natGdp = 0;
  for (let k = 0; k < W.n; k++) { natPop += W.pop[k]; natGdp += W.grdp[k]; }
  const incNat = natGdp / natPop;
  const PM = new Float64Array(N), F = new Float64Array(N), C = new Float64Array(N);
  const typesAt = new Map();
  for (const g of live) for (const sid of [g.a, g.b]) { if (!typesAt.has(sid)) typesAt.set(sid, new Set()); typesAt.get(sid).add(g.type); }
  for (let i = 0; i < N; i++) {
    const s = nodes[i], k = s.k;
    const inc = G[i] / Math.max(P[i], 1);
    let pm = P[i] * Math.pow(inc / incNat, 0.5);
    let f = GOODS[i], c = (G[i] - GOODS[i]) * 0.6;
    if (W.capital[k]) pm *= 1.25;
    const tset = typesAt.get(s.id);
    if ((tset.has('funikular') || tset.has('gantung')) && W.terrain[k] >= 2) pm *= 1.4;
    for (const kk of [k, ...W.nbr[k]]) {
      const pois = W.poisByKec.get(kk);
      if (!pois) continue;
      const w = kk === k ? 1 : 0.5;
      for (const p of pois) {
        if (!poiActive(p, y)) continue;
        const L = p.level * w;
        if (p.kind === 'port') { f += natGdp * 0.0012 * L; c += natGdp * 0.0025 * L; pm *= 1 + 0.12 * L; }
        else if (p.kind === 'airport') { pm *= 1 + (y >= 1970 ? 0.3 : 0.15) * L * (tset.has('agt') || tset.has('mrt') || tset.has('lrt') ? 2 : 1); }
        else if (p.kind === 'resource') { f += natGdp * (['oil', 'gas', 'coal', 'tin', 'bauxite', 'nickel', 'copper', 'gold'].includes(p.sub) ? 0.0012 : 0.0006) * L; }
        else if (p.kind === 'industry') { f += natGdp * 0.0008 * L; c += natGdp * 0.0006 * L; }
      }
    }
    PM[i] = pm; F[i] = f; C[i] = c;
  }

  // edges
  const E = live.length;
  const ea = new Int32Array(E), eb = new Int32Array(E), et = new Float64Array(E), ekm = new Float64Array(E);
  const adjP = Array.from({ length: N }, () => []), adjF = Array.from({ length: N }, () => []);
  live.forEach((g, e) => {
    const t = TYPE[g.type];
    ea[e] = nodeOf.get(g.a); eb[e] = nodeOf.get(g.b); ekm[e] = g.km;
    et[e] = g.km / (t.speed * techSpeed(t, y) * (0.45 + 0.55 * g.cond)) + (t.family === 'urban' ? 0.03 : 0.08);
    if (t.pax >= 0.2) { adjP[ea[e]].push(e); adjP[eb[e]].push(e); }
    if (t.freight > 0) { adjF[ea[e]].push(e); adjF[eb[e]].push(e); }
  });
  const loadP = new Float64Array(E), loadF = new Float64Array(E);
  const T = new Float64Array(N), D = new Float64Array(N), pred = new Int32Array(N), sub = new Float64Array(N);
  const vRoad = roadSpeed(y), air = airAvailable(y);
  const rid = new Float64Array(N), frs = new Float64Array(N), acc = new Float64Array(N);
  let totPax = 0, totFr = 0;
  const Gp = S.gp || 1, Gf = S.gf || 1;

  const dijkstra = (src, adj) => {
    T.fill(Infinity); D.fill(0); pred.fill(-1);
    T[src] = 0;
    const order = [], heap = [[0, src]], done = new Uint8Array(N);
    while (heap.length) {
      const [tt, u] = heapPop(heap);
      if (done[u]) continue;
      done[u] = 1; order.push(u);
      if (tt > 30) break;
      for (const e of adj[u]) {
        const v = ea[e] === u ? eb[e] : ea[e];
        const nt = tt + et[e];
        if (nt < T[v]) { T[v] = nt; D[v] = D[u] + ekm[e]; pred[v] = e; heapPush(heap, [nt, v]); }
      }
    }
    return order;
  };
  const push = (order, load, src) => {
    for (let i = order.length - 1; i > 0; i--) {
      const v = order[i], e = pred[v];
      if (e < 0 || !sub[v]) continue;
      load[e] += sub[v];
      const u = ea[e] === v ? eb[e] : ea[e];
      sub[u] += sub[v];
    }
  };

  for (let s = 0; s < N; s++) {
    // passengers
    let order = dijkstra(s, adjP);
    sub.fill(0);
    acc[s] += P[s];
    for (let i = 1; i < order.length; i++) {
      const t = order[i], d = D[t], tt = T[t];
      if (tt > 30) continue;
      let talt = d * 1.3 / vRoad;
      if (air && d > 300) talt = Math.min(talt, 2.5 + d / 550);
      const shr = 1 / (1 + Math.pow(tt / talt, 2.2));
      const q = Gp * PM[s] * PM[t] / Math.pow(d + 25, 1.7) * shr;
      sub[t] = q; rid[s] += q; rid[t] += q; totPax += q;
      acc[s] += P[t] * Math.exp(-tt / 2.5);
    }
    push(order, loadP, s);
    // freight
    if (F[s] > 0) {
      order = dijkstra(s, adjF);
      sub.fill(0);
      for (let i = 1; i < order.length; i++) {
        const t = order[i], d = D[t], tt = T[t];
        const talt = d * 1.3 / (vRoad * 0.8);
        const shr = 1 / (1 + Math.pow(tt / talt, 1.5));
        const q = Gf * F[s] * C[t] / Math.pow(d + 60, 1.2) * shr;
        sub[t] = q; frs[s] += q; frs[t] += q; totFr += q;
      }
      push(order, loadF, s);
    }
  }

  let revDay = 0, pkm = 0, tkm = 0;
  live.forEach((g, e) => {
    const t = TYPE[g.type];
    let sp = Math.min(loadP[e], t.cap * Math.min(1, t.pax)), sf = Math.min(loadF[e], t.cap * Math.min(1, t.freight));
    if (sp + sf > t.cap) { const r = t.cap / (sp + sf); sp *= r; sf *= r; }
    g.loadP = loadP[e]; g.loadF = loadF[e]; g.sP = sp; g.sF = sf;
    const km = Math.max(g.km, 8);
    g.rev = sp * km * FARE_P * t.fare + sf * km * FARE_F * Math.max(1, t.freight * 0.8);
    revDay += g.rev; pkm += sp * g.km; tkm += sf * g.km;
  });
  for (const g of S.segs) if (g.build > 0) { g.loadP = g.loadF = g.sP = g.sF = g.rev = 0; }
  for (let i = 0; i < N; i++) { nodes[i].rid = rid[i]; nodes[i].fr = frs[i]; nodes[i].acc = acc[i]; }
  return { pax: totPax, fr: totFr, revDay, pkm, tkm };
}

export function calibrate(S, W) {
  S.gp = 1; S.gf = 1;
  const r = runTraffic(S, W);
  S.gp = START_PAX / Math.max(r.pax, 1e-9);
  S.gf = START_FR / Math.max(r.fr, 1e-9);
  return runTraffic(S, W);
}

// ---------------- accessibility per kecamatan ----------------
export function computeAccess(S, W) {
  const a = W.access || (W.access = new Float32Array(W.n));
  a.fill(0);
  for (const s of S.stations) if (s.acc > 0) a[s.k] = Math.max(a[s.k], s.acc / (s.acc + 3e6));
  const own = Float32Array.from(a);
  for (let k = 0; k < W.n; k++) if (own[k] > 0) for (const j of W.nbr[k]) if (own[j] === 0) a[j] = Math.max(a[j], own[k] * 0.45);
}

// ---------------- the monthly tick ----------------
export function monthTick(S, W, ui) {
  const y = yearFrac(S), ci = costIndex(y);
  const news = (txt, cls) => ui.news(txt, cls);

  // construction progress
  for (const g of [...S.segs]) {
    if (g.build > 0) {
      g.build--;
      if (g.build <= 0) {
        g.build = 0;
        news(`🚆 Dibuka: ${TYPE[g.type].name} ${segName(S, g)} (${g.km.toFixed(0)} km)`, 'good');
        if (g.replaces) { const old = S.segById.get(g.replaces); if (old) { S.segs = S.segs.filter((x) => x !== old); S.segById.delete(old.id); } delete g.replaces; }
      }
    }
  }

  // historical events
  for (const ev of EVENTS) if (ev.y === S.y && ev.m === S.m) {
    news('📰 ' + ev.text, 'event');
    if (ev.fx?.cash) S.cash += ev.fx.cash * ci;
    if (ev.fx?.damage) {
      const hit = S.segs.filter((g) => g.build <= 0 && Math.random() < 0.5);
      for (const g of hit) g.cond = Math.max(0.15, g.cond - ev.fx.damage * Math.random() * 2);
    }
  }

  const tr = runTraffic(S, W);
  computeAccess(S, W);

  // connection bonuses for ports, airports, mines and factories
  for (const s of S.stations) {
    if (!(s.acc > 0)) continue;
    const pois = W.poisByKec.get(s.k);
    if (!pois) continue;
    for (const p of pois) {
      if (S.connected.includes(p.id) || !poiActive(p, y)) continue;
      S.connected.push(p.id);
      const bonus = { port: 120, airport: 90, resource: 50, industry: 60 }[p.kind] * p.level * ci;
      S.cash += bonus;
      news(`🎉 ${p.name} tersambung ke jaringan! Bonus Rp ${fmtM(bonus)}`, 'good');
    }
  }

  // economy & population
  const rp = interp(POP_RATE, y) / 12, rg = stepRate(GDP_RATE, y) / 12;
  const n = W.n, acc = W.access;
  let natPop = 0, natGdp = 0;
  for (let k = 0; k < n; k++) { natPop += W.pop[k]; natGdp += W.grdp[k]; }
  const incNat = natGdp / natPop;
  const attr = new Float64Array(n);
  let wsum = 0;
  for (let k = 0; k < n; k++) {
    const inc = W.grdp[k] / Math.max(W.pop[k], 1);
    const dens = W.pop[k] / Math.max(W.area[k], 0.5);
    attr[k] = Math.pow(inc / incNat, 0.35) * (0.5 + 1.6 * acc[k]) / (1 + Math.max(0, dens - 10000) / 8000);
    wsum += attr[k] * W.pop[k];
  }
  const A = wsum / natPop;
  if (!W.pop12) { W.pop12 = Float64Array.from(W.pop); W.popPrev = []; }
  let newPop = 0;
  const oldPop = Float64Array.from(W.pop);
  for (let k = 0; k < n; k++) {
    const mig = Math.max(-0.02, Math.min(0.05, 0.035 * (attr[k] / A - 1))) / 12;
    W.pop[k] *= 1 + rp + mig;
    newPop += W.pop[k];
  }
  const fix = natPop * (1 + rp) / newPop;
  for (let k = 0; k < n; k++) {
    W.pop[k] *= fix;
    const migRatio = W.pop[k] / (oldPop[k] * (1 + rp));
    W.grdp[k] *= (1 + rg + 0.03 * (acc[k] - 0.08) / 12) * Math.pow(migRatio, 0.7);
    const dens = W.pop[k] / Math.max(W.area[k], 0.5);
    W.urban[k] += (Math.min(1, dens / 6000 + acc[k] * 0.2) - W.urban[k]) * 0.01;
  }
  S.histGdp *= 1 + rg;

  // finances
  let maintYr = 0;
  for (const g of S.segs) if (g.build <= 0) maintYr += g.km * TYPE[g.type].maint * ci;
  maintYr += S.stations.length * 0.4 * ci;
  const rev = tr.revDay * 30.4;
  const ops = rev * 0.42;
  const maint = maintYr / 12;
  const interest = S.loan * loanRate(y) / 12 + Math.max(0, -S.cash) * loanRate(y) * 2 / 12;
  const subsidy = natGdp * 0.0003 / 12;
  const profit = rev + subsidy - ops - maint - interest;
  S.cash += profit;
  S.last = { rev, ops, maint, interest, subsidy, profit, pax: tr.pax, fr: tr.fr, pkm: tr.pkm, tkm: tr.tkm, natPop: natPop * (1 + rp), natGdp };
  S.yearAcc = S.yearAcc || { rev: 0, profit: 0, pax: 0, fr: 0 };
  S.yearAcc.rev += rev; S.yearAcc.profit += profit; S.yearAcc.pax += tr.pax * 30.4; S.yearAcc.fr += tr.fr * 30.4;

  // slow wear: older track loses condition unless rehabilitated
  for (const g of S.segs) if (g.build <= 0) g.cond = Math.max(0.2, g.cond - 0.0008);

  // calendar
  S.m++;
  if (S.m > 12) {
    S.m = 1;
    let km = 0; for (const g of S.segs) if (g.build <= 0) km += g.km;
    S.hist.push({ y: S.y, pop: natPop, gdp: natGdp, hist: S.histGdp, km, rev: S.yearAcc.rev, profit: S.yearAcc.profit, pax: S.yearAcc.pax, fr: S.yearAcc.fr, cash: S.cash, cov: coverage(S, W) });
    S.yearAcc = { rev: 0, profit: 0, pax: 0, fr: 0 };
    W.pop12 = Float64Array.from(W.pop);
    S.y++;
  }
  if (S.cash < -maxLoan(S) * 0.5 && !S.warnedDebt) { S.warnedDebt = true; news('⚠️ Kas sangat negatif! Bunga cerukan 2× lipat. Kurangi pembangunan atau ambil pinjaman.', 'bad'); }
  if (S.cash > 0) S.warnedDebt = false;
}

export function coverage(S, W) {
  let c = 0, t = 0;
  for (let k = 0; k < W.n; k++) { t += W.pop[k]; if (W.access && W.access[k] > 0) c += W.pop[k]; }
  return c / t;
}

export function maxLoan(S) {
  const rev = S.last ? S.last.rev * 12 : 1000;
  return Math.round(3 * rev + 2000 * costIndex(S.y));
}

export function fmtM(v) {
  // v in Rp miliar
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1000) return s + (a / 1000).toLocaleString('id-ID', { maximumFractionDigits: a >= 100000 ? 0 : 1 }) + ' T';
  if (a >= 1) return s + a.toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' M';
  return s + (a * 1000).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' jt';
}
