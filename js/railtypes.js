// Every kind of rail the player can build. Money is Rp miliar (2026 prices) per km,
// multiplied by costIndex(year). Speeds are average line speeds in km/h, capacity is
// load units per day (1 unit = 1 passenger or 1 tonne of freight).
//
// terrain: cost multiplier by kecamatan terrain [lowland, coastal lowland, hills, mountains]
// mode:    'route'  = follows land through neighbouring kecamatan (A*)
//          'direct' = straight line (urban, aerial, sea crossings), limited by maxKm
// family:  building the same family between the same two stations replaces (upgrades) it
export const FAMILIES = {
  intercity: 'Antarkota',
  fast: 'Kecepatan Tinggi',
  urban: 'Perkotaan',
  special: 'Khusus',
};

export const RAIL_TYPES = [
  // ---- Antarkota ----
  { key: 'lori', name: 'Lori / Decauville 600 mm', family: 'intercity', year: 1945, speed: 22, cap: 2500, cost: 3,
    terrain: [1, 1, 1.7, 3.2], pax: 0.4, freight: 0.8, fare: 0.7, maint: 0.02, months: [2, 0.05], color: '#a1887f', width: 1.4, dash: [3, 3],
    desc: 'Rel sempit murah ala lori tebu dan perkebunan. Lambat, kapasitas kecil, cocok buat mengumpulkan hasil bumi.' },
  { key: 'konv', name: 'Rel Konvensional 1067 mm', family: 'intercity', year: 1945, speed: 45, cap: 15000, cost: 14,
    terrain: [1, 1.05, 1.9, 3.6], pax: 1, freight: 1, fare: 1, maint: 0.12, months: [4, 0.12], color: '#5d4037', width: 2.2,
    desc: 'Rel tunggal sepur Cape gauge, tulang punggung warisan SS/NIS. Kecepatan naik saat era diesel (1953) dan modernisasi (1985).' },
  { key: 'krl', name: 'KRL Listrik (Commuter)', family: 'intercity', year: 1950, speed: 55, cap: 60000, cost: 40,
    terrain: [1, 1.05, 2, 4], pax: 1.5, freight: 0, fare: 0.8, maint: 0.35, months: [6, 0.2], color: '#d32f2f', width: 2.6, maxKm: 140, urbanEnd: 1,
    desc: 'Kereta listrik komuter berkapasitas besar. Minimal satu ujung harus kawasan padat. Pendorong utama pertumbuhan pinggiran kota.' },
  { key: 'ganda', name: 'Rel Ganda 1067 mm', family: 'intercity', year: 1958, speed: 70, cap: 45000, cost: 30,
    terrain: [1, 1.05, 1.9, 3.6], pax: 1, freight: 1, fare: 1.05, maint: 0.25, months: [6, 0.18], color: '#3e2723', width: 3.2,
    desc: 'Jalur ganda: kapasitas berlipat dan perjalanan lebih cepat tanpa menunggu persilangan.' },
  { key: 'standar', name: 'Rel Standar 1435 mm', family: 'intercity', year: 1962, speed: 100, cap: 45000, cost: 38,
    terrain: [1, 1.05, 1.8, 3.2], pax: 1, freight: 1.25, fare: 1.15, maint: 0.3, months: [8, 0.2], color: '#1565c0', width: 3,
    desc: 'Lebar sepur internasional. Lebih cepat dan muatan gandar lebih berat — bagus untuk barang dan penumpang.' },
  { key: 'berat', name: 'Rel Angkutan Berat (Heavy Haul)', family: 'intercity', year: 1978, speed: 60, cap: 60000, cost: 42,
    terrain: [1, 1.05, 2, 3.8], pax: 0.05, freight: 2.6, fare: 0.9, maint: 0.35, months: [8, 0.2], color: '#212121', width: 3.6,
    desc: 'Khusus batubara, mineral dan peti kemas. Pendapatan barang besar bila tersambung ke tambang dan pelabuhan.' },
  { key: 'semicepat', name: 'Kereta Semi-Cepat 160 km/j', family: 'intercity', year: 1990, speed: 140, cap: 50000, cost: 75,
    terrain: [1, 1.05, 1.7, 2.9], pax: 1.2, freight: 0.6, fare: 1.35, maint: 0.5, months: [10, 0.25], color: '#00838f', width: 3,
    desc: 'Rel ganda elektrifikasi dengan kecepatan 160 km/j, bersaing ketat dengan bus dan mobil.' },
  // ---- Kecepatan tinggi ----
  { key: 'hsr', name: 'Kereta Cepat (Shinkansen/HSR)', family: 'fast', year: 1972, speed: 260, cap: 60000, cost: 420,
    terrain: [1, 1.1, 1.5, 2.3], pax: 1.4, freight: 0, fare: 2.2, maint: 2, months: [24, 0.35], color: '#f9a825', width: 3.4,
    desc: 'Jalur khusus 300+ km/j. Mahal, tapi merebut pangsa penerbangan jarak menengah.' },
  { key: 'maglev', name: 'Maglev', family: 'fast', year: 2004, speed: 420, cap: 30000, cost: 850,
    terrain: [1, 1.1, 1.4, 2], pax: 1.4, freight: 0, fare: 2.8, maint: 3.5, months: [30, 0.4], color: '#8e24aa', width: 3.4,
    desc: 'Kereta levitasi magnetik. Super cepat, super mahal.' },
  { key: 'hyperloop', name: 'Hyperloop (eksperimental)', family: 'fast', year: 2032, speed: 750, cap: 18000, cost: 1300,
    terrain: [1, 1.1, 1.3, 1.8], pax: 1.3, freight: 0.2, fare: 3.2, maint: 5, months: [36, 0.4], color: '#e91e63', width: 3, dash: [8, 3],
    desc: 'Kapsul dalam tabung hampa udara. Teknologi masa depan.' },
  // ---- Perkotaan ----
  { key: 'trem', name: 'Trem Kota', family: 'urban', year: 1945, speed: 16, cap: 9000, cost: 8,
    terrain: [1, 1, 1.6, 3], pax: 1.6, freight: 0, fare: 0.6, maint: 0.1, months: [3, 0.1], color: '#ef6c00', width: 1.8, maxKm: 30, urbanEnd: 2, direct: true,
    desc: 'Trem jalanan seperti Batavia dan Surabaya tempo dulu. Murah, untuk dalam kota.' },
  { key: 'monorel', name: 'Monorel', family: 'urban', year: 1962, speed: 40, cap: 28000, cost: 180,
    terrain: [1, 1, 1.4, 2.4], pax: 1.8, freight: 0, fare: 1, maint: 0.9, months: [12, 0.4], color: '#00acc1', width: 2.4, maxKm: 40, urbanEnd: 2, direct: true,
    desc: 'Rel tunggal layang. Hemat lahan, cocok di koridor padat.' },
  { key: 'mrt', name: 'MRT / Metro Bawah Tanah', family: 'urban', year: 1968, speed: 42, cap: 140000, cost: 1100,
    terrain: [1, 1.15, 1.3, 1.8], pax: 2.2, freight: 0, fare: 1, maint: 4, months: [24, 0.9], color: '#0d47a1', width: 3, maxKm: 60, urbanEnd: 2, direct: true,
    desc: 'Metro bawah tanah berkapasitas raksasa. Mahal, tapi mendongkrak kepadatan dan ekonomi kota.' },
  { key: 'agt', name: 'People Mover / AGT', family: 'urban', year: 1975, speed: 35, cap: 15000, cost: 160,
    terrain: [1, 1, 1.4, 2.4], pax: 1.6, freight: 0, fare: 1, maint: 0.8, months: [10, 0.5], color: '#7cb342', width: 2.2, maxKm: 15, direct: true,
    desc: 'Kereta otomatis tanpa masinis. Bonus besar bila menyambung bandara ke kota.' },
  { key: 'lrt', name: 'LRT (Light Rail)', family: 'urban', year: 1978, speed: 45, cap: 50000, cost: 260,
    terrain: [1, 1, 1.4, 2.4], pax: 2, freight: 0, fare: 1, maint: 1, months: [14, 0.5], color: '#2e7d32', width: 2.6, maxKm: 60, urbanEnd: 1, direct: true,
    desc: 'Kereta ringan layang. Menjangkau kota satelit.' },
  // ---- Khusus ----
  { key: 'gigi', name: 'Rel Bergigi (Rack)', family: 'special', year: 1945, speed: 18, cap: 3000, cost: 32,
    terrain: [1.3, 1.3, 1, 1.05], pax: 1, freight: 0.9, fare: 1.2, maint: 0.4, months: [6, 0.3], color: '#6d4c41', width: 2.2, dash: [6, 2, 1, 2], maxKm: 70,
    desc: 'Rel gigi seperti Ambarawa dan Padang Panjang. Mendaki pegunungan tanpa biaya terowongan.' },
  { key: 'funikular', name: 'Funikular', family: 'special', year: 1945, speed: 14, cap: 2500, cost: 55,
    terrain: [3, 3, 1, 0.8], pax: 1.2, freight: 0, fare: 2, maint: 0.6, months: [6, 0.6], color: '#c2185b', width: 2, dash: [2, 2], maxKm: 6, direct: true, tourism: 1,
    desc: 'Kereta kabel di lereng curam. Menghidupkan wisata pegunungan.' },
  { key: 'gantung', name: 'Kereta Gantung (Cable Car)', family: 'special', year: 1972, speed: 18, cap: 3000, cost: 45,
    terrain: [1, 1, 1, 1], pax: 1.2, freight: 0, fare: 2.2, maint: 0.5, months: [6, 0.6], color: '#ad1457', width: 1.6, dash: [1, 3], maxKm: 10, direct: true, sea: true, tourism: 1,
    desc: 'Kabin gantung melintasi lembah, sungai, bahkan selat sempit. Daya tarik wisata.' },
  { key: 'ferry', name: 'Kapal Feri Kereta (Train Ferry)', family: 'special', year: 1955, speed: 16, cap: 6000, cost: 2.5,
    terrain: [1, 1, 1, 1], pax: 1, freight: 1, fare: 0.9, maint: 0.05, months: [8, 0.02], color: '#0288d1', width: 1.6, dash: [10, 6], maxKm: 200, direct: true, sea: true, coastEnds: true,
    desc: 'Gerbong naik kapal menyeberang selat. Kedua ujung harus kecamatan pesisir. Biaya utama di dermaga.' , fixed: 600 },
  { key: 'laut', name: 'Jembatan / Terowongan Laut', family: 'special', year: 1988, speed: 110, cap: 35000, cost: 950,
    terrain: [1, 1, 1, 1], pax: 1, freight: 1.1, fare: 1.4, maint: 3, months: [36, 1.2], color: '#37474f', width: 3.6, maxKm: 45, direct: true, sea: true,
    desc: 'Sambungan rel permanen antarpulau (mis. Selat Sunda, Selat Bali, Madura).' },
];

export const TYPE = Object.fromEntries(RAIL_TYPES.map((t) => [t.key, t]));

// Labour and materials were far cheaper early on (2026 = 1.0).
const COST_INDEX = [[1945, 0.4], [1975, 0.6], [2000, 0.8], [2026, 1.0], [2045, 1.1]];
export function costIndex(year) { return interp(COST_INDEX, year); }

// Steam -> diesel -> modern signalling raise the speed of older rail types.
export function techSpeed(type, year) {
  if (type.family !== 'intercity' || type.key === 'semicepat') return 1;
  let m = 1;
  if (year >= 1953) m *= 1.25; // dieselisasi
  if (year >= 1985) m *= 1.12; // persinyalan elektrik
  if (year >= 2010) m *= 1.1;
  return m;
}

// Average door-to-door speed of the competing modes.
export function roadSpeed(year) { return interp([[1945, 18], [1960, 26], [1975, 38], [1990, 48], [2010, 55], [2025, 65], [2045, 72]], year); }
export function airAvailable(year) { return year >= 1952; }

export function interp(tbl, x) {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return tbl[tbl.length - 1][1];
}
