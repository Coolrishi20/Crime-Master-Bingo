/* Crime Master Bingo — audience (TV / projector) window.
 * Shows ONLY: the music video, song title, artist, the round's winning pattern
 * and the played-song crawler. It is also the single media player: the laptop's
 * main process tells it what to play; it reports progress back. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var video = $('video');
  var overlay = $('overlay');
  var ticker = new CMBTicker.Ticker($('crawlViewport'), {});
  var cur = { token: null, clipStart: 0, clipEnd: null, volume: 85, ended: false, test: false };
  var audio = { gainDb: 0, fadeIn: 0.5, fadeOut: 1, muted: false };
  var sinkId = 'default';

  /* Single Web Audio chain: <video> → gain → speakers. Levelling, fades, volume and
     mute are ONE gain stage, so there is never a second stream or any overlap. */
  var actx = null, gainNode = null;
  function ensureAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
      var src = actx.createMediaElementSource(video);
      gainNode = actx.createGain(); gainNode.gain.value = 0;
      src.connect(gainNode); gainNode.connect(actx.destination);
      applySink();
    } catch (e) { actx = null; gainNode = null; }
  }
  function applySink() {
    var id = sinkId && sinkId !== 'default' ? sinkId : '';
    if (actx && actx.setSinkId) actx.setSinkId(id).catch(function () { /* device gone: default */ });
    else if (video.setSinkId) video.setSinkId(id).catch(function () {});
  }
  function setGain(v, tc) {
    if (gainNode) { gainNode.gain.setTargetAtTime(v, actx.currentTime, tc || 0.02); video.volume = 1; }
    else video.volume = Math.max(0, Math.min(1, v));
  }
  var state = null;
  var overlayKey = null, overlayTimer = null;
  var patternTimer = null, patternRound = null, patternIdx = 0;
  var lastReport = 0;

  function setScale() {
    var s = Math.max(0.45, Math.min(window.innerHeight / 1080, window.innerWidth / 1920));
    document.documentElement.style.setProperty('--s', s.toFixed(4));
  }
  setScale();
  window.addEventListener('resize', function () { setScale(); ticker.resize(); });

  function fileHref(p) {
    if (/^file:/i.test(p)) return p;
    var s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + s.split('/').map(function (seg, i) { return (i === 1 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg); }).join('/');
  }

  /* ------------------------------------------------------------- player */
  /** Volume × levelling gain × fade (only inside the selected clip) × mute. */
  function effectiveVolume(t) {
    if (audio.muted) return 0;
    var v = Math.max(0, Math.min(1, cur.volume / 100)) * Math.pow(10, (audio.gainDb || 0) / 20);
    if (cur.clipEnd != null && audio.fadeOut > 0) {
      var left = cur.clipEnd - t;
      if (left < audio.fadeOut) v *= Math.max(0, left / audio.fadeOut);
    }
    var into = t - cur.clipStart;
    if (audio.fadeIn > 0 && into >= -0.05 && into < audio.fadeIn) v *= Math.max(0, into / audio.fadeIn);
    if (!gainNode) v = Math.min(1, v);
    return v;
  }

  var pendingLoad = null;
  function load(cmd) {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    // Quick 50 ms fade to silence before switching songs: no click, no overlap.
    if (!video.paused && video.getAttribute('src')) {
      setGain(0, 0.012);
      clearTimeout(pendingLoad);
      pendingLoad = setTimeout(function () { doLoad(cmd); }, 60);
      return;
    }
    doLoad(cmd);
  }
  function doLoad(cmd) {
    if (cmd.audio) audio = Object.assign(audio, cmd.audio);
    cur = { token: cmd.token, clipStart: cmd.clipStart || 0, clipEnd: cmd.clipEnd, volume: cmd.volume != null ? cmd.volume : cur.volume, ended: false, test: !!cmd.test, start: cmd.start || 0, autoplay: cmd.autoplay };
    video.classList.remove('show');
    video.pause();
    video.src = cmd.href || fileHref(cmd.src);
    video.load();
    if (cmd.test) { showOverlay({ title: cmd.title, artist: cmd.artist, key: 'test' }); }
  }

  video.addEventListener('loadedmetadata', function () {
    try { video.currentTime = cur.start || 0; } catch (e) { /* */ }
    setGain(effectiveVolume(cur.start || 0), 0.005);
    if (cur.autoplay) {
      var p = video.play();
      if (p && p.catch) p.catch(function (e) { report('player:error', { token: cur.token, message: e.message }); });
    }
  });
  video.addEventListener('playing', function () {
    video.classList.add('show');
    if (!cur.test) window.cmb.invoke('player:started', { token: cur.token });
  });
  video.addEventListener('seeked', function () { if (cur.token != null) video.classList.add('show'); });
  video.addEventListener('error', function () {
    if (!video.getAttribute('src')) return;
    var err = video.error; var msg = err ? ({ 1: 'playback aborted', 2: 'file could not be read', 3: 'video could not be decoded', 4: 'format not supported' })[err.code] || 'unknown error' : 'unknown error';
    if (cur.test) { stopTest(); return; }
    report('player:error', { token: cur.token, message: msg });
  });
  video.addEventListener('ended', function () { finish(); });

  function finish() {
    if (cur.ended) return;
    cur.ended = true;
    video.pause();
    if (cur.test) { stopTest(); return; }
    report('player:ended', { token: cur.token });
  }

  function stopTest() { clear(); renderOverlay(); }

  function report(ch, data) { window.cmb.invoke(ch, data); }

  // High-resolution clip-end watch (timeupdate alone is only ~4 Hz)
  function watch() {
    if (cur.token != null && !video.paused && !cur.ended) {
      var t = video.currentTime;
      setGain(effectiveVolume(t));
      if (cur.clipEnd != null && t >= cur.clipEnd - 0.04) finish();
      var now = performance.now();
      if (now - lastReport > 250 && !cur.test) { lastReport = now; window.cmb.send('player:time-sync', { token: cur.token, t: t }); }
    }
    tickReveal();
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);

  function clear() {
    setGain(0, 0.01);
    cur.token = null; cur.ended = true;
    video.pause();
    video.classList.remove('show');
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* */ }
    if (cur.test) { cur.test = false; }
  }

  window.cmb.on('player', function (cmd) {
    switch (cmd.cmd) {
      case 'load': load(cmd); break;
      case 'play': cur.ended = false; video.play().catch(function (e) { report('player:error', { token: cur.token, message: e.message }); }); break;
      case 'pause': setGain(0, 0.01); setTimeout(function () { video.pause(); }, 40); break;
      case 'stop': video.pause(); try { video.currentTime = cur.clipStart; } catch (e) { /* */ } video.classList.remove('show'); break;
      case 'seek': try { video.currentTime = cmd.position; cur.ended = false; } catch (e) { /* */ } break;
      case 'volume': cur.volume = cmd.volume; setGain(effectiveVolume(video.currentTime || 0)); break;
      case 'audio': if (cmd.token == null || cmd.token === cur.token || cmd.token === -1 || cur.token == null) { audio = Object.assign(audio, { gainDb: cmd.gainDb || 0, fadeIn: cmd.fadeIn != null ? cmd.fadeIn : audio.fadeIn, fadeOut: cmd.fadeOut != null ? cmd.fadeOut : audio.fadeOut, muted: !!cmd.muted }); setGain(effectiveVolume(video.currentTime || 0)); } break;
      case 'clip': if (cmd.token === cur.token) { cur.clipStart = cmd.clipStart; cur.clipEnd = cmd.clipEnd; } break;
      case 'clear': clearTimeout(pendingLoad); clear(); break;
    }
  });

  /* ------------------------------------------------------------- overlay */
  function showOverlay(song) {
    $('ovTitle').textContent = song.title || '';
    $('ovArtist').textContent = song.artist || '';
    overlay.classList.remove('hidden');
  }

  function renderOverlay() {
    if (!state) return;
    var o = state.overlay || {};
    overlay.className = 'ov-' + (o.position || 'bottom-left') + (overlay.classList.contains('hidden') ? ' hidden' : '');
    document.documentElement.style.setProperty('--ov-op', String(o.opacity != null ? o.opacity : 0.78));
    document.documentElement.style.setProperty('--title-size', (o.titleSize || 64) + 'px');
    document.documentElement.style.setProperty('--artist-size', (o.artistSize || 38) + 'px');
    if (cur.test) return;
    var song = state.song;
    if (!song || o.enabled === false) { overlay.classList.add('hidden'); overlayKey = null; clearTimeout(overlayTimer); return; }
    if (song.key !== overlayKey) {
      overlayKey = song.key;
      overlay.classList.add('hidden');
      clearTimeout(overlayTimer);
      var delay = Math.max(0, Number(o.revealDelay) || 0);
      reveal = { song: song, delay: delay, done: delay === 0, duration: o.duration };
      setTimeout(function () {
        if (reveal.done) revealNow();
        else showTeaser(delay);
      }, 120);
    } else if (reveal && reveal.done) {
      $('ovTitle').textContent = song.title; $('ovArtist').textContent = song.artist;
    } else if (reveal) { reveal.song = song; reveal.delay = Math.max(0, Number(o.revealDelay) || 0); if (!reveal.delay) revealNow(); }
  }

  /* Delayed title reveal: a "Guess the song…" teaser counts down using the VIDEO's own
     time (so it pauses when the music pauses), then the real title slides in. */
  var reveal = null;
  function showTeaser(delay) {
    overlay.classList.add('teaser');
    $('ovTitle').textContent = '\u266A Guess the song\u2026';
    $('ovArtist').textContent = 'Title in ' + Math.ceil(delay) + 's';
    overlay.classList.remove('hidden');
  }
  function revealNow() {
    if (!reveal) return;
    reveal.done = true;
    overlay.classList.remove('teaser');
    overlay.classList.add('hidden');
    setTimeout(function () {
      showOverlay(reveal.song);
      overlay.classList.add('revealed'); setTimeout(function () { overlay.classList.remove('revealed'); }, 900);
      if (reveal.duration > 0) overlayTimer = setTimeout(function () { overlay.classList.add('hidden'); }, reveal.duration * 1000);
    }, reveal.delay ? 260 : 0);
  }
  function tickReveal() {
    if (!reveal || reveal.done || cur.test || cur.token == null) return;
    var into = (video.currentTime || 0) - (cur.clipStart || 0);
    var left = reveal.delay - into;
    if (left <= 0) revealNow();
    else $('ovArtist').textContent = 'Title in ' + Math.ceil(left) + 's';
  }
  window.__reveal = function () { return reveal ? { done: reveal.done, delay: reveal.delay, text: $('ovTitle').textContent } : null; };

  /* ------------------------------------------------------------- pattern */
  function renderPattern() {
    var r = state.round || { number: 0, status: 'pending' };
    var n = r.number || 1;
    var panel = $('pattern');
    panel.className = panel.className.replace(/\bpos-\S+/g, '').trim() + ' pos-' + (state.patternPosition || 'top-right');
    panel.classList.toggle('ended', r.status === 'ended');
    panel.classList.toggle('ready', r.status === 'ready');
    $('ptRound').textContent = (r.status === 'ready' ? 'NEXT · ' : '') + (r.number === 0 ? 'ROUND 1' : 'ROUND ' + r.number);
    $('ptLabel').textContent = CMBPatterns.LABELS[n];
    $('ptSub').textContent = r.number === 0 ? 'Get ready to play!' : (r.status === 'ended' ? 'Round complete' : r.status === 'ready' ? 'Starting soon!' : CMBPatterns.SHORT[n]);
    if (patternRound !== n) {
      patternRound = n; patternIdx = 0;
      clearInterval(patternTimer);
      var ex = CMBPatterns.examples(n);
      CMBPatterns.render($('ptGrid'), ex[0], 'pink');
      if (ex.length > 1) patternTimer = setInterval(function () { patternIdx = (patternIdx + 1) % ex.length; CMBPatterns.render($('ptGrid'), ex[patternIdx], 'pink'); }, 2200);
    }
  }

  function celebrate() {
    var p = $('pattern');
    p.classList.remove('celebrate'); void p.offsetWidth; p.classList.add('celebrate');
    setTimeout(function () { p.classList.remove('celebrate'); }, 5600);
  }

  /* ------------------------------------------------------------- state */
  /* ------------------------------------------------------------- welcome / end pages */
  var wlTimer = null, logoUrl = null, endKey = null;
  function fmtStart(t) { var p = t.split(':'); var h = +p[0], m = p[1]; var ap = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 || 12; return h12 + (m === '00' ? '' : ':' + m) + ap; }
  function renderPages() {
    var sc = (state && state.screen) || { mode: 'none' };
    $('welcome').classList.toggle('hidden', sc.mode !== 'welcome');
    $('endscreen').classList.toggle('hidden', sc.mode !== 'end');
    document.body.classList.toggle('page-on', sc.mode !== 'none');
    clearInterval(wlTimer); wlTimer = null;
    if (sc.mode === 'welcome') {
      $('wlName').textContent = sc.name || '';
      $('wlMeta').textContent = [sc.venue, sc.date].filter(Boolean).join('  \u00b7  ');
      var img = $('wlLogo'); if (logoUrl) { img.src = logoUrl; img.classList.add('has'); } else img.classList.remove('has');
      if (!$('wlRounds').children.length) {
        [1, 2, 3].forEach(function (n) {
          var d = document.createElement('div'); d.className = 'wl-round';
          var g = document.createElement('div'); CMBPatterns.render(g, CMBPatterns.examples(n)[0], 'pink'); d.appendChild(g);
          var t = document.createElement('div'); t.innerHTML = '<b>ROUND ' + n + '</b><span>' + CMBPatterns.LABELS[n] + '</span>'; d.appendChild(t);
          $('wlRounds').appendChild(d);
        });
      }
      $('wlMsg').textContent = sc.message || '';
      var tick = function () {
        if (!sc.startTime) { $('wlStart').className = 'wl-start empty'; return; }
        $('wlStart').className = 'wl-start';
        var p = sc.startTime.split(':'); var now = new Date(); var at = new Date(); at.setHours(+p[0], +p[1], 0, 0);
        var left = Math.round((at - now) / 1000);
        if (left < -6 * 3600) { at.setDate(at.getDate() + 1); left = Math.round((at - now) / 1000); } // a time early tomorrow
        $('wlAt').textContent = 'WE START AT ' + fmtStart(sc.startTime).toUpperCase();
        if (left > 0) { var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s2 = left % 60; $('wlCount').textContent = (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s2).slice(-2) + ' to go'; }
        else $('wlCount').textContent = 'Starting soon!';
      };
      tick(); wlTimer = setInterval(tick, 1000);
    }
    if (sc.mode === 'end') {
      $('esSub').textContent = (sc.name || '') + (sc.winners ? '  \u00b7  Congratulations to our ' + sc.winners + ' winner' + (sc.winners > 1 ? 's' : '') + '!' : '');
      var key = JSON.stringify(state.history.map(function (h) { return h.n + h.title; }));
      if (key !== endKey) {
        endKey = key;
        var list = $('esList'); list.innerHTML = ''; list.classList.remove('scrolling');
        var n = state.history.length; list.className = 'es-list' + (n <= 8 ? ' c1' : n <= 20 ? ' c2' : '');
        state.history.forEach(function (h) {
          var d = document.createElement('div'); d.className = 'es-item' + (h.credit ? ' credit' : '');
          d.innerHTML = '<span class="n"></span><span class="t"></span> <span class="a"></span>';
          d.children[0].textContent = (h.n < 10 ? '0' : '') + h.n; d.children[1].textContent = h.title; d.children[2].textContent = '\u2014 ' + h.artist;
          list.appendChild(d);
        });
        requestAnimationFrame(function () {
          var vp = $('esViewport'); var over = list.scrollHeight - vp.clientHeight;
          if (over > 4) { list.style.setProperty('--es-shift', -over + 'px'); list.style.setProperty('--es-dur', Math.max(20, over / 25) + 's'); list.classList.add('scrolling'); }
        });
      }
    }
  }

  function applyState(s) {
    if (!s) return;
    state = s;
    renderPages();
    renderOverlay();
    renderPattern();
    var c = s.crawler || {};
    ticker.configure({ speed: c.speed || 4, fontSize: c.fontSize || 30, separator: c.separator || 'diamond', paused: !!c.paused });
    document.documentElement.style.setProperty('--crawl-h', (c.height || 72) + 'px');
    ticker.setItems(s.history || []);
  }

  function applyAppSettings(a) {
    if (!a) return;
    logoUrl = a.logo ? a.logo + '?v=' + Date.now() : null;
    var img = $('idleLogo');
    if (a.logo) { img.src = a.logo + '?v=' + Date.now(); img.classList.add('has'); $('idle').classList.add('withlogo'); }
    else { img.removeAttribute('src'); img.classList.remove('has'); $('idle').classList.remove('withlogo'); }
    document.body.classList.toggle('aspect-cover', a.aspect === 'cover');
    document.body.classList.toggle('aspect-fill', a.aspect === 'fill');
    if (a.audioDeviceId) { sinkId = a.audioDeviceId; applySink(); }
  }

  window.cmb.on('audience-state', applyState);
  window.cmb.on('app-settings', applyAppSettings);
  window.cmb.on('event', function (e) { if (!e) return; if (e.name === 'celebrate') celebrate(); if (e.name === 'tvScreen') showTakeover(e.payload); });

  /* ------------------------------------------------------------- winner / wrong-claim screens */
  var toTimer = null, confettiRaf = null;
  var ROUND_MSG = {
    1: { title: 'ROUND 1 COMPLETE', msg: 'One Line conquered! Time for TWO PARALLEL LINES!' },
    2: { title: 'ROUND 2 COMPLETE', msg: "Two lines down. Now it's FULL HOUSE!" },
    3: { title: 'FULL HOUSE!', msg: "That's a wrap! Thanks for playing Crime Master Bingo." }
  };
  function showTakeover(p) {
    var el = $('takeover');
    if (p.type === 'round') {
      var m = ROUND_MSG[p.from] || ROUND_MSG[1];
      el.className = 'round' + (p.final ? ' final' : '');
      $('toEyebrow').textContent = p.final ? 'GAME COMPLETE' : 'ROUND ' + p.from + ' \u00b7 ' + p.fromLabel + ' \u2713';
      $('toTitle').textContent = p.final ? "THAT'S A WRAP!" : m.title;
      $('toCard').className = 'to-card';
      $('toSub').textContent = p.final ? 'FULL HOUSE!' : 'NEXT: ROUND ' + p.to + ' \u2014 ' + p.toLabel;
      $('toMsg').textContent = m.msg;
      CMBPatterns.render($('toGrid'), p.final ? CMBPatterns.examples(3)[0] : (p.pattern || CMBPatterns.examples(p.to)[0]), '');
      startConfetti();
      clearTimeout(toTimer);
      toTimer = setTimeout(function () { el.classList.add('hidden'); stopConfetti(); }, (p.seconds || 9) * 1000);
      return;
    }
    el.className = p.type === 'winner' ? 'winner' : 'wrong';
    $('toEyebrow').textContent = 'ROUND ' + p.round + ' \u00b7 ' + p.label;
    $('toTitle').textContent = p.type === 'winner' ? 'BINGO!' : 'NOT A BINGO';
    $('toCard').textContent = p.cardLabel ? 'CARD ' + p.cardLabel : '';
    $('toCard').className = 'to-card' + (p.cardLabel ? ' show' : '');
    if (p.type === 'winner') {
      $('toSub').textContent = p.winners > 1 ? p.winners + ' WINNERS!' : 'WE HAVE A WINNER!';
      $('toMsg').textContent = p.round < 3 ? 'Keep your cards — songs stay marked for the next round.' : 'Full house! Congratulations!';
      CMBPatterns.render($('toGrid'), p.pattern || CMBPatterns.examples(p.round)[0], '');
      startConfetti();
    } else {
      $('toSub').textContent = 'KEEP PLAYING!';
      $('toMsg').textContent = "Sorry — that card doesn't have a winning pattern yet. Check the played songs below and keep listening!";
      CMBPatterns.render($('toGrid'), CMBPatterns.examples(p.round)[0], 'pink');
      stopConfetti();
    }
    clearTimeout(toTimer);
    toTimer = setTimeout(function () { el.classList.add('hidden'); stopConfetti(); }, (p.seconds || 7) * 1000);
  }
  function startConfetti() {
    var cv = $('confetti'); var ctx = cv.getContext('2d');
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    var colors = ['#ffffff', '#ff4fa2', '#c4b0ff', '#ffc857', '#35d68f'];
    var parts = []; for (var i = 0; i < 180; i++) parts.push({ x: Math.random() * cv.width, y: -Math.random() * cv.height, w: 6 + Math.random() * 10, h: 8 + Math.random() * 14, vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, c: colors[i % colors.length] });
    stopConfetti();
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(function (q) { q.y += q.vy; q.x += q.vx; q.r += q.vr; if (q.y > cv.height + 20) { q.y = -20; q.x = Math.random() * cv.width; } ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore(); });
      confettiRaf = requestAnimationFrame(tick);
    })();
  }
  function stopConfetti() { if (confettiRaf) cancelAnimationFrame(confettiRaf); confettiRaf = null; var cv = $('confetti'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }

  window.cmb.invoke('player:ready').then(function (r) {
    applyAppSettings(r.appSettings);
    if (r.state) applyState(r.state);
    else { state = { round: { number: 0 }, history: [], overlay: {}, crawler: {} }; renderPattern(); ticker.setItems([]); }
  });
  window.__audience = { ticker: ticker, video: video, get cur() { return cur; }, get audio() { return audio; }, get gain() { return gainNode ? gainNode.gain.value : video.volume; }, get context() { return actx; } };
})();
