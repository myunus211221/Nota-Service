/**
 * ============================================================
 *  NOTA SERVICE ELEKTRONIK & PELACAKAN STATUS SERVICE
 *  Backend: Google Apps Script Web App
 *  Database: Google Spreadsheet
 * ============================================================
 *
 *  CATATAN KEAMANAN PENTING
 *  - Semua fungsi global TANPA garis bawah di akhir nama dapat dipanggil dari browser
 *    (google.script.run). Karena itu setiap fungsi admin memanggil wajibAdmin_(token)
 *    sebagai baris pertama. Fungsi berakhiran "_" bersifat privat.
 *  - Password admin TIDAK disimpan sebagai teks biasa (hash SHA-256 + salt + iterasi).
 *  - Halaman pelacakan hanya membaca lewat token acak 40 karakter hex.
 */

// ============================================================
//  KONFIGURASI  (EDIT BAGIAN INI)
// ============================================================
var CONFIG = {
  // ID Spreadsheet = bagian antara /d/ dan /edit pada URL Spreadsheet.
  // Jika script dibuat dari Spreadsheet (Extensions > Apps Script), boleh dikosongkan ('').
  SPREADSHEET_ID: '1cHGO0o-EEDLYvYvOm2hKN_2o18kFL-53Ls2eUocAmms',

  TIMEZONE: 'Asia/Jakarta',
  APP_TITLE: 'Nota Service',

  // Set true sementara jika halaman gagal dimuat: pesan error asli akan tampil di layar.
  // Setelah masalah selesai, kembalikan ke false.
  DEBUG: true,

  // Opsional. Isi dengan URL Web App berakhiran /exec jika tautan pelacakan yang dihasilkan salah.
  // Contoh: 'https://script.google.com/macros/s/XXXXXXXX/exec'
  WEB_APP_URL: '',

  // Alamat situs GitHub Pages Anda (harus berakhiran /). Contoh: 'https://namaanda.github.io/nota-service/'
  // Jika diisi, tautan pelacakan untuk konsumen otomatis memakai alamat GitHub ini.
  GITHUB_URL: '',

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
  'Tanggal Diambil', 'Token Pelacakan', 'Terakhir Diperbarui',
  'Rincian Sparepart', 'Biaya Jasa', 'Total Biaya', 'Tanggal Pembelian'];
var JML_KOLOM_SERVICE_LAMA = 16; // kolom sebelum fitur rincian biaya (untuk migrasi otomatis)
var KEYS_SERVICE = ['id', 'nomorNota', 'tanggalMasuk', 'nama', 'noHp', 'brand', 'tipe', 'noSeri',
  'statusGaransi', 'keluhan', 'statusPengerjaan', 'catatanTeknisi', 'tanggalSelesai',
  'tanggalDiambil', 'token', 'terakhirDiperbarui', 'sparepart', 'biayaJasa', 'totalBiaya', 'tanggalPembelian'];
var HEADER_RIWAYAT = ['ID Riwayat', 'ID Service', 'Nomor Nota', 'Status Sebelumnya', 'Status Baru',
  'Tanggal dan Waktu', 'Keterangan'];
var HEADER_ADMIN = ['ID Admin', 'Username', 'Password Hash', 'Role', 'Status Akun'];

var STATUS_LIST = ['Baru Diterima', 'Proses Service', 'Konfirmasi Harga', 'Selesai Service',
  'Menunggu Diambil', 'Sudah Diambil'];
var GARANSI_LIST = ['Garansi', 'Non Garansi'];
var HASH_ITER = 2000;
var MASA_GARANSI_TAHUN = 2; // garansi berlaku 2 tahun sejak tanggal pembelian

var SS_CACHE_ = null;
var KOLOM_BARU_OK_ = false;
var BASE_URL_CACHE_ = null;

