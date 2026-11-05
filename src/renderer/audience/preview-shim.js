/* Anthem Square — the TV page in PREVIEW mode (?preview=1): embedded, scaled down, in Create Game
 * and Settings so the host sees the real TV layout change as they edit it. No game, no video,
 * no IPC: the embedding page posts { ch, data } messages that stand in for the main process. */
(function () {
  'use strict';
  if (!/[?&]preview=1/.test(location.search)) return;
  document.documentElement.classList.add('preview');
  var H = {};
  window.cmb = {
    on: function (ch, fn) { (H[ch] = H[ch] || []).push(fn); },
    invoke: function (ch) { return Promise.resolve(ch === 'player:ready' ? { appSettings: { lowResource: false, slides: { enabled: false, seconds: 8, images: [] } }, state: null } : true); },
    send: function () {}
  };
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || !e.data.ch) return;
    if (e.data.ch === 'preview-bg') { document.documentElement.style.setProperty('--preview-bg', e.data.data ? 'url("' + e.data.data + '")' : 'none'); return; }
    (H[e.data.ch] || []).forEach(function (fn) { try { fn(e.data.data); } catch (x) { /* */ } });
  });
})();
