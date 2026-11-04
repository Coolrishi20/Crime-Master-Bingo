/* Anthem Square — audience (TV / projector) window.
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
  /* Rules Checklist Mode: compact checklist with mini patterns and ticks (no round numbers) */
  var ckDone = {}, ckListKey = null;
  function renderChecklistPanel() {
    var ck = state.checklist, r = state.round || { number: 0 };
    var panel = $('pattern');
    panel.className = panel.className.replace(/\bpos-\S+/g, '').trim() + ' pos-' + (state.patternPosition || 'top-right');
    panel.classList.add('checklist'); panel.classList.remove('ready'); panel.classList.toggle('ended', ck.allDone);
    clearInterval(patternTimer); patternTimer = null; patternRound = null;
    $('ptRound').textContent = 'WINNING RULES';
    $('ptToWin').textContent = ck.completed + ' / ' + ck.total;
    $('ptSub').textContent = !r.number ? 'Win them in any order!' : ck.allDone ? 'ALL RULES WON!' : (ck.total - ck.completed) + ' still to win · any order';
    var key = JSON.stringify(ck.items);
    if (key === ckListKey) return; ckListKey = key;
    var list = $('ptList'); var first = !list.children.length && !Object.keys(ckDone).length;
    list.innerHTML = '';
    list.classList.toggle('many', ck.items.length > 6);
    ck.items.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'pt-ck' + (it.done ? ' done' : '');
      if (it.done && !ckDone[it.id] && !first) row.classList.add('just'); // completion highlight
      ckDone[it.id] = it.done;
      var g = document.createElement('div'); CMBPatterns.render(g, it.example, it.done ? 'green' : 'pink'); row.appendChild(g);
      var t = document.createElement('span'); t.className = 'lb'; t.textContent = it.label; row.appendChild(t);
      var m = document.createElement('span'); m.className = 'tick'; m.textContent = it.done ? '✓' : ''; row.appendChild(m);
      list.appendChild(row);
    });
  }
  function renderPattern() {
    if (state.mode === 'checklist' && state.checklist) return renderChecklistPanel();
    $('pattern').classList.remove('checklist'); ckListKey = null;
    var r = state.round || { number: 0, status: 'pending' };
    var n = r.number || 1;
    var panel = $('pattern');
    panel.className = panel.className.replace(/\bpos-\S+/g, '').trim() + ' pos-' + (state.patternPosition || 'top-right');
    panel.classList.toggle('ended', r.status === 'ended');
    panel.classList.toggle('ready', r.status === 'ready');
    $('ptRound').textContent = (r.status === 'ready' ? 'NEXT · ' : '') + (r.number === 0 ? 'ROUND 1' : 'ROUND ' + r.number);
    $('ptToWin').textContent = 'TO WIN';
    $('ptLabel').textContent = r.label || CMBPatterns.LABELS[n];
    $('ptSub').textContent = r.number === 0 ? 'Get ready to play!' : (r.status === 'ended' ? 'Round complete' : r.status === 'ready' ? 'Starting soon!' : (r.short || CMBPatterns.SHORT[n]));
    var pkey = n + '|' + (r.label || '');
    if (patternRound !== pkey) {
      patternRound = pkey; patternIdx = 0;
      clearInterval(patternTimer);
      var ex = (r.examples && r.examples.length) ? r.examples : CMBPatterns.examples(n);
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
  var wlTimer = null, logoUrl = null, endKey = null, imTimer = null;
  /* Gentle end-screen scroller: rest at the top, glide down, rest, fade back to the top, repeat. */
  var esRaf = null;
  function startEndScroll(list, vp) {
    cancelAnimationFrame(esRaf); list.style.transform = ''; list.style.opacity = 1;
    var over = list.scrollHeight - vp.clientHeight; if (over <= 4) return;
    var speed = 26 * Math.max(0.5, window.innerHeight / 1080), HOLD = 6000, t0 = performance.now(), phase = 'top', y = 0;
    (function f(now) {
      var el = now - t0;
      if (phase === 'top' && el > HOLD) { phase = 'down'; t0 = now; }
      else if (phase === 'down') { y = Math.min(over, (el / 1000) * speed); if (y >= over) { phase = 'bottom'; t0 = now; } }
      else if (phase === 'bottom' && el > HOLD) { phase = 'fade'; t0 = now; }
      else if (phase === 'fade') { var k = Math.min(1, el / 700); list.style.opacity = 1 - k; if (k >= 1) { y = 0; phase = 'in'; t0 = now; } }
      else if (phase === 'in') { var k2 = Math.min(1, el / 700); list.style.opacity = k2; if (k2 >= 1) { phase = 'top'; t0 = now; } }
      list.style.transform = 'translate3d(0,' + (-y).toFixed(1) + 'px,0)';
      esRaf = requestAnimationFrame(f);
    })(t0);
  }
  function fmtDate(d) { var p = String(d).split('-'); if (p.length !== 3) return d; var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1]; return (+p[2]) + ' ' + m + ' ' + p[0]; }
  /** One-off confetti burst that settles and stops (doesn't distract once the list is on screen). */
  function burst(cv, ms) {
    var ctx = cv.getContext('2d'); cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    var colors = ['#FFF2CF', '#FF5B32', '#FFFFFF', '#FFB59E', '#FF7451']; var parts = []; var t0 = performance.now();
    for (var i = 0, N = lowRes ? 60 : 220; i < N; i++) parts.push({ x: cv.width / 2 + (Math.random() - .5) * cv.width * .3, y: cv.height * .25, vx: (Math.random() - .5) * 18, vy: -Math.random() * 16 - 4, w: 6 + Math.random() * 9, h: 8 + Math.random() * 12, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[i % colors.length] });
    (function f(now) {
      var el = now - t0; ctx.clearRect(0, 0, cv.width, cv.height);
      if (el > ms) return;
      var fade = el > ms - 1500 ? (ms - el) / 1500 : 1; ctx.globalAlpha = fade;
      parts.forEach(function (q) { q.vy += .35; q.vx *= .99; q.x += q.vx; q.y += q.vy; q.r += q.vr; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore(); });
      requestAnimationFrame(f);
    })(t0);
  }
  /* lobby: names pop in as players join on their phones */
  var lobbySeen = {};
  function drawLobby(names) {
    var box = $('wlLobby'), list = $('wlLobbyList');
    box.classList.toggle('hidden', !names.length);
    $('wlLobbyN').textContent = names.length === 1 ? '1 PLAYER HAS JOINED' : names.length + ' PLAYERS HAVE JOINED';
    var shown = names.slice(-36), more = names.length - shown.length;
    list.innerHTML = '';
    if (more > 0) { var m = document.createElement('span'); m.className = 'lb-more'; m.textContent = '+' + more + ' more'; list.appendChild(m); }
    shown.forEach(function (n) {
      var s = document.createElement('span'); s.className = 'lb-name' + (lobbySeen[n] ? '' : ' new'); s.textContent = n; list.appendChild(s); lobbySeen[n] = 1;
    });
  }
  /* suspense: how many cards are one song away (count only) */
  var lastClose = 0;
  function drawClose(st) {
    var n = (st && st.oneAway) || 0, el = $('ptClose');
    el.classList.toggle('hidden', !n);
    if (n) {
      el.innerHTML = '🔥 <b>' + n + '</b> ' + (n === 1 ? 'PLAYER IS' : 'PLAYERS ARE') + ' ONE SONG AWAY!';
      if (n > lastClose) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
    lastClose = n;
  }
  /* the game's own winning rules (custom rules, v1.5) with the standard ones as fallback */
  function roundInfoN(n) { return (state && state.rounds && state.rounds[n - 1]) || null; }
  function roundLabel(n) { var r = roundInfoN(n); return r ? r.label : CMBPatterns.LABELS[n]; }
  function roundExample(n) { var r = roundInfoN(n); return r && r.example ? r.example : CMBPatterns.examples(n)[0]; }
  function fmtStart(t) { var p = t.split(':'); var h = +p[0], m = p[1]; var ap = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 || 12; return h12 + (m === '00' ? '' : ':' + m) + ap; }
  function renderPages() {
    var sc = (state && state.screen) || { mode: 'none' };
    $('welcome').classList.toggle('hidden', sc.mode !== 'welcome');
    $('endscreen').classList.toggle('hidden', sc.mode !== 'end');
    $('intermission').classList.toggle('hidden', sc.mode !== 'intermission');
    clearInterval(imTimer); imTimer = null;
    if (sc.mode === 'intermission') {
      $('imName').textContent = sc.name || '';
      $('imMsg').textContent = sc.message || 'Grab a drink — back soon!';
      $('imNextN').textContent = sc.checklist ? 'STILL TO WIN' : 'NEXT: ROUND ' + sc.next.n;
      $('imNextL').textContent = sc.next.label;
      CMBPatterns.render($('imGrid'), sc.next.example || (sc.checklist ? Array(25).fill(false) : roundExample(sc.next.n)), 'pink');
      var imTick = function () {
        if (!sc.until) { $('imCount').textContent = ''; return; }
        var left = Math.round((new Date(sc.until) - new Date()) / 1000);
        $('imCount').textContent = left > 0 ? 'BACK IN ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) : 'STARTING SOON!';
      };
      imTick(); imTimer = setInterval(imTick, 1000);
    }
    document.body.classList.toggle('page-on', sc.mode !== 'none');
    clearInterval(wlTimer); wlTimer = null;
    if (sc.mode === 'welcome') {
      $('wlName').textContent = sc.name || '';
      $('wlMeta').textContent = [sc.venue, sc.date].filter(Boolean).join('  \u00b7  ');
      var img = $('wlLogo'); if (logoUrl) { img.src = logoUrl; img.classList.add('has'); } else img.classList.remove('has');
      var CKW = state.mode === 'checklist' && state.checklist;
      var rkey = CKW ? 'ck' + JSON.stringify(state.checklist.items.map(function (x) { return x.label; })) : JSON.stringify((state.rounds || []).map(function (x) { return x.label; }));
      if (CKW && $('wlRounds').getAttribute('data-k') !== rkey) {
        $('wlRounds').setAttribute('data-k', rkey); $('wlRounds').innerHTML = '';
        $('wlRounds').classList.toggle('many', state.checklist.items.length > 5);
        state.checklist.items.forEach(function (it) {
          var d = document.createElement('div'); d.className = 'wl-round';
          var g = document.createElement('div'); CMBPatterns.render(g, it.example, 'pink'); d.appendChild(g);
          var t = document.createElement('div'); t.innerHTML = '<b>TO WIN</b><span></span>'; t.querySelector('span').textContent = it.label; d.appendChild(t);
          $('wlRounds').appendChild(d);
        });
      } else if (!CKW && $('wlRounds').getAttribute('data-k') !== rkey) {
        $('wlRounds').setAttribute('data-k', rkey); $('wlRounds').innerHTML = '';
        (state.rounds || [{ n: 1 }, { n: 2 }, { n: 3 }]).map(function (x) { return x.n; }).forEach(function (n) {
          var d = document.createElement('div'); d.className = 'wl-round';
          var g = document.createElement('div'); CMBPatterns.render(g, roundExample(n), 'pink'); d.appendChild(g);
          var t = document.createElement('div'); t.innerHTML = '<b>ROUND ' + n + '</b><span></span>'; t.querySelector('span').textContent = roundLabel(n); d.appendChild(t);
          $('wlRounds').appendChild(d);
        });
      }
      document.querySelector('.wl-nodiag').textContent = CKW ? 'No rounds \u00b7 win the rules in any order \u00b7 songs stay marked' : state.diagonalsCount ? 'Same card all night \u00b7 songs stay marked' : 'Same card all night \u00b7 songs stay marked \u00b7 diagonals don\'t count';
      $('wlMsg').textContent = sc.message || '';
      $('wlJoin').classList.toggle('hidden', !sc.join);
      drawLobby(sc.players || []);
      if (sc.join) { if ($('wlJoinQr').getAttribute('src') !== sc.join.qr) $('wlJoinQr').src = sc.join.qr; $('wlJoinUrl').textContent = sc.join.url.replace(/^https?:\/\//, ''); }
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
      $('esSub').textContent = [sc.name, sc.venue, sc.date ? fmtDate(sc.date) : ''].filter(Boolean).join('  \u00b7  ');
      var eimg = $('esLogo'); if (logoUrl) { eimg.src = logoUrl; eimg.classList.add('has'); } else eimg.classList.remove('has');
      var stats = [[sc.songs, sc.songs === 1 ? 'SONG PLAYED' : 'SONGS PLAYED'], sc.checklist ? [sc.rulesWon + '/' + sc.rulesTotal, 'RULES WON'] : [sc.rounds || 0, (sc.rounds === 1 ? 'ROUND' : 'ROUNDS')], [sc.winners || 0, sc.winners === 1 ? 'WINNER' : 'WINNERS']];
      $('esStats').innerHTML = stats.map(function (x) { return '<div class="es-stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('');
      var key = JSON.stringify(state.history.map(function (h) { return h.n + h.title + h.round; }));
      if (key !== endKey) {
        endKey = key;
        var list = $('esList'); list.innerHTML = ''; cancelAnimationFrame(esRaf);
        var n = state.history.length; list.className = 'es-list' + (n <= 8 ? ' c1' : n <= 22 ? ' c2' : '');
        var lastRound = -1;
        state.history.forEach(function (h) {
          if (h.round && h.round !== lastRound && !sc.checklist) {
            lastRound = h.round;
            var hd = document.createElement('div'); hd.className = 'es-round';
            var g = document.createElement('div'); CMBPatterns.render(g, roundExample(h.round), 'pink'); hd.appendChild(g);
            var lb = document.createElement('b'); lb.textContent = 'ROUND ' + h.round + ' \u00b7 ' + roundLabel(h.round); hd.appendChild(lb);
            list.appendChild(hd);
          }
          var d = document.createElement('div'); d.className = 'es-item' + (h.credit ? ' credit' : '');
          d.innerHTML = '<span class="n"></span><span class="tx"><span class="t"></span><span class="a"></span></span>';
          d.querySelector('.n').textContent = h.n; d.querySelector('.t').textContent = h.title; d.querySelector('.a').textContent = h.artist;
          list.appendChild(d);
        });
        requestAnimationFrame(function () { startEndScroll(list, $('esViewport')); });
        burst($('esConfetti'), 7000);
      }
    }
  }

  function applyState(s) {
    if (!s) return;
    state = s;
    renderPages();
    drawClose(s);
    renderOverlay();
    renderPattern();
    var c = s.crawler || {};
    ticker.configure({ speed: c.speed || 4, fontSize: c.fontSize || 30, separator: c.separator || 'diamond', paused: !!c.paused });
    document.documentElement.style.setProperty('--crawl-h', (c.height || 72) + 'px');
    ticker.setItems(s.history || []);
  }

  var lowRes = false;
  function applyAppSettings(a) {
    if (!a) return;
    lowRes = !!a.lowResource; document.documentElement.classList.toggle('low-res', lowRes);
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
  window.cmb.on('event', function (e) { if (!e) return; if (e.name === 'celebrate') celebrate(); if (e.name === 'ruleCompleted') ckListKey = null; if (e.name === 'tvScreen') showTakeover(e.payload); });

  /* ------------------------------------------------------------- winner / wrong-claim screens */
  var toTimer = null, confettiRaf = null;
  var ROUND_MSG = {
    1: { title: 'ROUND 1 COMPLETE', msg: 'One Line conquered! Time for TWO PARALLEL LINES!' },
    2: { title: 'ROUND 2 COMPLETE', msg: "Two lines down. Now it's FULL HOUSE!" },
    3: { title: 'FULL HOUSE!', msg: "That's a wrap! Thanks for playing Anthem Square." }
  };
  function showTakeover(p) {
    var el = $('takeover');
    if (p.type === 'round') {
      var m = p.final ? ROUND_MSG[3] : (ROUND_MSG[p.from] || { title: 'ROUND ' + p.from + ' COMPLETE', msg: '' });
      if (!p.final && p.from > 2) m = { title: 'ROUND ' + p.from + ' COMPLETE', msg: '' };
      el.className = 'round' + (p.final ? ' final' : '');
      $('toEyebrow').textContent = p.final ? 'GAME COMPLETE' : 'ROUND ' + p.from + ' \u00b7 ' + p.fromLabel + ' \u2713';
      $('toTitle').textContent = p.final ? "THAT'S A WRAP!" : m.title;
      $('toCard').className = 'to-card';
      $('toSub').textContent = p.final ? (p.finalLabel || roundLabel(p.from)) + '!' : 'NEXT: ROUND ' + p.to + ' \u2014 ' + p.toLabel;
      $('toMsg').textContent = p.final ? m.msg : (p.fromLabel && p.toLabel ? p.fromLabel.charAt(0) + p.fromLabel.slice(1).toLowerCase() + ' conquered! Time for ' + p.toLabel + '!' : m.msg);
      CMBPatterns.render($('toGrid'), p.final ? (p.finalPattern || roundExample(p.from)) : (p.pattern || roundExample(p.to)), '');
      startConfetti();
      clearTimeout(toTimer);
      toTimer = setTimeout(function () { el.classList.add('hidden'); stopConfetti(); }, (p.seconds || 9) * 1000);
      return;
    }
    el.className = p.type === 'winner' ? 'winner' : 'wrong';
    $('toEyebrow').textContent = p.checklist ? (p.type === 'winner' ? 'RULE COMPLETED \u2713 \u00b7 ' + p.label : 'WINNING RULES CHECKLIST') : 'ROUND ' + p.round + ' \u00b7 ' + p.label;
    $('toTitle').textContent = p.type === 'winner' ? 'BINGO!' : 'NOT A BINGO';
    $('toCard').textContent = p.cardLabel ? 'CARD ' + p.cardLabel : '';
    $('toCard').className = 'to-card' + (p.cardLabel ? ' show' : '');
    if (p.type === 'winner') {
      var nm = (p.names || []).map(function (n) { return String(n).toUpperCase(); });
      $('toSub').textContent = nm.length ? (nm.length === 1 ? nm[0] + ' WINS!' : nm.slice(0, -1).join(', ') + ' & ' + nm[nm.length - 1] + ' WIN!') : (p.winners > 1 ? p.winners + ' WINNERS!' : 'WE HAVE A WINNER!');
      $('toSub').classList.toggle('named', nm.length > 0);
      $('toMsg').textContent = p.checklist ? (p.last ? 'Every rule has been won — congratulations!' : 'Keep your cards — the other rules are still up for grabs.') : !p.last ? 'Keep your cards — songs stay marked for the next round.' : 'Congratulations!';
      CMBPatterns.render($('toGrid'), p.pattern || (p.checklist ? Array(25).fill(true) : roundExample(p.round)), '');
      startConfetti();
    } else {
      $('toSub').textContent = 'KEEP PLAYING!';
      $('toMsg').textContent = "Sorry — that card doesn't have a winning pattern yet. Check the played songs below and keep listening!";
      var openRule = p.checklist && state && state.checklist ? state.checklist.items.filter(function (i) { return !i.done; })[0] : null;
      CMBPatterns.render($('toGrid'), p.checklist ? (openRule ? openRule.example : Array(25).fill(false)) : roundExample(p.round), 'pink');
      stopConfetti();
    }
    clearTimeout(toTimer);
    toTimer = setTimeout(function () { el.classList.add('hidden'); stopConfetti(); }, (p.seconds || 7) * 1000);
  }
  function startConfetti() {
    var cv = $('confetti'); var ctx = cv.getContext('2d');
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    var colors = ['#FFF2CF', '#FF5B32', '#FFFFFF', '#FFB59E', '#FF7451'];
    var parts = []; for (var i = 0, N = lowRes ? 50 : 180; i < N; i++) parts.push({ x: Math.random() * cv.width, y: -Math.random() * cv.height, w: 6 + Math.random() * 10, h: 8 + Math.random() * 14, vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, c: colors[i % colors.length] });
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
