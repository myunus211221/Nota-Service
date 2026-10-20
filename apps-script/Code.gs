/**
 * ============================================================
 *  NOTA SERVICE ELEKTRONIK & PELACAKAN STATUS SERVICE
 *  Backend: Google Apps Script Web App
 *  Database: Google Spreadsheet
 * ============================================================
 *
 *  CATATAN KEAMANAN PENTING
 *  - Backend ini berupa API: tampilan ada di GitHub Pages (folder docs/) dan memanggil doPost().
 *    doPost() hanya meneruskan ke fungsi pada daftar API_ di bawah. Setiap fungsi admin memanggil
 *    wajibAdmin_(token) sebagai baris pertama. Fungsi berakhiran "_" bersifat privat.
 *  - Password admin TIDAK disimpan sebagai teks biasa (hash SHA-256 + salt + iterasi).
 *  - Halaman pelacakan hanya membaca lewat token acak 40 karakter hex.
 */

// ============================================================
//  KONFIGURASI  (EDIT BAGIAN INI)
// ============================================================
var CONFIG = {
  // ID Spreadsheet sengaja TIDAK ditulis di kode (repo GitHub bisa publik).
  // Isi lewat Apps Script: Project Settings > Script Properties > tambah SPREADSHEET_ID.
  // (ID = bagian antara /d/ dan /edit pada URL Spreadsheet.)
  SPREADSHEET_ID: '',

  // URL GitHub Pages tempat tampilan di-host, contoh: 'https://USERNAME.github.io/NAMA-REPO/'
  // Dipakai untuk membuat tautan pelacakan yang dikirim ke konsumen.
  PAGES_URL: '',

  TIMEZONE: 'Asia/Jakarta',
  APP_TITLE: 'Nota Service',

  // Set true sementara jika halaman gagal dimuat: pesan error asli akan tampil di layar.
  // Setelah masalah selesai, kembalikan ke false.
  DEBUG: true,

  // Opsional. Isi dengan URL Web App berakhiran /exec jika tautan pelacakan yang dihasilkan salah.
  // Contoh: 'https://script.google.com/macros/s/XXXXXXXX/exec'
  WEB_APP_URL: '',

  // Informasi toko (tampil di nota dan halaman pelacakan)
  TOKO: {
    NAMA: 'MOBILE BIKE SERVICE PHILIPS',
    ALAMAT: 'BATAM',
    TELP: '6282285679196',
    WA: '6287787004026', // Nomor WhatsApp toko format 62xxxxxxxxxx (opsional, untuk tombol "Hubungi Kami")
    JAM_OPERASIONAL: 'Senin - Sabtu, 09.00 - 17.00 WIB)',
    CATATAN_NOTA: 'Harap membawa nota ini saat pengambilan barang.' // boleh dikosongkan
  },

  SESSION_TTL_DETIK: 21600,   // masa berlaku login admin (maks. 21600 = 6 jam)
  MAKS_GAGAL_LOGIN: 5,        // batas percobaan login gagal per username
  KUNCI_LOGIN_DETIK: 900      // lama pemblokiran setelah gagal berulang (15 menit)
};

// ============================================================
//  KONSTANTA
// ============================================================
var SHEET_SERVICE = 'Service';
var SHEET_RIWAYAT = 'RiwayatStatus';
var SHEET_ADMIN = 'Admin';

var HEADER_SERVICE = ['ID', 'Nomor Nota', 'Tanggal Masuk', 'Nama', 'No HP', 'Brand', 'Tipe', 'No Seri',
  'Status Garansi', 'Keluhan', 'Status Pengerjaan', 'Catatan Teknisi', 'Tanggal Selesai',
  'Tanggal Diambil', 'Token Pelacakan', 'Terakhir Diperbarui', 'Tanggal Pembelian'];
var KEYS_SERVICE = ['id', 'nomorNota', 'tanggalMasuk', 'nama', 'noHp', 'brand', 'tipe', 'noSeri',
  'statusGaransi', 'keluhan', 'statusPengerjaan', 'catatanTeknisi', 'tanggalSelesai',
  'tanggalDiambil', 'token', 'terakhirDiperbarui', 'tanggalPembelian'];
var HEADER_RIWAYAT = ['ID Riwayat', 'ID Service', 'Nomor Nota', 'Status Sebelumnya', 'Status Baru',
  'Tanggal dan Waktu', 'Keterangan'];
var HEADER_ADMIN = ['ID Admin', 'Username', 'Password Hash', 'Role', 'Status Akun'];

var STATUS_LIST = ['Baru Diterima', 'Proses Service', 'Konfirmasi Harga', 'Selesai Service',
  'Menunggu Diambil', 'Sudah Diambil'];
var GARANSI_LIST = ['Garansi', 'Non Garansi'];
var HASH_ITER = 2000;

var SS_CACHE_ = null;
var BASE_URL_CACHE_ = null;
var MIGRASI_OK_ = false;

// ============================================================
//  ENTRY POINT WEB APP (API)
// ============================================================
function pagesUrl_() {
  var u = String(CONFIG.PAGES_URL || '').trim();
  return u ? u.replace(/\/?$/, '/') : '';
}

