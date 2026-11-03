App.register('settings', {
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
          <div class="form-grid" style="margin-top:14px"><label class="field">Theme<select id="sTheme"><option value="crime-master">Crime Master (purple / magenta)</option></select></label>
          <label class="field">Interface scaling<select id="sScale">${[0.85, 0.9, 1, 1.1, 1.25, 1.4].map(v => `<option value="${v}" ${Number(s.appearance.scale) === v ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}</select></label></div></div>
        <div class="panel"><h2>Video &amp; TV</h2><div class="form-grid">
          <label class="field">Audience display<select id="sDisp"><option value="">Automatic (external screen)</option>${displays.map(d => `<option value="${d.id}" ${String(s.video.displayId) === String(d.id) ? 'selected' : ''}>${esc(d.label)} ${d.width}×${d.height}${d.primary ? ' (laptop)' : ''}</option>`).join('')}</select></label>
          <label class="field">Video fit<select id="sAsp">${[['contain', 'Fit (letterbox)'], ['cover', 'Fill & crop'], ['fill', 'Stretch']].map(([v, l]) => `<option value="${v}" ${s.video.aspect === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Audio output<select id="sAudio"><option value="default">Windows default</option>${audioOut.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}" ${s.video.audioDeviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Audio device')}</option>`).join('')}</select></label>
          <label class="field">Default clip length<select id="sClip">${[20, 30, 40, 60, 'full'].map(m => `<option value="${m}" ${String(gd.clipMode) === String(m) ? 'selected' : ''}>${m === 'full' ? 'Full song' : m + ' seconds'}</option>`).join('')}</select></label>
          <label class="field">Default start point (s)<input type="number" id="sStart" min="0" value="${gd.defaultStart}"></label></div>
          <div class="row" style="margin-top:12px">${toggleHtml('sFs', 'Open audience window fullscreen on the TV', s.video.fullscreen)}</div></div>
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
        <div class="panel"><h2>Gameplay</h2><div class="form-grid"><label class="field">Gap between songs (s)<input type="number" id="gG" min="0" max="30" value="${gd.autoAdvanceGap}"></label><label class="field">Volume (%)<input type="number" id="gV" min="0" max="100" value="${gd.volume}"></label></div>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">${toggleHtml('gS', 'Shuffle playlist for new games', gd.shuffle)}${toggleHtml('gA', 'Auto-play next song', gd.autoAdvance)}${toggleHtml('gP', 'Pause music during bingo verification', gd.pauseOnClaim)}${toggleHtml('gW', 'Winner animation on TV', gd.winnerAnimation)}</div>
          <p class="muted small">Winners are always confirmed by the host. Auto-save is always on (every change is saved immediately, crash-safe).</p></div>
        <div class="panel"><h2>Audio — automatic volume levelling</h2>
          <div class="row">${toggleHtml('aLev', 'AUTO VOLUME LEVELLING', gd.audio.levelling)}</div>
          <div class="form-grid" style="margin-top:12px">
            <label class="field">Loudness target (LUFS)<select id="aT">${[-12, -14, -16, -18, -20, -23].map(v => `<option value="${v}" ${Number(gd.audio.targetLufs) === v ? 'selected' : ''}>${v} LUFS${v === -16 ? ' (recommended)' : v === -14 ? ' (louder)' : v === -20 ? ' (quieter)' : ''}</option>`).join('')}</select></label>
            <label class="field">Maximum amplification (dB)<input type="number" id="aB" min="0" max="20" value="${gd.audio.maxBoostDb}"></label>
            <label class="field">Fade in (seconds, 0 = off)<input type="number" id="aFi" min="0" max="5" step="0.1" value="${gd.audio.fadeIn}"></label>
            <label class="field">Fade out (seconds, 0 = off)<input type="number" id="aFo" min="0" max="8" step="0.1" value="${gd.audio.fadeOut}"></label></div>
          <p class="muted small">Every video's loudness is measured once in the background (EBU R128). Playback is then turned up or down so every song sounds equally loud — without touching the original files and never above ${gd.audio.ceilingDbtp} dBTP, so nothing clips. Very quiet videos are boosted by at most the maximum amplification.</p></div>
        <div class="panel"><h2>App updates</h2>
          <div class="row"><span class="muted">Version <b style="color:#fff">${esc(App.info.version)}</b></span><span class="grow"></span><span id="upState" class="small"></span></div>
          <div class="row" style="margin-top:12px">${toggleHtml('upAuto', 'Check for updates automatically', s.updates ? s.updates.auto !== false : true)}</div>
          <div class="row" style="margin-top:12px"><button class="btn sm" id="upCheck">Check now</button><button class="btn sm primary" id="upAct" style="display:none"></button></div>
          <p class="muted small">Updates come from the Crime Master Bingo releases on GitHub. They download in the background (never during a live game) and install only when you choose “Restart to update” or close the app. No internet? Nothing happens — the app works fully offline.</p></div>
        <div class="panel"><h2>Mobile remote</h2>${toggleHtml('rA', 'Start the remote service when the app opens', s.remote.autoStart)}<p class="muted small">Address, PIN, paired devices and port: see <a href="#" id="rGo" style="color:var(--pink)">Mobile Host Connection</a>.</p>
          <p class="muted tiny">Data folder: ${esc(App.info.dataDir)}</p></div>
      </div>`;
    const v = id => $(id, el).value, c = id => $(id, el).checked, n = id => Number($(id, el).value);
    App.drawUpdateSettings = (st) => {
      const box = $('#upState', el); const act = $('#upAct', el); if (!box) return;
      st = st || App.update || {};
      const L = { idle: '', checking: 'Checking…', 'up-to-date': '✓ You have the latest version', available: `Update ${st.version} available`, downloading: `Downloading ${st.version || ''} — ${st.percent || 0}%`, downloaded: `✓ ${st.version} ready to install`, 'portable-available': `Version ${st.version} is available`, error: st.error || 'Could not check', off: 'Automatic checks are off', disabled: 'Updates are not available in this build' };
      box.textContent = L[st.state] != null ? L[st.state] : '';
      box.style.color = st.state === 'error' ? 'var(--amber)' : (['downloaded', 'available', 'portable-available'].includes(st.state) ? 'var(--green)' : '');
      act.style.display = ['available', 'downloaded', 'portable-available'].includes(st.state) ? '' : 'none';
      act.textContent = st.state === 'downloaded' ? '⟳ Restart to update' : st.state === 'available' ? '⬇ Download update' : 'Open download page';
      act.onclick = () => App.updateAction();
    };
    $('#upCheck', el).onclick = async () => { App.update = await api('update:check'); App.drawUpdateSettings(App.update); };
    App.drawUpdateSettings();
    $('#sLogo', el).onclick = async () => { await api('settings:pickLogo'); App.settings = await api('settings:get'); App.applyAppearance(); this.render(el); };
    if ($('#sLogoX', el)) $('#sLogoX', el).onclick = async () => { await api('settings:clearLogo'); App.settings = await api('settings:get'); App.applyAppearance(); this.render(el); };
    $('#rGo', el).onclick = (e) => { e.preventDefault(); App.show('mobile'); };
    $('#sSave', el).onclick = async () => {
      const patch = {
        appearance: { scale: Number(v('#sScale')), theme: v('#sTheme') },
        video: { displayId: v('#sDisp') || null, aspect: v('#sAsp'), audioDeviceId: v('#sAudio'), fullscreen: c('#sFs') },
        cards: { textScale: n('#kT') / 100, qr: c('#kQ'), bw: c('#kB'), useLogo: c('#kL') },
        remote: { autoStart: c('#rA') },
        updates: { auto: c('#upAuto') },
        gameDefaults: { clipMode: v('#sClip') === 'full' ? 'full' : Number(v('#sClip')), defaultStart: n('#sStart'), autoAdvanceGap: n('#gG'), volume: n('#gV'), shuffle: c('#gS'), autoAdvance: c('#gA'), pauseOnClaim: c('#gP'), winnerAnimation: c('#gW'), patternPosition: v('#pPos'),
          overlay: { position: v('#oPos'), titleSize: n('#oT'), artistSize: n('#oA'), opacity: n('#oO') / 100, duration: n('#oD'), revealDelay: n('#oR'), enabled: c('#oOn') },
          crawler: { speed: Math.max(1, Math.min(10, n('#cS'))), fontSize: n('#cF'), height: n('#cH'), separator: v('#cSep') },
          audio: { levelling: c('#aLev'), targetLufs: n('#aT'), maxBoostDb: n('#aB'), fadeIn: n('#aFi'), fadeOut: n('#aFo'), ceilingDbtp: gd.audio.ceilingDbtp, muted: false } }
      };
      App.settings = await api('settings:update', patch);
      App.applyAppearance();
      toast('Settings saved', 'ok');
      if (App.game && await confirmBox('Apply to the current game?', 'Also apply the overlay, crawler, clip and gameplay settings to the game that is loaded now?', 'Apply')) {
        const g = patch.gameDefaults;
        await App.cmd('setOverlay', g.overlay); await App.cmd('setCrawler', g.crawler); await App.cmd('setAudio', g.audio);
        await App.cmd('setGameSettings', { clipMode: g.clipMode, autoAdvance: g.autoAdvance, autoAdvanceGap: g.autoAdvanceGap, pauseOnClaim: g.pauseOnClaim, winnerAnimation: g.winnerAnimation, patternPosition: g.patternPosition, defaultStart: g.defaultStart });
      }
    };
  }
});