// ============================================================
//  ENTRY POINT WEB APP
// ============================================================
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.api === 'ping') return jsonOut_({ ok: true, data: { pesan: 'API aktif' } });
    var t;
    if (p.page === 'tracking') {
      t = HtmlService.createTemplateFromFile('Tracking');
      var id = String(p.id || '').trim();
      t.trackingToken = /^[a-f0-9]{40}$/.test(id) ? id : '';
      t.namaToko = CONFIG.TOKO.NAMA;
      return t.evaluate()
        .setTitle('Status Service - ' + CONFIG.TOKO.NAMA)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
    t = HtmlService.createTemplateFromFile('Index');
    t.namaToko = CONFIG.TOKO.NAMA;
    t.appTitle = CONFIG.APP_TITLE;
    return t.evaluate()
      .setTitle(CONFIG.APP_TITLE + ' - ' + CONFIG.TOKO.NAMA)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    var detail = CONFIG.DEBUG ? '<pre style="white-space:pre-wrap;background:#fef2f2;padding:10px">' +
      String(err && err.message ? err.message : err).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>' : '';
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Terjadi kesalahan saat memuat halaman. Silakan coba lagi.</p>' + detail);
  }
}

// ============================================================
//  API JSON UNTUK SITUS GITHUB PAGES
//  Situs di GitHub memanggil Web App ini lewat fetch (POST, teks JSON).
//  Hanya fungsi pada daftar putih di bawah yang dapat dipanggil; setiap fungsi admin
//  tetap memvalidasi token sesi sendiri.
// ============================================================
var API_PUBLIK_ = {
  loginAdmin: loginAdmin, logoutAdmin: logoutAdmin, cekSesi: cekSesi,
  tambahService: tambahService, editService: editService, ubahStatus: ubahStatus, hapusService: hapusService,
  cariService: cariService, ambilDetail: ambilDetail,
  daftarUser: daftarUser, tambahUser: tambahUser, hapusUser: hapusUser,
  buatPesanWhatsApp: buatPesanWhatsApp, ambilDataNota: ambilDataNota,
  ambilDataPelacakan: ambilDataPelacakan
};

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var hasil;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = String(body.fn || '');
    var args = Array.isArray(body.args) ? body.args : [];
    if (!Object.prototype.hasOwnProperty.call(API_PUBLIK_, fn) || args.length > 6) {
      hasil = { ok: false, error: 'Permintaan tidak valid.', code: 'VALID' };
    } else {
      hasil = API_PUBLIK_[fn].apply(null, args);
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    hasil = { ok: false, error: 'Permintaan tidak valid.', code: 'VALID' };
  }
  return jsonOut_(hasil);
}

/** Menyisipkan file HTML statis (Styles, JavaScript) ke dalam template. */
function include(nama) {
  if (nama !== 'Styles' && nama !== 'JavaScript') return '';
  return HtmlService.createHtmlOutputFromFile(nama).getContent();
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
  var id = String(CONFIG.SPREADSHEET_ID || '');
  var ss = null;
  if (id && id.indexOf('GANTI') !== 0) {
    try { ss = SpreadsheetApp.openById(id); }
    catch (e) { gagal_('Spreadsheet tidak dapat dibuka. Periksa CONFIG.SPREADSHEET_ID dan izin akses.', 'CONFIG'); }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) gagal_('Spreadsheet belum dikonfigurasi. Isi CONFIG.SPREADSHEET_ID di Code.gs.', 'CONFIG');
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
  // Migrasi otomatis: tambahkan kolom rincian biaya pada sheet Service lama.
  if (nama === SHEET_SERVICE && !KOLOM_BARU_OK_) {
    if (sh.getMaxColumns() < HEADER_SERVICE.length ||
        String(sh.getRange(1, HEADER_SERVICE.length).getValue()) !== HEADER_SERVICE[HEADER_SERVICE.length - 1]) {
      inisialisasiDatabase_();
    }
    KOLOM_BARU_OK_ = true;
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
      // Sheet Service versi lama (16 kolom) boleh dilanjutkan: kolom baru ditulis di bawah.
      var cek = (d[0] === SHEET_SERVICE) ? JML_KOLOM_SERVICE_LAMA : hdr.length;
      var sama = hdr.every(function (h, i) { return i >= cek || String(cur[i]) === h; });
      if (!sama) gagal_('Header sheet "' + d[0] + '" tidak sesuai. Hapus sheet tersebut (jika masih kosong) lalu jalankan ulang inisialisasi.', 'CONFIG');
    }
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
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
  var USERNAME = 'Yunus';
  var PASSWORD = '13011999';

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
      return { id: data[i][0], username: String(data[i][1]).toLowerCase(), passwordHash: data[i][2], role: String(data[i][3]).toLowerCase(), statusAkun: data[i][4], baris: i + 2 };
    }
  }
  return null;
}

