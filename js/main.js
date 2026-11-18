import { loadWorld } from './world.js';
import { TYPE } from './railtypes.js';
import { reindex, seedNetwork, planSegment, commitSegment, removeSeg, removeStation, rehabCost, segName, prepSeg } from './network.js';
import { calibrate, monthTick, runTraffic, computeAccess, fmtM, poiActive } from './sim.js';
import { MapView } from './render.js';
import { UI } from './ui.js';

const SAVE_KEY = 'rel-nusantara-v1';
const SPEEDS = [0, 0.35, 1, 3]; // months per second
const $ = (s) => document.querySelector(s);

class Game {
  constructor() {
    this.speed = 0; this.acc = 0;
    this.tool = 'inspect'; this.selType = 'konv';
  }

  async boot() {
    const bar = $('#loadbar'), msg = $('#loadmsg');
    try {
      this.W = await loadWorld((f, name) => { bar.style.width = (f * 100).toFixed(0) + '%'; msg.textContent = 'Memuat ' + name; });
    } catch (e) {
      msg.textContent = 'Gagal memuat data: ' + e.message + '. Jalankan lewat server lokal (serve.ps1).';
      return;
    }
    this.W0 = { pop: Float64Array.from(this.W.pop), grdp: Float64Array.from(this.W.grdp), urban: Float32Array.from(this.W.urban) };
    $('#loading').hidden = true;
    $('#menu').hidden = false;
    let has = false;
    try { has = !!localStorage.getItem(SAVE_KEY); } catch {}
    $('#btn-continue').hidden = !has;
    $('#btn-new').onclick = () => this.start(null);
    $('#btn-continue').onclick = () => { let d = null; try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {} this.start(d); };
  }

  newState() {
    return { y: 1945, m: 8, cash: 2500, loan: 0, stations: [], segs: [], nextId: 1, connected: [], hist: [], news: [], histGdp: 0, gp: 1, gf: 1 };
  }

  start(saved) {
    const W = this.W;
    W.pop.set(this.W0.pop); W.grdp.set(this.W0.grdp); W.urban.set(this.W0.urban); W.pop12 = null; W.access = null;
    if (saved) {
      this.S = saved.S;
      W.pop.set(saved.pop); W.grdp.set(saved.grdp); W.urban.set(saved.urban);
      if (saved.pop12) W.pop12 = Float64Array.from(saved.pop12);
      reindex(this.S);
      runTraffic(this.S, W); computeAccess(this.S, W);
    } else {
      this.S = this.newState();
      reindex(this.S);
      seedNetwork(this.S, W);
      calibrate(this.S, W);
      computeAccess(this.S, W);
      for (const s of this.S.stations) if (s.acc > 0) for (const p of W.poisByKec.get(s.k) || []) if (poiActive(p, 1945) && !this.S.connected.includes(p.id)) this.S.connected.push(p.id);
      let g = 0; for (let k = 0; k < W.n; k++) g += W.grdp[k];
      this.S.histGdp = g;
    }
    $('#menu').hidden = true;
    $('#app').hidden = false;
    if (!this.map) {
      this.map = new MapView($('#map'), W, this.S);
      this.ui = new UI(this);
      this.bindInput();
      requestAnimationFrame((t) => this.loop(t));
    } else { this.map.S = this.S; this.map.binsDirty = true; }
    this.ui.renderPalette(); this.ui.renderModes(); this.ui.renderNews(); this.ui.renderSide(); this.ui.renderTop();
    if (!saved) {
      // run one silent month to fill the dashboards
      this.S.last = null;
      monthTick(this.S, W, { news: () => {} });
      this.S.m = 8;
      this.ui.renderTop();
    }
    this.setSpeed(1);
    this.map.focus(1500, 1200, Math.max(this.map.view.s, 0.32));
  }

  setSpeed(s) { this.speed = s; this.ui.renderTop(); }

