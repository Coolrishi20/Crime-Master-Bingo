/* Anthem Square — clip editor (2.2): a timeline with draggable start and end markers drawn
 * over the song's loudness (from the volume-levelling analysis already on disk), length
 * presets, Play selection, Set start here, Reset, and a "loud section" suggestion.
 * Writes into the song editor's own Clip start / Clip end fields, so saving is unchanged. */
(function () {
  'use strict';
  const r2 = (t) => Math.round(t * 2) / 2;
  const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); const s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

  async function mountClipEditor(box, song, video, eS, eE) {
    const gd = (App.settings && App.settings.gameDefaults) || {};
    const defLen = Number(gd.clipMode) > 0 ? Number(gd.clipMode) : 30;
    const env = await api('audio:envelope', { id: song.id }).catch(() => null);
    let dur = (env && env.duration) || song.duration || 0;
    const defStart = () => (Number(gd.defaultStart) > 0 ? Number(gd.defaultStart) : (gd.skipIntros !== false && env && env.intro > 0 ? env.intro : 0));
    const startV = () => (eS.value !== '' ? Number(eS.value) : defStart());
    const endV = () => (eE.value !== '' ? Number(eE.value) : Math.min(dur || Infinity, startV() + defLen));
    box.innerHTML = `
      <div class="clip-tl" id="clTl"><canvas id="clCv" height="84"></canvas><div class="clip-sel" id="clSel"><i class="h s" data-h="s"></i><i class="h e" data-h="e"></i></div><div class="clip-ph" id="clPh"></div></div>
      <div class="clip-ticks" id="clTicks"></div>
      <div class="row" style="margin:10px 0 6px;flex-wrap:wrap;gap:8px">
        <div class="seg" id="clLen">${[20, 30, 40, 60].map(n => `<button data-l="${n}">${n} s</button>`).join('')}<button data-l="full">Full</button></div>
        <span class="clip-read" id="clRead"></span>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button class="btn sm primary" id="clPlay">▶ Play selection</button>
        <button class="btn sm" id="clHere" title="Move the clip so it starts at the video's current position">Set start here</button>
        <button class="btn sm" id="clEndHere">Set end here</button>
        <button class="btn sm ghost" id="clReset">⟲ Reset to default</button>
        <span id="clSug"></span>
      </div>
      ${env ? '' : '<p class="muted small" style="margin:8px 0 0">The loudness bars appear once volume analysis has finished for this song.</p>'}`;
    const cv = box.querySelector('#clCv'); const tl = box.querySelector('#clTl'); const sel = box.querySelector('#clSel'); const ph = box.querySelector('#clPh');
    const draw = () => {
      const w = tl.clientWidth || 600; cv.width = w * (window.devicePixelRatio || 1); cv.style.width = w + 'px';
      const ctx = cv.getContext('2d'); const H = cv.height; ctx.clearRect(0, 0, cv.width, H);
      const css = getComputedStyle(document.documentElement);
      ctx.fillStyle = (css.getPropertyValue('--lav') || '#B3B4AA').trim();
      if (env) { const n = env.bars.length; const bw = cv.width / n; env.bars.forEach((db, i) => { const v = Math.max(0, Math.min(1, (db + 45) / 40)); const h = Math.max(2, v * (H - 6)); ctx.globalAlpha = 0.55; ctx.fillRect(i * bw, H - h, Math.max(1, bw - 1), h); }); ctx.globalAlpha = 1; }
      else { ctx.globalAlpha = 0.3; ctx.fillRect(0, H / 2 - 1, cv.width, 2); ctx.globalAlpha = 1; }
      const tk = box.querySelector('#clTicks'); const step = dur > 300 ? 60 : dur > 120 ? 30 : 15; let h = '';
      for (let t = 0; t <= dur; t += step) h += `<span style="left:${(t / dur) * 100}%">${fmt(t).replace(/\.0$/, '')}</span>`;
      tk.innerHTML = dur ? h : '';
      place();
    };
    const place = () => {
      if (!dur) return; const s = startV(), e = endV();
      sel.style.left = (s / dur) * 100 + '%'; sel.style.width = Math.max(0.5, ((e - s) / dur) * 100) + '%';
      box.querySelector('#clRead').innerHTML = `Start <b>${fmt(s)}</b> · End <b>${fmt(e)}</b> · ${Math.round(e - s)} s${eS.value === '' && eE.value === '' ? ' <span class="muted">(game default)</span>' : ''}`;
      box.querySelectorAll('#clLen button').forEach(b => b.classList.toggle('on', b.dataset.l === 'full' ? Math.abs(e - dur) < 0.6 && s < 0.6 : Math.abs((e - s) - Number(b.dataset.l)) < 0.6));
    };
    const set = (s, e) => { s = Math.max(0, Math.min(r2(s), dur ? dur - 1 : s)); e = r2(e); if (dur) e = Math.min(e, Math.floor(dur * 10) / 10); if (e <= s + 1) e = Math.min(dur || s + 5, s + 5); eS.value = s; eE.value = e; place(); };
    // dragging the markers (or the whole selection)
    let drag = null;
    tl.addEventListener('pointerdown', (ev) => {
      if (!dur) return; const rect = tl.getBoundingClientRect(); const t = ((ev.clientX - rect.left) / rect.width) * dur;
      const h = ev.target.dataset && ev.target.dataset.h;
      drag = { h: h || (ev.target === sel ? 'm' : null), off: t - startV(), len: endV() - startV() };
      if (!drag.h) { video.currentTime = Math.max(0, t); drag = null; return; } // click on the bars: seek there
      tl.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    tl.addEventListener('pointermove', (ev) => {
      if (!drag) return; const rect = tl.getBoundingClientRect(); const t = Math.max(0, Math.min(dur, ((ev.clientX - rect.left) / rect.width) * dur));
      if (drag.h === 's') set(t, endV()); else if (drag.h === 'e') set(startV(), t); else set(t - drag.off, t - drag.off + drag.len);
    });
    tl.addEventListener('pointerup', () => { if (drag && drag.h !== 'e') video.currentTime = startV(); drag = null; });
    box.querySelectorAll('#clLen button').forEach(b => b.onclick = () => { if (b.dataset.l === 'full') set(0, dur); else set(startV(), startV() + Number(b.dataset.l)); });
    let stopAt = null;
    box.querySelector('#clPlay').onclick = () => { video.currentTime = startV(); stopAt = endV(); video.play().catch(() => {}); };
    video.addEventListener('timeupdate', () => { if (dur) ph.style.left = (video.currentTime / dur) * 100 + '%'; if (stopAt != null && video.currentTime >= stopAt) { video.pause(); stopAt = null; } });
    video.addEventListener('loadedmetadata', () => { if (!dur && video.duration) { dur = video.duration; draw(); } });
    box.querySelector('#clHere').onclick = () => { const len = endV() - startV(); set(video.currentTime, video.currentTime + len); };
    box.querySelector('#clEndHere').onclick = () => set(startV(), video.currentTime);
    box.querySelector('#clReset').onclick = () => { eS.value = ''; eE.value = ''; place(); };
    [eS, eE].forEach(i => i.addEventListener('input', place));
    if (env) {
      const sug = await api('audio:loudSection', { id: song.id, secs: Math.round(endV() - startV()) || defLen }).catch(() => null);
      if (sug) { const b = box.querySelector('#clSug'); b.innerHTML = `<button class="btn sm ghost" id="clSugB" title="The loudest ${Math.round(sug.end - sug.start)} seconds after the intro — a suggestion, not chorus detection">SUGGESTION: LOUD SECTION ${fmt(sug.start).replace(/\.0$/, '')}–${fmt(sug.end).replace(/\.0$/, '')}</button>`; b.querySelector('#clSugB').onclick = () => { set(sug.start, sug.end); video.currentTime = sug.start; }; }
    }
    requestAnimationFrame(draw);
    return { redraw: draw };
  }
  window.mountClipEditor = mountClipEditor;
})();
