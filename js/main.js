import { loadWorld } from './world.js';
import { TYPE, costIndex } from './railtypes.js';
import { reindex, seedNetwork, planSegment, commitSegment, planSplit, commitSplit, removeSeg, removeStation, rehabCost, segName, prepSeg } from './network.js';
import { calibrate, monthTick, runTraffic, computeAccess, fmtM, poiActive, yearFrac, closeBooks } from './sim.js';
import { findLeg, newTrayek, configure, suggest, geometry, fleetNeed, fleetCost, runTrayeks, trayekAccess, KIND } from './trayek.js';
import { newGroup, createCompany, compById, dividend, inject, book, induk, BIZ } from './company.js';
import { MapView } from './render.js';
import { UI } from './ui.js';

const SAVE_KEY = 'rel-nusantara-v2';
const SPEEDS = [0, 0.1, 0.25, 0.7]; // months per second (normal: 10 s per month)
const $ = (s) => document.querySelector(s);

class Game {
  constructor() {
    this.speed = 0; this.acc = 0;
    this.tool = 'inspect'; this.selType = 'konv'; this.trayekKind = 'P'; this.draft = null;
  }

  async boot() {
    const bar = $('#loadbar'), msg = $('#loadmsg');
    try {
      this.W = await loadWorld((f, name) => { bar.style.width = (f * 100).toFixed(0) + '%'; msg.textContent = 'Memuat ' + name; });
    } catch (e) {
      msg.textContent = 'Gagal memuat data: ' + e.message + '. Jalankan lewat server lokal (serve.ps1).';
      return;
    }
    this.W0 = { pop: Float64Array.from(this.W.pop), grdp: Float64Array.from(this.W.grdp), urban: Float32Array.from(this.W.urban), goods: Float32Array.from(this.W.goods) };
    $('#loading').hidden = true;
    $('#menu').hidden = false;
    let has = false;
    try { has = !!localStorage.getItem(SAVE_KEY); } catch {}
    $('#btn-continue').hidden = !has;
    $('#btn-new').onclick = () => this.start(null);
    $('#btn-continue').onclick = () => { let d = null; try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {} this.start(d); };
  }

  newState() {
    return { y: 1945, m: 8, cash: 2500, loan: 0, stations: [], segs: [], nextId: 1, connected: [], hist: [], news: [], histGdp: 0, gp: 1, gf: 1, companies: newGroup(), trayeks: [], trayekSeq: 0 };
  }

