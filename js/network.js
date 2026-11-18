// Stations, track segments, routing and construction costs.
import { TYPE, costIndex } from './railtypes.js';
import { book, induk } from './company.js';

export function terrainFactor(W, k, t) { return t.terrain[W.terrain[k]] * (W.swamp[k] ? 1.35 : 1); }
export function density(W, k) { return W.pop[k] / Math.max(W.area[k], 0.5); }
export function isDense(W, k) { return density(W, k) >= 1000 || W.urban[k] >= 0.45; }

const STATION_COST = { mrt: 350, lrt: 90, monorel: 80, agt: 60, hsr: 160, maglev: 260, hyperloop: 320, laut: 0, ferry: 40, funikular: 15, gantung: 15, trem: 3, lori: 4 };
export function stationCost(t) { return STATION_COST[t.key] ?? 25; }

// ---------- index helpers ----------
export function reindex(S) {
  S.stById = new Map(S.stations.map((s) => [s.id, s]));
  S.stByKec = new Map(S.stations.map((s) => [s.k, s]));
  S.segById = new Map(S.segs.map((g) => [g.id, g]));
  for (const g of S.segs) if (!g.cum) prepSeg(g);
}

export function prepSeg(g) {
  const p = g.pts, cum = [0];
  for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
  g.cum = cum; g.len = cum[cum.length - 1] || 1;
}

export function pointOnSeg(g, u) {
  const d = u * g.len, c = g.cum, p = g.pts;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
  const f = (d - c[lo]) / Math.max(c[hi] - c[lo], 1e-6);
  return [p[2 * lo] + (p[2 * hi] - p[2 * lo]) * f, p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * f];
}

// ---------- A* over the kecamatan adjacency graph ----------
function astar(W, ka, kb, t) {
  const n = W.n, g = new Float64Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const minTf = Math.min(...t.terrain);
  const h = (k) => Math.hypot(W.x[k] - W.x[kb], W.y[k] - W.y[kb]) * minTf;
  const heap = [[h(ka), ka]];
  g[ka] = 0;
  let iter = 0;
  while (heap.length && iter++ < 80000) {
    const [, k] = heapPop(heap);
    if (closed[k]) continue;
    if (k === kb) break;
    closed[k] = 1;
    const tk = terrainFactor(W, k, t);
    for (const j of W.nbr[k]) {
      if (closed[j]) continue;
      const d = Math.hypot(W.x[j] - W.x[k], W.y[j] - W.y[k]);
      const ng = g[k] + d * 0.5 * (tk + terrainFactor(W, j, t));
      if (ng < g[j]) { g[j] = ng; came[j] = k; heapPush(heap, [ng + h(j), j]); }
    }
  }
  if (!isFinite(g[kb])) return null;
  const path = [];
  for (let k = kb; k !== -1; k = came[k]) path.push(k);
  return path.reverse();
}

export function heapPush(h, v) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
}
export function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}

