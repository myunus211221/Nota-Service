// Pengganti google.script.run: meneruskan pemanggilan fungsi ke Apps Script lewat HTTPS (POST).
// Memakai Content-Type text/plain agar browser tidak mengirim preflight CORS (Apps Script tidak mendukungnya).
(function () {
  'use strict';
  var URL_API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';

  function panggil(nama, args) {
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(URL_API)) {
      return Promise.reject(new Error('API_URL belum diisi di docs/config.js.'));
    }
    return fetch(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: nama, args: args }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('Server mengembalikan status ' + r.status + '.');
      return r.json();
    });
  }

  function buat(ok, gagal) {
    return new Proxy({}, {
      get: function (_, nama) {
        if (nama === 'withSuccessHandler') return function (f) { return buat(f, gagal); };
        if (nama === 'withFailureHandler') return function (f) { return buat(ok, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          panggil(String(nama), args).then(
            function (res) { if (ok) ok(res); },
            function (err) { if (gagal) gagal(err); }
          );
        };
      }
    });
  }

  window.google = { script: { run: buat(null, null) } };
})();
