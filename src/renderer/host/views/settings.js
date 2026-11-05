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
    box.innerHTML = `<h3>Low Resource Mode</h3>
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
    box.innerHTML = `<div class="row"><span class="grow"></span><button class="btn sm" id="brStd">Restore standard rules</button></div>
      <p class="st-hint" style="margin:0 0 12px">Tick several rules in a round and any of them wins. A game\'s own rules can still be changed on Host Game → Rules until that round starts.</p>
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
    const tog = (id, label, on, hint) => `<div class="st-tog">${toggleHtml(id, label, on)}${hint ? `<div class="st-hint">${hint}</div>` : ''}</div>`;
    const sec = (id, icon, title, sub, body) => `<section class="st-sec" id="st-${id}" data-sec="${id}"><div class="st-head"><span class="st-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span><div><h2>${title}</h2><p>${sub}</p></div></div>${body}</section>`;
    const SECTIONS = [['general', 'General'], ['tv', 'TV screen'], ['play', 'Gameplay'], ['rules', 'Bingo rules'], ['sound', 'Sound'], ['cards', 'Cards & printing'], ['phone', 'Phone & home play'], ['perf', 'Library & performance'], ['about', 'Updates & about']];
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Preferences</div><h1>Settings</h1><p>Defaults for new games. The game in progress can be changed live on Host Game.</p></div>
        <div class="row"><input type="search" id="stFind" placeholder="Find a setting…" style="width:220px"><span id="stSaved" class="st-saved">✓ All changes saved</span><button class="btn primary" id="sSave" title="Changes save automatically — this saves immediately">Save now</button></div></div>
      <div id="stApply"></div>
      <div class="st-layout">
        <nav class="st-nav" id="stNav">${SECTIONS.map(([k, l], i) => `<a href="#" data-go="${k}" class="${i ? '' : 'on'}">${l}</a>`).join('')}</nav>
        <div class="st-body" id="stBody">
        ${sec('general', '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 'General', 'How Anthem Square looks on this laptop.', `
          <div class="form-grid">
            <label class="field">Theme<select id="sTheme"><option value="dark" ${s.appearance.theme !== 'light' ? 'selected' : ''}>Dark (recommended)</option><option value="light" ${s.appearance.theme === 'light' ? 'selected' : ''}>Light</option></select></label>
            <label class="field">Interface size<select id="sScale">${[0.85, 0.9, 1, 1.1, 1.25, 1.4].map(v => `<option value="${v}" ${Number(s.appearance.scale) === v ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}</select></label></div>
          <div class="st-row"><div><b>Your logo</b><div class="st-hint">Shown on cards and the TV next to the Anthem Square mark.</div></div><div class="row">${s.appearance.logo ? `<img src="${fileUrl(s.appearance.logo)}?v=${Date.now()}" style="max-height:44px;background:#fff;border-radius:8px;padding:4px">` : '<span class="muted small">No logo</span>'}<button class="btn sm" id="sLogo">Upload logo…</button>${s.appearance.logo ? '<button class="btn sm ghost" id="sLogoX">Remove</button>' : ''}</div></div>`)}
        ${sec('tv', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>', 'TV screen', 'What the room sees. The preview updates as you change anything here.', `
          <div class="st-tv">
            <div class="st-tv-fields">
              <h3>Display</h3>
              <div class="form-grid">
                <label class="field">TV / projector<select id="sDisp"><option value="">Automatic</option>${displays.map(d => `<option value="${d.id}" ${String(s.video.displayId) === String(d.id) ? 'selected' : ''}>${esc(d.label)} ${d.width}×${d.height}${d.primary ? ' (laptop)' : ''}</option>`).join('')}</select></label>
                <label class="field">Picture fit<select id="sAsp">${[['contain', 'Fit (letterbox)'], ['cover', 'Fill & crop'], ['fill', 'Stretch']].map(([v, l]) => `<option value="${v}" ${s.video.aspect === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
              ${tog('sFs', 'Open the TV window full screen', s.video.fullscreen)}
              <h3>Song title &amp; artist</h3>
              ${tog('oOn', 'Show song title & artist on the TV', gd.overlay.enabled)}
              <div class="form-grid">
                <label class="field">Position<select id="oPos">${[['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['top-left', 'Top left']].map(([v, l]) => `<option value="${v}" ${gd.overlay.position === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="field">Reveal the title after<select id="oR">${[0, 5, 10, 15, 20, 30].map(v => `<option value="${v}" ${Number(gd.overlay.revealDelay || 0) === v ? 'selected' : ''}>${v === 0 ? 'Straight away' : v + ' seconds'}</option>`).join('')}</select></label>
                <label class="field">Title size (px)<input type="number" id="oT" value="${gd.overlay.titleSize}"></label>
                <label class="field">Artist size (px)<input type="number" id="oA" value="${gd.overlay.artistSize}"></label>
                <label class="field">Background opacity (%)<input type="number" id="oO" min="0" max="100" value="${Math.round(gd.overlay.opacity * 100)}"></label>
                <label class="field">Show for (s, 0 = whole song)<input type="number" id="oD" min="0" value="${gd.overlay.duration}"></label></div>
              <div class="st-hint">With a delayed reveal the TV shows “♪ Guess the song…” and a countdown first. Your laptop and phone always show the title.</div>
              <h3>Played-songs crawler &amp; winning patterns</h3>
              <div class="form-grid">
                <label class="field">Crawler speed (1–10)<input type="number" id="cS" min="1" max="10" value="${gd.crawler.speed}"></label>
                <label class="field">Text size (px)<input type="number" id="cF" min="18" max="56" value="${gd.crawler.fontSize}"></label>
                <label class="field">Height (px)<input type="number" id="cH" min="48" max="140" value="${gd.crawler.height}"></label>
                <label class="field">Separator<select id="cSep">${['diamond', 'bar', 'dot', 'star', 'note'].map(p => `<option ${gd.crawler.separator === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
                <label class="field">Winning-pattern panel<select id="pPos">${[['top-right', 'Top right'], ['top-left', 'Top left'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left']].map(([v, l]) => `<option value="${v}" ${gd.patternPosition === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
              <h3>Extra TV screens <span class="badge">OPTIONAL</span></h3>
              ${tog('gW', 'Winner screen and animation', gd.winnerAnimation)}
              ${tog('gWel', 'Welcome screen before Round 1', !!(gd.screens && gd.screens.welcome))}
              ${tog('gEnd', '“Thanks for playing!” screen after the game', !!(gd.screens && gd.screens.end))}
              <details class="st-more"><summary>Intermission slides</summary><div id="slPanel"></div></details>
            </div>
            <div class="st-tv-prev"><div id="sTvp"></div></div>
          </div>`)}
        ${sec('play', '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>', 'Gameplay', 'How songs play in new games. Change the current game on Host Game.', `
          <div class="form-grid">
            <label class="field">Clip length<select id="sClip">${[20, 30, 40, 60, 'full'].map(m => `<option value="${m}" ${String(gd.clipMode) === String(m) ? 'selected' : ''}>${m === 'full' ? 'Full song' : m + ' seconds'}</option>`).join('')}</select></label>
            <label class="field">Start each clip at (s)<input type="number" id="sStart" min="0" value="${gd.defaultStart}"></label>
            <label class="field">Gap between songs (s)<input type="number" id="gG" min="0" max="30" value="${gd.autoAdvanceGap}"></label>
            <label class="field">Volume (%)<input type="number" id="gV" min="0" max="100" value="${gd.volume}"></label>
            <label class="field">After a round is won<select id="gAW"><option value="ask" ${gd.afterWinner !== 'intermission' ? 'selected' : ''}>Ask me</option><option value="intermission" ${gd.afterWinner === 'intermission' ? 'selected' : ''}>Go to the intermission</option></select></label>
            <label class="field">Intermission length (min)<input type="number" id="gIM" min="0" max="120" value="${gd.intermissionMinutes != null ? gd.intermissionMinutes : 10}"></label></div>
          <div class="st-togs">
            ${tog('gA', 'Play the next song automatically', gd.autoAdvance)}
            ${tog('gSI', 'Skip quiet intros', gd.skipIntros !== false, 'Clips start where the music starts.')}
            ${tog('gS', 'Shuffle the playlist', gd.shuffle)}
            ${tog('gSA', 'Keep songs by the same artist apart', gd.spreadArtists !== false)}
            ${tog('gP', 'Pause the music while checking a BINGO', gd.pauseOnClaim)}</div>
          <div class="st-hint">Winners are always confirmed by you. Every change during a game is saved straight away.</div>`)}
        ${sec('rules', '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>', 'Bingo rules', 'Rounds and winning patterns for new games, presets and your own patterns.', '<div id="rulesPanel" class="st-plain"></div>')}
        ${sec('sound', '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>', 'Sound', 'Where the sound comes out, and automatic volume levelling.', `
          <div class="form-grid"><label class="field">Sound output<select id="sAudio"><option value="default">Windows default</option>${audioOut.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}" ${s.video.audioDeviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Audio device')}</option>`).join('')}</select></label></div>
          ${tog('aLev', 'Automatic volume levelling', gd.audio.levelling, 'Every song plays equally loud. Your video files are never changed.')}
          <details class="st-more"><summary>Levelling details</summary><div class="form-grid" style="margin-top:10px">
            <label class="field">Loudness target<select id="aT">${[-12, -14, -16, -18, -20, -23].map(v => `<option value="${v}" ${Number(gd.audio.targetLufs) === v ? 'selected' : ''}>${v} LUFS${v === -16 ? ' (recommended)' : v === -14 ? ' (louder)' : v === -20 ? ' (quieter)' : ''}</option>`).join('')}</select></label>
            <label class="field">Peak ceiling<select id="aC">${[0, -0.5, -1, -1.5, -2, -3].map(v => `<option value="${v}" ${Number(gd.audio.ceilingDbtp) === v ? 'selected' : ''}>${v} dBTP${v === -1 ? ' (recommended)' : v === 0 ? ' (no headroom)' : v <= -2 ? ' (small speakers / PA)' : ''}</option>`).join('')}</select></label>
            <label class="field">Maximum boost (dB)<input type="number" id="aB" min="0" max="20" value="${gd.audio.maxBoostDb}"></label>
            <label class="field">Fade in (s, 0 = off)<input type="number" id="aFi" min="0" max="5" step="0.1" value="${gd.audio.fadeIn}"></label>
            <label class="field">Fade out (s, 0 = off)<input type="number" id="aFo" min="0" max="8" step="0.1" value="${gd.audio.fadeOut}"></label></div>
            <div class="st-hint">Loudness is measured once per video (EBU R128); playback never goes above the peak ceiling, so nothing clips.</div></details>
          <label class="field" style="max-width:340px;margin-top:10px">Talkover: while you hold “Hold to talk”, the music drops by<select id="aTk">${[[-8, 'a little (8 dB)'], [-11, 'some (11 dB)'], [-14, 'about three-quarters (14 dB, recommended)'], [-18, 'a lot (18 dB)'], [-24, 'almost silent (24 dB)']].map(([v, l]) => `<option value="${v}" ${Number(gd.audio.talkoverDb || -14) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`)}
        ${sec('cards', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', 'Cards & printing', 'Defaults for printed cards. Footer message and font are on the Bingo Cards page.', `
          <div class="form-grid"><label class="field">Text size (%)<input type="number" id="kT" min="80" max="125" step="5" value="${Math.round(s.cards.textScale * 100)}"></label></div>
          <div class="st-togs">${tog('kQ', 'QR code on each card', s.cards.qr, 'Lets you check a claim by scanning the card.')}${tog('kL', 'Your logo on cards', s.cards.useLogo)}${tog('kB', 'Black & white (saves ink)', s.cards.bw)}</div>
          <div class="st-hint">Always two cards per A4 sheet.</div>`)}
        ${sec('phone', '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>', 'Phone & home play', 'Your phone as a remote, and options for players at home.', `
          ${tog('rA', 'Start the phone remote when the app opens', s.remote.autoStart, 'Pairing PIN, QR code and paired phones: <a href="#" id="rGo">Mobile Host Connection</a>.')}
          <h3>Home play</h3>
          <div class="st-togs">${tog('hImg', 'Share cards as images (e.g. WhatsApp)', !!(s.home && s.home.shareImages), 'Adds “Share cards as images” to Bingo Cards &amp; Printing.')}
          ${tog('hPhone', 'Phone cards for players', !!(s.home && s.home.phoneCards), 'Players scan a QR code and get their own card on their phone. Manage them under <a href="#" id="hGo">Mobile Host Connection</a>.')}
          ${tog('hTv', 'Show the “Join on your phone” QR on the welcome screen', !s.home || s.home.joinOnTv !== false)}</div>`)}
        ${sec('perf', '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', 'Library & performance', 'Video conversion, Low Resource Mode and smaller copies for slow laptops.', `
          ${tog('lConv', 'Convert unplayable videos to MP4 automatically', !s.library || s.library.autoConvert !== false, 'A copy is made; your original file is never changed.')}
          <div id="perfPanel" class="st-plain"></div>`)}
        ${sec('about', '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', 'Updates & about', 'Version, updates, licence and the data folder.', `
          <div class="as-about"><img src="../shared/brand/icon.svg" alt="Anthem Square"><div><div class="wm">ANTHEM<em>SQUARE</em></div><div class="muted small" style="margin-top:8px">Music video bingo · version ${esc((App.info && App.info.version) || '')}</div><div class="tl">HEAR IT. MARK IT. <b>OWN IT.</b></div></div></div>
          <h3>App updates</h3>
          <div class="row"><span class="muted">Version <b>${esc(App.info.version)}</b></span><span class="grow"></span><span id="upState" class="small"></span></div>
          ${tog('upAuto', 'Check for updates automatically', s.updates ? s.updates.auto !== false : true)}
          <div class="row" style="margin-top:8px"><button class="btn sm" id="upCheck">Check now</button><button class="btn sm primary" id="upAct" style="display:none"></button></div>
          <div id="upBack" class="row" style="margin-top:10px"></div>
          <div class="st-hint">Updates install only between games, and only if they carry Anthem Square's signature. Your games and settings are copied first, and you can go back to the previous version. Offline? Nothing happens.</div>
          <h3>Licence &amp; devices</h3><div id="licBox" class="muted small">…</div>
          <details class="st-more"><summary>Your music, your responsibility</summary><p class="small" style="margin:8px 0 0">Anthem Square is software only. It does not supply music or videos, and it does not provide music licences or permission to run events or give prizes. You are responsible for using media you have the rights to play in public and for any permissions your event needs. The music usage report is a record to help you; it is not legal advice.</p></details>
          <h3>Help</h3>
          <div class="st-row" style="margin-top:0;border-top:0;padding-top:0"><div><b>Save diagnostics</b><div class="st-hint">One file to send when something goes wrong: version, Windows, hardware, settings, library and game status, recent errors. No videos, phone secrets, passwords or player names.</div></div><button class="btn sm" id="stDiag">Save diagnostics…</button></div>
          <p class="muted tiny" style="margin-top:12px">Data folder: ${esc(App.info.dataDir)}</p>`)}
        </div>
      </div>`;
    // section navigation, highlight on scroll, and quick find
    const body = $('#stBody', el);
    $$('#stNav a', el).forEach(a => a.onclick = (e) => { e.preventDefault(); const t = $('#st-' + a.dataset.go, el); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    const spy = () => { const secs = $$('.st-sec', el); let cur = secs[0]; secs.forEach(x => { if (x.getBoundingClientRect().top < 160) cur = x; }); $$('#stNav a', el).forEach(a => a.classList.toggle('on', cur && a.dataset.go === cur.dataset.sec)); };
    const scroller = el.closest('#main') || window; scroller.addEventListener('scroll', spy, { passive: true }); this._spy = () => scroller.removeEventListener('scroll', spy);
    $('#stFind', el).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('.st-sec', el).forEach(x => { const hit = !q || x.textContent.toLowerCase().includes(q) || Array.from(x.querySelectorAll('option')).some(o => o.textContent.toLowerCase().includes(q)); x.classList.toggle('st-hide', !hit); });
      $$('.st-sec .field, .st-sec .st-tog', el).forEach(f => f.classList.toggle('st-hit', !!q && f.textContent.toLowerCase().includes(q)));
    };
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
    $('#stDiag', el).onclick = async () => { const r = await api('diag:save', {}); if (r) toast('Diagnostics saved — ' + r.file.split(/[\\/]/).pop(), 'ok', 6000); };
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
    let saveT = null; const saved = $('#stSaved', el);
    const autoSave = () => { clearTimeout(saveT); saved.textContent = 'Saving…'; saved.classList.add('busy'); saveT = setTimeout(() => $('#sSave', el).onclick({ auto: true }), 700); };
    $$('#stBody input, #stBody select', el).forEach(x => { if (['stFind'].includes(x.id) || x.closest('#rulesPanel, #perfPanel, #slPanel')) return; x.addEventListener('change', autoSave); if (x.type === 'number') x.addEventListener('input', autoSave); });
    $('#sSave', el).onclick = async (ev) => {
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
          audio: { levelling: c('#aLev'), targetLufs: n('#aT'), maxBoostDb: n('#aB'), fadeIn: n('#aFi'), fadeOut: n('#aFo'), ceilingDbtp: n('#aC'), talkoverDb: n('#aTk'), muted: false } }
      };
      App.settings = await api('settings:update', patch);
      App.applyAppearance();
      saved.textContent = '✓ All changes saved'; saved.classList.remove('busy');
      if (!(ev && ev.auto)) toast('Settings saved', 'ok');
      // a game is loaded: offer to apply these defaults to it as well (never automatically)
      const ap = $('#stApply', el);
      if (App.game && ap && !ap.firstChild) { ap.innerHTML = '<div class="banner"><div class="grow"><h3>A game is loaded</h3><div class="muted">These are defaults for new games. Apply the TV, clip and gameplay settings to the loaded game too?</div></div><button class="btn primary" id="stApplyGo">Apply to this game</button><button class="btn ghost" id="stApplyNo">Not now</button></div>'; $('#stApplyNo', ap).onclick = () => { ap.innerHTML = ''; }; $('#stApplyGo', ap).onclick = async () => { ap.innerHTML = ''; await applyToGame(); toast('Applied to the loaded game', 'ok'); }; }
    };
    const applyToGame = async () => {
      { const patch = { gameDefaults: App.settings.gameDefaults };
        const g = patch.gameDefaults;
        await App.cmd('setOverlay', g.overlay); await App.cmd('setCrawler', g.crawler); await App.cmd('setAudio', g.audio);
        await App.cmd('setGameSettings', { afterWinner: g.afterWinner, intermissionMinutes: g.intermissionMinutes, clipMode: g.clipMode, autoAdvance: g.autoAdvance, autoAdvanceGap: g.autoAdvanceGap, pauseOnClaim: g.pauseOnClaim, winnerAnimation: g.winnerAnimation, patternPosition: g.patternPosition, defaultStart: g.defaultStart });
      }
    };
  }
});
