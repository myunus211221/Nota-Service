# Nota Service - GitHub Pages + Apps Script

Struktur:

- `docs/` - tampilan admin (`index.html`) dan halaman pelacakan konsumen (`tracking.html`), di-host oleh **GitHub Pages**.
- `apps-script/` - backend (Google Apps Script + Spreadsheet). Dipanggil dari `docs/` lewat `fetch`.
- `.github/workflows/deploy-apps-script.yml` - deploy otomatis folder `apps-script/` ke Apps Script saat `git push`.

Alur: konsumen/admin membuka `https://USERNAME.github.io/NAMA-REPO/` -> tampilan memanggil URL `/exec` Apps Script -> data dibaca/ditulis di Spreadsheet.

## 1. Buat repo dan unggah

1. Di GitHub: **New repository**, mis. `nota-service`. Boleh publik: tidak ada password/ID spreadsheet di dalam kode.
2. Unggah seluruh isi folder ini (atau `git init`, `git add .`, `git commit`, `git remote add origin ...`, `git push -u origin main`).

## 2. Deploy backend (pertama kali, manual)

1. Buka [script.google.com](https://script.google.com) dan buka proyek Nota Service Anda yang sudah ada (atau buat proyek baru).
2. Ganti `Code.gs` dengan `apps-script/Code.gs`, dan isi `appsscript.json` dengan `apps-script/appsscript.json`. Hapus file `Index`, `Tracking`, `JavaScript`, `Styles` (tidak dipakai lagi).
3. **Project Settings > Script Properties > Add**: `SPREADSHEET_ID` = ID spreadsheet Anda (bagian antara `/d/` dan `/edit` pada URL).
4. Di `Code.gs` isi `CONFIG.PAGES_URL` dengan `https://USERNAME.github.io/NAMA-REPO/` (setelah langkah 4 di bawah Anda tahu alamat persisnya).
5. Jalankan fungsi `inisialisasiDatabase` sekali. Bila admin belum ada: isi `USERNAME`/`PASSWORD` di `buatAtauResetAdmin`, jalankan, lalu **kembalikan ke `GANTI_...`**.
6. **Deploy > New deployment > Web app**: Execute as **Me**, Who has access **Anyone**. Salin URL yang berakhiran `/exec`.

## 3. Hubungkan tampilan ke backend

Edit `docs/config.js`, isi `API_URL` dengan URL `/exec` tadi, lalu commit dan push.

## 4. Aktifkan GitHub Pages

Repo > **Settings > Pages** > Source: **Deploy from a branch**, Branch: `main`, folder `/docs` > Save.
Alamat web: `https://USERNAME.github.io/NAMA-REPO/` (admin) dan `.../tracking.html?id=...` (konsumen). Kembali ke langkah 2.4 untuk mengisi `PAGES_URL` bila belum.

Catatan: GitHub Pages dari repo **privat** memerlukan paket GitHub berbayar. Di paket gratis, repo harus publik.

## 5. Deploy otomatis backend (opsional)

Agar perubahan di `apps-script/` ikut terdeploy saat `git push`:

1. Di komputer Anda: `npm install -g @google/clasp@2`, lalu `clasp login`. Aktifkan Apps Script API di <https://script.google.com/home/usersettings>.
2. Isi **Secrets** repo (Settings > Secrets and variables > Actions):
   - `CLASPRC_JSON` - seluruh isi file `~/.clasprc.json` (dibuat oleh `clasp login`).
   - `SCRIPT_ID` - Apps Script: Project Settings > Script ID.
   - `DEPLOYMENT_ID` - Apps Script: Deploy > Manage deployments > ID deployment web app (supaya URL `/exec` tidak berubah).
3. Setiap push yang mengubah `apps-script/**` menjalankan workflow ini. Bisa juga dijalankan manual di tab **Actions**.

`CLASPRC_JSON` setara kunci akses akun Google Anda. Jangan dibagikan; bila bocor, cabut di <https://myaccount.google.com/permissions>.

## Catatan

- Tautan pelacakan lama (`...script.google.com/.../exec?page=tracking&id=...`) otomatis menampilkan tautan ke alamat baru bila `PAGES_URL` terisi. Tautan baru dari aplikasi langsung mengarah ke GitHub Pages.
- Halaman `docs/` memakai `noindex` agar tidak muncul di mesin pencari, tetapi alamatnya tetap bisa dibuka siapa saja yang tahu. Keamanan data tetap bergantung pada login admin dan token pelacakan acak.
- Nama toko di `docs/index.html` dan `docs/tracking.html` ditulis langsung; ubah di sana bila perlu. Data toko lain (alamat, telepon, WA) ada di `CONFIG.TOKO` pada `Code.gs`.
