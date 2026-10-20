(function () {
  'use strict';

  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var KELAS_STATUS = {
    'Baru Diterima': 'baru', 'Proses Service': 'proses', 'Konfirmasi Harga': 'konfirmasi',
    'Selesai Service': 'selesai', 'Menunggu Diambil': 'menunggu', 'Sudah Diambil': 'diambil'
  };
  var STAT_ID = {
    'Baru Diterima': 'stBaru', 'Proses Service': 'stProses', 'Konfirmasi Harga': 'stKonfirmasi',
    'Selesai Service': 'stSelesai', 'Menunggu Diambil': 'stMenunggu', 'Sudah Diambil': 'stDiambil'
  };

  var STATE = {
    token: '', user: '', toko: {}, statusList: [],
    rows: [], seq: 0,
    editId: null, editAsli: null,
    detail: null, statusRow: null, hapusRow: null, nota: null,
    wa: { nomor: '', id: '', tautan: '' }
  };
  var memToken = '';

  function $(id) { return document.getElementById(id); }
  function val(id) { return $(id).value.trim(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTgl(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    if (!m) return s || '-';
    return parseInt(m[3], 10) + ' ' + BULAN[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }
  function fmtWaktu(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
    if (!m) return s || '-';
    return fmtTgl(s) + ', ' + m[4] + '.' + m[5] + ' WIB';
  }
  function fmtHp(s) { return s ? '+' + s : '-'; }
  function badgeStatus(st) { return '<span class="badge st-' + (KELAS_STATUS[st] || 'baru') + '">' + esc(st) + '</span>'; }
  function badgeGaransi(g) { return '<span class="badge ' + (g === 'Garansi' ? 'gr-garansi' : 'gr-non') + '">' + esc(g) + '</span>'; }

  function simpanToken(t) { memToken = t; try { sessionStorage.setItem('svc_token', t); } catch (e) {} }
  function bacaToken() { try { return sessionStorage.getItem('svc_token') || memToken; } catch (e) { return memToken; } }
  function hapusToken() { memToken = ''; try { sessionStorage.removeItem('svc_token'); } catch (e) {} }

  // ---------------------------------------------------------------- API
  function api(nama) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var r = google.script.run
        .withSuccessHandler(function (res) {
          if (res && res.ok) { resolve(res.data); return; }
          var e = new Error((res && res.error) || 'Terjadi kesalahan.');
          e.code = (res && res.code) || 'ERR';
          reject(e);
        })
        .withFailureHandler(function (err) {
          var e = new Error((err && err.message) || 'Gagal menghubungi server.');
          e.code = 'NET';
          reject(e);
        });
      r[nama].apply(r, args);
    });
  }
  function apiAuth(nama) {
    var args = [nama, STATE.token].concat(Array.prototype.slice.call(arguments, 1));
    return api.apply(null, args).catch(function (e) {
      if (e.code === 'AUTH') paksaKeluar(e.message);
      throw e;
    });
  }

  // ---------------------------------------------------------------- UI umum
  function toast(msg, tipe) {
    var d = document.createElement('div');
    d.className = 'toast ' + (tipe || '');
    d.textContent = msg;
    $('toastWrap').appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 4000);
  }
  function showErr(e) { if (e && e.code !== 'AUTH') toast(e.message || 'Terjadi kesalahan.', 'err'); }

  function bukaModal(id) {
    $(id).classList.add('open');
    document.body.classList.add('modal-open');
  }
  function tutupModal(id) {
    $(id).classList.remove('open');
    if (!document.querySelector('.modal.open')) document.body.classList.remove('modal-open');
    if (id === 'modalNota') document.body.classList.remove('printing-nota');
  }
  function sibuk(btn, on, teks) {
    if (on) { btn.dataset.asli = btn.textContent; btn.textContent = teks || 'Memproses...'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.asli || btn.textContent; btn.disabled = false; }
  }
  function tampilError(id, msg) {
    var el = $(id);
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg; el.classList.remove('hidden');
  }
  function salin(teks) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = teks; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      toast(ok ? 'Tautan disalin.' : 'Gagal menyalin. Salin manual.', ok ? 'ok' : 'err');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(teks).then(function () { toast('Tautan disalin.', 'ok'); }, fallback);
    } else { fallback(); }
  }

  // ---------------------------------------------------------------- Tampilan login / app
  function tampilLogin(pesan) {
    $('splash').classList.add('hidden');
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    tampilError('loginError', pesan || '');
    $('lPass').value = '';
  }
  function tampilApp(info) {
    STATE.token = info.token; STATE.user = info.username;
    STATE.toko = info.toko || {}; STATE.statusList = info.statusList || [];
    simpanToken(info.token);
    $('brandName').textContent = STATE.toko.NAMA || 'Nota Service';
    $('userName').textContent = STATE.user;
    STATE.adminPertama = !!info.adminPertama;
    $('btnUser').classList.toggle('hidden', !STATE.adminPertama);
    isiPilihanStatus();
    $('splash').classList.add('hidden');
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    muatData();
  }
  function paksaKeluar(pesan) {
    STATE.token = ''; STATE.adminPertama = false; hapusToken();
    $('btnUser').classList.add('hidden');
    ['modalForm', 'modalDetail', 'modalStatus', 'modalWa', 'modalNota', 'modalHapus', 'modalUser'].forEach(tutupModal);
    tampilLogin(pesan || 'Sesi berakhir. Silakan login kembali.');
  }
  function isiPilihanStatus() {
    var opsi = STATE.statusList.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    $('fStatus').innerHTML = opsi;
    $('sStatus').innerHTML = opsi;
    $('fcStatus').innerHTML = '<option value="">Semua status</option>' + opsi;
  }

  // ---------------------------------------------------------------- Login / Logout
  $('formLogin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var u = val('lUser'), p = $('lPass').value;
    if (!u || !p) { tampilError('loginError', 'Username dan password wajib diisi.'); return; }
    var btn = $('btnLogin');
    tampilError('loginError', '');
    sibuk(btn, true, 'Memeriksa...');
    api('loginAdmin', u, p).then(function (info) {
      sibuk(btn, false);
      $('lPass').value = '';
      tampilApp(info);
    }).catch(function (e) {
      sibuk(btn, false);
      tampilError('loginError', e.message);
    });
  });
  $('lShow').addEventListener('change', function () { $('lPass').type = this.checked ? 'text' : 'password'; });
  $('btnLogout').addEventListener('click', function () {
    var t = STATE.token;
    api('logoutAdmin', t).then(function () {}, function () {}).then(function () { paksaKeluar('Anda telah keluar.'); });
  });

  // ---------------------------------------------------------------- Dashboard & daftar
  function bacaFilter() {
    return { q: val('fcQ'), status: $('fcStatus').value, garansi: $('fcGaransi').value, dari: $('fcDari').value, sampai: $('fcSampai').value };
  }
  function muatData() {
    var seq = ++STATE.seq;
    return apiAuth('cariService', bacaFilter()).then(function (d) {
      if (seq !== STATE.seq) return;
      STATE.rows = d.rows;
      renderStats(d.stats);
      renderList(d.rows, d.total, d.stats.total);
    }).catch(showErr);
  }
  function renderStats(st) {
    $('stTotal').textContent = st.total;
    Object.keys(STAT_ID).forEach(function (k) { $(STAT_ID[k]).textContent = st.perStatus[k] || 0; });
    var aktif = $('fcStatus').value;
    Array.prototype.forEach.call(document.querySelectorAll('#stats .stat'), function (b) {
      var s = b.getAttribute('data-status');
      b.classList.toggle('aktif', !b.classList.contains('stat-total') && s === aktif);
    });
  }
  function tombol(act, label, kelas, id) {
    return '<button type="button" class="btn btn-sm ' + kelas + '" data-act="' + act + '" data-id="' + esc(id) + '">' + label + '</button>';
  }
  function aksiHtml(r) {
    return '<div class="aksi">' +
      tombol('detail', 'Detail', 'btn-ghost', r.id) +
      tombol('edit', 'Edit', 'btn-ghost', r.id) +
      tombol('status', 'Ubah Status', 'btn-soft', r.id) +
      tombol('nota', 'Cetak Nota', 'btn-ghost', r.id) +
      tombol('wa', 'WhatsApp', 'btn-wa', r.id) +
      tombol('hapus', 'Hapus', 'btn-danger', r.id) +
      '</div>';
  }
  function renderList(rows, total, semua) {
    var tb = '', cards = '';
    rows.forEach(function (r) {
      tb += '<tr>' +
        '<td><div class="nota-no">' + esc(r.nomorNota) + '</div></td>' +
        '<td>' + esc(fmtTgl(r.tanggalMasuk)) + '<div class="sub">' + esc((r.tanggalMasuk || '').substring(11, 16)) + '</div></td>' +
        '<td><b>' + esc(r.nama) + '</b><div class="sub">' + esc(fmtHp(r.noHp)) + '</div></td>' +
        '<td>' + esc(r.brand) + ' ' + esc(r.tipe) + '<div class="sub">SN: ' + esc(r.noSeri) + '</div></td>' +
        '<td>' + badgeGaransi(r.statusGaransi) + '</td>' +
        '<td>' + badgeStatus(r.statusPengerjaan) + '</td>' +
        '<td>' + aksiHtml(r) + '</td></tr>';
      cards += '<div class="svc-card">' +
        '<div class="top"><div><div class="nota-no">' + esc(r.nomorNota) + '</div><div class="sub">' + esc(fmtWaktu(r.tanggalMasuk)) + '</div></div>' + badgeStatus(r.statusPengerjaan) + '</div>' +
        '<div class="row"><b>' + esc(r.nama) + '</b> &middot; ' + esc(fmtHp(r.noHp)) + '</div>' +
        '<div class="row">' + esc(r.brand) + ' ' + esc(r.tipe) + ' ' + badgeGaransi(r.statusGaransi) + '</div>' +
        aksiHtml(r) + '</div>';
    });
    $('tbody').innerHTML = tb;
    $('cardList').innerHTML = cards;
    $('emptyState').classList.toggle('hidden', rows.length > 0);
    $('emptyState').textContent = semua === 0 ? 'Belum ada nota service. Klik "+ Nota Baru" untuk mulai.' : 'Tidak ada data yang cocok dengan filter.';
    $('listMeta').textContent = 'Menampilkan ' + total + ' dari ' + semua + ' nota (terbaru di atas)';
  }
  function cariRow(id) {
    for (var i = 0; i < STATE.rows.length; i++) if (STATE.rows[i].id === id) return STATE.rows[i];
    return null;
  }

  var tunda = null;
  $('fcQ').addEventListener('input', function () { clearTimeout(tunda); tunda = setTimeout(muatData, 350); });
  ['fcStatus', 'fcGaransi', 'fcDari', 'fcSampai'].forEach(function (id) { $(id).addEventListener('change', muatData); });
  $('btnResetFilter').addEventListener('click', function () {
    $('fcQ').value = ''; $('fcStatus').value = ''; $('fcGaransi').value = ''; $('fcDari').value = ''; $('fcSampai').value = '';
    muatData();
  });
  $('stats').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.stat') : null;
    if (!b) return;
    $('fcStatus').value = b.getAttribute('data-status') || '';
    muatData();
  });

  function aksiKlik(ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
    if (!b) return;
    var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
    var row = cariRow(id);
    if (!row) { toast('Data tidak ditemukan. Muat ulang daftar.', 'err'); return; }
    if (act === 'detail') bukaDetail(id);
    else if (act === 'edit') bukaForm(row);
    else if (act === 'status') bukaStatus(row);
    else if (act === 'nota') bukaNota(id);
    else if (act === 'wa') bukaWa(id, 'Kirim Status via WhatsApp');
    else if (act === 'hapus') bukaHapus(row);
  }
  $('tbody').addEventListener('click', aksiKlik);
  $('cardList').addEventListener('click', aksiKlik);

  // ---------------------------------------------------------------- Penutup modal
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var id = t && t.getAttribute ? t.getAttribute('data-close') : null;
    if (id) tutupModal(id);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    var terbuka = document.querySelectorAll('.modal.open');
    if (!terbuka.length) return;
    var m = terbuka[terbuka.length - 1];
    if (m.id !== 'modalForm') tutupModal(m.id);
  });

  // ---------------------------------------------------------------- Form tambah / edit
  function aturOpsiStatus(selectId, garansi) {
    var sel = $(selectId), gar = garansi === 'Garansi';
    Array.prototype.forEach.call(sel.options, function (o) {
      if (o.value === 'Konfirmasi Harga') { o.disabled = gar; o.hidden = gar; }
    });
    if (gar && sel.value === 'Konfirmasi Harga') sel.value = 'Proses Service';
  }
  function hariIni() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function aturTglBeli() {
    var gar = $('fGaransi').value === 'Garansi';
    $('wrapTglBeli').classList.toggle('hidden', !gar);
    if (!gar) $('fTglBeli').value = '';
  }
  function isiForm(r) {
    r = r || {};
    $('fNomor').value = r.nomorNota || 'Dibuat otomatis saat disimpan';
    $('fTglMasuk').value = r.tanggalMasuk ? fmtWaktu(r.tanggalMasuk) : 'Otomatis (hari ini)';
    $('fNama').value = r.nama || '';
    $('fHp').value = r.noHp ? '+' + r.noHp : '';
    $('fBrand').value = r.brand || '';
    $('fTipe').value = r.tipe || '';
    $('fSeri').value = (r.noSeri && r.noSeri !== '-') ? r.noSeri : '';
    $('fGaransi').value = r.statusGaransi || '';
    $('fTglBeli').max = hariIni();
    $('fTglBeli').value = r.tanggalPembelian || '';
    aturTglBeli();
    $('fKeluhan').value = r.keluhan || '';
    $('fStatus').value = r.statusPengerjaan || 'Baru Diterima';
    $('fCatatan').value = r.catatanTeknisi || '';
    $('fSelesai').value = r.tanggalSelesai ? fmtWaktu(r.tanggalSelesai) : 'Otomatis saat status Selesai Service';
    $('fDiambil').value = r.tanggalDiambil ? fmtWaktu(r.tanggalDiambil) : 'Otomatis saat status Sudah Diambil';
    aturOpsiStatus('fStatus', $('fGaransi').value);
    tampilError('formError', '');
    Array.prototype.forEach.call(document.querySelectorAll('#formService .invalid'), function (e) { e.classList.remove('invalid'); });
  }
  function bukaForm(row) {
    STATE.editId = row ? row.id : null;
    STATE.editAsli = row || null;
    $('formTitle').textContent = row ? 'Edit Nota Service ' + row.nomorNota : 'Nota Service Baru';
    $('btnFormNota').classList.toggle('hidden', !row);
    isiForm(row);
    tutupModal('modalDetail');
    bukaModal('modalForm');
    setTimeout(function () { $('fNama').focus(); }, 50);
  }
  $('btnBaru').addEventListener('click', function () { bukaForm(null); });
  $('fGaransi').addEventListener('change', function () { aturOpsiStatus('fStatus', this.value); aturTglBeli(); });
  $('btnFormReset').addEventListener('click', function () { isiForm(STATE.editAsli); });
  $('btnFormNota').addEventListener('click', function () { if (STATE.editId) bukaNota(STATE.editId); });

  function ambilForm() {
    return {
      nama: val('fNama'), noHp: val('fHp'), brand: val('fBrand'), tipe: val('fTipe'), noSeri: val('fSeri'),
      statusGaransi: $('fGaransi').value,
      tanggalPembelian: $('fGaransi').value === 'Garansi' ? $('fTglBeli').value : '',
      keluhan: val('fKeluhan'), statusPengerjaan: $('fStatus').value,
      catatanTeknisi: val('fCatatan')
    };
  }
  function cekForm(d) {
    if (!d.nama) return ['fNama', 'Nama konsumen wajib diisi.'];
    var digit = d.noHp.replace(/[\s\-().+]/g, '');
    if (!/^\d{9,15}$/.test(digit)) return ['fHp', 'Nomor HP/WhatsApp tidak valid. Contoh: 081234567890.'];
    if (!d.brand) return ['fBrand', 'Brand/Merek wajib diisi.'];
    if (!d.tipe) return ['fTipe', 'Tipe/Model wajib diisi.'];
    if (!d.statusGaransi) return ['fGaransi', 'Pilih status garansi.'];
    if (d.statusGaransi === 'Garansi') {
      if (!d.tanggalPembelian) return ['fTglBeli', 'Tanggal pembelian wajib diisi untuk service Garansi.'];
      if (d.tanggalPembelian > hariIni()) return ['fTglBeli', 'Tanggal pembelian tidak boleh melewati hari ini.'];
    }
    if (!d.keluhan) return ['fKeluhan', 'Keluhan konsumen wajib diisi.'];
    if (d.statusGaransi === 'Garansi' && d.statusPengerjaan === 'Konfirmasi Harga') return ['fStatus', 'Konfirmasi Harga hanya untuk Non Garansi.'];
    return null;
  }
  $('formService').addEventListener('submit', function (ev) {
    ev.preventDefault();
    Array.prototype.forEach.call(document.querySelectorAll('#formService .invalid'), function (e) { e.classList.remove('invalid'); });
    var d = ambilForm();
    var err = cekForm(d);
    if (err) { $(err[0]).classList.add('invalid'); $(err[0]).focus(); tampilError('formError', err[1]); return; }
    tampilError('formError', '');
    var btn = $('btnFormSimpan');
    sibuk(btn, true, 'Menyimpan...');
    var edit = !!STATE.editId;
    var p = edit ? apiAuth('editService', STATE.editId, d) : apiAuth('tambahService', d);
    p.then(function (res) {
      sibuk(btn, false);
      tutupModal('modalForm');
      muatData();
      if (edit) { toast('Perubahan tersimpan.', 'ok'); }
      else {
        toast('Nota ' + res.service.nomorNota + ' tersimpan.', 'ok');
        bukaWa(res.service.id, 'Nota Tersimpan');
      }
    }).catch(function (e) {
      sibuk(btn, false);
      if (e.code !== 'AUTH') tampilError('formError', e.message);
    });
  });

  // ---------------------------------------------------------------- Detail
  function bukaDetail(id) {
    apiAuth('ambilDetail', id).then(function (d) {
      STATE.detail = d.service;
      var s = d.service;
      var h = '<div class="detail-grid">' +
        item('Nomor Nota', esc(s.nomorNota)) + item('Tanggal Masuk', esc(fmtWaktu(s.tanggalMasuk))) +
        item('Nama Konsumen', esc(s.nama)) + item('No. HP / WhatsApp', esc(fmtHp(s.noHp))) +
        item('Brand', esc(s.brand)) + item('Tipe / Model', esc(s.tipe)) +
        item('Nomor Seri', esc(s.noSeri)) + item('Status Garansi', badgeGaransi(s.statusGaransi)) +
        (s.statusGaransi === 'Garansi' ? item('Tanggal Pembelian', esc(s.tanggalPembelian ? fmtTgl(s.tanggalPembelian) : '-')) : '') +
        item('Status Pengerjaan', badgeStatus(s.statusPengerjaan)) + item('Terakhir Diperbarui', esc(fmtWaktu(s.terakhirDiperbarui))) +
        item('Tanggal Selesai', esc(s.tanggalSelesai ? fmtWaktu(s.tanggalSelesai) : '-')) + item('Tanggal Diambil', esc(s.tanggalDiambil ? fmtWaktu(s.tanggalDiambil) : '-')) +
        '<div class="full">' + item('Keluhan Konsumen', esc(s.keluhan)) + '</div>' +
        '<div class="full">' + item('Catatan Teknisi (internal)', esc(s.catatanTeknisi || '-')) + '</div>' +
        '<div class="full"><div class="dl">Tautan Pelacakan Konsumen</div><div class="link-box">' +
        '<input type="text" readonly id="dtLink" value="' + esc(s.tautanPelacakan) + '">' +
        '<button type="button" class="btn btn-sm btn-ghost" id="dtSalin">Salin</button>' +
        '<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener noreferrer" href="' + esc(s.tautanPelacakan) + '">Buka</a></div></div>' +
        '<div class="full"><div class="dl">Riwayat Status</div><ul class="riwayat">';
      d.riwayat.slice().reverse().forEach(function (r) {
        h += '<li><b>' + esc(r.sebelum === '-' ? 'Dibuat: ' + r.baru : r.sebelum + ' → ' + r.baru) + '</b>' +
          '<div class="wkt">' + esc(fmtWaktu(r.waktu)) + (r.keterangan ? ' &middot; ' + esc(r.keterangan) : '') + '</div></li>';
      });
      h += '</ul></div></div>';
      $('detailTitle').textContent = 'Detail ' + s.nomorNota;
      $('detailBody').innerHTML = h;
      $('dtSalin').addEventListener('click', function () { salin(s.tautanPelacakan); });
      bukaModal('modalDetail');
    }).catch(showErr);
  }
  function item(label, isi) { return '<div><div class="dl">' + label + '</div><div class="dv">' + isi + '</div></div>'; }
  $('dtEdit').addEventListener('click', function () { if (STATE.detail) bukaForm(STATE.detail); });
  $('dtStatus').addEventListener('click', function () { if (STATE.detail) { tutupModal('modalDetail'); bukaStatus(STATE.detail); } });
  $('dtNota').addEventListener('click', function () { if (STATE.detail) bukaNota(STATE.detail.id); });
  $('dtWa').addEventListener('click', function () { if (STATE.detail) bukaWa(STATE.detail.id, 'Kirim Status via WhatsApp'); });

  // ---------------------------------------------------------------- Ubah status
  function bukaStatus(row) {
    STATE.statusRow = row;
    $('sNota').textContent = row.nomorNota;
    $('sInfo').textContent = row.nama + ' · ' + row.brand + ' ' + row.tipe + ' · Status saat ini: ' + row.statusPengerjaan;
    $('sStatus').value = row.statusPengerjaan;
    aturOpsiStatus('sStatus', row.statusGaransi);
    $('sHint').textContent = row.statusGaransi === 'Garansi' ? 'Service Garansi: status "Konfirmasi Harga" tidak tersedia.' : '';
    $('sKet').value = '';
    tampilError('statusError', '');
    bukaModal('modalStatus');
  }
  $('formStatus').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var row = STATE.statusRow;
    if (!row) return;
    var st = $('sStatus').value;
    if (st === row.statusPengerjaan) { tampilError('statusError', 'Pilih status yang berbeda dari status saat ini.'); return; }
    var btn = $('btnStatusSimpan');
    sibuk(btn, true, 'Menyimpan...');
    var kirimWa = $('sWa').checked;
    apiAuth('ubahStatus', row.id, st, val('sKet')).then(function (res) {
      sibuk(btn, false);
      tutupModal('modalStatus');
      toast('Status diperbarui menjadi "' + res.service.statusPengerjaan + '".', 'ok');
      muatData();
      if (kirimWa) bukaWa(row.id, 'Status Diperbarui');
    }).catch(function (e) {
      sibuk(btn, false);
      if (e.code !== 'AUTH') tampilError('statusError', e.message);
    });
  });

  // ---------------------------------------------------------------- WhatsApp
  function urlWa() {
    return 'https://wa.me/' + STATE.wa.nomor + '?text=' + encodeURIComponent($('waPesan').value);
  }
  function bukaWa(id, judul) {
    apiAuth('buatPesanWhatsApp', id).then(function (d) {
      STATE.wa = { nomor: d.nomor, id: id, tautan: d.tautan };
      $('waTitle').textContent = judul || 'Kirim Status via WhatsApp';
      $('waNota').textContent = d.nomorNota;
      $('waNomor').textContent = '+' + d.nomor;
      $('waPesan').value = d.pesan;
      $('waLink').href = d.url;
      bukaModal('modalWa');
    }).catch(showErr);
  }
  $('waPesan').addEventListener('input', function () { $('waLink').href = urlWa(); });
  $('waSalin').addEventListener('click', function () { salin(STATE.wa.tautan); });
  $('waNotaBtn').addEventListener('click', function () { if (STATE.wa.id) bukaNota(STATE.wa.id); });

  // ---------------------------------------------------------------- Nota & cetak
  function paperTerpilih() {
    var r = document.querySelector('input[name="paper"]:checked');
    return r ? r.value : 'a4';
  }
  function baris(k, v) {
    return '<div class="nota-row"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }
  function renderNota() {
    var d = STATE.nota;
    if (!d) return;
    var t = d.toko || {};
    var h = '<div class="nota paper-' + paperTerpilih() + '" id="notaPrint">' +
      '<div class="nota-head"><div class="nota-toko">' + esc(t.NAMA) + '</div>' +
      '<div class="nota-alamat">' + esc(t.ALAMAT) + '</div><div class="nota-alamat">Telp: ' + esc(t.TELP) + '</div></div>' +
      '<div class="nota-judul">NOTA SERVICE</div>' +
      baris('No. Nota', d.nomorNota) + baris('Tgl Masuk', fmtWaktu(d.tanggalMasuk)) +
      '<div class="nota-sep"></div>' +
      baris('Konsumen', d.nama) + baris('No. HP', fmtHp(d.noHp)) +
      '<div class="nota-sep"></div>' +
      baris('Barang', d.brand + ' ' + d.tipe) + baris('No. Seri', d.noSeri) + baris('Garansi', d.statusGaransi) +
      (d.statusGaransi === 'Garansi' && d.tanggalPembelian ? baris('Tgl Beli', fmtTgl(d.tanggalPembelian)) : '') +
      baris('Keluhan', d.keluhan) + baris('Status', d.statusPengerjaan) +
      '<div class="nota-sep"></div>' +
      '<div class="nota-ttd"><div><div>Konsumen</div><div class="ttd-space"></div><div class="ttd-nama">' + esc(d.nama) + '</div></div>' +
      '<div><div>Teknisi</div><div class="ttd-space"></div><div class="ttd-nama">&nbsp;</div></div></div>' +
      (t.CATATAN_NOTA ? '<div class="nota-foot">' + esc(t.CATATAN_NOTA) + '</div>' : '') +
      '</div>';
    $('notaBox').innerHTML = h;
  }
  function bukaNota(id) {
    apiAuth('ambilDataNota', id).then(function (d) {
      STATE.nota = d;
      var simpan = 'a4';
      try { simpan = localStorage.getItem('svc_paper') || 'a4'; } catch (e) {}
      var radio = document.querySelector('input[name="paper"][value="' + simpan + '"]') || document.querySelector('input[name="paper"][value="a4"]');
      radio.checked = true;
      renderNota();
      bukaModal('modalNota');
    }).catch(showErr);
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="paper"]'), function (r) {
    r.addEventListener('change', function () {
      try { localStorage.setItem('svc_paper', paperTerpilih()); } catch (e) {}
      renderNota();
    });
  });
  $('btnCetak').addEventListener('click', function () {
    $('pageStyle').textContent = paperTerpilih() === '58'
      ? '@page { size: 58mm auto; margin: 0; }'
      : '@page { size: A4; margin: 12mm; }';
    document.body.classList.add('printing-nota');
    window.addEventListener('afterprint', function () { document.body.classList.remove('printing-nota'); }, { once: true });
    setTimeout(function () { window.print(); }, 80);
  });

  // ---------------------------------------------------------------- Hapus
  function bukaHapus(row) {
    STATE.hapusRow = row;
    $('hNota').textContent = row.nomorNota;
    $('hNama').textContent = row.nama;
    bukaModal('modalHapus');
  }
  $('btnHapusYa').addEventListener('click', function () {
    var row = STATE.hapusRow;
    if (!row) return;
    var btn = $('btnHapusYa');
    sibuk(btn, true, 'Menghapus...');
    apiAuth('hapusService', row.id).then(function () {
      sibuk(btn, false);
      tutupModal('modalHapus');
      toast('Nota ' + row.nomorNota + ' dihapus.', 'ok');
      muatData();
    }).catch(function (e) { sibuk(btn, false); showErr(e); });
  });

  // ---------------------------------------------------------------- Kelola user (khusus admin pertama)
  function renderUsers(users) {
    var h = '';
    users.forEach(function (u) {
      h += '<li><b>' + esc(u.username) + '</b>' + (u.pertama ? ' <span class="badge st-baru">Admin pertama</span>' : '') +
        '<div class="wkt">' + esc(u.role) + ' &middot; ' + esc(u.statusAkun) + '</div></li>';
    });
    $('userList').innerHTML = h || '<li>Belum ada user.</li>';
  }
  function muatUsers() {
    $('userList').innerHTML = '<li>Memuat...</li>';
    return apiAuth('daftarUser').then(function (d) { renderUsers(d.users); }).catch(function (e) {
      $('userList').innerHTML = '';
      showErr(e);
    });
  }
  $('btnUser').addEventListener('click', function () {
    $('formUser').reset();
    $('uPass').type = 'password'; $('uPass2').type = 'password';
    tampilError('userError', '');
    bukaModal('modalUser');
    muatUsers();
  });
  $('uShow').addEventListener('change', function () {
    var t = this.checked ? 'text' : 'password';
    $('uPass').type = t; $('uPass2').type = t;
  });
  $('formUser').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var u = val('uNama').toLowerCase(), p = $('uPass').value, p2 = $('uPass2').value;
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) { tampilError('userError', 'Username 3-30 karakter (huruf, angka, titik, garis bawah, strip).'); return; }
    if (p.length < 8) { tampilError('userError', 'Password minimal 8 karakter.'); return; }
    if (p !== p2) { tampilError('userError', 'Ulangi password tidak sama.'); return; }
    tampilError('userError', '');
    var btn = $('btnUserSimpan');
    sibuk(btn, true, 'Menyimpan...');
    apiAuth('tambahUser', u, p).then(function (res) {
      sibuk(btn, false);
      $('formUser').reset();
      toast('User "' + res.username + '" ditambahkan.', 'ok');
      muatUsers();
    }).catch(function (e) {
      sibuk(btn, false);
      if (e.code !== 'AUTH') tampilError('userError', e.message);
    });
  });

  // ---------------------------------------------------------------- Mulai
  (function mulai() {
    var t = bacaToken();
    if (!t) { tampilLogin(''); return; }
    api('cekSesi', t).then(tampilApp).catch(function () { hapusToken(); tampilLogin(''); });
  })();
})();