function buatSesi_(username, role, pemilik) {
  var token = acakHex_(64);
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ u: username, r: role, o: !!pemilik, t: Date.now() }), CONFIG.SESSION_TTL_DETIK);
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
  if (!s || (s.r !== 'admin' && s.r !== 'staff')) gagal_('Anda tidak memiliki akses.', 'AUTH');
  // Sesi milik user yang sudah dihapus langsung tidak berlaku.
  var dihapus = CacheService.getScriptCache().get('dihapus_' + s.u);
  if (dihapus && Number(s.t || 0) <= Number(dihapus)) gagal_('Akun ini telah dihapus. Silakan login kembali.', 'AUTH');
  return s;
}

/** Hanya admin utama (akun pertama di sheet Admin) yang lolos. */
function wajibPemilik_(token) {
  var s = wajibAdmin_(token);
  if (!s.o) gagal_('Hanya admin utama yang dapat melakukan tindakan ini.', 'FORBID');
  return s;
}

function infoSesi_(s, token) {
  return { token: token, username: s.u, pemilik: !!s.o, toko: CONFIG.TOKO, statusList: STATUS_LIST };
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
    if (admin && String(admin.statusAkun).toLowerCase() === 'aktif' && (admin.role === 'admin' || admin.role === 'staff')) {
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
    var pemilik = admin.baris === 2; // admin pertama = baris pertama sheet Admin
    var token = buatSesi_(admin.username, admin.role, pemilik);
    return infoSesi_({ u: admin.username, o: pemilik }, token);
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
  o.keluhan = teks_(d.keluhan, 1000, 'Keluhan konsumen', true);
  o.tanggalPembelian = validasiTanggalBeli_(d.tanggalPembelian, o.statusGaransi);
  // Garansi hanya 2 tahun sejak pembelian: lewat dari itu otomatis dihitung Non Garansi.
  if (o.statusGaransi === 'Garansi' && garansiKedaluwarsa_(o.tanggalPembelian)) o.statusGaransi = 'Non Garansi';
  o.statusPengerjaan = String(d.statusPengerjaan || STATUS_LIST[0]);
  if (STATUS_LIST.indexOf(o.statusPengerjaan) < 0) gagal_('Status pengerjaan tidak valid.');
  cekAturanStatus_(o.statusGaransi, o.statusPengerjaan);
  o.catatanTeknisi = teks_(d.catatanTeknisi, 1000, 'Catatan teknisi', false);
  var b = validasiBiaya_(d, o.statusGaransi === 'Garansi');
  o.sparepart = b.sparepart; o.biayaJasa = b.biayaJasa; o.totalBiaya = b.totalBiaya;
  cekEstimasi_(o.statusGaransi, o.statusPengerjaan, Number(b.totalBiaya));
  return o;
}

function cekAturanStatus_(garansi, status) {
  if (garansi === 'Garansi' && status === 'Konfirmasi Harga') {
    gagal_('Status "Konfirmasi Harga" hanya untuk service Non Garansi.');
  }
}

/** True jika hari ini sudah melewati tanggal pembelian + masa garansi (2 tahun). */
function garansiKedaluwarsa_(tglBeli) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tglBeli || ''));
  if (!m) return false;
  var batas = (Number(m[1]) + MASA_GARANSI_TAHUN) + '-' + m[2] + '-' + m[3];
  return sekarang_().substring(0, 10) > batas;
}

/**
 * Tanggal pembelian wajib untuk service Garansi (yyyy-MM-dd, tidak boleh di masa depan).
 * Untuk Non Garansi, tanggal hanya disimpan bila garansinya sudah lewat 2 tahun (sebagai catatan).
 */
