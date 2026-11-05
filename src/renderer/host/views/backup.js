App.register('backup', {
  async render(el) {
    this.el = el;
    const games = await api('games:list');
    this.games = games;
    if (!this.gameId || !games.find(g => g.id === this.gameId)) this.gameId = App.game ? App.game.gameId : (games[0] && games[0].id);
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Portable games</div><h1>Backup &amp; Restore</h1><p>Move a complete game — cards, progress, winners — to another laptop, or keep a safe copy.</p></div></div>
      <div class="cols c2">
        <div class="panel" id="bkBox"></div>
        <div class="panel" id="rsBox"></div>
      </div>
      <div class="panel" id="rlBox" style="margin-top:18px"></div>`;
    this.drawBackup(); this.drawRestore(); this.drawRelink();
  },
  on_backup(p) {
    const bar = $('#bkProg', this.el) || $('#rsProg', this.el); if (!bar) return;
    if (p.phase === 'media' && p.total) bar.innerHTML = `<div class="progress" style="margin:8px 0"><div class="fill" style="width:${Math.round(p.done / p.total * 100)}%"></div></div><div class="muted tiny">${Math.round(p.done / 1048576)} / ${Math.round(p.total / 1048576)} MB · ${esc(p.file || '')}</div>`;
    else if (p.phase === 'encrypt') bar.innerHTML = '<div class="muted small">Encrypting…</div>';
  },
  async drawBackup() {
    const box = $('#bkBox', this.el); const games = this.games;
    if (!games.length) { box.innerHTML = '<h2>Create a backup</h2><div class="empty">No games yet.</div>'; return; }
    box.innerHTML = `<h2>Create a backup</h2>
      <label class="field">Game<select id="bkGame">${games.map(g => `<option value="${g.id}" ${g.id === this.gameId ? 'selected' : ''}>${esc(g.name)} · ${esc(g.date)} (${g.cards} cards${g.cardsLocked ? ', locked' : ''})</option>`).join('')}</select></label>
      <div class="field" style="margin-top:14px"><span class="muted small" style="font-weight:700">Backup type</span>
        <label class="check-row" style="cursor:pointer"><input type="radio" name="bkType" value="game" checked><div><b>Game backup</b><div class="muted small">Everything about the game: cards & exact 5×5 layouts, playlist snapshot, played songs, technical credits, claim sessions, winners and progress. Videos are not included — relink them after restoring.</div></div></label>
        <label class="check-row" style="cursor:pointer"><input type="radio" name="bkType" value="full"><div><b>Full portable backup</b><div class="muted small">Also copies the game's music video files, so another laptop needs nothing else. Only include videos you are allowed to copy.</div></div></label></div>
      <div class="row" style="margin-top:8px">${toggleHtml('bkEnc', 'Protect with a password (AES-256)', false)}</div>
      <div id="bkPw" style="display:none;margin-top:8px" class="form-grid"><label class="field">Password<input type="text" id="bkP1" autocomplete="new-password" style="-webkit-text-security:disc"></label><label class="field">Repeat password<input type="text" id="bkP2" autocomplete="new-password" style="-webkit-text-security:disc"></label></div>
      <div id="bkEst" class="muted" style="margin:14px 0"></div>
      <button class="btn primary lg" id="bkGo">Create backup…</button>
      <div id="bkProg"></div><div id="bkRes"></div>`;
    const est = async () => {
      const full = box.querySelector('input[name=bkType]:checked').value === 'full';
      const e = await api('backup:estimate', { id: $('#bkGame', box).value, includeMedia: full });
      const mb = (b) => b > 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB';
      $('#bkEst', box).innerHTML = `Estimated size: <b style="color:#fff">${mb(e.totalBytes)}</b> · ${e.songs} songs · ${e.cards} cards${full && e.missing.length ? `<div style="color:var(--amber)">⚠ ${e.missing.length} video file(s) are missing and will not be included.</div>` : ''}${full && e.totalBytes > 4294967296 ? '<div style="color:var(--amber)">Large backup — make sure the destination drive has enough space (FAT32 USB sticks cannot hold files over 4 GB).</div>' : ''}`;
    };
    $$('input[name=bkType]', box).forEach(r => r.onchange = est); $('#bkGame', box).onchange = (e) => { this.gameId = e.target.value; est(); };
    $('#bkEnc', box).onchange = (e) => { $('#bkPw', box).style.display = e.target.checked ? 'grid' : 'none'; };
    est();
    $('#bkGo', box).onclick = async () => {
      const full = box.querySelector('input[name=bkType]:checked').value === 'full';
      let password = null;
      if ($('#bkEnc', box).checked) {
        password = $('#bkP1', box).value;
        if (password.length < 6) return toast('Use a password of at least 6 characters', 'err');
        if (password !== $('#bkP2', box).value) return toast('The passwords do not match', 'err');
      }
      $('#bkGo', box).disabled = true; $('#bkRes', box).innerHTML = '';
      $('#bkProg', box).innerHTML = '<div class="muted small">Creating backup…</div>';
      try {
        const r = await api('backup:create', { id: $('#bkGame', box).value, includeMedia: full, password });
        $('#bkProg', box).innerHTML = '';
        if (r) $('#bkRes', box).innerHTML = `<div class="check-row" style="margin-top:12px"><span class="ic ok">✓</span><div class="grow"><b>Backup complete — ${(r.size / 1048576).toFixed(1)} MB</b><div class="muted small">${esc(r.file)}${r.type === 'full' ? ` · ${r.mediaIncluded} videos included${r.mediaMissing ? `, ${r.mediaMissing} missing` : ''}` : ''}${r.encrypted ? ' · password protected' : ''}</div></div><button class="btn sm" id="bkShow">Show</button></div>`;
        if (r && $('#bkShow', box)) $('#bkShow', box).onclick = () => showInFolder(r.file);
      } catch (e) { $('#bkProg', box).innerHTML = ''; }
      $('#bkGo', box).disabled = false;
    };
  },
  drawRestore() {
    const box = $('#rsBox', this.el);
    box.innerHTML = `<h2>Restore a game</h2><p class="muted">Choose a <b>.cmbbackup</b> file. It is checked completely (structure, versions, checksums, card mappings) before anything is restored. Existing games are never overwritten.</p>
      <button class="btn primary lg" id="rsPick">Choose backup file…</button><div id="rsOut" style="margin-top:14px"></div><div id="rsProg"></div>`;
    $('#rsPick', box).onclick = async () => { const f = await api('backup:pickFile'); if (f) this.inspect(f); };
  },
  async inspect(file, password) {
    const out = $('#rsOut', this.el);
    out.innerHTML = '<div class="muted">Checking backup…</div>';
    const info = await api('backup:inspect', { file, password });
    if (info.needsPassword || (info.error && /password/i.test(info.error))) {
      out.innerHTML = `<div class="check-row"><span class="ic warn">🔒</span><div class="grow"><b>This backup is password protected</b>${info.error ? `<div style="color:var(--red)">${esc(info.error)}</div>` : ''}<div class="row" style="margin-top:8px"><input type="text" id="rsPw" style="-webkit-text-security:disc" placeholder="Password"><button class="btn primary" id="rsPwGo">Unlock</button></div></div></div>`;
      $('#rsPwGo', out).onclick = () => this.inspect(file, $('#rsPw', out).value);
      return;
    }
    const checks = (info.checks || []).map(c => `<div class="check-row"><span class="ic ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '×'}</span><div><b>${esc(c.label)}</b><div class="muted small">${esc(c.detail)}</div></div></div>`).join('');
    if (info.error) { out.innerHTML = `<div class="verdict invalid"><div><div class="vt">CANNOT RESTORE</div><div>${esc(info.error)}</div></div></div>${checks}`; return; }
    const m = info.manifest, s = info.summary;
    out.innerHTML = `<div class="panel deep"><div class="eyebrow">Backup of</div><div class="display" style="font-size:28px">${esc(m.gameName)}</div>
      <div class="muted">${esc(m.gameDate || '')}${m.venue ? ' · ' + esc(m.venue) : ''} · made ${new Date(m.createdAt).toLocaleString()} · ${m.type === 'full' ? `FULL backup (${info.mediaIncluded} videos)` : 'Game backup (no videos)'}${info.encrypted ? ' · encrypted' : ''}</div>
      <div class="row" style="margin-top:10px;gap:22px"><div class="stat"><span class="k">Cards</span><span class="big-num" style="font-size:30px">${m.counts.cards}</span></div><div class="stat"><span class="k">Songs</span><span class="big-num" style="font-size:30px">${m.counts.songs}</span></div><div class="stat"><span class="k">Played</span><span class="big-num" style="font-size:30px">${s.played}</span></div><div class="stat"><span class="k">Round</span><span class="big-num" style="font-size:30px">${s.round ? s.round.number : 0}</span></div><div class="stat"><span class="k">Winners</span><span class="big-num" style="font-size:30px">${s.winners}</span></div></div>
      <div class="muted small" style="margin-top:6px">${m.cardsLocked ? '🔒 Cards locked/issued' : 'Draft cards'} · ${s.credits} technical credit(s)${s.openSession ? ' · a claim session was open (it will be restored)' : ''}</div></div>
      <details style="margin:10px 0"><summary class="muted" style="cursor:pointer">Integrity checks (${info.checks.length} passed)</summary>${checks}</details>
      ${info.exists ? `<div class="verdict dup"><div class="grow"><div class="vt" style="font-size:22px">This game already exists here</div><div class="small muted">It will not be overwritten.</div></div></div>
        <div class="row"><button class="btn" id="rsKeep">Keep existing</button><button class="btn primary" id="rsCopy">Restore as separate copy</button><button class="btn ghost" id="rsCancel">Cancel</button></div>`
        : `<button class="btn primary lg" id="rsGo">Restore game</button>`}`;
    const doRestore = async (mode) => {
      let mediaDir = null;
      if (m.type === 'full' && info.mediaIncluded) { mediaDir = await api('backup:pickFolder'); if (!mediaDir) return toast('Choose where to store the restored videos', 'err'); }
      $$('button', out).forEach(b => { b.disabled = true; });
      $('#rsProg', this.el).innerHTML = '<div class="muted small">Restoring…</div>';
      try {
        const r = await api('backup:restore', { file, password, mode, mediaDir });
        $('#rsProg', this.el).innerHTML = '';
        if (r.conflict) return toast(r.message, 'err');
        out.innerHTML = `<div class="verdict valid"><div class="grow"><div class="vt">RESTORED</div><div><b>${esc(r.name)}</b> — ${r.cards} cards, identical to the originals${r.separateCopy ? ' (separate copy; printed cards and QR codes still work)' : ''}.</div><div class="small muted">${r.mediaRestored ? r.mediaRestored + ' videos restored. ' : ''}${r.missing ? `<b style="color:var(--amber)">${r.missing} video(s) need relinking</b> — use the relink assistant below.` : 'All videos are available.'} Phones must be paired again on this laptop.</div></div>
          <button class="btn primary" id="rsOpen">Open game</button></div>`;
        $('#rsOpen', out).onclick = async () => { await api('games:open', { id: r.gameId }); App.show('host'); };
        this.gameId = r.gameId; this.games = await api('games:list'); this.drawBackup(); this.drawRelink();
      } catch (e) { $('#rsProg', this.el).innerHTML = ''; $$('button', out).forEach(b => { b.disabled = false; }); }
    };
    if ($('#rsGo', out)) $('#rsGo', out).onclick = () => doRestore('normal');
    if ($('#rsCopy', out)) $('#rsCopy', out).onclick = () => doRestore('separate');
    if ($('#rsKeep', out)) $('#rsKeep', out).onclick = () => { out.innerHTML = '<div class="muted">Kept the existing game — nothing was changed.</div>'; };
    if ($('#rsCancel', out)) $('#rsCancel', out).onclick = () => { out.innerHTML = ''; };
  },
  async drawRelink() {
    const box = $('#rlBox', this.el); const games = this.games;
    if (!games.length) { box.innerHTML = ''; return; }
    const gid = this.relinkId || this.gameId;
    const missing = await api('games:missing', { id: gid });
    box.innerHTML = `<h2>Relink videos <span class="row"><select id="rlGame">${games.map(g => `<option value="${g.id}" ${g.id === gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></span></h2>
      ${missing.length ? `<p class="muted">${missing.length} video(s) for this game are not where they used to be. Choose the folder that contains them — files are matched by their digital fingerprint first; anything less certain needs your confirmation. The printed songs and card layouts never change.</p>
        <div class="hist-list" style="max-height:200px;margin-bottom:12px">${missing.map(m => `<div class="hist-item"><div class="t"><b>${esc(m.title)}</b> <span>— ${esc(m.artist)} · ${esc(m.fileName)}</span></div></div>`).join('')}</div>
        <button class="btn primary" id="rlScan">Search a folder…</button><div id="rlOut" style="margin-top:12px"></div>`
        : '<div class="check-row"><span class="ic ok">✓</span><div>All videos for this game are available.</div></div>'}`;
    $('#rlGame', box).onchange = (e) => { this.relinkId = e.target.value; this.drawRelink(); };
    if (!$('#rlScan', box)) return;
    $('#rlScan', box).onclick = async () => {
      const res = await relinkWizard({ title: 'Relink videos for this game',
        scan: () => api('games:relinkScan', { id: gid }),
        apply: (picked) => api('games:relinkApply', { id: gid, matches: picked.map(p => ({ songId: p.key, path: p.path, match: p.match })) }) });
      if (res) toast(`${res.applied} video(s) relinked · ${res.missing} still missing`, res.missing ? '' : 'ok', 5000);
      this.drawRelink();
    };
  }
});
