// Trayek (train services): an ordered list of stops run over built track by one
// company, with a number of daily trips and passenger / freight cars per train.
// Only passengers and goods whose origin and destination are both stops on the
// same trayek can ride it.
import { TYPE, techSpeed, roadSpeed, airAvailable, costIndex } from './railtypes.js';
import { heapPush, heapPop } from './network.js';
import { BIZ, ROLES, VENDOR, induk, compById, book, scaleEff } from './company.js';

export const KIND = { P: 'Penumpang', K: 'Kargo', C: 'Campur' };
export const FARE_P = 1.6e-7; // Rp miliar per passenger-km (≈ Rp160)
export const FARE_F = 5e-7;   // Rp miliar per tonne-km (≈ Rp500)
const STOCK = { hsr: 6, maglev: 9, hyperloop: 12, mrt: 3, lrt: 2, monorel: 2, agt: 2, krl: 1.5, semicepat: 1.5, funikular: 2, gantung: 2 };
const URBAN_CAR = new Set(['krl', 'mrt', 'lrt', 'monorel', 'agt', 'trem']);
export const MAX_CARS = { P: 12, K: 60, C: 30 };
export const PRICE = { loco: 25, carP: 6, carF: 2.5 }; // per unit, × stock factor × cost index
const DWELL = 3 / 60;

export function usable(t, kind) {
  if ((kind === 'P' || kind === 'C') && t.pax < 0.2) return false;
  if ((kind === 'K' || kind === 'C') && !(t.freight > 0)) return false;
  return true;
}

export function segTime(g, y) {
  const t = TYPE[g.type];
  return g.km / (t.speed * techSpeed(t, y) * (0.45 + 0.55 * g.cond));
}

// Fastest route over operating track between two stations for a kind of service.
export function findLeg(S, fromId, toId, kind, y) {
  const adj = new Map();
  for (const g of S.segs) {
    if (g.build > 0 || !usable(TYPE[g.type], kind)) continue;
    for (const [u, v] of [[g.a, g.b], [g.b, g.a]]) { if (!adj.has(u)) adj.set(u, []); adj.get(u).push([v, g]); }
  }
  const T = new Map([[fromId, 0]]), pred = new Map(), heap = [[0, fromId]], done = new Set();
  while (heap.length) {
    const [t, u] = heapPop(heap);
    if (done.has(u)) continue;
    done.add(u);
    if (u === toId) break;
    for (const [v, g] of adj.get(u) || []) {
      const nt = t + segTime(g, y) + DWELL * 0.3;
      if (nt < (T.get(v) ?? Infinity)) { T.set(v, nt); pred.set(v, g.id); heapPush(heap, [nt, v]); }
    }
  }
  if (!done.has(toId) || fromId === toId) return null;
  const legs = [];
  for (let v = toId; v !== fromId;) {
    const g = S.segById.get(pred.get(v));
    legs.push(g.id);
    v = g.a === v ? g.b : g.a;
  }
  return legs.reverse();
}

export function newTrayek(S, stops, legs, kind) {
  const n = (S.trayekSeq = (S.trayekSeq || 0) + 1);
  const a = S.stById.get(stops[0]), b = S.stById.get(stops[stops.length - 1]);
  return {
    id: n, code: (kind === 'K' ? 'KRG-' : 'KA-') + String(n).padStart(3, '0'), name: `${a.name} – ${b.name}`, kind,
    stops, legs, freq: kind === 'K' ? 2 : 4, gp: kind === 'K' ? 0 : 6, gb: kind === 'P' ? 0 : kind === 'K' ? 20 : 6,
    op: 1, roles: { awak: 'self', perawatan: 'self', kebersihan: 'self', keamanan: 'self', catering: 'self' },
    fleet: { R: 0, cp: 0, cb: 0 }, active: true, last: {},
  };
}