/** Halaman sederhana: mengarahkan tautan lama (?page=tracking&id=...) ke GitHub Pages. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var url = pagesUrl_();
  var tujuan = '';
  if (url) {
    tujuan = (p.page === 'tracking' && /^[a-f0-9]{40}$/.test(String(p.id || '')))
      ? url + 'tracking.html?id=' + p.id : url;
  }
  var isi = tujuan
    ? 'Aplikasi berada di: <a target="_top" href="' + tujuan + '">' + tujuan + '</a>'
    : 'API Nota Service aktif. Isi CONFIG.PAGES_URL di Code.gs agar tautan mengarah ke GitHub Pages.';
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">' + isi + '</p>')
    .setTitle(CONFIG.APP_TITLE);
}

/** Fungsi yang boleh dipanggil dari tampilan (GitHub Pages). Semua mengembalikan {ok, data|error, code}. */
function daftarApi_() {
  return {
    loginAdmin: loginAdmin, logoutAdmin: logoutAdmin, cekSesi: cekSesi,
    cariService: cariService, ambilDetail: ambilDetail,
    tambahService: tambahService, editService: editService, ubahStatus: ubahStatus, hapusService: hapusService,
    buatPesanWhatsApp: buatPesanWhatsApp, ambilDataNota: ambilDataNota,
    daftarUser: daftarUser, tambahUser: tambahUser,
    ambilDataPelacakan: ambilDataPelacakan
  };
}

/** Menerima JSON {fn, args:[...]} dan mengembalikan hasil fungsi sebagai JSON. */
function doPost(e) {
  var hasil;
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}');
    var api = daftarApi_();
    var nama = String(body.fn || '');
    if (!Object.prototype.hasOwnProperty.call(api, nama) || !Array.isArray(body.args) || body.args.length > 6) {
      hasil = { ok: false, error: 'Permintaan tidak valid.', code: 'VALID' };
    } else {
      hasil = api[nama].apply(null, body.args);
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    hasil = { ok: false, error: 'Permintaan tidak valid.', code: 'VALID' };
  }
  return ContentService.createTextOutput(JSON.stringify(hasil)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  UTILITAS UMUM
// ============================================================
function gagal_(pesan, kode) {
  var e = new Error(pesan);
  e.kode = kode || 'VALID';
  throw e;
}

/** Pembungkus: semua fungsi publik mengembalikan {ok, data} atau {ok:false, error, code}. */
function tangani_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    var kode = err && err.kode ? err.kode : 'ERR';
    if (kode === 'ERR') {
      console.error(err && err.stack ? err.stack : err);
      return { ok: false, error: 'Terjadi kesalahan pada server. Silakan coba lagi.', code: 'ERR' };
    }
    return { ok: false, error: err.message, code: kode };
  }
}

function denganKunci_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) gagal_('Server sedang sibuk. Coba lagi beberapa saat.', 'BUSY');
  try {
    var hasil = fn();
    SpreadsheetApp.flush();
    return hasil;
  } finally {
    lock.releaseLock();
  }
}

function sekarang_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function sha256Hex_(teks) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, teks, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function samaAman_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function acakHex_(panjang) {
  var s = '';
  while (s.length < panjang) s += Utilities.getUuid().replace(/-/g, '');
  return s.substring(0, panjang);
}

function hanyaPemilik_() {
  var aktif = Session.getActiveUser().getEmail();
  var pemilik = Session.getEffectiveUser().getEmail();
  if (!aktif || aktif !== pemilik) {
    throw new Error('Fungsi ini hanya dapat dijalankan oleh pemilik script dari editor Apps Script.');
  }
}

// ============================================================
//  SPREADSHEET & INISIALISASI DATABASE
// ============================================================
function getSS_() {
  if (SS_CACHE_) return SS_CACHE_;
  var id = String(CONFIG.SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '');
  var ss = null;
  if (id && id.indexOf('GANTI') !== 0) {
    try { ss = SpreadsheetApp.openById(id); }
    catch (e) { gagal_('Spreadsheet tidak dapat dibuka. Periksa Script Property SPREADSHEET_ID dan izin akses.', 'CONFIG'); }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) gagal_('Spreadsheet belum dikonfigurasi. Isi Script Property SPREADSHEET_ID di Apps Script.', 'CONFIG');
  SS_CACHE_ = ss;
  return ss;
}

function getSheet_(nama) {
  var ss = getSS_();
  var sh = ss.getSheetByName(nama);
  if (!sh) {
    inisialisasiDatabase_();
    sh = ss.getSheetByName(nama);
  }
  // Migrasi otomatis: sheet Service lama (tanpa kolom Tanggal Pembelian) ditambah kolomnya.
  if (nama === SHEET_SERVICE && !MIGRASI_OK_) {
    if (sh.getMaxColumns() < HEADER_SERVICE.length || !String(sh.getRange(1, HEADER_SERVICE.length).getValue())) {
      inisialisasiDatabase_();
      sh = ss.getSheetByName(nama);
    }
    MIGRASI_OK_ = true;
  }
  return sh;
}

