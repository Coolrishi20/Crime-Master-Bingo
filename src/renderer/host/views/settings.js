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
          <label class="field">Display duration (s, 0 = whole song)<input type="number" id="oD" min="0" value="${gd.overlay.duration}"></label></div>
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
        <div class="panel"><h2>Mobile remote</h2>${toggleHtml('rA', 'Start the remote service when the app opens', s.remote.autoStart)}<p class="muted small">Address, PIN, paired devices and port: see <a href="#" id="rGo" style="color:var(--pink)">Mobile Host Connection</a>.</p>
          <p class="muted tiny">Data folder: ${esc(App.info.dataDir)}</p></div>
      </div>`;
    const v = id => $(id, el).value, c = id => $(id, el).checked, n = id => Number($(id, el).value);
    $('#sLogo', el).onclick = async () => { await api('settings:pickLogo'); App.settings = await api('settings:get'); App.applyAppearance(); this.render(el); };
    if ($('#sLogoX', el)) $('#sLogoX', el).onclick = async () => { await api('settings:clearLogo'); App.settings = await api('settings:get'); App.applyAppearance(); this.render(el); };
    $('#rGo', el).onclick = (e) => { e.preventDefault(); App.show('mobile'); };
    $('#sSave', el).onclick = async () => {
      const patch = {
        appearance: { scale: Number(v('#sScale')), theme: v('#sTheme') },
        video: { displayId: v('#sDisp') || null, aspect: v('#sAsp'), audioDeviceId: v('#sAudio'), fullscreen: c('#sFs') },
        cards: { textScale: n('#kT') / 100, qr: c('#kQ'), bw: c('#kB'), useLogo: c('#kL') },
        remote: { autoStart: c('#rA') },
        gameDefaults: { clipMode: v('#sClip') === 'full' ? 'full' : Number(v('#sClip')), defaultStart: n('#sStart'), autoAdvanceGap: n('#gG'), volume: n('#gV'), shuffle: c('#gS'), autoAdvance: c('#gA'), pauseOnClaim: c('#gP'), winnerAnimation: c('#gW'), patternPosition: v('#pPos'),
          overlay: { position: v('#oPos'), titleSize: n('#oT'), artistSize: n('#oA'), opacity: n('#oO') / 100, duration: n('#oD'), enabled: c('#oOn') },
          crawler: { speed: Math.max(1, Math.min(10, n('#cS'))), fontSize: n('#cF'), height: n('#cH'), separator: v('#cSep') } }
      };
      App.settings = await api('settings:update', patch);
      App.applyAppearance();
      toast('Settings saved', 'ok');
      if (App.game && await confirmBox('Apply to the current game?', 'Also apply the overlay, crawler, clip and gameplay settings to the game that is loaded now?', 'Apply')) {
        const g = patch.gameDefaults;
        await App.cmd('setOverlay', g.overlay); await App.cmd('setCrawler', g.crawler);
        await App.cmd('setGameSettings', { clipMode: g.clipMode, autoAdvance: g.autoAdvance, autoAdvanceGap: g.autoAdvanceGap, pauseOnClaim: g.pauseOnClaim, winnerAnimation: g.winnerAnimation, patternPosition: g.patternPosition, defaultStart: g.defaultStart });
      }
    };
  }
});