function validasiTanggalBeli_(nilai, garansi) {
  if (garansi !== 'Garansi') {
    var t0 = String(nilai || '').trim();
    return (/^\d{4}-\d{2}-\d{2}$/.test(t0) && garansiKedaluwarsa_(t0)) ? t0 : '';
  }
  var t = String(nilai || '').trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) gagal_('Tanggal pembelian wajib diisi untuk service Garansi.');
  var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  var dt = new Date(y, mo - 1, da);
  if (y < 2000 || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) gagal_('Tanggal pembelian tidak valid.');
  if (t > sekarang_().substring(0, 10)) gagal_('Tanggal pembelian tidak boleh melebihi hari ini.');
  return t;
}

/** Status "Konfirmasi Harga" (Non Garansi) wajib punya estimasi biaya lebih dari Rp 0. */
function cekEstimasi_(garansi, status, total) {
  if (garansi !== 'Garansi' && status === 'Konfirmasi Harga' && !(total > 0)) {
    gagal_('Isi estimasi biaya (sparepart dan/atau biaya jasa) lewat menu Edit sebelum memakai status "Konfirmasi Harga".');
  }
}

// ============================================================
//  RINCIAN BIAYA (SPAREPART + JASA)
// ============================================================
var MAKS_RUPIAH = 999999999;
var MAKS_SPAREPART = 20;

function angka_(v, label) {
  var n = (typeof v === 'number') ? Math.floor(v) : parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
  if (!isFinite(n) || n < 0) n = 0;
  if (n > MAKS_RUPIAH) gagal_(label + ' terlalu besar.');
  return n;
}