  loop(t) {
    const dt = Math.min(0.25, (t - (this.lastT || t)) / 1000);
    this.lastT = t;
    if (this.speed) {
      this.acc += dt * SPEEDS[this.speed];
      if (this.acc >= 1) {
        this.acc = 0;
        const prevY = this.S.y;
        monthTick(this.S, this.W, this.ui);
        if (['pop', 'econ', 'growth', 'access'].includes(this.map.mode)) this.map.binsDirty = true;
        if (this.S.y !== prevY) { this.ui.renderPalette(); this.save(true); }
        if (this.S.y === 2045 && this.S.m === 9 && !this.S.ended) this.showEnd();
        if (this.ui.tab !== 'info' || this.ui.sel) this.ui.renderSide();
      }
      this.ui.renderTop();
    }
    this.map.frame(t, this.tool, this.selType);
    requestAnimationFrame((tt) => this.loop(tt));
  }

  // ---------- input ----------
  bindInput() {
    const cv = $('#map'), map = this.map;
    let drag = null;
    window.addEventListener('resize', () => map.resize());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); map.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      drag = { x: e.offsetX, y: e.offsetY, vx: map.view.x, vy: map.view.y, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        if (drag.moved) { map.view.x = drag.vx - dx / map.view.s; map.view.y = drag.vy - dy / map.view.s; map.touch(); }
      }
      this.hover(e.offsetX, e.offsetY);
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.click(e.offsetX, e.offsetY);
      drag = null;
    });
    cv.addEventListener('pointerleave', () => { map.hoverK = -1; this.ui.tip(0, 0, null); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancelChain(); });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); }
      else if (e.key >= '1' && e.key <= '3') this.setSpeed(+e.key);
      else if (e.key === 'Escape') this.cancelChain();
      else if (e.key === 'b' || e.key === 'B') this.setTool('build');
      else if (e.key === 'i' || e.key === 'I') this.setTool('inspect');
      else if (e.key === 'x' || e.key === 'X') this.setTool('demolish');
      else if (e.key === 'r' || e.key === 'R') this.setTool('rehab');
      else if (e.key === 'f' || e.key === 'F') map.fit();
    });
    $('#speed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.setSpeed(+b.dataset.speed); });
    $('#toolbtns').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.setTool(b.dataset.tool); });
    $('#palette').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-type]');
      if (!b) return;
      this.selType = b.dataset.type; this.setTool('build'); this.ui.renderPalette();
      if (this.map.anchor != null) this.map.preview = null;
    });
    $('#modes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      map.mode = b.dataset.mode; map.binsDirty = true; this.ui.renderModes();
    });
    $('#zoomin').onclick = () => map.zoomAt(map.w / 2, map.h / 2, 1.6);
    $('#zoomout').onclick = () => map.zoomAt(map.w / 2, map.h / 2, 1 / 1.6);
    $('#zoomfit').onclick = () => map.fit();
    const search = $('#search'), res = $('#searchres');
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { res.hidden = true; return; }
      const W = this.W, out = [];
      for (const s of this.S.stations) if (s.name.toLowerCase().includes(q)) out.push({ k: s.k, label: '🚉 ' + s.name });
      for (let k = 0; k < W.n && out.length < 30; k++) if (W.name[k].toLowerCase().includes(q) || W.kab[k].toLowerCase().includes(q)) out.push({ k, label: `${W.name[k]} <span>${W.kab[k]}</span>` });
      res.innerHTML = out.slice(0, 30).map((o) => `<button data-k="${o.k}">${o.label}</button>`).join('');
      res.hidden = !out.length;
    });
    res.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      this.focusKec(+b.dataset.k); this.ui.select({ kind: 'kec', id: +b.dataset.k });
      res.hidden = true; search.value = '';
    });
  }

  setTool(t) {
    this.tool = t;
    if (t !== 'build') this.cancelChain();
    document.querySelectorAll('#toolbtns button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#palwrap').classList.toggle('dim', t !== 'build');
    $('#map').dataset.tool = t;
    const hints = { inspect: 'Klik untuk info. Seret untuk geser, gulir untuk zoom.', build: 'Klik kecamatan asal, lalu tujuan. Klik kanan / Esc untuk selesai.', demolish: 'Klik jalur untuk membongkar.', rehab: 'Klik jalur rusak (garis merah putus-putus) untuk memperbaiki.' };
    $('#hint').textContent = hints[t];
  }

  cancelChain() { this.map.anchor = null; this.map.preview = null; this.ui.tip(0, 0, null); }

  hover(px, py) {
    const map = this.map, W = this.W;
    const [x, y] = map.toWorld(px, py);
    const st = this.stationAt(px, py);
    const k = st ? st.k : W.kecAt(x, y);
    if (k !== map.hoverK) {
      map.hoverK = k;
      if (this.tool === 'build' && map.anchor != null && k >= 0) {
        map.preview = planSegment(this.S, W, map.anchor, k, this.selType);
        if (!map.preview.ok) map.preview.pts = [W.x[map.anchor], W.y[map.anchor], W.x[k], W.y[k]];
      }
    }
    if (this.tool === 'build' && map.anchor != null && map.preview && k >= 0) this.ui.tip(px, py, this.ui.planTip(map.preview));
    else if (this.tool === 'build' && k >= 0) this.ui.tip(px, py, `${st ? '🚉 <b>' + st.name + '</b><br>' : ''}${W.name[k]} · ${Math.round(W.pop[k]).toLocaleString('id-ID')} jiwa<br><span class="mt">klik untuk mulai</span>`);
    else if (this.tool === 'demolish' || this.tool === 'rehab') {
      const g = this.segAt(px, py);
      this.ui.tip(px, py, g ? `${segName(this.S, g)}<br>${TYPE[g.type].name} · kondisi ${(g.cond * 100).toFixed(0)}%${this.tool === 'rehab' ? '<br>Rehab: Rp ' + fmtM(rehabCost(this.S, g)) : ''}` : null);
    } else if (k >= 0) this.ui.tip(px, py, `${st ? '🚉 <b>' + st.name + '</b> · ' + Math.round(st.rid).toLocaleString('id-ID') + ' pnp/hari<br>' : ''}<b>${W.name[k]}</b>, ${W.kab[k]}<br>${Math.round(W.pop[k]).toLocaleString('id-ID')} jiwa`);
    else this.ui.tip(0, 0, null);
  }

  stationAt(px, py) {
    const W = this.W, map = this.map;
    let best = null, bd = 10 * 10;
    for (const s of this.S.stations) {
      const [sx, sy] = map.toScreen(W.x[s.k], W.y[s.k]);
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  segAt(px, py) {
    const map = this.map, [x, y] = map.toWorld(px, py), tol = 7 / map.view.s;
    let best = null, bd = tol;
    for (const g of this.S.segs) {
      if (!map.inView(g)) continue;
      const p = g.pts;
      for (let i = 2; i < p.length; i += 2) {
        const d = distSeg(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]);
        if (d < bd) { bd = d; best = g; }
      }
    }
    return best;
  }

  click(px, py) {
    const map = this.map, W = this.W, S = this.S;
    const [x, y] = map.toWorld(px, py);
    const st = this.stationAt(px, py);
    if (this.tool === 'build') {
      const k = st ? st.k : W.kecAt(x, y);
      if (k < 0) return;
      if (map.anchor == null) { map.anchor = k; map.preview = null; return; }
      const plan = planSegment(S, W, map.anchor, k, this.selType);
      if (!plan.ok) { this.ui.news('✖ ' + plan.err, 'bad'); return; }
      const r = commitSegment(S, W, plan);
      if (!r.ok) { this.ui.news('✖ ' + r.err, 'bad'); return; }
      this.ui.news(`🏗️ Mulai membangun ${TYPE[plan.type].name} ${segName(S, r.seg)} — Rp ${fmtM(plan.cost)}, ${plan.months} bulan.`);
      map.anchor = k; map.preview = null; map.hoverK = -1;
      this.ui.renderTop();
      return;
    }
    if (this.tool === 'demolish') { const g = this.segAt(px, py); if (g) this.demolish(g); else if (st) this.deleteStation(st); return; }
    if (this.tool === 'rehab') { const g = this.segAt(px, py); if (g) this.rehab(g); return; }
    // inspect
    if (st) { this.ui.select({ kind: 'st', id: st.id }); map.highlight = { st: st.id }; return; }
    const g = this.segAt(px, py);
    if (g) { this.ui.select({ kind: 'seg', id: g.id }); map.highlight = null; return; }
    const k = W.kecAt(x, y);
    if (k >= 0) { this.ui.select({ kind: 'kec', id: k }); map.highlight = { k }; }
  }

  demolish(g) {
    if (!g) return;
    const S = this.S;
    if (g.build > 0) { const refund = g.cost * 0.5 * g.build / Math.max(1, g.total); S.cash += refund; }
    removeSeg(S, g);
    this.ui.news(`🧨 Dibongkar: ${segName(S, g)}`);
    runTraffic(S, this.W);
    if (this.ui.sel && this.ui.sel.kind === 'seg' && this.ui.sel.id === g.id) this.ui.sel = null;
    this.ui.renderSide(); this.ui.renderTop();
  }

  deleteStation(s) {
    if (!s) return;
    if (removeStation(this.S, s)) { this.ui.news(`Stasiun ${s.name} dihapus.`); this.ui.sel = null; this.ui.renderSide(); }
    else this.ui.news('✖ Bongkar dulu semua jalur di stasiun ini.', 'bad');
  }

  rehab(g) {
    if (!g || g.build > 0) return;
    const c = rehabCost(this.S, g);
    if (g.cond >= 0.98) { this.ui.news('Jalur ini sudah prima.'); return; }
    if (this.S.cash < c) { this.ui.news('✖ Kas tidak cukup untuk rehabilitasi.', 'bad'); return; }
    this.S.cash -= c; g.cond = 1;
    this.ui.news(`🔧 Rehabilitasi ${segName(this.S, g)} — Rp ${fmtM(c)}`, 'good');
    this.ui.renderSide(); this.ui.renderTop();
  }

  focusKec(k) { this.map.focus(this.W.x[k], this.W.y[k], Math.max(this.map.view.s, 2.5)); this.map.highlight = { k }; }
  focusSeg(g) {
    const b = g.bb || [g.pts[0], g.pts[1], g.pts[g.pts.length - 2], g.pts[g.pts.length - 1]];
    const s = Math.min(this.map.w / Math.max(40, (b[2] - b[0]) * 1.4), this.map.h / Math.max(40, (b[3] - b[1]) * 1.4));
    this.map.focus((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, Math.min(s, 20));
  }

  save(silent) {
    const S = this.S, W = this.W;
    const clean = { ...S, stById: undefined, stByKec: undefined, segById: undefined,
      segs: S.segs.map(({ cum, len, bb, ...g }) => g) };
    const r = (a, d) => Array.from(a, (v) => Math.round(v * d) / d);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ S: clean, pop: r(W.pop, 1), grdp: r(W.grdp, 1000), urban: r(W.urban, 1000), pop12: W.pop12 ? r(W.pop12, 1) : null }));
    } catch (e) { if (!silent) this.ui.news('✖ Gagal menyimpan: ' + e.message, 'bad'); }
  }

  confirmNew() {
    $('#confirm').hidden = false;
    $('#confirm-yes').onclick = () => { $('#confirm').hidden = true; try { localStorage.removeItem(SAVE_KEY); } catch {} this.start(null); };
    $('#confirm-no').onclick = () => { $('#confirm').hidden = true; };
  }

  showEnd() {
    const S = this.S, H = S.hist, last = H[H.length - 1], first = H[0];
    S.ended = true;
    this.setSpeed(0);
    $('#endbody').innerHTML = `<p>100 tahun Indonesia merdeka. Begini warisan jaringan relmu:</p>
      <table class="kv"><tr><td>Panjang jaringan</td><td>${Math.round(last.km).toLocaleString('id-ID')} km</td></tr>
      <tr><td>Penumpang/tahun</td><td>${(last.pax / 1e6).toFixed(0)} juta</td></tr>
      <tr><td>Penduduk terlayani</td><td>${(last.cov * 100).toFixed(1)}%</td></tr>
      <tr><td>PDB vs lintasan sejarah</td><td>${((last.gdp / last.hist - 1) * 100).toFixed(1)}%</td></tr>
      <tr><td>Penduduk</td><td>${(first.pop / 1e6).toFixed(0)} → ${(last.pop / 1e6).toFixed(0)} juta</td></tr>
      <tr><td>Kas akhir</td><td>Rp ${fmtM(S.cash)}</td></tr></table>`;
    $('#end').hidden = false;
    $('#end-continue').onclick = () => { $('#end').hidden = true; };
  }
}

function distSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l = dx * dx + dy * dy;
  let t = l ? ((px - x0) * dx + (py - y0) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
}

const game = new Game();
window.game = game;
game.boot();
