/* Anthem Square — YouTube songs on the TV (Beta).
 * Uses YouTube's OFFICIAL embedded player in a sandboxed cross-origin <iframe> and talks to it only
 * with window.postMessage (the documented IFrame-API message channel). No YouTube script runs inside
 * this page. The player is never covered: in YouTube mode the TV moves the title and pattern panel
 * into a side column (see brand.css, body.yt-mode). Adverts, if YouTube shows any, play as normal. */
(function () {
  'use strict';
  var frame = null, ready = false, queue = [], listenTimer = null, loadTimer = null;
  var st = { time: 0, at: 0, playing: false, state: -1 };
  var cb = {}, started = false, wantPlay = false, muted = false, lastVol = -1, base = 'https://www.youtube-nocookie.com/embed/';
  var ERR = { 2: 'This YouTube link is not valid', 5: 'The YouTube player had a problem with this video', 100: 'This YouTube video was removed or made private', 101: 'The video’s owner does not allow it to be played in other apps', 150: 'The video’s owner does not allow it to be played in other apps', 153: 'YouTube refused to play this video here (player configuration)' };

  function send(msg) { try { frame.contentWindow.postMessage(JSON.stringify(msg), '*'); } catch (e) { /* frame gone */ } }
  function cmd(func, args) { var m = { event: 'command', func: func, args: args || [] }; if (!frame) return; if (!ready) queue.push(m); else send(m); }
  function fail(msg) { clearTimeout(loadTimer); clearInterval(listenTimer); if (cb.error) cb.error(msg); }
  function onState(s) {
    st.state = s; st.playing = s === 1;
    if (s === 1 && !started) { started = true; if (cb.started) cb.started(); }
    if (s === 0 && cb.ended) cb.ended();
  }
  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return; // only our own player frame
    var d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (x) { return; }
    if (!d || typeof d !== 'object') return;
    if (d.event === 'onReady' || (d.event === 'initialDelivery' && !ready)) {
      ready = true; clearTimeout(loadTimer); clearInterval(listenTimer);
      queue.splice(0).forEach(send);
      if (muted) send({ event: 'command', func: 'mute', args: [] });
      if (wantPlay) send({ event: 'command', func: 'playVideo', args: [] });
    } else if (d.event === 'infoDelivery' && d.info) {
      if (d.info.currentTime != null) { st.time = Number(d.info.currentTime) || 0; st.at = performance.now(); }
      if (d.info.playerState != null) onState(d.info.playerState);
    } else if (d.event === 'onStateChange') onState(d.info);
    else if (d.event === 'onError') fail(ERR[d.info] || 'YouTube could not play this video (error ' + d.info + ')');
  });

  var YTP = {
    active: false,
    on: function (name, fn) { cb[name] = fn; },
    config: function (c) { if (c && c.embedBase) base = c.embedBase; },
    load: function (opts) {
      YTP.active = true; ready = false; queue = []; started = false; wantPlay = !!opts.autoplay; muted = !!opts.muted; lastVol = -1;
      st = { time: opts.start || 0, at: performance.now(), playing: false, state: -1 };
      var stage = document.getElementById('stage');
      if (!frame) {
        frame = document.createElement('iframe'); frame.id = 'ytFrame';
        frame.setAttribute('allow', 'autoplay; encrypted-media');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.setAttribute('title', 'YouTube video player');
        stage.appendChild(frame);
      }
      var p = { enablejsapi: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, modestbranding: 1, autoplay: wantPlay ? 1 : 0, start: Math.floor(opts.start || 0), mute: muted ? 1 : 0 };
      frame.src = base + encodeURIComponent(opts.id) + '?' + Object.keys(p).map(function (k) { return k + '=' + p[k]; }).join('&');
      clearInterval(listenTimer); clearTimeout(loadTimer);
      // the player only reports back once it has been told someone is listening
      frame.onload = function () { send({ event: 'listening', id: 1, channel: 'widget' }); };
      listenTimer = setInterval(function () { if (!ready) send({ event: 'listening', id: 1, channel: 'widget' }); }, 500);
      loadTimer = setTimeout(function () { if (!ready) fail('YouTube did not load — check the internet connection'); }, 15000);
      // exact start (the URL only takes whole seconds)
      if (opts.start) cmd('seekTo', [opts.start, true]);
    },
    play: function () { wantPlay = true; cmd('playVideo'); },
    pause: function () { wantPlay = false; st.time = YTP.time(); st.playing = false; cmd('pauseVideo'); },
    seek: function (t) { st.time = t; st.at = performance.now(); cmd('seekTo', [t, true]); },
    setVolume: function (v) { if (muted) return; var n = Math.max(0, Math.min(100, Math.round(v * 100))); if (Math.abs(n - lastVol) < 2 && n !== 0 && n !== 100) return; lastVol = n; cmd('setVolume', [n]); },
    time: function () { return st.playing ? st.time + (performance.now() - st.at) / 1000 : st.time; },
    isPlaying: function () { return st.playing; },
    clear: function () {
      YTP.active = false; clearInterval(listenTimer); clearTimeout(loadTimer); ready = false; queue = [];
      if (frame) { frame.onload = null; frame.src = 'about:blank'; frame.remove(); frame = null; }
    }
  };
  window.YTP = YTP;
})();
