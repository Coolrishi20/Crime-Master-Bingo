/* Crime Master Bingo — phone host remote.
 * Strictly a controller: it never plays audio or video. Every button sends a
 * command to the laptop, which executes it and broadcasts the new state. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TOKEN_KEY = 'cmb.remote.token';
  var ws = null, state = null, authed = false, backoff = 500, pingTimer = null, lastPong = 0, reconnectTimer = null;
  var pending = {}; // id -> {msg, resolve, reject, timer}
  var tab = 'play', ckInput = '', ckOpen = false, ckPaused = false, scanStream = null, scanRaf = null;
  var tick = { position: 0 };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function uuid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }
  function pad3(n) { return ('00' + n).slice(-3); }
  var toastT;
  function toast(msg, type) { var t = $('toast'); t.textContent = msg; t.className = 'toast ' + (type || ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast hidden'; }, 3200); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* */ } }

  function ask(title, body, buttons) {
    return new Promise(function (resolve) {
      $('mTitle').textContent = title; $('mBody').innerHTML = body;
      var box = $('mBtns'); box.innerHTML = '';
      buttons.forEach(function (b) { var el = document.createElement('button'); el.className = 'btn ' + (b.kind || ''); el.textContent = b.label; el.onclick = function () { $('modal').classList.add('hidden'); resolve(b.value); }; box.appendChild(el); });
      $('modal').classList.remove('hidden');
    });
  }
  function confirmIt(title, body, ok, danger) { return ask(title, body, [{ label: ok, value: true, kind: danger ? 'danger' : 'primary' }, { label: 'Cancel', value: false }]); }

  /* ------------------------------------------------------------ connection */
  function setConn(kind, txt) { $('conn').className = 'conn ' + kind; $('connTxt').textContent = txt; }

  function connect() {
    clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setConn('', 'Connecting…');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { ws = new WebSocket(proto + '//' + location.host + '/ws'); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = function () { backoff = 500; lastPong = Date.now(); };
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
    ws.onclose = function () { authed = false; setConn('bad', 'Reconnecting…'); scheduleReconnect(); };
    ws.onerror = function () { /* close follows */ };
  }
  function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000); }
  function send(obj) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; }

  // App-level heartbeat detects sockets killed by phone sleep / Wi-Fi changes
  setInterval(function () {
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - lastPong > 12000) { try { ws.close(); } catch (e) { /* */ } return; }
    send({ type: 'ping', t: Date.now() });
  }, 4000);
  ['visibilitychange', 'focus', 'online', 'pageshow'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (document.visibilityState !== 'hidden') { if (!ws || ws.readyState > 1) { backoff = 300; connect(); } else send({ type: 'ping', t: Date.now() }); } });
  });

  function onMsg(m) {
    lastPong = Date.now();
    if (m.type === 'hello') {
      var tok = store(TOKEN_KEY);
      if (tok) send({ type: 'auth', token: tok }); else showPair();
    } else if (m.type === 'paired') { store(TOKEN_KEY, m.token); }
    else if (m.type === 'auth-ok') {
      authed = true; setConn('ok', 'Connected'); showMain();
      // resend any commands that never got an answer (server de-duplicates by id)
      Object.keys(pending).forEach(function (id) { send(pending[id].msg); });
    } else if (m.type === 'auth-fail') {
      if (!$('pair').classList.contains('hidden')) { $('pairMsg').textContent = m.reason; $('pairBtn').disabled = false; }
      else { store(TOKEN_KEY, null); showPair(m.reason); }
    } else if (m.type === 'revoked') { store(TOKEN_KEY, null); showPair('This phone was removed by the laptop. Pair again with the PIN.'); }
    else if (m.type === 'state') { state = m.state.game; if (state) tick.position = state.playback.position; render(); }
    else if (m.type === 'tick') { tick = m; if (state) { state.playback.position = m.position; state.playback.status = m.status; } renderProgress(); }
    else if (m.type === 'ack') {
      var p = pending[m.id]; if (!p) return;
      clearTimeout(p.timer); delete pending[m.id];
      if (m.ok || (m.result && m.result.needsConfirm)) p.resolve(m.result || {}); else p.reject(new Error(m.error || (m.result && m.result.message) || 'Command failed'));
    } else if (m.type === 'event') {
      if (m.name === 'celebrate') { vibrate([80, 60, 80]); }
      if (m.name === 'error') toast(m.payload.message, 'err');
    }
  }

  /** Send a command to the laptop. Unique id → never executed twice even if re-sent after a reconnect. */
  function cmd(action, args) {
    return new Promise(function (resolve, reject) {
      var id = uuid();
      var msg = { type: 'cmd', id: id, action: action, args: args || {} };
      var entry = { msg: msg, resolve: resolve, reject: reject };
      entry.timer = setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('The laptop did not answer — check the Wi-Fi connection.')); } }, 15000);
      pending[id] = entry;
      if (!send(msg)) toast('Not connected — the command will be sent when the phone reconnects', 'err');
    }).catch(function (e) { toast(e.message, 'err'); vibrate(200); throw e; });
  }
  function safe(p) { return p.catch(function () { return null; }); }

  /* ------------------------------------------------------------ pairing */
  function showPair(msg) {
    $('pair').classList.remove('hidden'); $('main').classList.add('hidden'); $('checker').classList.add('hidden');
    $('pairMsg').textContent = msg || ''; $('pairBtn').disabled = false;
    var m = /pin=(\d{6})/.exec(location.hash);
    if (m && !$('pin').value) { $('pin').value = m[1]; }
    if (!$('devName').value) $('devName').value = store('cmb.remote.name') || guessName();
    if (m && !msg) doPair();
  }
  function guessName() { var ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'Phone'; }
  function doPair() {
    var pin = $('pin').value.replace(/\D/g, '');
    if (pin.length !== 6) { $('pairMsg').textContent = 'Enter the 6-digit PIN from the laptop.'; return; }
    store('cmb.remote.name', $('devName').value);
    $('pairBtn').disabled = true; $('pairMsg').textContent = '';
    if (!send({ type: 'pair', pin: pin, deviceName: $('devName').value || guessName() })) { connect(); setTimeout(doPair, 800); }
    history.replaceState(null, '', location.pathname);
  }
  $('pairBtn').onclick = doPair;
  $('pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') doPair(); });
  function showMain() { $('pair').classList.add('hidden'); $('main').classList.remove('hidden'); }

  /* ------------------------------------------------------------ rendering */
  function render() {
    if (!state) {
      $('gName').textContent = 'No game loaded'; $('roundChip').textContent = 'OPEN A GAME ON THE LAPTOP'; $('roundChip').className = 'chip dim';
      $('nowTitle').textContent = '—'; $('nowArtist').textContent = 'Create or resume a game on the laptop.'; return;
    }
    var g = state, pb = g.playback, cur = g.current;
    $('gName').textContent = g.name;
    $('roundChip').textContent = g.round.number ? 'ROUND ' + g.round.number + ' · ' + g.round.label + (g.round.status === 'ended' ? ' · ENDED' : '') : 'NOT STARTED';
    $('roundChip').className = 'chip' + (g.round.status === 'active' ? '' : ' dim');
    var b = $('banner'); var msg = '';
    if (g.status === 'finished') msg = 'This game has ended.';
    else if (!g.audienceConnected) msg = '⚠ The TV (audience window) is not open on the laptop.';
    else if (pb.pausedForClaim) msg = '⏸ Music paused for a BINGO check.';
    else if (g.gamePaused) msg = '⏸ Game paused.';
    else if (g.lastError) msg = '⚠ ' + g.lastError;
    b.textContent = msg; b.classList.toggle('hidden', !msg);
    var playing = pb.status === 'playing' || pb.status === 'loading';
    $('nowLbl').textContent = cur ? 'Song ' + cur.number + ' · ' + (pb.status === 'between' ? 'next song coming' : pb.status) + (cur.played ? ' · ✓ counted' : '') : 'Now playing';
    $('nowTitle').textContent = cur ? cur.title : (g.round.number ? 'Ready' : 'Start Round 1');
    $('nowArtist').textContent = cur ? cur.artist : (g.round.number ? '' : 'Go to Rounds → Start Round 1');
    $('sSong').textContent = cur ? cur.number : '–';
    $('sPlayed').textContent = g.totals.played; $('sLeft').textContent = g.totals.remaining;
    $('playIco').textContent = playing || pb.status === 'between' ? '❚❚' : '▶';
    $('playTxt').textContent = playing || pb.status === 'between' ? 'Pause' : (pb.status === 'paused' ? 'Resume' : 'Play');
    if (document.activeElement !== $('vol')) { $('vol').value = g.settings.volume; $('volV').textContent = g.settings.volume; }
    $('nextUp').textContent = g.next ? 'Up next: ' + g.next.title + ' — ' + g.next.artist : '';
    $('markBtn').disabled = !cur || cur.played;
    renderProgress(); renderRounds(); renderHistory();
    $('ckPaused').textContent = pb.pausedForClaim ? '⏸ Music is paused — position saved.' : '';
    $('ckResume').textContent = pb.status === 'paused' ? '▶ Resume music' : 'Done';
  }
  function renderProgress() {
    if (!state) return; var pb = state.playback; var cs = pb.clipStart || 0, ce = pb.clipEnd || 0; var pos = pb.position || 0;
    var pct = ce > cs ? Math.max(0, Math.min(100, (pos - cs) / (ce - cs) * 100)) : 0;
    $('progFill').style.width = (state.current && pb.status !== 'between' ? pct : 0) + '%';
    $('tPos').textContent = fmt(pos);
    $('tLeft').textContent = state.current && ce ? fmt(Math.max(0, ce - pos)) + ' left in clip' : '';
  }
  function renderRounds() {
    var g = state; var box = $('roundBtns'); box.innerHTML = '';
    [1, 2, 3].forEach(function (n) {
      var active = g.round.number === n && g.round.status === 'active';
      var done = g.round.number > n || (g.round.number === n && g.round.status === 'ended');
      var can = (n > g.round.number || (n === g.round.number && g.round.status !== 'active')) && g.status !== 'finished';
      var el = document.createElement('button');
      el.className = 'round-btn' + (active ? ' active' : '') + (done ? ' done' : '');
      el.disabled = !can && !active;
      var grid = document.createElement('div'); CMBPatterns.render(grid, CMBPatterns.examples(n)[0], 'pink');
      el.appendChild(grid);
      var t = document.createElement('div'); t.innerHTML = '<b>ROUND ' + n + '</b><div class="lab">' + CMBPatterns.LABELS[n] + '</div><div class="st">' + (active ? 'IN PLAY' : done ? 'Complete' : can ? 'Tap to start' : '') + '</div>';
      el.appendChild(t);
      el.onclick = function () {
        if (active || !can) return;
        var body = g.round.status === 'active' ? 'This ends Round ' + g.round.number + ' and starts <b>' + CMBPatterns.LABELS[n] + '</b>. Played songs stay marked.' : 'Start <b>' + CMBPatterns.LABELS[n] + '</b>? The TV switches to the new winning pattern' + (n === 1 ? ' and the first song starts.' : '.');
        confirmIt('Start Round ' + n + '?', body, 'Start Round ' + n).then(function (ok) { if (ok) safe(cmd('startRound', { round: n })).then(function (r) { if (r) { toast('Round ' + n + ' started', 'ok'); if (r.warning) toast(r.warning, 'err'); } }); });
      };
      box.appendChild(el);
    });
    $('endRound').disabled = g.round.status !== 'active';
    $('pauseGame').textContent = g.gamePaused ? 'Resume game' : 'Pause game';
    $('winners').innerHTML = g.winners.length ? g.winners.map(function (w) { return '<div class="winner"><span class="cn">' + w.cardLabel + '</span><div><b>Round ' + w.round + '</b><div class="muted small">' + esc(w.headline) + '</div></div></div>'; }).join('') : '<div class="muted small">No winners confirmed yet.</div>';
  }
  function renderHistory() {
    var g = state; var c = g.settings.crawler;
    if (document.activeElement !== $('crSpeed')) $('crSpeed').value = c.speed;
    $('crSpeedV').textContent = c.speed;
    $('crPause').textContent = c.paused ? '▶ Resume crawler' : '❚❚ Pause crawler';
    $('histLbl').textContent = 'Played songs (' + g.history.length + ')';
    $('history').innerHTML = g.history.length ? g.history.slice().reverse().map(function (h) { return '<div class="hist"><span class="n">' + ('0' + h.n).slice(-2) + '</span><div><b>' + esc(h.title) + '</b> <span class="a">— ' + esc(h.artist) + '</span></div></div>'; }).join('') : '<div class="muted small">No songs played yet.</div>';
  }

  /* ------------------------------------------------------------ controls */
  $('playBtn').onclick = function () { vibrate(15); safe(cmd('togglePlay')); };
  $('nextBtn').onclick = function () { vibrate(15); doNext(); };
  $('skipBtn').onclick = function () { doNext(); };
  function doNext() {
    if (!state) return; var idx = state.playback.index;
    safe(cmd('next', { expectIndex: idx })).then(function (r) {
      if (r && r.needsConfirm) {
        ask('Skip this song?', 'It hasn\'t finished. Skipped songs are not counted and don\'t appear in the TV crawler.', [{ label: 'Skip (don\'t count)', value: 'skip', kind: 'primary' }, { label: 'Mark as played & next', value: 'markPlayed' }, { label: 'Cancel', value: null }])
          .then(function (mode) { if (mode) safe(cmd('next', { mode: mode, expectIndex: idx })); });
      } else if (r && r.finished) toast(r.message, 'ok');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-cmd]'), function (b) {
    b.onclick = function () { vibrate(15); var a = b.getAttribute('data-cmd'); safe(cmd(a, a === 'replay' ? { expectIndex: state && state.playback.index } : {})); };
  });
  $('markBtn').onclick = function () { if (!state || !state.current) return; confirmIt('Mark as played?', 'Add “' + esc(state.current.title) + '” to the played list now? It appears in the TV crawler and counts on cards.', 'Mark played').then(function (ok) { if (ok) safe(cmd('markPlayed', { songId: state.current.songId })); }); };
  var volT; $('vol').oninput = function (e) { $('volV').textContent = e.target.value; clearTimeout(volT); volT = setTimeout(function () { safe(cmd('setVolume', { volume: Number(e.target.value) })); }, 120); };
  $('endRound').onclick = function () { confirmIt('End Round ' + state.round.number + '?', 'Songs stay marked for the next round.', 'End round').then(function (ok) { if (ok) safe(cmd('endRound')); }); };
  $('pauseGame').onclick = function () { safe(cmd(state.gamePaused ? 'resumeGame' : 'pauseGame')); };
  $('endGame').onclick = function () { confirmIt('End the game?', 'Playback stops and the game is saved as finished.', 'End game', true).then(function (ok) { if (ok) safe(cmd('endGame')); }); };
  var crT; $('crSpeed').oninput = function (e) { $('crSpeedV').textContent = e.target.value; clearTimeout(crT); crT = setTimeout(function () { safe(cmd('setCrawler', { speed: Number(e.target.value) })); }, 150); };
  $('crPause').onclick = function () { safe(cmd('setCrawler', { togglePause: true })); };
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
    b.onclick = function () { tab = b.getAttribute('data-tab'); Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (x) { x.classList.toggle('on', x === b); }); ['play', 'rounds', 'history'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== tab); }); window.scrollTo(0, 0); };
  });

  /* ------------------------------------------------------------ bingo checker */
  var keypad = $('keypad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].forEach(function (k) {
    var b = document.createElement('button'); b.textContent = k;
    b.onclick = function () { vibrate(8); if (k === 'C') ckInput = ''; else if (k === '⌫') ckInput = ckInput.slice(0, -1); else if (ckInput.length < 3) ckInput += k; drawInput(); };
    keypad.appendChild(b);
  });
  function drawInput() { $('ckDisplay').textContent = ckInput ? ckInput : '___'; }
  $('bingoFab').onclick = function () {
    vibrate(30); ckOpen = true; ckInput = ''; drawInput();
    $('checker').classList.remove('hidden'); $('ckEntry').classList.remove('hidden'); $('ckResult').classList.add('hidden');
    safe(cmd('openChecker')).then(function (r) { ckPaused = !!(r && r.paused); });
  };
  function closeChecker(resume) {
    stopScan(); ckOpen = false; $('checker').classList.add('hidden');
    safe(cmd('closeChecker', { resume: !!resume }));
  }
  $('ckClose').onclick = function () { closeChecker(false); };
  $('ckResume').onclick = function () { closeChecker(state && state.playback.status === 'paused'); };
  $('ckAgain').onclick = function () { ckInput = ''; drawInput(); $('ckEntry').classList.remove('hidden'); $('ckResult').classList.add('hidden'); };
  $('ckGo').onclick = function () { if (!ckInput) return toast('Type the card number', 'err'); check({ cardNo: ckInput }); };
  function check(args) {
    $('ckResult').innerHTML = '<div class="muted center">Checking…</div>'; $('ckResult').classList.remove('hidden'); $('ckEntry').classList.add('hidden');
    cmd('checkClaim', args).then(function (r) {
      if (!r || r.ok === false) { $('ckResult').innerHTML = '<div class="verdict invalid"><div class="vt">CANNOT CHECK</div><div class="rs">' + esc((r && r.error) || 'Unknown error') + '</div></div>'; vibrate(200); return; }
      showResult(r);
    }, function () { $('ckEntry').classList.remove('hidden'); $('ckResult').classList.add('hidden'); });
  }
  function showResult(r) {
    var dup = r.alreadyWinner; var cls = dup ? 'dup' : (r.valid ? 'valid' : 'invalid');
    vibrate(r.valid && !dup ? [60, 40, 60] : 250);
    var h = '<div class="verdict ' + cls + '"><div class="vt">' + (dup ? 'ALREADY WON' : r.valid ? 'VALID BINGO!' : 'NOT VALID') + '</div><div class="hl">Card ' + r.cardLabel + ' — ' + esc(r.headline) + '</div><div class="rs">' + esc(r.reason) + '</div><div class="rs">Round ' + r.round + ' · ' + esc(r.roundLabel) + (r.qualifiedAtSong ? ' · qualified at song #' + r.qualifiedAtSong : '') + (r.printed ? '' : ' · ⚠ card not marked printed') + '</div></div>';
    h += '<div class="mini">' + r.grid.map(function (c) { return '<div class="' + (c.winning ? 'w' : c.played ? 'p' : '') + '"><b>' + esc(c.title) + '</b><span>' + esc(c.artist) + '</span></div>'; }).join('') + '</div>';
    if (r.valid && !dup) h += '<button class="btn success big" style="width:100%" id="ckConfirm">✓ CONFIRM WINNER</button><button class="btn danger wide" id="ckDismiss">Dismiss claim</button>';
    else if (!r.valid) h += '<button class="btn danger wide" id="ckReject">Reject claim</button>';
    $('ckResult').innerHTML = h;
    var c = $('ckConfirm');
    if (c) c.onclick = function () { confirmIt('Confirm card ' + r.cardLabel + '?', 'Record card ' + r.cardLabel + ' as a Round ' + r.round + ' winner. The TV will celebrate (without showing the card).', 'Confirm winner').then(function (ok) { if (!ok) return; safe(cmd('confirmClaim', { claimId: r.claimId })).then(function (x) { if (x) { toast('Winner confirmed!', 'ok'); c.outerHTML = '<div class="verdict valid"><div class="vt">WINNER CONFIRMED</div></div>'; var d = $('ckDismiss'); if (d) d.remove(); } }); }); };
    var d = $('ckDismiss'); if (d) d.onclick = function () { safe(cmd('dismissClaim', { claimId: r.claimId })).then(function () { toast('Claim dismissed'); d.remove(); if (c) c.remove(); }); };
    var j = $('ckReject'); if (j) j.onclick = function () { safe(cmd('dismissClaim', { claimId: r.claimId })).then(function () { toast('Claim rejected'); j.remove(); }); };
  }
  /* QR scanning: live camera where the browser allows it (HTTPS/localhost), otherwise take a photo — both decode locally with jsQR. */
  $('ckScan').onclick = function () {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext) startScan();
    else $('ckFile').click();
  };
  $('ckFile').onchange = function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var img = new Image(); var url = URL.createObjectURL(f);
    img.onload = function () {
      var maxW = 1600, sc = Math.min(1, maxW / img.width); var cv = document.createElement('canvas'); cv.width = img.width * sc; cv.height = img.height * sc;
      var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, cv.width, cv.height);
      var d = ctx.getImageData(0, 0, cv.width, cv.height); var code = window.jsQR && jsQR(d.data, d.width, d.height);
      URL.revokeObjectURL(url); e.target.value = '';
      if (code && code.data) check({ qr: code.data }); else toast('No QR code found in the photo — try again closer, or type the number.', 'err');
    };
    img.src = url;
  };
  function startScan() {
    $('ckScanBox').classList.remove('hidden');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      scanStream = s; var v = $('ckVid'); v.srcObject = s; v.play();
      var cv = document.createElement('canvas'); var ctx = cv.getContext('2d');
      var loop = function () {
        if (!scanStream) return;
        if (v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0); var d = ctx.getImageData(0, 0, cv.width, cv.height); var code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' }); if (code && code.data) { stopScan(); check({ qr: code.data }); return; } }
        scanRaf = requestAnimationFrame(loop);
      };
      loop();
    }).catch(function () { $('ckScanBox').classList.add('hidden'); $('ckFile').click(); });
  }
  function stopScan() { if (scanRaf) cancelAnimationFrame(scanRaf); scanRaf = null; if (scanStream) scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; $('ckScanBox').classList.add('hidden'); }

  // Initial
  if (!store(TOKEN_KEY) && !/pin=/.test(location.hash)) showPair();
  connect();
  window.__remote = { get state() { return state; }, cmd: cmd };
})();
