/* Anthem Square — one relink wizard for the Music Library and for games (2.2).
 * Exact matches (same file, even if renamed) are ticked for you; anything less certain
 * (same name, same title + artist) is shown with a preview and needs your tick. Only file
 * locations change: song IDs, playlists, clip points and printed cards are kept. */
(function () {
  'use strict';
  const PILL = {
    fingerprint: ['ok', 'SAME FILE'], 'name-size': ['ok', 'SAME FILE'],
    filename: ['warn', 'SAME NAME?'], 'title-artist': ['warn', 'SAME SONG?']
  };
  /**
   * opts.scan(): Promise<{ folder, scanned, results:[{ key, title, artist, fileName, candidate }] }> | null
   * opts.apply(picked:[{ key, path, match }]): Promise<{ applied, missing }>
   */
  async function relinkWizard(opts) {
    const r = await opts.scan(); if (!r) return null;
    const rows = r.results;
    const body = document.createElement('div');
    const exact = rows.filter(x => x.candidate && x.candidate.auto).length;
    const unsure = rows.filter(x => x.candidate && !x.candidate.auto).length;
    body.innerHTML = `<p class="muted small" style="margin-top:0">Searched <b>${esc(r.folder || '')}</b> · ${r.scanned} video file${r.scanned === 1 ? '' : 's'}.</p>
      <table class="list rl-table"><thead><tr><th style="width:34px"></th><th>Song</th><th>Found</th><th style="width:150px">Confidence</th></tr></thead><tbody>
      ${rows.map((x, i) => { const c = x.candidate; const p = c ? PILL[c.match] || ['warn', 'CHECK'] : ['bad', 'NOT FOUND']; return `<tr data-i="${i}">
        <td>${c ? `<input type="checkbox" data-i="${i}" ${c.auto ? 'checked' : ''} aria-label="Relink ${esc(x.title)}">` : ''}</td>
        <td><b>${esc(x.title)}</b><div class="muted small">${esc(x.artist || '')}</div></td>
        <td class="small">${c ? `${esc(c.path.split(/[\\/]/).pop())}<div class="muted tiny" title="${esc(c.path)}">${esc(c.path)}</div>` : '<span class="muted">—</span>'}</td>
        <td><span class="badge ${p[0]}">${p[1]}</span>${c && !c.auto ? ` <button class="btn sm ghost" data-prev="${i}">Preview</button>` : ''}</td></tr>
        ${c && !c.auto ? `<tr class="rl-why"><td></td><td colspan="3" class="muted tiny">${esc(c.detail)}<div class="rl-prev" id="rlPrev${i}"></div></td></tr>` : ''}`; }).join('')}
      </tbody></table>
      <p class="muted small" style="margin-bottom:0">${exact} exact · ${unsure} to review · ${rows.length - exact - unsure} not found. Only “same file” matches are ticked for you. Song IDs, playlists, clip points and printed cards are kept.</p>`;
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-prev]'); if (!b) return;
      const i = Number(b.dataset.prev); const box = body.querySelector('#rlPrev' + i);
      if (box.firstChild) { box.innerHTML = ''; b.textContent = 'Preview'; return; }
      const url = await api('library:fileUrl', rows[i].candidate.path);
      box.innerHTML = `<video src="${esc(url)}#t=30" controls autoplay style="width:320px;max-width:100%;margin-top:6px;border-radius:8px;background:#000"></video>`;
      const v = box.querySelector('video'); v.volume = 0.6; b.textContent = 'Stop preview';
    });
    const picked = await modal({ title: opts.title || 'Find missing videos', size: 'wide', body,
      onMount: (bd) => {
        const upd = () => { const n = bd.querySelectorAll('input[data-i]:checked').length; const btn = Array.from(document.querySelectorAll('.modal-foot .btn')).pop(); if (btn) btn.textContent = `Relink ${n}`; btn.disabled = !n; };
        bd.addEventListener('change', upd); setTimeout(upd, 0);
      },
      buttons: [{ label: 'Cancel', value: null }, { label: 'Relink', kind: 'primary', value: (bd) => Array.from(bd.querySelectorAll('input[data-i]:checked')).map(c => { const x = rows[Number(c.dataset.i)]; return { key: x.key, path: x.candidate.path, match: x.candidate.auto ? x.candidate.match : 'host-confirmed' }; }) }] });
    body.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* */ } });
    if (!picked || !picked.length) return null;
    return opts.apply(picked);
  }
  window.relinkWizard = relinkWizard;
})();
