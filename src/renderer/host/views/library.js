App.register('library', {
  filter: 'all', q: '', selected: new Set(),
  async render(el) {
    this.el = el;
    el.classList.add('dropzone');
    el.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Song library</div><h1>Music Library</h1><p>Local music videos (MP4 H.264/AAC recommended). Drag files or folders anywhere on this page.</p></div>
        <div class="row"><button class="btn" id="lFolderPl" title="Each sub-folder becomes a playlist">Import folders as playlists…</button><button class="btn" id="lFolder">Import folder</button><button class="btn primary" id="lFiles">Import videos</button></div></div>
      <div class="panel" style="margin-bottom:14px"><div class="row">
        <input type="search" id="lSearch" placeholder="Search title, artist or file…" style="width:280px" value="${esc(this.q)}">
        <div class="seg" id="lFilter">${[['all', 'All'], ['issues', 'Needs attention'], ['dupes', 'Duplicates'], ['ok', 'Ready']].map(([k, l]) => `<button data-f="${k}" class="${this.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="grow"></span>
        <button class="btn sm" id="lCheck">Check files</button><button class="btn sm" id="lRelinkF">Relink folder…</button>
      </div>
      <div class="row" id="lSelBar" style="margin-top:12px;display:none"><span id="lSelN" class="badge pink"></span>
        <select id="lPl"></select><button class="btn sm primary" id="lAdd">Add to playlist</button><button class="btn sm danger" id="lDel">Remove from library</button><button class="btn sm ghost" id="lClr">Clear selection</button></div>
      </div>
      <div class="row" style="margin:0 4px 8px"><div id="lSummary" class="muted small grow"></div><span id="lAudio" class="muted small"></span><button class="btn sm ghost" id="lAudioPause">Pause analysis</button></div>
      <div class="panel" style="padding:8px 12px"><table class="list"><thead><tr><th style="width:30px"><input type="checkbox" id="lAll"></th><th style="width:76px"></th><th>Song</th><th>Duration</th><th title="Automatic volume levelling">Loudness</th><th>Clip</th><th>Status</th><th style="width:220px"></th></tr></thead><tbody id="lBody"></tbody></table></div>`;
    $('#lFiles', el).onclick = async () => { const r = await api('library:pickFiles'); this.report(r); };
    $('#lFolder', el).onclick = async () => { const r = await api('library:pickFolder'); this.report(r); };
    $('#lFolderPl', el).onclick = async () => { const r = await api('library:pickFolderPlaylists'); if (r) { folderPlaylistReport(r); this.load(); } };
    $('#lAudioPause', el).onclick = async () => { const st = await api('audio:status'); this.audio = await api(st.paused ? 'audio:resume' : 'audio:pause'); this.drawAudio(); };
    $('#lCheck', el).onclick = async () => { const n = await api('library:checkFiles'); toast(n ? `${n} file(s) missing — use Relink` : 'All files found', n ? 'err' : 'ok'); this.load(); };
    $('#lRelinkF', el).onclick = async () => { const n = await api('library:relinkFolder'); if (n != null) { toast(`${n} missing file(s) relinked`, 'ok'); this.load(); } };
    $('#lSearch', el).oninput = (e) => { this.q = e.target.value; this.draw(); };
    $$('#lFilter button', el).forEach(b => b.onclick = () => { this.filter = b.dataset.f; $$('#lFilter button', el).forEach(x => x.classList.toggle('on', x === b)); this.draw(); });
    $('#lAll', el).onchange = (e) => { this.visible.forEach(s => e.target.checked ? this.selected.add(s.id) : this.selected.delete(s.id)); this.draw(); };
    $('#lClr', el).onclick = () => { this.selected.clear(); this.draw(); };
    $('#lAdd', el).onclick = async () => {
      const id = $('#lPl', el).value;
      if (id === '__new') { const name = await promptBox('New playlist', 'Playlist name', ''); if (!name) return; const p = await api('playlists:create', { name }); return this.addTo(p.id); }
      this.addTo(id);
    };
    $('#lDel', el).onclick = async () => {
      if (!await confirmBox('Remove songs?', `Remove ${this.selected.size} song(s) from the library and all playlists? Video files on disk are not deleted. Games already created keep their own copy.`, 'Remove', true)) return;
      await api('library:remove', { ids: Array.from(this.selected) }); this.selected.clear(); this.load();
    };
    // Drag & drop
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('drag'); };
    el.ondragleave = (e) => { if (e.target === el) el.classList.remove('drag'); };
    el.ondrop = async (e) => {
      e.preventDefault(); el.classList.remove('drag');
      const paths = Array.from(e.dataTransfer.files).map(f => window.cmb.pathForFile(f)).filter(Boolean);
      if (paths.length) this.report(await api('library:importPaths', paths));
    };
    await this.load();
  },
  leave() { if (this.el) { this.el.classList.remove('dropzone'); this.el.ondragover = this.el.ondrop = this.el.ondragleave = null; } },
  async drawAudio() {
    const a = this.audio || await api('audio:status'); this.audio = a;
    const el = this.el; if (!el || !$('#lAudio', el)) return;
    $('#lAudio', el).textContent = !a.available ? '⚠ Volume levelling unavailable (ffmpeg not found) — songs play at original volume' : (a.paused ? `Loudness analysis paused (${a.pending} waiting)` : (a.pending || a.running ? `Analysing loudness… ${a.done} done, ${a.pending} to go` : `Loudness analysed for ${a.done} videos${a.errors ? ` · ${a.errors} failed` : ''}`));
    $('#lAudioPause', el).style.display = a.available && (a.pending || a.running || a.paused) ? '' : 'none';
    $('#lAudioPause', el).textContent = a.paused ? 'Resume analysis' : 'Pause analysis';
  },
  on_convert() { this.on_library(); },
  on_library() { if (this._lt) return; this._lt = setTimeout(() => { this._lt = null; if (this.el && document.body.contains(this.el) && App.view === 'library') this.load(); }, 1500); },
  async addTo(id) {
    const r = await api('playlists:add', { id, songIds: Array.from(this.selected) });
    toast(`${r.added.length} added${r.rejected.length ? `, ${r.rejected.length} refused (duplicates)` : ''}`, r.rejected.length ? '' : 'ok', 5000);
    if (r.rejected.length) modal({ title: 'Some songs were not added', body: `<p class="muted">Duplicates are never added silently to a playlist:</p>${r.rejected.map(x => `<div class="check-row"><span class="ic warn">!</span><div><b>${esc(x.title)}</b><div class="muted small">${esc(x.reason)}</div></div></div>`).join('')}` });
    this.selected.clear(); this.load();
  },
  report(r) {
    if (!r) return;
    const parts = [`${r.added.length} imported`];
    if (r.alreadyInLibrary.length) parts.push(`${r.alreadyInLibrary.length} already in library`);
    if (r.duplicates.length) parts.push(`${r.duplicates.length} possible duplicates flagged`);
    if (r.converting) parts.push(`${r.converting} being converted to MP4`);
    if (r.unsupported.length) parts.push(`${r.unsupported.length} unsupported`);
    toast(parts.join(' · '), r.unsupported.length ? 'err' : 'ok', 6000);
    if (r.unsupported.length || r.duplicates.length) {
      modal({ title: 'Import report', size: 'mid', body:
        (r.duplicates.length ? `<h3>Flagged as possible duplicates</h3>${r.duplicates.map(d => `<div class="check-row"><span class="ic warn">!</span><div><b>${esc(d.path.split(/[\\/]/).pop())}</b><div class="muted small">${esc(d.kind)} as “${esc(d.of)}” — review it in the Duplicates filter</div></div></div>`).join('')}` : '') +
        (r.unsupported.length ? `<h3 style="margin-top:12px">Not imported</h3>${r.unsupported.map(d => `<div class="check-row"><span class="ic bad">×</span><div><b>${esc(d.path.split(/[\\/]/).pop())}</b><div class="muted small">${esc(d.reason)}</div></div></div>`).join('')}` : '') });
    }
    this.load();
  },
  async load() {
    const [lib, pls] = await Promise.all([api('library:list'), api('playlists:list')]);
    if (App.view !== 'library' || !$('#lBody', this.el)) return; // the host moved to another page meanwhile
    this.songs = lib.songs; this.pls = pls; this.audio = null; this.drawAudio();
    const sel = $('#lPl', this.el);
    if (sel) sel.innerHTML = pls.map(p => `<option value="${p.id}">${esc(p.name)} (${p.songIds.length})</option>`).join('') + '<option value="__new">＋ New playlist…</option>';
    this.draw();
  },
  draw() {
    const el = this.el; if (!el || !this.songs || App.view !== 'library' || !$('#lBody', el)) return;
    const q = this.q.trim().toLowerCase();
    const issue = s => ['missing', 'unsupported'].includes(s.status) || !s.title || !s.artist;
    this.visible = this.songs.filter(s => {
      if (q && !(`${s.title} ${s.artist} ${s.fileName}`.toLowerCase().includes(q))) return false;
      if (this.filter === 'issues') return issue(s) || s.status === 'unchecked';
      if (this.filter === 'dupes') return !!s.duplicateOf;
      if (this.filter === 'ok') return s.status === 'ok' && s.title && s.artist;
      return true;
    });
    const total = this.songs.length, ready = this.songs.filter(s => s.status === 'ok' && s.title && s.artist).length;
    const checking = this.songs.filter(s => s.status === 'unchecked').length;
    $('#lSummary', el).textContent = `${total} videos · ${ready} ready${checking ? ` · checking ${checking}…` : ''} · ${this.songs.filter(issue).length} need attention · ${this.songs.filter(s => s.duplicateOf).length} flagged duplicates`;
    $('#lSelBar', el).style.display = this.selected.size ? 'flex' : 'none';
    $('#lSelN', el).textContent = `${this.selected.size} selected`;
    const body = $('#lBody', el);
    if (!this.visible.length) { body.innerHTML = `<tr><td colspan="8"><div class="empty">${total ? 'No songs match this filter.' : 'Your library is empty. Click <b>Import videos</b>, <b>Import folder</b>, or drag music videos onto this page.'}</div></td></tr>`; return; }
    const stBadge = s => {
      if (s.status === 'missing') return '<span class="badge bad">MISSING FILE</span>';
      if (s.status === 'unsupported') return `<span class="badge bad" title="${esc(s.statusNote)}">UNSUPPORTED</span>`;
      if (s.status === 'unchecked') return '<span class="badge">CHECKING…</span>';
      if (s.status === 'needs-conversion') return '<span class="badge pink">QUEUED FOR CONVERSION</span>';
      if (s.status === 'converting') return `<span class="badge pink">CONVERTING ${(s.conversion && s.conversion.percent) || 0}%</span>`;
      if (!s.title || !s.artist) return '<span class="badge warn">NEEDS TITLE/ARTIST</span>';
      return `<span class="badge ok">READY${s.height ? ' · ' + s.height + 'p' : ''}</span>${s.converted ? ` <span class="badge" title="Copy of ${esc(s.converted.from)}">${s.converted.optimised ? s.converted.maxHeight + 'p COPY' : 'CONVERTED'}</span>` : ''}${s.optimise ? ' <span class="badge pink">MAKING 720p COPY…</span>' : ''}`;
    };
    const PAGE = 200; this.shown = Math.max(this.shown || PAGE, PAGE);
    const rows = this.visible.slice(0, this.shown);
    body.innerHTML = rows.map(s => `<tr data-id="${s.id}" class="${this.selected.has(s.id) ? 'sel' : ''}">
      <td><input type="checkbox" data-sel ${this.selected.has(s.id) ? 'checked' : ''}></td>
      <td>${s.thumb ? `<img class="thumb" loading="lazy" decoding="async" width="96" height="54" src="${fileUrl(s.thumb)}">` : '<div class="thumb"></div>'}</td>
      <td><div class="song-cell"><b>${esc(s.title || '— no title —')}</b><span>${esc(s.artist || '— no artist —')}${s.displayTitle ? ` · TV: “${esc(s.displayTitle)}”` : ''}</span><span class="tiny">${esc(s.fileName)}</span></div></td>
      <td class="muted">${s.duration ? fmtTime(s.duration) : '–'}</td>
      <td class="small">${audioCell(s)}</td>
      <td class="muted small">${s.clipStart != null || s.clipEnd != null ? `${fmtTime(s.clipStart || 0)}–${s.clipEnd != null ? fmtTime(s.clipEnd) : 'auto'}` : 'default'}</td>
      <td>${stBadge(s)}${s.duplicateOf ? ' <span class="badge warn">DUPLICATE?</span>' : ''}${s.statusNote && s.status !== 'ok' ? `<div class="tiny muted" style="max-width:240px">${esc(s.statusNote)}</div>` : ''}</td>
      <td style="text-align:right">${s.status === 'unsupported' ? `<button class="btn sm primary" data-convert>${s.conversion && s.conversion.state === 'failed' ? 'Retry convert' : 'Convert to MP4'}</button> ` : ''}${['converting', 'needs-conversion'].includes(s.status) ? '<button class="btn sm ghost" data-cancelconv>Cancel</button> ' : ''}<button class="btn sm ghost" data-reveal title="Show in folder">📂</button><button class="btn sm" data-edit>Edit</button> ${s.status === 'missing' ? '<button class="btn sm primary" data-relink>Relink</button>' : ''} ${s.duplicateOf ? '<button class="btn sm" data-notdup>Not a duplicate</button>' : ''}</td></tr>`).join('');
    if (this.visible.length > rows.length) { body.insertAdjacentHTML('beforeend', `<tr><td colspan="8" style="text-align:center"><button class="btn sm" id="lMore">Show ${Math.min(PAGE, this.visible.length - rows.length)} more (${this.visible.length - rows.length} not shown)</button></td></tr>`); $('#lMore', body).onclick = () => { this.shown += PAGE; this.draw(); }; }
    $$('tr[data-id]', body).forEach(tr => {
      const id = tr.dataset.id;
      $('[data-sel]', tr).onchange = (e) => { e.target.checked ? this.selected.add(id) : this.selected.delete(id); this.draw(); };
      const cv = $('[data-convert]', tr); if (cv) cv.onclick = async () => { await api('convert:start', { ids: [id] }); toast('Converting to MP4 in the background', 'ok'); this.load(); };
      const cc = $('[data-cancelconv]', tr); if (cc) cc.onclick = async () => { await api('convert:cancel', { id }); this.load(); };
      $('[data-edit]', tr).onclick = () => editSong(this.songs.find(s => s.id === id), () => this.load());
      const rv = $('[data-reveal]', tr); if (rv) rv.onclick = () => revealSong(id, () => this.load());
      const rl = $('[data-relink]', tr); if (rl) rl.onclick = async () => { const s = await api('library:relink', { id }); if (s) { toast('File relinked', 'ok'); this.load(); } };
      const nd = $('[data-notdup]', tr); if (nd) nd.onclick = async () => { await api('library:update', { id, fields: { duplicateOf: null } }); this.load(); };
    });
  }
});

/** Song editor with clip start/end picker. Also used from playlists. */
async function editSong(s, after) {
  const body = document.createElement('div');
  body.innerHTML = `
    <video class="preview-video" controls preload="metadata" src="${fileUrl(s.path)}"></video>
    <div class="row" style="margin:8px 0 14px"><button class="btn sm" id="eSetS">Set clip start = now</button><button class="btn sm" id="eSetE">Set clip end = now</button><button class="btn sm ghost" id="eClr">Use default clip</button><span class="muted small grow" style="text-align:right">${s.duration ? 'Length ' + fmtTime(s.duration) : ''}</span></div>
    <div class="form-grid">
      <label class="field">Song title *<input type="text" id="eT" value="${esc(s.title)}"></label>
      <label class="field">Artist *<input type="text" id="eA" value="${esc(s.artist)}"></label>
      <label class="field">TV display title (optional)<input type="text" id="eD" value="${esc(s.displayTitle)}" placeholder="Shown on the TV overlay & crawler"></label>
      <label class="field">Printed title (optional)<input type="text" id="eP" value="${esc(s.printTitle)}" placeholder="Shorter title for the cards"></label>
      <label class="field">Clip start (seconds)<input type="number" min="0" step="0.5" id="eS" value="${s.clipStart != null ? s.clipStart : ''}" placeholder="default"></label>
      <label class="field">Clip end (seconds)<input type="number" min="0" step="0.5" id="eE" value="${s.clipEnd != null ? s.clipEnd : ''}" placeholder="start + clip length"></label>
    </div>
    <p class="muted small">Leave clip end empty to use the game's clip length (20/30/40/60 s) from the clip start. File: ${esc(s.path)} <button class="btn sm ghost" id="eReveal">📂 Show in folder</button>${s.converted && s.converted.optimised ? ' <button class="btn sm ghost" id="eOrig">Use the original file again</button>' : ''}</p>`;
  body.querySelector('#eReveal').onclick = () => revealSong(s.id, after);
  if (body.querySelector('#eOrig')) body.querySelector('#eOrig').onclick = async () => { if (await api('library:restoreOriginal', { id: s.id })) { toast('Using the original file again', 'ok'); closeTopModal(); if (after) after(); } };
  const v = body.querySelector('video');
  v.addEventListener('loadedmetadata', () => { if (s.clipStart) v.currentTime = s.clipStart; });
  body.querySelector('#eSetS').onclick = () => { body.querySelector('#eS').value = Math.round(v.currentTime * 2) / 2; };
  body.querySelector('#eSetE').onclick = () => { body.querySelector('#eE').value = Math.round(v.currentTime * 2) / 2; };
  body.querySelector('#eClr').onclick = () => { body.querySelector('#eS').value = ''; body.querySelector('#eE').value = ''; };
  const r = await modal({ title: 'Edit song', size: 'mid', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: (b) => ({ title: b.querySelector('#eT').value, artist: b.querySelector('#eA').value, displayTitle: b.querySelector('#eD').value, printTitle: b.querySelector('#eP').value, clipStart: b.querySelector('#eS').value, clipEnd: b.querySelector('#eE').value }) }] });
  v.pause(); v.removeAttribute('src');
  if (!r) return;
  if (!r.title.trim() || !r.artist.trim()) toast('Title and artist are required before the song can be used in a game', 'err', 5000);
  try { await api('library:update', { id: s.id, fields: r }); toast('Saved', 'ok'); } catch (e) { /* toast shown */ }
  if (after) after();
}
window.editSong = editSong;

