/* Anthem Square — song check run-through (Playlists → ▶ Check songs…).
 * Plays a few seconds of every song FROM WHERE THE GAME WILL START IT (your start point >
 * default clip start > detected quiet intro), on the laptop only — never on the TV. The host
 * flags problems with one tap (wrong video, bad start, sound, other) and can fix a start point
 * straight away; flags are saved on the song and listed at the end. */
(function () {
  'use strict';
  const REASONS = ['Wrong video', 'Bad start', 'No / low sound', 'Poor picture', 'Other'];

  /** Same start rule as the game engine (engine.clipFor). */
  function startFor(s) {
    const gd = App.settings.gameDefaults || {};
    if (s.clipStart != null && s.clipStart !== '') return { t: Number(s.clipStart), why: 'your start point' };
    if (Number(gd.defaultStart) > 0) return { t: Number(gd.defaultStart), why: 'default clip start' };
    if (gd.skipIntros !== false && s.audio && s.audio.introEnd > 0) return { t: s.audio.introEnd, why: 'quiet intro skipped' };
    return { t: 0, why: 'from the beginning' };
  }

  async function songCheck(playlist) {
    const lib = (await api('library:list')).songs; const byId = new Map(lib.map(s => [s.id, s]));
    let list = playlist.songIds.map(id => byId.get(id)).filter(Boolean);
    if (!list.length) return toast('This playlist has no songs yet', 'err');
    let secs = 3, i = 0, paused = false, timer = null, flagged = new Map(list.filter(s => s.flag).map(s => [s.id, s.flag]));
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="sc-wrap">
        <div class="sc-video"><video id="scV" playsinline preload="auto"></video><div class="sc-err" id="scErr" hidden></div></div>
        <div class="sc-info">
          <div class="eyebrow" id="scN"></div>
          <div class="sc-title" id="scT"></div><div class="muted" id="scA"></div>
          <div class="small muted" id="scStart" style="margin-top:6px"></div>
          <div class="progress" style="margin-top:12px"><div class="fill" id="scP" style="width:0"></div></div>
          <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn sm" id="scPrev" title="Previous (←)">⏮</button><button class="btn sm" id="scPause" title="Pause (Space)">❚❚ Pause</button><button class="btn sm" id="scNext" title="Next (→)">⏭ Next</button>
            <div class="seg" id="scSecs">${[3, 5, 8].map(n => `<button data-s="${n}" class="${n === secs ? 'on' : ''}">${n} s</button>`).join('')}</div></div>
          <div class="eyebrow" style="margin-top:16px">Problem with this song?</div>
          <div class="row" id="scFlags" style="margin-top:6px;flex-wrap:wrap;gap:6px">${REASONS.map(r => `<button class="btn sm" data-r="${r}">⚑ ${r}</button>`).join('')}<button class="btn sm ghost" id="scClear">Clear flag</button></div>
          <div class="row" style="margin-top:10px"><button class="btn sm" id="scEdit">✎ Fix start / details…</button><span class="muted small" id="scFlagNow"></span></div>
          <div class="muted tiny" style="margin-top:10px">Plays on this laptop only — the TV is not used. Keys: Space pause · → next · ← back · F flag “Bad start”.</div>
        </div>
      </div>`;
    const $b = (q) => body.querySelector(q);
    const v = $b('#scV'); v.volume = 0.85;
    const draw = () => {
      const s = list[i]; const st = startFor(s);
      $b('#scN').textContent = `Song ${i + 1} of ${list.length}`;
      $b('#scT').textContent = s.title || s.fileName; $b('#scA').textContent = s.artist || '';
      $b('#scStart').textContent = `Starts at ${fmtTime(st.t)} — ${st.why}`;
      const f = flagged.get(s.id); $b('#scFlagNow').textContent = f ? `Flagged: ${f.reason}` : '';
      $$('#scFlags [data-r]', body).forEach(b => b.classList.toggle('primary', !!f && f.reason === b.dataset.r));
    };
    const stop = () => { clearInterval(timer); timer = null; };
    const play = () => {
      stop(); const s = list[i]; draw(); $b('#scErr').hidden = true;
      const st = startFor(s);
      if (s.status === 'missing' || !s.path) return fail('File missing');
      v.src = fileUrl(s.path);
      v.onloadedmetadata = () => { try { v.currentTime = Math.min(st.t, Math.max(0, (v.duration || st.t + 1) - 1)); } catch (e) { /* */ } if (!paused) v.play().catch(() => {}); };
      v.onerror = () => fail('This video will not play');
      let t0 = null;
      timer = setInterval(() => {
        if (paused || v.readyState < 2) return;
        if (t0 == null) t0 = v.currentTime;
        const done = Math.max(0, v.currentTime - t0);
        $b('#scP').style.width = Math.min(100, done / secs * 100) + '%';
        if (done >= secs) next();
      }, 100);
    };
    const fail = (why) => { $b('#scErr').hidden = false; $b('#scErr').textContent = '⚠ ' + why; const s = list[i]; if (!flagged.has(s.id)) setFlag('Other', why); timer = setTimeout(() => next(), 1600); };
    const next = () => { stop(); if (i < list.length - 1) { i++; play(); } else finish(); };
    const prev = () => { stop(); i = Math.max(0, i - 1); play(); };
    const setFlag = async (reason, note) => {
      const s = list[i];
      const r = await api('library:update', { id: s.id, fields: { flag: reason ? { reason, note: note || '' } : null } });
      if (reason) flagged.set(s.id, r.flag); else flagged.delete(s.id);
      list[i] = Object.assign(s, { flag: r.flag }); draw();
    };
    let closeFn = null;
    const finish = () => { stop(); v.pause(); if (closeFn) closeFn('done'); };
    $b('#scPause').onclick = () => { paused = !paused; $b('#scPause').textContent = paused ? '▶ Resume' : '❚❚ Pause'; if (paused) v.pause(); else v.play().catch(() => {}); };
    $b('#scNext').onclick = next; $b('#scPrev').onclick = prev;
    $$('#scSecs button', body).forEach(b => b.onclick = () => { secs = Number(b.dataset.s); $$('#scSecs button', body).forEach(x => x.classList.toggle('on', x === b)); });
    $$('#scFlags [data-r]', body).forEach(b => b.onclick = () => setFlag(b.dataset.r));
    $b('#scClear').onclick = () => setFlag(null);
    $b('#scEdit').onclick = async () => {
      if (!paused) $b('#scPause').onclick();
      await editSong(list[i], async () => { const fresh = (await api('library:list')).songs.find(x => x.id === list[i].id); if (fresh) list[i] = fresh; draw(); });
    };
    const keys = (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); $b('#scPause').onclick(); } else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'f' || e.key === 'F') setFlag('Bad start');
    };
    document.addEventListener('keydown', keys);
    window.__songCheck = { next, index: () => i, flagged: () => Array.from(flagged.keys()) };
    const r = await modal({ title: `▶ Song check — ${esc(playlist.name)}`, size: 'wide', body, onMount: (b, close) => { closeFn = close; play(); }, buttons: [{ label: 'Stop', value: 'stop' }] });
    stop(); v.pause(); v.removeAttribute('src'); v.load(); document.removeEventListener('keydown', keys); window.__songCheck = null;
    // summary
    const fl = list.filter(s => flagged.has(s.id));
    const checked = r === 'done' ? list.length : i + 1;
    const rows = fl.map(s => `<div class="check-row"><span class="ic warn">⚑</span><div class="grow"><b>${esc(s.title || s.fileName)}</b> <span class="muted">${esc(s.artist || '')}</span><div class="small" style="color:var(--amber)">${esc(flagged.get(s.id).reason)}${flagged.get(s.id).note ? ' — ' + esc(flagged.get(s.id).note) : ''}</div></div><button class="btn sm" data-edit="${s.id}">Edit</button></div>`).join('');
    const sb = document.createElement('div');
    sb.innerHTML = `<p>${checked} of ${list.length} song(s) checked. ${fl.length ? `<b>${fl.length} flagged:</b>` : 'Nothing flagged — this playlist sounds good.'}</p>${rows}<p class="muted small">Flags stay on the songs (Music Library → <b>Flagged</b>) until you clear them.</p>`;
    sb.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSong(list.find(x => x.id === b.dataset.edit)));
    await modal({ title: 'Song check finished', size: 'mid', body: sb, buttons: [{ label: 'Done', kind: 'primary', value: true }] });
    return { checked, flagged: fl.length };
  }
  window.songCheck = songCheck;
})();
