/* Crime Master Bingo — a player's own card on their phone (home play).
 * The phone only shows the player's card and sends BINGO; the laptop decides everything. */
(function () {
  'use strict';
  var KEY = 'cmb-player';
  var $ = function (id) { return document.getElementById(id); };
  var ws = null, backoff = 500, state = null, auth = load(KEY), seq = 0, connected = false;
  var PAT = {
    1: [10, 11, 12, 13, 14],
    2: [0, 1, 2, 3, 4, 15, 16, 17, 18, 19],
    3: Array.from({ length: 25 }, function (_, i) { return i; })
  };

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function show(id) { ['join', 'wait', 'game'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); }); }
  function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { ws = new WebSocket(proto + '//' + location.host + '/ws'); } catch (e) { return retry(); }
    ws.onopen = function () {
      connected = true; backoff = 500; setConn();
      if (auth && auth.token) send({ type: 'pauth', token: auth.token }); else send({ type: 'pinfo' });
    };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } handle(m); };
    ws.onclose = function () { connected = false; setConn(); retry(); };
    ws.onerror = function () { /* onclose follows */ };
  }
  function retry() { setTimeout(connect, backoff); backoff = Math.min(5000, backoff * 1.7); if (!state) { show('wait'); $('wMsg').textContent = 'Connecting to the laptop… make sure this phone is on the same Wi-Fi.'; } }
  function setConn() { var c = $('conn'); c.classList.toggle('ok', connected); $('connTxt').textContent = connected ? 'Live' : 'Reconnecting…'; }

  function handle(m) {
    if (m.type === 'hello' || m.type === 'pong') return;
    if (m.type === 'p-info') {
      if (!m.enabled) { show('wait'); $('wMsg').textContent = 'There is no game to join yet — wait for the host, this page will update by itself.'; setTimeout(function () { send({ type: 'pinfo' }); }, 4000); return; }
      if (!m.open) { show('wait'); $('wMsg').textContent = 'Joining is closed for “' + m.gameName + '”. Ask the host to open it.'; setTimeout(function () { send({ type: 'pinfo' }); }, 4000); return; }
      $('jGame').textContent = m.gameName || ''; show('join'); return;
    }
    if (m.type === 'p-joined') { auth = { token: m.token }; save(KEY, auth); return; }
    if (m.type === 'p-auth-fail') {
      if (m.reason === 'not-in-game') { auth = null; save(KEY, null); state = null; send({ type: 'pinfo' }); return; }
      show('wait'); $('wMsg').textContent = m.reason || 'Waiting for the laptop…'; setTimeout(function () { if (auth) send({ type: 'pauth', token: auth.token }); }, 5000); return;
    }
    if (m.type === 'p-wait') { show('wait'); $('wMsg').textContent = m.reason; return; }
    if (m.type === 'p-removed') { auth = null; save(KEY, null); state = null; $('jMsg').textContent = 'The host removed you from this game. You can join again.'; send({ type: 'pinfo' }); return; }
    if (m.type === 'p-error') { $('jGo').disabled = false; $('jMsg').textContent = m.message; return; }
    if (m.type === 'p-state') { render(m.state); return; }
    if (m.type === 'p-bingo') { bingoResult(m); return; }
  }

  /* ------------------------------------------------------------ card */
  function marksKey() { return 'cmb-marks-' + state.gameId + '-' + state.me.cardNo; }
  function marks() { return load(marksKey()) || []; }
  function render(s) {
    var first = !state || state.me.cardNo !== s.me.cardNo;
    var prev = state; state = s;
    if (auth) { auth.gameId = s.gameId; save(KEY, auth); }
    show('game');
    $('gName').textContent = s.gameName; $('meName').textContent = s.me.name; $('meCard').textContent = s.me.cardLabel;
    if (first) {
      var g = $('grid'); g.innerHTML = '';
      s.cells.forEach(function (c, i) {
        var d = document.createElement('div'); d.className = 'cell'; d.dataset.i = i;
        d.innerHTML = '<div class="t">' + esc(c.t) + '</div>' + (c.a ? '<div class="a">' + esc(c.a) + '</div>' : '');
        d.onclick = function () { var mk = marks(); var k = mk.indexOf(i); if (k >= 0) mk.splice(k, 1); else mk.push(i); save(marksKey(), mk); paintMarks(); if (navigator.vibrate) navigator.vibrate(12); };
        g.appendChild(d);
      });
      paintMarks();
    }
    drawRound();
    // results from the host (shown once each)
    if (s.last) {
      var seen = load('cmb-seen') || {}; var k = s.last.id + ':' + s.last.status;
      if (!seen[k] && (!prev || !prev.last || prev.last.id !== s.last.id || prev.last.status !== s.last.status)) {
        seen[k] = 1; save('cmb-seen', seen);
        if (s.last.status === 'confirmed') { popup('win', '🏆', 'YOU WON ROUND ' + s.last.round + '!', 'Congratulations, ' + s.me.name + '! The host confirmed your card.'); confetti(); }
        else if (s.last.status === 'rejected' || s.last.status === 'dismissed') popup('no', '🤔', 'NOT CONFIRMED', 'The host didn\'t confirm card ' + s.me.cardLabel + ' this time. Keep playing!');
      }
    }
  }
  function paintMarks() { var mk = marks(); Array.prototype.forEach.call($('grid').children, function (d, i) { d.classList.toggle('on', mk.indexOf(i) >= 0); }); }

  function drawRound() {
    var s = state, r = s.round, box = $('round'), won = r.number && s.wins.indexOf(r.number) >= 0;
    var live = r.number && (r.status === 'active' || r.status === 'ended') && s.gameStatus !== 'finished';
    var pg = '<div class="pg">' + Array.from({ length: 25 }, function (_, i) { return '<i class="' + (r.number && PAT[r.number].indexOf(i) >= 0 ? 'on' : '') + '"></i>'; }).join('') + '</div>';
    box.className = 'round' + (live ? '' : ' idle') + (won ? ' won' : '');
    if (s.gameStatus === 'finished') box.innerHTML = '<div><b>GAME OVER</b><span>THANKS FOR PLAYING!</span><em>' + (s.wins.length ? 'You won round ' + s.wins.join(' & ') + ' 🏆' : 'See you next time!') + '</em></div>';
    else if (!r.number) box.innerHTML = '<div><b>GET READY</b><span>WAITING FOR ROUND 1</span><em>Same card all night · tap a song when you hear it</em></div>';
    else if (won) box.innerHTML = pg + '<div><b>ROUND ' + r.number + '</b><span>YOU WON THIS ROUND! 🏆</span><em>Keep your marks — the next round uses the same card</em></div>';
    else if (r.status === 'ready') box.innerHTML = pg + '<div><b>ROUND ' + r.number + ' · NEXT</b><span>' + esc(r.label) + '</span><em>' + esc(r.rule) + ' · starting soon</em></div>';
    else box.innerHTML = pg + '<div><b>ROUND ' + r.number + ' · TO WIN</b><span>' + esc(r.label) + '</span><em>' + esc(r.rule) + '</em></div>';
    var b = $('bingo'); b.disabled = !live || won;
    b.textContent = won ? 'WINNER! 🏆' : (live ? 'BINGO!' : (s.gameStatus === 'finished' ? 'GAME OVER' : 'WAIT FOR THE ROUND'));
  }

  /* ------------------------------------------------------------ BINGO */
  $('bingo').onclick = function () {
    if (!send({ type: 'pbingo', id: 'b' + (++seq) })) return popup('no', '📶', 'NOT CONNECTED', 'Reconnecting to the laptop — try again in a moment.');
    $('bingo').disabled = true; setTimeout(function () { if (state) drawRound(); }, 2500);
  };
  function bingoResult(m) {
    if (m.result === 'not-yet') popup('no', '🎵', 'NOT A BINGO YET', 'Keep listening! This round needs ' + (m.label ? m.label.toLowerCase() : 'the winning pattern') + ' — only songs that have actually played count.');
    else if (m.result === 'checking') popup('check', '✋', 'LOOKS LIKE A BINGO!', 'The host is checking card ' + state.me.cardLabel + ' now — the music is paused.');
    else if (m.result === 'already') popup('win', '🏆', 'ALREADY A WINNER', 'You have already won this round. Wait for the next one!');
    else if (m.result === 'no-round') popup('no', '⏳', 'NOT NOW', m.message || 'No round is running right now.');
    else if (m.result === 'error') popup('no', '⚠', 'SORRY', m.message || 'Something went wrong.');
  }

  function popup(kind, icon, title, msg) {
    var p = $('pop'); p.className = 'pop ' + kind; $('popIcon').textContent = icon; $('popTitle').textContent = title; $('popMsg').textContent = msg;
    if (navigator.vibrate) navigator.vibrate(kind === 'win' ? [80, 60, 80, 60, 200] : 40);
  }
  $('popOk').onclick = function () { $('pop').className = 'pop hidden'; };
  $('clear').onclick = function () { if (state && confirm('Clear all the marks on your card?')) { save(marksKey(), []); paintMarks(); } };

  $('jGo').onclick = function () {
    var n = $('jName').value.trim();
    if (!n) { $('jMsg').textContent = 'Please type your name.'; return; }
    $('jMsg').textContent = ''; $('jGo').disabled = true;
    if (!send({ type: 'pjoin', name: n })) { $('jGo').disabled = false; $('jMsg').textContent = 'Not connected to the laptop yet.'; }
    setTimeout(function () { $('jGo').disabled = false; }, 4000);
  };
  $('jName').onkeydown = function (e) { if (e.key === 'Enter') $('jGo').click(); };

  /* tiny confetti burst */
  function confetti() {
    var c = $('fx'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
    var cols = ['#ff4fa2', '#35d68f', '#ffc857', '#c4b0ff', '#ffffff'], P = [];
    for (var i = 0; i < 140; i++) P.push({ x: c.width / 2, y: c.height / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4, s: 4 + Math.random() * 6, c: cols[i % cols.length], r: Math.random() * 6 });
    var t = 0; (function f() { x.clearRect(0, 0, c.width, c.height); P.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.vy += .45; p.r += .2; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); x.restore(); }); if (++t < 150) requestAnimationFrame(f); else x.clearRect(0, 0, c.width, c.height); })();
  }

  setInterval(function () { send({ type: 'ping', t: Date.now() }); }, 20000);
  show('wait'); connect();
})();
