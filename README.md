# Rel Nusantara (1945–2045)

Game membangun jaringan kereta api di peta Indonesia per kecamatan (7.283 kecamatan).
Mulai 17 Agustus 1945 dengan jaringan warisan SS/NIS yang rusak; penduduk dan ekonomi
bergerak mengikuti rel yang kamu bangun.

## Main

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```
lalu buka http://localhost:8790. (Butuh server lokal karena data JSON dimuat via `fetch`.)

Kontrol: seret = geser, gulir = zoom, Spasi = jeda, 1/2/3 = kecepatan, B = bangun, I = inspeksi,
R = rehabilitasi, X = bongkar, F = seluruh Indonesia, Esc/klik kanan = selesai menyambung.

## Struktur

| File | Isi |
|---|---|
| `js/world.js` | Muat TopoJSON kecamatan + atribut, proyeksi ke km, Path2D, indeks spasial, titik penting |
| `js/railtypes.js` | 20 jenis rel (tahun tersedia, kecepatan, kapasitas, biaya/km per medan), indeks biaya per tahun |
| `js/network.js` | Stasiun, ruas, A* lewat graf ketetanggaan kecamatan, biaya & upgrade, jaringan 1945 |
| `js/sim.js` | Tiap bulan: model gravitasi penumpang & barang dirutekan di jaringan, kapasitas, keuangan, migrasi & pertumbuhan PDRB menurut aksesibilitas |
| `js/render.js` | Peta canvas (layer dasar di-cache + overlay rel/kereta/ikon) |
| `js/ui.js`, `js/main.js` | Panel, input, loop, simpan/muat (localStorage) |
| `js/places.js` | Bandara (perkiraan lokasi & tahun buka) dan peristiwa sejarah |
| `data/` | Data kecamatan dari proyek nusantara1950 (populasi 1950 diperkirakan, lihat DATA_NOTES di repo itu) |

Semua angka (biaya, kapasitas, elastisitas) adalah asumsi permainan dalam orde besaran yang wajar, bukan data teknik.
