/* Anthem Square — desktop host shell: navigation, helpers, live state. */
(function () {
  'use strict';
  const views = {};
  const App = {
    views,
    view: null,
    game: null,         // latest host state from the engine
    remote: null,       // remote-service info
    settings: null,
    audience: { open: false },
    register(name, v) { views[name] = v; },

    async start() {
      this.settings = await api('settings:get');
      this.info = await api('app:info');
      this.applyAppearance();
      document.querySelectorAll('#nav a').forEach(a => a.addEventListener('click', () => this.show(a.dataset.view)));
      const st = await api('game:state'); this.game = st.game;
      window.cmb.on('state', (s) => { this.game = s.game; this.updateSide(); this.emit('state'); if (this._askingNext && this._askRound && (!this.game || this.game.round.number !== this._askRound || this.game.round.status === 'ready' || this.game.intermission || this.game.status === 'finished') && this._askClose) this._askClose(); if (this._askingNext && !this._askRound && this._askClose && (!this.game || this.game.status === 'finished' || (this.game.checklist && (this.game.checklist.closed || !this.game.checklist.allDone)))) this._askClose(); });
      window.cmb.on('tick', (t) => { if (this.game) { this.game.playback.position = t.position; } this.emit('tick', t); });
      window.cmb.on('remote', (r) => { this.remote = r; this.updateSide(); this.emit('remote'); });
      window.cmb.on('audience', (a) => { this.audience.open = a.open; this.updateSide(); this.emit('audience'); });
      window.cmb.on('update', (u) => { this.update = u; this.drawUpdatePill(); if (this.drawUpdateSettings && this.view === 'settings') this.drawUpdateSettings(u); });
      this.update = await api('update:status'); this.drawUpdatePill();
      window.cmb.on('library-convert', (c) => { this.convert = c; this.emit('convert', c); });
      // loudness progress: redraw the library at most every 1.5 s (not once per analysed song)
      let audT = null; window.cmb.on('library-audio', (a) => { if (App.view === 'library' && views.library) { views.library.audio = a; views.library.drawAudio(); clearTimeout(audT); audT = setTimeout(() => { if (App.view === 'library') views.library.on_library(); }, 1500); } });
      window.cmb.on('backup-progress', (p) => this.emit('backup', p));
      window.cmb.on('autobackup', (p) => this.emit('autobackup', p));
      window.cmb.on('rehearsal-progress', (p) => this.emit('rehearsalProgress', p));
      window.cmb.on('cards-images', (p) => this.emit('cardsImages', p));
      window.cmb.on('players', (p) => { this.players = p; this.emit('players', p); });
      window.cmb.on('event', (e) => {
        if (e.name === 'error') toast(e.payload.message, 'err', 7000);
        if (e.name === 'playerBingo') {
          const p = e.payload;
          if (p.valid) {
            toast(`📱 ${p.name} (card ${p.cardLabel}) called BINGO — it looks valid! Claims are frozen for you to confirm.`, 'ok', 9000);
            if (!document.querySelector('#modalRoot .modal-back') && App.openChecker) App.openChecker();
          } else toast(`📱 ${p.name} (card ${p.cardLabel}) pressed BINGO — not a bingo yet (only their phone was told).`, '', 5000);
        }
        this.emit('event', e);
      });
      this.remote = await api('remote:info');
      this.audience = await api('audience:status');
      this.updateSide();
      this.bindKeys();
      const ob = (this.info && this.info.onboarding) || {};
      const ns = document.getElementById('navStart'); if (ns) ns.hidden = !ob.autoOpen;
      if (!this.view) this.show(this.game ? 'host' : (ob.autoOpen ? 'start' : 'dashboard')); // don't override a screen the host already opened during start-up
      // media probing now happens in a separate, recycled window (main process drives it)
      let libT = null; window.cmb.on('library-probed', () => { clearTimeout(libT); libT = setTimeout(() => this.emit('library'), 400); });
    },

    /** After a round has a winner (claim session closed): intermission or next round? */
    async whatNext(p) {
      if (p && p.checklistDone) return this.checklistDone(p);
      if (this._askingNext) return; this._askingNext = true; this._askRound = p.round;
      try {
        const body = document.createElement('div');
        body.innerHTML = p.final
          ? `<p>Round ${p.round} has ${p.winners} winner${p.winners > 1 ? 's' : ''}. That was the <b style="color:#fff">last round</b>.</p>`
          : `<p>Round ${p.round} has ${p.winners} winner${p.winners > 1 ? 's' : ''}. What's next?</p>
             <div class="row" style="gap:10px;align-items:center"><span class="muted small">Intermission length</span><select id="wnMin">${[5, 10, 15, 20, 30, 0].map(m => `<option value="${m}" ${m === (p.minutes || 10) ? 'selected' : ''}>${m ? m + ' minutes' : 'no countdown'}</option>`).join('')}</select></div>
             <label class="field" style="margin-top:10px">Message on the TV (optional)<input type="text" id="wnMsg" maxlength="140" placeholder="e.g. Grab a drink — Round ${p.nextRound} starts soon!"></label>`;
        const buttons = p.final
          ? [{ label: 'Not yet', value: null }, { label: '🏁 Finish the game', kind: 'primary', value: 'finish' }]
          : [{ label: 'Not yet — keep checking', value: null }, { label: '☕ Intermission', value: (b) => ({ go: 'break', minutes: Number(b.querySelector('#wnMin').value), message: b.querySelector('#wnMsg').value.trim() }) }, { label: `▶ Start Round ${p.nextRound}${p.nextLabel ? ' — ' + p.nextLabel : ''}`, kind: 'primary', value: 'next' }];
        const r = await modal({ title: `🏆 Round ${p.round} won!`, body, buttons, dismissValue: null, onMount: (b, close) => { this._askClose = () => close(null); } });
        if (!r) return;
        if (r === 'finish') { await this.cmd('completeRound', { fromRound: p.round }); return; }
        if (r === 'next') { const x = await this.cmd('completeRound', { fromRound: p.round }); if (x && x.ok !== false) await this.cmd('startRound', { round: p.nextRound }); return; }
        if (r.go === 'break') { const x = await this.cmd('startIntermission', { minutes: r.minutes, message: r.message }); if (x && x.ok) toast('Intermission — the TV shows the break screen', 'ok'); }
      } finally { this._askingNext = false; this._askClose = null; this._askRound = null; }
    },

    /** Rules Checklist: every rule has a confirmed winner. */
    async checklistDone(p) {
      if (this._askingNext) return; this._askingNext = true;
      try {
        const r = await modal({ title: '🏆 ALL BINGO RULES COMPLETED', body: `<p>All ${p.total} winning rules have a confirmed winner. What would you like to do?</p>`,
          buttons: [{ label: '▶ Continue music without more Bingo claims', value: 'music' }, { label: '🏆 View winners', value: 'view' }, { label: '🏁 Finish game', kind: 'primary', value: 'finish' }], dismissValue: null,
          onMount: (b, close) => { this._askClose = () => close(null); } });
        if (r === 'finish') { await this.cmd('endGame'); toast('Game finished — that\'s a wrap!', 'ok'); }
        else if (r === 'view') this.viewWinners();
        else if (r === 'music') { await this.cmd('closeChecklist', { closed: true }); toast('Claims closed — the music keeps playing', 'ok'); }
      } finally { this._askingNext = false; this._askClose = null; }
    },
    viewWinners() {
      const g = this.game; if (!g || !g.checklist) return;
      const body = `<div class="ck-winners">${g.checklist.items.map(i => `<div class="ck-wrow"><div class="ck-pat">${patternGridHtml(i.example)}</div><div class="grow"><b>${esc(i.label)}</b><div class="small">${i.winners.length ? i.winners.map(w => `Card <b>${w.cardLabel}</b>${w.owner ? ' · ' + esc(w.owner) : ''} <span class="muted tiny">${new Date(w.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`).join('<br>') : '<span class="muted">Not won</span>'}</div></div>${i.winners.length ? '<span class="badge ok">✓</span>' : ''}</div>`).join('')}</div>`;
      modal({ title: `Winners — ${g.checklist.completed} of ${g.checklist.total} rules`, size: 'mid', body, buttons: [{ label: 'Close', kind: 'primary', value: true }] });
    },
    /** Correct a confirmed checklist award: move it to another rule the card completed, or undo it. */
    async correctAward(claimId) {
      const g = this.game; const w = g.winners.find(x => x.claimId === claimId); if (!w) return;
      const v = await this.cmd('viewClaim', { claimId }); if (!v || v.ok === false) return;
      const alts = (v.checklist && v.checklist.qualifying || []).filter(q => q.itemId !== w.itemId);
      const body = `<p>Card <b>${w.cardLabel}</b>${w.owner ? ' (' + esc(w.owner) + ')' : ''} was awarded <b>${esc(w.rule)}</b>.</p>
        ${alts.length ? `<label class="field">Award a different rule instead<select id="caTo"><option value="">— keep ${esc(w.rule)} —</option>${alts.map(a => `<option value="${a.itemId}">${esc(a.label)}</option>`).join('')}</select></label>` : '<p class="muted small">This card did not complete any other open rule when it was checked.</p>'}
        <label class="field">Reason (kept in the audit log)<input type="text" id="caWhy" maxlength="200" placeholder="e.g. wrong card number entered"></label>`;
      const r = await modal({ title: 'Correct an award', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Undo this award', kind: 'danger', value: (b) => ({ undo: true, reason: b.querySelector('#caWhy').value.trim() }) }].concat(alts.length ? [{ label: 'Change rule', kind: 'primary', value: (b) => ({ to: b.querySelector('#caTo').value, reason: b.querySelector('#caWhy').value.trim() }) }] : []) });
      if (!r) return;
      if (r.undo) { if (await confirmBox('Undo this award?', `${esc(w.rule)} becomes available again (unless another card also won it in the same claim session). The change is kept in the audit log.`, 'Undo award', true)) { const x = await this.cmd('revokeWinner', { claimId, reason: r.reason }); if (x && x.ok) toast('Award undone', 'ok'); } return; }
      if (!r.to) return;
      const to = alts.find(a => a.itemId === r.to);
      if (await confirmBox('Change the awarded rule?', `Card ${w.cardLabel}: <b>${esc(w.rule)}</b> → <b>${esc(to.label)}</b>. ${esc(w.rule)} becomes available again.`, 'Change rule')) { const x = await this.cmd('changeAward', { claimId, itemId: r.to, reason: r.reason }); if (x && x.ok) toast('Award corrected', 'ok'); }
    },

    listeners: {},
    onEvt(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    emit(name, data) { (this.listeners[name] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); if (this.view && views[this.view] && views[this.view]['on_' + name]) views[this.view]['on_' + name](data); },

    show(name, arg) {
      if (this.view && views[this.view] && views[this.view].leave) views[this.view].leave();
      this.view = name;
      document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
      const main = document.getElementById('main');
      main.innerHTML = '';
      main.scrollTop = 0;
      Promise.resolve(views[name].render(main, arg)).catch(e => { console.error(e); main.innerHTML = `<div class="panel">${esc(e.message)}</div>`; });
    },

    refresh() { if (this.view) this.show(this.view); },

    applyAppearance() {
      const a = this.settings.appearance;
      document.documentElement.classList.toggle('low-res', !!(this.settings.performance && this.settings.performance.lowResource));
      document.documentElement.style.setProperty('--ui-scale', a.scale || 1);
      document.documentElement.setAttribute('data-theme', a.theme === 'light' ? 'light' : 'dark');
      const img = document.getElementById('sideLogo');
      if (a.logo) { img.src = fileUrl(a.logo) + '?v=' + Date.now(); img.classList.add('has'); } else { img.removeAttribute('src'); img.classList.remove('has'); }
    },

    updateSide() {
      const aud = this.game ? this.game.audienceConnected : this.audience.open;
      $('#ssAud').className = 'dot' + (aud ? ' on' : '');
      $('#ssAudTxt').textContent = aud ? 'Audience window open' : 'Audience window closed';
      const n = this.remote && this.remote.connected ? this.remote.connected.length : 0;
      $('#ssPhone').className = 'dot' + (n ? ' on' : (this.remote && this.remote.running ? ' warn' : ''));
      $('#ssPhoneTxt').textContent = n ? `${n} phone${n > 1 ? 's' : ''} connected` : (this.remote && this.remote.running ? 'Remote ready — no phone' : 'Remote service off');
      $('#ssGame').textContent = this.game ? `${this.game.name} · ${this.game.status === 'live' ? 'LIVE' : this.game.status.toUpperCase()}` : 'No game loaded';
      document.querySelector('#nav a.hostlink').classList.toggle('live', !!(this.game && this.game.status === 'live'));
    },

    async cmd(action, args = {}) {
      try {
        const r = await window.cmb.invoke('game:cmd', { action, args });
        return r;
      } catch (e) { toast(cleanErr(e), 'err'); return { ok: false, error: cleanErr(e) }; }
    },

    /* Next with skip confirmation (shared by button + Right arrow) */
    async next() {
      if (!this.game) return;
      const r = await this.cmd('next', { expectIndex: this.game.playback.index });
      if (r && r.needsConfirm) {
        const choice = await modal({
          title: 'Skip this song?',
          body: `<p>${esc(r.message)}</p><p class="muted small">Skipped songs are <b>not</b> added to the played list or the crawler, and won't count on anyone's card. They come back at the end of the playlist.</p>`,
          buttons: [{ label: 'Cancel', value: null }, { label: 'Mark as played & next', value: 'markPlayed' }, { label: 'Skip (don\'t count)', value: 'skip', kind: 'primary' }]
        });
        if (choice) await this.cmd('next', { mode: choice, expectIndex: this.game.playback.index });
      } else if (r && r.finished) toast(r.message, 'ok');
    },

    /** Technical credit — explicit, host-authorised exception. */
    async creditDialog(songId) {
      const g = this.game; if (!g) return;
      if (!g.round.number) return toast('Start Round 1 first', 'err');
      const counted = new Set(g.history.map(h => h.songId));
      const options = g.order.filter(o => !counted.has(o.songId));
      const body = document.createElement('div');
      body.innerHTML = `<p>Use this only when a song's video <b>cannot be played</b> (moved, disconnected drive, corrupted, unsupported codec, or failed during the event). The song will count on <b>every card</b> that has it. No replacement song is played. This is recorded in the audit log.</p>
        <div class="form-grid"><label class="field">Song<select id="tcSong">${options.map(o => `<option value="${o.songId}" ${o.songId === songId ? 'selected' : ''}>${esc(o.title)} — ${esc(o.artist)}${o.unavailable ? ' ⚠' : ''}</option>`).join('')}</select></label>
        <label class="field">Reason<select id="tcReason">${g.creditReasons.map(r => `<option>${esc(r)}</option>`).join('')}</select></label></div>
        <label class="field" style="margin-top:10px">Notes (optional)<input type="text" id="tcNote" placeholder="e.g. USB drive failed"></label>
        <div class="verdict dup" style="margin-top:14px"><div><div class="vt" style="font-size:22px">TECHNICAL CREDIT — COUNT SONG FOR ALL CARDS</div><div class="small muted">The TV crawler will show it as “TECHNICAL CREDIT — Title / Artist”, never as a played video.</div></div></div>`;
      const r = await modal({ title: 'Technical credit', size: 'mid', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Confirm technical credit', kind: 'primary', value: (b) => ({ songId: b.querySelector('#tcSong').value, reason: b.querySelector('#tcReason').value + (b.querySelector('#tcNote').value ? ' — ' + b.querySelector('#tcNote').value : '') }) }] });
      if (!r) return;
      const x = await this.cmd('grantCredit', Object.assign(r, { confirm: true }));
      if (x && x.ok) toast('Technical credit recorded — the song now counts on every card', 'ok', 5000);
    },
    async reverseCredit(creditId) {
      const reason = await promptBox('Reverse technical credit', 'Why is this credit being reversed? (kept in the audit log)');
      if (reason == null) return;
      let r = await this.cmd('reverseCredit', { creditId, reason });
      if (r && r.needsCorrection) {
        if (!await confirmBox('Correction affects results', esc(r.message), 'Reverse anyway', true)) return;
        r = await this.cmd('reverseCredit', { creditId, reason, acknowledge: true });
      }
      if (r && r.ok) toast('Credit reversed (audit record kept)', 'ok');
    },
    drawUpdatePill() {
      let pill = document.getElementById('updPill');
      const u = this.update || {};
      const show = ['available', 'downloading', 'downloaded', 'portable-available'].includes(u.state);
      if (!show) { if (pill) pill.remove(); return; }
      if (!pill) { pill = document.createElement('button'); pill.id = 'updPill'; pill.className = 'btn sm primary'; pill.style.cssText = 'margin:0 18px 12px;'; document.getElementById('sideStatus').before(pill); pill.onclick = () => this.updateAction(); }
      pill.textContent = u.state === 'downloaded' ? `⟳ Restart to finish updating` : u.state === 'downloading' ? `⬇ Updating… ${u.percent || 0}%` : `⬆ Update to ${u.version}`;
      if (this._updDraw) this._updDraw(u);
    },
    /** Click-to-update: Update → download with progress → Restart now / Later. */
    async updateAction() {
      const u0 = this.update || {};
      if (u0.state === 'portable-available') { if (await confirmBox(`Anthem Square ${esc(u0.version)} is available`, 'This copy can’t update itself here (its folder can’t be written to). Open the download page to get the new version?', 'Open download page')) api('update:openPage'); return; }
      if (this._updOpen) return; this._updOpen = true;
      const body = document.createElement('div');
      let close = null;
      const draw = (u) => {
        const mb = (n) => (n / 1048576).toFixed(0) + ' MB';
        if (u.state === 'available') body.innerHTML = `<p><b>Anthem Square ${esc(u.version)}</b> is ready to download${u.size ? ` (${mb(u.size)})` : ''}. You're on ${esc(u.current || '')}.</p>${u.error ? `<p class="small" style="color:var(--amber)">${esc(u.error)}</p>` : ''}<p class="muted small">Your library, playlists, games and settings stay exactly as they are. <a href="#" id="updNotes">What's new</a></p><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="updLater">Later</button><button class="btn primary" id="updGo">⬇ Update now</button></div>`;
        else if (u.state === 'downloading') body.innerHTML = `<p>Downloading <b>Anthem Square ${esc(u.version || '')}</b>…</p><div class="progress" style="height:14px"><div class="fill" style="width:${u.percent || 0}%"></div></div><div class="row" style="margin-top:8px"><span class="muted small grow">${u.percent || 0}%${u.size ? ' of ' + mb(u.size) : ''} — you can keep using the app.</span><button class="btn sm" id="updHide">Hide</button></div>`;
        else if (u.state === 'downloaded') body.innerHTML = `<p>✓ <b>Anthem Square ${esc(u.version || '')}</b> is downloaded and ready.</p><p class="muted small">Restarting takes a few seconds. A game in progress is saved and resumes where it was (paused); phones reconnect by themselves.${u.mode === 'installer' ? ' If you choose Later, it installs the next time you close the app.' : ' If you choose Later, it is applied the next time you close the app.'}</p><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="updLater">Later</button><button class="btn primary" id="updRestart">⟳ Restart now</button></div>`;
        else if (u.state === 'error') body.innerHTML = `<p style="color:var(--amber)">${esc(u.error || 'The update did not work.')}</p><div class="row" style="justify-content:flex-end"><button class="btn" id="updLater">Close</button><button class="btn" id="updPage">Open download page</button></div>`;
        const on = (id, fn) => { const b = body.querySelector('#' + id); if (b) b.onclick = fn; };
        on('updLater', () => close && close(null)); on('updHide', () => close && close(null));
        on('updNotes', (e) => { e.preventDefault(); api('update:openPage'); });
        on('updPage', () => api('update:openPage'));
        on('updGo', async () => { this.update = await api('update:download'); this.drawUpdatePill(); });
        on('updRestart', async () => {
          try { await window.cmb.invoke('update:install', {}); }
          catch (e) {
            if (/playing/i.test(cleanErr(e))) { if (await confirmBox('A song is playing', esc(cleanErr(e)), 'Restart anyway', true)) await window.cmb.invoke('update:install', { force: true }); }
            else toast(cleanErr(e), 'err');
          }
        });
      };
      this._updDraw = draw;
      try { await modal({ title: '⬆ App update', body, onMount: (b, c) => { close = c; draw(this.update || u0); }, buttons: [] }); }
      finally { this._updOpen = false; this._updDraw = null; }
    },
    /** Complete the current round (transition) — pending claims must be resolved first. */
    async completeRound() {
      const g = this.game; if (!g) return; const R = g.round;
      const final = R.number >= (App.game.roundCount || 3);
      const msg = (R.winners ? `Round ${R.number} has ${R.winners} confirmed winner${R.winners > 1 ? 's' : ''}.` : `<b style="color:var(--amber)">No winner has been confirmed in Round ${R.number}.</b>`) +
        (final ? ' This ends the game with the “That\'s a wrap!” screen.' : ` The TV shows the round transition and the <b>${esc(App.game.roundRules ? App.game.roundRules[R.number + 1].label : CMBPatterns.LABELS[R.number + 1])}</b> pattern. Music stays paused until you start Round ${R.number + 1}. All marks are kept.`);
      if (!await confirmBox(final ? 'Complete the game?' : `Complete Round ${R.number}?`, msg, final ? 'Complete Game' : 'Complete Round & Continue')) return;
      const r = await this.cmd('completeRound', { fromRound: R.number });
      if (r && r.needsDecision) { toast(r.message, 'err', 6000); this.openChecker(); return; }
      if (r && r.ok && !r.already) toast(final ? 'Game complete — that\'s a wrap!' : `Round ${R.number} complete. Round ${R.number + 1} is ready.`, 'ok', 5000);
    },
    /** Pick any unplayed song for Up Next. */
    async pickNextSong() {
      const g = this.game; if (!g) return;
      const played = new Set(g.history.map(h => h.songId)); const cur = g.current && g.current.songId;
      const list = g.order.filter(o => !played.has(o.songId) && o.songId !== cur);
      const body = document.createElement('div');
      body.innerHTML = `<input type="search" id="pkQ" placeholder="Search title or artist…" style="width:100%;margin-bottom:10px"><div class="hist-list" id="pkL" style="max-height:55vh"></div><p class="muted tiny">Previewing a song never plays or counts it. Skipped songs stay available.</p>`;
      const draw = () => { const q = body.querySelector('#pkQ').value.toLowerCase(); body.querySelector('#pkL').innerHTML = list.filter(o => !q || (o.title + ' ' + o.artist).toLowerCase().includes(q)).map(o => `<div class="hist-item"><span class="n">${o.index + 1}</span><div class="t"><b>${esc(o.title)}</b> <span>— ${esc(o.artist)}</span>${o.unavailable ? ' <span class="badge bad">unavailable</span>' : ''}</div><button class="btn sm primary" data-next="${o.songId}">Play next</button><button class="btn sm" data-end="${o.songId}">Add to queue</button></div>`).join('') || '<div class="muted small">No songs found.</div>';
        $$('[data-next]', body).forEach(b => b.onclick = async () => { await this.cmd('queueSong', { songId: b.dataset.next }); closeTopModal(); toast('Queued to play next', 'ok'); });
        $$('[data-end]', body).forEach(b => b.onclick = async () => { await this.cmd('queueSong', { songId: b.dataset.end, position: 'end' }); toast('Added to the queue', 'ok'); }); };
      body.querySelector('#pkQ').oninput = draw; draw();
      await modal({ title: 'Choose the next song', size: 'mid', body, buttons: [{ label: 'Close', value: null }] });
    },
    async relinkSong(songId) {
      const g = this.game; if (!g) return;
      let r = await api('games:relinkSong', { id: g.gameId, songId });
      if (r && r.needsConfirm) {
        if (!await confirmBox('Different file', esc(r.reason) + '<br><br>The printed song identity and card layouts will not change.', 'Use this file', true)) return;
        r = await api('games:relinkSong', { id: g.gameId, songId, file: r.file, confirm: true });
      }
      if (r && r.ok) toast('Video relinked', 'ok');
    },

    bindKeys() {
      document.addEventListener('keydown', (e) => {
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (e.key === 'Escape') { if (closeTopModal()) { e.preventDefault(); return; } return; }
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.querySelector('.modal-back') && e.key !== 'Escape') return;
        if (!this.game) return;
        if (e.code === 'Space') { e.preventDefault(); this.cmd('togglePlay'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); this.cmd('replay', { expectIndex: this.game.playback.index }); }
        else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); App.openChecker(); }
        else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); api('audience:fullscreen'); }
        else if ((e.key === 'q' || e.key === 'Q') && this.game.night && this.game.status !== 'finished') { e.preventDefault(); this.cmd(this.game.night.phase === 'quiz' ? 'startBreak' : 'returnToQuiz'); }
      });
    },

    /* Background media probing: duration, video track check and thumbnail */
    async startProbeQueue() {
      this.probing = false;
      setInterval(() => this.probeNext(), 400);
    },
    async probeNext() {
      if (this.probing) return;
      this.probing = true;
      try {
        const s = await window.cmb.invoke('library:nextUnchecked');
        if (s) {
          const result = await probeVideo(s.path);
          await window.cmb.invoke('library:probeResult', { id: s.id, result });
          this.emit('library');
        }
      } catch (e) { console.error(e); }
      this.probing = false;
    }
  };

  function probeVideo(path) {
    return new Promise((resolve) => {
      const v = document.getElementById('probeVideo');
      const c = document.getElementById('probeCanvas');
      let done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(to); v.onloadedmetadata = v.onseeked = v.onerror = null; v.removeAttribute('src'); try { v.load(); } catch (e) { /* */ } resolve(r); };
      const to = setTimeout(() => finish({ error: 'Timed out reading the video (file may be corrupted or on a slow drive).' }), 20000);
      v.onerror = () => { const code = v.error ? v.error.code : 0; finish({ error: code === 4 ? 'Format or codec not supported — use MP4 (H.264 video, AAC audio).' : code === 3 ? 'Video is corrupted and cannot be decoded.' : 'File could not be opened.' }); };
      v.onloadedmetadata = () => {
        const meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
        if (!isFinite(v.duration) || v.duration <= 0) return finish({ error: 'Could not read the video duration (file may be corrupted).' });
        if (!v.videoWidth) return finish(meta);
        v.onseeked = () => {
          try { const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, 320, 180); meta.thumb = c.toDataURL('image/jpeg', 0.72); } catch (e) { /* no thumb */ }
          finish(meta);
        };
        try { v.currentTime = Math.min(v.duration * 0.15, 20); } catch (e) { finish(meta); }
      };
      v.src = fileUrl(path);
    });
  }

  /* ---------------------------------------------------------------- helpers */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function cleanErr(e) { return String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  async function api(ch, payload) {
    try { return await window.cmb.invoke(ch, payload); }
    catch (e) { toast(cleanErr(e), 'err', 6000); throw e; }
  }
  async function apiQuiet(ch, payload) { return window.cmb.invoke(ch, payload); }
  function fileUrl(p) {
    if (!p) return '';
    let s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + s.split('/').map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg)).join('/');
  }
  function fmtTime(t) { t = Math.max(0, Math.floor(Number(t) || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function toast(msg, type = '', ms = 3500) {
    const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  const modalStack = [];
  function modal({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], size = '', onMount, dismissValue = null }) {
    return new Promise((resolve) => {
      const back = document.createElement('div'); back.className = 'modal-back';
      back.innerHTML = `<div class="modal ${size}"><div class="modal-head"><h2>${esc(title)}</h2><button class="x" aria-label="Close">×</button></div><div class="modal-body"></div><div class="modal-foot"></div></div>`;
      const bodyEl = back.querySelector('.modal-body');
      if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
      const foot = back.querySelector('.modal-foot');
      const close = (v) => { const i = modalStack.indexOf(entry); if (i >= 0) modalStack.splice(i, 1); back.remove(); resolve(v); };
      const entry = { close: () => close(dismissValue), back };
      buttons.forEach(b => { const btn = document.createElement('button'); btn.className = 'btn ' + (b.kind || ''); btn.textContent = b.label; btn.onclick = () => { if (b.onClick) { const r = b.onClick(back); if (r === false) return; } close(typeof b.value === 'function' ? b.value(back) : b.value); }; foot.appendChild(btn); });
      if (!buttons.length) foot.remove();
      back.querySelector('.x').onclick = () => close(dismissValue);
      back.addEventListener('mousedown', (e) => { if (e.target === back) close(dismissValue); });
      modalStack.push(entry);
      document.getElementById('modalRoot').appendChild(back);
      if (onMount) onMount(back, close);
      const f = back.querySelector('input, select, textarea'); if (f) setTimeout(() => f.focus(), 30);
    });
  }
  function closeTopModal() { const m = modalStack[modalStack.length - 1]; if (m) { m.close(); return true; } return false; }
  async function confirmBox(title, message, okLabel = 'Confirm', danger = false) {
    return modal({ title, body: `<p>${message}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }], dismissValue: false });
  }
  async function promptBox(title, label, value = '') {
    return modal({ title, body: `<label class="field">${esc(label)}<input type="text" id="pb" value="${esc(value)}"></label>`, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', kind: 'primary', value: (b) => b.querySelector('#pb').value }], onMount: (b, close) => { b.querySelector('#pb').addEventListener('keydown', e => { if (e.key === 'Enter') close(b.querySelector('#pb').value); }); } });
  }
  function toggleHtml(id, label, checked) { return `<label class="toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="sw"></span>${esc(label)}</label>`; }
  function patternGridHtml(cells, cls = 'pink') { return `<div class="pgrid ${cls}">${cells.map(c => `<i class="${c ? 'on' : ''}"></i>`).join('')}</div>`; }

  /** Show a saved file in File Explorer (clear message if it was moved or its drive is gone). */
  async function showInFolder(p) { const r = await api('shell:showItem', p); if (r && r.ok === false) toast(r.message || 'Could not open the folder', 'err', 6000); return r; }
  Object.assign(window, { showInFolder, closeTopModal, App, $, $$, esc, api, apiQuiet, fileUrl, fmtTime, pad3, toast, modal, confirmBox, promptBox, toggleHtml, cleanErr, patternGridHtml, probeVideo });
})();