/** Membuat sheet & header jika belum ada. Aman dijalankan berulang kali. */
function inisialisasiDatabase_() {
  var ss = getSS_();
  var def = [[SHEET_SERVICE, HEADER_SERVICE], [SHEET_RIWAYAT, HEADER_RIWAYAT], [SHEET_ADMIN, HEADER_ADMIN]];
  def.forEach(function (d) {
    var sh = ss.getSheetByName(d[0]);
    if (!sh) sh = ss.insertSheet(d[0]);
    var hdr = d[1];
    if (sh.getMaxColumns() < hdr.length) sh.insertColumnsAfter(sh.getMaxColumns(), hdr.length - sh.getMaxColumns());
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
    } else {
      var cur = sh.getRange(1, 1, 1, hdr.length).getValues()[0];
      // Kolom header yang masih kosong (kolom baru di versi lebih baru) diisi otomatis.
      var sama = hdr.every(function (h, i) { return String(cur[i]) === h || String(cur[i]) === ''; });
      if (sama) {
        hdr.forEach(function (h, i) { if (String(cur[i]) === '') sh.getRange(1, i + 1).setValue(h); });
      } else gagal_('Header sheet "' + d[0] + '" tidak sesuai. Hapus sheet tersebut (jika masih kosong) lalu jalankan ulang inisialisasi.', 'CONFIG');
    }
    sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // Format teks agar nomor HP/nota tidak berubah & isi sel tidak dianggap rumus.
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), hdr.length).setNumberFormat('@');
  });
  // Hapus sheet bawaan kosong
  ['Sheet1', 'Sheet 1', 'Lembar1', 'Lembar 1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(s); } catch (e) { /* abaikan */ }
    }
  });
}

/** Jalankan SEKALI dari editor Apps Script (pilih fungsi ini lalu klik Run). */
function inisialisasiDatabase() {
  hanyaPemilik_();
  inisialisasiDatabase_();
  return 'Database siap: sheet Service, RiwayatStatus, dan Admin tersedia.';
}

function pastikanBaris_(sh, baris) {
  var maks = sh.getMaxRows();
  if (baris > maks) sh.insertRowsAfter(maks, Math.max(100, baris - maks));
}

// ============================================================
//  ADMIN: PEMBUATAN AKUN, HASH PASSWORD, SESI
// ============================================================
function buatHash_(password) {
  var salt = acakHex_(32);
  return 'v1$' + HASH_ITER + '$' + salt + '$' + hashPassword_(password, salt, HASH_ITER);
}

function hashPassword_(password, salt, iter) {
  var h = salt + ':' + password;
  for (var i = 0; i < iter; i++) h = sha256Hex_(h + salt + password);
  return h;
}

function verifikasiPassword_(password, tersimpan) {
  var p = String(tersimpan || '').split('$');
  if (p.length !== 4 || p[0] !== 'v1') {
    hashPassword_(password, 'x', HASH_ITER); // samakan waktu proses
    return false;
  }
  var iter = parseInt(p[1], 10);
  if (!(iter > 0 && iter <= 100000)) return false;
  return samaAman_(hashPassword_(password, p[2], iter), p[3]);
}

/**
 * Membuat akun admin pertama atau mereset password admin.
 * CARA PAKAI: ubah USERNAME & PASSWORD di bawah, klik Run, lalu KEMBALIKAN ke 'GANTI_...'
 * dan simpan agar password tidak tertinggal di kode.
 */
function buatAtauResetAdmin() {
  hanyaPemilik_();
  var USERNAME = 'GANTI_USERNAME';
  var PASSWORD = 'GANTI_PASSWORD';

  if (USERNAME.indexOf('GANTI') === 0 || PASSWORD.indexOf('GANTI') === 0) {
    throw new Error('Ubah dulu nilai USERNAME dan PASSWORD di dalam fungsi buatAtauResetAdmin.');
  }
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(USERNAME)) throw new Error('Username 3-30 karakter (huruf, angka, titik, garis bawah, strip).');
  if (PASSWORD.length < 8) throw new Error('Password minimal 8 karakter.');

  return denganKunci_(function () {
    inisialisasiDatabase_();
    var sh = getSheet_(SHEET_ADMIN);
    var uname = USERNAME.toLowerCase();
    var hash = buatHash_(PASSWORD);
    var last = sh.getLastRow();
    if (last >= 2) {
      var data = sh.getRange(2, 1, last - 1, 5).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).toLowerCase() === uname) {
          sh.getRange(i + 2, 3, 1, 3).setNumberFormat('@').setValues([[hash, 'admin', 'Aktif']]);
          return 'Password admin "' + uname + '" berhasil direset.';
        }
      }
    }
    var baris = last + 1;
    pastikanBaris_(sh, baris);
    sh.getRange(baris, 1, 1, 5).setNumberFormat('@').setValues([[Utilities.getUuid(), uname, hash, 'admin', 'Aktif']]);
    return 'Admin "' + uname + '" berhasil dibuat.';
  });
}

function cariAdmin_(username) {
  var sh = getSheet_(SHEET_ADMIN);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var data = sh.getRange(2, 1, last - 1, 5).getDisplayValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === username) {
      return { id: data[i][0], username: String(data[i][1]).toLowerCase(), passwordHash: data[i][2], role: String(data[i][3]).toLowerCase(), statusAkun: data[i][4] };
    }
  }
  return null;
}

function buatSesi_(username, role) {
  var token = acakHex_(64);
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ u: username, r: role }), CONFIG.SESSION_TTL_DETIK);
  return token;
}

