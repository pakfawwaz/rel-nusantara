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
T = trayek, R = rehabilitasi, X = bongkar, Enter = selesaikan trayek, F = seluruh Indonesia, Esc/klik kanan = selesai menyambung.

Cara main singkat: bangun rel (🛤️), lalu jalankan trayek (🚆) di atasnya — pendapatan hanya datang dari trayek. Atur frekuensi & gerbong tiap trayek, serahkan trayek ke anak usaha atau JV pemda, dan pilih siapa yang mengerjakan peran (mandiri, vendor, atau anak usaha sendiri) di tab Grup.

## Struktur

| File | Isi |
|---|---|
| `js/world.js` | Muat TopoJSON kecamatan + atribut, proyeksi ke km, Path2D, indeks spasial, titik penting |
| `js/railtypes.js` | 20 jenis rel (tahun tersedia, kecepatan, kapasitas, biaya/km per medan), indeks biaya per tahun |
| `js/network.js` | Stasiun, ruas, A* lewat graf ketetanggaan kecamatan, biaya & upgrade, jaringan 1945 |
| `js/trayek.js` | Trayek: rute antar-stop di atas rel jadi, sarana (rangkaian/gerbong), permintaan asal–tujuan per trayek (penumpang dari penduduk, barang dari industri, tambang→pelabuhan), kapasitas, laba-rugi |
| `js/company.js` | Grup usaha: induk, anak usaha, JV pemda, peran (awak, perawatan, kebersihan, keamanan, catering) mandiri/vendor/anak usaha, dividen |
| `js/sim.js` | Tiap bulan: massa stasiun & potensi pasar, menjalankan trayek, pembukuan per perusahaan, migrasi, pertumbuhan PDRB & industrialisasi menurut aksesibilitas |
| `js/render.js` | Peta canvas (layer dasar di-cache + overlay rel/kereta/ikon) |
| `js/ui.js`, `js/main.js` | Panel, input, loop, simpan/muat (localStorage) |
| `js/places.js` | Bandara (perkiraan lokasi & tahun buka) dan peristiwa sejarah |
| `data/` | Data kecamatan dari proyek nusantara1950 (populasi 1950 diperkirakan, lihat DATA_NOTES di repo itu) |

Semua angka (biaya, kapasitas, elastisitas) adalah asumsi permainan dalam orde besaran yang wajar, bukan data teknik.
