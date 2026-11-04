(function () {
  'use strict';
  var v = document.getElementById('v'), c = document.getElementById('c');
  function probe(job) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(r) { if (done) return; done = true; clearTimeout(to); v.onloadedmetadata = v.onseeked = v.onerror = null; v.removeAttribute('src'); try { v.load(); } catch (e) { /* */ } resolve(r); }
      var to = setTimeout(function () { finish({ error: 'Timed out reading the video (file may be corrupted or on a slow drive).' }); }, 20000);
      v.onerror = function () { var code = v.error ? v.error.code : 0; finish({ error: code === 4 ? 'Format or codec not supported — use MP4 (H.264 video, AAC audio).' : code === 3 ? 'Video is corrupted and cannot be decoded.' : 'File could not be opened.' }); };
      v.onloadedmetadata = function () {
        var meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
        if (!isFinite(v.duration) || v.duration <= 0) return finish({ error: 'Could not read the video duration (file may be corrupted).' });
        if (!v.videoWidth) return finish(meta);
        v.onseeked = function () {
          try { var ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, 320, 180); meta.thumb = c.toDataURL('image/jpeg', 0.72); } catch (e) { /* no thumb */ }
          finish(meta);
        };
        try { v.currentTime = Math.min(v.duration * 0.15, 20); } catch (e) { finish(meta); }
      };
      v.src = job.href;
    });
  }
  window.cmb.on('probe:job', function (job) { probe(job).then(function (r) { window.cmb.send('probe:result', { id: job.id, result: r }); }); });
  window.cmb.send('probe:ready', true);
})();