function rupiah_(n) {
  return 'Rp ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Validasi input biaya dari form. Jika Garansi, semua harga & jasa dipaksa 0 di server. */
function validasiBiaya_(d, garansi) {
  var mentah = Array.isArray(d.sparepart) ? d.sparepart : [];
  if (mentah.length > MAKS_SPAREPART) gagal_('Sparepart maksimal ' + MAKS_SPAREPART + ' item.');
  var items = [];
  var total = 0;
  mentah.forEach(function (x, i) {
    x = x || {};
    var nama = teks_(x.nama, 100, 'Nama sparepart #' + (i + 1), false);
    var harga = angka_(x.harga, 'Harga sparepart');
    var qty = angka_(x.qty, 'Jumlah sparepart') || 1;
    if (!nama && !harga) return;
    if (!nama) gagal_('Nama sparepart #' + (i + 1) + ' wajib diisi.');
    if (qty > 999) gagal_('Jumlah sparepart maksimal 999.');
    if (garansi) harga = 0;
    items.push({ nama: nama, qty: qty, harga: harga });
    total += qty * harga;
  });
  var jasa = garansi ? 0 : angka_(d.biayaJasa, 'Biaya jasa');
  total += jasa;
  if (total > MAKS_RUPIAH) gagal_('Total biaya terlalu besar.');
  return { sparepart: JSON.stringify(items), biayaJasa: String(jasa), totalBiaya: String(total) };
}

/** Membaca rincian biaya tersimpan (aman untuk baris lama yang kolom biayanya kosong). */
function rincianDari_(o) {
  var arr;
  try { arr = JSON.parse(o.sparepart || '[]'); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  var garansi = o.statusGaransi === 'Garansi';
  var totalSp = 0;
  var items = arr.map(function (x) {
    x = x || {};
    var qty = parseInt(x.qty, 10) || 1;
    var harga = garansi ? 0 : (parseInt(x.harga, 10) || 0);
    totalSp += qty * harga;
    return { nama: String(x.nama || ''), qty: qty, harga: harga, subtotal: qty * harga };
  });
  var jasa = garansi ? 0 : (parseInt(o.biayaJasa, 10) || 0);
  return { items: items, totalSparepart: totalSp, jasa: jasa, total: totalSp + jasa, garansi: garansi };
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
  var gh = String(CONFIG.GITHUB_URL || '').trim().replace(/[?#].*$/, '');
  if (gh) return gh.replace(/\/?$/, '/') + 'tracking.html?id=' + token;
  return baseUrl_() + '?page=tracking&id=' + token;
}

/** True jika nota sedang atau pernah berstatus Selesai Service (atau sesudahnya). Nota seperti ini terkunci dari penghapusan. */
function pernahSelesai_(o, peta) {
  var idx = STATUS_LIST.indexOf('Selesai Service');
  if (STATUS_LIST.indexOf(o.statusPengerjaan) >= idx) return true;
  if (peta) return !!peta[o.id];
  return ambilRiwayat_(o.id).some(function (r) { return STATUS_LIST.indexOf(r.baru) >= idx; });
}

/** Peta id service -> true bagi semua nota yang pernah mencapai status selesai (dibaca sekali untuk seluruh daftar). */
function petaSelesai_() {
  var sh = getSheet_(SHEET_RIWAYAT);
  var last = sh.getLastRow();
  var peta = {};
  if (last < 2) return peta;
  var idx = STATUS_LIST.indexOf('Selesai Service');
  sh.getRange(2, 1, last - 1, 5).getDisplayValues().forEach(function (r) {
    if (STATUS_LIST.indexOf(r[4]) >= idx) peta[r[1]] = true;
  });
  return peta;
}

function keAdmin_(o, peta) {
  var r = {};
  KEYS_SERVICE.forEach(function (k) { if (k !== 'token' && k !== 'sparepart') r[k] = o[k]; });
  r.rincian = rincianDari_(o);
  r.terkunci = pernahSelesai_(o, peta);
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
        statusGaransi: v.statusGaransi, keluhan: v.keluhan,
        statusPengerjaan: v.statusPengerjaan, catatanTeknisi: v.catatanTeknisi,
        tanggalSelesai: '', tanggalDiambil: '',
        sparepart: v.sparepart, biayaJasa: v.biayaJasa, totalBiaya: v.totalBiaya,
        tanggalPembelian: v.tanggalPembelian,
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
    var s = wajibPemilik_(token);
    var v = validasiInput_(data);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_SERVICE);
      var baris = cariBarisById_(sh, id);
      if (!baris) gagal_('Data service tidak ditemukan.', 'NOTFOUND');
      var o = bacaBaris_(sh, baris);
      var skrg = sekarang_();
      var statusLama = o.statusPengerjaan;
      o.nama = v.nama; o.noHp = v.noHp; o.brand = v.brand; o.tipe = v.tipe; o.noSeri = v.noSeri;
      o.statusGaransi = v.statusGaransi; o.keluhan = v.keluhan; o.catatanTeknisi = v.catatanTeknisi;
      o.sparepart = v.sparepart; o.biayaJasa = v.biayaJasa; o.totalBiaya = v.totalBiaya;
      o.tanggalPembelian = v.tanggalPembelian;
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
      cekEstimasi_(o.statusGaransi, statusBaru, rincianDari_(o).total);
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
    var s = wajibPemilik_(token);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_SERVICE);
      var baris = cariBarisById_(sh, id);
      if (!baris) gagal_('Data service tidak ditemukan.', 'NOTFOUND');
      var o = bacaBaris_(sh, baris);
      if (pernahSelesai_(o)) gagal_('Nota yang sudah selesai tidak dapat dihapus.', 'FORBID');
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
    var peta = petaSelesai_();
    return { stats: stats, total: hasil.length, rows: hasil.map(function (r) { return keAdmin_(r, peta); }) };
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
//  KELOLA USER (HANYA ADMIN UTAMA)
// ============================================================
function daftarUser(token) {
  return tangani_(function () {
    var s = wajibPemilik_(token);
    var sh = getSheet_(SHEET_ADMIN);
    var last = sh.getLastRow();
    var hasil = [];
    if (last >= 2) {
      sh.getRange(2, 1, last - 1, 5).getDisplayValues().forEach(function (r, i) {
        if (!r[0]) return;
        var u = String(r[1]).toLowerCase();
        hasil.push({ id: r[0], username: u, pemilik: i === 0, saya: u === s.u });
      });
    }
    return { users: hasil };
  });
}

function tambahUser(token, username, password) {
  return tangani_(function () {
    wajibPemilik_(token);
    var uname = String(username || '').trim().toLowerCase();
    password = String(password == null ? '' : password);
    if (!/^[a-z0-9._-]{3,30}$/.test(uname)) gagal_('Username 3-30 karakter (huruf, angka, titik, garis bawah, strip).');
    if (password.length < 8) gagal_('Password minimal 8 karakter.');
    if (password.length > 200) gagal_('Password terlalu panjang.');
    var hash = buatHash_(password);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_ADMIN);
      if (cariAdmin_(uname)) gagal_('Username sudah dipakai.');
      var baris = sh.getLastRow() + 1;
      pastikanBaris_(sh, baris);
      sh.getRange(baris, 1, 1, 5).setNumberFormat('@').setValues([[Utilities.getUuid(), uname, hash, 'staff', 'Aktif']]);
      return { username: uname };
    });
  });
}