/** Validasi sesi admin di sisi server. Dipanggil di awal SETIAP fungsi admin. */
function wajibAdmin_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) gagal_('Sesi tidak valid. Silakan login kembali.', 'AUTH');
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) gagal_('Sesi berakhir. Silakan login kembali.', 'AUTH');
  var s;
  try { s = JSON.parse(raw); } catch (e) { gagal_('Sesi tidak valid. Silakan login kembali.', 'AUTH'); }
  if (!s || s.r !== 'admin') gagal_('Anda tidak memiliki akses.', 'AUTH');
  return s;
}

function infoSesi_(s, token) {
  return { token: token, username: s.u, toko: CONFIG.TOKO, statusList: STATUS_LIST, adminPertama: s.u === usernameAdminPertama_() };
}

/** Admin pertama = akun pada baris data pertama sheet Admin. Hanya akun ini yang boleh mengelola user. */
function usernameAdminPertama_() {
  var sh = getSheet_(SHEET_ADMIN);
  if (sh.getLastRow() < 2) return '';
  return String(sh.getRange(2, 2).getDisplayValue()).trim().toLowerCase();
}

function wajibAdminPertama_(token) {
  var s = wajibAdmin_(token);
  var pertama = usernameAdminPertama_();
  if (!pertama || s.u !== pertama) gagal_('Hanya admin pertama yang dapat mengelola user.', 'FORBIDDEN');
  return s;
}

/** Daftar akun admin (tanpa hash password). Khusus admin pertama. */
function daftarUser(token) {
  return tangani_(function () {
    wajibAdminPertama_(token);
    var sh = getSheet_(SHEET_ADMIN);
    var last = sh.getLastRow();
    var hasil = [];
    if (last >= 2) {
      var data = sh.getRange(2, 1, last - 1, 5).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        if (!data[i][1]) continue;
        hasil.push({
          username: String(data[i][1]).toLowerCase(),
          role: data[i][3],
          statusAkun: data[i][4],
          pertama: hasil.length === 0
        });
      }
    }
    return { users: hasil };
  });
}

/** Menambah akun admin baru. Khusus admin pertama. */
function tambahUser(token, username, password) {
  return tangani_(function () {
    var s = wajibAdminPertama_(token);
    username = String(username == null ? '' : username).trim().toLowerCase();
    password = String(password == null ? '' : password);
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) gagal_('Username 3-30 karakter (huruf, angka, titik, garis bawah, strip).');
    if (password.length < 8) gagal_('Password minimal 8 karakter.');
    if (password.length > 200) gagal_('Password terlalu panjang.');
    var hash = buatHash_(password);
    return denganKunci_(function () {
      if (cariAdmin_(username)) gagal_('Username "' + username + '" sudah digunakan.');
      var sh = getSheet_(SHEET_ADMIN);
      var baris = sh.getLastRow() + 1;
      pastikanBaris_(sh, baris);
      sh.getRange(baris, 1, 1, 5).setNumberFormat('@').setValues([[Utilities.getUuid(), username, hash, 'admin', 'Aktif']]);
      return { username: username, dibuatOleh: s.u };
    });
  });
}

function loginAdmin(username, password) {
  return tangani_(function () {
    username = String(username || '').trim().toLowerCase();
    password = String(password == null ? '' : password);
    if (!username || !password) gagal_('Username dan password wajib diisi.', 'VALID');
    if (username.length > 50 || password.length > 200) gagal_('Username atau password salah.', 'AUTH');

    var cache = CacheService.getScriptCache();
    var kunci = 'gagal_' + sha256Hex_(username);
    var jumlah = Number(cache.get(kunci) || 0);
    if (jumlah >= CONFIG.MAKS_GAGAL_LOGIN) {
      gagal_('Terlalu banyak percobaan login gagal. Coba lagi dalam ' + Math.round(CONFIG.KUNCI_LOGIN_DETIK / 60) + ' menit.', 'AUTH');
    }

    var admin = cariAdmin_(username);
    var ok = false;
    if (admin && String(admin.statusAkun).toLowerCase() === 'aktif' && admin.role === 'admin') {
      ok = verifikasiPassword_(password, admin.passwordHash);
    } else {
      hashPassword_(password, 'x', HASH_ITER); // samakan waktu proses
    }
    if (!ok) {
      cache.put(kunci, String(jumlah + 1), CONFIG.KUNCI_LOGIN_DETIK);
      Utilities.sleep(400);
      gagal_('Username atau password salah.', 'AUTH');
    }
    cache.remove(kunci);
    var token = buatSesi_(admin.username, admin.role);
    return infoSesi_({ u: admin.username }, token);
  });
}

function logoutAdmin(token) {
  return tangani_(function () {
    token = String(token || '');
    if (/^[a-f0-9]{64}$/.test(token)) CacheService.getScriptCache().remove('sess_' + token);
    return {};
  });
}

function cekSesi(token) {
  return tangani_(function () {
    var s = wajibAdmin_(token);
    return infoSesi_(s, String(token));
  });
}

// ============================================================
//  VALIDASI & NORMALISASI INPUT
// ============================================================
function teks_(nilai, maks, label, wajib) {
  var s = String(nilai == null ? '' : nilai)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (wajib && !s) gagal_(label + ' wajib diisi.');
  if (s.length > maks) gagal_(label + ' maksimal ' + maks + ' karakter.');
  return s;
}

