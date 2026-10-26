(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var TOKEN = (function () { var m = /[?&]id=([a-f0-9]{40})(?:&|$)/.exec(location.search); return m ? m[1] : ''; })();
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var KELAS = { 'Baru Diterima': 'baru', 'Proses Service': 'proses', 'Konfirmasi Harga': 'konfirmasi', 'Selesai Service': 'selesai', 'Menunggu Diambil': 'menunggu', 'Sudah Diambil': 'diambil' };
  var PESAN = {
    'Baru Diterima': 'Barang Anda telah kami terima dan menunggu pemeriksaan teknisi.',
    'Proses Service': 'Barang Anda sedang dalam proses pengerjaan.',
    'Konfirmasi Harga': 'Service Anda memerlukan konfirmasi biaya. Silakan hubungi kami untuk melanjutkan pengerjaan.',
    'Selesai Service': 'Pengerjaan service telah selesai.',
    'Menunggu Diambil': 'Service selesai. Barang Anda siap diambil di toko kami.',
    'Sudah Diambil': 'Barang telah diambil. Terima kasih telah mempercayakan service kepada kami.'
  };
  var timer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTgl(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? parseInt(m[3], 10) + ' ' + BULAN[parseInt(m[2], 10) - 1] + ' ' + m[1] : (s || '-');
  }
  function fmtWaktu(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
    return m ? fmtTgl(s) + ', ' + m[4] + '.' + m[5] + ' WIB' : (s || '-');
  }
  function rp(n) { return 'Rp ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function renderBiaya(d) {
    var r = d.rincian || { items: [], jasa: 0, total: 0, garansi: false };
    var box = $('cBiaya');
    if (!r.garansi && !r.items.length && !r.jasa) { box.classList.add('hidden'); return; }
    var konfirmasi = d.statusPengerjaan === 'Konfirmasi Harga';
    var estimasi = !r.garansi && ['Baru Diterima', 'Proses Service', 'Konfirmasi Harga'].indexOf(d.statusPengerjaan) >= 0;
    $('bJudul').textContent = estimasi ? 'Estimasi Biaya' : 'Rincian Biaya';
    var h = '<table class="biaya-tbl"><tbody>';
    r.items.forEach(function (x) {
      h += '<tr><td>' + esc(x.nama) + '<div class="sub">' + esc(x.qty) + ' x ' + rp(x.harga) + '</div></td><td class="r">' + rp(x.subtotal) + '</td></tr>';
    });
    h += '<tr><td>Biaya jasa service</td><td class="r">' + rp(r.jasa) + '</td></tr>';
    h += '<tr class="total"><td>' + (estimasi ? 'Total Estimasi' : 'Total Biaya') + '</td><td class="r">' + rp(r.total) + '</td></tr></tbody></table>';
    $('bIsi').innerHTML = h;
    $('bCatatan').textContent = r.garansi
      ? 'Service ini ditanggung garansi, sehingga seluruh biaya Rp 0.'
      : (konfirmasi
        ? 'Estimasi ini menunggu persetujuan Anda. Silakan hubungi kami untuk konfirmasi. Biaya dapat berubah jika ditemukan kerusakan tambahan, dan akan kami konfirmasikan lebih dulu.'
        : (estimasi ? 'Ini adalah estimasi biaya, belum final.' : ''));
    box.classList.remove('hidden');
  }
  function tampilError(msg) {
    $('loading').classList.add('hidden');
    $('konten').classList.add('hidden');
    $('errorMsg').textContent = msg;
    $('errorBox').classList.remove('hidden');
  }

  function render(d) {
    $('tStatus').innerHTML = '<span class="badge st-' + (KELAS[d.statusPengerjaan] || 'baru') + '">' + esc(d.statusPengerjaan) + '</span>';
    $('tPesan').textContent = PESAN[d.statusPengerjaan] || '';
    $('tUpdate').textContent = 'Terakhir diperbarui: ' + fmtWaktu(d.diperbaruiPada);
    $('tNota').textContent = d.nomorNota;
    $('tMasuk').textContent = fmtTgl(d.tanggalMasuk);
    $('tNama').textContent = d.nama;
    $('tGaransi').textContent = d.statusGaransi;
    $('tBrand').textContent = d.brand;
    $('tTipe').textContent = d.tipe;
    $('tKeluhan').textContent = d.keluhan;
    renderBiaya(d);

    var waktuStatus = {};
    d.riwayat.forEach(function (r) { waktuStatus[r.status] = r.waktu; });
    var idx = d.langkah.indexOf(d.statusPengerjaan);
    var h = '';
    d.langkah.forEach(function (s, i) {
      var kls = i < idx ? 'done' : (i === idx ? 'now' : 'pending');
      var tanda = i < idx ? '&#10003;' : (i + 1);
      var waktu = (i <= idx && waktuStatus[s]) ? '<div class="t-time">' + esc(fmtWaktu(waktuStatus[s])) + '</div>' : '';
      h += '<li class="' + kls + '"><div class="dot">' + tanda + '</div><div class="t-name">' + esc(s) + '</div>' + waktu + '</li>';
    });
    $('tTimeline').innerHTML = h;

    var rh = '';
    d.riwayat.slice().reverse().forEach(function (r) {
      rh += '<li><b>' + esc(r.status) + '</b><div class="wkt">' + esc(fmtWaktu(r.waktu)) + '</div></li>';
    });
    $('tRiwayat').innerHTML = rh || '<li>Belum ada riwayat.</li>';

    var t = d.toko || {};
    if (t.NAMA) { $('namaToko').textContent = t.NAMA; document.title = 'Status Service - ' + t.NAMA; }
    $('oNama').textContent = t.NAMA || '';
    $('oAlamat').textContent = t.ALAMAT || '';
    $('oTelp').textContent = t.TELP ? 'Telp: ' + t.TELP : '';
    $('oJam').textContent = t.JAM_OPERASIONAL || '';
    var wa = String(t.WA || '').replace(/\D/g, '');
    if (wa) {
      $('oWa').href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Halo, saya ingin menanyakan service dengan nomor nota ' + d.nomorNota + '.');
      $('oWa').classList.remove('hidden');
    }

    $('loading').classList.add('hidden');
    $('errorBox').classList.add('hidden');
    $('konten').classList.remove('hidden');
  }

  function muat(diam) {
    if (!TOKEN) { tampilError('Tautan pelacakan tidak valid. Pastikan Anda membuka tautan lengkap dari toko.'); return; }
    var btn = $('btnRefresh');
    btn.disabled = true;
    var url = CFG.API_URL || '';
    if (!/^https:\/\//.test(url)) {
      btn.disabled = false;
      tampilError('Situs belum dikonfigurasi (API_URL pada config.js belum diisi).');
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: 'ambilDataPelacakan', args: [TOKEN] }),
      redirect: 'follow'
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        btn.disabled = false;
        if (res && res.ok) render(res.data);
        else if (!diam || res.code === 'NOTFOUND') tampilError((res && res.error) || 'Data tidak dapat dimuat.');
      }, function () {
        btn.disabled = false;
        if (!diam) tampilError('Gagal menghubungi server. Periksa koneksi internet lalu coba lagi.');
      });
  }

  $('namaToko').textContent = CFG.NAMA_TOKO || '';
  if (CFG.NAMA_TOKO) document.title = 'Status Service - ' + CFG.NAMA_TOKO;
  $('btnRefresh').addEventListener('click', function () { muat(false); });
  muat(false);
  timer = setInterval(function () { if (!document.hidden) muat(true); }, 60000);
})();
