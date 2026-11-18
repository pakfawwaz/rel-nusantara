// Group structure: the holding railway (induk), subsidiaries (anak usaha) and
// joint ventures with provincial governments (JV pemda). Money is Rp miliar.
import { costIndex } from './railtypes.js';

export const BIZ = {
  kereta: { name: 'Operator Kereta', icon: '🚆', desc: 'Menjalankan trayek. Anak usaha yang fokus (hanya penumpang atau hanya kargo) 7% lebih hemat biaya operasi.' },
  catering: { name: 'Catering & Restorasi', icon: '🍱', role: ['catering'], desc: 'Menjual makanan di kereta penumpang. Margin naik seiring jumlah kontrak.' },
  alihdaya: { name: 'Alih Daya (SDM)', icon: '👷', role: ['awak', 'kebersihan', 'keamanan'], desc: 'Menyediakan awak, petugas kebersihan dan keamanan untuk trayek.' },
  perawatan: { name: 'Perawatan Sarana (Balai Yasa)', icon: '🔧', role: ['perawatan'], desc: 'Merawat lokomotif dan gerbong. Mengurangi gangguan perjalanan.' },
  konstruksi: { name: 'Konstruksi', icon: '🏗️', desc: 'Membangun rel kita: biaya bangun −8%, waktu −10%. Anak usaha mendapat margin 6% dari tiap proyek.', single: true },
  parkir: { name: 'Parkir Stasiun', icon: '🅿️', desc: 'Mengelola parkir di semua stasiun. Pendapatan mengikuti jumlah penumpang naik. Tanpa ini, induk hanya dapat konsesi 25% dari vendor parkir.', single: true },
  properti: { name: 'Properti & Ritel Stasiun', icon: '🏬', desc: 'Toko dan ruang komersial di stasiun. Tanpa ini, induk hanya dapat sewa 20%.', single: true },
  logistik: { name: 'Logistik (Antar-Jemput Barang)', icon: '🚚', desc: 'Angkutan truk dari pabrik ke stasiun. Permintaan kargo grup +12% dan pendapatan per ton.', single: true },
};

export const ROLES = {
  awak: { name: 'Awak & masinis', pax: false },
  perawatan: { name: 'Perawatan sarana', pax: false },
  kebersihan: { name: 'Kebersihan', pax: true },
  keamanan: { name: 'Keamanan', pax: false },
  catering: { name: 'Catering', pax: true },
};

// Effect of each provider choice on quality and on cost (multiplier of the base role cost).
export const VENDOR = { cost: 0.88, quality: { awak: 0.98, perawatan: 0.96, kebersihan: 0.97, keamanan: 0.98, catering: 0.9 } };

export function induk(S) { return S.companies[0]; }
export function compById(S, id) { return S.companies.find((c) => c.id === id); }
export function cashOf(S, c) { return c.kind === 'induk' ? S.cash : c.cash; }
export function addCash(S, c, v) { if (c.kind === 'induk') S.cash += v; else c.cash += v; }

// Ledger: per-company monthly flows by category.
export function book(S, c, cat, v) {
  if (!v) return;
  addCash(S, c, v);
  c.led[cat] = (c.led[cat] || 0) + v;
}

export function newGroup() {
  return [{ id: 1, name: 'DKARI (Induk)', kind: 'induk', biz: 'kereta', own: 1, cash: 0, led: {}, last: {} }];
}

export function createCompany(S, { name, biz, kind, prov, own, capital }) {
  const ind = induk(S);
  if (capital > S.cash) return { ok: false, err: 'Kas induk tidak cukup untuk setoran modal.' };
  if (BIZ[biz].single && S.companies.some((c) => c.biz === biz)) return { ok: false, err: `Sudah ada anak usaha ${BIZ[biz].name}.` };
  if (kind === 'jv' && S.companies.some((c) => c.kind === 'jv' && c.prov === prov)) return { ok: false, err: `Sudah ada JV dengan Pemprov ${prov}.` };
  const id = Math.max(...S.companies.map((c) => c.id)) + 1;
  const c = { id, name, kind, biz, prov: prov || null, own: kind === 'jv' ? own : 1, cash: 0, led: {}, last: {}, founded: S.y };
  S.cash -= capital;
  ind.led['Setoran modal'] = (ind.led['Setoran modal'] || 0) - capital;
  // the province matches our capital in proportion to its stake
  c.cash = kind === 'jv' ? capital / own : capital;
  S.companies.push(c);
  return { ok: true, c };
}

// A subsidiary's own cost per unit of contract value falls as it wins more contracts.
export function scaleEff(n) { return Math.max(0.7, 0.92 - 0.06 * Math.log2(1 + n / 3)); }

export function overhead(S, c) {
  const ci = costIndex(S.y);
  if (c.kind === 'induk') return 0;
  return (c.biz === 'kereta' ? 0.5 : 0.15) * ci;
}

export function dividend(S, c, amount) {
  amount = Math.min(amount, c.cash);
  if (amount <= 0) return 0;
  c.cash -= amount;
  c.led['Dividen dibayar'] = (c.led['Dividen dibayar'] || 0) - amount;
  const ours = amount * c.own;
  S.cash += ours;
  induk(S).led['Dividen diterima'] = (induk(S).led['Dividen diterima'] || 0) + ours;
  return ours;
}

export function inject(S, c, amount) {
  amount = Math.min(amount, Math.max(0, S.cash));
  if (amount <= 0) return 0;
  S.cash -= amount;
  induk(S).led['Setoran modal'] = (induk(S).led['Setoran modal'] || 0) - amount;
  c.cash += amount;
  return amount;
}