// Station chain, cumulative km/time and properties of the track a trayek runs on.
export function geometry(S, tr, y) {
  const nodes = [{ st: tr.stops[0], stop: true, km: 0, t: 0 }];
  let km = 0, t = 0, sf = 1, urbanCars = true, fareP = 0, fareF = 0, heavy = true;
  const segs = [];
  for (let i = 0; i < tr.legs.length; i++) {
    let cur = tr.stops[i];
    const leg = tr.legs[i];
    for (let j = 0; j < leg.length; j++) {
      const g = S.segById.get(leg[j]);
      if (!g || g.build > 0 || (g.a !== cur && g.b !== cur)) return null;
      const ty = TYPE[g.type];
      segs.push(g);
      km += g.km; t += segTime(g, y);
      cur = g.a === cur ? g.b : g.a;
      sf = Math.max(sf, STOCK[g.type] || 1);
      if (!URBAN_CAR.has(g.type)) urbanCars = false;
      if (g.type !== 'berat') heavy = false;
      fareP += g.km * ty.fare; fareF += g.km * Math.max(1, ty.freight * 0.8);
      const isStop = j === leg.length - 1;
      if (isStop) t += DWELL;
      nodes.push({ st: cur, stop: isStop, km, t });
    }
    if (cur !== tr.stops[i + 1]) return null;
  }
  return { nodes, stopsAt: nodes.filter((n) => n.stop), km, time: t, sf, segs,
    capP: urbanCars ? 200 : 80, capF: heavy ? 50 : 40, fareP: fareP / Math.max(km, 1), fareF: fareF / Math.max(km, 1) };
}

export function fleetNeed(geo, freq, gp, gb) {
  const R = freq > 0 ? Math.ceil(2 * freq * (geo.time + 0.5) / 18) : 0;
  return { R, cp: R * gp, cb: R * gb };
}

export function fleetCost(S, geo, need, have) {
  const ci = costIndex(S.y), k = geo.sf * ci;
  const d = (a, b, p) => (a > b ? (a - b) * p : -(b - a) * p * 0.4);
  return d(need.R, have.R, PRICE.loco * k) + d(need.cp, have.cp, PRICE.carP * k) + d(need.cb, have.cb, PRICE.carF * k);
}

// Change trips/cars; buys or sells rolling stock with the operator's money.
export function configure(S, tr, freq, gp, gb, y) {
  const geo = geometry(S, tr, y);
  if (!geo) return { ok: false, err: 'Trayek terputus — jalurnya dibongkar.' };
  gp = tr.kind === 'K' ? 0 : Math.max(tr.kind === 'P' ? 1 : 0, gp);
  gb = tr.kind === 'P' ? 0 : Math.max(tr.kind === 'K' ? 1 : 0, gb);
  if (gp + gb > MAX_CARS[tr.kind]) return { ok: false, err: `Maksimal ${MAX_CARS[tr.kind]} gerbong per rangkaian.` };
  if (tr.kind === 'C' && (gp < 1 || gb < 1)) return { ok: false, err: 'Trayek campur butuh minimal 1 gerbong penumpang dan 1 gerbong barang.' };
  freq = Math.max(0, Math.min(200, freq));
  const need = fleetNeed(geo, freq, gp, gb), cost = fleetCost(S, geo, need, tr.fleet);
  const op = compById(S, tr.op);
  const cash = op.kind === 'induk' ? S.cash : op.cash;
  if (cost > 0 && cost > cash) return { ok: false, err: `Kas ${op.name} tidak cukup untuk membeli sarana (Rp ${cost.toFixed(0)} M).` };
  book(S, op, cost > 0 ? 'Beli sarana' : 'Jual sarana', -cost);
  tr.freq = freq; tr.gp = gp; tr.gb = gb; tr.fleet = need; tr.geo = geo;
  tr.capP = freq * gp * geo.capP; tr.capF = freq * gb * geo.capF;
  return { ok: true, cost };
}

