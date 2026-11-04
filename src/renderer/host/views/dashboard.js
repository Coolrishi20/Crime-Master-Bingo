App.register('dashboard', {
  async render(el) {
    const [lib, pls, games, info] = await Promise.all([api('library:list'), api('playlists:list'), api('games:list'), api('app:info')]);
    const ok = lib.songs.filter(s => s.status === 'ok').length;
    const issues = lib.songs.filter(s => ['missing', 'unsupported'].includes(s.status)).length;
    const unfinished = games.filter(g => g.status !== 'finished');
    const rec = info.recovery;
    const active = App.game;
    el.innerHTML = `${info.recommendLowResource ? `<div class="banner" id="lrmRec" style="border-color:var(--amber);background:rgba(255,200,87,.12)"><div class="grow"><h3>💡 This laptop has ${info.totalRamGB} GB of memory</h3><div class="muted">Turn on <b style="color:#fff">Low Resource Mode</b> for smoother video on 4 GB laptops. Every game feature stays on — only decorative effects and background work are reduced.</div></div><button class="btn primary" id="lrmOn">Turn on</button><button class="btn ghost" id="lrmNo">Not now</button></div>` : ''}
      <div class="page-head"><div><div class="eyebrow">Anthem Square</div><h1>Dashboard</h1><p>Music video bingo for live nights — run it from the laptop or your phone.</p></div>
        <div class="row"><button class="btn" id="dImport">Import videos</button><button class="btn primary" id="dNew">✚ New game</button></div></div>
      <div class="as-hero"><img src="../shared/brand/icon.svg" alt="" width="74" height="74"><div><h2>Anthem Square</h2><p class="tl">HEAR IT. MARK IT. <b>OWN IT.</b></p></div></div>
      ${rec && !active ? `<div class="banner"><div class="grow"><h3>${rec.crashed ? 'RESUME LAST GAME' : 'Continue your last game'}</h3>
        <div class="muted">${rec.crashed ? 'Anthem Square did not close normally. ' : ''}<b style="color:#fff">${esc(rec.name)}</b> — Round ${rec.round || '–'}, ${rec.played} songs played. Cards, history, claims and winners are all saved.</div></div>
        <button class="btn primary lg" id="dResume">▶ Resume last game</button></div>` : ''}
      ${active ? `<div class="banner"><div class="grow"><h3>${esc(active.name)}</h3><div class="muted">${active.mode === 'checklist' ? `Rules Checklist · ${active.checklist.completed} of ${active.checklist.total} rules won` : active.round.number ? `Round ${active.round.number} · ${esc(active.round.label)} (${active.round.status})` : 'Not started'} · ${active.totals.played}/${active.totals.songs} songs played · ${active.totals.cards} cards</div></div>
        <button class="btn primary lg" id="dHost">▶ Go to Host Game</button></div>` : ''}
      <div class="cols c3" style="margin-bottom:18px">
        <div class="panel"><div class="stat"><span class="k">Music videos</span><span class="big-num">${lib.songs.length}</span><span class="muted small">${ok} ready${issues ? ` · <span style="color:var(--red)">${issues} need attention</span>` : ''}</span></div></div>
        <div class="panel"><div class="stat"><span class="k">Playlists</span><span class="big-num">${pls.length}</span><span class="muted small">${pls.filter(p => p.validation.ok).length} ready for a game (40+ songs)</span></div></div>
        <div class="panel"><div class="stat"><span class="k">Games</span><span class="big-num">${games.length}</span><span class="muted small">${unfinished.length} unfinished</span></div></div>
      </div>
      <div class="cols c2">
        <div class="panel"><h2>Getting ready for tonight</h2>
          ${[['Import at least 40 music videos', lib.songs.length >= 40, 'library'], ['Build a playlist of 40+ unique songs', pls.some(p => p.validation.ok), 'playlists'], ['Create a game & generate cards', games.length > 0, 'create'], ['Print two cards per A4 sheet', games.some(g => g.printed > 0), 'cards'], ['Connect the TV and open the audience window', App.audience.open, 'host'], ['Pair your phone as a remote', !!(App.remote && App.remote.devices && App.remote.devices.length), 'mobile']]
            .map(([t, done, v]) => `<div class="check-row" style="cursor:pointer" data-go="${v}"><span class="ic ${done ? 'ok' : 'warn'}">${done ? '✓' : '•'}</span><div class="grow">${esc(t)}</div><span class="muted small">Open ›</span></div>`).join('')}
        </div>
        <div class="panel"><h2>Recent games</h2>
          ${games.length ? games.slice(0, 6).map(g => `<div class="check-row"><div class="grow"><b>${esc(g.name)}</b><div class="muted small">${esc(g.date)} · ${g.mode === 'checklist' ? 'Rules Checklist' : 'Round-Based'} · ${g.status === 'finished' ? 'Finished' : g.status === 'live' ? 'In progress' : 'Set-up'} · ${g.played}/${g.songs} songs · ${g.cards} cards</div></div><button class="btn sm" data-open="${g.id}">${g.status === 'finished' ? 'View' : 'Open'}</button></div>`).join('') : '<div class="empty">No games yet.</div>'}
          <div class="muted tiny" style="margin-top:10px">Keyboard: <span class="kbd">Space</span> play/pause · <span class="kbd">→</span> next · <span class="kbd">←</span> replay · <span class="kbd">B</span> bingo check · <span class="kbd">F</span> TV fullscreen</div>
        </div>
      </div>`;
    $('#dImport', el).onclick = () => App.show('library');
    $('#dNew', el).onclick = () => App.show('create');
    if ($('#dResume', el)) $('#dResume', el).onclick = async () => { await api('games:open', { id: rec.gameId }); toast('Game restored — press Play when you are ready', 'ok'); App.show('host'); };
    if ($('#dHost', el)) $('#dHost', el).onclick = () => App.show('host');
    $$('[data-go]', el).forEach(r => r.onclick = () => App.show(r.dataset.go));
    $$('[data-open]', el).forEach(b => b.onclick = async () => { await api('games:open', { id: b.dataset.open }); App.show('host'); });
  }
});

document.addEventListener('click', async (e) => {
  const on = e.target.closest && e.target.closest('#lrmOn'); const no = e.target.closest && e.target.closest('#lrmNo');
  if (!on && !no) return;
  App.settings = await api('settings:update', { performance: { lowResource: !!on } });
  App.applyAppearance(); App.info = await api('app:info');
  const b = document.getElementById('lrmRec'); if (b) b.remove();
  if (on) toast('Low Resource Mode is on', 'ok');
});
