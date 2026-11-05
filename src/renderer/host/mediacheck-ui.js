/* Anthem Square — media check (2.2): is every video ready to play smoothly on this laptop?
 * Ready / Needs optimisation / Unsupported / Missing, with the reason and a fix for each.
 * "Optimise all flagged" makes smaller or simpler copies; originals are never changed. */
(function () {
  'use strict';
  const GROUPS = [['missing', 'Missing', 'bad'], ['unsupported', 'Unsupported', 'bad'], ['optimise', 'Needs optimisation', 'warn'], ['pending', 'Still checking', ''], ['ready', 'Ready', 'ok']];
  const spec = (m) => m ? [m.height ? m.height + 'p' : null, m.vcodec ? m.vcodec.toUpperCase() : null, m.fps ? Math.round(m.fps) + ' fps' : null, m.bitrate ? (m.bitrate / 1000).toFixed(1) + ' Mb/s' : null, m.keyGap != null ? 'keyframes ≤' + m.keyGap + ' s' : null].filter(Boolean).join(' · ') : '';

  async function mediaCheck(opts = {}) {
    const body = document.createElement('div'); let timer = null; let r = null;
    const draw = async () => {
      r = await api('media:report', opts.playlistId ? { playlistId: opts.playlistId } : {});
      const open = new Set(Array.from(body.querySelectorAll('details[open]')).map(d => d.dataset.g));
      body.innerHTML = `<div class="mc-tiles">${GROUPS.filter(g => g[0] !== 'pending' || r.pending).map(([k, l, c]) => `<div class="mc-tile ${c}"><b>${r[k]}</b><span>${l}</span></div>`).join('')}</div>
        <p class="muted small">${r.total} video${r.total === 1 ? '' : 's'} checked against ${r.lowRes ? '<b>Low Resource Mode</b> limits (720p, 30 fps)' : 'a 1080p TV'}. Resolution, codec, frame rate, bitrate, keyframe spacing and clip points. Nothing is decoded and no file is changed.</p>
        <div class="row" style="margin-bottom:10px">
          <button class="btn primary" id="mcOpt" ${r.fixable ? '' : 'disabled'}>Optimise all flagged (${r.fixable})</button>
          ${r.unsupported ? '<button class="btn" id="mcConv">Convert unsupported…</button>' : ''}
          ${r.missing ? '<button class="btn" id="mcFind">Find missing videos…</button>' : ''}
          <span class="grow"></span><button class="btn sm ghost" id="mcRe">Check again</button></div>
        ${GROUPS.filter(g => g[0] !== 'ready' && r[g[0]]).map(([k, l, c]) => `<details class="mc-group" data-g="${k}" ${open.has(k) || (!open.size && k !== 'pending') ? 'open' : ''}><summary><span class="badge ${c}">${l.toUpperCase()}</span> ${r[k]}</summary>
          ${r.rows.filter(x => x.status === k).slice(0, 200).map(x => `<div class="check-row"><div class="grow"><b>${esc(x.title)}</b> <span class="muted">— ${esc(x.artist || '')}</span>
            <div class="muted tiny">${esc(spec(x.media))}</div>${x.reasons.map(t => `<div class="small">${esc(t)}</div>`).join('')}</div>
            ${x.optimising ? '<span class="badge warn">MAKING COPY…</span>' : x.optimised ? '<span class="badge ok">COPY READY</span>' : x.clipIssue ? `<button class="btn sm" data-clip="${x.id}">Fix clip…</button>` : ''}</div>`).join('')}</details>`).join('')}
        ${!r.optimise && !r.unsupported && !r.missing && !r.pending ? '<div class="check-row"><span class="ic ok">✓</span><div>Every video is ready to play on this laptop.</div></div>' : ''}`;
      const b = (id) => body.querySelector(id);
      if (b('#mcOpt')) b('#mcOpt').onclick = async () => { const q = await api('media:optimiseFlagged', {}); toast(`${q.queued} cop${q.queued === 1 ? 'y' : 'ies'} queued — originals are kept`, 'ok', 5000); draw(); };
      if (b('#mcConv')) b('#mcConv').onclick = async () => { await api('convert:start', { ids: r.rows.filter(x => x.status === 'unsupported').map(x => x.id) }); toast('Conversion to MP4 queued', 'ok'); draw(); };
      if (b('#mcFind')) b('#mcFind').onclick = async () => { if (App.views.library && App.views.library.findMissing) await App.views.library.findMissing(); draw(); };
      if (b('#mcRe')) b('#mcRe').onclick = async () => { await api('media:recheck', {}); draw(); };
      body.querySelectorAll('[data-clip]').forEach(x => x.onclick = async () => { const s = (await api('library:list')).songs.find(z => z.id === x.dataset.clip); if (s && window.editSong) { await window.editSong(s); draw(); } });
    };
    await draw();
    timer = setInterval(() => { if (r && (r.pending || r.rows.some(x => x.optimising))) draw(); }, 2500);
    await modal({ title: 'Media check', size: 'wide', body, buttons: [{ label: 'Close', value: true, kind: 'primary' }] });
    clearInterval(timer);
  }
  window.mediaCheck = mediaCheck;
})();
