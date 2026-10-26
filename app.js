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
    token: '', user: '', pemilik: false, toko: {}, statusList: [],
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
    var url = (window.APP_CONFIG || {}).API_URL || '';
    if (!/^https:\/\//.test(url)) {
      var ec = new Error('API_URL di config.js belum diisi dengan URL Web App Apps Script.');
      ec.code = 'CONFIG';
      return Promise.reject(ec);
    }
    // Content-Type text/plain agar browser tidak mengirim preflight (Apps Script tidak mendukung OPTIONS).
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: nama, args: args }),
      redirect: 'follow'
    })
      .then(function (r) { return r.json(); })
      .catch(function () {
        var e = new Error('Gagal menghubungi server. Periksa koneksi internet.');
        e.code = 'NET';
        throw e;
      })
      .then(function (res) {
        if (res && res.ok) return res.data;
        var e = new Error((res && res.error) || 'Terjadi kesalahan.');
        e.code = (res && res.code) || 'ERR';
        throw e;
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
    STATE.pemilik = !!info.pemilik;
    $('btnUser').classList.toggle('hidden', !STATE.pemilik);
    simpanToken(info.token);
    $('brandName').textContent = STATE.toko.NAMA || 'Nota Service';
    $('userName').textContent = STATE.user;
    isiPilihanStatus();
    $('splash').classList.add('hidden');
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    muatData();
  }
  function paksaKeluar(pesan) {
    STATE.token = ''; STATE.pemilik = false; hapusToken();
    ['modalForm', 'modalDetail', 'modalStatus', 'modalWa', 'modalNota', 'modalJpg', 'modalUser', 'modalHapus'].forEach(tutupModal);
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
  function hapusHtml(r) {
    if (!STATE.pemilik) return '';
    if (r.terkunci) return '<button type="button" class="btn btn-sm btn-danger" disabled title="Nota yang sudah selesai tidak dapat dihapus">Hapus</button>';
    return tombol('hapus', 'Hapus', 'btn-danger', r.id);
  }
  function aksiHtml(r) {
    return '<div class="aksi">' +
      tombol('detail', 'Detail', 'btn-ghost', r.id) +
      (STATE.pemilik ? tombol('edit', 'Edit', 'btn-ghost', r.id) : '') +
      tombol('status', 'Ubah Status', 'btn-soft', r.id) +
      tombol('nota', 'Cetak Nota', 'btn-ghost', r.id) +
      tombol('wa', 'WhatsApp', 'btn-wa', r.id) +
      hapusHtml(r) +
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
    else if (act === 'edit') { if (STATE.pemilik) bukaForm(row); else toast('Hanya admin utama yang dapat mengedit nota.', 'err'); }
    else if (act === 'status') bukaStatus(row);
    else if (act === 'nota') bukaNota(id);
    else if (act === 'wa') bukaWa(id, 'Kirim Status via WhatsApp');
    else if (act === 'hapus') {
      if (!STATE.pemilik) toast('Hanya admin utama yang dapat menghapus nota.', 'err');
      else if (row.terkunci) toast('Nota yang sudah selesai tidak dapat dihapus.', 'err');
      else bukaHapus(row);
    }
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

  // ---------------------------------------------------------------- Rincian biaya (sparepart + jasa)
  var STATUS_ESTIMASI = ['Baru Diterima', 'Proses Service', 'Konfirmasi Harga'];
  var MAKS_SP = 20;
  function angka(s) { var d = String(s == null ? '' : s).replace(/\D/g, ''); return d ? parseInt(d, 10) : 0; }
  function angkaFmt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function rp(n) { return 'Rp ' + angkaFmt(n); }
  function belumFinal(status, garansi) { return !garansi && STATUS_ESTIMASI.indexOf(status) >= 0; }
  function adalahGaransi() { return $('fGaransi').value === 'Garansi'; }

  function barisSpHtml(x) {
    x = x || {};
    return '<div class="sp-row">' +
      '<input type="text" class="sp-nama" maxlength="100" placeholder="Nama sparepart" autocomplete="off" value="' + esc(x.nama || '') + '">' +
      '<input type="text" class="sp-qty" inputmode="numeric" maxlength="3" placeholder="Qty" title="Jumlah" autocomplete="off" value="' + esc(x.qty || 1) + '">' +
      '<input type="text" class="sp-harga" inputmode="numeric" maxlength="13" placeholder="Harga satuan" autocomplete="off" value="' + (x.harga ? angkaFmt(x.harga) : '') + '">' +
      '<button type="button" class="btn btn-sm btn-danger sp-del" aria-label="Hapus sparepart" title="Hapus">&times;</button>' +
      '<div class="sp-sub">Rp 0</div></div>';
  }
  function kunciBiaya(on) {
    Array.prototype.forEach.call(document.querySelectorAll('#spList .sp-harga, #fJasa'), function (el) {
      if (on) {
        if (!el.disabled) el.dataset.prev = el.value;
        el.value = '0'; el.disabled = true;
      } else if (el.disabled) {
        el.value = el.dataset.prev != null ? el.dataset.prev : '';
        el.disabled = false;
      }
    });
  }
  function hitungTotal() {
    var gar = adalahGaransi(), total = 0;
    Array.prototype.forEach.call($('spList').querySelectorAll('.sp-row'), function (r) {
      var q = angka(r.querySelector('.sp-qty').value) || 1;
      var h = gar ? 0 : angka(r.querySelector('.sp-harga').value);
      total += q * h;
      r.querySelector('.sp-sub').textContent = rp(q * h);
    });
    if (!gar) total += angka($('fJasa').value);
    $('fTotal').textContent = rp(total);
    $('fTotalLabel').textContent = belumFinal($('fStatus').value, gar) ? 'Total Estimasi Biaya' : 'Total Biaya';
    $('biayaHint').textContent = gar
      ? 'Service garansi: seluruh biaya otomatis Rp 0. Nama sparepart tetap dicatat pada nota.'
      : 'Isi sparepart yang diganti dan biaya jasa. Total ini menjadi estimasi yang dikirim ke konsumen untuk konfirmasi.';
    return total;
  }
  function tambahBarisSp(x) {
    var w = document.createElement('div');
    w.innerHTML = barisSpHtml(x);
    $('spList').appendChild(w.firstChild);
    kunciBiaya(adalahGaransi());
    hitungTotal();
  }
  function isiBiaya(r) {
    var rin = (r && r.rincian) || { items: [], jasa: 0 };
    $('spList').innerHTML = '';
    var j = $('fJasa');
    j.disabled = false; delete j.dataset.prev;
    j.value = rin.jasa ? angkaFmt(rin.jasa) : '';
    if (rin.items.length) rin.items.forEach(function (x) { tambahBarisSp(x); }); else tambahBarisSp();
    kunciBiaya(adalahGaransi());
    hitungTotal();
  }
  function ambilSparepart() {
    var gar = adalahGaransi(), hasil = [];
    Array.prototype.forEach.call($('spList').querySelectorAll('.sp-row'), function (r) {
      var nama = r.querySelector('.sp-nama').value.trim();
      var harga = gar ? 0 : angka(r.querySelector('.sp-harga').value);
      var qty = angka(r.querySelector('.sp-qty').value) || 1;
      if (nama || harga) hasil.push({ nama: nama, qty: qty, harga: harga });
    });
    return hasil;
  }
  $('spList').addEventListener('input', hitungTotal);
  $('fJasa').addEventListener('input', hitungTotal);
  $('fStatus').addEventListener('change', hitungTotal);
  $('spList').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.sp-del') : null;
    if (!b) return;
    var r = b.parentNode;
    r.parentNode.removeChild(r);
    hitungTotal();
  });
  $('btnTambahSp').addEventListener('click', function () {
    if ($('spList').children.length >= MAKS_SP) { toast('Maksimal ' + MAKS_SP + ' sparepart.', 'err'); return; }
    tambahBarisSp();
    var n = $('spList').querySelectorAll('.sp-nama');
    n[n.length - 1].focus();
  });
  $('formService').addEventListener('focusout', function (ev) {
    var t = ev.target;
    if (!t || !t.classList || t.disabled) return;
    if (t.classList.contains('sp-harga') || t.id === 'fJasa') t.value = t.value ? angkaFmt(angka(t.value)) : '';
    else if (t.classList.contains('sp-qty')) t.value = String(angka(t.value) || 1);
  });

  // ---------------------------------------------------------------- Form tambah / edit
  function aturOpsiStatus(selectId, garansi) {
    var sel = $(selectId), gar = garansi === 'Garansi';
    Array.prototype.forEach.call(sel.options, function (o) {
      if (o.value === 'Konfirmasi Harga') { o.disabled = gar; o.hidden = gar; }
    });
    if (gar && sel.value === 'Konfirmasi Harga') sel.value = 'Proses Service';
  }
  // Garansi berlaku 2 tahun sejak tanggal pembelian; lewat dari itu dihitung Non Garansi.
  function hariIni() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function batasGaransi(tgl) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tgl || '');
    return m ? (Number(m[1]) + 2) + '-' + m[2] + '-' + m[3] : '';
  }
  function masaGaransiHabis(tgl) { var b = batasGaransi(tgl); return !!b && hariIni() > b; }
  function aturBeli() {
    var gar = $('fGaransi').value === 'Garansi', tgl = $('fBeli').value, habis = masaGaransiHabis(tgl);
    $('wrapBeli').classList.toggle('hidden', !gar && !habis);
    var b = batasGaransi(tgl);
    $('beliInfo').textContent = habis
      ? 'Garansi berakhir pada ' + fmtTgl(b) + ' (lewat 2 tahun sejak pembelian), sehingga dihitung Non Garansi.'
      : (b ? 'Garansi berlaku sampai ' + fmtTgl(b) + '.' : 'Wajib untuk service garansi. Garansi berlaku 2 tahun sejak tanggal pembelian.');
  }
  function cekMasaGaransi(notif) {
    if ($('fGaransi').value === 'Garansi' && masaGaransiHabis($('fBeli').value)) {
      $('fGaransi').value = 'Non Garansi';
      aturOpsiStatus('fStatus', 'Non Garansi');
      kunciBiaya(false);
      hitungTotal();
      aturBeli();
      if (notif) toast('Garansi sudah lewat 2 tahun sejak tanggal pembelian. Status diubah menjadi Non Garansi.', 'err');
    }
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
    $('fBeli').value = r.tanggalPembelian || '';
    aturBeli();
    cekMasaGaransi(true);
    $('fKeluhan').value = r.keluhan || '';
    $('fStatus').value = r.statusPengerjaan || 'Baru Diterima';
    $('fCatatan').value = r.catatanTeknisi || '';
    $('fSelesai').value = r.tanggalSelesai ? fmtWaktu(r.tanggalSelesai) : 'Otomatis saat status Selesai Service';
    $('fDiambil').value = r.tanggalDiambil ? fmtWaktu(r.tanggalDiambil) : 'Otomatis saat status Sudah Diambil';
    aturOpsiStatus('fStatus', $('fGaransi').value);
    isiBiaya(r.id ? r : null);
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
  $('fGaransi').addEventListener('change', function () { aturOpsiStatus('fStatus', this.value); kunciBiaya(this.value === 'Garansi'); hitungTotal(); aturBeli(); cekMasaGaransi(true); });
  $('fBeli').addEventListener('change', function () { aturBeli(); cekMasaGaransi(true); });
  $('btnFormReset').addEventListener('click', function () { isiForm(STATE.editAsli); });
  $('btnFormNota').addEventListener('click', function () { if (STATE.editId) bukaNota(STATE.editId); });

  function ambilForm() {
    return {
      nama: val('fNama'), noHp: val('fHp'), brand: val('fBrand'), tipe: val('fTipe'), noSeri: val('fSeri'),
      statusGaransi: $('fGaransi').value, keluhan: val('fKeluhan'), statusPengerjaan: $('fStatus').value,
      catatanTeknisi: val('fCatatan'),
      sparepart: ambilSparepart(), biayaJasa: $('fGaransi').value === 'Garansi' ? 0 : angka($('fJasa').value),
      tanggalPembelian: ($('fGaransi').value === 'Garansi' || masaGaransiHabis($('fBeli').value)) ? $('fBeli').value : ''
    };
  }
  function cekForm(d) {
    if (!d.nama) return ['fNama', 'Nama konsumen wajib diisi.'];
    var digit = d.noHp.replace(/[\s\-().+]/g, '');
    if (!/^\d{9,15}$/.test(digit)) return ['fHp', 'Nomor HP/WhatsApp tidak valid. Contoh: 081234567890.'];
    if (!d.brand) return ['fBrand', 'Brand/Merek wajib diisi.'];
    if (!d.tipe) return ['fTipe', 'Tipe/Model wajib diisi.'];
    if (!d.statusGaransi) return ['fGaransi', 'Pilih status garansi.'];
    if (d.statusGaransi === 'Garansi' && !d.tanggalPembelian) return ['fBeli', 'Tanggal pembelian wajib diisi untuk service garansi.'];
    if (!d.keluhan) return ['fKeluhan', 'Keluhan konsumen wajib diisi.'];
    if (d.statusGaransi === 'Garansi' && d.statusPengerjaan === 'Konfirmasi Harga') return ['fStatus', 'Konfirmasi Harga hanya untuk Non Garansi.'];
    var total = d.biayaJasa;
    for (var i = 0; i < d.sparepart.length; i++) {
      if (!d.sparepart[i].nama) return ['spList', 'Nama sparepart wajib diisi untuk baris yang sudah memiliki harga.'];
      total += d.sparepart[i].qty * d.sparepart[i].harga;
    }
    if (d.statusGaransi !== 'Garansi' && d.statusPengerjaan === 'Konfirmasi Harga' && !(total > 0)) {
      return ['fJasa', 'Isi estimasi biaya (sparepart dan/atau biaya jasa) sebelum memakai status Konfirmasi Harga.'];
    }
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
        item('Status Pengerjaan', badgeStatus(s.statusPengerjaan)) + item('Terakhir Diperbarui', esc(fmtWaktu(s.terakhirDiperbarui))) +
        (s.tanggalPembelian ? item('Tanggal Pembelian', esc(fmtTgl(s.tanggalPembelian))) + '<div></div>' : '') +
        item('Tanggal Selesai', esc(s.tanggalSelesai ? fmtWaktu(s.tanggalSelesai) : '-')) + item('Tanggal Diambil', esc(s.tanggalDiambil ? fmtWaktu(s.tanggalDiambil) : '-')) +
        '<div class="full">' + item('Keluhan Konsumen', esc(s.keluhan)) + '</div>' +
        '<div class="full">' + item('Catatan Teknisi (internal)', esc(s.catatanTeknisi || '-')) + '</div>' +
        '<div class="full">' + item(belumFinal(s.statusPengerjaan, s.statusGaransi === 'Garansi') ? 'Estimasi Biaya' : 'Rincian Biaya', rincianHtml(s.rincian, s)) + '</div>' +
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
      $('dtEdit').classList.toggle('hidden', !STATE.pemilik);
      bukaModal('modalDetail');
    }).catch(showErr);
  }
  function rincianHtml(r, s) {
    r = r || { items: [], jasa: 0, total: 0, garansi: false };
    if (!r.garansi && !r.items.length && !r.jasa) return '<span class="sub">Belum ada rincian biaya.</span>';
    var est = belumFinal(s.statusPengerjaan, r.garansi);
    var h = '<table class="biaya-tbl"><tbody>';
    r.items.forEach(function (x) {
      h += '<tr><td>' + esc(x.nama) + '<div class="sub">' + esc(x.qty) + ' x ' + rp(x.harga) + '</div></td><td class="r">' + rp(x.subtotal) + '</td></tr>';
    });
    h += '<tr><td>Biaya jasa service</td><td class="r">' + rp(r.jasa) + '</td></tr>';
    h += '<tr class="total"><td>' + (est ? 'Total Estimasi' : 'Total Biaya') + (r.garansi ? ' (Garansi)' : '') + '</td><td class="r">' + rp(r.total) + '</td></tr></tbody></table>';
    return h;
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
    var tot = row.rincian ? row.rincian.total : 0;
    $('sHint').textContent = row.statusGaransi === 'Garansi'
      ? 'Service Garansi: status "Konfirmasi Harga" tidak tersedia.'
      : (tot > 0 ? 'Estimasi biaya saat ini: ' + rp(tot) + ' (ubah lewat menu Edit).' : 'Status "Konfirmasi Harga" memerlukan estimasi biaya. Isi lewat menu Edit.');
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
    if (st === 'Konfirmasi Harga' && row.statusGaransi !== 'Garansi' && !(row.rincian && row.rincian.total > 0)) {
      tampilError('statusError', 'Isi estimasi biaya terlebih dulu lewat menu Edit, lalu ubah status ke Konfirmasi Harga.'); return;
    }
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
  function bukaWa(id, judul, jenis) {
    jenis = jenis || '';
    apiAuth('buatPesanWhatsApp', id, jenis).then(function (d) {
      STATE.wa = { nomor: d.nomor, id: id, tautan: d.tautan, jenis: jenis, judul: judul };
      $('waJenis').textContent = jenis === 'nota' ? 'Pakai Pesan Status' : 'Pakai Pesan Nota';
      $('waTitle').textContent = judul || 'Kirim Status via WhatsApp';
      $('waNota').textContent = d.nomorNota;
      $('waNomor').textContent = '+' + d.nomor;
      $('waPesan').value = d.pesan;
      $('waLink').href = d.url;
      bukaModal('modalWa');
    }).catch(showErr);
  }
  $('waPesan').addEventListener('input', function () { $('waLink').href = urlWa(); });
  $('waJenis').addEventListener('click', function () {
    if (!STATE.wa.id) return;
    var j = STATE.wa.jenis === 'nota' ? '' : 'nota';
    bukaWa(STATE.wa.id, j === 'nota' ? 'Kirim Nota via WhatsApp' : 'Kirim Status via WhatsApp', j);
  });
  $('btnNotaWa').addEventListener('click', function () {
    if (!STATE.nota || !STATE.nota.id) return;
    var id = STATE.nota.id;
    tutupModal('modalNota');
    bukaWa(id, 'Kirim Nota via WhatsApp', 'nota');
  });
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
  function notaBiaya(d) {
    var r = d.rincian;
    if (!r || (!r.garansi && !r.items.length && !r.jasa)) return '';
    var est = belumFinal(d.statusPengerjaan, r.garansi);
    var h = '<div class="nota-sep"></div><div class="nota-sub">' + (est ? 'ESTIMASI BIAYA' : 'RINCIAN BIAYA') + '</div>';
    r.items.forEach(function (x) {
      h += '<div class="nota-item"><div class="n">' + esc(x.nama) + '</div>' +
        '<div class="nota-hrg"><span>' + esc(x.qty) + ' x ' + angkaFmt(x.harga) + '</span><span>' + angkaFmt(x.subtotal) + '</span></div></div>';
    });
    h += '<div class="nota-hrg"><span>Biaya Jasa</span><span>' + angkaFmt(r.jasa) + '</span></div>' +
      '<div class="nota-sep"></div>' +
      '<div class="nota-hrg nota-total"><span>' + (est ? 'TOTAL ESTIMASI' : 'TOTAL BIAYA') + '</span><span>' + rp(r.total) + '</span></div>';
    if (r.garansi) h += '<div class="nota-ket">Ditanggung garansi (Rp 0).</div>';
    else if (est) h += '<div class="nota-ket">*Estimasi, belum final. Menunggu konfirmasi konsumen.</div>';
    return h;
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
      (d.tanggalPembelian ? baris('Tgl Beli', fmtTgl(d.tanggalPembelian)) : '') +
      baris('Keluhan', d.keluhan) + baris('Status', d.statusPengerjaan) +
      notaBiaya(d) +
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

  // ---------------------------------------------------------------- Nota JPG (digambar langsung di canvas)
  function bungkus(ctx, teks, lebar) {
    var hasil = [];
    String(teks == null ? '' : teks).split('\n').forEach(function (para) {
      var baris = '';
      para.split(' ').forEach(function (k) {
        while (ctx.measureText(k).width > lebar) {
          var i = k.length;
          while (i > 1 && ctx.measureText(k.substring(0, i)).width > lebar) i--;
          if (baris) { hasil.push(baris); baris = ''; }
          hasil.push(k.substring(0, i));
          k = k.substring(i);
        }
        var coba = baris ? baris + ' ' + k : k;
        if (baris && ctx.measureText(coba).width > lebar) { hasil.push(baris); baris = k; } else { baris = coba; }
      });
      hasil.push(baris);
    });
    return hasil;
  }
  function lukisNota(ctx, d, gambar, W) {
    var P = 32, FONT = '"Segoe UI", Roboto, Arial, sans-serif', y = P, lebar = W - 2 * P;
    var r = d.rincian || { items: [], jasa: 0, total: 0, garansi: false };
    var t = d.toko || {};
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    function f(tebal, ukuran) { ctx.font = (tebal ? 'bold ' : '') + ukuran + 'px ' + FONT; }
    function tengah(txt, tebal, ukuran) {
      f(tebal, ukuran);
      bungkus(ctx, txt, lebar).forEach(function (b) {
        if (gambar) { ctx.textAlign = 'center'; ctx.fillText(b, W / 2, y); }
        y += ukuran + 7;
      });
    }
    function garis() {
      y += 6;
      if (gambar) {
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(P, y + 0.5); ctx.lineTo(W - P, y + 0.5); ctx.stroke(); ctx.restore();
      }
      y += 9;
    }
    function baris(k, v) {
      f(true, 15);
      var lk = bungkus(ctx, k, 125);
      f(false, 15);
      var lv = bungkus(ctx, v, lebar - 140);
      var n = Math.max(lk.length, lv.length);
      if (gambar) {
        ctx.textAlign = 'left';
        f(true, 15); lk.forEach(function (b, i) { ctx.fillText(b, P, y + i * 22); });
        f(false, 15); lv.forEach(function (b, i) { ctx.fillText(b, P + 140, y + i * 22); });
      }
      y += n * 22 + 2;
    }
    function kiriKanan(kiri, kanan, tebal, ukuran, indent) {
      ukuran = ukuran || 15; indent = indent || 0;
      f(tebal, ukuran);
      var wk = ctx.measureText(kanan).width;
      var lk = bungkus(ctx, kiri, lebar - indent - wk - 14);
      if (gambar) {
        ctx.textAlign = 'left';
        lk.forEach(function (b, i) { ctx.fillText(b, P + indent, y + i * (ukuran + 7)); });
        ctx.textAlign = 'right'; ctx.fillText(kanan, W - P, y);
      }
      y += lk.length * (ukuran + 7);
    }

    tengah(t.NAMA || '', true, 22);
    if (t.ALAMAT) tengah(t.ALAMAT, false, 14);
    if (t.TELP) tengah('Telp: ' + t.TELP, false, 14);
    garis(); tengah('NOTA SERVICE', true, 18); garis();
    baris('No. Nota', d.nomorNota); baris('Tgl Masuk', fmtWaktu(d.tanggalMasuk));
    garis();
    baris('Konsumen', d.nama); baris('No. HP', fmtHp(d.noHp));
    garis();
    baris('Barang', d.brand + ' ' + d.tipe); baris('No. Seri', d.noSeri); baris('Garansi', d.statusGaransi);
    if (d.tanggalPembelian) baris('Tgl Beli', fmtTgl(d.tanggalPembelian));
    baris('Keluhan', d.keluhan); baris('Status', d.statusPengerjaan);

    if (r.garansi || r.items.length || r.jasa) {
      var est = belumFinal(d.statusPengerjaan, r.garansi);
      garis(); tengah(est ? 'ESTIMASI BIAYA' : 'RINCIAN BIAYA', true, 16);
      r.items.forEach(function (x) {
        kiriKanan(x.nama, '', false, 15);
        kiriKanan(x.qty + ' x ' + angkaFmt(x.harga), angkaFmt(x.subtotal), false, 14, 16);
      });
      kiriKanan('Biaya Jasa', angkaFmt(r.jasa), false, 15);
      garis();
      kiriKanan(est ? 'TOTAL ESTIMASI' : 'TOTAL BIAYA', rp(r.total), true, 18);
      y += 4;
      if (r.garansi) tengah('Ditanggung garansi (Rp 0)', false, 13);
      else if (est) tengah('*Estimasi, belum final. Menunggu konfirmasi konsumen.', false, 13);
    }
    if (t.CATATAN_NOTA) { garis(); tengah(t.CATATAN_NOTA, false, 13); }
    return y + P;
  }
  function buatCanvasNota(d) {
    var W = 640, S = 2;
    var H = lukisNota(document.createElement('canvas').getContext('2d'), d, false, W);
    var c = document.createElement('canvas');
    c.width = W * S; c.height = Math.ceil(H * S);
    var ctx = c.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    lukisNota(ctx, d, true, W);
    return c;
  }
  function dataUrlKeBlob(url) {
    var b = atob(url.split(',')[1]), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return new Blob([u], { type: 'image/jpeg' });
  }
  function bukaJpg() {
    var d = STATE.nota;
    if (!d) return;
    var url;
    try { url = buatCanvasNota(d).toDataURL('image/jpeg', 0.92); }
    catch (e) { toast('Gagal membuat gambar nota.', 'err'); return; }
    var nama = 'Nota-' + d.nomorNota + '.jpg';
    STATE.jpg = { url: url, nama: nama };
    $('jpgImg').src = url;
    $('jpgUnduh').href = url;
    $('jpgUnduh').setAttribute('download', nama);
    var wa = String(d.noHp || '').replace(/\D/g, '');
    $('jpgWa').classList.toggle('hidden', !wa);
    if (wa) $('jpgWa').href = 'https://wa.me/' + wa;
    $('jpgBagikan').classList.toggle('hidden', !(navigator.share && navigator.canShare && window.File));
    bukaModal('modalJpg');
  }
  $('btnNotaJpg').addEventListener('click', bukaJpg);
  $('jpgBagikan').addEventListener('click', function () {
    var j = STATE.jpg;
    if (!j) return;
    var file;
    try { file = new File([dataUrlKeBlob(j.url)], j.nama, { type: 'image/jpeg' }); } catch (e) { file = null; }
    if (!file || !navigator.canShare({ files: [file] })) { toast('Perangkat tidak mendukung berbagi gambar. Gunakan Unduh JPG.', 'err'); return; }
    navigator.share({ files: [file], title: j.nama }).catch(function (e) {
      if (e && e.name !== 'AbortError') toast('Gagal membagikan. Gunakan Unduh JPG.', 'err');
    });
  });

  // ---------------------------------------------------------------- Kelola user (khusus admin utama)
  function renderUser(daftar) {
    var h = '';
    daftar.forEach(function (u) {
      h += '<div class="user-row"><div><b>' + esc(u.username) + '</b><div class="sub">' + (u.pemilik ? 'Admin Utama' : 'User') + (u.saya ? ' &middot; Anda' : '') + '</div></div>' +
        ((u.pemilik || u.saya) ? '' : '<button type="button" class="btn btn-sm btn-danger" data-uhapus="' + esc(u.id) + '">Hapus</button>') + '</div>';
    });
    $('userList').innerHTML = h || '<div class="sub">Belum ada user.</div>';
  }
  function muatUser() {
    return apiAuth('daftarUser').then(function (d) { renderUser(d.users); }).catch(function (e) {
      $('userList').innerHTML = '';
      showErr(e);
    });
  }
  $('btnUser').addEventListener('click', function () {
    tampilError('userError', '');
    $('uUser').value = ''; $('uPass').value = '';
    $('userList').innerHTML = '<div class="sub">Memuat...</div>';
    bukaModal('modalUser');
    muatUser();
  });
  $('uShow').addEventListener('change', function () { $('uPass').type = this.checked ? 'text' : 'password'; });
  $('formUser').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var u = val('uUser'), p = $('uPass').value;
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(u)) { tampilError('userError', 'Username 3-30 karakter (huruf, angka, titik, garis bawah, strip).'); return; }
    if (p.length < 8) { tampilError('userError', 'Password minimal 8 karakter.'); return; }
    tampilError('userError', '');
    var btn = $('btnUserTambah');
    sibuk(btn, true, 'Menambah...');
    apiAuth('tambahUser', u, p).then(function (res) {
      sibuk(btn, false);
      $('uUser').value = ''; $('uPass').value = '';
      toast('User "' + res.username + '" ditambahkan.', 'ok');
      muatUser();
    }).catch(function (e) {
      sibuk(btn, false);
      if (e.code !== 'AUTH') tampilError('userError', e.message);
    });
  });
  $('userList').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-uhapus]') : null;
    if (!b) return;
    if (!b.dataset.yakin) {
      b.dataset.yakin = '1';
      b.textContent = 'Klik lagi untuk hapus';
      setTimeout(function () { if (b.parentNode) { delete b.dataset.yakin; b.textContent = 'Hapus'; } }, 4000);
      return;
    }
    b.disabled = true;
    apiAuth('hapusUser', b.getAttribute('data-uhapus')).then(function (res) {
      toast('User "' + res.username + '" dihapus.', 'ok');
      muatUser();
    }).catch(function (e) { b.disabled = false; showErr(e); });
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

  // ---------------------------------------------------------------- Mulai
  (function mulai() {
    var cfg = window.APP_CONFIG || {};
    $('loginTitle').textContent = cfg.APP_TITLE || 'Nota Service';
    $('loginToko').textContent = cfg.NAMA_TOKO || '';
    document.title = (cfg.APP_TITLE || 'Nota Service') + (cfg.NAMA_TOKO ? ' - ' + cfg.NAMA_TOKO : '');
    var t = bacaToken();
    if (!t) { tampilLogin(''); return; }
    api('cekSesi', t).then(tampilApp).catch(function () { hapusToken(); tampilLogin(''); });
  })();
})();
