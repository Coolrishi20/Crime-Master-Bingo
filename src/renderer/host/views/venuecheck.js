/* 2.6 Venue Check: a two-minute check at the venue, before doors open.
 * TV picture → speakers → phone reaches the laptop → smooth video. Nothing here needs a game
 * or the internet, and nothing changes unless the host says so. */
(function () {
  const STEPS = [
    { id: 'tv', title: 'TV picture', blurb: 'Shows a test card on the TV so you can see it reaches the screen, all the way to the edges.' },
    { id: 'sound', title: 'Sound', blurb: 'Plays three notes and a chord through the same speakers the songs will use.' },
    { id: 'phone', title: 'Your phone', blurb: 'Checks your phone can reach this laptop over the venue’s Wi-Fi.' },
    { id: 'video', title: 'Smooth video', blurb: 'Plays 5 seconds of one of your videos off-screen and counts dropped frames.' }
  ];
  const ICON = { ok: '✓', warn: '⚠', fail: '✗', skip: '–' };
  const TIPS = {
    tvNone: ['Check the TV is on the right HDMI input.', 'On the laptop press <b>Windows + P</b> and choose <b>Extend</b>.', 'Try another HDMI cable or port.', 'Then press <b>Show test card</b> again.'],
    tvCrop: ['On the TV remote, find <b>Picture size</b> or <b>Aspect</b> and choose <b>Just scan</b>, <b>Screen fit</b>, <b>Full pixel</b> or <b>16:9 original</b>.', 'If the TV has no such option, it\'s fine to carry on: titles stay inside the safe area.'],
    soundNone: ['Turn up the TV or amplifier, and check it isn\'t muted.', 'Pick the right speakers below. With HDMI, choose the TV or amplifier name.', 'In Windows, right-click the speaker icon → Sound settings, and check the output there too.'],
    soundQuiet: ['Turn up the TV or amplifier first; keep the Anthem Square volume around 85.', 'Volume levelling keeps every song at the same loudness, so set the room level once now.'],
    phone: ['Phone and laptop must be on the <b>same Wi-Fi</b>. Mobile data won\'t work.', 'Many venue and guest Wi-Fi networks stop devices talking to each other (“client isolation”). If the phone can\'t connect, use your phone\'s <b>hotspot</b> for the laptop, or a small travel router.', 'Windows may ask to allow Anthem Square on the network: choose <b>Allow</b> for private networks.', 'You can still run the whole night from the laptop.'],
    video: ['Turn on <b>Low Resource Mode</b> (Settings → Performance).', 'Plug the laptop into power and close other programs.', 'Convert very large videos to 1080p in the Music Library (Media check).']
  };

  App.register('venuecheck', {
    async render(el) {
      this.el = el; this.step = 0; this.res = {}; this.started = Date.now();
      this.last = await api('venue:last');
      this.displays = await api('displays:list');
      const s = await api('settings:get'); this.settings = s;
      this.displayId = s.video.displayId || (this.displays.find(d => !d.primary) || this.displays[0] || {}).id;
      el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Before doors open</div><h1>Venue Check</h1><p>Four quick checks, about two minutes: TV picture, sound, your phone and smooth video. No game or internet needed.</p></div>
        <div class="muted small" id="vcLast"></div></div>
        <div class="cols vc-cols"><div class="panel" id="vcStep"></div><div class="panel"><div class="eyebrow">Results</div><div id="vcRes" class="vc-res"></div><div id="vcFoot" style="margin-top:12px"></div></div></div>`;
      $('#vcLast', el).textContent = this.last ? `Last check: ${new Date(this.last.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '';
      this.renderStep(); this.renderRes();
    },
    leave() { this.stopPoll(); api('venue:tv', { off: true }).catch(() => {}); },
    stopPoll() { clearInterval(this.poll); this.poll = null; },
    set(id, status, note) { this.res[id] = { status, note: note || '' }; this.renderRes(); },
    next() { this.stopPoll(); this.step++; this.renderStep(); },
    tips(list) { return `<ul class="vc-tips">${list.map(t => `<li>${t}</li>`).join('')}</ul>`; },
    renderRes() {
      const box = $('#vcRes', this.el); if (!box) return;
      box.innerHTML = STEPS.map((st, i) => { const r = this.res[st.id]; return `<div class="vc-row ${r ? r.status : ''} ${i === this.step ? 'cur' : ''}"><span class="vc-ic">${r ? ICON[r.status] : (i + 1)}</span><div><b>${st.title}</b><div class="muted small">${r ? esc(r.note) : (i === this.step ? 'Checking now' : 'Not checked yet')}</div></div></div>`; }).join('');
      const done = STEPS.every(st => this.res[st.id]);
      $('#vcFoot', this.el).innerHTML = done ? `<button class="btn primary" id="vcSave">Save results</button> <button class="btn" id="vcAgain">Start again</button>` : '';
      if (done) {
        $('#vcSave', this.el).onclick = async () => { await api('venue:save', { results: this.res }); api('venue:tv', { off: true }).catch(() => {}); toast('Venue check saved', 'ok'); this.last = { at: new Date().toISOString() }; $('#vcLast', this.el).textContent = 'Last check: just now'; };
        $('#vcAgain', this.el).onclick = () => { this.res = {}; this.step = 0; this.renderStep(); this.renderRes(); };
      }
    },
    async renderStep() {
      const box = $('#vcStep', this.el); if (!box) return;
      this.renderRes();
      if (this.step >= STEPS.length) {
        const bad = STEPS.filter(st => this.res[st.id] && this.res[st.id].status === 'fail').length;
        const warn = STEPS.filter(st => this.res[st.id] && this.res[st.id].status === 'warn').length;
        const secs = Math.round((Date.now() - this.started) / 1000);
        box.innerHTML = `<div class="eyebrow">Done in ${Math.floor(secs / 60)} min ${secs % 60} s</div><h2 class="display" style="font-size:30px;margin:6px 0">${bad ? 'Some things need fixing' : warn ? 'Ready, with a couple of notes' : 'All good. Ready for the night!'}</h2>
          <p class="muted">${bad ? 'Fix the items marked ✗ and run the check again. Anything you can\'t fix, you can still work around: the whole night runs from the laptop.' : 'Save the results so you can see later when this venue was last checked.'}</p>
          <div class="row" style="margin-top:12px"><button class="btn" id="vcOff">Hide the test card</button></div>`;
        $('#vcOff', box).onclick = () => api('venue:tv', { off: true });
        return;
      }
      const st = STEPS[this.step];
      const head = `<div class="eyebrow">Step ${this.step + 1} of ${STEPS.length}</div><h2 class="display" style="font-size:28px;margin:4px 0 6px">${st.title}</h2><p class="muted">${st.blurb}</p>`;
      const skip = `<button class="btn" id="vcSkip">Skip this check</button>`;
      if (st.id === 'tv') {
        box.innerHTML = head + `<label class="field" style="max-width:420px">TV screen<select id="vcDisp">${this.displays.map(d => `<option value="${d.id}" ${String(d.id) === String(this.displayId) ? 'selected' : ''}>${esc(d.label)} · ${d.width}×${d.height}${d.primary ? ' (this laptop)' : ''}</option>`).join('')}</select></label>
          ${this.displays.length < 2 ? '<div class="banner warn" style="margin:8px 0">Only one screen found. Connect the TV and press <b>Windows + P</b> → <b>Extend</b>, then come back to this page.</div>' : ''}
          <div class="row" style="margin-top:10px"><button class="btn primary" id="vcShow">Show test card</button>${skip}</div>
          <div id="vcAsk" class="vc-ask" hidden><b>Can you see the whole orange frame on the TV?</b><div class="row"><button class="btn primary" data-a="ok">Yes, all of it</button><button class="btn" data-a="crop">Edges are cut off</button><button class="btn" data-a="none">Nothing on the TV</button></div></div><div id="vcTip"></div>`;
        $('#vcDisp', box).onchange = (e) => { this.displayId = e.target.value; };
        $('#vcShow', box).onclick = async () => { const r = await api('venue:tv', { displayId: this.displayId }); if (r) $('#vcAsk', box).hidden = false; };
        $$('#vcAsk [data-a]', box).forEach(b => b.onclick = async () => {
          const a = b.dataset.a; const d = this.displays.find(x => String(x.id) === String(this.displayId));
          if (a === 'none') { $('#vcTip', box).innerHTML = this.tips(TIPS.tvNone); this.set('tv', 'fail', 'Nothing showed on the TV'); return; }
          if (d && !d.primary) await api('venue:useDisplay', { displayId: d.id });
          this.set('tv', a === 'ok' ? 'ok' : 'warn', a === 'ok' ? `Test card fills ${d ? d.label : 'the TV'}` : 'TV crops the edges (set picture size to Just scan / Screen fit)');
          if (a === 'crop') { $('#vcTip', box).innerHTML = this.tips(TIPS.tvCrop) + '<button class="btn primary" id="vcNext">Next: sound</button>'; $('#vcNext', box).onclick = () => this.next(); } else this.next();
        });
      } else if (st.id === 'sound') {
        let outs = []; try { outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput'); } catch (e) { /* */ }
        const curOut = this.settings.video.audioDeviceId || 'default';
        box.innerHTML = head + `<label class="field" style="max-width:420px">Speakers<select id="vcOut">${(outs.length ? outs : [{ deviceId: 'default', label: 'System default' }]).map(o => `<option value="${esc(o.deviceId)}" ${o.deviceId === curOut ? 'selected' : ''}>${esc(o.label || (o.deviceId === 'default' ? 'System default' : 'Speakers'))}</option>`).join('')}</select></label>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="vcPlay">Play test sound</button>${skip}</div>
          <div id="vcAsk" class="vc-ask" hidden><b>Did you hear three notes and a chord from the venue speakers?</b><div class="row"><button class="btn primary" data-a="ok">Yes, loud and clear</button><button class="btn" data-a="quiet">Too quiet</button><button class="btn" data-a="none">No sound</button></div></div><div id="vcTip"></div>`;
        $('#vcOut', box).onchange = async (e) => { await api('audience:audioDevice', { deviceId: e.target.value }); this.settings.video.audioDeviceId = e.target.value; toast('Speakers changed. Play the test sound again.', 'ok'); };
        $('#vcPlay', box).onclick = async () => { const r = await api('venue:tv', { displayId: this.displayId, sound: true }); if (r) setTimeout(() => { const a = $('#vcAsk', box); if (a) a.hidden = false; }, 1500); };
        $$('#vcAsk [data-a]', box).forEach(b => b.onclick = () => {
          const a = b.dataset.a; const lbl = $('#vcOut', box).selectedOptions[0].textContent;
          if (a === 'ok') { this.set('sound', 'ok', 'Heard through ' + lbl); this.next(); return; }
          $('#vcTip', box).innerHTML = this.tips(a === 'none' ? TIPS.soundNone : TIPS.soundQuiet) + `<div class="row"><button class="btn" id="vcRetry">Play it again</button><button class="btn" id="vcNext">Carry on anyway</button></div>`;
          this.set('sound', a === 'none' ? 'fail' : 'warn', a === 'none' ? 'No sound from the speakers' : 'Sound was too quiet');
          $('#vcRetry', box).onclick = () => $('#vcPlay', box).click(); $('#vcNext', box).onclick = () => this.next();
        });
      } else if (st.id === 'phone') {
        let info = await api('remote:info');
        if (!info.running) { try { info = await api('remote:start'); } catch (e) { /* shown below */ } }
        const nets = (info.addresses || []);
        box.innerHTML = head + (nets.length ? '' : '<div class="banner warn" style="margin:8px 0"><b>This laptop isn\'t on a network.</b> Join the venue Wi-Fi (or your phone\'s hotspot), then press Check again.</div>') +
          `<div class="row" style="align-items:flex-start;gap:18px;margin-top:8px">${info.qr ? `<img src="${info.qr}" alt="QR code to connect your phone" width="180" height="180" style="border-radius:10px;background:#fff">` : ''}
          <div class="grow"><p>Scan with your phone's camera, or open <b>${esc(info.qrUrl || info.url || '')}</b>. PIN <b class="num">${esc(info.pin || '')}</b>.</p>
          <div id="vcPh" class="vc-wait">Waiting for a phone…</div><div class="row" style="margin-top:10px"><button class="btn" id="vcCant">My phone can't connect</button>${skip}</div></div></div><div id="vcTip"></div>`;
        const t0 = Date.now(); const start = (info.connected || []).map(c => c.deviceId);
        const check = async () => {
          const i = await apiQuiet('remote:info'); if (!i) return;
          const on = (i.connected || []);
          if (on.length) { this.set('phone', 'ok', `${on[0].name || 'Phone'} connected` + (start.length ? '' : ' just now')); this.stopPoll(); setTimeout(() => this.next(), 900); }
          else if (Date.now() - t0 > 45000 && !$('#vcTip', box).innerHTML) { $('#vcTip', box).innerHTML = '<b>Still waiting after 45 seconds.</b>' + this.tips(TIPS.phone); }
        };
        this.poll = setInterval(check, 2000); check();
        $('#vcCant', box).onclick = () => { $('#vcTip', box).innerHTML = this.tips(TIPS.phone) + '<button class="btn" id="vcNext">Carry on without the phone</button>'; this.set('phone', 'fail', 'Phone couldn\'t reach the laptop'); $('#vcNext', box).onclick = () => this.next(); };
      } else if (st.id === 'video') {
        box.innerHTML = head + `<div class="row" style="margin-top:10px"><button class="btn primary" id="vcRun">Run 5-second test</button>${skip}</div><div id="vcOut2" style="margin-top:10px"></div><div id="vcTip"></div>`;
        $('#vcRun', box).onclick = async () => {
          $('#vcRun', box).disabled = true; $('#vcOut2', box).textContent = 'Playing 5 seconds off-screen…';
          let r; try { r = await api('health:decodeTest'); } catch (e) { r = { ok: false, error: e.message }; }
          $('#vcRun', box).disabled = false;
          if (!r || !r.ok) { $('#vcOut2', box).textContent = 'The test couldn\'t run: ' + ((r && r.error) || 'no video found'); this.set('video', 'skip', 'Not tested: ' + ((r && r.error) || 'no video')); return; }
          const pct = r.pct || 0; const st2 = pct <= 2 ? 'ok' : pct <= 8 ? 'warn' : 'fail';
          $('#vcOut2', box).innerHTML = `<b>${pct}% dropped frames</b> playing “${esc(r.title || '')}”.`;
          this.set('video', st2, `${pct}% dropped frames`);
          if (st2 === 'ok') this.next(); else { $('#vcTip', box).innerHTML = this.tips(TIPS.video) + '<button class="btn" id="vcNext">Finish</button>'; $('#vcNext', box).onclick = () => this.next(); }
        };
      }
      const sk = $('#vcSkip', box); if (sk) sk.onclick = () => { this.set(st.id, 'skip', 'Skipped'); this.next(); };
    }
  });
})();
