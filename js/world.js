// Loads the kecamatan map and attributes, projects everything to a flat km grid,
// and builds Path2D shapes, a spatial index and the points of interest.
import { AIRPORTS } from './places.js';

const LON0 = 94.9, LAT0 = 6.3, KX = 111.2, KY = 110.6;
export function proj(lon, lat) { return [(lon - LON0) * KX, (LAT0 - lat) * KY]; }

const GOODS = [0, 1, 2, 3, 4, 5, 6]; // food..manufacturing sector indices

export async function loadWorld(onProgress) {
  const names = ['kecamatan.topo.json', 'kecamatan_geo.json', 'kecamatan_attrs.json', 'seeds.json', 'neighbors.json'];
  let done = 0;
  const [topo, geo, attrs, seeds, nbr] = await Promise.all(names.map((f) =>
    fetch('data/' + f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); })
      .then((j) => { onProgress(++done / names.length, f); return j; })));

  const n = geo.ids.length;
  const idx = new Map(geo.ids.map((id, i) => [id, i]));
  const W = {
    n, idx, ids: geo.ids,
    name: new Array(n), kab: new Array(n), prov: new Array(n),
    x: new Float32Array(n), y: new Float32Array(n),
    area: Float32Array.from(geo.area_km2), coastal: Uint8Array.from(geo.coastal),
    nbr: geo.neighbors,
    pop: new Float64Array(n), grdp: new Float64Array(n), goods: new Float32Array(n),
    urban: Float32Array.from(attrs.urban), terrain: Uint8Array.from(attrs.terrain),
    elev: Float32Array.from(attrs.elevProxy_m), swamp: Uint8Array.from(attrs.swamp),
    capital: Uint8Array.from(attrs.isCapital),
    paths: new Array(n), rings: new Array(n), bbox: new Float32Array(n * 4),
    pois: [], poisByKec: new Map(),
  };
  for (let i = 0; i < n; i++) {
    const [x, y] = proj(geo.label[0][i], geo.label[1][i]);
    W.x[i] = x; W.y[i] = y;
    // 1950 estimates rolled back to 1945: fewer people, war-damaged economy.
    W.pop[i] = attrs.population[i] * 0.95;
    W.grdp[i] = attrs.grdp_rp_million[i] * 0.85 / 1000; // Rp miliar
    let g = 0; for (const s of GOODS) g += attrs.outputShare[i][s];
    W.goods[i] = g / 10000;
  }

  // --- TopoJSON decode (quantised, delta-encoded arcs) ---
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    const out = new Float32Array(arc.length * 2);
    let ax = 0, ay = 0;
    for (let i = 0; i < arc.length; i++) {
      ax += arc[i][0]; ay += arc[i][1];
      const p = proj(ax * sx + tx, ay * sy + ty);
      out[2 * i] = p[0]; out[2 * i + 1] = p[1];
    }
    return out;
  });
  const ring = (ids) => {
    const pts = [];
    for (const a of ids) {
      const arc = arcs[a < 0 ? ~a : a], m = arc.length / 2;
      for (let j = 0; j < m; j++) {
        const jj = a < 0 ? m - 1 - j : j;
        if (j === 0 && pts.length) continue;
        pts.push(arc[2 * jj], arc[2 * jj + 1]);
      }
    }
    return Float32Array.from(pts);
  };
  W.land = new Path2D();
  for (const g of topo.objects.kec.geometries) {
    const i = idx.get(g.properties.id);
    if (i === undefined) continue;
    W.name[i] = g.properties.name;
    W.kab[i] = g.properties.kab_name.replace(/^Kabupaten /, 'Kab. ');
    W.prov[i] = g.properties.prov_name;
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    const rings = [], p = new Path2D();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const poly of polys) for (const r of poly) {
      const pts = ring(r);
      rings.push(pts);
      for (let j = 0; j < pts.length; j += 2) {
        const x = pts[j], y = pts[j + 1];
        if (j === 0) p.moveTo(x, y); else p.lineTo(x, y);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      p.closePath();
    }
    W.paths[i] = p; W.rings[i] = rings;
    W.bbox.set([x0, y0, x1, y1], i * 4);
    W.land.addPath(p);
  }
  for (let i = 0; i < n; i++) if (!W.name[i]) { W.name[i] = geo.ids[i]; W.kab[i] = ''; W.prov[i] = ''; W.paths[i] = new Path2D(); W.rings[i] = []; }

  // --- spatial grid for hit tests ---
  const CELL = 25;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx = Math.max(mx, W.bbox[i * 4 + 2]); my = Math.max(my, W.bbox[i * 4 + 3]); }
  W.width = mx; W.height = my;
  const gw = Math.ceil(mx / CELL) + 1, gh = Math.ceil(my / CELL) + 1;
  const grid = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    for (let cy = Math.floor(W.bbox[b + 1] / CELL); cy <= Math.floor(W.bbox[b + 3] / CELL); cy++)
      for (let cx = Math.floor(W.bbox[b] / CELL); cx <= Math.floor(W.bbox[b + 2] / CELL); cx++)
        if (cx >= 0 && cy >= 0 && cx < gw && cy < gh) grid[cy * gw + cx].push(i);
  }
  W.kecAt = (x, y) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return -1;
    for (const i of grid[cy * gw + cx]) {
      const b = i * 4;
      if (x < W.bbox[b] || x > W.bbox[b + 2] || y < W.bbox[b + 1] || y > W.bbox[b + 3]) continue;
      let inside = false;
      for (const r of W.rings[i]) {
        for (let j = 0, k = r.length - 2; j < r.length; k = j, j += 2) {
          const yi = r[j + 1], yk = r[k + 1];
          if ((yi > y) !== (yk > y) && x < (r[k] - r[j]) * (y - yi) / (yk - yi) + r[j]) inside = !inside;
        }
      }
      if (inside) return i;
    }
    return -1;
  };
  W.nearestKec = (x, y, maxKm = 40) => {
    let best = -1, bd = maxKm * maxKm;
    for (let i = 0; i < n; i++) {
      const d = (W.x[i] - x) ** 2 + (W.y[i] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  // --- neighbouring countries as backdrop ---
  W.foreign = new Path2D();
  for (const f of nbr.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const r of poly) {
      r.forEach(([lon, lat], j) => { const [x, y] = proj(lon, lat); if (j) W.foreign.lineTo(x, y); else W.foreign.moveTo(x, y); });
      W.foreign.closePath();
    }
  }

  // --- points of interest: ports, airports, resources, industries ---
  const addPoi = (p) => {
    if (p.k < 0) return;
    [p.x, p.y] = [W.x[p.k], W.y[p.k]];
    p.id = W.pois.length;
    W.pois.push(p);
    if (!W.poisByKec.has(p.k)) W.poisByKec.set(p.k, []);
    W.poisByKec.get(p.k).push(p);
  };
  const kecOf = (code, lonlat) => {
    if (code && idx.has(code)) return idx.get(code);
    const [x, y] = proj(lonlat[0], lonlat[1]);
    const k = W.kecAt(x, y);
    return k >= 0 ? k : W.nearestKec(x, y);
  };
  for (const p of seeds.ports) addPoi({ kind: 'port', name: 'Pelabuhan ' + p.name, level: p.level, k: kecOf(p.kec, p.lonlat), year: 1945 });
  for (const a of AIRPORTS) addPoi({ kind: 'airport', name: 'Bandara ' + a.name, level: a.level, k: kecOf(null, [a.lon, a.lat]), year: a.year, until: a.until || 9999 });
  const RES = { oil: 'Minyak', gas: 'Gas', coal: 'Batubara', tin: 'Timah', bauxite: 'Bauksit', gold: 'Emas', copper: 'Tembaga', nickel: 'Nikel', geothermal: 'Panas bumi', hydro: 'PLTA', plantation: 'Perkebunan', rice: 'Lumbung padi', sugar: 'Tebu' };
  for (const r of seeds.resources) {
    addPoi({ kind: 'resource', sub: r.type, name: (RES[r.type] || r.type) + ' ' + r.name, level: r.size || 1, k: kecOf(r.kec, r.lonlat), year: r.hidden ? (r.knownYear || 1970) : 1945 });
  }
  const IND = { refinery: 'Kilang', cement: 'Pabrik semen', sugar_mill: 'Pabrik gula', textile: 'Pabrik tekstil', tin_mine: 'Tambang timah' };
  for (const r of seeds.industries) addPoi({ kind: 'industry', sub: r.type, name: (IND[r.type] || r.type) + ' ' + r.name, level: r.capacity === 'large' ? 3 : 2, k: kecOf(r.kec, r.lonlat), year: 1945 });

  W.seedRail = seeds.rail;
  return W;
}
