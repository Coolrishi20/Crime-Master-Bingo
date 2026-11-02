/* Crime Master Bingo — desktop host shell: navigation, helpers, live state. */
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
      window.cmb.on('state', (s) => { this.game = s.game; this.updateSide(); this.emit('state'); });
      window.cmb.on('tick', (t) => { if (this.game) { this.game.playback.position = t.position; } this.emit('tick', t); });
      window.cmb.on('remote', (r) => { this.remote = r; this.updateSide(); this.emit('remote'); });
      window.cmb.on('audience', (a) => { this.audience.open = a.open; this.updateSide(); this.emit('audience'); });
      window.cmb.on('library-audio', (a) => { if (App.view === 'library' && views.library) { views.library.audio = a; views.library.drawAudio(); views.library.on_library(); } });
      window.cmb.on('backup-progress', (p) => this.emit('backup', p));
      window.cmb.on('event', (e) => { if (e.name === 'error') toast(e.payload.message, 'err', 7000); this.emit('event', e); });
      this.remote = await api('remote:info');
      this.audience = await api('audience:status');
      this.updateSide();
      this.bindKeys();
      this.show(this.game ? 'host' : 'dashboard');
      this.startProbeQueue();
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
      document.documentElement.style.setProperty('--ui-scale', a.scale || 1);
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
    /** Complete the current round (transition) — pending claims must be resolved first. */
    async completeRound() {
      const g = this.game; if (!g) return; const R = g.round;
      const final = R.number === 3;
      const msg = (R.winners ? `Round ${R.number} has ${R.winners} confirmed winner${R.winners > 1 ? 's' : ''}.` : `<b style="color:var(--amber)">No winner has been confirmed in Round ${R.number}.</b>`) +
        (final ? ' This ends the game with the “That\'s a wrap!” screen.' : ` The TV shows the round transition and the <b>${esc(CMBPatterns.LABELS[R.number + 1])}</b> pattern. Music stays paused until you start Round ${R.number + 1}. All marks are kept.`);
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

  Object.assign(window, { closeTopModal, App, $, $$, esc, api, apiQuiet, fileUrl, fmtTime, pad3, toast, modal, confirmBox, promptBox, toggleHtml, cleanErr, patternGridHtml, probeVideo });
})();
