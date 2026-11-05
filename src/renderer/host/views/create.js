App.register('create', {
  step: 1,
  data: null,
  STEPS: ['Game details', 'Playlist', 'Playback', 'Audience screen', 'Bingo cards', 'Printing', 'Pre-flight test', 'Mobile remote', 'Start game'],
  async render(el, arg) {
    this.el = el;
    const gd = App.settings.gameDefaults;
    if (!this.data || arg === 'new') {
      this.data = { name: '', date: new Date().toISOString().slice(0, 10), venue: '', useLogo: !!App.settings.appearance.logo, playlistId: null, cards: 100,
        settings: { clipMode: gd.clipMode, defaultStart: gd.defaultStart, skipIntros: gd.skipIntros !== false, spreadArtists: gd.spreadArtists !== false, shuffle: gd.shuffle, volume: gd.volume, autoAdvance: gd.autoAdvance, autoAdvanceGap: gd.autoAdvanceGap,
          overlay: Object.assign({}, gd.overlay), crawler: Object.assign({}, gd.crawler), screens: Object.assign({ welcome: true, end: true, startTime: '', message: '' }, gd.screens || {}), patternPosition: gd.patternPosition, mode: gd.mode || 'rounds', checklist: JSON.parse(JSON.stringify(gd.checklist || [])) } };
      this.step = 1; this.created = null;
    }
    // continuing set-up of an existing game
    if (App.game && App.game.status === 'setup' && this.created !== App.game.gameId && arg !== 'new') { this.created = App.game.gameId; this.step = Math.max(this.step, 6); }
    this.draw();
  },
  draw() {
    const el = this.el;
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Step ${this.step} of 9</div><h1>Create Game</h1><p>${this.created ? `Setting up <b>${esc(App.game ? App.game.name : '')}</b>` : 'A guided set-up — about two minutes.'}</p></div>${this.created ? '<button class="btn" id="cNew">Start a different new game</button>' : ''}</div>
      <div class="steps">${this.STEPS.map((s, i) => `<div class="st ${i + 1 === this.step ? 'on' : (i + 1 < this.step ? 'done' : '')}" data-s="${i + 1}">${i + 1 < this.step ? '✓ ' : ''}${i + 1}. ${s}</div>`).join('')}</div>
      <div class="panel" id="cBody"></div>
      <div class="row" style="margin-top:16px"><button class="btn" id="cBack">‹ Back</button><span class="grow"></span><button class="btn primary lg" id="cNext">Next ›</button></div>`;
    $$('.st', el).forEach(s => s.onclick = () => { const n = Number(s.dataset.s); if (this.created ? n >= 6 : n <= 5) { this.step = n; this.draw(); } });
    if ($('#cNew', el)) $('#cNew', el).onclick = () => { this.created = null; this.data = null; this.render(el, 'new'); };
    $('#cBack', el).disabled = this.step === 1 || (this.created && this.step === 6);
    $('#cBack', el).onclick = () => { this.collect(); this.step--; this.draw(); };
    $('#cNext', el).onclick = () => this.nextStep();
    this['step' + this.step]($('#cBody', el));
  },
  collect() { if (this.collectFn) { this.collectFn(); this.collectFn = null; } },
  async nextStep() {
    this.collect();
    const d = this.data;
    if (this.step === 1 && !d.name.trim()) return toast('Give the game a name', 'err');
    if (this.step === 2) {
      if (!d.playlistId) return toast('Choose a playlist', 'err');
      const v = await api('playlists:validate', { id: d.playlistId });
      if (!v.ok) return toast(`This playlist needs ${v.needed} more playable unique song(s) — minimum 40.`, 'err', 6000);
    }
    if (this.step === 5) {
      const n = Number(d.cards);
      if (!(n >= 1 && n <= 999)) return toast('Choose between 1 and 999 cards', 'err');
      try {
        const g = await api('games:create', { name: d.name, date: d.date, venue: d.venue, logo: d.useLogo ? App.settings.appearance.logo : null, playlistId: d.playlistId, cards: n, settings: d.settings });
        this.created = g.id;
        toast(`Game created — ${g.cards} unique cards generated and saved`, 'ok', 5000);
      } catch (e) { return; }
    }
    if (this.step === 9) return;
    this.step++; this.draw();
  },

  async applyTemplate(t) {
    const gd = App.settings.gameDefaults; const d = this.data;
    const base = { clipMode: gd.clipMode, defaultStart: gd.defaultStart, skipIntros: gd.skipIntros !== false, spreadArtists: gd.spreadArtists !== false, shuffle: gd.shuffle, volume: gd.volume, autoAdvance: gd.autoAdvance, autoAdvanceGap: gd.autoAdvanceGap, overlay: Object.assign({}, gd.overlay), crawler: Object.assign({}, gd.crawler), screens: Object.assign({}, gd.screens || {}), patternPosition: gd.patternPosition, mode: gd.mode || 'rounds', checklist: JSON.parse(JSON.stringify(gd.checklist || [])) };
    d.settings = Object.assign(base, JSON.parse(JSON.stringify(t.settings || {})));
    if (t.playlistId && t.playlistName) d.playlistId = t.playlistId;
    d.cards = t.cards || d.cards; if (t.venue) d.venue = t.venue;
    d.templateId = t.id;
    toast(`Using template “${t.name}”${t.playlistId && !t.playlistName ? ' — its playlist no longer exists, choose another' : ''}`, t.playlistId && !t.playlistName ? 'err' : 'ok', 5000);
  },
  step1(b) {
    const d = this.data;
    b.innerHTML = `<div id="gTpl"></div><h2>Game details</h2><div class="form-grid">
      <label class="field">Game name *<input type="text" id="gName" value="${esc(d.name)}" placeholder="e.g. Thursday Night Music Bingo"></label>
      <label class="field">Date<input type="date" id="gDate" value="${esc(d.date)}"></label>
      <label class="field">Venue (optional)<input type="text" id="gVenue" value="${esc(d.venue)}" placeholder="e.g. The Red Lion"></label></div>
      <div class="row" style="margin-top:16px">${toggleHtml('gLogo', 'Use my logo on cards & TV', d.useLogo)}<button class="btn sm" id="gPick">${App.settings.appearance.logo ? 'Change logo…' : 'Upload logo…'}</button>
      ${App.settings.appearance.logo ? `<img src="${fileUrl(App.settings.appearance.logo)}" style="max-height:40px;background:#fff;border-radius:6px;padding:4px">` : '<span class="muted small">No logo uploaded</span>'}</div>
      <h2 style="margin-top:22px">Game mode</h2>${modeCardsHtml(d.settings.mode)}
      <div id="gCk" style="margin-top:14px;${d.settings.mode === 'checklist' ? '' : 'display:none'}"><div class="eyebrow" style="margin-bottom:8px">Winning rules checklist</div><div id="gCkEd"></div></div>`;
    const ck = checklistEditor($('#gCkEd', b), d.settings.checklist, (l) => { d.settings.checklist = l; });
    $$('input[name=gmode]', b).forEach(r => r.onchange = () => { d.settings.mode = r.value; $$('.mode-card', b).forEach(c => c.classList.toggle('on', c.querySelector('input').checked)); $('#gCk', b).style.display = r.value === 'checklist' ? '' : 'none'; });
    $('#gPick', b).onclick = async () => { this.collectFn(); const p = await api('settings:pickLogo'); if (p) { App.settings = await api('settings:get'); App.applyAppearance(); this.data.useLogo = true; this.draw(); } };
    api('templates:list').then(ts => {
      const box = $('#gTpl', b); if (!box || !ts.length) return;
      box.innerHTML = `<div class="row" style="margin-bottom:16px;padding:12px 14px;border-radius:12px;background:var(--bg-2)"><b>Start from a template</b><select id="gTplSel"><option value="">— none —</option>${ts.map(t => `<option value="${t.id}" ${d.templateId === t.id ? 'selected' : ''}>${esc(t.name)}${t.playlistName ? ' · ' + esc(t.playlistName) : ''}</option>`).join('')}</select><button class="btn sm ghost" id="gTplDel" ${d.templateId ? '' : 'disabled'}>Delete template</button><span class="muted small">Fills in the playlist, cards, game mode, rules, clips and TV screens. You can still change anything.</span></div>`;
      $('#gTplSel', b).onchange = async (e) => { const t = ts.find(x => x.id === e.target.value); if (!t) { d.templateId = null; return; } this.collectFn(); await this.applyTemplate(t); this.draw(); };
      $('#gTplDel', b).onclick = async () => { const t = ts.find(x => x.id === d.templateId); if (!t) return; if (await confirmBox('Delete this template?', `“${esc(t.name)}” will be removed. Games made from it are not affected.`, 'Delete', true)) { await api('templates:delete', { id: t.id }); d.templateId = null; this.draw(); } };
    });
    this.collectFn = () => { d.settings.checklist = ck.get(); d.name = $('#gName', b).value; d.date = $('#gDate', b).value; d.venue = $('#gVenue', b).value; d.useLogo = $('#gLogo', b).checked; };
  },
  async step2(b) {
    const pls = await api('playlists:list');
    const d = this.data;
    b.innerHTML = `<h2>Choose a playlist</h2>${pls.length ? pls.map(p => `<label class="check-row" style="cursor:pointer"><input type="radio" name="pl" value="${p.id}" ${d.playlistId === p.id ? 'checked' : ''} ${p.validation.ok ? '' : 'disabled'}>
      <div class="grow"><b>${esc(p.name)}</b><div class="muted small">${p.validation.uniquePlayable} unique playable songs of ${p.songIds.length}</div></div>
      ${p.validation.ok ? '<span class="badge ok">READY</span>' : `<span class="badge warn">ADD ${p.validation.needed} MORE</span>`}</label>`).join('') : '<div class="empty">No playlists yet. Create one in Playlists.</div>'}
      <p class="muted small">Playlists need at least 40 unique songs that are playable and have a title and artist. The game takes a snapshot — editing the playlist later won't change this game.</p>
      <button class="btn sm" id="gGoPl">Manage playlists ›</button>`;
    $('#gGoPl', b).onclick = () => App.show('playlists');
    this.collectFn = () => { const r = b.querySelector('input[name=pl]:checked'); d.playlistId = r ? r.value : null; };
  },
  step3(b) {
    const s = this.data.settings;
    b.innerHTML = `<h2>Playback settings</h2>
      <div class="field" style="margin-bottom:14px"><span class="muted small" style="font-weight:700">Clip length</span><div class="seg" id="gClip">${[20, 30, 40, 60, 'full'].map(m => `<button data-m="${m}" class="${String(s.clipMode) === String(m) ? 'on' : ''}">${m === 'full' ? 'Full song' : m + ' s'}</button>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field">Default clip start (seconds into each video)<input type="number" id="gStart" min="0" step="1" value="${s.defaultStart}"></label>
        <label class="field">Gap between songs (seconds)<input type="number" id="gGap" min="0" max="30" value="${s.autoAdvanceGap}"></label>
        <label class="field"><span>Volume: <b id="gVolV">${s.volume}</b>%</span><input type="range" id="gVol" min="0" max="100" value="${s.volume}"></label>
      </div>
      <div class="row" style="margin-top:16px;gap:28px">${toggleHtml('gShuf', 'Shuffle the playlist (saved before the game starts)', s.shuffle)}${toggleHtml('gSpread', 'Keep songs by the same artist apart', s.spreadArtists !== false)}${toggleHtml('gIntro', 'Skip quiet intros automatically', s.skipIntros !== false)}${toggleHtml('gAuto', 'Auto-play the next song', s.autoAdvance)}${toggleHtml('gOv', 'Show song title & artist on the TV', s.overlay.enabled)}</div>
      <p class="muted small"><b>Skip quiet intros:</b> each clip starts where the music actually begins (silent openings, dialogue and slow scenes are skipped), found by the volume analysis. A start point you set for a song, or a default clip start above 0, always wins. Individual songs can have their own start and end points — set them with <b>Edit</b> in the Music Library.</p>`;
    $$('#gClip button', b).forEach(x => x.onclick = () => { s.clipMode = x.dataset.m === 'full' ? 'full' : Number(x.dataset.m); $$('#gClip button', b).forEach(y => y.classList.toggle('on', y === x)); });
    $('#gVol', b).oninput = (e) => { $('#gVolV', b).textContent = e.target.value; };
    this.collectFn = () => { s.defaultStart = Number($('#gStart', b).value) || 0; s.autoAdvanceGap = Number($('#gGap', b).value) || 0; s.volume = Number($('#gVol', b).value); s.shuffle = $('#gShuf', b).checked; s.spreadArtists = $('#gSpread', b).checked; s.skipIntros = $('#gIntro', b).checked; s.autoAdvance = $('#gAuto', b).checked; s.overlay.enabled = $('#gOv', b).checked; };
  },
  step4(b) {
    const s = this.data.settings;
    s.overlay = Object.assign({ titleSize: 64, artistSize: 38, opacity: 0.78 }, s.overlay); s.crawler = Object.assign({ height: 72, separator: 'diamond' }, s.crawler);
    b.innerHTML = `<h2>Audience screen</h2>
      <div class="cols tvp-cols"><div>
        <div class="form-grid">
          <label class="field">Winning-pattern panel<select id="gPP">${['top-right', 'top-left', 'bottom-right', 'bottom-left'].map(p => `<option ${s.patternPosition === p ? 'selected' : ''} value="${p}">${p.replace('-', ' ')}</option>`).join('')}</select></label>
          <label class="field">Song title position<select id="gOP">${['bottom-left', 'bottom-center', 'top-left'].map(p => `<option ${s.overlay.position === p ? 'selected' : ''} value="${p}">${p.replace('-', ' ')}</option>`).join('')}</select></label>
          <label class="field"><span>Song title size: <b id="gTSV">${s.overlay.titleSize}</b>px</span><input type="range" id="gTS" min="36" max="110" value="${s.overlay.titleSize}"></label>
          <label class="field">Reveal song title after<select id="gRev">${[0, 5, 10, 15, 20, 30].map(v => `<option value="${v}" ${Number(s.overlay.revealDelay || 0) === v ? 'selected' : ''}>${v ? v + ' seconds (guess first)' : 'Immediately'}</option>`).join('')}</select></label>
          <label class="field"><span>Crawler speed: <b id="gCSV">${s.crawler.speed}</b>/10</span><input type="range" id="gCS" min="1" max="10" value="${s.crawler.speed}"></label>
          <label class="field"><span>Crawler text size: <b id="gCFV">${s.crawler.fontSize}</b>px</span><input type="range" id="gCF" min="18" max="56" value="${s.crawler.fontSize}"></label>
          <label class="field"><span>Crawler height: <b id="gCHV">${s.crawler.height}</b>px</span><input type="range" id="gCH" min="48" max="140" value="${s.crawler.height}"></label>
          <label class="field">Crawler separator<select id="gSep">${['diamond', 'bar', 'dot', 'star', 'note'].map(p => `<option ${s.crawler.separator === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label class="field">We start at (welcome screen countdown)<input type="time" id="gStartAt" value="${esc((s.screens && s.screens.startTime) || '')}"></label>
          <label class="field">Welcome message (optional)<input type="text" id="gWMsg" maxlength="120" value="${esc((s.screens && s.screens.message) || '')}" placeholder="e.g. Grab your cards at the bar!"></label>
        </div>
        <div class="row" style="margin-top:12px">${toggleHtml('gOvOn', 'Show song title & artist on the TV', s.overlay.enabled !== false)}</div>
        <p class="muted small">The TV shows only the music video, the song title &amp; artist, the winning pattern${s.mode === 'checklist' ? ' (here: your rules checklist)' : ''}, and a scrolling list of every song played so far — directly below the video.</p>
      </div>
      <div><div id="gTvp"></div></div></div>`;
    const prev = tvPreview($('#gTvp', b), { caption: 'Live TV preview — exactly what the TV will show' });
    const read = () => {
      s.patternPosition = $('#gPP', b).value;
      Object.assign(s.overlay, { position: $('#gOP', b).value, titleSize: Number($('#gTS', b).value), artistSize: Math.round(Number($('#gTS', b).value) * 0.6), revealDelay: Number($('#gRev', b).value), enabled: $('#gOvOn', b).checked });
      Object.assign(s.crawler, { speed: Number($('#gCS', b).value), fontSize: Number($('#gCF', b).value), height: Number($('#gCH', b).value), separator: $('#gSep', b).value });
      [['gTSV', 'gTS'], ['gCSV', 'gCS'], ['gCFV', 'gCF'], ['gCHV', 'gCH']].forEach(([l, i]) => { $('#' + l, b).textContent = $('#' + i, b).value; });
      prev.update({ overlay: s.overlay, crawler: s.crawler, patternPosition: s.patternPosition, mode: s.mode, checklist: s.checklist, rounds: App.settings.gameDefaults.rounds, roundCount: App.settings.gameDefaults.roundCount, name: this.data.name });
    };
    b.querySelectorAll('input, select').forEach(x => { x.addEventListener('input', read); x.addEventListener('change', read); });
    read();
    this.collectFn = () => { read(); prev.destroy(); s.screens = Object.assign({ welcome: true, end: true }, s.screens || {}, { startTime: $('#gStartAt', b).value, message: $('#gWMsg', b).value }); };
  },
  step5(b) {
    const d = this.data;
    b.innerHTML = `<h2>Bingo cards</h2>
      <div class="row" style="align-items:flex-end;gap:20px"><label class="field">How many cards? (1–999)<input type="number" id="gCards" min="1" max="999" value="${d.cards}" style="width:160px;font-size:24px"></label>
      <div class="seg">${[20, 40, 50, 100, 120, 200].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div>
      <div class="muted" id="gSheets"></div></div>
      <p class="muted">Each card is a unique 5×5 grid of 25 different songs (no free square), numbered 001 upwards and saved permanently with the game — card 457 will always be the same card. You can generate more cards later; existing numbers are never reissued.</p>
      <p><b>Clicking Next creates the game</b>, shuffles and locks the play order, and generates the cards.</p>`;
    const upd = () => { const n = Number($('#gCards', b).value) || 0; $('#gSheets', b).textContent = `= ${Math.ceil(n / 2)} A4 sheet${Math.ceil(n / 2) === 1 ? '' : 's'} (2 cards per sheet)`; };
    $('#gCards', b).oninput = upd; upd();
    $$('.seg button', b).forEach(x => x.onclick = () => { $('#gCards', b).value = x.dataset.n; upd(); });
    $('#cNext', this.el).textContent = 'Create game & generate cards ›';
    const tb = document.createElement('button'); tb.className = 'btn'; tb.id = 'gTplSave'; tb.textContent = 'Save these choices as a template…'; tb.style.marginTop = '8px';
    b.appendChild(tb);
    tb.onclick = async () => { this.collectFn(); const name = await promptBox('Save as template', 'Template name (e.g. Friday Pub Night)', d.name || ''); if (!name) return; const t = await api('templates:save', { name, playlistId: d.playlistId, cards: d.cards, venue: d.venue, settings: d.settings }); d.templateId = t.id; toast(`Template “${t.name}” saved — pick it in step 1 next time`, 'ok', 5000); };
    this.collectFn = () => { d.cards = Number($('#gCards', b).value); };
  },
  step6(b) { $('#cNext', this.el).textContent = 'Next ›'; App.views.cards.renderPrintPanel(b, App.game && App.game.gameId); },
  async step7(b) {
    b.innerHTML = `<h2>Pre-flight test</h2><div class="row" style="margin-bottom:12px"><button class="btn primary" id="pfAud">Open audience window on TV</button><button class="btn" id="pfFs">Toggle TV fullscreen (F)</button><button class="btn" id="pfTest">▶ Play 8-second audio/video test</button><button class="btn" id="pfRun">Re-run checks</button></div><div id="pfList"></div>
      <p class="muted small">The test plays a few seconds of the first song on the TV — it is not counted as played. Check the sound comes out of the TV/PA (set Windows' sound output, or pick the audio device in Settings → Video).</p>`;
    const run = async () => { const r = await api('game:preflight'); $('#pfList', b).innerHTML = r.checks.map(c => `<div class="check-row"><span class="ic ${c.ok ? 'ok' : (c.warn ? 'warn' : 'bad')}">${c.ok ? '✓' : (c.warn ? '!' : '×')}</span><div><b>${esc(c.label)}</b><div class="muted small">${esc(c.detail)}</div></div></div>`).join(''); };
    $('#pfAud', b).onclick = async () => { await api('audience:open'); setTimeout(run, 1200); };
    $('#pfFs', b).onclick = () => api('audience:fullscreen');
    $('#pfTest', b).onclick = async () => { const r = await api('audience:test'); toast(`Testing: ${r.title} — ${r.artist}`, 'ok'); setTimeout(run, 1500); };
    $('#pfRun', b).onclick = run;
    run();
  },
  step8(b) { App.views.mobile.renderInto(b, true); },
  step9(b) {
    const g = App.game;
    b.innerHTML = `<div style="text-align:center;padding:30px 10px">
      <div class="eyebrow">Everything is ready</div><div class="display" style="font-size:48px;margin:8px 0">${esc(g ? g.name : '')}</div>
      <p class="muted">${g ? `${g.totals.songs} songs · ${g.totals.cards} cards · ${g.settings.clipMode === 'full' ? 'full songs' : g.settings.clipMode + '-second clips'}` : ''}</p>
      ${g && g.mode === 'checklist' ? `<div class="eyebrow" style="margin-top:14px">Rules checklist — win in any order</div><div style="display:flex;justify-content:center;gap:18px;margin:14px 0;flex-wrap:wrap">${g.checklist.items.map(i => `<div style="width:110px"><div style="width:60px;margin:0 auto 8px">${patternGridHtml(i.example)}</div><div class="tiny" style="font-weight:800">${esc(i.label)}</div></div>`).join('')}</div>` : `<div style="display:flex;justify-content:center;gap:24px;margin:20px 0">${Array.from({ length: (g && g.roundCount) || 3 }, (_, i) => i + 1).map(n => { const r = (g && g.roundRules && g.roundRules[n]) || { label: CMBPatterns.LABELS[n], examples: CMBPatterns.examples(n) }; return `<div style="width:130px"><div style="width:70px;margin:0 auto 8px">${patternGridHtml(r.examples[0])}</div><b class="small">Round ${n}</b><div class="tiny muted">${esc(r.label)}</div></div>`; }).join('')}</div>`}
      <p class="muted small">${g && g.mode === 'checklist' ? 'The checklist can be changed in Host Game until the game starts.' : 'Winning rules can be changed in Host Game → 🎯 Rules until each round starts.'}</p>
      <button class="btn primary xl" id="go">▶ START ROUND 1</button>
      <p class="muted small" style="margin-top:14px">Round 1 can also be started from your phone.</p></div>`;
    $('#cNext', this.el).style.display = 'none';
    $('#go', b).onclick = async () => {
      if (!App.audience.open && !(App.game && App.game.audienceConnected)) await api('audience:open');
      const r = await App.cmd('startRound', { round: 1 });
      if (r && r.ok) { if (r.warning) toast(r.warning, 'err'); this.data = null; this.created = null; App.show('host'); }
    };
  }
});
