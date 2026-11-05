App.register('playlists', {
  current: null,
  leave() { if (this.el) { this.el.ondragover = this.el.ondrop = null; } },
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Music bingo videos</div><h1>Playlists</h1><p>Every game needs at least <b>40 unique, playable songs</b>. 75+ gives longer, fairer games.</p></div>
        <div class="row"><button class="btn" id="pBuild" title="e.g. 80s + Bollywood, 75 songs">Build a playlist…</button><button class="btn" id="pM3U" title="VLC, Windows Media Player, Winamp… (.m3u / .m3u8)">Import M3U…</button><button class="btn" id="pFolders" title="Each sub-folder becomes a playlist">Import folders as playlists…</button><button class="btn primary" id="pNew">✚ New playlist</button></div></div>
      <div class="cols" style="grid-template-columns: 300px minmax(0,1fr)">
        <div class="panel"><h2>Playlists</h2><div id="pList"></div></div>
        <div id="pDetail"></div>
      </div>`;
    $('#pBuild', el).onclick = () => this.builder();
    $('#pM3U', el).onclick = async () => { const r = await api('playlists:importM3U'); if (r) { m3uReport(r); const ok = r.find(x => x.playlistId); if (ok) this.current = ok.playlistId; this.load(); } };
    // drop .m3u / .m3u8 files (or videos) onto this page
    el.ondragover = (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file')) e.preventDefault(); };
    el.ondrop = async (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (!files.length) return;
      e.preventDefault();
      const paths = files.map(f => window.cmb.pathForFile ? window.cmb.pathForFile(f) : f.path).filter(Boolean);
      const lists = paths.filter(p => /\.m3u8?$/i.test(p));
      if (!lists.length) return toast('Drop .m3u or .m3u8 playlist files here — videos go in the Music Library', 'err');
      const r = await api('playlists:importM3UFiles', { files: lists }); m3uReport(r); const ok = r.find(x => x.playlistId); if (ok) this.current = ok.playlistId; this.load();
    };
    $('#pFolders', el).onclick = async () => { const r = await api('library:pickFolderPlaylists'); if (r) { folderPlaylistReport(r); this.load(); } };
    $('#pNew', el).onclick = async () => { const name = await promptBox('New playlist', 'Name (e.g. 80s Classics, Bollywood Bingo)'); if (!name) return; const p = await api('playlists:create', { name }); this.current = p.id; this.load(); };
    await this.load();
  },
  /** Build a playlist from decades and tags (Music Library tags / years). */
  async builder() {
    const sum = await api('library:tagSummary');
    if (!sum.tags.length && !sum.decades.length) return modal({ title: 'Build a playlist', body: '<p>No songs have a year or tags yet.</p><p class="muted small">Add them in the <b>Music Library</b>: select songs → <b>Tag selected…</b>, or open a song with <b>Edit</b>. Videos whose files contain a year or genre are tagged automatically on import.</p>', buttons: [{ label: 'OK', kind: 'primary', value: true }] });
    const pick = { d: new Set(), t: new Set() };
    const body = document.createElement('div');
    body.innerHTML = `${sum.decades.length ? `<div class="eyebrow">Decades (any of these)</div><div class="row" id="bD" style="flex-wrap:wrap;gap:6px;margin:6px 0 14px">${sum.decades.map(d => `<button class="btn sm" data-d="${d.decade}">${d.decade} <span class="muted">${d.count}</span></button>`).join('')}</div>` : ''}
      ${sum.tags.length ? `<div class="eyebrow">Tags (any of these)</div><div class="row" id="bT" style="flex-wrap:wrap;gap:6px;margin:6px 0 14px">${sum.tags.map(t => `<button class="btn sm" data-t="${esc(t.tag)}">${esc(t.tag)} <span class="muted">${t.count}</span></button>`).join('')}</div>` : ''}
      <div class="form-grid"><label class="field">How many songs<input type="number" id="bN" min="40" max="999" value="75"></label><label class="field">Playlist name<input type="text" id="bName" placeholder="automatic, e.g. 1980s · Bollywood"></label></div>
      <p class="small" id="bInfo" style="margin-top:10px"></p>
      <p class="muted tiny">Picking a decade and a tag means songs must match both (e.g. 1980s <i>and</i> Bollywood). Only playable songs count, never two versions of the same song. ${sum.untagged ? `${sum.untagged} song(s) have no year or tags yet.` : ''}</p>`;
    const info = async () => { const r = await api('playlists:build', { decades: [...pick.d], tags: [...pick.t], dryRun: true }); const n = Number(body.querySelector('#bN').value) || 75; body.querySelector('#bInfo').innerHTML = !pick.d.size && !pick.t.size ? 'Choose at least one decade or tag.' : `<b>${r.matching}</b> song(s) match.${r.matching < 40 ? ' <span style="color:var(--amber)">A game needs at least 40.</span>' : r.matching < n ? ` The playlist will have all ${r.matching}.` : ` ${n} will be picked at random.`}`; };
    body.querySelectorAll('[data-d],[data-t]').forEach(b => b.onclick = () => { const set = b.dataset.d ? pick.d : pick.t; const v = b.dataset.d || b.dataset.t; if (set.has(v)) set.delete(v); else set.add(v); b.classList.toggle('primary', set.has(v)); info(); });
    body.querySelector('#bN').oninput = info; info();
    const r = await modal({ title: 'Build a playlist', size: 'mid', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Build playlist', kind: 'primary', value: (b) => ({ count: Number(b.querySelector('#bN').value) || 75, name: b.querySelector('#bName').value }) }] });
    if (!r) return;
    if (!pick.d.size && !pick.t.size) return toast('Choose at least one decade or tag', 'err');
    const res = await api('playlists:build', { decades: [...pick.d], tags: [...pick.t], count: r.count, name: r.name });
    toast(`“${res.name}” built with ${res.added} song(s)${res.enoughForGame ? '' : ' — add more for a game (40 minimum)'}`, res.enoughForGame ? 'ok' : 'err', 6000);
    this.current = res.playlistId; this.load();
  },
  async load() {
    const [pls, lib] = await Promise.all([api('playlists:list'), api('library:list')]);
    this.pls = pls; this.lib = new Map(lib.songs.map(s => [s.id, s])); this.libAll = lib.songs;
    if (!this.current || !pls.find(p => p.id === this.current)) this.current = pls[0] ? pls[0].id : null;
    if (!$('#pList', this.el)) return; // the page was redrawn or left while loading — the newer draw takes over
    $('#pList', this.el).innerHTML = pls.length ? pls.map(p => `<div class="check-row" data-id="${p.id}" style="cursor:pointer;${p.id === this.current ? 'outline:1px solid var(--pink)' : ''}">
      <div class="grow"><b>${esc(p.name)}</b><div class="muted small">${p.songIds.length} songs</div></div>
      ${p.validation.ok ? '<span class="badge ok">READY</span>' : `<span class="badge warn">${p.validation.needed} MORE</span>`}</div>`).join('') : '<div class="empty">No playlists yet.</div>';
    $$('#pList [data-id]', this.el).forEach(r => r.onclick = () => { this.current = r.dataset.id; this.load(); });
    this.drawDetail();
  },
  drawDetail() {
    const d = $('#pDetail', this.el);
    const p = this.pls.find(x => x.id === this.current);
    if (!p) { d.innerHTML = '<div class="panel"><div class="empty">Create a playlist, then add songs from your Music Library.</div></div>'; return; }
    const v = p.validation;
    const problems = new Map(v.problems.map(x => [x.songId, x.issue]));
    d.innerHTML = `
      <div class="panel" style="margin-bottom:14px"><div class="row">
        <div class="grow"><div class="eyebrow">Playlist</div><div class="display" style="font-size:30px">${esc(p.name)}</div></div>
        <button class="btn sm" id="pRen">Rename</button><button class="btn sm" id="pDup">Duplicate</button><button class="btn sm" id="pExp" title="Opens in VLC, Windows Media Player, foobar2000…">Export M3U…</button><button class="btn sm danger" id="pDel">Delete</button></div>
        <div class="row" style="margin-top:12px">
          <div class="stat"><span class="k">Unique playable songs</span><span class="big-num" style="color:${v.ok ? 'var(--green)' : 'var(--amber)'}">${v.uniquePlayable}</span></div>
          <div class="grow" style="padding-left:16px">${v.ok ? `<span class="badge ok">✓ READY FOR A GAME</span><div class="muted small" style="margin-top:6px">Minimum 40 met${v.uniquePlayable < 75 ? ' · 75+ recommended for longer games' : ''}.</div>` : `<span class="badge warn">ADD ${v.needed} MORE SONG${v.needed === 1 ? '' : 'S'}</span><div class="muted small" style="margin-top:6px">A game cannot be created until this playlist has 40 unique, playable songs with title and artist.</div>`}
          ${v.problems.length ? `<div class="small" style="color:var(--amber);margin-top:6px">${v.problems.length} song(s) not counted — see the warnings below.</div>` : ''}</div>
          <button class="btn" id="pCheck" title="Hear a few seconds of every song from where the game will start it">▶ Check songs…</button><button class="btn primary" id="pAdd">＋ Add songs</button></div>
      </div>
      <div class="panel" style="padding:8px 12px"><table class="list"><thead><tr><th style="width:34px">#</th><th>Song</th><th>Length</th><th>Status</th><th style="width:170px"></th></tr></thead><tbody id="pBody"></tbody></table></div>`;
    const body = $('#pBody', d);
    body.innerHTML = p.songIds.length ? p.songIds.map((id, i) => { const s = this.lib.get(id) || { title: '(removed)', artist: '' }; const issue = problems.get(id); return `<tr draggable="true" data-id="${id}" data-i="${i}">
      <td class="muted">${i + 1}</td><td><div class="song-cell"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div></td><td class="muted">${s.duration ? fmtTime(s.duration) : '–'}</td>
      <td>${issue ? `<span class="badge ${issue === 'Not yet checked' ? '' : 'bad'}">${esc(issue)}</span>` : '<span class="badge ok">OK</span>'}</td>
      <td style="text-align:right"><button class="btn sm ghost" data-up title="Move up">▲</button><button class="btn sm ghost" data-down title="Move down">▼</button><button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-rm title="Remove">✕</button></td></tr>`; }).join('') : '<tr><td colspan="5"><div class="empty">No songs yet — click <b>Add songs</b>.</div></td></tr>';
    const reorder = async (ids) => { await api('playlists:reorder', { id: p.id, songIds: ids }); this.load(); };
    let dragFrom = null;
    $$('tr[data-id]', body).forEach(tr => {
      const i = Number(tr.dataset.i);
      tr.ondragstart = () => { dragFrom = i; };
      tr.ondragover = (e) => { e.preventDefault(); tr.classList.add('drag-over'); };
      tr.ondragleave = () => tr.classList.remove('drag-over');
      tr.ondrop = (e) => { e.preventDefault(); tr.classList.remove('drag-over'); if (dragFrom == null || dragFrom === i) return; const ids = p.songIds.slice(); const [m] = ids.splice(dragFrom, 1); ids.splice(i, 0, m); reorder(ids); };
      $('[data-up]', tr).onclick = () => { if (i === 0) return; const ids = p.songIds.slice(); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; reorder(ids); };
      $('[data-down]', tr).onclick = () => { if (i === p.songIds.length - 1) return; const ids = p.songIds.slice(); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; reorder(ids); };
      $('[data-rm]', tr).onclick = async () => { await api('playlists:remove', { id: p.id, songIds: [tr.dataset.id] }); this.load(); };
      $('[data-edit]', tr).onclick = () => { const s = this.lib.get(tr.dataset.id); if (s) editSong(s, () => this.load()); };
    });
    $('#pRen', d).onclick = async () => { const n = await promptBox('Rename playlist', 'Name', p.name); if (n) { await api('playlists:rename', { id: p.id, name: n }); this.load(); } };
    $('#pDup', d).onclick = async () => { const c = await api('playlists:duplicate', { id: p.id }); this.current = c.id; this.load(); };
    $('#pExp', d).onclick = async () => { const r = await api('playlists:exportM3U', { id: p.id }); if (!r) return; toast(`Exported ${r.count} song(s) to ${r.file.split(/[\\/]/).pop()}${r.missing ? ` — ${r.missing} file(s) are currently missing` : ''}`, r.missing ? 'err' : 'ok', 6000); };
    $('#pDel', d).onclick = async () => { if (await confirmBox('Delete playlist?', `Delete “${esc(p.name)}”? Songs stay in your library; games already created are not affected.`, 'Delete', true)) { await api('playlists:delete', { id: p.id }); this.current = null; this.load(); } };
    $('#pAdd', d).onclick = () => this.addSongs(p);
    $('#pCheck', d).onclick = async () => { if (App.game && ['playing', 'loading'].includes(App.game.playback.status)) return toast('Pause the game first — the song check plays through this laptop', 'err', 5000); await songCheck(p); this.load(); };
  },
  async addSongs(p) {
    const inPl = new Set(p.songIds);
    const body = document.createElement('div');
    body.innerHTML = `<div class="row" style="margin-bottom:10px"><input type="search" id="aQ" placeholder="Search…" class="grow"><label class="toggle"><input type="checkbox" id="aReady" checked><span class="sw"></span>Ready songs only</label><button class="btn sm" id="aAll">Select all shown</button></div><div class="scroll" style="max-height:55vh"><table class="list"><tbody id="aBody"></tbody></table></div><div class="muted small" id="aN" style="margin-top:8px"></div>`;
    const sel = new Set();
    const draw = () => {
      const q = body.querySelector('#aQ').value.toLowerCase(); const ready = body.querySelector('#aReady').checked;
      const list = this.libAll.filter(s => !inPl.has(s.id) && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)) && (!ready || (s.status === 'ok' && s.title && s.artist)));
      body._list = list;
      body.querySelector('#aBody').innerHTML = list.length ? list.map(s => `<tr data-id="${s.id}" class="${sel.has(s.id) ? 'sel' : ''}" style="cursor:pointer"><td style="width:30px"><input type="checkbox" ${sel.has(s.id) ? 'checked' : ''}></td><td><div class="song-cell"><b>${esc(s.title || s.fileName)}</b><span>${esc(s.artist)}</span></div></td><td class="muted">${s.duration ? fmtTime(s.duration) : ''}</td>${s.duplicateOf ? '<td><span class="badge warn">DUPLICATE?</span></td>' : '<td></td>'}</tr>`).join('') : '<tr><td><div class="empty">No more songs available — import more in the Music Library.</div></td></tr>';
      $$('tr[data-id]', body).forEach(tr => tr.onclick = () => { const id = tr.dataset.id; sel.has(id) ? sel.delete(id) : sel.add(id); draw(); });
      body.querySelector('#aN').textContent = `${sel.size} selected · playlist will have ${p.songIds.length + sel.size} songs`;
    };
    body.querySelector('#aQ').oninput = draw; body.querySelector('#aReady').onchange = draw;
    body.querySelector('#aAll').onclick = () => { body._list.forEach(s => sel.add(s.id)); draw(); };
    draw();
    const ok = await modal({ title: `Add songs to ${p.name}`, size: 'mid', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Add selected', kind: 'primary', value: true }] });
    if (!ok || !sel.size) return;
    const r = await api('playlists:add', { id: p.id, songIds: Array.from(sel) });
    toast(`${r.added.length} added${r.rejected.length ? ` · ${r.rejected.length} duplicate(s) refused` : ''}`, 'ok', 5000);
    if (r.rejected.length) modal({ title: 'Duplicates not added', body: r.rejected.map(x => `<div class="check-row"><span class="ic warn">!</span><div><b>${esc(x.title)}</b><div class="muted small">${esc(x.reason)}</div></div></div>`).join('') });
    this.load();
  }
});