/** Mengubah 0812..., +62812..., 62812..., 812... menjadi 62812... Mengembalikan '' jika tidak valid. */
function normalisasiNoHp_(input) {
  var d = String(input == null ? '' : input).replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return '';
  d = d.replace(/^\+/, '');
  if (d.indexOf('62') === 0) {
    d = d.substring(2).replace(/^0+/, '');
    d = '62' + d;
  } else if (d.indexOf('0') === 0) {
    d = '62' + d.replace(/^0+/, '');
  } else if (d.indexOf('8') === 0) {
    d = '62' + d;
  } else {
    return '';
  }
  return /^628\d{7,11}$/.test(d) ? d : '';
}

function validasiInput_(d) {
  d = d || {};
  var o = {};
  o.nama = teks_(d.nama, 100, 'Nama konsumen', true);
  o.noHp = normalisasiNoHp_(d.noHp);
  if (!o.noHp) gagal_('Nomor HP/WhatsApp tidak valid. Contoh: 081234567890 atau +6281234567890.');
  o.brand = teks_(d.brand, 60, 'Brand/Merek', true);
  o.tipe = teks_(d.tipe, 80, 'Tipe/Model', true);
  o.noSeri = teks_(d.noSeri, 60, 'Nomor seri', false) || '-';
  o.statusGaransi = String(d.statusGaransi || '');
  if (GARANSI_LIST.indexOf(o.statusGaransi) < 0) gagal_('Status garansi harus dipilih (Garansi / Non Garansi).');
  o.tanggalPembelian = '';
  if (o.statusGaransi === 'Garansi') {
    o.tanggalPembelian = validasiTanggalBeli_(d.tanggalPembelian);
  }
  o.keluhan = teks_(d.keluhan, 1000, 'Keluhan konsumen', true);
  o.statusPengerjaan = String(d.statusPengerjaan || STATUS_LIST[0]);
  if (STATUS_LIST.indexOf(o.statusPengerjaan) < 0) gagal_('Status pengerjaan tidak valid.');
  cekAturanStatus_(o.statusGaransi, o.statusPengerjaan);
  o.catatanTeknisi = teks_(d.catatanTeknisi, 1000, 'Catatan teknisi', false);
  return o;
}

/** Tanggal pembelian (wajib untuk service Garansi): format yyyy-MM-dd, tanggal nyata, tidak boleh di masa depan. */
function validasiTanggalBeli_(nilai) {
  var s = String(nilai == null ? '' : nilai).trim();
  if (!s) gagal_('Tanggal pembelian wajib diisi untuk service Garansi.');
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) gagal_('Format tanggal pembelian tidak valid.');
  var th = parseInt(m[1], 10), bl = parseInt(m[2], 10), hr = parseInt(m[3], 10);
  var cek = new Date(Date.UTC(th, bl - 1, hr));
  if (cek.getUTCFullYear() !== th || cek.getUTCMonth() !== bl - 1 || cek.getUTCDate() !== hr || th < 2000) {
    gagal_('Tanggal pembelian tidak valid.');
  }
  if (s > sekarang_().substring(0, 10)) gagal_('Tanggal pembelian tidak boleh melewati hari ini.');
  return s;
}

function cekAturanStatus_(garansi, status) {
  if (garansi === 'Garansi' && status === 'Konfirmasi Harga') {
    gagal_('Status "Konfirmasi Harga" hanya untuk service Non Garansi.');
  }
}

/** Mengisi/menghapus Tanggal Selesai & Tanggal Diambil sesuai status. */
function terapkanTanggalStatus_(o, status, skrg) {
  var idx = STATUS_LIST.indexOf(status);
  if (idx >= STATUS_LIST.indexOf('Selesai Service')) { if (!o.tanggalSelesai) o.tanggalSelesai = skrg; }
  else o.tanggalSelesai = '';
  if (idx >= STATUS_LIST.indexOf('Sudah Diambil')) { if (!o.tanggalDiambil) o.tanggalDiambil = skrg; }
  else o.tanggalDiambil = '';
}

// ============================================================
//  AKSES DATA SERVICE
// ============================================================
function petakan_(arr, baris) {
  var o = { _row: baris };
  for (var i = 0; i < KEYS_SERVICE.length; i++) o[KEYS_SERVICE[i]] = String(arr[i] == null ? '' : arr[i]);
  return o;
}

function bacaBaris_(sh, baris) {
  return petakan_(sh.getRange(baris, 1, 1, KEYS_SERVICE.length).getDisplayValues()[0], baris);
}

function bacaSemuaService_() {
  var sh = getSheet_(SHEET_SERVICE);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, KEYS_SERVICE.length).getDisplayValues();
  var hasil = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0]) hasil.push(petakan_(vals[i], i + 2));
  }
  return hasil;
}

