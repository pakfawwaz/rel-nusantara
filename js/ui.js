// DOM panels: top bar, tool palette, side panel tabs, news feed, tooltip.
import { RAIL_TYPES, TYPE, FAMILIES, costIndex, techSpeed } from './railtypes.js';
import { density, segName, rehabCost, stationCost } from './network.js';
import { fmtM, loanRate, maxLoan, yearFrac, poiActive, coverage } from './sim.js';
import { MODES, legendColors } from './render.js';

const $ = (s) => document.querySelector(s);
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const fmtN = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M';
  if (a >= 1e6) return (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (a >= 1e4) return (v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' rb';
  return Math.round(v).toLocaleString('id-ID');
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(game) {
    this.g = game;
    this.tab = 'info';
    this.sel = null; // {kind:'kec'|'st'|'seg', id}
    $('#side-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) { this.tab = b.dataset.tab; this.renderSide(); }
    });
    $('#side-body').addEventListener('click', (e) => this.onSideClick(e));
    this.renderModes();
  }

  get S() { return this.g.S; }
  get W() { return this.g.W; }

  news(text, cls = '') {
    const S = this.S;
    S.news.unshift({ t: `${BULAN[S.m - 1]} ${S.y}`, text, cls });
    S.news.length = Math.min(S.news.length, 60);
    this.renderNews();
  }
  renderNews() {
    $('#news').innerHTML = this.S.news.slice(0, 30).map((n) => `<span class="nw ${n.cls}"><b>${n.t}</b> ${esc(n.text)}</span>`).join('');
  }

  renderTop() {
    const S = this.S, L = S.last || {};
    $('#date').textContent = `${Math.min(28, 1 + Math.floor((this.g.acc || 0) * 28))} ${BULAN[S.m - 1]} ${S.y}`;
    let km = 0, building = 0;
    for (const g of S.segs) if (g.build <= 0) km += g.km; else building++;
    const chip = (id, v, cls = '') => { const el = $(id); el.textContent = v; el.className = 'v ' + cls; };
    chip('#cash', 'Rp ' + fmtM(S.cash), S.cash < 0 ? 'neg' : '');
    chip('#profit', (L.profit >= 0 ? '+' : '') + fmtM(L.profit || 0) + '/bln', (L.profit || 0) < 0 ? 'neg' : 'pos');
    chip('#km', km.toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' km' + (building ? ` (+${building})` : ''));
    chip('#pax', fmtN(L.pax || 0) + '/hari');
    chip('#pop', fmtN(L.natPop || 0));
    chip('#gdp', 'Rp ' + fmtM(L.natGdp || 0));
    const eff = S.histGdp ? (L.natGdp || 0) / S.histGdp : 1;
    chip('#eff', (eff >= 1 ? '+' : '') + ((eff - 1) * 100).toFixed(1) + '%', eff >= 1 ? 'pos' : 'neg');
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === this.g.speed));
  }

  // ---------- palette ----------
  renderPalette() {
    const S = this.S, ci = costIndex(yearFrac(S)), g = this.g;
    let h = '';
    for (const [fam, label] of Object.entries(FAMILIES)) {
      h += `<div class="fam">${label}</div>`;
      for (const t of RAIL_TYPES.filter((x) => x.family === fam)) {
        const locked = S.y < t.year;
        const sp = Math.round(t.speed * techSpeed(t, yearFrac(S)));
        h += `<button class="rt ${g.selType === t.key ? 'on' : ''} ${locked ? 'locked' : ''}" data-type="${t.key}" title="${esc(t.desc)}">
          <i style="background:${t.color}"></i><span class="nm">${t.name}</span>
          <span class="mt">${locked ? '🔒 ' + t.year : `${sp} km/j · ${fmtN(t.cap)}/hr · ${fmtM(t.cost * ci)}/km`}</span></button>`;
      }
    }
    $('#palette').innerHTML = h;
    const t = TYPE[g.selType];
    $('#typedesc').innerHTML = `<b>${t.name}</b><br>${esc(t.desc)}<br><span class="mt">Penumpang ×${t.pax} · Barang ×${t.freight} · Tarif ×${t.fare}${t.maxKm ? ` · maks ${t.maxKm} km` : ''}</span>`;
  }

  renderModes() {
    $('#modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}" class="${this.g.map && this.g.map.mode === k ? 'on' : ''}">${m.name}</button>`).join('');
    this.renderLegend();
  }
  renderLegend() {
    const mode = this.g.map ? this.g.map.mode : 'pop', m = MODES[mode], cols = legendColors(mode);
    $('#legend').innerHTML = `<div class="lt">${m.name} <span>${m.unit}</span></div><div class="lb">` +
      m.legend.map((l, i) => `<span><i style="background:${cols[i]}"></i>${l}</span>`).join('') + '</div>';
  }

  // ---------- side panel ----------
  select(sel) { this.sel = sel; this.tab = 'info'; this.renderSide(); }

  renderSide() {
    document.querySelectorAll('#side-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = $('#side-body');
    const fn = { info: () => this.infoHtml(), fin: () => this.finHtml(), stat: () => this.statHtml(), net: () => this.netHtml() }[this.tab];
    body.innerHTML = fn();
    if (this.tab === 'stat') this.drawCharts();
  }

  infoHtml() {
    const sel = this.sel, S = this.S, W = this.W;
    if (!sel) return `<div class="empty"><h3>Selamat datang, Kepala Djawatan!</h3>
      <p>Klik peta untuk melihat kecamatan, stasiun atau jalur.</p>
      <ol><li>Pilih <b>Bangun Rel</b> dan jenis rel di kiri.</li><li>Klik kecamatan asal, lalu kecamatan tujuan. Klik lagi untuk menyambung terus. <kbd>Esc</kbd>/klik kanan untuk berhenti.</li>
      <li>Sambungkan ⚓ pelabuhan, ✈ bandara, ⛏ tambang dan 🏭 pabrik untuk bonus dan angkutan barang.</li>
      <li>Kecamatan yang terlayani rel tumbuh lebih cepat — penduduk dan ekonomi bergerak mengikuti jaringanmu.</li></ol>
      <p class="mt">Spasi: jeda · 1/2/3: kecepatan · B: bangun · I: inspeksi · X: bongkar · R: rehabilitasi</p></div>`;
    if (sel.kind === 'kec') return this.kecHtml(sel.id);
    if (sel.kind === 'st') { const s = S.stById.get(sel.id); return s ? this.stHtml(s) : ''; }
    if (sel.kind === 'seg') { const g = S.segById.get(sel.id); return g ? this.segHtml(g) : ''; }
    return '';
  }

  kecHtml(k) {
    const W = this.W, S = this.S, y = yearFrac(S);
    const inc = W.grdp[k] / W.pop[k];
    let np = 0, ng = 0; for (let i = 0; i < W.n; i++) { np += W.pop[i]; ng += W.grdp[i]; }
    const g12 = W.pop12 ? ((W.pop[k] / W.pop12[k]) - 1) * 100 : 0;
    const pois = (W.poisByKec.get(k) || []).filter((p) => poiActive(p, y));
    const st = S.stByKec.get(k);
    const TER = ['Dataran rendah', 'Pesisir', 'Perbukitan', 'Pegunungan'];
    return `<h3>${esc(W.name[k])}</h3><div class="sub">${esc(W.kab[k])}, ${esc(W.prov[k])}</div>
      <table class="kv">
      <tr><td>Penduduk</td><td>${fmtN(W.pop[k])}</td></tr>
      <tr><td>Kepadatan</td><td>${fmtN(density(W, k))} /km²</td></tr>
      <tr><td>Luas</td><td>${W.area[k].toFixed(0)} km²</td></tr>
      <tr><td>PDRB</td><td>Rp ${fmtM(W.grdp[k])}</td></tr>
      <tr><td>PDRB/kapita</td><td>${(inc * 1000).toFixed(1)} jt (${(inc / (ng / np)).toFixed(2)}× nasional)</td></tr>
      <tr><td>Tumbuh (tahun ini)</td><td class="${g12 >= 0 ? 'pos' : 'neg'}">${g12.toFixed(2)}%</td></tr>
      <tr><td>Perkotaan</td><td>${(W.urban[k] * 100).toFixed(0)}%</td></tr>
      <tr><td>Medan</td><td>${TER[W.terrain[k]]}${W.swamp[k] ? ', rawa' : ''} · ±${W.elev[k].toFixed(0)} m</td></tr>
      <tr><td>Aksesibilitas rel</td><td>${((W.access ? W.access[k] : 0) * 100).toFixed(0)}/100</td></tr>
      </table>
      ${pois.length ? `<h4>Fasilitas</h4><ul class="pois">${pois.map((p) => `<li>${p.name} <span class="mt">lvl ${p.level}${S.connected.includes(p.id) ? ' · ✅ tersambung' : ''}</span></li>`).join('')}</ul>` : ''}
      ${st ? `<p><button class="lnk" data-st="${st.id}">→ Stasiun ${esc(st.name)}</button></p>` : '<p class="mt">Belum ada stasiun. Bangun rel ke sini untuk membuka stasiun.</p>'}`;
  }

  stHtml(s) {
    const S = this.S, W = this.W;
    const segs = S.segs.filter((g) => g.a === s.id || g.b === s.id);
    return `<h3>🚉 Stasiun ${esc(s.name)}</h3><div class="sub">${esc(W.name[s.k])}, ${esc(W.kab[s.k])}</div>
      <table class="kv"><tr><td>Penumpang</td><td>${fmtN(s.rid)} /hari</td></tr>
      <tr><td>Barang</td><td>${fmtN(s.fr)} ton/hari</td></tr>
      <tr><td>Jangkauan</td><td>${fmtN(s.acc || 0)} jiwa (tertimbang waktu)</td></tr></table>
      <h4>Jalur (${segs.length})</h4><ul class="segs">${segs.map((g) => `<li><button class="lnk" data-seg="${g.id}"><i style="background:${TYPE[g.type].color}"></i>${esc(segName(S, g))}</button> <span class="mt">${TYPE[g.type].name}${g.build > 0 ? ' · dibangun' : ''}</span></li>`).join('')}</ul>
      <p><button class="lnk" data-kec="${s.k}">→ Data kecamatan</button></p>
      ${segs.length ? '' : `<p><button class="btn" data-delst="${s.id}">Hapus stasiun</button></p>`}`;
  }

  segHtml(g) {
    const S = this.S, t = TYPE[g.type], y = yearFrac(S);
    const util = (g.loadP + g.loadF) / t.cap;
    const sp = t.speed * techSpeed(t, y) * (0.45 + 0.55 * g.cond);
    const rc = rehabCost(S, g);
    return `<h3><i class="sw" style="background:${t.color}"></i>${esc(segName(S, g))}</h3><div class="sub">${t.name}</div>
      ${g.build > 0 ? `<div class="prog"><div style="width:${(100 * (1 - g.build / Math.max(1, g.total))).toFixed(0)}%"></div></div><p>Dalam pembangunan — selesai ${g.build} bulan lagi.</p>` : ''}
      <table class="kv">
      <tr><td>Panjang</td><td>${g.km.toFixed(1)} km</td></tr>
      <tr><td>Kecepatan efektif</td><td>${sp.toFixed(0)} km/j · ${(g.km / sp * 60).toFixed(0)} menit</td></tr>
      <tr><td>Kondisi</td><td class="${g.cond < 0.5 ? 'neg' : ''}">${(g.cond * 100).toFixed(0)}%</td></tr>
      <tr><td>Kapasitas</td><td>${fmtN(t.cap)} /hari</td></tr>
      <tr><td>Permintaan penumpang</td><td>${fmtN(g.loadP)} /hari</td></tr>
      <tr><td>Permintaan barang</td><td>${fmtN(g.loadF)} ton/hari</td></tr>
      <tr><td>Terlayani</td><td>${fmtN(g.sP)} pnp · ${fmtN(g.sF)} ton</td></tr>
      <tr><td>Utilisasi</td><td class="${util > 1 ? 'neg' : ''}">${(util * 100).toFixed(0)}%${util > 1 ? ' — penuh! upgrade' : ''}</td></tr>
      <tr><td>Pendapatan</td><td>Rp ${fmtM(g.rev * 30.4)}/bln</td></tr>
      <tr><td>Perawatan</td><td>Rp ${fmtM(g.km * t.maint * costIndex(y) / 12)}/bln</td></tr>
      </table>
      <div class="row">
      ${g.build <= 0 && g.cond < 0.98 ? `<button class="btn" data-rehab="${g.id}">🔧 Rehabilitasi (Rp ${fmtM(rc)})</button>` : ''}
      <button class="btn danger" data-demo="${g.id}">🧨 Bongkar</button></div>
      <p class="mt">Untuk upgrade: pilih jenis rel lain di keluarga yang sama (${FAMILIES[t.family]}) lalu bangun ulang antara dua stasiun ini — dapat potongan 50% nilai jalur lama.</p>`;
  }

  finHtml() {
    const S = this.S, L = S.last || {}, y = yearFrac(S);
    const ml = maxLoan(S), chunk = Math.round(500 * costIndex(y));
    const row = (a, b, cls = '') => `<tr><td>${a}</td><td class="${cls}">${b}</td></tr>`;
    return `<h3>Keuangan</h3><div class="sub">Bulan lalu (Rp, harga konstan 2026)</div>
      <table class="kv">
      ${row('Pendapatan tiket & barang', fmtM(L.rev || 0), 'pos')}
      ${row('Subsidi PSO pemerintah', fmtM(L.subsidy || 0), 'pos')}
      ${row('Operasi kereta', '−' + fmtM(L.ops || 0), 'neg')}
      ${row('Perawatan jalur & stasiun', '−' + fmtM(L.maint || 0), 'neg')}
      ${row('Bunga', '−' + fmtM(L.interest || 0), 'neg')}
      ${row('<b>Laba bersih</b>', '<b>' + fmtM(L.profit || 0) + '</b>', (L.profit || 0) >= 0 ? 'pos' : 'neg')}
      </table>
      <table class="kv">
      ${row('Kas', 'Rp ' + fmtM(S.cash), S.cash < 0 ? 'neg' : '')}
      ${row('Pinjaman', 'Rp ' + fmtM(S.loan))}
      ${row('Suku bunga', (loanRate(y) * 100).toFixed(0) + '%/thn')}
      ${row('Batas pinjaman', 'Rp ' + fmtM(ml))}
      ${row('Indeks biaya', costIndex(y).toFixed(2) + '× (2026 = 1)')}
      </table>
      <div class="row"><button class="btn" data-loan="${chunk}" ${S.loan + chunk > ml ? 'disabled' : ''}>Pinjam Rp ${fmtM(chunk)}</button>
      <button class="btn" data-repay="${chunk}" ${S.loan <= 0 || S.cash <= 0 ? 'disabled' : ''}>Bayar Rp ${fmtM(Math.min(chunk, S.loan))}</button></div>
      <h4>Lalu lintas</h4><table class="kv">
      ${row('Penumpang', fmtN(L.pax || 0) + '/hari')}
      ${row('Barang', fmtN(L.fr || 0) + ' ton/hari')}
      ${row('Penumpang-km', fmtN((L.pkm || 0) * 365) + '/thn')}
      ${row('Ton-km', fmtN((L.tkm || 0) * 365) + '/thn')}
      ${row('Penduduk terlayani', ((S.hist.length ? S.hist[S.hist.length - 1].cov : 0) * 100).toFixed(1) + '%')}
      </table>
      <div class="row"><button class="btn" data-save="1">💾 Simpan</button><button class="btn" data-newgame="1">↺ Permainan baru</button></div>`;
  }

  statHtml() {
    return `<h3>Statistik tahunan</h3>
      <div class="chart"><div class="ct">Penduduk Indonesia</div><canvas data-key="pop"></canvas></div>
      <div class="chart"><div class="ct">PDB riil — <span style="color:#b25a36">dengan jaringanmu</span> vs <span style="color:#78909c">lintasan sejarah</span></div><canvas data-key="gdp"></canvas></div>
      <div class="chart"><div class="ct">Panjang jaringan (km)</div><canvas data-key="km"></canvas></div>
      <div class="chart"><div class="ct">Penumpang per tahun</div><canvas data-key="pax"></canvas></div>
      <div class="chart"><div class="ct">Laba bersih per tahun (Rp miliar)</div><canvas data-key="profit"></canvas></div>
      <div class="chart"><div class="ct">Penduduk terlayani rel (%)</div><canvas data-key="cov"></canvas></div>`;
  }

  drawCharts() {
    const H = this.S.hist;
    document.querySelectorAll('#side-body canvas[data-key]').forEach((cv) => {
      const key = cv.dataset.key, dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = 90;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
      const c = cv.getContext('2d'); c.scale(dpr, dpr);
      if (H.length < 2) { c.fillStyle = '#8a7a66'; c.font = '12px system-ui'; c.fillText('Data muncul setelah 2 tahun.', 8, 45); return; }
      const series = key === 'gdp' ? [H.map((r) => r.gdp), H.map((r) => r.hist)] : [H.map((r) => key === 'cov' ? r.cov * 100 : r[key])];
      const cols = ['#b25a36', '#78909c'];
      let lo = Math.min(0, ...series.flat()), hi = Math.max(...series.flat()) || 1;
      const X = (i) => 34 + (w - 40) * i / (H.length - 1), Y = (v) => h - 16 - (h - 24) * (v - lo) / (hi - lo || 1);
      c.strokeStyle = '#d9cfbf'; c.lineWidth = 1; c.beginPath(); c.moveTo(34, Y(lo)); c.lineTo(w - 6, Y(lo)); c.stroke();
      if (lo < 0) { c.beginPath(); c.moveTo(34, Y(0)); c.lineTo(w - 6, Y(0)); c.stroke(); }
      c.fillStyle = '#8a7a66'; c.font = '10px system-ui';
      c.fillText(fmtN(hi), 2, 12); c.fillText(H[0].y, 34, h - 3); c.fillText(H[H.length - 1].y, w - 30, h - 3);
      series.forEach((s, j) => {
        c.strokeStyle = cols[j]; c.lineWidth = 2; c.beginPath();
        s.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
        c.stroke();
      });
    });
  }

  netHtml() {
    const S = this.S;
    const segs = S.segs.filter((g) => g.build <= 0).map((g) => ({ g, u: (g.loadP + g.loadF) / TYPE[g.type].cap }));
    const busy = [...segs].sort((a, b) => b.u - a.u).slice(0, 15);
    const rich = [...segs].sort((a, b) => b.g.rev - a.g.rev).slice(0, 10);
    const sts = [...S.stations].sort((a, b) => b.rid - a.rid).slice(0, 15);
    const building = S.segs.filter((g) => g.build > 0);
    const li = (g, extra) => `<li><button class="lnk" data-seg="${g.id}"><i style="background:${TYPE[g.type].color}"></i>${esc(segName(S, g))}</button> <span class="mt">${extra}</span></li>`;
    return `<h3>Jaringan</h3>
      ${building.length ? `<h4>Sedang dibangun (${building.length})</h4><ul class="segs">${building.map((g) => li(g, `${g.build} bln lagi`)).join('')}</ul>` : ''}
      <h4>Ruas terpadat</h4><ul class="segs">${busy.map(({ g, u }) => li(g, `<span class="${u > 1 ? 'neg' : ''}">${(u * 100).toFixed(0)}%</span>`)).join('')}</ul>
      <h4>Ruas terlaris</h4><ul class="segs">${rich.map(({ g }) => li(g, 'Rp ' + fmtM(g.rev * 30.4) + '/bln')).join('')}</ul>
      <h4>Stasiun tersibuk</h4><ul class="segs">${sts.map((s) => `<li><button class="lnk" data-st="${s.id}">🚉 ${esc(s.name)}</button> <span class="mt">${fmtN(s.rid)}/hari</span></li>`).join('')}</ul>`;
  }

  onSideClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset, g = this.g, S = this.S;
    if (d.seg) { const seg = S.segById.get(+d.seg); this.select({ kind: 'seg', id: +d.seg }); if (seg) g.focusSeg(seg); }
    else if (d.st) { const s = S.stById.get(+d.st); this.select({ kind: 'st', id: +d.st }); if (s) g.focusKec(s.k); }
    else if (d.kec) this.select({ kind: 'kec', id: +d.kec });
    else if (d.rehab) g.rehab(S.segById.get(+d.rehab));
    else if (d.demo) g.demolish(S.segById.get(+d.demo));
    else if (d.delst) g.deleteStation(S.stById.get(+d.delst));
    else if (d.loan) { S.loan += +d.loan; S.cash += +d.loan; this.renderSide(); this.renderTop(); }
    else if (d.repay) { const a = Math.min(+d.repay, S.loan, Math.max(0, S.cash)); S.loan -= a; S.cash -= a; this.renderSide(); this.renderTop(); }
    else if (d.save) { g.save(); this.news('💾 Permainan disimpan.'); }
    else if (d.newgame) g.confirmNew();
  }

  tip(x, y, html) {
    const t = $('#tip');
    if (!html) { t.style.display = 'none'; return; }
    t.innerHTML = html; t.style.display = 'block';
    const r = t.getBoundingClientRect(), p = t.parentElement.getBoundingClientRect();
    t.style.left = Math.min(x + 16, p.width - r.width - 8) + 'px';
    t.style.top = Math.min(y + 16, p.height - r.height - 8) + 'px';
  }

  planTip(plan) {
    if (!plan.ok) return `<span class="neg">✖ ${esc(plan.err)}</span>`;
    const t = TYPE[plan.type];
    return `<b>${t.name}</b><br>${esc(this.W.name[plan.ka])} → ${esc(this.W.name[plan.kb])}<br>
      ${plan.km.toFixed(1)} km · medan ×${plan.tf.toFixed(2)} · ${plan.months} bulan<br>
      <b class="${plan.cost > this.S.cash ? 'neg' : ''}">Rp ${fmtM(plan.cost)}</b>${plan.upgradeOf ? ' <span class="pos">(upgrade, potongan 50%)</span>' : ''}${plan.newB ? ' · stasiun baru' : ''}`;
  }
}

export { coverage, stationCost };