/** Show a library video in File Explorer; if it's missing, explain and offer to relink it. */
async function revealSong(id, after) {
  const r = await api('library:showInFolder', { id });
  if (r && r.ok) return;
  if (r && r.reason === 'missing') {
    const go = await confirmBox('Video not found', `${esc(r.message)}<br><span class="muted small">${esc(r.path || '')}</span><br><br>Find the video and relink it? Its game history and cards are kept.`, 'Relink…');
    if (go) { const s = await api('library:relink', { id }); if (s) { toast('File relinked', 'ok'); if (after) after(); } }
  } else toast((r && r.message) || 'Could not open the folder', 'err', 6000);
}
window.revealSong = revealSong;

function audioCell(s) {
  const a = s.audio;
  if (!a || a.status === 'pending' || a.status === 'queued') return '<span class="badge">waiting</span>';
  if (a.status === 'analysing') return '<span class="badge pink">analysing…</span>';
  if (a.status === 'done') return `<span class="badge ok" title="True peak ${a.truePeak} dBTP${a.sampleRate ? ' · ' + a.sampleRate + ' Hz' : ''}${a.layout ? ' · ' + a.layout : ''}">${a.lufs} LUFS</span><div class="tiny muted">levelling ready</div>`;
  if (a.status === 'no-audio') return '<span class="badge warn">NO AUDIO</span>';
  if (a.status === 'unavailable') return '<span class="badge" title="' + esc(a.error || '') + '">n/a</span>';
  return `<span class="badge bad" title="${esc(a.error || '')}">ANALYSIS FAILED</span><div class="tiny muted">plays at original volume</div>`;
}

/** Report after importing a folder tree as playlists. */
function folderPlaylistReport(r) {
  const t = r.totals;
  modal({ title: 'Folders imported as playlists', size: 'mid', body:
    (r.playlists.length ? r.playlists.map(p => `<div class="check-row"><span class="ic ok">✓</span><div class="grow"><b>${esc(p.name)}</b> ${p.created ? '<span class="badge pink">NEW</span>' : '<span class="badge">UPDATED</span>'}<div class="muted small">${p.videos} video(s) in the folder · ${p.added} added · ${p.already} already in it${p.rejected.length ? ` · ${p.rejected.length} duplicate(s) refused` : ''} · playlist now has ${p.total} songs</div></div></div>`).join('') : '<div class="empty">No videos were found in that folder or its sub-folders.</div>') +
    `<p class="muted small" style="margin-top:12px">${t.added} new video(s) imported${t.converting ? ` · ${t.converting} being converted to MP4 in the background` : ''}${t.alreadyInLibrary ? ` · ${t.alreadyInLibrary} were already in the library` : ''}. Importing again later only adds new videos.</p>` });
}
window.folderPlaylistReport = folderPlaylistReport;
