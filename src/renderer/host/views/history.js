App.register('history', {
  async render(el) {
    this.el = el;
    const games = await api('games:list');
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Saved games</div><h1>Game History</h1><p>Every game is saved automatically — cards, played songs, claims and winners.</p></div></div>
      <div class="cols" style="grid-template-columns: 380px minmax(0,1fr)"><div class="panel"><div id="gList"></div></div><div class="panel" id="gDet"><div class="empty">Select a game.</div></div></div>`;
    $('#gList', el).innerHTML = games.length ? games.map(g => `<div class="check-row" data-id="${g.id}" style="cursor:pointer"><div class="grow"><b>${esc(g.name)}</b><div class="muted small">${esc(g.date)}${g.venue ? ' · ' + esc(g.venue) : ''}</div><div class="tiny muted">${g.mode === 'checklist' ? 'Rules Checklist' : 'Round-Based'} · ${g.played}/${g.songs} songs · ${g.cards} cards · ${g.winners.length} winner(s)</div></div><span class="badge ${g.status === 'finished' ? '' : (g.status === 'live' ? 'pink' : 'warn')}">${g.status === 'finished' ? 'FINISHED' : g.status === 'live' ? 'IN PROGRESS' : 'SET-UP'}</span></div>`).join('') : '<div class="empty">No games yet.</div>';
    $$('#gList [data-id]', el).forEach(r => r.onclick = () => { $$('#gList [data-id]', el).forEach(x => x.style.outline = ''); r.style.outline = '1px solid var(--pink)'; this.detail(r.dataset.id); });
  },
  async detail(id) {
    const d = await api('games:details', { id });
    const box = $('#gDet', this.el);
    const isActive = App.game && App.game.gameId === id;
    box.innerHTML = `<div class="row"><div class="grow"><div class="eyebrow">Game ${esc(d.id)}</div><div class="display" style="font-size:30px">${esc(d.name)}</div><div class="muted">${esc(d.date)} · ${esc(d.playlistName || '')} · ${d.cards} cards (${d.printed} printed)</div></div>
      <button class="btn primary" id="gOpen">${isActive ? 'Go to game' : (d.status === 'finished' ? 'Open' : '▶ Resume')}</button><button class="btn" id="gRep">Export report</button>${isActive ? '' : '<button class="btn danger" id="gDel">Delete</button>'}</div>
      <div class="cols c2" style="margin-top:16px"><div><h2 class="muted" style="font-size:12px;letter-spacing:.12em">WINNERS</h2>${d.claims.filter(c => c.status === 'confirmed').map(c => `<div class="winner-row"><span class="cn">${c.cardLabel}</span><div><b>Round ${c.round}</b><div class="small muted">${esc(c.headline)}</div></div></div>`).join('') || '<div class="muted small">None</div>'}
        <h2 class="muted" style="font-size:12px;letter-spacing:.12em;margin-top:14px">ALL CLAIMS (${d.claims.length})</h2><div class="hist-list">${d.claims.slice().reverse().map(c => `<div class="hist-item"><span class="n">${c.cardLabel}</span><div class="t"><b>R${c.round} ${esc(c.status)}</b> <span>${esc(c.headline)}</span></div><span class="tiny muted">${new Date(c.at).toLocaleTimeString()}</span></div>`).join('') || '<div class="muted small">None</div>'}</div></div>
      <div><h2 class="muted" style="font-size:12px;letter-spacing:.12em">PLAYED SONGS (${d.history.length})</h2><div class="hist-list">${d.history.map(h => `<div class="hist-item"><span class="n">${String(h.n).padStart(2, '0')}</span><div class="t"><b>${esc(h.title)}</b> <span>— ${esc(h.artist)}</span></div><span class="tiny muted">R${h.round}</span></div>`).join('') || '<div class="muted small">None</div>'}</div></div></div>`;
    $('#gOpen', box).onclick = async () => { if (!isActive) await api('games:open', { id }); App.show('host'); };
    $('#gRep', box).onclick = async () => { const f = await api('games:exportReport', { id }); if (f) toast('Report saved', 'ok'); };
    if ($('#gDel', box)) $('#gDel', box).onclick = async () => { if (await confirmBox('Delete this game?', 'All of its cards, history and winners will be permanently deleted. Printed cards for this game will stop working.', 'Delete forever', true)) { await api('games:delete', { id }); this.render(this.el); } };
  }
});