// ---------------- monthly demand and accounts ----------------
// mass: Map stationId -> {P, PM, F, C}
export function runTrayeks(S, W, mass, y, only = null) {
  const dry = !!only;
  const bk = dry ? () => {} : book;
  const ci = costIndex(y), Gp = S.gp, Gf = S.gf;
  const vRoad = roadSpeed(y), air = airAvailable(y);
  const D = 30.4;
  const hasLog = S.companies.some((c) => c.biz === 'logistik');
  if (!dry) {
    for (const s of S.stations) { s.rid = 0; s.fr = 0; }
    for (const g of S.segs) { g.trains = 0; g.loadP = 0; g.loadF = 0; g.ntr = 0; }
  }

  // geometry + track congestion
  const live = [];
  for (const tr of only || S.trayeks) {
    tr.geo = geometry(S, tr, y);
    if (!tr.geo) { if (tr.active) tr.broken = true; tr.last = { profit: 0 }; continue; }
    tr.broken = false;
    if (!tr.active || tr.freq <= 0) { tr.last = { profit: 0 }; continue; }
    live.push(tr);
    if (!dry) for (const g of tr.geo.segs) { g.trains += 2 * tr.freq; g.ntr++; }
  }
  for (const tr of live) {
    let c = 1;
    if (!dry) for (const g of tr.geo.segs) c = Math.min(c, TYPE[g.type].cap / 400 / Math.max(g.trains, 1e-9));
    tr.cong = Math.min(1, c);
  }

  // provider quality and operator complexity
  const nOp = new Map(), kinds = new Map(), contracts = new Map();
  for (const tr of live) {
    nOp.set(tr.op, (nOp.get(tr.op) || 0) + 1);
    if (!kinds.has(tr.op)) kinds.set(tr.op, new Set());
    kinds.get(tr.op).add(tr.kind === 'C' ? 'C' : tr.kind);
    for (const [r, p] of Object.entries(tr.roles)) if (typeof p === 'number' && (r !== 'catering' && r !== 'kebersihan' || tr.kind !== 'K')) contracts.set(p, (contracts.get(p) || 0) + 1);
  }
  const complexity = (op) => Math.min(1.5, 1 + 0.012 * Math.max(0, (nOp.get(op) || 0) - 8));
  const spec = (op) => { const c = compById(S, op); const k = kinds.get(op); return c.kind !== 'induk' && k && k.size === 1 && !k.has('C') ? 0.93 : 1; };
  const quality = (tr, role) => {
    const p = tr.roles[role];
    if (p === 'vendor') return VENDOR.quality[role];
    if (typeof p === 'number') return scaleEff(contracts.get(p) || 0) < 0.8 ? 1.03 : 1;
    return 1;
  };

  // pass 1: unconstrained OD demand per trayek, grouped by OD for competition
  const od = new Map();
  for (const tr of live) {
    const st = tr.geo.stopsAt, n = st.length;
    const wait = Math.min(3, 4.5 / tr.freq);
    const qP = tr.gp > 0 ? quality(tr, 'awak') * quality(tr, 'kebersihan') * quality(tr, 'keamanan') : 0;
    const rel = quality(tr, 'perawatan');
    tr.capP = tr.freq * tr.gp * tr.geo.capP * tr.cong * rel;
    tr.capF = tr.freq * tr.gb * tr.geo.capF * tr.cong * rel;
    tr.pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = mass.get(st[i].st), b = mass.get(st[j].st);
      if (!a || !b) continue;
      const d = st[j].km - st[i].km, tt = st[j].t - st[i].t + wait;
      let p = 0, fij = 0, fji = 0;
      if (tr.gp > 0) {
        let talt = d * 1.3 / vRoad;
        if (air && d > 300) talt = Math.min(talt, 2.5 + d / 550);
        p = Gp * a.PM * b.PM / Math.pow(d + 25, 1.7) / (1 + Math.pow(tt / talt, 2.2)) * qP;
      }
      if (tr.gb > 0) {
        const talt = d * 1.3 / (vRoad * 0.8), shr = 1 / (1 + Math.pow(tt / talt, 1.5)) * (hasLog ? 1.12 : 1);
        fij = Gf * a.F * b.C / Math.pow(d + 60, 1.2) * shr;
        fji = Gf * b.F * a.C / Math.pow(d + 60, 1.2) * shr;
        // bulk exports: mines and factories to ports, long hauls still worthwhile
        const ex = 18000 / Math.pow(d + 100, 0.8) * shr;
        fij += ex * (a.R || 0) * (b.X || 0); fji += ex * (b.R || 0) * (a.X || 0);
      }
      const pr = { i, j, d, tt, p, fij, fji };
      tr.pairs.push(pr);
      const key = st[i].st < st[j].st ? st[i].st + '-' + st[j].st : st[j].st + '-' + st[i].st;
      if (!od.has(key)) od.set(key, []);
      od.get(key).push([tr, pr]);
    }
  }
  // competition: several trayeks serving the same OD split a (slightly larger) market by capacity
  for (const list of od.values()) {
    if (list.length < 2) continue;
    for (const f of ['p', 'fij', 'fji']) {
      const cap = f === 'p' ? 'capP' : 'capF';
      let mx = 0, w = 0;
      for (const [tr, pr] of list) { mx = Math.max(mx, pr[f]); w += pr[f] * tr[cap]; }
      const market = mx * (1 + 0.15 * (list.length - 1));
      for (const [tr, pr] of list) pr[f] = w > 0 ? market * pr[f] * tr[cap] / w : 0;
    }
  }

  // pass 2: load profiles, capacity, revenue, costs
  let totPax = 0, totFr = 0, pkmAll = 0, tkmAll = 0;
  const ind = induk(S);
  for (const tr of live) {
    const st = tr.geo.stopsAt, n = st.length;
    const lpF = new Float64Array(n), lpB = new Float64Array(n), lfF = new Float64Array(n), lfB = new Float64Array(n);
    for (const pr of tr.pairs) for (let l = pr.i; l < pr.j; l++) { lpF[l] += pr.p / 2; lpB[l] += pr.p / 2; lfF[l] += pr.fij; lfB[l] += pr.fji; }
    const mx = (a) => Math.max(0, ...a);
    const sPF = Math.min(1, tr.capP / Math.max(mx(lpF), 1e-9)), sPB = Math.min(1, tr.capP / Math.max(mx(lpB), 1e-9));
    const sFF = Math.min(1, tr.capF / Math.max(mx(lfF), 1e-9)), sFB = Math.min(1, tr.capF / Math.max(mx(lfB), 1e-9));
    let pax = 0, pkm = 0, ph = 0, fr = 0, tkm = 0, potP = 0, potF = 0;
    for (const pr of tr.pairs) {
      const sp = pr.p / 2 * (sPF + sPB), sf = pr.fij * sFF + pr.fji * sFB;
      potP += pr.p; potF += pr.fij + pr.fji;
      pax += sp; pkm += sp * pr.d; ph += sp * pr.tt; fr += sf; tkm += sf * pr.d;
      const a = S.stById.get(st[pr.i].st), b = S.stById.get(st[pr.j].st);
      if (!dry) { a.rid += sp; b.rid += sp; a.fr += sf; b.fr += sf; }
    }
    if (!dry) for (const g of tr.geo.segs) { g.loadP += Math.max(mx(lpF) * sPF, mx(lpB) * sPB); g.loadF += Math.max(mx(lfF) * sFF, mx(lfB) * sFB); }
    totPax += pax; totFr += fr; pkmAll += pkm; tkmAll += tkm;

    // money (monthly)
    const op = compById(S, tr.op), cx = complexity(tr.op) * spec(tr.op), sp = spec(tr.op);
    const L = {};
    const put = (c, cat, v) => { bk(S, c, cat, v); if (c === op) L[cat] = (L[cat] || 0) + v; };
    const trainKm = 2 * tr.freq * tr.geo.km * tr.cong, carKm = trainKm * (tr.gp + tr.gb);
    put(op, 'Tiket penumpang', pkm * FARE_P * tr.geo.fareP * D);
    put(op, 'Angkutan barang', tkm * FARE_F * tr.geo.fareF * D);
    put(op, 'Energi & BBM', -(trainKm * 1.2e-5 + carKm * 1.5e-6) * sp * D);
    const base = {
      awak: trainKm * 6e-6 * ci,
      perawatan: (trainKm * 5e-6 + carKm * 1.2e-6) * tr.geo.sf * ci,
      kebersihan: (trainKm * tr.gp * 6e-7 + trainKm * tr.gb * 1e-7) * ci,
      keamanan: trainKm * 2e-6 * ci,
    };
    for (const [role, B] of Object.entries(base)) {
      const p = tr.roles[role], Bm = B * D;
      if (p === 'vendor') put(op, 'Kontrak vendor', -Bm * VENDOR.cost);
      else if (typeof p === 'number' && compById(S, p)) {
        const sub = compById(S, p);
        put(op, 'Kontrak anak usaha', -Bm * 0.95);
        bk(S, sub, 'Pendapatan kontrak', Bm * 0.95);
        bk(S, sub, 'Biaya operasi', -Bm * scaleEff(contracts.get(p) || 0));
      } else put(op, 'Biaya SDM & perawatan mandiri', -Bm * cx);
    }
    if (tr.gp > 0) {
      const inc = mass.incFactor || 1;
      const sales = ph * 1.5e-6 * inc * D;
      const p = tr.roles.catering;
      if (p === 'vendor') put(op, 'Konsesi catering', sales * VENDOR.quality.catering * 0.12);
      else if (typeof p === 'number' && compById(S, p)) {
        const sub = compById(S, p);
        put(op, 'Konsesi catering', sales * 0.12);
        bk(S, sub, 'Penjualan catering', sales * 0.88);
        bk(S, sub, 'Biaya operasi', -sales * 0.6 * scaleEff(contracts.get(p) || 0));
      } else { put(op, 'Penjualan catering', sales); put(op, 'Biaya catering mandiri', -sales * 0.62 * cx); }
    }
    if (op !== ind) {
      const tac = trainKm * 8e-6 * ci * D;
      put(op, 'Track access charge', -tac);
      bk(S, ind, 'Track access charge', tac);
    }
    if (op.kind === 'jv') put(op, 'PSO pemda', pkm * 5e-8 * D);
    if (hasLog && tr.gb > 0) {
      const lg = S.companies.find((c) => c.biz === 'logistik');
      bk(S, lg, 'Antar-jemput barang', fr * 2e-5 * D);
      bk(S, lg, 'Biaya operasi', -fr * 2e-5 * D * 0.85 * scaleEff(live.length / 4));
    }
    const profit = Object.values(L).reduce((a, b) => a + b, 0);
    tr.last = { pax, fr, pkm, tkm, potP, potF, profit, L, loadP: Math.max(mx(lpF), mx(lpB)), loadF: Math.max(mx(lfF), mx(lfB)),
      lfP: tr.capP ? Math.min(1, Math.max(mx(lpF), mx(lpB)) / tr.capP) : 0, lfF: tr.capF ? Math.min(1, Math.max(mx(lfF), mx(lfB)) / tr.capF) : 0 };
  }
  return { pax: totPax, fr: totFr, pkm: pkmAll, tkm: tkmAll, live };
}