function hapusUser(token, id) {
  return tangani_(function () {
    var s = wajibPemilik_(token);
    return denganKunci_(function () {
      var sh = getSheet_(SHEET_ADMIN);
      var baris = cariBarisById_(sh, id);
      if (!baris) gagal_('User tidak ditemukan.', 'NOTFOUND');
      if (baris === 2) gagal_('Admin utama tidak dapat dihapus.', 'FORBID');
      var uname = String(sh.getRange(baris, 2).getDisplayValue()).toLowerCase();
      if (uname === s.u) gagal_('Akun yang sedang dipakai tidak dapat dihapus.', 'FORBID');
      sh.deleteRow(baris);
      // Matikan semua sesi aktif milik user ini.
      CacheService.getScriptCache().put('dihapus_' + uname, String(Date.now()), 21600);
      return { username: uname };
    });
  });
}

// ============================================================
//  PESAN WHATSAPP
// ============================================================
function kalimatStatus_(status) {
  switch (status) {
    case 'Baru Diterima': return 'barang service Anda telah kami terima.';
    case 'Proses Service': return 'barang service Anda sedang kami kerjakan.';
    case 'Konfirmasi Harga': return 'service barang Anda memerlukan konfirmasi biaya sebelum dilanjutkan.';
    case 'Selesai Service': return 'service barang Anda telah selesai.';
    case 'Menunggu Diambil': return 'service barang Anda telah selesai dan siap diambil.';
    case 'Sudah Diambil': return 'barang service Anda telah diambil.';
    default: return 'berikut informasi service barang Anda.';
  }
}

/** Blok rincian biaya untuk pesan WhatsApp (estimasi saat Konfirmasi Harga). */
function blokBiayaWa_(o) {
  var r = rincianDari_(o);
  var st = o.statusPengerjaan;
  if (r.garansi) {
    return (st === 'Selesai Service' || st === 'Menunggu Diambil' || st === 'Sudah Diambil')
      ? 'Biaya: Rp 0 (ditanggung garansi)\n\n' : '';
  }
  if (r.total <= 0) return '';
  var konfirmasi = st === 'Konfirmasi Harga';
  var t = konfirmasi ? 'Estimasi biaya service:\n' : 'Rincian biaya:\n';
  r.items.forEach(function (x) {
    t += '- ' + x.nama + ' (' + x.qty + ' x ' + rupiah_(x.harga) + ') = ' + rupiah_(x.subtotal) + '\n';
  });
  if (r.jasa > 0) t += '- Biaya jasa = ' + rupiah_(r.jasa) + '\n';
  t += (konfirmasi ? 'Total estimasi: ' : 'Total biaya: ') + rupiah_(r.total) + '\n';
  if (konfirmasi) {
    t += '\nMohon balas pesan ini untuk menyetujui atau menolak estimasi tersebut. ' +
      'Biaya dapat berubah jika ditemukan kerusakan tambahan, dan akan kami konfirmasi lebih dulu.\n';
  }
  return t + '\n';
}

function tglId_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(s || '');
}

