function drawLicence() {
  const box = document.getElementById('licBox'); if (!box) return;
  api('licence:status').then(l => { box.innerHTML = l.enforced ? `${esc(l.message)}${l.warn ? '<br>' + esc(l.warn) : ''}` : `<span class="badge ok">FREE EDITION</span> Anthem Square is free to use — no licence, account or activation needed. This laptop: <code>${esc(l.device || '')}</code>`; }).catch(() => {});
}
App.register('settings', {
  /** Settings → Performance: Low Resource Mode + optional 720p copies for slow laptops. */
  async drawPerf(box) {
    if (!box || !document.body.contains(box)) return;
    const p = await api('perf:status');
    const on = p.lowResource;
    box.innerHTML = `<h2>⚡ Performance</h2>
      <div class="row">${toggleHtml('pfLow', 'Low Resource Mode', on)}<span class="grow"></span>${p.lowRam ? '<span class="badge warn">Recommended for this laptop</span>' : ''}</div>
      <p class="muted small" style="margin:8px 0">This laptop: <b style="color:#fff">${p.totalRamGB} GB</b> memory · Anthem Square is using about <b style="color:#fff">${p.appMemoryMB} MB</b> right now.</p>
      <div class="small" style="line-height:1.55">Low Resource Mode keeps <b>every game feature</b> — TV video, title overlay, winning patterns, crawler, phone remote, BINGO checks, saving. It reduces:<ul style="margin:6px 0 0 18px;padding:0" class="muted">
        <li>animations, glows, blur and shadow effects (laptop and TV), lighter confetti</li>
        <li>background work while a game is live: loudness analysis, video conversion and new-video checks wait until the game ends</li>
        <li>how often the laptop screen updates the progress bar and checks the video files</li></ul></div>
      <h3 style="margin:14px 0 6px;font-size:14px">Smaller copies of big videos</h3>
      <p class="muted small" style="margin:0 0 8px">High-resolution videos are the hardest thing for a slow laptop. Make a 720p copy of each video above 720p — <b>your original files are never changed</b>, and you can go back to the original from the song's Edit window.</p>
      <div class="row"><button class="btn sm" id="pfOpt" ${p.over720 && p.converter && p.converter.available ? '' : 'disabled'}>Make 720p copies (${p.over720} video${p.over720 === 1 ? '' : 's'})</button><span class="muted small">${p.optimising ? `${p.optimising} in progress` : ''}${p.optimised ? ` · ${p.optimised} already optimised` : ''}${p.converter && !p.converter.available ? 'Converter (ffmpeg) not found' : ''}</span></div>`;
    $('#pfLow', box).onchange = async (e) => { App.settings = await api('settings:update', { performance: { lowResource: e.target.checked } }); App.applyAppearance(); toast(e.target.checked ? 'Low Resource Mode on' : 'Low Resource Mode off', 'ok'); this.drawPerf(box); };
    $('#pfOpt', box).onclick = async () => { if (!await confirmBox('Make 720p copies?', `${p.over720} video(s) above 720p will get a smaller copy in the app's data folder (originals untouched). It runs in the background and pauses during a live game. Allow roughly 1 minute per video on a slow laptop.`, 'Start')) return; const r = await api('library:optimise', {}); toast(`${r.queued} video(s) queued`, 'ok'); this.drawPerf(box); };
  },
  /** Settings → Bingo Rules: default winning rules for NEW games, presets and custom patterns. */
  async drawRules(box) {
    const st = App.settings = await api('settings:get');
    const cnt = st.gameDefaults.roundCount || 3;
    const infos = await api('rules:roundsInfo', { rounds: st.gameDefaults.rounds, count: cnt });
    const presets = st.rulePresets || []; const customs = st.customPatterns || [];
    box.innerHTML = `<div class="row"><h2 class="grow" style="margin:0">🎯 Bingo Rules</h2><button class="btn sm" id="brStd">Restore standard rules</button></div>
      <p class="muted small">How many rounds and which winning patterns for <b style="color:#fff">new games</b>: 3 rounds of One Line → Two Parallel Lines → Full House as standard, or choose L Shape, T Shape, Diagonal, Fast 5 or your own patterns. Tick several for a round and any of them wins. A game's rules can also be changed in <b style="color:#fff">Host Game → Rules</b> until that round starts. Every check — laptop or phone — uses the same rules.</p>
      ${roundCountHtml(cnt)}
      ${roundsSummaryHtml(infos)}
      <div class="row" style="margin-top:10px;flex-wrap:wrap">${Object.keys(infos).map(Number).map(n => `<button class="btn sm" data-chg="${n}">Change Round ${n}…</button>`).join('')}</div>
      <div class="cols c2" style="margin-top:14px;gap:16px">
        <div><div class="eyebrow">Presets</div>
          <div class="row"><select id="brPreset" class="grow">${presets.length ? presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('') : '<option value="">No presets saved yet</option>'}</select><button class="btn sm" id="brApply" ${presets.length ? '' : 'disabled'}>Use preset</button><button class="btn sm ghost" id="brDel" ${presets.length ? '' : 'disabled'}>Delete</button></div>
          <button class="btn sm" id="brSave" style="margin-top:8px">Save current rules as a preset…</button></div>
        <div><div class="eyebrow">Custom patterns</div>
          ${customs.length ? customs.map(c => `<div class="check-row"><div style="width:34px">${patternGridHtml(Array.from({ length: 25 }, (_, i) => c.cells.includes(i)))}</div><div class="grow"><b>${esc(c.name)}</b><div class="muted tiny">${c.cells.length} squares</div></div><button class="btn sm ghost" data-cpe="${c.id}">Edit</button><button class="btn sm danger" data-cpd="${c.id}">Delete</button></div>`).join('') : '<div class="muted small">None yet.</div>'}
          <button class="btn sm" id="brNewCp" style="margin-top:8px">＋ New custom pattern…</button></div></div>`;
    const setRounds = async (rounds, count) => { App.settings = await api('settings:update', { gameDefaults: Object.assign({ rounds }, count ? { roundCount: count } : {}) }); toast('Bingo rules saved for new games', 'ok'); this.drawRules(box); };
    $$('[data-rc]', box).forEach(b => b.onclick = () => setRounds(st.gameDefaults.rounds, cnt + Number(b.dataset.rc)));
    $$('[data-chg]', box).forEach(b => b.onclick = async () => { const n = Number(b.dataset.chg); const r = await ruleEditor(st.gameDefaults.rounds[n], { title: `Round ${n} — winning rules (new games)`, round: n }); if (r) setRounds(Object.assign({}, st.gameDefaults.rounds, { [n]: r })); });
    $('#brStd', box).onclick = async () => { if (await confirmBox('Restore standard rules?', '3 rounds: One Line, Two Parallel Lines, Full House — for new games. Games already created keep their rules.', 'Restore')) setRounds({ 1: [{ id: 'line' }], 2: [{ id: 'twoLines' }], 3: [{ id: 'full' }] }, 3); };
    $('#brSave', box).onclick = async () => { const name = await promptBox('Save preset', 'Preset name', 'My rules'); if (!name) return; App.settings = await api('settings:update', { rulePresets: presets.concat([{ name, roundCount: cnt, rounds: st.gameDefaults.rounds }]) }); toast('Preset saved', 'ok'); this.drawRules(box); };
    if (presets.length) {
      $('#brApply', box).onclick = () => { const p = presets[Number($('#brPreset', box).value)]; if (p) setRounds(p.rounds, p.roundCount || Object.keys(p.rounds).length); };
      $('#brDel', box).onclick = async () => { const i = Number($('#brPreset', box).value); App.settings = await api('settings:update', { rulePresets: presets.filter((_, k) => k !== i) }); this.drawRules(box); };
    }
    $('#brNewCp', box).onclick = async () => { if (await customPatternDialog(null)) this.drawRules(box); };
    $$('[data-cpe]', box).forEach(b => b.onclick = async () => { if (await customPatternDialog(customs.find(c => c.id === b.dataset.cpe))) this.drawRules(box); });
    $$('[data-cpd]', box).forEach(b => b.onclick = async () => { App.settings = await api('settings:update', { customPatterns: customs.filter(c => c.id !== b.dataset.cpd) }); this.drawRules(box); });
  },
  async render(el) {
    this.el = el;
    const s = App.settings = await api('settings:get');
    const displays = await api('displays:list');
    let audioOut = [];
    try { audioOut = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput'); } catch (e) { /* */ }
    const gd = s.gameDefaults;
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Preferences</div><h1>Settings</h1><p>Defaults for new games. Settings for the game in progress can be changed live on the Host Game screen.</p></div><button class="btn primary" id="sSave">Save settings</button></div>
      <div class="cols c2">
        <div class="panel"><h2>Appearance</h2>
          <div class="row">${s.appearance.logo ? `<img src="${fileUrl(s.appearance.logo)}?v=${Date.now()}" style="max-height:56px;background:#fff;border-radius:8px;padding:6px">` : '<span class="muted">No logo</span>'}<button class="btn sm" id="sLogo">Upload logo…</button>${s.appearance.logo ? '<button class="btn sm ghost" id="sLogoX">Remove</button>' : ''}</div>
          <div class="form-grid" style="margin-top:14px"><label class="field">Theme<select id="sTheme"><option value="dark" ${s.appearance.theme !== 'light' ? 'selected' : ''}>Dark (default) — best for live events</option><option value="light" ${s.appearance.theme === 'light' ? 'selected' : ''}>Light — for daytime preparation</option></select></label>
          <label class="field">Interface scaling<select id="sScale">${[0.85, 0.9, 1, 1.1, 1.25, 1.4].map(v => `<option value="${v}" ${Number(s.appearance.scale) === v ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}</select></label></div></div>
        <div class="panel"><h2>Intermission slides (TV)</h2><div id="slPanel"></div></div>
        <div class="panel"><h2>Video &amp; TV</h2><div class="form-grid">
          <label class="field">Audience display<select id="sDisp"><option value="">Automatic (external screen)</option>${displays.map(d => `<option value="${d.id}" ${String(s.video.displayId) === String(d.id) ? 'selected' : ''}>${esc(d.label)} ${d.width}×${d.height}${d.primary ? ' (laptop)' : ''}</option>`).join('')}</select></label>
          <label class="field">Video fit<select id="sAsp">${[['contain', 'Fit (letterbox)'], ['cover', 'Fill & crop'], ['fill', 'Stretch']].map(([v, l]) => `<option value="${v}" ${s.video.aspect === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Audio output<select id="sAudio"><option value="default">Windows default</option>${audioOut.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}" ${s.video.audioDeviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Audio device')}</option>`).join('')}</select></label>
          <label class="field">Default clip length<select id="sClip">${[20, 30, 40, 60, 'full'].map(m => `<option value="${m}" ${String(gd.clipMode) === String(m) ? 'selected' : ''}>${m === 'full' ? 'Full song' : m + ' seconds'}</option>`).join('')}</select></label>
          <label class="field">Default start point (s)<input type="number" id="sStart" min="0" value="${gd.defaultStart}"></label></div>
          <div class="row" style="margin-top:12px">${toggleHtml('sFs', 'Open audience window fullscreen on the TV', s.video.fullscreen)}</div></div>
        <div class="panel"><h2>Live TV preview</h2><div id="sTvp"></div><p class="muted small">Change the song overlay, crawler, pattern panel or video fit below and watch this update. Click <b>Save</b> to keep the changes for new games.</p></div>
        <div class="panel"><h2>Song overlay</h2><div class="form-grid">
          <label class="field">Position<select id="oPos">${['bottom-left', 'bottom-center', 'top-left'].map(p => `<option ${gd.overlay.position === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label class="field">Title size (px @1080p)<input type="number" id="oT" value="${gd.overlay.titleSize}"></label>
          <label class="field">Artist size (px)<input type="number" id="oA" value="${gd.overlay.artistSize}"></label>
          <label class="field">Opacity (%)<input type="number" id="oO" min="0" max="100" value="${Math.round(gd.overlay.opacity * 100)}"></label>
          <label class="field">Display duration (s, 0 = whole song)<input type="number" id="oD" min="0" value="${gd.overlay.duration}"></label>
          <label class="field">Reveal song title after<select id="oR">${[0, 5, 10, 15, 20, 30].map(v => `<option value="${v}" ${Number(gd.overlay.revealDelay || 0) === v ? 'selected' : ''}>${v === 0 ? 'Immediately (off)' : v + ' seconds'}</option>`).join('')}</select></label></div>
          <p class="muted small">Delayed reveal: the TV shows “♪ Guess the song…” with a countdown, then the title — players have to recognise the song first. The countdown pauses when the music pauses. Your laptop and phone always show the title straight away.</p>
          <div class="row" style="margin-top:12px">${toggleHtml('oOn', 'Show song title & artist', gd.overlay.enabled)}</div></div>
        <div class="panel"><h2>Audience crawler</h2><div class="form-grid">
          <label class="field">Scroll speed (1–10)<input type="number" id="cS" min="1" max="10" value="${gd.crawler.speed}"></label>
          <label class="field">Font size (px)<input type="number" id="cF" min="18" max="56" value="${gd.crawler.fontSize}"></label>
          <label class="field">Height (px)<input type="number" id="cH" min="48" max="140" value="${gd.crawler.height}"></label>
          <label class="field">Separator<select id="cSep">${['diamond', 'bar', 'dot', 'star', 'note'].map(p => `<option ${gd.crawler.separator === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label class="field">Winning-pattern panel<select id="pPos">${['top-right', 'top-left', 'bottom-right', 'bottom-left'].map(p => `<option ${gd.patternPosition === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
          <p class="muted small">The crawler always shows the complete played-song history in a continuous loop.</p></div>
        <div class="panel"><h2>Bingo cards</h2><div class="form-grid"><label class="field">Printable text size (%)<input type="number" id="kT" min="80" max="125" step="5" value="${Math.round(s.cards.textScale * 100)}"></label></div>
          <div class="row" style="margin-top:12px;gap:24px">${toggleHtml('kQ', 'QR codes on cards', s.cards.qr)}${toggleHtml('kB', 'Black & white printing', s.cards.bw)}${toggleHtml('kL', 'Logo on cards', s.cards.useLogo)}</div>
          <p class="muted small">Cards are always printed two per A4 sheet.</p></div>
        <div class="panel"><h2>Gameplay</h2><div class="form-grid"><label class="field">After a round is won<select id="gAW"><option value="ask" ${gd.afterWinner !== 'intermission' ? 'selected' : ''}>Ask me: intermission or next round</option><option value="intermission" ${gd.afterWinner === 'intermission' ? 'selected' : ''}>Go to intermission automatically</option></select></label><label class="field">Intermission length (minutes)<input type="number" id="gIM" min="0" max="120" value="${gd.intermissionMinutes != null ? gd.intermissionMinutes : 10}"></label><label class="field">Gap between songs (s)<input type="number" id="gG" min="0" max="30" value="${gd.autoAdvanceGap}"></label><label class="field">Volume (%)<input type="number" id="gV" min="0" max="100" value="${gd.volume}"></label></div>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">${toggleHtml('gWel', 'Welcome screen on the TV before Round 1', !gd.screens || gd.screens.welcome !== false)}${toggleHtml('gEnd', '“Thanks for playing!” screen after the game', !gd.screens || gd.screens.end !== false)}${toggleHtml('lConv', 'Convert unplayable videos to MP4 automatically', !s.library || s.library.autoConvert !== false)}${toggleHtml('gS', 'Shuffle playlist for new games', gd.shuffle)}${toggleHtml('gSA', 'Keep songs by the same artist apart', gd.spreadArtists !== false)}${toggleHtml('gSI', 'Skip quiet intros automatically', gd.skipIntros !== false)}${toggleHtml('gA', 'Auto-play next song', gd.autoAdvance)}${toggleHtml('gP', 'Pause music during bingo verification', gd.pauseOnClaim)}${toggleHtml('gW', 'Winner animation on TV', gd.winnerAnimation)}</div>
          <p class="muted small">Winners are always confirmed by the host. Auto-save is always on (every change is saved immediately, crash-safe).</p></div>
        <div class="panel"><h2>Audio — automatic volume levelling</h2>
          <div class="row">${toggleHtml('aLev', 'AUTO VOLUME LEVELLING', gd.audio.levelling)}</div>
          <div class="form-grid" style="margin-top:12px">
            <label class="field">Loudness target (LUFS)<select id="aT">${[-12, -14, -16, -18, -20, -23].map(v => `<option value="${v}" ${Number(gd.audio.targetLufs) === v ? 'selected' : ''}>${v} LUFS${v === -16 ? ' (recommended)' : v === -14 ? ' (louder)' : v === -20 ? ' (quieter)' : ''}</option>`).join('')}</select></label>
            <label class="field">Maximum amplification (dB)<input type="number" id="aB" min="0" max="20" value="${gd.audio.maxBoostDb}"></label>
            <label class="field">Peak ceiling (dBTP)<select id="aC">${[0, -0.5, -1, -1.5, -2, -3].map(v => `<option value="${v}" ${Number(gd.audio.ceilingDbtp) === v ? 'selected' : ''}>${v} dBTP${v === -1 ? ' (recommended)' : v === 0 ? ' (no headroom)' : v <= -2 ? ' (cheap speakers / PA)' : ''}</option>`).join('')}</select></label>
            <label class="field">Fade in (seconds, 0 = off)<input type="number" id="aFi" min="0" max="5" step="0.1" value="${gd.audio.fadeIn}"></label>
            <label class="field">Fade out (seconds, 0 = off)<input type="number" id="aFo" min="0" max="8" step="0.1" value="${gd.audio.fadeOut}"></label></div>
          <p class="muted small">Every video's loudness is measured once in the background (EBU R128). Playback is then turned up or down so every song sounds equally loud — without touching the original files and never above ${gd.audio.ceilingDbtp} dBTP, so nothing clips. Very quiet videos are boosted by at most the maximum amplification.</p></div>
        <div class="panel"><h2>About</h2><div class="as-about"><img src="../shared/brand/icon.svg" alt="Anthem Square"><div><div class="wm">ANTHEM<em>SQUARE</em></div><div class="muted small" style="margin-top:8px">Music video bingo · version ${esc((App.info && App.info.version) || '')}</div><div class="tl">HEAR IT. MARK IT. <b>OWN IT.</b></div></div></div></div>
        <div class="panel"><h2>Licence &amp; devices</h2><div id="licBox" class="muted small">…</div>
          <details style="margin-top:10px"><summary class="small" style="cursor:pointer;font-weight:700">Your music, your responsibility</summary><p class="small" style="margin:8px 0 0">Anthem Square is software only. It does not supply music or videos, and it does not provide music licences or permission to run events or give prizes. You are responsible for using media you have the rights to play in public and for any permissions your event needs. The music usage report is a record to help you; it is not legal advice.</p></details></div>
        <div class="panel"><h2>App updates</h2>
          <div class="row"><span class="muted">Version <b style="color:#fff">${esc(App.info.version)}</b></span><span class="grow"></span><span id="upState" class="small"></span></div>
          <div class="row" style="margin-top:12px">${toggleHtml('upAuto', 'Check for updates automatically', s.updates ? s.updates.auto !== false : true)}</div>
          <div class="row" style="margin-top:12px"><button class="btn sm" id="upCheck">Check now</button><button class="btn sm primary" id="upAct" style="display:none"></button></div>
          <div id="upBack" class="row" style="margin-top:10px"></div>
          <p class="muted small">Updates come from the Anthem Square releases on GitHub and are installed only between games. Every update must carry Anthem Square's signature, checked on this laptop before anything is installed; an unsigned or altered file is never run. Your games and settings are copied before each update, and you can go back to the previous version. No internet? Nothing happens — the app works fully offline.</p></div>
        <div class="panel" id="perfPanel"></div>
        <div class="panel" id="rulesPanel" style="grid-column:1 / -1"></div>
        <div class="panel"><h2>🏠 Home play</h2>
          <div style="display:flex;flex-direction:column;gap:10px">${toggleHtml('hImg', 'Share cards as images (for WhatsApp)', !!(s.home && s.home.shareImages))}${toggleHtml('hPhone', 'Phone cards for players', !!(s.home && s.home.phoneCards))}${toggleHtml('hTv', 'Show the “Join on your phone” QR code on the TV welcome screen', !s.home || s.home.joinOnTv !== false)}</div>
          <p class="muted small"><b style="color:#fff">Share as images:</b> adds “Share cards as images” to Bingo Cards &amp; Printing — each card is saved as a picture, optionally with a player's name on it.<br><b style="color:#fff">Phone cards:</b> players scan a QR code, type their name and get their own card on their phone. They tap songs to mark them, and pressing BINGO is checked instantly on this laptop. Manage players under <a href="#" id="hGo" style="color:var(--pink)">Mobile Host Connection</a>. Phones must be on the same Wi-Fi.</p></div>
        <div class="panel"><h2>Mobile remote</h2>${toggleHtml('rA', 'Start the remote service when the app opens', s.remote.autoStart)}<p class="muted small">Address, PIN, paired devices and port: see <a href="#" id="rGo" style="color:var(--pink)">Mobile Host Connection</a>.</p>
          <p class="muted tiny">Data folder: ${esc(App.info.dataDir)}</p></div>
      </div>`;
    this.drawRules($('#rulesPanel', el));
    this.drawPerf($('#perfPanel', el));
    const v = id => $(id, el).value, c = id => $(id, el).checked, n = id => Number($(id, el).value);
    App.drawUpdateSettings = (st) => {
      const box = $('#upState', el); const act = $('#upAct', el); if (!box) return;
      st = st || App.update || {};
      const L = { idle: '', checking: 'Checking…', 'up-to-date': '✓ You have the latest version', available: `Update ${st.version} available`, downloading: `Downloading ${st.version || ''} — ${st.percent || 0}%`, downloaded: `✓ ${st.version} ready to install`, 'portable-available': st.unsigned ? `Version ${st.version} is available (not signed — download it from the website)` : `Version ${st.version} is available`, verifying: 'Checking the update is genuine…', blocked: st.error || 'The update did not pass its signature check and was not installed', error: st.error || 'Could not check', off: 'Automatic checks are off', disabled: 'Updates are not available in this build' };
      box.textContent = L[st.state] != null ? L[st.state] : '';
      box.style.color = st.state === 'error' ? 'var(--amber)' : (['downloaded', 'available', 'portable-available'].includes(st.state) ? 'var(--green)' : '');
      act.style.display = ['available', 'downloaded', 'portable-available'].includes(st.state) ? '' : 'none';
      act.textContent = st.state === 'downloaded' ? '⟳ Restart now' : st.state === 'available' ? `⬆ Update to ${st.version}` : 'Open download page';
      act.onclick = () => App.updateAction();
    };
    $('#upCheck', el).onclick = async () => { App.update = await api('update:check'); App.drawUpdateSettings(App.update); };
    App.drawUpdateSettings(); drawLicence();
    api('update:rollbackInfo').then(r => { const b = $('#upBack', el); if (!b || !r.available) return; b.innerHTML = `<button class="btn sm ghost" id="upRoll">Go back to ${esc(r.version)}</button><span class="muted tiny">${r.snapshots.length} data snapshot${r.snapshots.length === 1 ? '' : 's'} kept</span>`;
      $('#upRoll', el).onclick = async () => { if (!await confirmBox('Go back to ' + esc(r.version) + '?', 'Anthem Square closes and reopens on version ' + esc(r.version) + '. Your games and settings are copied first. Games made with newer features may need this newer version again.', 'Go back')) return; await api('update:rollback'); }; }).catch(() => {});
    $('#sLogo', el).onclick = async () => { await api('settings:pickLogo'); App.settings = await api('settings:get'); App.applyAppearance(); this.render(el); };
    if ($('#sLogoX', el)) $('#sLogoX', el).onclick = async () => { await api('settings:clearLogo'); App.settings = await api('settings:get'); App.applyAppearance(); this.render(el); };
    $('#rGo', el).onclick = (e) => { e.preventDefault(); App.show('mobile'); };
    $('#hGo', el).onclick = (e) => { e.preventDefault(); App.show('mobile'); };
    $('#sTheme', el).onchange = async (e) => { App.settings = await api('settings:update', { appearance: { theme: e.target.value } }); App.applyAppearance(); toast(e.target.value === 'light' ? 'Light Mode on — the phone remote follows' : 'Dark Mode on — the phone remote follows', 'ok'); };
    const drawSlides = (sl) => {
      const box = $('#slPanel', el); if (!box) return;
      box.innerHTML = `<p class="muted small" style="margin-top:0">Your own pictures — venue, food & drink offers, sponsors, next week's date — shown full-screen on the TV during intermissions, with the countdown kept at the bottom. Images are copied into the app, so moving the originals is fine.</p>
        <div class="row" style="flex-wrap:wrap;gap:10px">${sl.images.map((i, k) => `<div class="sl-thumb"><img src="${fileUrl(i.file)}" alt=""><div class="row" style="gap:4px;justify-content:center"><button class="btn sm ghost" data-sl-up="${i.id}" ${k ? '' : 'disabled'}>◀</button><button class="btn sm ghost" data-sl-rm="${i.id}" title="Remove">✕</button><button class="btn sm ghost" data-sl-dn="${i.id}" ${k < sl.images.length - 1 ? '' : 'disabled'}>▶</button></div></div>`).join('') || '<div class="muted small">No slides yet.</div>'}</div>
        <div class="row" style="margin-top:12px"><button class="btn sm primary" id="slAdd">＋ Add images…</button>${toggleHtml('slOn', 'Show slides during intermissions', sl.enabled !== false)}<label class="field" style="flex-direction:row;align-items:center;gap:8px">Each slide<select id="slSec">${[5, 8, 10, 15, 20, 30].map(n => `<option value="${n}" ${Number(sl.seconds) === n ? 'selected' : ''}>${n} s</option>`).join('')}</select></label></div>`;
      $('#slAdd', box).onclick = async () => drawSlides(await api('slides:add'));
      $('#slOn', box).onchange = async (e) => drawSlides(await api('slides:set', { enabled: e.target.checked }));
      $('#slSec', box).onchange = async (e) => drawSlides(await api('slides:set', { seconds: Number(e.target.value) }));
      $$('[data-sl-rm]', box).forEach(b => b.onclick = async () => drawSlides(await api('slides:remove', { id: b.dataset.slRm })));
      $$('[data-sl-up]', box).forEach(b => b.onclick = async () => drawSlides(await api('slides:move', { id: b.dataset.slUp, dir: -1 })));
      $$('[data-sl-dn]', box).forEach(b => b.onclick = async () => drawSlides(await api('slides:move', { id: b.dataset.slDn, dir: 1 })));
    };
    drawSlides(s.slides || { enabled: true, seconds: 8, images: [] });
    if (this._tvp) this._tvp.destroy();
    const tvp = this._tvp = tvPreview($('#sTvp', el), { caption: 'Live TV preview — as new games will look' });
    const readTv = () => {
      const g = (id) => $(id, el);
      tvp.update({
        overlay: { enabled: g('#oOn').checked, position: g('#oPos').value, titleSize: Number(g('#oT').value) || 64, artistSize: Number(g('#oA').value) || 38, opacity: (Number(g('#oO').value) || 78) / 100, duration: 0, revealDelay: Number(g('#oR').value) || 0 },
        crawler: { speed: Number(g('#cS').value) || 4, fontSize: Number(g('#cF').value) || 30, height: Number(g('#cH').value) || 72, separator: g('#cSep').value },
        patternPosition: g('#pPos').value, aspect: g('#sAsp').value,
        mode: gd.mode, checklist: gd.checklist, rounds: gd.rounds, roundCount: gd.roundCount
      });
    };
    ['#oOn', '#oPos', '#oT', '#oA', '#oO', '#oR', '#cS', '#cF', '#cH', '#cSep', '#pPos', '#sAsp'].forEach(id => { const x = $(id, el); if (x) { x.addEventListener('input', readTv); x.addEventListener('change', readTv); } });
    readTv();
    $('#sSave', el).onclick = async () => {
      const patch = {
        appearance: { scale: Number(v('#sScale')), theme: v('#sTheme') },
        video: { displayId: v('#sDisp') || null, aspect: v('#sAsp'), audioDeviceId: v('#sAudio'), fullscreen: c('#sFs') },
        cards: { textScale: n('#kT') / 100, qr: c('#kQ'), bw: c('#kB'), useLogo: c('#kL') },
        remote: { autoStart: c('#rA') },
        library: { autoConvert: c('#lConv') },
        updates: { auto: c('#upAuto') },
        home: { shareImages: c('#hImg'), phoneCards: c('#hPhone'), joinOnTv: c('#hTv') },
        gameDefaults: { clipMode: v('#sClip') === 'full' ? 'full' : Number(v('#sClip')), defaultStart: n('#sStart'), autoAdvanceGap: n('#gG'), volume: n('#gV'), shuffle: c('#gS'), spreadArtists: c('#gSA'), skipIntros: c('#gSI'), autoAdvance: c('#gA'), pauseOnClaim: c('#gP'), afterWinner: v('#gAW'), intermissionMinutes: n('#gIM'), winnerAnimation: c('#gW'), patternPosition: v('#pPos'),
          overlay: { position: v('#oPos'), titleSize: n('#oT'), artistSize: n('#oA'), opacity: n('#oO') / 100, duration: n('#oD'), revealDelay: n('#oR'), enabled: c('#oOn') },
          crawler: { speed: Math.max(1, Math.min(10, n('#cS'))), fontSize: n('#cF'), height: n('#cH'), separator: v('#cSep') },
          screens: Object.assign({}, gd.screens || {}, { welcome: c('#gWel'), end: c('#gEnd') }),
          audio: { levelling: c('#aLev'), targetLufs: n('#aT'), maxBoostDb: n('#aB'), fadeIn: n('#aFi'), fadeOut: n('#aFo'), ceilingDbtp: n('#aC'), muted: false } }
      };
      App.settings = await api('settings:update', patch);
      App.applyAppearance();
      toast('Settings saved', 'ok');
      if (App.game && await confirmBox('Apply to the current game?', 'Also apply the overlay, crawler, clip and gameplay settings to the game that is loaded now?', 'Apply')) {
        const g = patch.gameDefaults;
        await App.cmd('setOverlay', g.overlay); await App.cmd('setCrawler', g.crawler); await App.cmd('setAudio', g.audio);
        await App.cmd('setGameSettings', { afterWinner: g.afterWinner, intermissionMinutes: g.intermissionMinutes, clipMode: g.clipMode, autoAdvance: g.autoAdvance, autoAdvanceGap: g.autoAdvanceGap, pauseOnClaim: g.pauseOnClaim, winnerAnimation: g.winnerAnimation, patternPosition: g.patternPosition, defaultStart: g.defaultStart });
      }
    };
  }
});