// Time-weighted reach of every stop over the passenger trayek graph (with transfers).
export function trayekAccess(S, W, y) {
  const adj = new Map(), P = new Map();
  for (const tr of S.trayeks) {
    if (!tr.geo || !tr.active || tr.freq <= 0 || tr.gp <= 0) continue;
    const st = tr.geo.stopsAt, wait = Math.min(3, 4.5 / tr.freq) * 0.4;
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i].st, b = st[i + 1].st, t = st[i + 1].t - st[i].t + wait;
      for (const [u, v] of [[a, b], [b, a]]) { if (!adj.has(u)) adj.set(u, []); adj.get(u).push([v, t]); }
    }
  }
  for (const s of S.stations) s.acc = 0;
  for (const src of adj.keys()) {
    const T = new Map([[src, 0]]), heap = [[0, src]], done = new Set();
    let acc = 0;
    while (heap.length) {
      const [t, u] = heapPop(heap);
      if (done.has(u)) continue;
      done.add(u);
      const s = S.stById.get(u);
      acc += W.pop[s.k] * Math.exp(-t / 2.5) * (u === src ? 3 : 1);
      if (t > 10) break;
      for (const [v, dt] of adj.get(u)) { const nt = t + dt; if (nt < (T.get(v) ?? Infinity)) { T.set(v, nt); heapPush(heap, [nt, v]); } }
    }
    S.stById.get(src).acc = acc;
  }
}