function cariBarisById_(sh, id) {
  id = String(id || '');
  if (!id || id.length > 64) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function muatServiceById_(id) {
  var sh = getSheet_(SHEET_SERVICE);
  var baris = cariBarisById_(sh, id);
  if (!baris) gagal_('Data service tidak ditemukan.', 'NOTFOUND');
  return bacaBaris_(sh, baris);
}

function tulisBaris_(sh, baris, o) {
  var vals = KEYS_SERVICE.map(function (k) { return o[k] == null ? '' : String(o[k]); });
  pastikanBaris_(sh, baris);
  sh.getRange(baris, 1, 1, vals.length).setNumberFormat('@').setValues([vals]);
}

function catatRiwayat_(idService, nomor, sebelum, baru, waktu, keterangan) {
  var sh = getSheet_(SHEET_RIWAYAT);
  var baris = sh.getLastRow() + 1;
  pastikanBaris_(sh, baris);
  var vals = [Utilities.getUuid(), idService, nomor, sebelum, baru, waktu, keterangan || ''];
  sh.getRange(baris, 1, 1, vals.length).setNumberFormat('@').setValues([vals]);
}

function ambilRiwayat_(idService) {
  var sh = getSheet_(SHEET_RIWAYAT);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, HEADER_RIWAYAT.length).getDisplayValues();
  var hasil = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][1]) === String(idService)) {
      hasil.push({ sebelum: vals[i][3], baru: vals[i][4], waktu: vals[i][5], keterangan: vals[i][6] });
    }
  }
  return hasil;
}

// ============================================================
//  NOMOR NOTA & TOKEN PELACAKAN
// ============================================================
/** Nomor nota unik: SRV-yyyyMMdd-0001. Harus dipanggil di dalam kunci (LockService). */
function buatNomorNota_(sh, skrg) {
  var tgl = skrg.substring(0, 10).replace(/-/g, '');
  var prefix = 'SRV-' + tgl + '-';
  var max = 0;
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 2, last - 1, 1).getDisplayValues().forEach(function (r) {
      var n = String(r[0]);
      if (n.indexOf(prefix) === 0) {
        var x = parseInt(n.substring(prefix.length), 10);
        if (x > max) max = x;
      }
    });
  }
  // Penghitung permanen agar nomor dari nota yang dihapus tidak dipakai ulang.
  var props = PropertiesService.getScriptProperties();
  var simpan = String(props.getProperty('NOTA_COUNTER') || '').split(':');
  if (simpan[0] === tgl) {
    var n2 = parseInt(simpan[1], 10);
    if (n2 > max) max = n2;
  }
  var berikut = max + 1;
  props.setProperty('NOTA_COUNTER', tgl + ':' + berikut);
  return prefix + ('0000' + berikut).slice(-4);
}

function buatTokenPelacakan_(sh) {
  var ada = {};
  var last = sh.getLastRow();
  var kol = KEYS_SERVICE.indexOf('token') + 1;
  if (last >= 2) sh.getRange(2, kol, last - 1, 1).getDisplayValues().forEach(function (r) { ada[String(r[0])] = true; });
  var t;
  do { t = acakHex_(40); } while (ada[t]);
  return t;
}

function baseUrl_() {
  if (BASE_URL_CACHE_ !== null) return BASE_URL_CACHE_;
  var u = CONFIG.WEB_APP_URL ? String(CONFIG.WEB_APP_URL).replace(/[?#].*$/, '') : ScriptApp.getService().getUrl();
  BASE_URL_CACHE_ = u;
  return u;
}

function tautanPelacakan_(token) {
  var pages = pagesUrl_();
  return pages ? pages + 'tracking.html?id=' + token : baseUrl_() + '?page=tracking&id=' + token;
}

function keAdmin_(o) {
  var r = {};
  KEYS_SERVICE.forEach(function (k) { if (k !== 'token') r[k] = o[k]; });
  r.tautanPelacakan = tautanPelacakan_(o.token);
  return r;
}

// ============================================================
//  OPERASI ADMIN: TAMBAH, EDIT, HAPUS, UBAH STATUS, CARI, DETAIL
// ============================================================
function tambahService(token, data) {
  return tangani_(function () {
    var s = wajibAdmin_(token);
    var v = validasiInput_(data);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_SERVICE);
      var skrg = sekarang_();
      var o = {
        id: Utilities.getUuid(),
        nomorNota: buatNomorNota_(sh, skrg),
        tanggalMasuk: skrg,
        nama: v.nama, noHp: v.noHp, brand: v.brand, tipe: v.tipe, noSeri: v.noSeri,
        statusGaransi: v.statusGaransi, tanggalPembelian: v.tanggalPembelian, keluhan: v.keluhan,
        statusPengerjaan: v.statusPengerjaan, catatanTeknisi: v.catatanTeknisi,
        tanggalSelesai: '', tanggalDiambil: '',
        token: buatTokenPelacakan_(sh),
        terakhirDiperbarui: skrg
      };
      terapkanTanggalStatus_(o, o.statusPengerjaan, skrg);
      tulisBaris_(sh, sh.getLastRow() + 1, o);
      catatRiwayat_(o.id, o.nomorNota, '-', o.statusPengerjaan, skrg, 'Nota service dibuat oleh ' + s.u);
      return { service: keAdmin_(o) };
    });
  });
}

function editService(token, id, data) {
  return tangani_(function () {
    var s = wajibAdmin_(token);
    var v = validasiInput_(data);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_SERVICE);
      var baris = cariBarisById_(sh, id);
      if (!baris) gagal_('Data service tidak ditemukan.', 'NOTFOUND');
      var o = bacaBaris_(sh, baris);
      var skrg = sekarang_();
      var statusLama = o.statusPengerjaan;
      o.nama = v.nama; o.noHp = v.noHp; o.brand = v.brand; o.tipe = v.tipe; o.noSeri = v.noSeri;
      o.statusGaransi = v.statusGaransi; o.tanggalPembelian = v.tanggalPembelian;
      o.keluhan = v.keluhan; o.catatanTeknisi = v.catatanTeknisi;
      o.statusPengerjaan = v.statusPengerjaan;
      terapkanTanggalStatus_(o, v.statusPengerjaan, skrg);
      o.terakhirDiperbarui = skrg;
      tulisBaris_(sh, baris, o);
      if (statusLama !== v.statusPengerjaan) {
        catatRiwayat_(o.id, o.nomorNota, statusLama, v.statusPengerjaan, skrg, 'Status diubah lewat edit data oleh ' + s.u);
      }
      return { service: keAdmin_(o) };
    });
  });
}