function chaikin(pts, iter = 2) {
  let p = pts;
  for (let it = 0; it < iter; it++) {
    if (p.length < 6) return p;
    const q = [p[0], p[1]];
    for (let i = 0; i < p.length - 2; i += 2) {
      const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
      q.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    q.push(p[p.length - 2], p[p.length - 1]);
    p = q;
  }
  return p;
}

function polyLen(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; }

export function findSeg(S, a, b, family) {
  return S.segs.find((g) => ((g.a === a && g.b === b) || (g.a === b && g.b === a)) && TYPE[g.type].family === family && !g.replacedBy);
}

// Plan a segment from kecamatan ka to kb. Returns {ok, err, ...} without changing state.
export function planSegment(S, W, ka, kb, typeKey) {
  const t = TYPE[typeKey], ci = costIndex(S.y + (S.m - 1) / 12);
  if (ka < 0 || kb < 0) return { ok: false, err: 'Pilih titik di daratan Indonesia.' };
  if (ka === kb) return { ok: false, err: 'Titik awal dan akhir di kecamatan yang sama.' };
  if (S.y < t.year) return { ok: false, err: `${t.name} baru tersedia tahun ${t.year}.` };
  if (t.coastEnds && !(W.coastal[ka] && W.coastal[kb])) return { ok: false, err: 'Feri kereta butuh dua kecamatan pesisir.' };
  if (t.urbanEnd) {
    const dense = (isDense(W, ka) ? 1 : 0) + (isDense(W, kb) ? 1 : 0);
    if (dense < t.urbanEnd) return { ok: false, err: t.urbanEnd === 2 ? 'Kedua ujung harus kawasan padat (≥1.000 jiwa/km² atau perkotaan).' : 'Minimal satu ujung harus kawasan padat (≥1.000 jiwa/km²).' };
  }
  let kpath, pts, km, tf;
  if (t.direct) {
    const x0 = W.x[ka], y0 = W.y[ka], x1 = W.x[kb], y1 = W.y[kb];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (t.maxKm && d > t.maxKm) return { ok: false, err: `Terlalu jauh (${d.toFixed(0)} km). ${t.name} maks ${t.maxKm} km.` };
    const steps = Math.max(2, Math.ceil(d / 1.5));
    let water = 0, tfSum = 0, land = 0;
    const seen = new Set([ka]);
    kpath = [ka];
    for (let i = 1; i < steps; i++) {
      const k = W.kecAt(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
      if (k < 0) { water += d / steps; continue; }
      land++; tfSum += terrainFactor(W, k, t);
      if (!seen.has(k)) { seen.add(k); kpath.push(k); }
    }
    if (!seen.has(kb)) kpath.push(kb);
    if (!t.sea && water > 3) return { ok: false, err: `Melintasi laut ${water.toFixed(0)} km. Pakai Feri Kereta, Kereta Gantung, atau Jembatan Laut.` };
    if (t.sea && t.key !== 'gantung' && water < 0.5 && t.key !== 'laut') return { ok: false, err: 'Feri hanya untuk menyeberang laut.' };
    tf = land ? tfSum / land : 1;
    pts = [x0, y0, x1, y1];
    km = d * 1.02;
  } else {
    kpath = astar(W, ka, kb, t);
    if (!kpath) return { ok: false, err: 'Tidak ada jalur darat. Pakai Feri Kereta atau Jembatan/Terowongan Laut.' };
    const raw = [];
    for (const k of kpath) raw.push(W.x[k], W.y[k]);
    pts = chaikin(raw, 2);
    km = polyLen(raw) * 1.05;
    let s = 0;
    for (const k of kpath) s += terrainFactor(W, k, t);
    tf = s / kpath.length;
    if (t.maxKm && km > t.maxKm) return { ok: false, err: `Terlalu panjang (${km.toFixed(0)} km). ${t.name} maks ${t.maxKm} km.` };
  }
  const sa = S.stByKec.get(ka), sb = S.stByKec.get(kb);
  let cost = km * t.cost * tf * ci + (t.fixed || 0) * ci;
  cost += stationCost(t) * ci * ((sa ? 0.5 : 1) + (sb ? 0.5 : 1));
  let upgradeOf = null;
  if (sa && sb) {
    const old = findSeg(S, sa.id, sb.id, t.family);
    if (old) {
      if (old.type === typeKey && old.build <= 0) return { ok: false, err: 'Jalur jenis ini sudah ada. Pakai Rehabilitasi untuk memperbaiki.' };
      if (old.build > 0) return { ok: false, err: 'Jalur di ruas ini masih dibangun.' };
      upgradeOf = old.id;
      const credit = 0.5 * old.km * TYPE[old.type].cost * tf * ci;
      cost = Math.max(cost * 0.3, cost - credit);
    }
  }
  let months = Math.round(t.months[0] + km * t.months[1] * Math.sqrt(tf));
  const kons = S.companies && S.companies.some((c) => c.biz === 'konstruksi');
  if (kons) { cost *= 0.92; months = Math.max(1, Math.round(months * 0.9)); }
  return { ok: true, type: typeKey, ka, kb, kpath, pts, km, tf, cost, months, kons, upgradeOf, newA: !sa, newB: !sb };
}

export function ensureStation(S, W, k, name) {
  let s = S.stByKec.get(k);
  if (s) return s;
  s = { id: S.nextId++, k, name: name || W.name[k], rid: 0, fr: 0 };
  S.stations.push(s);
  S.stById.set(s.id, s); S.stByKec.set(k, s);
  return s;
}

export function commitSegment(S, W, plan) {
  if (S.cash < plan.cost) return { ok: false, err: 'Kas tidak cukup. Ambil pinjaman di panel Keuangan.' };
  book(S, induk(S), 'Pembangunan rel', -plan.cost);
  if (plan.kons) { const k = S.companies.find((c) => c.biz === 'konstruksi'); if (k) book(S, k, 'Margin proyek', plan.cost / 0.92 * 0.06); }
  S.spentBuild = (S.spentBuild || 0) + plan.cost;
  const a = ensureStation(S, W, plan.ka), b = ensureStation(S, W, plan.kb);
  const g = {
    id: S.nextId++, a: a.id, b: b.id, type: plan.type, km: plan.km, tf: plan.tf,
    pts: Array.from(plan.pts, (v) => Math.round(v * 100) / 100), kpath: plan.kpath,
    build: plan.months, total: plan.months, cond: 1, cost: plan.cost, year: S.y,
    loadP: 0, loadF: 0, sP: 0, sF: 0, rev: 0,
  };
  if (plan.upgradeOf) { g.replaces = plan.upgradeOf; S.segById.get(plan.upgradeOf).replacedBy = g.id; }
  prepSeg(g);
  S.segs.push(g); S.segById.set(g.id, g);
  return { ok: true, seg: g };
}

export function removeSeg(S, g) {
  S.segs = S.segs.filter((x) => x !== g);
  S.segById.delete(g.id);
  if (g.replaces && S.segById.has(g.replaces)) delete S.segById.get(g.replaces).replacedBy;
  for (const x of S.segs) if (x.replaces === g.id) delete x.replaces;
}

export function removeStation(S, s) {
  if (S.segs.some((g) => g.a === s.id || g.b === s.id)) return false;
  S.stations = S.stations.filter((x) => x !== s);
  S.stById.delete(s.id); S.stByKec.delete(s.k);
  return true;
}

export function rehabCost(S, g) {
  return 0.4 * g.km * TYPE[g.type].cost * (g.tf || 1) * costIndex(S.y) * (1 - g.cond);
}

export function segName(S, g) {
  const a = S.stById.get(g.a), b = S.stById.get(g.b);
  return `${a ? a.name : '?'} – ${b ? b.name : '?'}`;
}

// ---------- the network inherited in August 1945 ----------
export function seedNetwork(S, W) {
  for (const line of W.seedRail) {
    const type = line.gauge < 1000 ? 'lori' : 'konv';
    const cond = line.degraded ? 0.3 : 0.55;
    const path = (line.path || []).map((c) => W.idx.get(c)).filter((k) => k !== undefined);
    let prev = null, prevPos = 0;
    for (const st of line.stations) {
      const k = W.idx.get(st.kec);
      if (k === undefined) continue;
      const s = ensureStation(S, W, k, st.name);
      if (prev && prev.k !== k && !findSeg(S, prev.id, s.id, 'intercity')) {
        let pos = path.indexOf(k, prevPos);
        let kp;
        if (pos > prevPos && path[prevPos] === prev.k) kp = path.slice(prevPos, pos + 1);
        else { const pl = planSegment(S, W, prev.k, k, type); kp = pl.ok ? pl.kpath : [prev.k, k]; pos = -1; }
        const raw = [];
        for (const kk of kp) raw.push(W.x[kk], W.y[kk]);
        let tf = 0; for (const kk of kp) tf += terrainFactor(W, kk, TYPE[type]);
        const g = { id: S.nextId++, a: prev.id, b: s.id, type, km: polyLen(raw) * 1.05, tf: tf / kp.length, pts: chaikin(raw, 2).map((v) => Math.round(v * 100) / 100),
          kpath: kp, build: 0, total: 0, cond, cost: 0, year: 1945, loadP: 0, loadF: 0, sP: 0, sF: 0, rev: 0 };
        prepSeg(g);
        S.segs.push(g); S.segById.set(g.id, g);
        if (pos >= 0) prevPos = pos;
      } else if (!prev) {
        const pos = path.indexOf(k); if (pos >= 0) prevPos = pos;
      } else {
        const pos = path.indexOf(k, prevPos); if (pos >= 0) prevPos = pos;
      }
      prev = s;
    }
  }
}