// Suggest trips and cars so the busiest section runs at ~85% of capacity.
export function suggest(S, W, mass, tr, y) {
  const geo = geometry(S, tr, y);
  if (!geo) return null;
  // demand on its own, with generous capacity (dry run: nothing is booked)
  const big = { ...tr, freq: Math.max(tr.freq, 6), gp: tr.kind === 'K' ? 0 : 12, gb: tr.kind === 'P' ? 0 : 60, last: {} };
  runTrayeks(S, W, mass, y, [big]);
  const lp = big.last.loadP || 0, lf = big.last.loadF || 0;
  const per = (cars, cap) => cars * cap;
  let freq, gp = 0, gb = 0;
  if (tr.kind === 'P') { freq = Math.max(1, Math.min(80, Math.ceil(lp / 0.85 / per(10, geo.capP)))); gp = Math.max(1, Math.min(12, Math.ceil(lp / 0.85 / freq / geo.capP))); }
  else if (tr.kind === 'K') { freq = Math.max(1, Math.min(40, Math.ceil(lf / 0.85 / per(50, geo.capF)))); gb = Math.max(1, Math.min(60, Math.ceil(lf / 0.85 / freq / geo.capF))); }
  else {
    freq = Math.max(1, Math.min(40, Math.ceil(Math.max(lp / per(10, geo.capP), lf / per(18, geo.capF)) / 0.85)));
    gp = Math.max(1, Math.min(12, Math.ceil(lp / 0.85 / freq / geo.capP)));
    gb = Math.max(1, Math.min(30 - gp, Math.ceil(lf / 0.85 / freq / geo.capF)));
  }
  return { freq, gp, gb, loadP: lp, loadF: lf };
}