function ubahStatus(token, id, statusBaru, keterangan) {
  return tangani_(function () {
    var s = wajibAdmin_(token);
    statusBaru = String(statusBaru || '');
    if (STATUS_LIST.indexOf(statusBaru) < 0) gagal_('Status pengerjaan tidak valid.');
    var ket = teks_(keterangan, 300, 'Keterangan', false);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_SERVICE);
      var baris = cariBarisById_(sh, id);
      if (!baris) gagal_('Data service tidak ditemukan.', 'NOTFOUND');
      var o = bacaBaris_(sh, baris);
      cekAturanStatus_(o.statusGaransi, statusBaru);
      if (o.statusPengerjaan === statusBaru) gagal_('Status tidak berubah. Pilih status yang berbeda.');
      var skrg = sekarang_();
      var lama = o.statusPengerjaan;
      o.statusPengerjaan = statusBaru;
      terapkanTanggalStatus_(o, statusBaru, skrg);
      o.terakhirDiperbarui = skrg;
      tulisBaris_(sh, baris, o);
      catatRiwayat_(o.id, o.nomorNota, lama, statusBaru, skrg, (ket ? ket + ' | ' : '') + 'Oleh ' + s.u);
      return { service: keAdmin_(o) };
    });
  });
}

/** Menghapus data dari sheet Service. Riwayat di sheet RiwayatStatus tetap disimpan (ditambah catatan penghapusan). */
function hapusService(token, id) {
  return tangani_(function () {
    var s = wajibAdmin_(token);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_SERVICE);
      var baris = cariBarisById_(sh, id);
      if (!baris) gagal_('Data service tidak ditemukan.', 'NOTFOUND');
      var o = bacaBaris_(sh, baris);
      catatRiwayat_(o.id, o.nomorNota, o.statusPengerjaan, 'Data Dihapus', sekarang_(), 'Data service dihapus oleh ' + s.u);
      sh.deleteRow(baris);
      return { nomorNota: o.nomorNota };
    });
  });
}

function cariService(token, filter) {
  return tangani_(function () {
    wajibAdmin_(token);
    filter = filter || {};
    var q = String(filter.q || '').trim().toLowerCase().substring(0, 100);
    var qDigit = q.replace(/\D/g, '');
    var qHp = qDigit.length >= 3 ? (qDigit.charAt(0) === '0' ? '62' + qDigit.replace(/^0+/, '') : qDigit) : '';
    var st = String(filter.status || '');
    var gr = String(filter.garansi || '');
    var dari = /^\d{4}-\d{2}-\d{2}$/.test(String(filter.dari || '')) ? filter.dari : '';
    var sampai = /^\d{4}-\d{2}-\d{2}$/.test(String(filter.sampai || '')) ? filter.sampai : '';

    var semua = bacaSemuaService_();
    var stats = { total: semua.length, perStatus: {} };
    STATUS_LIST.forEach(function (x) { stats.perStatus[x] = 0; });
    semua.forEach(function (r) { if (stats.perStatus[r.statusPengerjaan] !== undefined) stats.perStatus[r.statusPengerjaan]++; });

    var hasil = semua.filter(function (r) {
      if (st && r.statusPengerjaan !== st) return false;
      if (gr && r.statusGaransi !== gr) return false;
      var tgl = r.tanggalMasuk.substring(0, 10);
      if (dari && tgl < dari) return false;
      if (sampai && tgl > sampai) return false;
      if (q) {
        var cocok = [r.nomorNota, r.nama, r.brand, r.tipe, r.noHp].join(' | ').toLowerCase().indexOf(q) >= 0;
        if (!cocok && qHp && r.noHp.indexOf(qHp) >= 0) cocok = true;
        if (!cocok) return false;
      }
      return true;
    });
    hasil.sort(function (a, b) {
      if (a.tanggalMasuk !== b.tanggalMasuk) return a.tanggalMasuk < b.tanggalMasuk ? 1 : -1;
      return a.nomorNota < b.nomorNota ? 1 : (a.nomorNota > b.nomorNota ? -1 : 0);
    });
    return { stats: stats, total: hasil.length, rows: hasil.map(keAdmin_) };
  });
}

function ambilDetail(token, id) {
  return tangani_(function () {
    wajibAdmin_(token);
    var o = muatServiceById_(id);
    return { service: keAdmin_(o), riwayat: ambilRiwayat_(o.id) };
  });
}

