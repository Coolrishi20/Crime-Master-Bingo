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
        <button class="btn" id="hgAud"></button>
      </div>
      <div id="hgRecover"></div><div id="hgSession"></div><div id="hgUnavail"></div>
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
              <label class="toggle small"><input type="checkbox" id="cLev"><span class="sw"></span>Auto volume levelling</label>
              <button class="btn sm" id="cMute">🔇 Mute</button></div>
            <div class="muted tiny" id="hgLevel" style="margin-top:6px"></div>
            <div class="statusline" id="hgStatus"></div>
          </div>
          <div class="panel" style="margin-bottom:16px">
            <h2>Rounds <span class="row" style="gap:8px"><button class="btn sm" id="rEnd">End round</button><button class="btn sm" id="rPause">Pause game</button><button class="btn sm danger" id="rEndGame">End game</button></span></h2>
            <div class="round-btns" id="rBtns"></div>
            <div class="muted small" id="rRule" style="margin-top:10px"></div>
          </div>
          <div class="panel">
            <div class="tabs" id="hgTabs"><button data-t="played">Played history</button><button data-t="order">Play order</button><button data-t="crawler">TV crawler</button><button data-t="log">Event log</button></div>
            <div id="hgTab"></div>
          </div>
        </div>
        <div>
          <div class="panel" style="margin-bottom:16px;border-color:var(--pink)">
            <h2>CHECK BINGO / FREEZE CLAIMS <span class="kbd">B</span></h2>
            <div class="check-box"><input type="text" inputmode="numeric" id="bNo" placeholder="Card no." maxlength="3"><button class="btn primary lg" id="bGo">CHECK</button></div>
            <div class="row" style="margin-top:10px"><button class="btn primary" id="bFreeze">❄ Freeze claims</button><button class="btn sm" id="bScan">📷 Scan QR</button></div>
            <div class="muted tiny" style="margin-top:8px">Freezing pauses the music and locks the list of songs that count, so several cards can be checked fairly against the same moment.</div>
          </div>
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
    $('#cMute', el).onclick = () => App.cmd('setAudio', { toggleMute: true });
    $('#bFreeze', el).onclick = () => App.openChecker();
    $('#hgCreditBtn', el).onclick = () => App.creditDialog();
    $('#hgProg', el).onclick = (e) => { const p = g().playback; const dur = (g().current && g().current.duration) || 0; if (!dur) return; const r = e.currentTarget.getBoundingClientRect(); App.cmd('seek', { position: dur * (e.clientX - r.left) / r.width }); };
    $('#hgAud', el).onclick = () => { if (g().audienceConnected) api('audience:fullscreen'); else api('audience:open'); };
    $('#rEnd', el).onclick = async () => { const r = g().round; if (await confirmBox(`End Round ${r.number}?`, 'Songs stay marked. You can start the next round when you are ready.', 'End round')) App.cmd('endRound'); };
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
    $('#hgRound', el).textContent = g.round.number ? `ROUND ${g.round.number} · ${g.round.label}${g.round.status === 'ended' ? ' · ENDED' : ''}` : 'NOT STARTED';
    $('#hgRound', el).className = 'chip' + (g.round.status === 'active' ? '' : ' dim');
    $('#hgCount', el).innerHTML = `SONG ${g.totals.played}<small> / ${g.totals.songs} played</small>`;
    $('#hgAud', el).textContent = g.audienceConnected ? '⛶ TV fullscreen (F)' : '📺 Open audience window';
    $('#hgAud', el).className = 'btn' + (g.audienceConnected ? '' : ' primary');
    $('#hgRecover', el).innerHTML = pb.recovered && pb.index >= 0 ? `<div class="banner"><div class="grow"><h3>Game restored</h3><div class="muted">Everything was saved. Song ${pb.index + 1} is ready to resume from ${fmtTime(pb.position)}. Press Play when you're ready.</div></div></div>` : (g.status === 'finished' ? `<div class="banner"><div class="grow"><h3>This game has ended</h3><div class="muted">Results are saved in Game History.</div></div><button class="btn" id="hgReopen">Re-open game</button></div>` : '');
    if ($('#hgReopen', el)) $('#hgReopen', el).onclick = () => App.cmd('reopenGame');
    const playing = ['playing', 'loading'].includes(pb.status);
    $('#hgTitle', el).textContent = cur ? cur.title : (g.round.number ? 'Ready' : 'Start Round 1 to begin');
    $('#hgArtist', el).textContent = cur ? cur.artist : '';
    $('#hgNowLbl', el).textContent = cur ? `Song ${cur.number} of ${g.totals.songs} · ${pb.status === 'between' ? 'finished' : pb.status}${cur.played ? ' · ✓ counted' : ''}` : 'Now playing';
    $('#hgNext', el).textContent = g.next ? `Up next: ${g.next.title} — ${g.next.artist}` : (g.totals.remaining ? '' : 'All songs played');
    $('#hgArt', el).classList.toggle('paused', !playing);
    $('#cPlay', el).textContent = playing || pb.status === 'between' ? '❚❚' : '▶';
    $('#cVol', el).value = g.settings.volume; $('#cVolV', el).textContent = g.settings.volume;
    $$('#cClip button', el).forEach(b => b.classList.toggle('on', String(b.dataset.m) === String(g.settings.clipMode)));
    $('#cAuto', el).checked = g.settings.autoAdvance; $('#cLev', el).checked = g.settings.audio.levelling;
    $('#cMute', el).textContent = g.settings.audio.muted ? '🔊 Unmute' : '🔇 Mute'; $('#cMute', el).className = 'btn sm' + (g.settings.audio.muted ? ' primary' : '');
    $('#hgLevel', el).textContent = g.settings.audio.levelling ? `Levelling to ${g.settings.audio.targetLufs} LUFS · max boost +${g.settings.audio.maxBoostDb} dB · fade in ${g.settings.audio.fadeIn}s / out ${g.settings.audio.fadeOut}s${g.settings.audio.muted ? ' · MUTED' : ''}` : (g.settings.audio.muted ? 'MUTED' : 'Levelling off — songs play at their original loudness');
    $('#hgLock', el).textContent = g.cardsLocked ? '🔒 CARDS LOCKED' : 'DRAFT CARDS'; $('#hgLock', el).className = 'badge ' + (g.cardsLocked ? 'ok' : 'warn');
    const ss = g.session;
    $('#hgSession', el).innerHTML = ss ? `<div class="banner" style="border-color:var(--amber);background:rgba(255,200,87,.12)"><div class="grow"><h3>❄ Claims frozen</h3><div class="muted">Session ${esc(ss.id)} · ${ss.claims.length} card(s) · ${ss.claims.filter(c => c.status === 'pending').length} awaiting a decision · ${ss.snapshotCount} eligible songs frozen</div></div><button class="btn primary lg" id="hgOpenSess">Open claim session</button></div>` : '';
    if ($('#hgOpenSess', el)) $('#hgOpenSess', el).onclick = () => App.openChecker();
    const un = g.unavailable || [];
    $('#hgUnavail', el).innerHTML = un.length ? `<div class="banner" style="border-color:var(--red);background:var(--red-soft)"><div class="grow"><h3>⚠ ${un.length} video${un.length > 1 ? 's' : ''} unavailable</h3>${un.slice(0, 4).map(u => `<div class="row small" style="margin-top:6px"><b>${esc(u.title)}</b><span class="muted">— ${esc(u.artist)} · ${esc(u.reason)}</span><span class="grow"></span><button class="btn sm" data-relink="${u.songId}">Relink</button><button class="btn sm danger" data-credit="${u.songId}">Technical credit…</button></div>`).join('')}${un.length > 4 ? `<div class="muted small">…and ${un.length - 4} more</div>` : ''}</div></div>` : '';
    $$('[data-relink]', el).forEach(b => b.onclick = () => App.relinkSong(b.dataset.relink));
    $$('[data-credit]', el).forEach(b => b.onclick = () => App.creditDialog(b.dataset.credit));
    $('#hgCredits', el).innerHTML = (g.credits || []).length ? g.credits.map(c => `<div class="hist-item"><div class="t"><b>${esc(c.title)}</b> <span>— ${esc(c.artist)}</span><div class="tiny muted">${esc(c.reason)} · ${new Date(c.at).toLocaleTimeString()}</div></div><span class="badge ${c.status === 'active' ? 'warn' : ''}">${c.status === 'active' ? 'COUNTS' : 'REVERSED'}</span>${c.status === 'active' ? `<button class="btn sm ghost" data-rev="${c.id}">Reverse</button>` : ''}</div>`).join('') : '<div class="muted small">None. Use this only when a video cannot be played — the song then counts on every card.</div>';
    $$('[data-rev]', el).forEach(b => b.onclick = () => App.reverseCredit(b.dataset.rev));
    $('#rPause', el).textContent = g.gamePaused ? 'Resume game' : 'Pause game';
    $('#rEnd', el).disabled = g.round.status !== 'active';
    const st = $('#hgStatus', el); st.className = 'statusline';
    if (g.lastError) { st.textContent = '⚠ ' + g.lastError; st.classList.add('err'); }
    else if (!g.audienceConnected) { st.textContent = '⚠ The audience window is closed — the TV will not play anything. Click “Open audience window”.'; st.classList.add('warn'); }
    else if (pb.pausedForClaim) { st.textContent = '⏸ Paused for a BINGO check — the position is saved. Press Play to resume.'; st.classList.add('warn'); }
    else if (g.gamePaused) { st.textContent = '⏸ Game paused.'; st.classList.add('warn'); }
    else if (pb.status === 'between') st.textContent = 'Next song starting…';
    else if (pb.status === 'finished') st.textContent = 'Every song has been played.';
    else st.textContent = g.round.number === 0 ? 'Press START ROUND 1 when the room is ready.' : '';
    this.drawRounds(); this.updateProgress(); this.drawWinners(); this.drawTab();
    if (cur && this.thumbFor !== cur.songId) { this.thumbFor = cur.songId; this.loadThumb(cur.songId); }
  },

  async loadThumb(songId) {
    const lib = await apiQuiet('library:list'); const s = lib.songs.find(x => x.id === songId);
    const img = $('#hgThumb', this.el); if (!img) return;
    if (s && s.thumb) { img.src = fileUrl(s.thumb); img.style.display = 'block'; } else img.style.display = 'none';
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

  drawRounds() {
    const g = App.game; const box = $('#rBtns', this.el);
    box.innerHTML = [1, 2, 3].map(n => {
      const active = g.round.number === n && g.round.status === 'active';
      const done = g.round.number > n || (g.round.number === n && g.round.status === 'ended');
      const can = n > g.round.number || (n === g.round.number && g.round.status !== 'active');
      return `<button class="round-btn ${active ? 'active' : ''} ${done ? 'done' : ''}" data-r="${n}" ${can && g.status !== 'finished' ? '' : 'disabled'}>${patternGridHtml(CMBPatterns.examples(n)[0])}<div><b>ROUND ${n}</b><span>${CMBPatterns.LABELS[n]}</span><div class="tiny muted">${active ? 'IN PLAY' : done ? 'Complete' : (can ? 'Click to start' : '')}</div></div></button>`;
    }).join('');
    $$('[data-r]', box).forEach(b => b.onclick = async () => {
      const n = Number(b.dataset.r);
      const msg = g.round.status === 'active' ? `This ends Round ${g.round.number} and starts Round ${n} — <b>${CMBPatterns.LABELS[n]}</b>. Songs already played stay marked.` : `Start Round ${n} — <b>${CMBPatterns.LABELS[n]}</b>? The TV will show the new winning pattern${n === 1 ? ' and the first song will start' : ''}.`;
      if (!await confirmBox(`Start Round ${n}?`, msg, `Start Round ${n}`)) return;
      if (n === 1 && !g.audienceConnected) await api('audience:open');
      const r = await App.cmd('startRound', { round: n }); if (r && r.warning) toast(r.warning, 'err');
    });
    $('#rRule', this.el).textContent = g.round.rule || 'Round 1: any full row or column. Round 2: two rows or two columns. Round 3: full house. Diagonals never count.';
  },

  drawWinners() {
    const g = App.game;
    $('#hgWinners', this.el).innerHTML = g.winners.length ? g.winners.map(w => `<div class="winner-row"><span class="cn">${w.cardLabel}</span><div class="grow"><b>Round ${w.round}</b><div class="small muted">${esc(w.headline)}</div></div><button class="btn sm ghost" data-undo="${w.claimId}" title="Undo">Undo</button></div>`).join('') : '<div class="muted small">No winners confirmed yet.</div>';
    $$('[data-undo]', this.el).forEach(b => b.onclick = async () => { if (await confirmBox('Undo this winner?', 'The card will no longer be listed as a winner. Use this only to correct a mistake.', 'Undo winner', true)) App.cmd('revokeWinner', { claimId: b.dataset.undo }); });
    const sLabel = { pending: ['VALID · awaiting', 'warn'], confirmed: ['WINNER', 'ok'], invalid: ['NOT VALID', 'bad'], rejected: ['REJECTED', 'bad'], dismissed: ['DISMISSED', ''], duplicate: ['ALREADY WON', 'warn'], revoked: ['UNDONE', ''] };
    $('#hgClaims', this.el).innerHTML = g.claims.length ? g.claims.slice(0, 12).map(c => `<div class="hist-item" style="cursor:pointer" data-card="${c.cardNo}"><span class="n">${c.cardLabel}</span><div class="t"><b>R${c.round}</b> <span>${esc(c.headline)}</span></div><span class="badge ${sLabel[c.status][1]}">${sLabel[c.status][0]}</span></div>`).join('') : '<div class="muted small">No claims checked yet.</div>';
    $$('[data-card]', this.el).forEach(r => r.onclick = () => App.openChecker(r.dataset.card));
  },

  drawTab() {
    const g = App.game; const box = $('#hgTab', this.el); if (!box) return;
    if (this.tab === 'crawler' && box.contains(document.activeElement) && this._drawnTab === 'crawler') return; // don't rebuild under the host's finger
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
      box.innerHTML = `<div class="muted small" style="margin-bottom:8px">Shuffled order, saved before the game started. Host only — never shown on the TV.</div><div class="hist-list">${g.order.map(o => `<div class="hist-item ${o.index === g.playback.index ? 'current' : ''} ${o.playedNo ? 'done' : ''} ${o.skipped ? 'skipped' : ''}"><span class="n">${o.index + 1}</span><div class="t"><b>${esc(o.title)}</b> <span>— ${esc(o.artist)}</span></div>${o.playedNo ? `<span class="badge ${o.credit ? 'warn' : 'ok'}">${o.credit ? 'TC ' : '#'}${o.playedNo}</span>` : (o.unavailable ? '<span class="badge bad">unavailable</span>' : (o.skipped ? '<span class="badge warn">skipped</span>' : ''))}<button class="btn sm ghost" data-play="${o.index}" title="Play now">▶</button>${o.playedNo ? '' : `<button class="btn sm ghost" data-mk="${o.songId}" title="Mark as played">✓</button>`}</div>`).join('')}</div>`;
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
        <label class="field">Show for (0 = whole song): ${o.duration}s<input type="range" min="0" max="60" step="5" value="${o.duration}" data-o="duration"></label></div>
        <div class="row" style="margin-top:12px">${toggleHtml('ovOn', 'Show title & artist on TV', o.enabled)}</div>
        <h2 style="margin-top:18px">TV winner &amp; wrong-claim screens</h2>
        <div class="row" style="gap:22px">${toggleHtml('tvW', 'Winner screen when a winner is confirmed', g.settings.tvScreens.winner)}${toggleHtml('tvR', '“Not a Bingo” screen when a claim is rejected', g.settings.tvScreens.wrongClaim)}${toggleHtml('tvC', 'Show the card number on the TV', g.settings.tvScreens.showCardNumber)}</div>
        <label class="field" style="max-width:260px;margin-top:10px">Show for ${g.settings.tvScreens.seconds} seconds<input type="range" min="3" max="20" value="${g.settings.tvScreens.seconds}" id="tvS"></label>`;
      $('#tvW', box).onchange = (e) => App.cmd('setTvScreens', { winner: e.target.checked });
      $('#tvR', box).onchange = (e) => App.cmd('setTvScreens', { wrongClaim: e.target.checked });
      $('#tvC', box).onchange = (e) => App.cmd('setTvScreens', { showCardNumber: e.target.checked });
      $('#tvS', box).onchange = (e) => App.cmd('setTvScreens', { seconds: Number(e.target.value) });
      $$('[data-c]', box).forEach(i => i.onchange = () => App.cmd('setCrawler', { [i.dataset.c]: i.tagName === 'SELECT' ? i.value : Number(i.value) }));
      $$('[data-o]', box).forEach(i => i.onchange = () => App.cmd('setOverlay', { [i.dataset.o]: i.tagName === 'SELECT' ? i.value : (i.dataset.o === 'opacity' ? Number(i.value) / 100 : Number(i.value)) }));
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
