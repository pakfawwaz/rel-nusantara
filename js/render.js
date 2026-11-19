// Canvas map: a cached base layer (kecamatan fills) plus a per-frame overlay
// (rails, stations, points of interest, trains, previews).
import { TYPE } from './railtypes.js';
import { pointOnSeg, density } from './network.js';
import { poiActive, yearFrac } from './sim.js';

export const MODES = {
  pop: { name: 'Kepadatan', legend: ['<25', '100', '400', '1.6rb', '6.4rb+'], unit: 'jiwa/km²' },
  econ: { name: 'PDRB/kapita', legend: ['¼×', '½×', '1×', '2×', '4×'], unit: 'vs nasional' },
  growth: { name: 'Pertumbuhan', legend: ['−2%', '0', '+2%', '+4%', '+6%'], unit: 'penduduk/tahun' },
  access: { name: 'Aksesibilitas', legend: ['0', '.2', '.4', '.6', '.8+'], unit: 'indeks rel' },
  terrain: { name: 'Topografi', legend: ['Dataran', 'Pesisir', 'Bukit', 'Gunung'], unit: '' },
  load: { name: 'Beban jalur', legend: ['0%', '50%', '80%', '100%', '>100%'], unit: 'beban/kapasitas' },
};

const SEQ = ['#f7f4e9', '#efe6c4', '#e6d39a', '#dcb874', '#d39a55', '#c57a42', '#b25a36', '#96402e', '#762c27', '#561d1f'];
const DIV = ['#a33a2c', '#c9704f', '#e2a585', '#efd2bd', '#eee9dc', '#c9dfc2', '#97c494', '#5fa267', '#2f7a46', '#145a32'];
const BLU = ['#eceae2', '#dbe3e6', '#c3d6df', '#a6c4d6', '#87b0cc', '#6898bf', '#4c7fb0', '#36669c', '#244f85', '#163a6b'];
const TER = ['#cfe0b5', '#e3ecc3', '#d9c79a', '#b39472'];

const LANE_PRI = { konv: 0, ganda: 0, standar: 0, berat: 0, semicepat: 0, lori: 0, krl: 1, hsr: 2, maglev: 2, hyperloop: 2, lrt: 3, mrt: 3, monorel: 4, agt: 4, trem: 5, gigi: 6, funikular: 6, gantung: 7, ferry: 8, laut: 8 };

