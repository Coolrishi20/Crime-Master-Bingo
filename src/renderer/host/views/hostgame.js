/* winning rules for round n of the loaded game (custom rules, v1.5) */
const RR = (n) => (App.game && App.game.roundRules && App.game.roundRules[n]) || { label: CMBPatterns.LABELS[n], short: CMBPatterns.SHORT[n], examples: CMBPatterns.examples(n), locked: false };
App.register('host', {
  tab: 'played',
  async render(el) {
    this.el = el;
    if (!App.game) {
      const games = await api('games:list');
      const open = games.filter(g => g.status !== 'finished');
      el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Live</div><h1>Host Game</h1><p>No game is loaded.</p></div></div>
        <div class="panel">${open.length ? `<h2>Open a game</h2>${open.map(g => `<div class="check-row"><div class="grow"><b>${esc(g.name)}</b><div class="muted small">${esc(g.date)} · ${g.played}/${g.songs} played · ${g.cards} cards</div></div><button class="btn primary sm" data-open="${g.id}">Open</button></div>`).join('')}` : '<div class="empty">Create a game first.</div>'}
        <div class="row" style="margin-top:12px"><button class="btn primary" id="hNew">✚ Create Game</button></div></div>`;
      $('#hNew', el).onclick = () => App.show('create', 'new');
      $$('[data-open]', el).forEach(b => b.onclick = async () => { await api('games:open', { id: b.dataset.open }); App.show('host'); });
      return;
    }
    el.innerHTML = `
      <div class="console-top">
        <div><div class="eyebrow" id="hgEyebrow">Host · now playing</div><h1 id="hgName"></h1></div>
        <span class="chip" id="hgRound"></span><span class="badge" id="hgLock"></span><span class="grow"></span>
        <div class="songcount" id="hgCount"></div>
        <button class="btn" id="hgReady" title="Every pre-game check in one place">✓ Ready?</button><button class="btn" id="hgAud"></button><button class="btn" id="hgTv2" title="Mirror the TV on a second screen (silent)">TV 2</button>
      </div>
      <div id="hgNight"></div><div id="hgRecover"></div><div id="hgSession"></div><div id="hgUnavail"></div>
      <div class="cols main-side">
        <div>
          <div class="panel" style="margin-bottom:16px">
            <div class="now"><div class="now-art" id="hgArt"><img id="hgThumb" style="display:none"><div class="eq">${'<i></i>'.repeat(9)}</div></div>
              <div class="now-info"><div class="eyebrow" id="hgNowLbl">Now playing</div><div class="now-title" id="hgTitle">—</div><div class="now-artist" id="hgArtist"></div><div class="muted small" id="hgNext" style="margin-top:8px"></div></div></div>
            <div class="progress" id="hgProg"><div class="clip" id="hgClip"></div><div class="fill" id="hgFill"></div></div>
            <div class="times"><span id="hgPos">0:00</span><span id="hgClipLbl"></span><span id="hgDur">0:00</span></div>
            <div class="controls">
              <button class="ctl" id="cPrev" title="Previous song">⏮</button>
              <button class="ctl" id="cReplay" title="Replay (←)">↺</button>
              <button class="ctl play" id="cPlay" title="Play / pause (Space)">▶</button>
              <button class="ctl" id="cStop" title="Stop">■</button>
              <button class="ctl" id="cNext" title="Next / skip (→)">⏭</button>
              <button class="btn" id="cMark" title="Count this song as played now">✓ Mark played</button>
              <span class="grow"></span>
              <div style="display:flex;align-items:center;gap:8px"><span class="muted">🔊</span><input type="range" id="cVol" min="0" max="100" style="width:130px"><span id="cVolV" class="muted small" style="width:32px"></span></div>
            </div>
            <div class="row" style="margin-top:14px"><span class="muted small" style="font-weight:700">CLIP</span><div class="seg" id="cClip">${[20, 30, 40, 60, 'full'].map(m => `<button data-m="${m}">${m === 'full' ? 'Full' : m + 's'}</button>`).join('')}</div>
              <label class="toggle small">${'<input type="checkbox" id="cAuto"><span class="sw"></span>'}Auto-play next</label>
              <span class="muted small" style="font-weight:700">GAP</span><div class="seg" id="cGap" title="Pause between songs (the TV holds the last picture)">${[0, 3, 5, 10].map(n => `<button data-g="${n}">${n ? n + ' s' : 'None'}</button>`).join('')}<button data-g="custom">…</button></div>
              <label class="toggle small"><input type="checkbox" id="cLev"><span class="sw"></span>Auto volume levelling</label>
              <label class="toggle small" title="Start each clip where the music begins"><input type="checkbox" id="cIntro"><span class="sw"></span>Skip quiet intros</label>
              <button class="btn sm" id="cMute">🔇 Mute</button></div>
            <div class="muted tiny" id="hgLevel" style="margin-top:6px"></div>
            <div class="statusline" id="hgStatus"></div>
          </div>
          <div class="panel" style="margin-bottom:16px">
            <h2><span id="rTitle">Rounds</span> <span class="row" style="gap:8px"><button class="btn sm" id="rRules" title="Winning rules for each round">🎯 Rules…</button><button class="btn sm" id="rComplete">Complete round…</button><button class="btn sm" id="rPause">Pause game</button><button class="btn sm danger" id="rEndGame">End game</button></span></h2>
            <div id="rStatus"></div>
            <div class="round-btns" id="rBtns"></div>
            <div class="muted small" id="rRule" style="margin-top:10px"></div>
          </div>
          <div class="panel">
            <div class="tabs" id="hgTabs"><button data-t="played">Played history</button><button data-t="order">Play order</button><button data-t="crawler">TV crawler</button><button data-t="log">Event log</button></div>
            <div id="hgTab"></div>
          </div>
        </div>
        <div>
          <div class="panel as-feature" style="margin-bottom:16px">
            <h2>CHECK BINGO / FREEZE CLAIMS <span class="kbd">B</span></h2>
            <div class="check-box"><input type="text" inputmode="numeric" id="bNo" placeholder="Card no." maxlength="3"><button class="btn primary lg" id="bGo">CHECK</button></div>
            <div class="row" style="margin-top:10px"><button class="btn primary" id="bFreeze">❄ Freeze claims</button><button class="btn sm" id="bScan">📷 Scan QR</button></div>
            <div class="muted tiny" style="margin-top:8px">Freezing pauses the music and locks the list of songs that count, so several cards can be checked fairly against the same moment.</div>
          </div>
          <div class="panel" style="margin-bottom:16px" id="hgUpNext"></div>
          <div class="panel" style="margin-bottom:16px"><h2>Winners</h2><div id="hgWinners"></div></div>
          <div class="panel" style="margin-bottom:16px"><h2>Recent claims</h2><div id="hgClaims"></div></div>
          <div class="panel"><h2>Technical credits</h2><div id="hgCredits"></div><button class="btn sm" id="hgCreditBtn" style="margin-top:10px">Grant technical credit…</button></div>
        </div>
      </div>`;
    this.bind();
    this.update();
  },

  bind() {
    const el = this.el;
    const g = () => App.game;
    $('#hgReady', el).onclick = () => readyCheck();
    $$('#cGap button', el).forEach(b => b.onclick = async () => {
      let v = b.dataset.g;
      if (v === 'custom') { v = await promptBox('Gap between songs', 'Seconds of pause between songs (0–30)', String(App.game.settings.autoAdvanceGap || 0)); if (v == null || v === '') return; }
      App.cmd('setGameSettings', { autoAdvanceGap: Math.max(0, Math.min(30, Number(v) || 0)) });
    });
    $('#cPlay', el).onclick = () => App.cmd('togglePlay');
    $('#cStop', el).onclick = () => App.cmd('stop');
    $('#cNext', el).onclick = () => App.next();
    $('#cPrev', el).onclick = () => App.cmd('previous', { expectIndex: g().playback.index });
    $('#cReplay', el).onclick = () => App.cmd('replay', { expectIndex: g().playback.index });
    $('#cMark', el).onclick = async () => { const c = g().current; if (!c) return; if (await confirmBox('Mark as played?', `Add “${esc(c.title)}” to the official played list now? It will appear in the TV crawler and count on cards.`, 'Mark played')) App.cmd('markPlayed', { songId: c.songId }); };
    let vt; $('#cVol', el).oninput = (e) => { $('#cVolV', el).textContent = e.target.value; clearTimeout(vt); vt = setTimeout(() => App.cmd('setVolume', { volume: Number(e.target.value) }), 80); };
    $$('#cClip button', el).forEach(b => b.onclick = () => App.cmd('setClipMode', { clipMode: b.dataset.m === 'full' ? 'full' : Number(b.dataset.m) }));
    $('#cAuto', el).onchange = (e) => App.cmd('setGameSettings', { autoAdvance: e.target.checked });
    $('#cLev', el).onchange = (e) => App.cmd('setAudio', { levelling: e.target.checked });
    $('#cIntro', el).onchange = (e) => App.cmd('setGameSettings', { skipIntros: e.target.checked });
    $('#cMute', el).onclick = () => App.cmd('setAudio', { toggleMute: true });
    $('#bFreeze', el).onclick = () => App.openChecker();
    $('#hgCreditBtn', el).onclick = () => App.creditDialog();
    $('#hgProg', el).onclick = (e) => { const p = g().playback; const dur = (g().current && g().current.duration) || 0; if (!dur) return; const r = e.currentTarget.getBoundingClientRect(); App.cmd('seek', { position: dur * (e.clientX - r.left) / r.width }); };
    const tv2 = async () => { const st = await api('audience:mirrorStatus'); $('#hgTv2', el).textContent = st.open ? '✕ Close TV 2' : '＋ TV 2'; };
    $('#hgTv2', el).onclick = async () => {
      const st = await api('audience:mirrorStatus');
      if (st.open) { await api('audience:closeMirror'); toast('Second screen closed', 'ok'); }
      else { const r = await api('audience:openMirror', {}); toast(r.external ? 'Second screen open on the other display — silent, follows the main TV' : 'Second screen opened in a window — drag it to the second display (F11 / double-click for full screen)', 'ok', 6000); if (App.settings.performance && App.settings.performance.lowResource) toast('Low Resource Mode: a second screen plays the video twice — watch for stutter on a 4 GB laptop', 'err', 7000); }
      setTimeout(tv2, 400);
    };
    tv2();
    $('#hgAud', el).onclick = () => { if (g().audienceConnected) api('audience:fullscreen'); else api('audience:open'); };
    $('#rComplete', el).onclick = () => App.completeRound();
    $('#rRules', el).onclick = () => (App.game.mode === 'checklist' ? this.editChecklist() : this.editRules());
    $('#rPause', el).onclick = () => App.cmd(g().gamePaused ? 'resumeGame' : 'pauseGame');
    $('#rEndGame', el).onclick = async () => { if (await confirmBox('End the game?', 'Playback stops and the game is saved as finished. All cards, songs played and winners are kept in Game History.', 'End game', true)) App.cmd('endGame'); };
    $$('#hgTabs button', el).forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.drawTab(); });
    const go = () => { const v = $('#bNo', el).value.trim(); if (!v) return $('#bNo', el).focus(); App.openChecker(v); $('#bNo', el).value = ''; };
    $('#bGo', el).onclick = go;
    $('#bNo', el).onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('#bScan', el).onclick = () => App.openChecker(null, { scan: true });
  },

  on_state() { if (App.game && this.el && $('#hgName', this.el)) this.update(); else this.render(this.el); },
  on_tick() { this.updateProgress(); },
  on_audience() { this.update(); },

  update() {
    const g = App.game; const el = this.el; if (!g || !$('#hgName', el)) return;
    const pb = g.playback; const cur = g.current;
    $('#hgName', el).textContent = g.name;
    $('#hgRound', el).textContent = g.mode === 'checklist' ? `RULES CHECKLIST · ${g.checklist.completed} OF ${g.checklist.total} WON${g.round.number ? '' : ' · NOT STARTED'}` : g.round.number ? `ROUND-BASED · ROUND ${g.round.number} · ${g.round.label}${g.round.status === 'ended' ? ' · ENDED' : ''}` : 'ROUND-BASED · NOT STARTED';
    $('#hgRound', el).className = 'chip' + (g.round.status === 'active' ? '' : ' dim');
    $('#hgCount', el).innerHTML = `SONG ${g.totals.played}<small> / ${g.totals.songs} played</small>`;
    $('#hgAud', el).textContent = g.audienceConnected ? '⛶ TV fullscreen (F)' : '📺 Open audience window';
    $('#hgAud', el).className = 'btn' + (g.audienceConnected ? '' : ' primary');
    $('#hgRecover', el).innerHTML = pb.recovered && pb.index >= 0 ? `<div class="banner"><div class="grow"><h3>Game restored</h3><div class="muted">Everything was saved. Song ${pb.index + 1} is ready to resume from ${fmtTime(pb.position)}. Press Play when you're ready.</div></div></div>` : (g.status === 'finished' ? `<div class="banner"><div class="grow"><h3>This game has ended</h3><div class="muted">Results are saved in Game History.</div></div><button class="btn" id="hgReopen">Re-open game</button></div>` : '');
    if ($('#hgReopen', el)) $('#hgReopen', el).onclick = () => App.cmd('reopenGame');
    const playing = ['playing', 'loading'].includes(pb.status);
    $('#hgTitle', el).textContent = cur ? cur.title : (g.round.number ? 'Ready' : (g.mode === 'checklist' ? 'Start the game to begin' : 'Start Round 1 to begin'));
    $('#hgArtist', el).textContent = cur ? cur.artist : '';
    $('#hgNowLbl', el).textContent = cur ? `Song ${cur.number} of ${g.totals.songs} · ${pb.status === 'between' ? 'finished' : pb.status}${cur.played ? ' · ✓ counted' : ''}` : 'Now playing';
    $('#hgNext', el).textContent = g.next ? `Up next: ${g.next.title} — ${g.next.artist}` : (g.totals.remaining ? '' : 'All songs played');
    $('#hgArt', el).classList.toggle('paused', !playing);
    $('#cPlay', el).textContent = playing || pb.status === 'between' ? '❚❚' : '▶';
    $('#cVol', el).value = g.settings.volume; $('#cVolV', el).textContent = g.settings.volume;
    $$('#cClip button', el).forEach(b => b.classList.toggle('on', String(b.dataset.m) === String(g.settings.clipMode)));
    $$('#cGap button', el).forEach(b => { const v = Number(g.settings.autoAdvanceGap) || 0; b.classList.toggle('on', b.dataset.g === 'custom' ? ![0, 3, 5, 10].includes(v) : Number(b.dataset.g) === v); if (b.dataset.g === 'custom') b.textContent = ![0, 3, 5, 10].includes(v) ? v + ' s' : '…'; });
    $('#cAuto', el).checked = g.settings.autoAdvance; $('#cLev', el).checked = g.settings.audio.levelling; $('#cIntro', el).checked = g.settings.skipIntros !== false;
    $('#cMute', el).textContent = g.settings.audio.muted ? '🔊 Unmute' : '🔇 Mute'; $('#cMute', el).className = 'btn sm' + (g.settings.audio.muted ? ' primary' : '');
    $('#hgLevel', el).textContent = g.settings.audio.levelling ? `Levelling to ${g.settings.audio.targetLufs} LUFS · max boost +${g.settings.audio.maxBoostDb} dB · fade in ${g.settings.audio.fadeIn}s / out ${g.settings.audio.fadeOut}s${g.settings.audio.muted ? ' · MUTED' : ''}` : (g.settings.audio.muted ? 'MUTED' : 'Levelling off — songs play at their original loudness');
    $('#hgLock', el).textContent = g.cardsLocked ? '🔒 CARDS LOCKED' : 'DRAFT CARDS'; $('#hgLock', el).className = 'badge ' + (g.cardsLocked ? 'ok' : 'warn');
    this.drawNight();
    const quizNow = !!(g.night && g.night.phase === 'quiz'); $$('.controls .ctl', el).forEach(b => { if (b.id !== 'cStop') b.disabled = quizNow; });
    const ss = g.session;
    const im = g.intermission;
    $('#hgSession', el).innerHTML = (im ? `<div class="banner" style="border-color:var(--lilac);background:rgba(196,176,255,.1)"><div class="grow"><h3>☕ Intermission</h3><div class="muted">${im.until ? 'Back at ' + new Date(im.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}The TV shows the break screen${im.message ? ': “' + esc(im.message) + '”' : ''}. Music is paused.</div></div><button class="btn" id="hgImEnd">End intermission</button><button class="btn primary lg" id="hgImGo">▶ Start Round ${g.round.number}</button></div>` : '') + (ss ? `<div class="banner" style="border-color:var(--amber);background:rgba(255,200,87,.12)"><div class="grow"><h3>❄ Claims frozen</h3><div class="muted">Session ${esc(ss.id)} · ${ss.claims.length} card(s) · ${ss.claims.filter(c => c.status === 'pending').length} awaiting a decision · ${ss.snapshotCount} eligible songs frozen</div></div><button class="btn primary lg" id="hgOpenSess">Open claim session</button></div>` : '');
    if ($('#hgImEnd', el)) { $('#hgImEnd', el).onclick = () => App.cmd('endIntermission'); $('#hgImGo', el).onclick = () => App.cmd('startRound', { round: g.round.number }); }
    if ($('#hgOpenSess', el)) $('#hgOpenSess', el).onclick = () => App.openChecker();
    const un = g.unavailable || [];
    $('#hgUnavail', el).innerHTML = un.length ? `<div class="banner" style="border-color:var(--red);background:var(--red-soft)"><div class="grow"><h3>⚠ ${un.length} video${un.length > 1 ? 's' : ''} unavailable</h3>${un.slice(0, 4).map(u => `<div class="row small" style="margin-top:6px"><b>${esc(u.title)}</b><span class="muted">— ${esc(u.artist)} · ${esc(u.reason)}</span><span class="grow"></span><button class="btn sm" data-relink="${u.songId}">Relink</button><button class="btn sm danger" data-credit="${u.songId}">Technical credit…</button></div>`).join('')}${un.length > 4 ? `<div class="muted small">…and ${un.length - 4} more</div>` : ''}</div></div>` : '';
    $$('[data-relink]', el).forEach(b => b.onclick = () => App.relinkSong(b.dataset.relink));
    $$('[data-credit]', el).forEach(b => b.onclick = () => App.creditDialog(b.dataset.credit));
    $('#hgCredits', el).innerHTML = (g.credits || []).length ? g.credits.map(c => `<div class="hist-item"><div class="t"><b>${esc(c.title)}</b> <span>— ${esc(c.artist)}</span><div class="tiny muted">${esc(c.reason)} · ${new Date(c.at).toLocaleTimeString()}</div></div><span class="badge ${c.status === 'active' ? 'warn' : ''}">${c.status === 'active' ? 'COUNTS' : 'REVERSED'}</span>${c.status === 'active' ? `<button class="btn sm ghost" data-rev="${c.id}">Reverse</button>` : ''}</div>`).join('') : '<div class="muted small">None. Use this only when a video cannot be played — the song then counts on every card.</div>';
    $$('[data-rev]', el).forEach(b => b.onclick = () => App.reverseCredit(b.dataset.rev));
    $('#rPause', el).textContent = g.gamePaused ? 'Resume game' : 'Pause game';
    $('#rComplete', el).disabled = !g.round.canComplete;
    const st = $('#hgStatus', el); st.className = 'statusline';
    if (g.lastError) { st.textContent = '⚠ ' + g.lastError; st.classList.add('err'); }
    else if (!g.audienceConnected) { st.textContent = '⚠ The audience window is closed — the TV will not play anything. Click “Open audience window”.'; st.classList.add('warn'); }
    else if (pb.pausedForClaim) { st.textContent = '⏸ Paused for a BINGO check — the position is saved. Press Play to resume.'; st.classList.add('warn'); }
    else if (g.gamePaused) { st.textContent = '⏸ Game paused.'; st.classList.add('warn'); }
    else if (pb.status === 'between') st.textContent = 'Next song starting…';
    else if (pb.status === 'finished') st.textContent = 'Every song has been played.';
    else st.textContent = g.round.number === 0 ? (g.mode === 'checklist' ? 'Press START GAME when the room is ready.' : 'Press START ROUND 1 when the room is ready.') : '';
    this.drawRounds(); this.updateProgress(); this.drawWinners(); this.drawTab(); this.drawUpNext();
    if (cur && this.thumbFor !== cur.songId) { this.thumbFor = cur.songId; this.loadThumb(cur.songId); }
  },

  async loadThumb(songId) {
    const lib = await apiQuiet('library:list'); const s = lib.songs.find(x => x.id === songId);
    const img = $('#hgThumb', this.el); if (!img) return;
    if (s && s.thumb) { img.src = fileUrl(s.thumb); img.style.display = 'block'; } else img.style.display = 'none';
  },

  /* Quiz Intermission Mode bar: QUIZ TIME (dark blue) ⇄ BINGO BREAK n (orange). One button each way. */
  drawNight() {
    const g = App.game; const el = this.el; const box = $('#hgNight', el); if (!box) return;
    const n = g.night; if (!n || (g.status === 'finished' && n.phase !== 'quiz')) { box.innerHTML = ''; this._nk = null; return; }
    const cur = g.current;
    const quiz = n.phase === 'quiz';
    const tonight = g.totals.played + g.totals.credited;
    const key = JSON.stringify([n, quiz ? null : [cur && cur.number, g.round.number, g.round.label, tonight], g.audienceConnected, g.status, g.mode, g.checklist && g.checklist.completed]);
    if (key === this._nk) return; this._nk = key;
    const pos = n.pausedAt ? `song ${n.pausedAt.index + 1}, ${fmtTime(n.pausedAt.position)} in` : (g.round.number ? 'between songs' : 'before the first song');
    const tvTxt = n.quizTv === 'hold' ? 'The TV shows a still holding screen.' : (g.audienceConnected ? 'TV window hidden, so your quiz shows on the TV.' : 'The TV window is not open.');
    const timeline = (n.breaks.length || quiz) ? `<div class="nb-line">${n.breaks.map(b => `<span class="nb-q">Quiz</span><span class="nb-b${b.endedAt ? '' : ' on'}">Break ${b.n}<small>${b.songs} song${b.songs === 1 ? '' : 's'}${b.winners ? ` · ${b.winners} winner${b.winners === 1 ? '' : 's'}` : ''}</small></span>`).join('')}${quiz ? '<span class="nb-q on">Quiz · now</span>' : ''}</div>` : '';
    const where = g.mode === 'checklist' ? `Rules ${g.checklist.completed} of ${g.checklist.total} won` : (g.round.number ? `Round ${g.round.number} · ${esc(g.round.label || '')}` : 'Not started');
    if (g.status === 'finished') {
      box.innerHTML = `<div class="nightbar quiz" id="nbBar"><span class="nb-pill">QUIZ TIME</span><div class="grow"><b>The game has ended.</b> <span class="muted">${tvTxt}</span></div><button class="btn primary lg" id="nbStart">Show the TV (end screen)</button></div>`;
    } else if (quiz) {
      box.innerHTML = `<div class="nightbar quiz" id="nbBar">
        <span class="nb-pill">QUIZ TIME</span>
        <div class="grow"><b>Bingo paused at ${pos}.</b> <span class="muted">${tvTxt}</span></div>
        <button class="btn primary lg" id="nbStart">▶ START BINGO BREAK ${n.nextBreak}</button>
      </div>
      <div class="nb-sub">${timeline}
        <div class="nb-opts"><span class="muted tiny">WHEN I RETURN TO THE QUIZ</span><div class="seg" id="nbTv"><button data-v="hide" class="${n.quizTv === 'hide' ? 'on' : ''}">Hide the TV window</button><button data-v="hold" class="${n.quizTv === 'hold' ? 'on' : ''}">Show a still holding screen</button></div>
        <span class="muted tiny">WHEN A BREAK STARTS</span><div class="seg" id="nbAuto"><button data-v="0" class="${n.autoPlay ? '' : 'on'}">Wait for me to press Play</button><button data-v="1" class="${n.autoPlay ? 'on' : ''}">Play straight away</button></div></div>
        <div class="muted tiny">Cards, rules, winners, history and any open claim session are kept. Nothing is reshuffled.</div></div>`;
    } else {
      box.innerHTML = `<div class="nightbar break" id="nbBar">
        <span class="nb-pill">${n.breakNo ? 'BINGO BREAK ' + n.breakNo : 'BINGO'}</span>
        <div class="grow"><b>${cur ? `Song ${cur.number} of ${g.totals.songs}` : 'Ready'} · ${where}</b> <span class="nb-dim">${tonight} played tonight</span></div>
        <button class="btn lg nb-quiz" id="nbQuiz" title="Pause the bingo and hide the TV so your quiz shows (Q)">❚❚ RETURN TO QUIZ</button>
      </div>${timeline && n.breaks.length > 1 ? `<div class="nb-sub">${timeline}</div>` : ''}`;
    }
    const q = $('#nbQuiz', box); if (q) q.onclick = () => App.cmd('returnToQuiz');
    const st = $('#nbStart', box); if (st) st.onclick = () => App.cmd('startBreak');
    $$('#nbTv button', box).forEach(b => b.onclick = () => App.cmd('setNight', { quizTv: b.dataset.v }));
    $$('#nbAuto button', box).forEach(b => b.onclick = () => App.cmd('setNight', { autoPlay: b.dataset.v === '1' }));
  },

  updateProgress() {
    const g = App.game; const el = this.el; if (!g || !$('#hgFill', el)) return;
    const pb = g.playback; const dur = (g.current && g.current.duration) || pb.clipEnd || 0;
    const pos = pb.position || 0;
    $('#hgPos', el).textContent = fmtTime(pos); $('#hgDur', el).textContent = fmtTime(dur);
    if (dur) {
      $('#hgFill', el).style.width = Math.min(100, pos / dur * 100) + '%';
      const cs = pb.clipStart || 0, ce = pb.clipEnd || dur;
      $('#hgClip', el).style.left = (cs / dur * 100) + '%'; $('#hgClip', el).style.width = Math.max(0, (ce - cs) / dur * 100) + '%';
      const left = Math.max(0, ce - pos);
      $('#hgClipLbl', el).textContent = g.current ? `clip ${fmtTime(cs)}–${fmtTime(ce)} · ${['playing', 'loading', 'paused'].includes(pb.status) ? fmtTime(left) + ' left' : ''}` : '';
    } else { $('#hgFill', el).style.width = '0'; $('#hgClipLbl', el).textContent = ''; }
  },

  /** This game's winning rules; rounds already in play are locked. */
  async editRules() {
    const body = document.createElement('div');
    const draw = () => {
      const rr = App.game.roundRules; const R0 = App.game.round;
      const minRounds = R0.number && R0.status !== 'ready' ? R0.number : Math.max(1, R0.number);
      body.innerHTML = `${roundCountHtml(App.game.roundCount || 3, minRounds)}<p class="muted small" style="margin-top:8px">Rules for <b style="color:#fff">this game</b>. A round's rules can be changed until it starts. Cards don't change — only the winning pattern does. <b style="color:var(--amber)">If cards are already printed, tell players about any change</b> (the printed legend shows the rules from when they were printed).</p>${roundsSummaryHtml(rr)}
        <div class="row" style="margin-top:10px;flex-wrap:wrap">${Object.keys(rr).map(Number).map(n => `<button class="btn sm" data-chg="${n}" ${rr[n].locked ? 'disabled title="Round already started"' : ''}>Change Round ${n}…</button>`).join('')}</div>`;
      $$('[data-rc]', body).forEach(b => b.onclick = async () => { const x = await App.cmd('setRoundCount', { count: (App.game.roundCount || 3) + Number(b.dataset.rc) }); if (x && x.ok) setTimeout(draw, 150); });
      $$('[data-chg]', body).forEach(b => b.onclick = async () => {
        const n = Number(b.dataset.chg);
        const r = await ruleEditor(App.game.roundRules[n].rules, { title: `Round ${n} — winning rules`, round: n });
        if (!r) return;
        const x = await App.cmd('setRoundRules', { round: n, rules: r });
        if (x && x.ok) { toast(`Round ${n}: ${x.info.label}`, 'ok'); setTimeout(draw, 150); }
      });
    };
    draw();
    await modal({ title: '🎯 Winning rules — ' + esc(App.game.name), size: 'mid', body, buttons: [{ label: 'Done', kind: 'primary', value: true }] });
  },

  /** Rules Checklist Mode: the checklist replaces the round buttons. */
  drawChecklist() {
    const g = App.game; const el = this.el; const ck = g.checklist; const R = g.round;
    $('#rTitle', el).textContent = 'Winning rules checklist';
    $('#rRules', el).style.display = R.number ? 'none' : ''; $('#rRules', el).textContent = '✎ Edit checklist…';
    $('#rComplete', el).style.display = 'none';
    const key = JSON.stringify([ck, R, g.status]);
    if (key === this._ckKey && $('#rBtns', el).firstChild) return; this._ckKey = key;
    const fin = g.status === 'finished';
    let banner = '';
    if (!R.number && !fin) banner = `<div class="banner" style="margin:4px 0 12px"><div class="grow"><h3>Ready — ${ck.total} rule${ck.total > 1 ? 's' : ''}, any order</h3><div class="muted small">Every rule is open from the start. There are no rounds — confirmed winners tick rules off.</div></div><button class="btn primary lg" id="ckStart">▶ Start game</button></div>`;
    else if (ck.allDone && !fin) banner = `<div class="banner" style="margin:4px 0 12px;border-color:var(--green);background:var(--green-soft)"><div class="grow"><h3>🏆 ALL BINGO RULES COMPLETED</h3><div class="muted small">${ck.closed ? 'Claims are closed — the music carries on.' : 'Finish the game, or keep the music going without more claims.'}</div></div>${ck.closed ? '<button class="btn" id="ckReopen">Re-open claims</button>' : '<button class="btn" id="ckMusic">▶ Continue music without claims</button>'}<button class="btn" id="ckView">View winners</button><button class="btn primary lg" id="ckFinish">🏁 Finish game</button></div>`;
    else if (ck.playlistDone && !fin) { const o = ck.items.filter(i => i.status !== 'completed'); banner = `<div class="banner" style="margin:4px 0 12px;border-color:var(--amber);background:rgba(255,200,87,.12)"><div class="grow"><h3>Every song has been played</h3><div class="muted small">${o.length} rule${o.length > 1 ? 's were' : ' was'} not won: <b style="color:#fff">${o.map(i => esc(i.label)).join(', ')}</b>. You can still check claims, or finish the game.</div></div><button class="btn" id="ckView">View winners</button><button class="btn primary lg" id="ckFinish">🏁 Finish game</button></div>`; }
    banner = banner.replace('<div class="banner" style="', '<div class="banner ck-banner" style="');
    $('#rStatus', el).innerHTML = banner + `<div class="ck-count"><b class="display">${ck.completed} OF ${ck.total}</b> RULES COMPLETED<div class="ck-bar"><i style="width:${ck.total ? ck.completed / ck.total * 100 : 0}%"></i></div></div>`;
    $('#rBtns', el).className = 'ck-list';
    $('#rBtns', el).innerHTML = ck.items.map(i => `<div class="ck-item ${i.status}"><div class="ck-pat">${patternGridHtml(i.example, i.status === 'completed' ? 'green' : 'pink')}</div><div class="grow"><b>${esc(i.label)}</b>${i.status === 'completed' ? ' <span class="badge ok">✓ COMPLETED</span>' : ' <span class="badge">AVAILABLE</span>'}
        <div class="tiny muted">${esc(i.short)}</div>${i.winners.map(w => `<div class="small ck-win">🏆 Card <b>${w.cardLabel}</b>${w.owner ? ' · <span style="color:var(--pink)">' + esc(w.owner) + '</span>' : ''} <span class="muted tiny">${new Date(w.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> <button class="btn sm ghost" data-fix="${w.claimId}">Correct…</button></div>`).join('')}</div></div>`).join('');
    const audit = (g.audit || []).filter(a => /winner-(revoked|corrected)|claims-/.test(a.action));
    $('#rRule', el).innerHTML = `Any open rule, in any order. The list order is for display only.${audit.length ? `<details style="margin-top:8px"><summary>Corrections log (${audit.length})</summary>${audit.map(a => `<div class="tiny">${new Date(a.at).toLocaleTimeString()} · ${esc(a.action.replace('winner-', ''))} · card ${esc(String(a.cardNo || ''))} ${a.from ? esc(a.from) + ' → ' + esc(a.to) : esc(a.ruleLabel || '')}${a.reason ? ' — “' + esc(a.reason) + '”' : ''} <span class="muted">(${esc(a.source)})</span></div>`).join('')}</details>` : ''}`;
    const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
    on('ckStart', async () => { if (!await confirmBox('Start the game?', `All ${ck.total} rules are open from the start. The TV shows the checklist and the music starts.`, 'Start game')) return; if (!g.audienceConnected) await api('audience:open'); const r = await App.cmd('startRound', { round: 1 }); if (r && r.warning) toast(r.warning, 'err'); });
    on('ckFinish', async () => { if (await confirmBox('Finish the game?', `${ck.completed} of ${ck.total} rules were won. Playback stops and the TV shows the end screen.`, 'Finish game')) App.cmd('endGame'); });
    on('ckView', () => App.viewWinners());
    on('ckMusic', () => App.cmd('closeChecklist', { closed: true }));
    on('ckReopen', () => App.cmd('closeChecklist', { closed: false }));
    $$('[data-fix]', el).forEach(b => b.onclick = () => App.correctAward(b.dataset.fix));
  },

  /** Before the start: edit the checklist (choose, reorder, remove, presets). */
  async editChecklist() {
    const body = document.createElement('div'); let items = null;
    body.innerHTML = '<p class="muted small" style="margin-top:0">The checklist can be changed until the game starts. Cards don\'t change.</p><div id="ecEd"></div>';
    checklistEditor(body.querySelector('#ecEd'), App.game.checklistRules.map(r => ({ id: r.id, rule: r.rule })), (l) => { items = l; });
    const ok = await modal({ title: '🎯 Winning rules checklist', size: 'mid', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Save checklist', kind: 'primary', value: true }] });
    if (ok && items) { const x = await App.cmd('setChecklist', { items }); if (x && x.ok) toast(`Checklist saved — ${items.length} rule${items.length > 1 ? 's' : ''}`, 'ok'); }
  },

  drawRounds() {
    if (App.game.mode === 'checklist') return this.drawChecklist();
    const g = App.game; const box = $('#rBtns', this.el); const R = g.round;
    box.innerHTML = Array.from({ length: g.roundCount || 3 }, (_, i) => i + 1).map(n => {
      const active = R.number === n && R.status === 'active';
      const ready = R.number === n && R.status === 'ready';
      const done = R.number > n || (R.number === n && R.status === 'ended');
      const isNext = (R.number === 0 && n === 1) || ready || (n === R.number + 1 && R.status === 'active');
      return `<button class="round-btn ${active ? 'active' : ''} ${ready ? 'ready' : ''} ${done ? 'done' : ''}" data-r="${n}" ${isNext && g.status !== 'finished' ? '' : 'disabled'}>${patternGridHtml(RR(n).examples[0])}<div><b>ROUND ${n}</b><span>${esc(RR(n).label)}</span><div class="tiny muted">${active ? 'IN PLAY' : ready ? 'READY — click to start' : done ? 'Complete' : (isNext ? 'Next' : '')}</div></div></button>`;
    }).join('');
    $$('[data-r]', box).forEach(b => b.onclick = async () => {
      const n = Number(b.dataset.r);
      if (R.status === 'active' && n === R.number + 1) {
        // manual change without the transition flow
        if (!await confirmBox(`Skip to Round ${n}?`, `Round ${R.number} is still in play. Use <b>Complete Round & Continue</b> to finish it properly. Change to Round ${n} — <b>${esc(RR(n).label)}</b> now anyway? Songs stay marked.`, `Change to Round ${n}`, true)) return;
      } else if (!await confirmBox(`Start Round ${n}?`, `Start Round ${n} — <b>${esc(RR(n).label)}</b>? The TV shows the new winning pattern and the music ${n === 1 ? 'starts' : 'resumes'}.`, `Start Round ${n}`)) return;
      if (n === 1 && !g.audienceConnected) await api('audience:open');
      const r = await App.cmd('startRound', { round: n }); if (r && r.warning) toast(r.warning, 'err');
    });
    const st = $('#rStatus', this.el);
    if (R.status === 'ready') {
      st.innerHTML = `<div class="banner" style="margin:4px 0 12px"><div class="grow"><h3>Round ${R.number} is ready — ${esc(R.label)}</h3><div class="muted small">Music is paused. Start when the room is ready.</div>${R.preQualified.length ? `<div class="small" style="color:var(--amber);margin-top:6px">⚠ ${R.preQualified.length} card${R.preQualified.length > 1 ? 's' : ''} already ${R.preQualified.length > 1 ? 'have' : 'has'} ${esc(R.label)} (${R.preQualified.slice(0, 12).join(', ')}${R.preQualified.length > 12 ? '…' : ''}). Nothing is awarded automatically — they win when they claim and you confirm.</div>` : ''}</div><button class="btn primary lg" id="rStartReady">▶ Start Round ${R.number}</button></div>`;
      $('#rStartReady', st).onclick = async () => { if (!g.audienceConnected) await api('audience:open'); App.cmd('startRound', { round: R.number }); };
    } else if (R.canComplete && R.winners > 0) {
      st.innerHTML = `<div class="banner" style="margin:4px 0 12px;border-color:var(--green);background:var(--green-soft)"><div class="grow"><h3>🏆 Round ${R.number} has ${R.winners} confirmed winner${R.winners > 1 ? 's' : ''}</h3><div class="muted small">Check any other claims first. When you're ready, complete the round — the TV shows the round transition and the next pattern.</div></div><button class="btn primary lg" id="rCompleteBig">${R.number === 3 ? 'Complete Game' : 'Complete Round & Continue'}</button></div>`;
      $('#rCompleteBig', st).onclick = () => App.completeRound();
    } else st.innerHTML = '';
    $('#rRule', this.el).textContent = R.rule || Array.from({ length: App.game.roundCount || 3 }, (_, i) => i + 1).map(n => `Round ${n}: ${RR(n).short || RR(n).label}.`).join(' ') + (Array.from({ length: App.game.roundCount || 3 }, (_, i) => i + 1).some(n => RR(n).diagonalsCount) ? '' : ' Diagonals never count.');
  },

  drawUpNext() {
    const g = App.game; const box = $('#hgUpNext', this.el); if (!box) return;
    const u = g.upNext || {}; const n = u.next;
    const src = n ? ({ queue: 'QUEUED BY HOST', deferred: 'PREVIOUSLY SKIPPED', playlist: 'PLAYLIST ORDER' })[n.source] : '';
    box.innerHTML = `<h2>Up next <span class="badge">HOST ONLY</span></h2>
      ${n ? `<div class="row" style="align-items:flex-start;gap:12px">${n.thumb ? `<img class="thumb" style="width:96px;height:54px" src="${fileUrl(n.thumb)}">` : '<div class="thumb" style="width:96px;height:54px"></div>'}
        <div class="grow" style="min-width:0"><div class="eyebrow">${src} · song ${n.number}</div><div style="font-weight:800;font-size:16px;color:#fff">${esc(n.title)}</div><div class="muted">${esc(n.artist)}</div>
        <div class="tiny muted" style="margin-top:4px;word-break:break-all">${esc(n.fileName)}</div>
        <div class="tiny muted">${n.duration ? 'Length ' + fmtTime(n.duration) + ' · ' : ''}starts at ${fmtTime(n.clipStart)}${n.introSkipped ? ' (quiet intro skipped)' : ''} · ${n.clipMode === 'full' ? 'full song' : (n.clipLength ? n.clipLength + ' s clip' : '')}</div>
        <div style="margin-top:6px">${n.ready ? `<span class="badge ok">READY</span>${n.levelling === 'done' ? ' <span class="badge">levelled</span>' : ''}` : `<span class="badge bad">⚠ ${esc(n.problem || 'not ready')}</span>`}</div></div></div>
        <div class="row" style="margin-top:12px"><button class="btn sm" id="unSkip">Skip this one</button><button class="btn sm" id="unPick">Choose another…</button>${u.custom ? '<button class="btn sm ghost" id="unReset">Back to playlist order</button>' : ''}${!n.ready ? `<button class="btn sm primary" id="unRelink">Relink</button>` : ''}</div>`
        : '<div class="muted small">No more songs to play.</div>'}
      ${u.queue && u.queue.length ? `<div class="eyebrow" style="margin-top:12px">Queue (${u.queue.length})</div>${u.queue.map(q => `<div class="hist-item"><div class="t"><b>${esc(q.title)}</b> <span>— ${esc(q.artist)}</span></div><button class="btn sm ghost" data-unq="${q.songId}">✕</button></div>`).join('')}` : ''}
      ${u.deferred && u.deferred.length ? `<div class="tiny muted" style="margin-top:8px">${u.deferred.length} skipped song(s) will come back later.</div>` : ''}`;
    if (!n) return;
    $('#unSkip', box).onclick = () => App.cmd('skipNext', { expectSongId: n.songId });
    $('#unPick', box).onclick = () => App.pickNextSong();
    if ($('#unReset', box)) $('#unReset', box).onclick = () => App.cmd('resetQueue');
    if ($('#unRelink', box)) $('#unRelink', box).onclick = () => App.relinkSong(n.songId);
    $$('[data-unq]', box).forEach(b => b.onclick = () => App.cmd('unqueueSong', { songId: b.dataset.unq }));
  },

  drawWinners() {
    const g = App.game;
    $('#hgWinners', this.el).innerHTML = g.winners.length ? g.winners.map(w => `<div class="winner-row"><span class="cn">${w.cardLabel}</span><div class="grow"><b>${w.rule ? esc(w.rule) : 'Round ' + w.round}</b>${w.owner ? ` · <span style="color:var(--pink)">${esc(w.owner)}</span>` : ''}<div class="small muted">${esc(w.headline)}</div></div><button class="btn sm ghost" data-undo="${w.claimId}" title="${g.mode === 'checklist' ? 'Correct this award' : 'Undo'}">${g.mode === 'checklist' ? 'Correct…' : 'Undo'}</button></div>`).join('') : '<div class="muted small">No winners confirmed yet.</div>';
    $$('[data-undo]', this.el).forEach(b => b.onclick = async () => { if (App.game.mode === 'checklist') return App.correctAward(b.dataset.undo); if (await confirmBox('Undo this winner?', 'The card will no longer be listed as a winner. Use this only to correct a mistake.', 'Undo winner', true)) App.cmd('revokeWinner', { claimId: b.dataset.undo }); });
    const sLabel = { pending: ['VALID · awaiting', 'warn'], confirmed: ['WINNER', 'ok'], invalid: ['NOT VALID', 'bad'], rejected: ['REJECTED', 'bad'], dismissed: ['DISMISSED', ''], duplicate: ['ALREADY WON', 'warn'], revoked: ['UNDONE', ''] };
    $('#hgClaims', this.el).innerHTML = g.claims.length ? g.claims.slice(0, 12).map(c => `<div class="hist-item" style="cursor:pointer" data-card="${c.cardNo}"><span class="n">${c.cardLabel}</span><div class="t"><b>${c.rule ? esc(c.rule) : 'R' + c.round}</b>${c.owner ? ` <b style="color:var(--pink)">${esc(c.owner)}</b>` : ''} <span>${esc(c.headline)}</span></div><span class="badge ${sLabel[c.status][1]}">${sLabel[c.status][0]}</span></div>`).join('') : '<div class="muted small">No claims checked yet.</div>';
    $$('[data-card]', this.el).forEach(r => r.onclick = () => App.openChecker(r.dataset.card));
  },

  drawTab() {
    const g = App.game; const box = $('#hgTab', this.el); if (!box) return;
    if (this.tab === 'crawler' && box.contains(document.activeElement) && this._drawnTab === 'crawler') return; // don't rebuild under the host's finger
    // Only rebuild the list when its own data changed (a volume tap must not re-render 100 rows)
    const key = this.tab + '|' + (this.tab === 'played' ? JSON.stringify(g.history) : this.tab === 'order' ? JSON.stringify(g.order) + g.playback.index : this.tab === 'crawler' ? JSON.stringify([g.settings.crawler, g.settings.overlay]) : JSON.stringify(g.log || []).length);
    if (key === this._tabKey && this._drawnTab === this.tab && box.firstChild) return;
    this._tabKey = key;
    this._drawnTab = this.tab;
    $$('#hgTabs button', this.el).forEach(b => b.classList.toggle('on', b.dataset.t === this.tab));
    const sc = box.querySelector('.hist-list'); const keep = sc ? sc.scrollTop : 0;
    if (this.tab === 'played') {
      box.innerHTML = `<div class="muted small" style="margin-bottom:8px">The official list — exactly what the TV crawler shows and what BINGO checks use. ${g.history.length} song(s).</div>
        <div class="hist-list">${g.history.length ? g.history.slice().reverse().map(h => `<div class="hist-item"><span class="n">${String(h.n).padStart(2, '0')}</span><div class="t">${h.kind === 'credit' ? '<span class="badge warn">TECHNICAL CREDIT</span> ' : ''}<b>${esc(h.title)}</b> <span>— ${esc(h.artist)}</span></div><span class="tiny muted">R${h.round}${h.manual && h.kind !== 'credit' ? ' · marked' : ''}</span><button class="btn sm ghost" data-un="${h.songId}" title="Remove from played list (correction)">✕</button></div>`).join('') : '<div class="muted small">Nothing played yet.</div>'}</div>`;
      $$('[data-un]', box).forEach(b => b.onclick = async () => {
        if (!await confirmBox('Remove from played list?', 'Only use this to correct a mistake — the song will disappear from the TV crawler and stop counting on cards.', 'Remove', true)) return;
        const r = await App.cmd('unmarkPlayed', { songId: b.dataset.un });
        if (r && r.needsCorrection && await confirmBox('Correction affects results', esc(r.message) + '<br><br>Frozen claim sessions keep their snapshot. Confirmed winners stay confirmed but are flagged for review.', 'Apply correction', true)) App.cmd('unmarkPlayed', { songId: b.dataset.un, acknowledge: true });
      });
    } else if (this.tab === 'order') {
      box.innerHTML = `<div class="muted small" style="margin-bottom:8px">Shuffled order, saved before the game started. Host only — never shown on the TV.</div><div class="hist-list">${g.order.map(o => `<div class="hist-item ${o.index === g.playback.index ? 'current' : ''} ${o.playedNo ? 'done' : ''} ${o.skipped ? 'skipped' : ''}"><span class="n">${o.index + 1}</span><div class="t"><b>${esc(o.title)}</b> <span>— ${esc(o.artist)}</span></div>${o.playedNo ? `<span class="badge ${o.credit ? 'warn' : 'ok'}">${o.credit ? 'TC ' : '#'}${o.playedNo}</span>` : (o.unavailable ? '<span class="badge bad">unavailable</span>' : (o.skipped ? '<span class="badge warn">skipped</span>' : ''))}<button class="btn sm ghost" data-q="${o.songId}" title="Play next (queue)">⤴</button><button class="btn sm ghost" data-play="${o.index}" title="Play now">▶</button>${o.playedNo ? '' : `<button class="btn sm ghost" data-mk="${o.songId}" title="Mark as played">✓</button>`}</div>`).join('')}</div>`;
      $$('[data-q]', box).forEach(b => b.onclick = () => App.cmd('queueSong', { songId: b.dataset.q }));
      $$('[data-play]', box).forEach(b => b.onclick = async () => { if (await confirmBox('Play this song now?', 'The current song (if unfinished) is skipped without counting.', 'Play now')) App.cmd('jumpTo', { index: Number(b.dataset.play) }); });
      $$('[data-mk]', box).forEach(b => b.onclick = async () => { if (await confirmBox('Mark as played?', 'Add this song to the official played list?', 'Mark played')) App.cmd('markPlayed', { songId: b.dataset.mk }); });
    } else if (this.tab === 'crawler') {
      const c = g.settings.crawler; const o = g.settings.overlay;
      box.innerHTML = `<div class="form-grid">
        <label class="field">Scroll speed: ${c.speed}/10<input type="range" min="1" max="10" value="${c.speed}" data-c="speed"></label>
        <label class="field">Text size: ${c.fontSize}px<input type="range" min="18" max="56" value="${c.fontSize}" data-c="fontSize"></label>
        <label class="field">Crawler height: ${c.height}px<input type="range" min="48" max="140" value="${c.height}" data-c="height"></label>
        <label class="field">Separator<select data-c="separator">${['diamond', 'bar', 'dot', 'star', 'note'].map(s => `<option ${c.separator === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
        <div class="row" style="margin-top:14px"><button class="btn ${c.paused ? 'primary' : ''}" id="crP">${c.paused ? '▶ Resume crawler' : '❚❚ Pause crawler'}</button><span class="muted small">The crawler keeps moving while the music is paused, so players can catch up.</span></div>
        <h2 style="margin-top:18px">Song title overlay</h2><div class="form-grid">
        <label class="field">Position<select data-o="position">${['bottom-left', 'bottom-center', 'top-left'].map(s => `<option ${o.position === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field">Title size: ${o.titleSize}px<input type="range" min="32" max="120" value="${o.titleSize}" data-o="titleSize"></label>
        <label class="field">Artist size: ${o.artistSize}px<input type="range" min="20" max="80" value="${o.artistSize}" data-o="artistSize"></label>
        <label class="field">Background opacity: ${Math.round(o.opacity * 100)}%<input type="range" min="0" max="100" value="${Math.round(o.opacity * 100)}" data-o="opacity"></label>
        <label class="field">Show for (0 = whole song): ${o.duration}s<input type="range" min="0" max="60" step="5" value="${o.duration}" data-o="duration"></label>
        <label class="field">Reveal title after<select data-o="revealDelay">${[0, 5, 10, 15, 20, 30].map(v => `<option value="${v}" ${Number(o.revealDelay || 0) === v ? 'selected' : ''}>${v ? v + ' s (guess first)' : 'Immediately'}</option>`).join('')}</select></label></div>
        <div class="row" style="margin-top:12px">${toggleHtml('ovOn', 'Show title & artist on TV', o.enabled)}</div>
        <h2 style="margin-top:18px">Welcome &amp; end-of-night screens</h2>
        <div class="row" style="gap:22px">${toggleHtml('scW', 'Welcome screen before Round 1', g.settings.screens.welcome)}${toggleHtml('scE', '“Thanks for playing!” screen after the game', g.settings.screens.end)}</div>
        <div class="form-grid" style="margin-top:10px"><label class="field">We start at (e.g. 20:00)<input type="time" id="scT" value="${esc(g.settings.screens.startTime || '')}"></label>
        <label class="field">Welcome message (optional)<input type="text" id="scM" maxlength="120" value="${esc(g.settings.screens.message || '')}" placeholder="e.g. Grab your cards at the bar!"></label></div>
        <h2 style="margin-top:18px">TV winner &amp; wrong-claim screens</h2>
        <div class="row" style="gap:22px">${toggleHtml('tvW', 'Winner screen when a winner is confirmed', g.settings.tvScreens.winner)}${toggleHtml('tvR', '“Not a Bingo” screen when a claim is rejected', g.settings.tvScreens.wrongClaim)}${toggleHtml('tvC', 'Show the card number on the TV', g.settings.tvScreens.showCardNumber)}${toggleHtml('tvN', 'Show the winner’s name (phone players & named cards)', g.settings.tvScreens.showName !== false)}${toggleHtml('tvO', '“Players one song away” count on the TV', g.settings.tvScreens.closeCount !== false)}</div>
        <label class="field" style="max-width:260px;margin-top:10px">Show for ${g.settings.tvScreens.seconds} seconds<input type="range" min="3" max="20" value="${g.settings.tvScreens.seconds}" id="tvS"></label>`;
      $('#scW', box).onchange = (e) => App.cmd('setScreens', { welcome: e.target.checked });
      $('#scE', box).onchange = (e) => App.cmd('setScreens', { end: e.target.checked });
      $('#scT', box).onchange = (e) => App.cmd('setScreens', { startTime: e.target.value });
      $('#scM', box).onchange = (e) => App.cmd('setScreens', { message: e.target.value });
      $('#tvW', box).onchange = (e) => App.cmd('setTvScreens', { winner: e.target.checked });
      $('#tvR', box).onchange = (e) => App.cmd('setTvScreens', { wrongClaim: e.target.checked });
      $('#tvC', box).onchange = (e) => App.cmd('setTvScreens', { showCardNumber: e.target.checked });
      $('#tvN', box).onchange = (e) => App.cmd('setTvScreens', { showName: e.target.checked });
      $('#tvO', box).onchange = (e) => App.cmd('setTvScreens', { closeCount: e.target.checked });
      $('#tvS', box).onchange = (e) => App.cmd('setTvScreens', { seconds: Number(e.target.value) });
      $$('[data-c]', box).forEach(i => i.onchange = () => App.cmd('setCrawler', { [i.dataset.c]: i.tagName === 'SELECT' ? i.value : Number(i.value) }));
      $$('[data-o]', box).forEach(i => i.onchange = () => App.cmd('setOverlay', { [i.dataset.o]: i.dataset.o === 'revealDelay' ? Number(i.value) : i.tagName === 'SELECT' ? i.value : (i.dataset.o === 'opacity' ? Number(i.value) / 100 : Number(i.value)) }));
      $('#crP', box).onclick = () => App.cmd('setCrawler', { togglePause: true });
      $('#ovOn', box).onchange = (e) => App.cmd('setOverlay', { enabled: e.target.checked });
      return;
    } else if (this.tab === 'log') {
      apiQuiet('games:details', { id: g.gameId }).then(d => { if (this.tab !== 'log') return; box.innerHTML = `<div class="hist-list">${d.log.slice().reverse().map(l => `<div class="hist-item"><span class="tiny muted" style="width:70px">${new Date(l.at).toLocaleTimeString()}</span><div class="t">${esc(l.msg)}</div></div>`).join('')}</div>`; });
      return;
    }
    const nsc = box.querySelector('.hist-list'); if (nsc) nsc.scrollTop = keep;
  }
});