// ============================================================
//  PESAN WHATSAPP
// ============================================================
function kalimatStatus_(status) {
  switch (status) {
    case 'Baru Diterima': return 'barang service Anda telah kami terima.';
    case 'Proses Service': return 'barang service Anda sedang kami kerjakan.';
    case 'Konfirmasi Harga': return 'service barang Anda memerlukan konfirmasi biaya sebelum dilanjutkan. Mohon balas pesan ini untuk konfirmasi.';
    case 'Selesai Service': return 'service barang Anda telah selesai.';
    case 'Menunggu Diambil': return 'service barang Anda telah selesai dan siap diambil.';
    case 'Sudah Diambil': return 'barang service Anda telah diambil.';
    default: return 'berikut informasi service barang Anda.';
  }
}

function susunPesanWa_(o) {
  return 'Halo Bapak/Ibu ' + o.nama + ', ' + kalimatStatus_(o.statusPengerjaan) + '\n\n' +
    'Nomor Nota: ' + o.nomorNota + '\n' +
    'Brand/Tipe: ' + o.brand + ' ' + o.tipe + '\n' +
    'Status: ' + o.statusPengerjaan + '\n\n' +
    'Untuk melihat perkembangan service, silakan klik tautan berikut:\n' +
    tautanPelacakan_(o.token) + '\n\n' +
    'Terima kasih telah mempercayakan service kepada kami.\n' +
    CONFIG.TOKO.NAMA;
}

/**
 * Menyusun pesan + tautan WhatsApp. Pesan TIDAK terkirim otomatis:
 * admin harus menekan tombol kirim di aplikasi WhatsApp.
 */
function buatPesanWhatsApp(token, id) {
  return tangani_(function () {
    wajibAdmin_(token);
    var o = muatServiceById_(id);
    var nomor = normalisasiNoHp_(o.noHp);
    if (!nomor) gagal_('Nomor HP konsumen tidak valid. Perbaiki lewat menu Edit.');
    var pesan = susunPesanWa_(o);
    return {
      nomorNota: o.nomorNota,
      nomor: nomor,
      pesan: pesan,
      url: 'https://wa.me/' + nomor + '?text=' + encodeURIComponent(pesan),
      tautan: tautanPelacakan_(o.token)
    };
  });
}

// ============================================================
//  DATA NOTA UNTUK DICETAK
// ============================================================
function ambilDataNota(token, id) {
  return tangani_(function () {
    wajibAdmin_(token);
    var o = muatServiceById_(id);
    return {
      nomorNota: o.nomorNota, tanggalMasuk: o.tanggalMasuk, nama: o.nama, noHp: o.noHp,
      brand: o.brand, tipe: o.tipe, noSeri: o.noSeri, statusGaransi: o.statusGaransi,
      tanggalPembelian: o.tanggalPembelian,
      keluhan: o.keluhan, statusPengerjaan: o.statusPengerjaan, toko: CONFIG.TOKO
    };
  });
}

// ============================================================
//  PELACAKAN KONSUMEN (PUBLIK, HANYA-BACA)
// ============================================================
/**
 * Dipanggil dari halaman pelacakan. Hanya menerima token acak 40 hex dan hanya
 * mengembalikan data yang aman untuk konsumen (tanpa catatan teknisi, nomor seri,
 * nomor HP, keterangan internal, atau data pelanggan lain).
 */
function ambilDataPelacakan(trackingToken) {
  return tangani_(function () {
    var t = String(trackingToken || '');
    var tidakAda = 'Tautan pelacakan tidak valid atau nota tidak ditemukan.';
    if (!/^[a-f0-9]{40}$/.test(t)) gagal_(tidakAda, 'NOTFOUND');
    var sh = getSheet_(SHEET_SERVICE);
    var last = sh.getLastRow();
    if (last < 2) gagal_(tidakAda, 'NOTFOUND');
    var kol = KEYS_SERVICE.indexOf('token') + 1;
    var ketemu = sh.getRange(2, kol, last - 1, 1).createTextFinder(t).matchEntireCell(true).matchCase(true).findNext();
    if (!ketemu) gagal_(tidakAda, 'NOTFOUND');
    var o = bacaBaris_(sh, ketemu.getRow());
    if (!samaAman_(o.token, t)) gagal_(tidakAda, 'NOTFOUND');

    var riwayat = ambilRiwayat_(o.id)
      .filter(function (r) { return STATUS_LIST.indexOf(r.baru) >= 0; })
      .map(function (r) { return { status: r.baru, waktu: r.waktu }; });
    var terakhir = riwayat.length ? riwayat[riwayat.length - 1].waktu : o.terakhirDiperbarui;
    var langkah = STATUS_LIST.filter(function (s) { return !(o.statusGaransi === 'Garansi' && s === 'Konfirmasi Harga'); });

    return {
      nomorNota: o.nomorNota, nama: o.nama, brand: o.brand, tipe: o.tipe,
      tanggalMasuk: o.tanggalMasuk, statusGaransi: o.statusGaransi,
      tanggalPembelian: o.statusGaransi === 'Garansi' ? o.tanggalPembelian : '',
      keluhan: o.keluhan,
      statusPengerjaan: o.statusPengerjaan, langkah: langkah, riwayat: riwayat,
      diperbaruiPada: terakhir,
      toko: {
        NAMA: CONFIG.TOKO.NAMA, ALAMAT: CONFIG.TOKO.ALAMAT, TELP: CONFIG.TOKO.TELP,
        WA: CONFIG.TOKO.WA, JAM_OPERASIONAL: CONFIG.TOKO.JAM_OPERASIONAL
      }
    };
  });
}