export class MapView {
  constructor(canvas, W, S) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.W = W; this.S = S;
    this.base = document.createElement('canvas');
    this.bctx = this.base.getContext('2d');
    this.mode = 'pop';
    this.view = { x: W.width / 2, y: W.height / 2, s: 0.2 };
    this.cacheView = null;
    this.dirty = true; this.binsDirty = true;
    this.lastMove = 0;
    this.hoverK = -1; this.preview = null; this.anchor = null; this.highlight = null;
    this.resize();
    this.fit();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.dpr = dpr; this.w = r.width; this.h = r.height;
    this.c.width = this.base.width = Math.round(r.width * dpr);
    this.c.height = this.base.height = Math.round(r.height * dpr);
    this.dirty = true;
  }

  fit() {
    const W = this.W;
    this.view.s = Math.min(this.w / (W.width * 1.02), this.h / (W.height * 1.1));
    this.view.x = W.width / 2; this.view.y = W.height / 2;
    this.touch();
  }
  focus(x, y, s) { this.view.x = x; this.view.y = y; if (s) this.view.s = s; this.touch(); }
  touch() { this.dirty = true; this.lastMove = performance.now(); }

  toWorld(px, py) { const v = this.view; return [(px - this.w / 2) / v.s + v.x, (py - this.h / 2) / v.s + v.y]; }
  toScreen(x, y) { const v = this.view; return [(x - v.x) * v.s + this.w / 2, (y - v.y) * v.s + this.h / 2]; }

  zoomAt(px, py, f) {
    const [wx, wy] = this.toWorld(px, py);
    this.view.s = Math.max(0.08, Math.min(400, this.view.s * f));
    this.view.x = wx - (px - this.w / 2) / this.view.s;
    this.view.y = wy - (py - this.h / 2) / this.view.s;
    this.touch();
  }

  // ---------- base layer ----------
  colorOf(k) {
    const W = this.W;
    switch (this.mode) {
      case 'pop': { const d = density(W, k); return SEQ[clamp(Math.floor(Math.log2(Math.max(d, 1) / 12.5)), 0, 9)]; }
      case 'econ': { const r = (W.grdp[k] / W.pop[k]) / this.incNat; return DIV[clamp(Math.round(Math.log2(r) * 2.2 + 4.5), 0, 9)]; }
      case 'growth': {
        const p0 = W.pop12 ? W.pop12[k] : W.pop[k];
        const months = W.pop12 ? Math.max(1, ((this.S.m - 1) || 12)) : 12;
        const g = (Math.pow(W.pop[k] / p0, 12 / months) - 1) * 100;
        return DIV[clamp(Math.round(g * 1.1 + 2.5), 0, 9)];
      }
      case 'access': return BLU[clamp(Math.floor((W.access ? W.access[k] : 0) * 11), 0, 9)];
      case 'terrain': return W.swamp[k] ? '#a9c8b0' : TER[W.terrain[k]];
      case 'load': return '#e9e6dc';
    }
    return '#ddd';
  }

  rebuildBins() {
    const W = this.W;
    let p = 0, g = 0;
    for (let k = 0; k < W.n; k++) { p += W.pop[k]; g += W.grdp[k]; }
    this.incNat = g / p;
    const bins = new Map();
    for (let k = 0; k < W.n; k++) {
      const c = this.colorOf(k);
      if (!bins.has(c)) bins.set(c, new Path2D());
      bins.get(c).addPath(W.paths[k]);
    }
    this.bins = bins;
    this.binsDirty = false;
    this.dirty = true;
  }

  drawBase() {
    if (this.binsDirty) this.rebuildBins();
    const ctx = this.bctx, v = this.view, dpr = this.dpr, W = this.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getCss('--sea');
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    ctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, (this.w / 2 - v.x * v.s) * dpr, (this.h / 2 - v.y * v.s) * dpr);
    ctx.fillStyle = getCss('--foreign');
    ctx.fill(W.foreign);
    // coastline: a dark copy of the land nudged down-right reads as an outline/shadow
    ctx.save();
    ctx.translate(1.2 / v.s, 1.2 / v.s);
    ctx.fillStyle = 'rgba(52, 72, 82, 0.55)';
    ctx.fill(W.land);
    ctx.restore();
    ctx.fillStyle = '#e9e3d0';
    ctx.fill(W.land);
    for (const [c, p] of this.bins) { ctx.fillStyle = c; ctx.fill(p); }
    if (v.s > 1.1) {
      const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.w, this.h);
      ctx.strokeStyle = 'rgba(70,55,40,' + Math.min(0.45, (v.s - 1.1) * 0.25) + ')';
      ctx.lineWidth = 0.6 / v.s;
      for (let k = 0; k < W.n; k++) {
        const b = k * 4;
        if (W.bbox[b + 2] < x0 || W.bbox[b] > x1 || W.bbox[b + 3] < y0 || W.bbox[b + 1] > y1) continue;
        ctx.stroke(W.paths[k]);
      }
    }
    this.cacheView = { ...v };
    this.dirty = false;
  }

  // ---------- frame ----------
  frame(now, tool, selType) {
    const ctx = this.ctx, dpr = this.dpr, v = this.view;
    if (this.binsDirty || (this.dirty && now - this.lastMove > 140) || !this.cacheView) this.drawBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getCss('--sea');
    ctx.fillRect(0, 0, this.c.width, this.c.height);
    const cv = this.cacheView, k = v.s / cv.s;
    // place the cached bitmap: world point at cache's top-left -> screen
    const [sx, sy] = this.toScreen(cv.x - this.w / 2 / cv.s, cv.y - this.h / 2 / cv.s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, sx * dpr, sy * dpr, this.base.width * k, this.base.height * k);

    ctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, (this.w / 2 - v.x * v.s) * dpr, (this.h / 2 - v.y * v.s) * dpr);
    const W = this.W, S = this.S;
    // hover / selection outlines
    if (this.hoverK >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill(W.paths[this.hoverK]);
      ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 1.5 / v.s; ctx.stroke(W.paths[this.hoverK]);
    }
    if (this.highlight != null && this.highlight.k != null) {
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 2.5 / v.s; ctx.stroke(W.paths[this.highlight.k]);
    }
    this.drawTrayeks(ctx);
    this.drawRails(ctx, now);
    this.drawPois(ctx);
    this.drawStations(ctx);
    this.drawPreview(ctx, selType);
    this.drawLabels(ctx);
  }

  inView(g, pad = 10) {
    const [x0, y0] = this.toWorld(-pad, -pad), [x1, y1] = this.toWorld(this.w + pad, this.h + pad);
    if (!g.bb) {
      let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
      for (let i = 0; i < g.pts.length; i += 2) { a = Math.min(a, g.pts[i]); c = Math.max(c, g.pts[i]); b = Math.min(b, g.pts[i + 1]); d = Math.max(d, g.pts[i + 1]); }
      g.bb = [a, b, c, d];
    }
    return !(g.bb[2] < x0 || g.bb[0] > x1 || g.bb[3] < y0 || g.bb[1] > y1);
  }

  // Rails that share a corridor are drawn side by side: each overlapping segment
  // gets its own lane, a fixed screen-pixel offset that tapers to 0 at stations.
  updateLanes() {
    const S = this.S;
    const sig = S.segs.length + ':' + S.segs.reduce((a, g) => a + g.id * 7 + g.type.length, 0);
    if (sig === this.laneSig) return;
    this.laneSig = sig;
    const segs = [...S.segs].sort((a, b) => (LANE_PRI[a.type] ?? 9) - (LANE_PRI[b.type] ?? 9) || a.id - b.id);
    const sets = new Map(segs.map((g) => [g.id, new Set(g.kpath || [])]));
    const lanes = new Map(), placed = [];
    for (const g of segs) {
      const mine = sets.get(g.id), used = new Set();
      for (const h of placed) {
        const same = (h.a === g.a && h.b === g.b) || (h.a === g.b && h.b === g.a);
        let shared = 0;
        if (!same) for (const k of sets.get(h.id)) if (mine.has(k) && ++shared >= 2) break;
        if (same || shared >= 2) used.add(lanes.get(h.id));
      }
      let lane = 0;
      for (const c of [0, 1, -1, 2, -2, 3, -3, 4, -4]) if (!used.has(c)) { lane = c; break; }
      lanes.set(g.id, lane);
      placed.push(g);
    }
    this.lanes = lanes;
  }

  segPts(g) {
    const lane = this.lanes ? this.lanes.get(g.id) || 0 : 0;
    if (!lane) return g.pts;
    const zw = Math.max(0.7, Math.min(2.2, Math.sqrt(this.view.s) * 1.1));
    const d = lane * 5 * zw / this.view.s;
    if (g._offD === d) return g._off;
    const p = g.pts, n = p.length / 2, out = new Array(p.length);
    const L = g.len || 1, taper = Math.min(L * 0.25, 14 / this.view.s);
    let cum = 0;
    for (let i = 0; i < n; i++) {
      if (i) cum += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = p[2 * b] - p[2 * a], ty = p[2 * b + 1] - p[2 * a + 1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const f = Math.min(1, cum / taper, (L - cum) / taper);
      out[2 * i] = p[2 * i] - ty * d * f; out[2 * i + 1] = p[2 * i + 1] + tx * d * f;
    }
    g._offD = d; g._off = out;
    return out;
  }

  strokeSeg(ctx, g, center) {
    const p = center ? g.pts : this.segPts(g);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }

  drawRails(ctx, now) {
    const v = this.view, S = this.S;
    const zw = Math.max(0.7, Math.min(2.2, Math.sqrt(v.s) * 1.1));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    this.updateLanes();
    const segs = S.segs.filter((g) => this.inView(g));
    // casing
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    for (const g of segs) {
      if (g.build > 0) continue;
      const t = TYPE[g.type];
      ctx.lineWidth = (t.width * zw + 2) / v.s;
      ctx.setLineDash([]);
      this.strokeSeg(ctx, g);
    }
    for (const g of segs) {
      const t = TYPE[g.type];
      ctx.lineWidth = t.width * zw / v.s;
      if (g.build > 0) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = t.color;
        ctx.setLineDash([4 / v.s, 4 / v.s]);
      } else {
        ctx.globalAlpha = g.replacedBy || !g.ntr ? 0.45 : 1;
        if (this.mode === 'load') {
          const u = (g.trains || 0) / (t.cap / 400);
          ctx.strokeStyle = u > 1 ? '#b71c1c' : u > 0.8 ? '#ef6c00' : u > 0.5 ? '#f9a825' : u > 0.05 ? '#43a047' : '#90a4ae';
          ctx.lineWidth = (t.width + Math.min(5, u * 3)) * zw / v.s;
        } else ctx.strokeStyle = t.color;
        ctx.setLineDash(t.dash ? t.dash.map((d) => d * zw / v.s) : []);
      }
      this.strokeSeg(ctx, g);
      if (g.cond < 0.5 && g.build <= 0 && v.s > 0.5) {
        ctx.setLineDash([1 / v.s, 6 / v.s]); ctx.strokeStyle = '#d32f2f'; ctx.lineWidth = (t.width * zw + 1) / v.s;
        this.strokeSeg(ctx, g);
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    // trains
    if (v.s < 0.12) return;
    const sec = now / 1000;
    for (const g of segs) {
      if (g.build > 0) continue;
      const t = TYPE[g.type];
      if (!(g.trains > 0)) continue;
      const count = Math.min(14, Math.max(1, Math.round(g.trains / 4)), Math.ceil(g.len * v.s / 25));
      const speed = (t.speed / 3600) * 260 / Math.max(g.len, 1); // visual, fraction of segment per second
      const r = Math.max(1.4, Math.min(4, 1.2 * zw * Math.sqrt(v.s))) / v.s;
      ctx.fillStyle = (g.loadF || 0) * 2 > (g.loadP || 0) ? '#263238' : '#fafafa';
      ctx.strokeStyle = t.color; ctx.lineWidth = 1 / v.s;
      for (let i = 0; i < count; i++) {
        let u = (sec * speed * (0.9 + (i % 3) * 0.07) + i / count + g.id * 0.137) % 1;
        if (i % 2) u = 1 - u;
        const [x, y] = this.lanePoint(g, u);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.stroke();
      }
    }
  }

  lanePoint(g, u) {
    const p = this.segPts(g);
    if (p === g.pts) return pointOnSeg(g, u);
    return pointOnSeg({ pts: p, cum: g.cum, len: g.len }, u);
  }

  drawTrayeks(ctx) {
    const v = this.view, S = this.S;
    const strokeIds = (ids, color, w, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = w / v.s; ctx.setLineDash(dash ? dash.map((d) => d / v.s) : []);
      for (const id of ids) { const g = S.segById.get(id); if (g) this.strokeSeg(ctx, g); }
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const t = this.trayekHi;
    if (t) strokeIds(t.legs.flat(), t.kind === 'K' ? 'rgba(62,39,35,0.35)' : t.kind === 'P' ? 'rgba(21,101,192,0.35)' : 'rgba(106,27,154,0.35)', 12);
    const d = this.draft;
    if (d && d.legs.length) strokeIds(d.legs.flat(), 'rgba(198,40,40,0.4)', 12);
    if (this.draftPreview) strokeIds(this.draftPreview, 'rgba(198,40,40,0.6)', 6, [8, 6]);
    ctx.setLineDash([]);
    const W = this.W;
    const stops = t ? t.stops : d ? d.stops : [];
    stops.forEach((id, i) => {
      const s = S.stById.get(id); if (!s) return;
      ctx.beginPath(); ctx.arc(W.x[s.k], W.y[s.k], 8 / v.s, 0, 6.283);
      ctx.fillStyle = d && !t ? '#c62828' : '#1a237e'; ctx.fill();
    });
  }

  drawStations(ctx) {
    const v = this.view, S = this.S, W = this.W;
    const [x0, y0] = this.toWorld(-20, -20), [x1, y1] = this.toWorld(this.w + 20, this.h + 20);
    const zr = Math.max(0.6, Math.min(2, Math.sqrt(v.s)));
    for (const s of S.stations) {
      const x = W.x[s.k], y = W.y[s.k];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const big = s.rid + s.fr;
      const r = (1.6 + Math.min(5, Math.log10(1 + big / 300))) * zr;
      if (v.s < 0.25 && big < 3000) continue;
      ctx.beginPath(); ctx.arc(x, y, r / v.s, 0, 6.283);
      ctx.fillStyle = s.acc > 0 ? '#fff' : '#ddd'; ctx.fill();
      ctx.lineWidth = 1.4 / v.s; ctx.strokeStyle = '#3b2a1a'; ctx.stroke();
      if (this.highlight && this.highlight.st === s.id) { ctx.lineWidth = 3 / v.s; ctx.strokeStyle = '#c62828'; ctx.stroke(); }
    }
  }

  drawPois(ctx) {
    const v = this.view, W = this.W, y = yearFrac(this.S);
    if (v.s < 0.18) return;
    const [x0, y0] = this.toWorld(-20, -20), [x1, y1] = this.toWorld(this.w + 20, this.h + 20);
    const ICON = { port: '⚓', airport: '✈', resource: '⛏', industry: '🏭' };
    const SUBI = { plantation: '🌴', rice: '🌾', sugar: '🌾', oil: '🛢', gas: '🔥', geothermal: '♨', hydro: '💧' };
    const size = Math.max(10, Math.min(18, 8 + v.s * 3));
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const conn = new Set(this.S.connected);
    const offs = new Map();
    for (const p of W.pois) {
      if (!poiActive(p, y)) continue;
      if (p.kind === 'resource' && v.s < 0.45) continue;
      if (p.kind === 'industry' && v.s < 0.45) continue;
      if (p.kind === 'airport' && p.level < 2 && v.s < 0.35) continue;
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const n = offs.get(p.k) || 0; offs.set(p.k, n + 1);
      let [sx, sy] = this.toScreen(p.x, p.y);
      sx += 12 + n * (size + 2); sy -= 10;
      if (conn.has(p.id)) { ctx.fillStyle = 'rgba(46,125,50,0.85)'; ctx.beginPath(); ctx.arc(sx, sy, size * 0.68, 0, 6.283); ctx.fill(); }
      else { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(sx, sy, size * 0.68, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = '#000';
      ctx.fillText(SUBI[p.sub] || ICON[p.kind], sx, sy + 1);
    }
    ctx.restore();
  }

  drawPreview(ctx, selType) {
    const v = this.view, p = this.preview;
    if (this.anchor != null) {
      const W = this.W;
      ctx.beginPath(); ctx.arc(W.x[this.anchor], W.y[this.anchor], 6 / v.s, 0, 6.283);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 2.5 / v.s; ctx.stroke();
    }
    if (!p || !p.pts) return;
    const t = TYPE[p.type || selType];
    ctx.lineCap = 'round';
    ctx.strokeStyle = p.ok ? t.color : '#c62828';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = (t.width + 2) / v.s;
    ctx.setLineDash([8 / v.s, 5 / v.s]);
    ctx.beginPath(); ctx.moveTo(p.pts[0], p.pts[1]);
    for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  drawLabels(ctx) {
    const v = this.view, S = this.S, W = this.W;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const placed = [];
    const list = [...S.stations].sort((a, b) => (b.rid + b.fr) - (a.rid + a.fr));
    const minRid = v.s > 3 ? 0 : v.s > 1.2 ? 2000 : v.s > 0.5 ? 15000 : v.s > 0.25 ? 60000 : 1e12;
    for (const s of list) {
      if (s.rid + s.fr < minRid) break;
      const [sx, sy] = this.toScreen(W.x[s.k], W.y[s.k]);
      if (sx < -50 || sy < -20 || sx > this.w + 50 || sy > this.h + 20) continue;
      const w = ctx.measureText(s.name).width;
      const box = [sx + 7, sy - 8, sx + 9 + w, sy + 8];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.strokeText(s.name, sx + 8, sy);
      ctx.fillStyle = '#2b1d12'; ctx.fillText(s.name, sx + 8, sy);
    }
    ctx.restore();
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const cssCache = {};
function getCss(name) { return cssCache[name] || (cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#9cc'); }
export function legendColors(mode) {
  if (mode === 'pop') return [SEQ[1], SEQ[3], SEQ[5], SEQ[7], SEQ[9]];
  if (mode === 'econ' || mode === 'growth') return [DIV[0], DIV[2], DIV[4], DIV[7], DIV[9]];
  if (mode === 'access') return [BLU[0], BLU[2], BLU[4], BLU[6], BLU[9]];
  if (mode === 'terrain') return TER;
  if (mode === 'load') return ['#90a4ae', '#43a047', '#f9a825', '#ef6c00', '#b71c1c'];
  return [];
}