/** Pesan WhatsApp berisi nota lengkap (data barang + rincian biaya). */
function susunPesanNotaWa_(o) {
  var r = rincianDari_(o);
  var est = !r.garansi && ['Baru Diterima', 'Proses Service', 'Konfirmasi Harga'].indexOf(o.statusPengerjaan) >= 0;
  var t = '*NOTA SERVICE*\n' + CONFIG.TOKO.NAMA + '\n' + CONFIG.TOKO.ALAMAT + '\n\n' +
    'No. Nota: ' + o.nomorNota + '\n' +
    'Tgl Masuk: ' + String(o.tanggalMasuk).substring(0, 16) + '\n' +
    'Konsumen: ' + o.nama + '\n' +
    'Barang: ' + o.brand + ' ' + o.tipe + '\n' +
    'No. Seri: ' + o.noSeri + '\n' +
    'Garansi: ' + o.statusGaransi + '\n' +
    (o.tanggalPembelian ? 'Tgl Pembelian: ' + tglId_(o.tanggalPembelian) + '\n' : '') +
    'Keluhan: ' + o.keluhan + '\n' +
    'Status: ' + o.statusPengerjaan + '\n';
  if (r.garansi || r.items.length || r.jasa) {
    t += '\n*' + (est ? 'ESTIMASI BIAYA' : 'RINCIAN BIAYA') + '*\n';
    r.items.forEach(function (x) {
      t += '- ' + x.nama + ' (' + x.qty + ' x ' + rupiah_(x.harga) + ') = ' + rupiah_(x.subtotal) + '\n';
    });
    t += '- Biaya jasa = ' + rupiah_(r.jasa) + '\n';
    t += '*' + (est ? 'Total estimasi: ' : 'Total biaya: ') + rupiah_(r.total) + '*\n';
    if (r.garansi) t += '(Ditanggung garansi)\n';
    else if (est) t += '(Estimasi, belum final. Menunggu konfirmasi Anda.)\n';
  }
  t += '\nPantau status service:\n' + tautanPelacakan_(o.token) + '\n';
  if (CONFIG.TOKO.CATATAN_NOTA) t += '\n' + CONFIG.TOKO.CATATAN_NOTA + '\n';
  return t;
}

function susunPesanWa_(o) {
  return 'Halo Bapak/Ibu ' + o.nama + ', ' + kalimatStatus_(o.statusPengerjaan) + '\n\n' +
    'Nomor Nota: ' + o.nomorNota + '\n' +
    'Brand/Tipe: ' + o.brand + ' ' + o.tipe + '\n' +
    'Status: ' + o.statusPengerjaan + '\n\n' +
    blokBiayaWa_(o) +
    'Untuk melihat perkembangan service, silakan klik tautan berikut:\n' +
    tautanPelacakan_(o.token) + '\n\n' +
    'Terima kasih telah mempercayakan service kepada kami.\n' +
    CONFIG.TOKO.NAMA;
}

/**
 * Menyusun pesan + tautan WhatsApp. Pesan TIDAK terkirim otomatis:
 * admin harus menekan tombol kirim di aplikasi WhatsApp.
 */
function buatPesanWhatsApp(token, id, jenis) {
  return tangani_(function () {
    wajibAdmin_(token);
    var o = muatServiceById_(id);
    var nomor = normalisasiNoHp_(o.noHp);
    if (!nomor) gagal_('Nomor HP konsumen tidak valid. Perbaiki lewat menu Edit.');
    var pesan = jenis === 'nota' ? susunPesanNotaWa_(o) : susunPesanWa_(o);
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
      id: o.id, nomorNota: o.nomorNota, tanggalMasuk: o.tanggalMasuk, nama: o.nama, noHp: o.noHp, tanggalPembelian: o.tanggalPembelian,
      brand: o.brand, tipe: o.tipe, noSeri: o.noSeri, statusGaransi: o.statusGaransi,
      keluhan: o.keluhan, statusPengerjaan: o.statusPengerjaan, rincian: rincianDari_(o), toko: CONFIG.TOKO
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
      tanggalMasuk: o.tanggalMasuk, statusGaransi: o.statusGaransi, keluhan: o.keluhan,
      statusPengerjaan: o.statusPengerjaan, langkah: langkah, riwayat: riwayat, rincian: rincianDari_(o),
      diperbaruiPada: terakhir,
      toko: {
        NAMA: CONFIG.TOKO.NAMA, ALAMAT: CONFIG.TOKO.ALAMAT, TELP: CONFIG.TOKO.TELP,
        WA: CONFIG.TOKO.WA, JAM_OPERASIONAL: CONFIG.TOKO.JAM_OPERASIONAL
      }
    };
  });
}