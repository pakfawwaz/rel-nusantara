// DOM panels: top bar, tool palette, side panel tabs, news feed, tooltip.
import { RAIL_TYPES, TYPE, FAMILIES, costIndex, techSpeed } from './railtypes.js';
import { density, segName, rehabCost } from './network.js';
import { fmtM, loanRate, maxLoan, yearFrac, poiActive, CAPITAL } from './sim.js';
import { MODES, legendColors } from './render.js';
import { KIND, MAX_CARS, PRICE, fleetNeed } from './trayek.js';
import { BIZ, ROLES, compById, scaleEff } from './company.js';

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
const pct = (v) => (v * 100).toFixed(0) + '%';
const sgn = (v) => `<span class="${v < 0 ? 'neg' : 'pos'}">${v >= 0 ? '+' : ''}${fmtM(v)}</span>`;
const KCOL = { P: '#1565c0', K: '#3e2723', C: '#6a1b9a' };

export class UI {
  constructor(game) {
    this.g = game;
    this.tab = 'info';
    this.sel = null; // {kind:'kec'|'st'|'seg'|'tr', id}
    this.form = { biz: 'catering', bentuk: 'anak', prov: '', own: 0.51, modal: 250 };
    $('#side-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) { this.tab = b.dataset.tab; this.renderSide(); }
    });
    $('#side-body').addEventListener('click', (e) => this.onSideClick(e));
    $('#side-body').addEventListener('change', (e) => this.onSideChange(e));
    $('#palwrap').addEventListener('click', (e) => this.onPalClick(e));
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
    chip('#profit', (L.group >= 0 ? '+' : '') + fmtM(L.group || 0) + '/bln', (L.group || 0) < 0 ? 'neg' : 'pos');
    chip('#km', km.toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' km' + (building ? ` (+${building})` : ''));
    chip('#ntr', S.trayeks.filter((t) => t.active && !t.broken).length + '');
    chip('#pax', fmtN(L.pax || 0) + '/hari');
    chip('#fr', fmtN(L.fr || 0) + ' t/hari');
    chip('#pop', fmtN(L.natPop || 0));
    const eff = S.histGdp ? (L.natGdp || 0) / S.histGdp : 1;
    chip('#eff', (eff >= 1 ? '+' : '') + ((eff - 1) * 100).toFixed(1) + '%', eff >= 1 ? 'pos' : 'neg');
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === this.g.speed));
  }

  // ---------- left panel ----------
  renderPalette() {
    const g = this.g;
    if (g.tool === 'trayek') return this.renderTrayekPal();
    const S = this.S, ci = costIndex(yearFrac(S));
    let h = '';
    for (const [fam, label] of Object.entries(FAMILIES)) {
      h += `<div class="fam">${label}</div>`;
      for (const t of RAIL_TYPES.filter((x) => x.family === fam)) {
        const locked = S.y < t.year;
        const sp = Math.round(t.speed * techSpeed(t, yearFrac(S)));
        h += `<button class="rt ${g.selType === t.key ? 'on' : ''} ${locked ? 'locked' : ''}" data-type="${t.key}" title="${esc(t.desc)}">
          <i style="background:${t.color}"></i><span class="nm">${t.name}</span>
          <span class="mt">${locked ? '🔒 ' + t.year : `${sp} km/j · ${Math.round(t.cap / 400)} KA/hr · ${fmtM(t.cost * ci)}/km`}</span></button>`;
      }
    }
    $('#palette').innerHTML = h;
    const t = TYPE[g.selType];
    $('#typedesc').innerHTML = `<b>${t.name}</b><br>${esc(t.desc)}<br><span class="mt">Penumpang ×${t.pax} · Barang ×${t.freight} · Tarif ×${t.fare}${t.maxKm ? ` · maks ${t.maxKm} km` : ''}</span>`;
  }

  renderTrayekPal() {
    const g = this.g, S = this.S, d = g.draft;
    let h = `<div class="fam">Jenis trayek baru</div><div class="kinds">${Object.entries(KIND).map(([k, n]) => `<button data-kind="${k}" class="${g.trayekKind === k ? 'on' : ''}"><i style="background:${KCOL[k]}"></i>${n}</button>`).join('')}</div>
      <p class="mt pad">Klik stasiun-stasiun pemberhentian berurutan. Rute dicari lewat rel yang sudah jadi (kargo tidak bisa lewat rel khusus penumpang). Stasiun yang dilewati tapi tidak diklik = tidak berhenti (langsung/ekspres).
      <br><kbd>Enter</kbd>/klik kanan: selesai · <kbd>Esc</kbd>: batal · <kbd>Backspace</kbd>: hapus stop terakhir</p>`;
    if (d && d.stops.length) h += `<div class="fam">Draf (${d.stops.length} stop)</div><ol class="draft">${d.stops.map((id) => `<li>${esc(S.stById.get(id).name)}</li>`).join('')}</ol>
      <div class="row pad"><button class="btn primary" data-finish="1" ${d.stops.length < 2 ? 'disabled' : ''}>Buat trayek</button><button class="btn" data-cancel="1">Batal</button></div>`;
    h += `<div class="fam">Trayek (${S.trayeks.length})</div><ul class="trl">${S.trayeks.map((t) => this.trLi(t)).join('')}</ul>`;
    $('#palette').innerHTML = h;
    $('#typedesc').innerHTML = `<b>Trayek</b>: hanya penumpang/barang yang asal & tujuannya sama-sama stop di trayek ini yang naik. Trayek panjang dengan banyak stop menangkap lebih banyak pasangan asal–tujuan, tapi lebih lambat.`;
  }

  trLi(t) {
    const p = t.last?.profit || 0;
    return `<li><button class="lnk" data-tr="${t.id}"><i style="background:${KCOL[t.kind]}"></i>${t.code}</button> <span class="mt">${esc(t.name)}</span>
      <span class="${t.broken ? 'neg' : p < 0 ? 'neg' : 'pos'} r">${t.broken ? 'terputus' : !t.active ? 'berhenti' : fmtM(p)}</span></li>`;
  }

  onPalClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const g = this.g;
    if (b.dataset.kind) { g.trayekKind = b.dataset.kind; g.cancelDraft(); this.renderPalette(); }
    else if (b.dataset.finish) g.finishDraft();
    else if (b.dataset.cancel) g.cancelDraft();
    else if (b.dataset.tr) this.selectTr(+b.dataset.tr);
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
  selectTr(id) {
    this.select({ kind: 'tr', id });
    const t = this.S.trayeks.find((x) => x.id === id);
    if (t) this.g.focusTrayek(t);
  }

  renderSide(force = true) {
    const body = $('#side-body');
    if (!force && body.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    document.querySelectorAll('#side-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const top = body.scrollTop;
    const fn = { info: () => this.infoHtml(), tr: () => this.trListHtml(), co: () => this.coHtml(), fin: () => this.finHtml(), stat: () => this.statHtml() }[this.tab];
    body.innerHTML = fn();
    body.scrollTop = top;
    if (this.tab === 'stat') this.drawCharts();
    this.g.map.trayekHi = this.sel && this.sel.kind === 'tr' ? this.S.trayeks.find((t) => t.id === this.sel.id) : null;
  }

  infoHtml() {
    const sel = this.sel, S = this.S;
    if (!sel) return `<div class="empty"><h3>Selamat datang, Kepala Djawatan!</h3>
      <p>Bangun rel, lalu jalankan <b>trayek</b> di atasnya. Uang datang dari trayek, bukan dari rel.</p>
      <ol><li><b>🛤️ Bangun</b>: pilih jenis rel, klik kecamatan asal lalu tujuan.</li>
      <li><b>🚆 Trayek</b>: pilih Penumpang/Kargo/Campur, klik stasiun-stasiun pemberhentian, Enter. Atur frekuensi & jumlah gerbong — ada trayek yang untung, ada yang rugi.</li>
      <li><b>🏢 Perusahaan</b>: dirikan anak usaha (catering, alih daya, perawatan, konstruksi, parkir, properti, logistik) atau JV dengan pemda, lalu serahkan trayek atau kontrak peran ke mereka.</li>
      <li>Kargo mengikuti industri setempat: pelabuhan ⚓, tambang ⛏, pabrik 🏭 dan kawasan manufaktur. Coba Tj. Priok–Bekasi, atau batubara Muara Enim–Panjang (Babaranjang).</li></ol>
      <p class="mt">Spasi: jeda · 1/2/3: kecepatan · B: bangun · T: trayek · I: inspeksi · X: bongkar · R: rehab</p></div>`;
    if (sel.kind === 'kec') return this.kecHtml(sel.id);
    if (sel.kind === 'st') { const s = S.stById.get(sel.id); return s ? this.stHtml(s) : ''; }
    if (sel.kind === 'seg') { const g = S.segById.get(sel.id); return g ? this.segHtml(g) : ''; }
    if (sel.kind === 'tr') { const t = S.trayeks.find((x) => x.id === sel.id); return t ? this.trHtml(t) : ''; }
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
      <tr><td>PDRB</td><td>Rp ${fmtM(W.grdp[k])}</td></tr>
      <tr><td>PDRB/kapita</td><td>${(inc * 1000).toFixed(1)} jt (${(inc / (ng / np)).toFixed(2)}× nasional)</td></tr>
      <tr><td>Industri & barang</td><td>${pct(W.goods[k])} dari PDRB</td></tr>
      <tr><td>Tumbuh (tahun ini)</td><td class="${g12 >= 0 ? 'pos' : 'neg'}">${g12.toFixed(2)}%</td></tr>
      <tr><td>Medan</td><td>${TER[W.terrain[k]]}${W.swamp[k] ? ', rawa' : ''} · ±${W.elev[k].toFixed(0)} m</td></tr>
      <tr><td>Aksesibilitas rel</td><td>${((W.access ? W.access[k] : 0) * 100).toFixed(0)}/100</td></tr>
      </table>
      ${pois.length ? `<h4>Fasilitas</h4><ul class="pois">${pois.map((p) => `<li>${p.name} <span class="mt">lvl ${p.level}${S.connected.includes(p.id) ? ' · ✅ tersambung' : ''}</span></li>`).join('')}</ul>` : ''}
      ${st ? `<p><button class="lnk" data-st="${st.id}">→ Stasiun ${esc(st.name)}</button></p>` : '<p class="mt">Belum ada stasiun. Bangun rel ke sini untuk membuka stasiun.</p>'}`;
  }

  stHtml(s) {
    const S = this.S, W = this.W;
    const segs = S.segs.filter((g) => g.a === s.id || g.b === s.id);
    const trs = S.trayeks.filter((t) => t.stops.includes(s.id));
    return `<h3>🚉 Stasiun ${esc(s.name)}</h3><div class="sub">${esc(W.name[s.k])}, ${esc(W.kab[s.k])}</div>
      <table class="kv"><tr><td>Penumpang naik+turun</td><td>${fmtN(s.rid)} /hari</td></tr>
      <tr><td>Barang bongkar+muat</td><td>${fmtN(s.fr)} ton/hari</td></tr>
      <tr><td>Potensi (jika semua tersambung)</td><td>${fmtN(s.pot || 0)} pnp · ${fmtN(s.potF || 0)} t</td></tr></table>
      <h4>Trayek berhenti di sini (${trs.length})</h4><ul class="trl">${trs.map((t) => this.trLi(t)).join('') || '<li class="mt">Belum ada — buat trayek dengan alat 🚆 Trayek.</li>'}</ul>
      <h4>Rel (${segs.length})</h4><ul class="segs">${segs.map((g) => `<li><button class="lnk" data-seg="${g.id}"><i style="background:${TYPE[g.type].color}"></i>${esc(segName(S, g))}</button> <span class="mt">${TYPE[g.type].name}${g.build > 0 ? ' · dibangun' : ''}</span></li>`).join('')}</ul>
      <p><button class="lnk" data-kec="${s.k}">→ Data kecamatan</button></p>
      ${segs.length ? '' : `<p><button class="btn" data-delst="${s.id}">Hapus stasiun</button></p>`}`;
  }

  segHtml(g) {
    const S = this.S, t = TYPE[g.type], y = yearFrac(S);
    const sp = t.speed * techSpeed(t, y) * (0.45 + 0.55 * g.cond);
    const capT = t.cap / 400;
    const trs = S.trayeks.filter((x) => x.legs.some((l) => l.includes(g.id)));
    return `<h3><i class="sw" style="background:${t.color}"></i>${esc(segName(S, g))}</h3><div class="sub">${t.name}</div>
      ${g.build > 0 ? `<div class="prog"><div style="width:${(100 * (1 - g.build / Math.max(1, g.total))).toFixed(0)}%"></div></div><p>Dalam pembangunan — selesai ${g.build} bulan lagi.</p>` : ''}
      <table class="kv">
      <tr><td>Panjang</td><td>${g.km.toFixed(1)} km</td></tr>
      <tr><td>Kecepatan efektif</td><td>${sp.toFixed(0)} km/j · ${(g.km / sp * 60).toFixed(0)} menit</td></tr>
      <tr><td>Kondisi</td><td class="${g.cond < 0.5 ? 'neg' : ''}">${pct(g.cond)}</td></tr>
      <tr><td>Kereta/hari</td><td class="${(g.trains || 0) > capT ? 'neg' : ''}">${(g.trains || 0).toFixed(0)} / ${capT.toFixed(0)}${(g.trains || 0) > capT ? ' — macet! upgrade' : ''}</td></tr>
      <tr><td>Penumpang lewat</td><td>${fmtN(g.loadP || 0)} /hari</td></tr>
      <tr><td>Barang lewat</td><td>${fmtN(g.loadF || 0)} t/hari</td></tr>
      <tr><td>Potensi pasar</td><td>${fmtN(g.potP || 0)} pnp · ${fmtN(g.potF || 0)} t</td></tr>
      <tr><td>Perawatan</td><td>Rp ${fmtM(g.km * t.maint * costIndex(y) / 12)}/bln</td></tr>
      </table>
      <h4>Trayek lewat (${trs.length})</h4><ul class="trl">${trs.map((x) => this.trLi(x)).join('') || '<li class="mt">Rel nganggur — tidak menghasilkan apa-apa.</li>'}</ul>
      <div class="row">
      ${g.build <= 0 && g.cond < 0.98 ? `<button class="btn" data-rehab="${g.id}">🔧 Rehabilitasi (Rp ${fmtM(rehabCost(S, g))})</button>` : ''}
      <button class="btn danger" data-demo="${g.id}">🧨 Bongkar</button></div>
      <p class="mt">Upgrade: bangun jenis rel lain di keluarga yang sama (${FAMILIES[t.family]}) di antara dua stasiun ini — potongan 50%. Trayek otomatis pindah ke rel baru.</p>`;
  }

  // ---------- trayek ----------
  operators(t) {
    const S = this.S, W = this.W;
    return S.companies.filter((c) => c.biz === 'kereta' && (c.kind !== 'jv' || t.stops.every((id) => W.prov[S.stById.get(id).k] === c.prov)));
  }

  trHtml(t) {
    const S = this.S, W = this.W, L = t.last || {}, geo = t.geo;
    const ci = costIndex(S.y);
    const op = compById(S, t.op);
    const roles = Object.keys(ROLES).filter((r) => !ROLES[r].pax || t.kind !== 'K');
    const provOpts = (r) => {
      const subs = S.companies.filter((c) => BIZ[c.biz].role && BIZ[c.biz].role.includes(r));
      const v = t.roles[r];
      return `<select data-role="${r}"><option value="self" ${v === 'self' ? 'selected' : ''}>Mandiri (${esc(op.name)})</option>
        <option value="vendor" ${v === 'vendor' ? 'selected' : ''}>Vendor pihak ketiga</option>
        ${subs.map((c) => `<option value="${c.id}" ${v === c.id ? 'selected' : ''}>${BIZ[c.biz].icon} ${esc(c.name)}</option>`).join('')}</select>`;
    };
    const stepper = (key, val, label, unit) => `<div class="step"><span>${label}</span><button data-cfg="${key}" data-d="-1">−</button><b>${val}</b><button data-cfg="${key}" data-d="1">+</button><span class="mt">${unit}</span></div>`;
    const need = geo ? fleetNeed(geo, t.freq, t.gp, t.gb) : t.fleet;
    const lines = Object.entries(L.L || {}).sort((a, b) => b[1] - a[1]);
    return `<h3><i class="sw" style="background:${KCOL[t.kind]}"></i>${t.code} · ${KIND[t.kind]}</h3>
      <input class="nm" data-name="1" value="${esc(t.name)}">
      ${t.broken ? '<p class="neg">⚠️ Trayek terputus: ada ruas rel yang dibongkar. Hapus dan buat ulang.</p>' : ''}
      <div class="sub">${t.stops.length} stop · ${geo ? geo.km.toFixed(0) + ' km · ' + fmtDur(geo.time) : '—'} · ${esc(op.name)}</div>
      <div class="stops">${t.stops.map((id) => esc(S.stById.get(id).name)).join(' → ')}</div>
      <h4>Layanan</h4>
      ${stepper('freq', t.freq, 'Perjalanan', '/hari/arah')}
      ${t.kind !== 'K' ? stepper('gp', t.gp, 'Gerbong penumpang', `× ${geo ? geo.capP : 80} kursi`) : ''}
      ${t.kind !== 'P' ? stepper('gb', t.gb, 'Gerbong barang', `× ${geo ? geo.capF : 40} ton`) : ''}
      <div class="row"><button class="btn" data-suggest="1">✨ Sesuaikan dengan permintaan</button>
      <button class="btn" data-toggle="1">${t.active ? '⏸ Hentikan' : '▶ Jalankan'}</button></div>
      <table class="kv">
      <tr><td>Sarana</td><td>${need.R} rangkaian · ${need.cp + need.cb} gerbong</td></tr>
      <tr><td>Kapasitas/arah</td><td>${t.kind !== 'K' ? fmtN(t.capP || 0) + ' pnp' : ''}${t.kind === 'C' ? ' · ' : ''}${t.kind !== 'P' ? fmtN(t.capF || 0) + ' t' : ''}/hari</td></tr>
      ${t.cong < 0.999 ? `<tr><td>Rel macet</td><td class="neg">hanya ${pct(t.cong)} perjalanan bisa jalan</td></tr>` : ''}
      </table>
      <h4>Kinerja bulan lalu</h4>
      <table class="kv">
      ${t.kind !== 'K' ? `<tr><td>Penumpang</td><td>${fmtN(L.pax || 0)}/hari · okupansi ${pct(L.lfP || 0)}</td></tr>
      <tr><td>Permintaan puncak</td><td>${fmtN(L.loadP || 0)}/hari per arah</td></tr>` : ''}
      ${t.kind !== 'P' ? `<tr><td>Barang</td><td>${fmtN(L.fr || 0)} t/hari · muat ${pct(L.lfF || 0)}</td></tr>
      <tr><td>Permintaan puncak</td><td>${fmtN(L.loadF || 0)} t/hari per arah</td></tr>` : ''}
      ${lines.map(([k, v]) => `<tr><td>${k}</td><td>${sgn(v)}</td></tr>`).join('')}
      <tr><td><b>Laba trayek</b></td><td><b>${sgn(L.profit || 0)}</b>/bln</td></tr>
      </table>
      <h4>Operator</h4>
      <select data-op="1">${this.operators(t).map((c) => `<option value="${c.id}" ${c.id === t.op ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <p class="mt">Sarana ikut pindah. Anak usaha/JV membayar track access charge ke induk. JV hanya untuk trayek yang semua stopnya di provinsi JV, dan mendapat PSO pemda per penumpang-km.</p>
      <h4>Peran & alih daya</h4>
      <table class="kv roles">${roles.map((r) => `<tr><td>${ROLES[r].name}</td><td>${provOpts(r)}</td></tr>`).join('')}</table>
      <p class="mt">Mandiri: mutu terbaik, tapi makin banyak trayek makin mahal (birokrasi). Vendor: 12% lebih murah, mutu sedikit turun. Anak usaha sendiri: margin tetap di grup dan makin efisien makin banyak kontrak.</p>
      <div class="row"><button class="btn danger" data-deltr="1">Hapus trayek (jual sarana 40%)</button></div>`;
  }

  trListHtml() {
    const S = this.S;
    const trs = [...S.trayeks].sort((a, b) => (b.last?.profit || 0) - (a.last?.profit || 0));
    const tot = trs.reduce((a, t) => a + (t.last?.profit || 0), 0);
    const busy = S.segs.filter((g) => g.build <= 0 && g.trains > TYPE[g.type].cap / 400).sort((a, b) => b.trains / TYPE[b.type].cap - a.trains / TYPE[a.type].cap).slice(0, 10);
    const idle = S.segs.filter((g) => g.build <= 0 && !g.ntr).length;
    return `<h3>Trayek</h3><div class="sub">${trs.length} trayek · laba total ${sgn(tot)}/bln</div>
      <p><button class="btn primary" data-newtr="1">🚆 Buat trayek baru</button></p>
      <ul class="trl">${trs.map((t) => this.trLi(t)).join('')}</ul>
      ${busy.length ? `<h4>Rel macet</h4><ul class="segs">${busy.map((g) => `<li><button class="lnk" data-seg="${g.id}"><i style="background:${TYPE[g.type].color}"></i>${esc(segName(S, g))}</button> <span class="neg">${g.trains.toFixed(0)}/${(TYPE[g.type].cap / 400).toFixed(0)} KA</span></li>`).join('')}</ul>` : ''}
      <p class="mt">${idle} ruas rel tidak dilewati trayek mana pun.</p>`;
  }

  // ---------- companies ----------
  coHtml() {
    const S = this.S, W = this.W, f = this.form, ci = costIndex(S.y);
    const provs = [...new Set(W.prov)].filter(Boolean).sort();
    if (!f.prov) f.prov = provs.includes('Jawa Barat') ? 'Jawa Barat' : provs[0];
    const card = (c) => {
      const L = c.last || {};
      const ntr = S.trayeks.filter((t) => t.op === c.id).length;
      const nct = S.trayeks.reduce((a, t) => a + Object.values(t.roles).filter((p) => p === c.id).length, 0);
      const kind = c.kind === 'induk' ? 'Induk' : c.kind === 'jv' ? `JV ${pct(c.own)} · Pemprov ${esc(c.prov)} ${pct(1 - c.own)}` : 'Anak usaha 100%';
      const cash = c.kind === 'induk' ? S.cash : c.cash;
      return `<div class="co ${c.kind}"><div class="ch"><span class="ic">${BIZ[c.biz].icon}</span><div><b>${esc(c.name)}</b><div class="mt">${BIZ[c.biz].name} · ${kind}</div></div></div>
        <table class="kv"><tr><td>Kas</td><td>Rp ${fmtM(cash)}</td></tr>
        <tr><td>Pendapatan / laba bln lalu</td><td>${fmtM(L.revenue || 0)} / ${sgn(L.profit || 0)}</td></tr>
        ${ntr ? `<tr><td>Trayek dioperasikan</td><td>${ntr}</td></tr>` : ''}
        ${BIZ[c.biz].role ? `<tr><td>Kontrak peran</td><td>${nct} · efisiensi ${pct(1 - scaleEff(nct))}</td></tr>` : ''}</table>
        ${c.kind === 'induk' ? '' : `<div class="row"><button class="btn" data-inject="${c.id}">Setor Rp ${fmtM(100 * ci)}</button><button class="btn" data-div="${c.id}" ${cash <= 0 ? 'disabled' : ''}>Tarik dividen</button>${!ntr && !nct ? `<button class="btn danger" data-close="${c.id}">Bubarkan</button>` : ''}</div>`}</div>`;
    };
    const ind = S.companies[0];
    const subs = S.companies.slice(1);
    return `<h3>Struktur Perusahaan</h3><div class="sub">Laba grup (porsi kita) bulan lalu: ${sgn(S.groupProfit || 0)}</div>
      ${card(ind)}
      <div class="tree">${subs.map(card).join('') || '<p class="mt">Belum ada anak usaha.</p>'}</div>
      <h4>Dirikan perusahaan baru</h4>
      <div class="form">
      <label>Bidang <select data-f="biz">${Object.entries(BIZ).map(([k, b]) => `<option value="${k}" ${f.biz === k ? 'selected' : ''}>${b.icon} ${b.name}</option>`).join('')}</select></label>
      <p class="mt">${esc(BIZ[f.biz].desc)}</p>
      ${f.biz === 'kereta' ? `<label>Bentuk <select data-f="bentuk"><option value="anak" ${f.bentuk === 'anak' ? 'selected' : ''}>Anak usaha 100%</option><option value="jv" ${f.bentuk === 'jv' ? 'selected' : ''}>JV dengan pemda</option></select></label>` : ''}
      ${f.biz === 'kereta' && f.bentuk === 'jv' ? `<label>Provinsi <select data-f="prov">${provs.map((p) => `<option ${p === f.prov ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label>Saham kita <select data-f="own">${[0.51, 0.6, 0.7, 0.8].map((o) => `<option value="${o}" ${f.own == o ? 'selected' : ''}>${pct(o)}</option>`).join('')}</select></label>
        <p class="mt">Pemprov menyetor modal sebanding sahamnya dan memberi PSO per penumpang-km. Laba dibagi sesuai saham.</p>` : ''}
      <label>Modal dari induk <select data-f="modal">${[100, 250, 500, 1000, 2500].map((m) => `<option value="${m}" ${f.modal == m ? 'selected' : ''}>Rp ${fmtM(m * ci)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary" data-found="1">Dirikan</button></div></div>`;
  }

  finHtml() {
    const S = this.S, y = yearFrac(S), ind = S.companies[0], L = ind.last || {};
    const ml = maxLoan(S), chunk = Math.round(500 * costIndex(y));
    const row = (a, b, cls = '') => `<tr><td>${a}</td><td class="${cls}">${b}</td></tr>`;
    const items = Object.entries(L).filter(([k]) => !['revenue', 'profit'].includes(k));
    const op = items.filter(([k]) => !CAPITAL.has(k)).sort((a, b) => b[1] - a[1]);
    const cap = items.filter(([k]) => CAPITAL.has(k));
    return `<h3>Keuangan Induk</h3><div class="sub">Bulan lalu (Rp, harga konstan 2026)</div>
      <table class="kv">${op.map(([k, v]) => row(k, sgn(v))).join('')}
      ${row('<b>Laba induk</b>', '<b>' + sgn(L.profit || 0) + '</b>')}
      ${row('Laba grup (porsi kita)', sgn(S.groupProfit || 0))}</table>
      ${cap.length ? `<h4>Arus modal</h4><table class="kv">${cap.map(([k, v]) => row(k, sgn(v))).join('')}</table>` : ''}
      <h4>Kas & pinjaman</h4><table class="kv">
      ${row('Kas induk', 'Rp ' + fmtM(S.cash), S.cash < 0 ? 'neg' : '')}
      ${row('Pinjaman', 'Rp ' + fmtM(S.loan))}
      ${row('Suku bunga', (loanRate(y) * 100).toFixed(0) + '%/thn')}
      ${row('Batas pinjaman', 'Rp ' + fmtM(ml))}
      ${row('Indeks biaya', costIndex(y).toFixed(2) + '× (2026 = 1)')}
      </table>
      <div class="row"><button class="btn" data-loan="${chunk}" ${S.loan + chunk > ml ? 'disabled' : ''}>Pinjam Rp ${fmtM(chunk)}</button>
      <button class="btn" data-repay="${chunk}" ${S.loan <= 0 || S.cash <= 0 ? 'disabled' : ''}>Bayar Rp ${fmtM(Math.min(chunk, S.loan))}</button></div>
      <h4>Lalu lintas</h4><table class="kv">
      ${row('Penumpang terangkut', fmtN(S.last?.pax || 0) + '/hari')}
      ${row('Potensi pasar (semua tersambung)', fmtN(S.last?.potPax || 0) + '/hari')}
      ${row('Barang', fmtN(S.last?.fr || 0) + ' ton/hari')}
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
      <div class="chart"><div class="ct">Barang per tahun (ton)</div><canvas data-key="fr"></canvas></div>
      <div class="chart"><div class="ct">Laba grup per tahun (Rp miliar)</div><canvas data-key="profit"></canvas></div>
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
      const series = key === 'gdp' ? [H.map((r) => r.gdp), H.map((r) => r.hist)] : [H.map((r) => key === 'cov' ? r.cov * 100 : r[key] || 0)];
      const cols = ['#b25a36', '#78909c'];
      const lo = Math.min(0, ...series.flat()), hi = Math.max(...series.flat()) || 1;
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

  onSideChange(e) {
    const el = e.target, d = el.dataset, g = this.g, S = this.S;
    const t = this.sel && this.sel.kind === 'tr' ? S.trayeks.find((x) => x.id === this.sel.id) : null;
    if (d.f) { this.form[d.f] = el.value; this.renderSide(); return; }
    if (!t) return;
    if (d.name) { t.name = el.value.slice(0, 60); this.renderPalette(); }
    else if (d.op) g.setOperator(t, +el.value);
    else if (d.role) { t.roles[d.role] = el.value === 'self' || el.value === 'vendor' ? el.value : +el.value; this.news(`${t.code}: ${ROLES[d.role].name} → ${el.options[el.selectedIndex].text}`); }
  }

  onSideClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset, g = this.g, S = this.S;
    const t = this.sel && this.sel.kind === 'tr' ? S.trayeks.find((x) => x.id === this.sel.id) : null;
    if (d.seg) { const seg = S.segById.get(+d.seg); this.select({ kind: 'seg', id: +d.seg }); if (seg) g.focusSeg(seg); }
    else if (d.st) { const s = S.stById.get(+d.st); this.select({ kind: 'st', id: +d.st }); if (s) g.focusKec(s.k); }
    else if (d.tr) this.selectTr(+d.tr);
    else if (d.kec) this.select({ kind: 'kec', id: +d.kec });
    else if (d.rehab) g.rehab(S.segById.get(+d.rehab));
    else if (d.demo) g.demolish(S.segById.get(+d.demo));
    else if (d.delst) g.deleteStation(S.stById.get(+d.delst));
    else if (d.cfg && t) g.stepTrayek(t, d.cfg, +d.d);
    else if (d.suggest && t) g.suggestTrayek(t);
    else if (d.toggle && t) { t.active = !t.active; this.renderSide(); }
    else if (d.deltr && t) g.deleteTrayek(t);
    else if (d.newtr) g.setTool('trayek');
    else if (d.found) g.foundCompany(this.form);
    else if (d.inject) g.injectCompany(+d.inject);
    else if (d.div) g.dividendCompany(+d.div);
    else if (d.close) g.closeCompany(+d.close);
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
      <b class="${plan.cost > this.S.cash ? 'neg' : ''}">Rp ${fmtM(plan.cost)}</b>${plan.upgradeOf ? ' <span class="pos">(upgrade, potongan 50%)</span>' : ''}${plan.kons ? ' <span class="pos">(anak usaha konstruksi −8%)</span>' : ''}${plan.newB ? ' · stasiun baru' : ''}`;
  }
}

export function fmtDur(h) { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} m` : `${m} m`; }
