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
  // On the secure link, if this phone's browser refuses the laptop's certificate for the
  // live connection, offer the standard link instead (scanning then uses photos).
  var secureFails = 0, everConnected = false;
  function secureFallback() {
    if (location.protocol !== 'https:' || everConnected || secureFails < 3 || document.getElementById('plainLink')) return;
    fetch('/connect.json').then(function (r) { return r.json(); }).then(function (j) {
      var url = 'http://' + location.hostname + ':' + j.httpPort + '/' + location.hash;
      var b = document.createElement('div'); b.className = 'banner'; b.id = 'plainLink';
      b.innerHTML = 'This phone won\'t accept the secure connection. <a href="' + url + '" style="color:#fff;font-weight:800">Use the standard link →</a> (QR scanning will take a photo instead)';
      var target = document.getElementById('pair').classList.contains('hidden') ? document.getElementById('main') : document.getElementById('pair');
      target.insertBefore(b, target.firstChild);
    }).catch(function () {});
  }
  function scheduleReconnect() {
    if (!authed && !everConnected) { secureFails++; secureFallback(); } clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000); }
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
      authed = true; everConnected = true; setConn('ok', 'Connected'); showMain();
      // resend any commands that never got an answer (server de-duplicates by id)
      Object.keys(pending).forEach(function (id) { send(pending[id].msg); });
    } else if (m.type === 'auth-fail') {
      if (!$('pair').classList.contains('hidden')) { $('pairMsg').textContent = m.reason; $('pairBtn').disabled = false; }
      else { store(TOKEN_KEY, null); showPair(m.reason); }
    } else if (m.type === 'revoked') { store(TOKEN_KEY, null); showPair('This phone was removed by the laptop. Pair again with the PIN.'); }
    else if (m.type === 'state') { state = m.state.game; if (state) tick.position = state.playback.position; render(); if (askingNext && askRound && (!state || state.round.number !== askRound || state.round.status === 'ready' || state.intermission || state.status === 'finished') && !$('modal').classList.contains('hidden')) { $('modal').classList.add('hidden'); askingNext = false; askRound = null; } }
    else if (m.type === 'tick') { tick = m; if (state) { state.playback.position = m.position; state.playback.status = m.status; } renderProgress(); }
    else if (m.type === 'ack') {
      var p = pending[m.id]; if (!p) return;
      clearTimeout(p.timer); delete pending[m.id];
      if (m.ok || (m.result && m.result.needsConfirm)) p.resolve(m.result || {}); else p.reject(new Error(m.error || (m.result && m.result.message) || 'Command failed'));
    } else if (m.type === 'event') {
      if (m.name === 'celebrate') { vibrate([80, 60, 80]); }
      if (m.name === 'error') toast(m.payload.message, 'err');
      if (m.name === 'playerBingo') playerBingo(m.payload);

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
    var CK = g.mode === 'checklist' ? g.checklist : null;
    $('roundChip').textContent = CK ? (g.round.number ? 'RULES ' + CK.completed + ' OF ' + CK.total + ' COMPLETED' : 'NOT STARTED · ' + CK.total + ' RULES') : g.round.number ? 'ROUND ' + g.round.number + ' · ' + g.round.label + (g.round.status === 'ended' ? ' · ENDED' : '') : 'NOT STARTED';
    var tb = document.querySelector('#tabs [data-tab=rounds]'); if (tb) tb.innerHTML = '<span>' + (CK ? '✓' : '▦') + '</span>' + (CK ? 'Rules' : 'Rounds');
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
    $('nowTitle').textContent = cur ? cur.title : (g.round.number ? 'Ready' : (CK ? 'Start the game' : 'Start Round 1'));
    $('nowArtist').textContent = cur ? cur.artist : (g.round.number ? '' : (CK ? 'Go to Rules → Start game' : 'Go to Rounds → Start Round 1'));
    $('sSong').textContent = cur ? cur.number : '–';
    $('sPlayed').textContent = g.totals.played; $('sLeft').textContent = g.totals.remaining;
    $('playIco').textContent = playing || pb.status === 'between' ? '❚❚' : '▶';
    $('playTxt').textContent = playing || pb.status === 'between' ? 'Pause' : (pb.status === 'paused' ? 'Resume' : 'Play');
    if (document.activeElement !== $('vol')) { $('vol').value = g.settings.volume; $('volV').textContent = g.settings.volume; }
    renderUpNext();
    $('markBtn').disabled = !cur || cur.played;
    renderProgress(); renderRounds(); renderHistory();
    renderSession();
    renderAudio();
    renderCredits();
  }
  function renderProgress() {
    if (!state) return; var pb = state.playback; var cs = pb.clipStart || 0, ce = pb.clipEnd || 0; var pos = pb.position || 0;
    var pct = ce > cs ? Math.max(0, Math.min(100, (pos - cs) / (ce - cs) * 100)) : 0;
    $('progFill').style.width = (state.current && pb.status !== 'between' ? pct : 0) + '%';
    $('tPos').textContent = fmt(pos);
    $('tLeft').textContent = state.current && ce ? fmt(Math.max(0, ce - pos)) + ' left in clip' : '';
  }
  /* Rules Checklist Mode: checklist with statuses and winners instead of rounds */
  var ckKey = null;
  function renderChecklist() {
    var g = state, ck = g.checklist, R = g.round, fin = g.status === 'finished';
    $('endRound').style.display = 'none';
    $('pauseGame').textContent = g.gamePaused ? 'Resume game' : 'Pause game';
    var key = JSON.stringify([ck, R, g.status, g.intermission]); if (key === ckKey) return; ckKey = key;
    var rs = $('roundStatus'), box = $('roundBtns');
    var b = '';
    if (!R.number && !fin) b = '<div class="banner ok"><b>Ready — ' + ck.total + ' rules, any order</b><div class="small">Every rule is open from the start. No rounds.</div><button class="btn primary wide" id="ckStartGame">▶ Start game</button></div>';
    else if (ck.allDone && !fin) b = '<div class="banner ok"><b>🏆 ALL BINGO RULES COMPLETED</b><div class="small">' + (ck.closed ? 'Claims closed — the music carries on.' : 'Finish, or keep the music going without more claims.') + '</div>' + (ck.closed ? '<button class="btn wide" id="ckReopen">Re-open claims</button>' : '<button class="btn wide" id="ckMusic">▶ Continue music without claims</button>') + '<button class="btn primary wide" id="ckFinish">🏁 Finish game</button></div>';
    else if (ck.playlistDone && !fin) b = '<div class="banner"><b>Every song has been played</b><div class="small">Not won: ' + ck.items.filter(function (i) { return i.status !== 'completed'; }).map(function (i) { return esc(i.label); }).join(', ') + '</div><button class="btn primary wide" id="ckFinish">🏁 Finish game</button></div>';
    if (g.intermission) b = '<div class="banner"><b>☕ Break</b><div class="small">The TV shows the break screen. Music is paused.</div><button class="btn wide" id="imEnd">End break</button></div>' + b;
    rs.innerHTML = b + '<div class="ck-count"><b>' + ck.completed + ' OF ' + ck.total + '</b> RULES COMPLETED<div class="ck-bar"><i style="width:' + (ck.total ? ck.completed / ck.total * 100 : 0) + '%"></i></div></div>';
    box.innerHTML = '';
    ck.items.forEach(function (i) {
      var el = document.createElement('div'); el.className = 'ck-item ' + i.status;
      var pw = document.createElement('div'); pw.className = 'ck-pat'; var grid = document.createElement('div'); CMBPatterns.render(grid, i.example, i.status === 'completed' ? 'green' : 'pink'); pw.appendChild(grid); el.appendChild(pw);
      var t = document.createElement('div'); t.style.flex = '1';
      t.innerHTML = '<b>' + esc(i.label) + '</b> <span class="pill ' + (i.status === 'completed' ? 'ok' : '') + '">' + (i.status === 'completed' ? '✓ COMPLETED' : 'AVAILABLE') + '</span>' + i.winners.map(function (w) { return '<div class="small">🏆 Card <b>' + w.cardLabel + '</b>' + (w.owner ? ' · ' + esc(w.owner) : '') + ' <button class="btn mini" data-fix="' + w.claimId + '">Correct</button></div>'; }).join('');
      el.appendChild(t); box.appendChild(el);
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-fix]'), function (x) { x.onclick = function () { correctAward(x.getAttribute('data-fix')); }; });
    var on = function (id, fn) { var e = $(id); if (e) e.onclick = fn; };
    on('ckStartGame', function () { confirmIt('Start the game?', 'All ' + ck.total + ' rules are open from the start. The TV shows the checklist and the music starts.', 'Start game').then(function (ok) { if (ok) safe(cmd('startRound', { round: 1 })).then(function (r) { if (r) toast('Game started', 'ok'); }); }); });
    on('ckFinish', function () { confirmIt('Finish the game?', ck.completed + ' of ' + ck.total + ' rules were won. The TV shows the end screen.', 'Finish game').then(function (ok) { if (ok) safe(cmd('endGame')); }); });
    on('ckMusic', function () { safe(cmd('closeChecklist', { closed: true })).then(function (r) { if (r) toast('Claims closed — music continues', 'ok'); }); });
    on('ckReopen', function () { safe(cmd('closeChecklist', { closed: false })); });
    on('imEnd', function () { safe(cmd('endIntermission')); });
    $('winners').innerHTML = g.winners.length ? g.winners.map(function (w) { return '<div class="winner"><span class="cn">' + w.cardLabel + '</span><div><b>' + esc(w.rule || '') + '</b><div class="muted small">' + (w.owner ? esc(w.owner) + ' · ' : '') + esc(w.headline) + '</div></div></div>'; }).join('') : '<div class="muted small">No winners confirmed yet.</div>';
  }
  /* correct a confirmed checklist award (change rule / undo), always confirmed, kept in the audit log */
  function correctAward(claimId) {
    var w = state.winners.filter(function (x) { return x.claimId === claimId; })[0]; if (!w) return;
    safe(cmd('viewClaim', { claimId: claimId })).then(function (v) {
      if (!v) return;
      var alts = ((v.checklist && v.checklist.qualifying) || []).filter(function (q) { return q.itemId !== w.itemId; });
      var opts = alts.map(function (a) { return { label: 'Award ' + a.label + ' instead', value: 'to:' + a.itemId }; });
      opts.push({ label: 'Undo this award', value: 'undo', kind: 'danger' }); opts.push({ label: 'Cancel', value: null });
      ask('Correct an award', 'Card <b>' + w.cardLabel + '</b>' + (w.owner ? ' (' + esc(w.owner) + ')' : '') + ' was awarded <b>' + esc(w.rule) + '</b>.', opts).then(function (x) {
        if (!x) return;
        var reason = (window.prompt('Reason (kept in the audit log)', '') || '').slice(0, 200);
        if (x === 'undo') confirmIt('Undo this award?', esc(w.rule) + ' becomes available again.', 'Undo award').then(function (ok) { if (ok) safe(cmd('revokeWinner', { claimId: claimId, reason: reason })).then(function (r) { if (r) toast('Award undone', 'ok'); }); });
        else { var id = x.slice(3); var to = alts.filter(function (a) { return a.itemId === id; })[0]; confirmIt('Change the awarded rule?', 'Card ' + w.cardLabel + ': <b>' + esc(w.rule) + '</b> → <b>' + esc(to.label) + '</b>', 'Change rule').then(function (ok) { if (ok) safe(cmd('changeAward', { claimId: claimId, itemId: id, reason: reason })).then(function (r) { if (r) toast('Award corrected', 'ok'); }); }); }
      });
    });
  }
  function renderRounds() {
    if (state.mode === 'checklist') return renderChecklist();
    var g = state; var box = $('roundBtns'); box.innerHTML = '';
    var RC = g.roundCount || 3; var NS = []; for (var q = 1; q <= RC; q++) NS.push(q);
    NS.forEach(function (n) {
      var active = g.round.number === n && g.round.status === 'active';
      var done = g.round.number > n || (g.round.number === n && g.round.status === 'ended');
      var can = ((g.round.number === 0 && n === 1) || (g.round.number === n && g.round.status === 'ready') || (n === g.round.number + 1 && g.round.status === 'active')) && g.status !== 'finished';
      var el = document.createElement('button');
      el.className = 'round-btn' + (active ? ' active' : '') + (done ? ' done' : '');
      el.disabled = !can && !active;
      var RR = (g.roundRules && g.roundRules[n]) || { label: CMBPatterns.LABELS[n], examples: CMBPatterns.examples(n) };
      var grid = document.createElement('div'); CMBPatterns.render(grid, RR.examples[0], 'pink');
      el.appendChild(grid);
      var t = document.createElement('div'); t.innerHTML = '<b>ROUND ' + n + '</b><div class="lab">' + esc(RR.label) + '</div><div class="st">' + (active ? 'IN PLAY' : (g.round.number === n && g.round.status === 'ready') ? 'READY — tap to start' : done ? 'Complete' : can ? 'Tap to start' : '') + '</div>';
      el.appendChild(t);
      el.onclick = function () {
        if (active || !can) return;
        var body = g.round.status === 'active' ? 'Round ' + g.round.number + ' is still in play — normally use <b>Complete round</b>. Change to <b>' + esc(RR.label) + '</b> now anyway? Played songs stay marked.' : 'Start <b>' + esc(RR.label) + '</b>? The TV switches to the new winning pattern' + (n === 1 ? ' and the first song starts.' : '.');
        confirmIt('Start Round ' + n + '?', body, 'Start Round ' + n).then(function (ok) { if (ok) safe(cmd('startRound', { round: n })).then(function (r) { if (r) { toast('Round ' + n + ' started', 'ok'); if (r.warning) toast(r.warning, 'err'); } }); });
      };
      box.appendChild(el);
    });
    $('endRound').disabled = !g.round.canComplete;
    $('endRound').textContent = g.round.number >= (g.roundCount || 3) ? 'Complete game…' : 'Complete round…';
    var R = g.round, rs = $('roundStatus');
    if (g.intermission) rs.innerHTML = '<div class="banner"><b>☕ Intermission</b>' + (g.intermission.until ? ' — back at ' + new Date(g.intermission.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') + '<div class="small">The TV shows the break screen. Music is paused.</div><button class="btn wide" id="imEnd">End intermission</button><button class="btn primary wide" id="startReady">▶ Start Round ' + R.number + '</button></div>';
    else if (R.status === 'ready') rs.innerHTML = '<div class="banner ok"><b>Round ' + R.number + ' ready — ' + esc(R.label) + '</b><div class="small">Music is paused until you start it.</div>' + (R.preQualified.length ? '<div class="small" style="margin-top:6px;color:var(--amber)">⚠ ' + R.preQualified.length + ' card(s) already have this pattern (' + R.preQualified.slice(0, 8).join(', ') + (R.preQualified.length > 8 ? '…' : '') + '). Nothing is awarded automatically.</div>' : '') + '<button class="btn primary wide" id="startReady">▶ Start Round ' + R.number + '</button></div>';
    else if (R.canComplete && R.winners) rs.innerHTML = '<div class="banner ok"><b>🏆 Round ' + R.number + ' has ' + R.winners + ' winner' + (R.winners > 1 ? 's' : '') + '</b><div class="small">Check any other claims, then continue.</div><button class="btn primary wide" id="completeBig">' + (R.number >= (g.roundCount || 3) ? 'Complete game' : 'Complete Round & Continue') + '</button></div>';
    else rs.innerHTML = '';
    var sr = $('startReady'); if (sr) sr.onclick = function () { safe(cmd('startRound', { round: R.number })); };
    var ie = $('imEnd'); if (ie) ie.onclick = function () { safe(cmd('endIntermission')); };
    var cb = $('completeBig'); if (cb) cb.onclick = completeRound;
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

  var SL = { pending: ['VALID · decide', 'warn'], confirmed: ['WINNER', 'ok'], invalid: ['NOT VALID', 'bad'], rejected: ['REJECTED', 'bad'], dismissed: ['DISMISSED', ''], duplicate: ['ALREADY WON', 'warn'] };
  function renderSession() {
    var s = state.session;
    if (!s) { if (ckOpen) { ckOpen = false; stopScan(); $('checker').classList.add('hidden'); } $('bingoFab').textContent = 'CHECK BINGO'; return; }
    $('bingoFab').textContent = 'CLAIMS FROZEN (' + s.claims.length + ')';
    $('ckPaused').innerHTML = 'Session ' + esc(s.id) + ' · ' + (state.mode === 'checklist' ? 'Rules ' + state.checklist.completed + ' of ' + state.checklist.total + ' completed' : 'Round ' + s.round) + ' · <b>' + s.snapshotCount + '</b> songs frozen · music paused at ' + fmt(s.position);
    $('ckList').innerHTML = s.claims.length ? s.claims.map(function (c) { return '<div class="hist" data-id="' + c.claimId + '"><span class="n" style="width:40px">' + c.cardLabel + '</span><div style="flex:1">' + (c.owner ? '<b style="color:var(--pink)">📱 ' + esc(c.owner) + '</b><br>' : '') + esc(c.headline) + '</div><span class="chip ' + (SL[c.status][1] === 'ok' ? '' : 'dim') + '" style="margin:0">' + SL[c.status][0] + '</span></div>'; }).join('') : '';
    Array.prototype.forEach.call(document.querySelectorAll('#ckList [data-id]'), function (r) { r.onclick = function () { safe(cmd('viewClaim', { claimId: r.getAttribute('data-id') })).then(function (x) { if (x) { $('ckEntry').classList.add('hidden'); $('ckResult').classList.remove('hidden'); showResult(x); } }); }; });
  }
  function renderUpNext() {
    var u = state.upNext || {}; var n = u.next; var box = $('upnext');
    if (!n) { box.innerHTML = '<div class="eyebrow">Up next · host only</div><div class="muted small">No more songs to play.</div>'; return; }
    var src = { queue: 'QUEUED', deferred: 'SKIPPED EARLIER', playlist: 'PLAYLIST' }[n.source];
    box.innerHTML = '<div class="eyebrow">Up next · host only <span class="pill">' + src + '</span></div>' +
      '<div class="un-title">' + esc(n.title) + '</div><div class="artist" style="font-size:15px">' + esc(n.artist) + '</div>' +
      '<div class="muted small" style="margin-top:6px;word-break:break-all">' + esc(n.fileName) + '</div>' +
      '<div class="muted small">' + (n.duration ? fmt(n.duration) + ' · ' : '') + 'starts ' + fmt(n.clipStart) + ' · ' + (n.clipMode === 'full' ? 'full song' : (n.clipLength || '') + ' s clip') + '</div>' +
      '<div style="margin-top:6px">' + (n.ready ? '<span class="pill ok">READY</span>' : '<span class="pill bad">⚠ ' + esc(n.problem || 'not ready') + '</span>') + '</div>' +
      '<div class="ctl-row small" style="margin:10px 0 0"><button class="btn" id="unSkip">Skip this one</button><button class="btn" id="unPick">Choose…</button></div>' +
      (u.custom ? '<button class="btn wide" id="unReset">Back to playlist order</button>' : '') +
      (u.queue && u.queue.length ? '<div class="muted small" style="margin-top:8px">Queue: ' + u.queue.map(function (q) { return esc(q.title); }).join(' · ') + '</div>' : '');
    $('unSkip').onclick = function () { safe(cmd('skipNext', { expectSongId: n.songId })); };
    $('unPick').onclick = openPicker;
    var rs = $('unReset'); if (rs) rs.onclick = function () { safe(cmd('resetQueue')); };
  }
  function openPicker() { $('picker').classList.remove('hidden'); $('pkQ').value = ''; drawPicker(); }
  function drawPicker() {
    var q = $('pkQ').value.toLowerCase(); var list = (state.eligible || []).filter(function (s) { return !q || (s.title + ' ' + s.artist).toLowerCase().indexOf(q) >= 0; });
    $('pkList').innerHTML = list.length ? list.map(function (s) { return '<div class="hist pk"><span class="n">' + s.number + '</span><div style="flex:1;min-width:0"><b>' + esc(s.title) + '</b> <span class="a">— ' + esc(s.artist) + '</span>' + (s.unavailable ? ' <span class="pill bad">unavailable</span>' : '') + (s.queued ? ' <span class="pill">queued</span>' : '') + '</div><button class="btn sm primary" data-next="' + s.songId + '">Next</button><button class="btn sm" data-end="' + s.songId + '">Queue</button></div>'; }).join('') : '<div class="muted small">No songs found.</div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-next]'), function (b) { b.onclick = function () { safe(cmd('queueSong', { songId: b.getAttribute('data-next') })).then(function (r) { if (r) { toast('Plays next', 'ok'); $('picker').classList.add('hidden'); } }); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-end]'), function (b) { b.onclick = function () { safe(cmd('queueSong', { songId: b.getAttribute('data-end'), position: 'end' })).then(function (r) { if (r) toast('Added to queue', 'ok'); }); }; });
  }
  $('pkQ').oninput = drawPicker;
  $('pkClose').onclick = function () { $('picker').classList.add('hidden'); };

  function renderAudio() {
    var a = state.settings.audio;
    $('muteBtn').textContent = a.muted ? '🔊 Unmute' : '🔇 Mute'; $('muteBtn').className = 'btn' + (a.muted ? ' primary' : '');
    $('levBtn').textContent = 'Levelling ' + (a.levelling ? 'ON' : 'OFF'); $('levBtn').className = 'btn' + (a.levelling ? '' : ' danger');
  }
  function renderCredits() {
    var un = state.unavailable || [];
    $('unavail').innerHTML = un.length ? '<div class="banner" style="border-color:var(--red);color:var(--red)">⚠ ' + un.length + ' video' + (un.length > 1 ? 's' : '') + ' unavailable' + un.slice(0, 3).map(function (u) { return '<div class="row" style="margin-top:8px;color:#fff"><div style="flex:1"><b>' + esc(u.title) + '</b><div class="muted small">' + esc(u.reason) + '</div></div><button class="btn" data-credit="' + u.songId + '">Credit…</button></div>'; }).join('') + '</div>' : '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-credit]'), function (b) { b.onclick = function () { creditFlow(b.getAttribute('data-credit')); }; });
    var cr = state.credits || [];
    $('credits').innerHTML = cr.length ? cr.map(function (c) { return '<div class="hist"><div style="flex:1"><b>' + esc(c.title) + '</b> <span class="a">— ' + esc(c.artist) + '</span><div class="muted small">' + esc(c.reason) + '</div></div><span class="chip ' + (c.status === 'active' ? '' : 'dim') + '" style="margin:0">' + (c.status === 'active' ? 'COUNTS' : 'REVERSED') + '</span></div>'; }).join('') : '<div class="muted small">None.</div>';
  }
  function creditFlow(songId) {
    if (!state) return;
    var counted = {}; state.history.forEach(function (h) { counted[h.songId] = 1; });
    var song = null;
    if (songId) { (state.unavailable || []).concat(state.current ? [state.current] : []).forEach(function (u) { if (u.songId === songId) song = u; }); }
    if (!song && state.current && !state.current.played) song = state.current;
    if (!song) { toast('Open the unavailable song from the warning, or use the laptop to choose another song.', 'err'); return; }
    ask('Technical credit?', '<b style="color:#fff">' + esc(song.title) + ' — ' + esc(song.artist) + '</b><br>Choose why the video can\'t be played. The song will then count on <b>every card</b> that has it. No replacement is played. Recorded in the audit log.',
      state.creditReasons.map(function (r) { return { label: r, value: r }; }).concat([{ label: 'Cancel', value: null, kind: 'danger' }]))
      .then(function (reason) {
        if (!reason) return;
        confirmIt('Confirm technical credit', 'TECHNICAL CREDIT — COUNT SONG FOR ALL CARDS<br><b style="color:#fff">' + esc(song.title) + '</b><br>Reason: ' + esc(reason), 'Confirm credit').then(function (ok) {
          if (ok) safe(cmd('grantCredit', { songId: song.songId, reason: reason, confirm: true })).then(function (r) { if (r && r.ok) toast('Technical credit recorded', 'ok'); });
        });
      });
  }
  $('creditBtn').onclick = function () { creditFlow(null); };
  $('muteBtn').onclick = function () { vibrate(15); safe(cmd('setAudio', { toggleMute: true })); };
  $('levBtn').onclick = function () { safe(cmd('setAudio', { toggleLevelling: true })); };

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
  function completeRound() {
    var R = state.round; var final = R.number >= (state.roundCount || 3);
    confirmIt(final ? 'Complete the game?' : 'Complete Round ' + R.number + '?', (R.winners ? R.winners + ' confirmed winner(s).' : '<b style="color:var(--amber)">No winner confirmed yet.</b>') + (final ? ' The TV shows “That\'s a wrap!”.' : ' The TV shows the transition to <b>' + esc(state.roundRules ? state.roundRules[R.number + 1].label : CMBPatterns.LABELS[R.number + 1]) + '</b>. Music stays paused until you start the next round.'), final ? 'Complete game' : 'Complete & continue')
      .then(function (ok) { if (!ok) return; safe(cmd('completeRound', { fromRound: R.number })).then(function (r) { if (r && r.needsDecision) toast(r.message, 'err'); else if (r && r.ok && !r.already) toast(final ? "That's a wrap!" : 'Round ' + R.number + ' complete', 'ok'); }); });
  }
  $('endRound').onclick = completeRound;
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
    if (!state || !state.round.number) { toast('Start Round 1 first', 'err'); return; }
    vibrate(30); ckInput = ''; drawInput();
    safe(cmd('freezeClaims')).then(function (r) {
      if (!r || r.ok === false) return;
      ckOpen = true; ckPaused = !!r.paused;
      $('checker').classList.remove('hidden'); $('ckEntry').classList.remove('hidden'); $('ckResult').classList.add('hidden');
      if (state) renderSession();
    });
  };
  /* a round has a winner and the claim session is closed: intermission or next round? */
  var askingNext = false, askRound = null;
  function whatNext(p) {
    if (p && p.checklistDone) {
      if (askingNext) return; askingNext = true; vibrate([60, 40, 60]);
      ask('🏆 ALL BINGO RULES COMPLETED', 'All ' + p.total + ' rules have a confirmed winner.', [{ label: '🏁 Finish game', value: 'finish', kind: 'primary' }, { label: '▶ Continue music without claims', value: 'music' }, { label: '🏆 View winners', value: 'view' }]).then(function (v) {
        askingNext = false;
        if (v === 'finish') safe(cmd('endGame'));
        else if (v === 'music') safe(cmd('closeChecklist', { closed: true }));
        else if (v === 'view') document.querySelector('#tabs [data-tab=rounds]').click();
      });
      return;
    }
    if (askingNext) return; askingNext = true; askRound = p.round; vibrate([60, 40, 60]);
    var opts = p.final ? [{ label: '🏁 Finish the game', value: 'finish', kind: 'primary' }, { label: 'Not yet', value: null }]
      : [{ label: '▶ Start Round ' + p.nextRound + (p.nextLabel ? ' — ' + p.nextLabel : ''), value: 'next', kind: 'primary' }, { label: '☕ Intermission (' + (p.minutes || 10) + ' min)', value: 'break' }, { label: 'Not yet', value: null }];
    ask('🏆 Round ' + p.round + ' won!', p.final ? 'That was the last round.' : 'What\'s next?', opts).then(function (v) {
      askingNext = false; askRound = null;
      if (v === 'finish') safe(cmd('completeRound', { fromRound: p.round }));
      else if (v === 'next') safe(cmd('completeRound', { fromRound: p.round })).then(function () { return safe(cmd('startRound', { round: p.nextRound })); });
      else if (v === 'break') safe(cmd('startIntermission', { minutes: p.minutes || 10 })).then(function (r) { if (r) toast('Intermission on the TV', 'ok'); });
    });
  }
  /* a player pressed BINGO on their own phone card (home play) */
  function playerBingo(p) {
    if (!p.valid) { toast('📱 ' + p.name + ' (card ' + p.cardLabel + ') pressed BINGO — not yet', ''); return; }
    vibrate([120, 60, 120, 60, 240]);
    toast('📱 ' + p.name + ' called BINGO — card ' + p.cardLabel + ' looks valid!', 'ok');
    ckOpen = true; ckPaused = true;
    $('checker').classList.remove('hidden'); $('ckEntry').classList.add('hidden'); $('ckResult').classList.remove('hidden');
    if (state && state.session) renderSession();
    if (p.claimId) safe(cmd('viewClaim', { claimId: p.claimId })).then(function (x) { if (x) showResult(x); });
  }
  function closeChecker(resume, dismissPending) {
    safe(cmd('closeSession', { resume: !!resume, dismissPending: !!dismissPending })).then(function (r) {
      if (r && r.needsDecision) {
        ask('Undecided claims', esc(r.message) + '<br>Pending claims are never dismissed silently.', [{ label: 'Go back and decide', value: false, kind: 'primary' }, { label: 'Dismiss them & close', value: true, kind: 'danger' }])
          .then(function (yes) { if (yes) closeChecker(resume, true); });
        return;
      }
      if (r && r.ok !== false) { stopScan(); ckOpen = false; $('checker').classList.add('hidden'); toast(resume ? 'Session closed — music resumed' : 'Session closed', 'ok'); if (r.next && r.next.ask) setTimeout(function () { whatNext(r.next); }, 300); else if (r.next && r.next.auto) toast('Round won — intermission on the TV', 'ok'); }
    });
  }
  $('ckClose').onclick = function () { stopScan(); ckOpen = false; $('checker').classList.add('hidden'); toast('Claims stay frozen — tap the button to continue'); };
  $('ckResume').onclick = function () { closeChecker(true); };
  $('ckCloseKeep').onclick = function () { closeChecker(false); };
  $('ckAgain').onclick = function () { ckInput = ''; drawInput(); $('ckEntry').classList.remove('hidden'); $('ckResult').classList.add('hidden'); };
  $('ckGo').onclick = function () { if (!ckInput) return toast('Type the card number', 'err'); check({ cardNo: ckInput }); };
  function check(args) {
    $('ckResult').innerHTML = '<div class="muted center">Checking…</div>'; $('ckResult').classList.remove('hidden'); $('ckEntry').classList.add('hidden');
    cmd('addClaim', args).then(function (r) {
      if (!r || r.ok === false) { $('ckResult').innerHTML = '<div class="verdict invalid"><div class="vt">CANNOT CHECK</div><div class="rs">' + esc((r && r.error) || 'Unknown error') + '</div></div>'; vibrate(200); return; }
      showResult(r);
    }, function () { $('ckEntry').classList.remove('hidden'); $('ckResult').classList.add('hidden'); });
  }
  function showResult(r) {
    ckInput = ''; drawInput();
    var dup = r.alreadyWinner && r.status !== 'confirmed'; var cls = r.status === 'confirmed' ? 'valid' : dup ? 'dup' : (r.valid ? 'valid' : 'invalid');
    var ck = r.mode === 'checklist' ? r.checklist : null; var pick = ck && ck.qualifying.length === 1 ? ck.qualifying[0].itemId : null;
    vibrate(r.valid && !dup ? [60, 40, 60] : 250);
    var h = (r.duplicateEntry ? '<div class="banner">Card already entered in this session — same result shown.</div>' : '') + '<div class="verdict ' + cls + '">' + (r.owner ? '<div class="rs" style="margin:0 0 4px;color:#fff;font-weight:800">📱 ' + esc(r.owner) + ' · card ' + r.cardLabel + '</div>' : '') + '<div class="vt">' + (r.status === 'confirmed' ? (ck && ck.awarded ? 'WINNER — ' + esc(ck.awarded.label) : 'WINNER CONFIRMED') : ck && !r.valid ? (ck.onlyCompleted ? 'RULE ALREADY COMPLETED' : 'NOT A VALID BINGO') : dup ? 'ALREADY WON' : r.valid ? 'VALID BINGO!' : 'NOT VALID') + '</div><div class="hl">' + esc(r.explanation || ('Card ' + r.cardLabel + ' — ' + r.headline)) + '</div>' + (r.completingSong ? '<div class="rs">🎵 Won on song #' + r.completingSong.n + ': <b style="color:#fff">' + esc(r.completingSong.title) + '</b> — ' + esc(r.completingSong.artist) + '</div>' : '') + (r.best ? '<div class="rs">Closest: <b style="color:#fff">' + esc(r.best.description) + '</b> — ' + r.best.missing + ' more needed (dashed squares)</div>' : '') + (r.otherRoundWins && r.otherRoundWins.length ? '<div class="rs" style="color:var(--green)">🏆 This card also won Round ' + r.otherRoundWins.join(' & ') + ' — a card can win more than one round</div>' : '') + (r.otherRuleWins && r.otherRuleWins.length ? '<div class="rs" style="color:var(--green)">🏆 This card also won ' + r.otherRuleWins.map(esc).join(' & ') + '</div>' : '') + (ck && !r.valid ? '<div class="rs">Open rules: <b style="color:#fff">' + (ck.available.map(function (a) { return esc(a.label); }).join(', ') || 'none') + '</b>' + (ck.alreadyCompleted.length ? ' · already completed: ' + ck.alreadyCompleted.map(function (a) { return esc(a.label); }).join(', ') : '') + '</div>' : '') + '<div class="rs">' + (ck ? 'Rules checklist' : 'Round ' + r.round + ' · ' + esc(r.roundLabel)) + (r.qualifiedAtSong ? ' · qualified at song #' + r.qualifiedAtSong : '') + (r.printed ? '' : ' · ⚠ card not marked printed') + '</div></div>';
    h += '<div class="mini">' + r.grid.map(function (c) { return '<div class="' + (c.winning ? 'w' : c.played ? 'p' : '') + (c.needed ? ' nd' : '') + (c.inBest && !c.winning ? ' bs' : '') + (c.completing ? ' cm' : '') + '">' + (c.credit ? '<span style="color:var(--amber)">TC</span>' : '') + '<b>' + esc(c.title) + '</b><span>' + esc(c.artist) + '</span></div>'; }).join('') + '</div>';
    if (r.status === 'pending' && ck) h += '<div class="eyebrow" style="margin-top:10px">Valid for' + (ck.qualifying.length > 1 ? ' — choose ONE rule to award' : '') + '</div><div id="ckPicks">' + ck.qualifying.map(function (q) { return '<label class="ck-opt' + (pick === q.itemId ? ' on' : '') + '"><input type="radio" name="ckPick" value="' + q.itemId + '"' + (pick === q.itemId ? ' checked' : '') + '><b>' + esc(q.label) + '</b></label>'; }).join('') + '</div>';
    if (r.status === 'pending') h += '<button class="btn success big" style="width:100%" id="ckConfirm">✓ CONFIRM WINNER</button><button class="btn danger wide" id="ckDismiss">Reject claim</button>';
    else if (r.status === 'invalid') h += '<button class="btn danger wide" id="ckReject">Reject claim</button>';
    if (r.status === 'confirmed') h += '<button class="btn wide" id="ckTv">📺 Show winner screen on TV</button>';
    if (r.status === 'rejected' || r.status === 'invalid') h += '<button class="btn wide" id="ckTvW">📺 Show “Not a Bingo” on TV</button>';
    if (r.status !== 'confirmed') h += '<button class="btn wide" id="ckRemove">Remove (entered by mistake)</button>';
    $('ckResult').innerHTML = h;
    var c = $('ckConfirm');
    Array.prototype.forEach.call(document.querySelectorAll('#ckPicks input'), function (i) { i.onchange = function () { pick = i.value; Array.prototype.forEach.call(document.querySelectorAll('#ckPicks .ck-opt'), function (l) { l.classList.toggle('on', l.querySelector('input').checked); }); }; });
    if (c) c.onclick = function () { if (ck && !pick) { toast('Choose which rule to award', 'err'); return; } var lbl = ck ? ck.qualifying.filter(function (q) { return q.itemId === pick; })[0].label : ''; confirmIt('Confirm card ' + r.cardLabel + '?', ck ? 'Award <b>' + esc(lbl) + '</b> to card ' + r.cardLabel + '. The rule is ticked off on the TV.' : 'Record card ' + r.cardLabel + ' as a Round ' + r.round + ' winner. The TV will celebrate (without showing the card).', 'Confirm winner').then(function (ok) { if (!ok) return; safe(cmd('confirmClaim', ck ? { claimId: r.claimId, itemId: pick } : { claimId: r.claimId })).then(function (x) { if (x) { toast('Winner confirmed!', 'ok'); showResult(x); } }); }); };
    var d = $('ckDismiss'); if (d) d.onclick = function () { safe(cmd('dismissClaim', { claimId: r.claimId })).then(function () { toast('Claim dismissed'); d.remove(); if (c) c.remove(); }); };
    var tv = $('ckTv'); if (tv) tv.onclick = function () { safe(cmd('showTvScreen', { claimId: r.claimId, type: 'winner' })); };
    var tvw = $('ckTvW'); if (tvw) tvw.onclick = function () { safe(cmd('showTvScreen', { claimId: r.claimId, type: 'wrong' })); };
    var rm = $('ckRemove'); if (rm) rm.onclick = function () { safe(cmd('removeClaim', { claimId: r.claimId })).then(function () { toast('Claim removed'); $('ckAgain').onclick(); }); };
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