  start(saved) {
    const W = this.W;
    W.pop.set(this.W0.pop); W.grdp.set(this.W0.grdp); W.urban.set(this.W0.urban); W.goods.set(this.W0.goods); W.pop12 = null; W.access = null;
    if (saved) {
      this.S = saved.S;
      W.pop.set(saved.pop); W.grdp.set(saved.grdp); W.urban.set(saved.urban);
      if (saved.pop12) W.pop12 = Float64Array.from(saved.pop12);
      if (saved.goods) W.goods.set(saved.goods);
      reindex(this.S);
      runTraffic(this.S, W);
      for (const t of this.S.trayeks) t.geo = geometry(this.S, t, yearFrac(this.S));
      computeAccess(this.S, W);
    } else {
      this.S = this.newState();
      reindex(this.S);
      seedNetwork(this.S, W);
      calibrate(this.S, W);
      this.seedTrayeks();
      computeAccess(this.S, W);
      const stopSet = new Set(this.S.trayeks.flatMap((t) => t.stops));
      let p0 = 0; for (let k = 0; k < W.n; k++) p0 += W.pop[k];
      for (const s of this.S.stations) if (stopSet.has(s.id)) for (const p of W.poisByKec.get(s.k) || []) if (poiActive(p, 1945) && !this.S.connected.includes(p.id)) this.S.connected.push(p.id);
      let g = 0; for (let k = 0; k < W.n; k++) g += W.grdp[k];
      this.S.histGdp = g; this.S.inc0 = g / p0; this.S.gdp0 = g;
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
        if (this.ui.tab !== 'info' || this.ui.sel) this.ui.renderSide(false);
        if (this.tool === 'trayek') this.ui.renderPalette();
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
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.tool === 'trayek') this.finishDraft(); else this.cancelChain(); });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); }
      else if (e.key >= '1' && e.key <= '3') this.setSpeed(+e.key);
      else if (e.key === 'Escape') { this.cancelChain(); this.cancelDraft(); }
      else if (e.key === 'Enter' && this.tool === 'trayek') this.finishDraft();
      else if (e.key === 'Backspace' && this.draft && this.draft.stops.length) { this.draft.stops.pop(); this.draft.legs.pop(); this.refreshDraft(); }
      else if (e.key === 't' || e.key === 'T') this.setTool('trayek');
      else if (e.key === 's' || e.key === 'S') this.setTool('station');
      else if (e.key === 'b' || e.key === 'B') this.setTool('build');
      else if (e.key === 'i' || e.key === 'I') this.setTool('inspect');
      else if (e.key === 'x' || e.key === 'X') this.setTool('demolish');
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
    if (t !== 'trayek') this.cancelDraft(true);
    document.querySelectorAll('#toolbtns button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#palwrap').classList.toggle('dim', t !== 'build' && t !== 'trayek');
    this.ui.renderPalette();
    $('#map').dataset.tool = t;
    const hints = { inspect: 'Klik untuk info. Seret untuk geser, gulir untuk zoom.', build: 'Klik kecamatan asal, lalu tujuan. Klik kanan / Esc untuk selesai.', demolish: 'Klik jalur untuk membongkar.', rehab: 'Klik jalur rusak (garis merah putus-putus) untuk memperbaiki.', trayek: 'Klik stasiun pemberhentian berurutan. Enter / klik kanan untuk membuat trayek.', station: 'Arahkan ke rel yang sudah ada, klik kecamatan yang dilewatinya untuk membuka stasiun baru.' };
    $('#hint').textContent = hints[t];
  }

  cancelChain() { this.map.anchor = null; this.map.preview = null; this.ui.tip(0, 0, null); }

  hover(px, py) {
    const map = this.map, W = this.W;
    const [x, y] = map.toWorld(px, py);
    if (this.tool === 'station') { this.hoverSplit(px, py, x, y); return; }
    const st = this.stationAt(px, py);
    const k = st ? st.k : W.kecAt(x, y);
    if (k !== map.hoverK) {
      map.hoverK = k;
      if (this.tool === 'build' && map.anchor != null && k >= 0) {
        map.preview = planSegment(this.S, W, map.anchor, k, this.selType);
        if (!map.preview.ok) map.preview.pts = [W.x[map.anchor], W.y[map.anchor], W.x[k], W.y[k]];
      }
    }
    if (this.tool === 'trayek') { this.hoverTrayek(px, py, st); return; }
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
    if (this.tool === 'trayek') { if (st) this.addStop(st); return; }
    if (this.tool === 'station') { this.clickSplit(x, y, px, py); return; }
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
    if (g.build > 0) { const refund = g.cost * 0.5 * g.build / Math.max(1, g.total); book(S, induk(S), 'Pembangunan rel', refund); }
    const hit = S.trayeks.filter((t) => t.legs.some((l) => l.includes(g.id)));
    removeSeg(S, g);
    this.ui.news(`🧨 Dibongkar: ${segName(S, g)}${hit.length ? ` — ${hit.length} trayek terputus: ${hit.map((t) => t.code).join(', ')}` : ''}`, hit.length ? 'bad' : '');
    for (const t of hit) t.broken = true;
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
    book(this.S, induk(this.S), 'Rehabilitasi', -c); g.cond = 1;
    this.ui.news(`🔧 Rehabilitasi ${segName(this.S, g)} — Rp ${fmtM(c)}`, 'good');
    this.ui.renderSide(); this.ui.renderTop();
  }

  // ---------- new station on existing track ----------
  splitAt(x, y, px, py) {
    const g = this.segAt(px, py), k = this.W.kecAt(x, y);
    return { g, k, plan: g && k >= 0 ? planSplit(this.S, this.W, g, k) : null };
  }
  hoverSplit(px, py, x, y) {
    const { g, k, plan } = this.splitAt(x, y, px, py), W = this.W;
    this.map.hoverK = plan && plan.ok ? k : -1;
    if (!g) { this.ui.tip(px, py, k >= 0 ? `<span class="mt">Arahkan ke rel</span>` : null); return; }
    this.ui.tip(px, py, plan.ok ? `🚉 Stasiun baru di <b>${W.name[k]}</b><br>pada ${segName(this.S, g)}<br>Rp ${fmtM(plan.cost)} · trayek yang lewat tidak otomatis berhenti` : `<span class="neg">✖ ${plan.err}</span>`);
  }
  clickSplit(x, y, px, py) {
    const { g, k, plan } = this.splitAt(x, y, px, py);
    if (!plan) return;
    if (!plan.ok) { this.ui.news('✖ ' + plan.err, 'bad'); return; }
    const r = commitSplit(this.S, this.W, plan);
    if (!r.ok) { this.ui.news('✖ ' + r.err, 'bad'); return; }
    this.ui.news(`🚉 Stasiun ${r.st.name} dibuka di rel ${segName(this.S, r.A)} / ${segName(this.S, r.B)} — Rp ${fmtM(plan.cost)}. Ubah stop trayek untuk berhenti di sini.`, 'good');
    this.map.laneSig = null;
    this.ui.select({ kind: 'st', id: r.st.id });
    this.ui.renderTop();
  }

  // ---------- trayek ----------
  mass() { return runTraffic(this.S, this.W).mass; }

  seedTrayeks() {
    const S = this.S, W = this.W, y = yearFrac(S);
    const mass = this.mass();
    for (const line of W.seedRail) {
      const stops = [];
      for (const st of line.stations) {
        const s = S.stByKec.get(W.idx.get(st.kec));
        if (s && !stops.includes(s.id)) stops.push(s.id);
      }
      if (stops.length < 2) continue;
      const legs = [];
      for (let i = 1; i < stops.length; i++) { const l = findLeg(S, stops[i - 1], stops[i], 'C', y); if (!l) { legs.length = 0; break; } legs.push(l); }
      if (!legs.length) continue;
      const tr = newTrayek(S, stops, legs, 'C');
      const sg = suggest(S, W, mass, tr, y);
      if (sg) { tr.freq = sg.freq; tr.gp = sg.gp; tr.gb = sg.gb; }
      tr.geo = geometry(S, tr, y);
      tr.fleet = fleetNeed(tr.geo, tr.freq, tr.gp, tr.gb);
      S.trayeks.push(tr);
    }
  }

  hoverTrayek(px, py, st) {
    const d = this.draft, map = this.map, S = this.S;
    if (!st) { this.ui.tip(px, py, null); map.draftPreview = null; this._hoverSt = null; return; }
    if (!d || !d.stops.length) { this.ui.tip(px, py, `🚉 <b>${st.name}</b><br><span class="mt">klik untuk stop pertama</span>`); return; }
    if (d.stops.includes(st.id)) { map.draftPreview = null; this._hoverSt = null; this.ui.tip(px, py, `🚉 <b>${st.name}</b> (sudah jadi stop)`); return; }
    if (this.routeSplit(d, st.id)) { map.draftPreview = null; this._hoverSt = null; this.ui.tip(px, py, `🚉 <b>${st.name}</b><br>dilewati rute — klik untuk menjadikannya stop`); return; }
    const last = d.stops[d.stops.length - 1], first = d.stops[0], atStart = d.at === 'start';
    if (st.id !== this._hoverSt) {
      this._hoverSt = st.id;
      this._hoverLeg = atStart ? findLeg(S, st.id, first, this.trayekKind, yearFrac(S)) : findLeg(S, last, st.id, this.trayekKind, yearFrac(S));
      map.draftPreview = this._hoverLeg;
    }
    const leg = this._hoverLeg;
    if (!leg) { this.ui.tip(px, py, `<span class="neg">✖ Tidak ada rel jadi yang bisa dilalui trayek ${KIND[this.trayekKind].toLowerCase()} ke ${st.name}.</span>`); return; }
    let km = 0; for (const id of leg) km += S.segById.get(id).km;
    this.ui.tip(px, py, `→ <b>${st.name}</b><br>${km.toFixed(0)} km · lewat ${leg.length - 1} stasiun tanpa berhenti<br><span class="mt">klik untuk tambah stop</span>`);
  }

  // If the draft route already passes station `sid` between two stops, where to split.
  routeSplit(d, sid) {
    const S = this.S;
    for (let li = 0; li < d.legs.length; li++) {
      let cur = d.stops[li];
      const leg = d.legs[li];
      for (let j = 0; j < leg.length - 1; j++) {
        const g = S.segById.get(leg[j]);
        if (!g) break;
        cur = g.a === cur ? g.b : g.a;
        if (cur === sid) return { li, a: leg.slice(0, j + 1), b: leg.slice(j + 1) };
      }
    }
    return null;
  }

  addStop(st) {
    const S = this.S, y = yearFrac(S);
    if (!this.draft) this.draft = { stops: [], legs: [], at: 'end' };
    const d = this.draft;
    if (!d.stops.length) {
      if (!S.segs.some((g) => g.build <= 0 && (g.a === st.id || g.b === st.id))) { this.ui.news('✖ Stasiun ini belum punya rel yang beroperasi.', 'bad'); return; }
      d.stops.push(st.id);
    } else if (d.stops.includes(st.id)) { this.ui.news('✖ Stasiun ini sudah jadi pemberhentian.', 'bad'); return; }
    else {
      const sp = this.routeSplit(d, st.id);
      if (sp) { d.stops.splice(sp.li + 1, 0, st.id); d.legs.splice(sp.li, 1, sp.a, sp.b); }
      else if (d.at === 'start') {
        const leg = findLeg(S, st.id, d.stops[0], this.trayekKind, y);
        if (!leg) { this.ui.news(`✖ Tidak ada rel yang bisa dilalui dari ${st.name}.`, 'bad'); return; }
        d.stops.unshift(st.id); d.legs.unshift(leg);
      } else {
        const leg = findLeg(S, d.stops[d.stops.length - 1], st.id, this.trayekKind, y);
        if (!leg) { this.ui.news(`✖ Tidak ada rel yang bisa dilalui ke ${st.name}.`, 'bad'); return; }
        d.stops.push(st.id); d.legs.push(leg);
      }
    }
    this.refreshDraft();
  }

  // Drop a stop; trains keep using the same track and just pass through.
  removeStop(i) {
    const d = this.draft;
    if (!d) return;
    if (i === 0) { d.stops.shift(); d.legs.shift(); }
    else if (i === d.stops.length - 1) { d.stops.pop(); d.legs.pop(); }
    else { d.stops.splice(i, 1); d.legs.splice(i - 1, 2, [...d.legs[i - 1], ...d.legs[i]]); }
    this.refreshDraft();
  }

  editTrayek(t) {
    this.setTool('trayek');
    this.trayekKind = t.kind;
    this.draft = { stops: [...t.stops], legs: t.legs.map((l) => [...l]), at: 'end', editId: t.id };
    this.refreshDraft();
    this.ui.news(`✏️ Mengubah rute ${t.code}. Klik stasiun untuk menambah, ✕ untuk menghapus, lalu Simpan rute.`);
  }

  refreshDraft() { this.map.draft = this.draft; this.map.draftPreview = null; this._hoverSt = null; this.ui.renderPalette(); }
  cancelDraft(silent) { this.draft = null; if (this.map) { this.map.draft = null; this.map.draftPreview = null; } if (!silent && this.ui) this.ui.renderPalette(); }

  finishDraft() {
    const d = this.draft, S = this.S, y = yearFrac(S);
    if (!d || d.stops.length < 2) return;
    if (d.editId) {
      const tr = S.trayeks.find((t) => t.id === d.editId);
      const old = { stops: tr.stops, legs: tr.legs };
      tr.stops = d.stops; tr.legs = d.legs; tr.broken = false;
      const r = configure(S, tr, tr.freq, tr.gp, tr.gb, y);
      if (!r.ok) { Object.assign(tr, old); this.ui.news('✖ ' + r.err, 'bad'); return; }
      this.ui.news(`✏️ Rute ${tr.code} diperbarui: ${tr.stops.length} stop${r.cost ? ` (sarana ${r.cost > 0 ? 'dibeli' : 'dijual'} Rp ${fmtM(Math.abs(r.cost))})` : ''}.`, 'good');
      this.cancelDraft();
      this.ui.selectTr(tr.id);
      this.ui.renderTop();
      return;
    }
    const tr = newTrayek(S, d.stops, d.legs, this.trayekKind);
    S.trayeks.push(tr);
    const sg = suggest(S, this.W, this.mass(), tr, y);
    let r = sg ? configure(S, tr, sg.freq, sg.gp, sg.gb, y) : { ok: false };
    if (!r.ok) r = configure(S, tr, 1, tr.kind === 'K' ? 0 : 2, tr.kind === 'P' ? 0 : 5, y);
    if (!r.ok) { tr.freq = 0; tr.active = false; this.ui.news(`⚠️ ${tr.code} dibuat tapi belum jalan: kas tidak cukup untuk membeli sarana.`, 'bad'); }
    else this.ui.news(`🚆 Trayek baru ${tr.code} ${tr.name}: ${tr.freq}×/hari, beli sarana Rp ${fmtM(r.cost)}.`, 'good');
    this.cancelDraft();
    this.ui.selectTr(tr.id);
    this.ui.renderTop();
  }

  stepTrayek(t, key, dir) {
    const y = yearFrac(this.S);
    const step = key === 'gb' && t.kind === 'K' ? 5 : key === 'freq' && t.freq >= 20 ? 4 : 1;
    const v = { freq: t.freq, gp: t.gp, gb: t.gb };
    v[key] = Math.max(0, v[key] + dir * step);
    const r = configure(this.S, t, v.freq, v.gp, v.gb, y);
    if (!r.ok) this.ui.news('✖ ' + r.err, 'bad');
    this.ui.renderSide(); this.ui.renderTop();
  }

  suggestTrayek(t) {
    const y = yearFrac(this.S);
    const sg = suggest(this.S, this.W, this.mass(), t, y);
    if (!sg) return;
    const r = configure(this.S, t, sg.freq, sg.gp, sg.gb, y);
    this.ui.news(r.ok ? `✨ ${t.code} disesuaikan: ${sg.freq}×/hari, ${sg.gp + sg.gb} gerbong (${r.cost >= 0 ? 'beli' : 'jual'} sarana Rp ${fmtM(Math.abs(r.cost))}).` : '✖ ' + r.err, r.ok ? '' : 'bad');
    this.ui.renderSide(); this.ui.renderTop();
  }

  deleteTrayek(t) {
    const S = this.S, geo = t.geo || { sf: 1 };
    const refund = -fleetCost(S, geo, { R: 0, cp: 0, cb: 0 }, t.fleet);
    book(S, compById(S, t.op), 'Jual sarana', refund);
    S.trayeks = S.trayeks.filter((x) => x !== t);
    this.ui.news(`Trayek ${t.code} dihapus, sarana dijual Rp ${fmtM(refund)}.`);
    this.ui.sel = null; this.map.trayekHi = null;
    this.ui.renderSide(); this.ui.renderTop(); this.ui.renderPalette();
  }

  setOperator(t, id) {
    const c = compById(this.S, id);
    t.op = id;
    this.ui.news(`${t.code} kini dioperasikan ${c.name}.`);
    this.ui.renderSide();
  }

  foundCompany(f) {
    const S = this.S, ci = costIndex(S.y);
    const NAMES = { kereta: 'PT Operator Kereta', catering: 'PT Boga Rel', alihdaya: 'PT Daya Karya Rel', perawatan: 'PT Balai Yasa Rel', konstruksi: 'PT Karya Rel', parkir: 'PT Parkir Stasiun', properti: 'PT Properti Stasiun', logistik: 'PT Logistik Rel' };
    const jv = f.biz === 'kereta' && f.bentuk === 'jv';
    let name = jv ? `PT KA ${f.prov} (JV)` : NAMES[f.biz];
    const same = S.companies.filter((c) => c.name.startsWith(name)).length;
    if (same) name += ' ' + (same + 1);
    const r = createCompany(S, { name, biz: f.biz, kind: jv ? 'jv' : 'anak', prov: jv ? f.prov : null, own: +f.own, capital: +f.modal * ci });
    if (!r.ok) { this.ui.news('✖ ' + r.err, 'bad'); return; }
    this.ui.news(`🏢 ${r.c.name} didirikan${jv ? ` bersama Pemprov ${f.prov}` : ''}. Modal Rp ${fmtM(r.c.cash)}.`, 'good');
    this.ui.renderSide(); this.ui.renderTop();
  }
  injectCompany(id) { const c = compById(this.S, id); const a = inject(this.S, c, 100 * costIndex(this.S.y)); this.ui.news(`Setor modal Rp ${fmtM(a)} ke ${c.name}.`); this.ui.renderSide(); this.ui.renderTop(); }
  dividendCompany(id) { const c = compById(this.S, id); const a = dividend(this.S, c, c.cash); this.ui.news(`Dividen dari ${c.name}: Rp ${fmtM(a)} masuk ke induk.`, 'good'); this.ui.renderSide(); this.ui.renderTop(); }
  closeCompany(id) {
    const S = this.S, c = compById(S, id);
    const back = Math.max(0, c.cash) * c.own;
    S.cash += back + Math.min(0, c.cash);
    S.companies = S.companies.filter((x) => x !== c);
    this.ui.news(`${c.name} dibubarkan. Sisa kas Rp ${fmtM(back)} kembali ke induk.`);
    this.ui.renderSide(); this.ui.renderTop();
  }

  focusTrayek(t) {
    if (!t.geo) return;
    const W = this.W, S = this.S;
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const n of t.geo.nodes) { const k = S.stById.get(n.st).k; a = Math.min(a, W.x[k]); c = Math.max(c, W.x[k]); b = Math.min(b, W.y[k]); d = Math.max(d, W.y[k]); }
    const s = Math.min(this.map.w / Math.max(30, (c - a) * 1.3), this.map.h / Math.max(30, (d - b) * 1.3));
    this.map.focus((a + c) / 2, (b + d) / 2, Math.min(s, 20));
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
      segs: S.segs.map(({ cum, len, bb, _off, _offD, ...g }) => g),
      trayeks: S.trayeks.map(({ geo, pairs, ...t }) => t) };
    const r = (a, d) => Array.from(a, (v) => Math.round(v * d) / d);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ S: clean, pop: r(W.pop, 1), grdp: r(W.grdp, 1000), urban: r(W.urban, 1000), goods: r(W.goods, 1000), pop12: W.pop12 ? r(W.pop12, 1) : null }));
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
