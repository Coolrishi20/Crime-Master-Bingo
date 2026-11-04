/* Crime Master Bingo — winning-rule picker (Settings → Bingo Rules and Host Game).
 * The authoritative rule engine lives in the main process (src/core/rules.js); this UI
 * only builds rule specs and asks the main process for labels, text and pattern previews. */
(function () {
  'use strict';

  /** 5×5 clickable grid editor. */
  function gridEditor(selected, max) {
    const box = document.createElement('div');
    box.className = 'rgrid-edit';
    const set = new Set(selected || []);
    for (let i = 0; i < 25; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i; b.className = set.has(i) ? 'on' : '';
      b.onclick = () => { if (set.has(i)) set.delete(i); else { if (max && set.size >= max) return toast(`Pick exactly ${max} squares`, 'err'); set.add(i); } b.classList.toggle('on', set.has(i)); box.dispatchEvent(new Event('change')); };
      box.appendChild(b);
    }
    box.cells = () => Array.from(set).sort((a, b) => a - b);
    return box;
  }

  /** Design (or edit) a named custom pattern. Saved into Settings so it can be reused. */
  async function customPatternDialog(existing) {
    const body = document.createElement('div');
    body.innerHTML = `<label class="field">Pattern name<input type="text" id="cpName" maxlength="24" value="${esc(existing ? existing.name : '')}" placeholder="e.g. Four Corners, Plus Sign"></label>
      <p class="muted small">Click squares to add them to the pattern (at least 2). A card wins when every square in the pattern has been played.</p><div id="cpGrid"></div>`;
    const ed = gridEditor(existing ? existing.cells : [], 0); body.querySelector('#cpGrid').appendChild(ed);
    const r = await modal({ title: existing ? 'Edit custom pattern' : 'New custom pattern', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Save pattern', kind: 'primary', value: (b) => ({ name: b.querySelector('#cpName').value.trim(), cells: ed.cells() }) }] });
    if (!r) return null;
    if (!r.name) { toast('Give the pattern a name', 'err'); return null; }
    if (r.cells.length < 2) { toast('Pick at least 2 squares', 'err'); return null; }
    const st = await api('settings:get');
    const list = (st.customPatterns || []).filter(p => !existing || p.id !== existing.id);
    const pat = { id: existing ? existing.id : 'cp_' + Date.now().toString(36), name: r.name, cells: r.cells };
    list.push(pat);
    App.settings = await api('settings:update', { customPatterns: list });
    return pat;
  }

  /**
   * Rule picker. `current` = array of rule specs. Resolves with the new array, or null.
   * opts: { title, round }
   */
  async function ruleEditor(current, opts = {}) {
    const cat = await api('rules:catalogue');
    let customs = (App.settings.customPatterns || []);
    const sel = {}; let fast5 = { mode: 'any', cells: [] }; let customSel = new Set();
    (current || []).forEach(r => {
      if (r.id === 'fast5') { sel.fast5 = true; fast5 = { mode: r.mode || 'any', cells: r.cells || [] }; }
      else if (r.id === 'custom') { const m = customs.find(c => JSON.stringify(c.cells) === JSON.stringify(r.cells) && c.name === r.name); if (m) customSel.add(m.id); else { customs = customs.concat([{ id: 'tmp_' + customs.length, name: r.name, cells: r.cells }]); customSel.add('tmp_' + (customs.length - 1)); } }
      else sel[r.id] = true;
    });
    const body = document.createElement('div');
    const draw = () => {
      body.innerHTML = `<p class="muted small" style="margin-top:0">Tick one or more patterns. If you tick several, <b style="color:#fff">any one of them</b> wins the round. Every check — on this laptop or the phone — uses exactly these rules.</p>
        <div class="rule-cards">${cat.map(c => `<label class="rule-card ${sel[c.id] ? 'on' : ''}" data-id="${c.id}"><input type="checkbox" ${sel[c.id] ? 'checked' : ''}>
          <div class="rc-pats">${c.examples.slice(0, c.id === 'full' || c.id === 'fast5' ? 1 : 2).map(e => patternGridHtml(e)).join('')}</div>
          <div class="rc-tx"><b>${esc(c.label)}</b><span>${esc(c.short)}</span></div></label>`).join('')}</div>
        <div id="f5Box" class="rule-sub" style="${sel.fast5 ? '' : 'display:none'}"><b>Fast 5 —</b> <div class="seg" id="f5Mode"><button data-v="any" class="${fast5.mode === 'any' ? 'on' : ''}">Any 5 squares</button><button data-v="pattern" class="${fast5.mode === 'pattern' ? 'on' : ''}">A set pattern of 5</button></div>
          <div id="f5Grid" style="${fast5.mode === 'pattern' ? '' : 'display:none'};margin-top:8px"></div><div class="muted small" id="f5Hint"></div></div>
        <div class="rule-sub"><div class="row"><b class="grow">Custom patterns</b><button class="btn sm" id="cpNew">＋ New pattern…</button></div>
          <div class="rule-cards">${customs.length ? customs.map(c => `<label class="rule-card ${customSel.has(c.id) ? 'on' : ''}" data-cp="${c.id}"><input type="checkbox" ${customSel.has(c.id) ? 'checked' : ''}><div class="rc-pats">${patternGridHtml(Array.from({ length: 25 }, (_, i) => c.cells.includes(i)))}</div><div class="rc-tx"><b>${esc(c.name.toUpperCase())}</b><span>${c.cells.length} squares</span></div></label>`).join('') : '<div class="muted small">None yet — design your own shape (Four Corners, Plus Sign…).</div>'}</div></div>
        <div class="rule-preview" id="rPrev"></div>`;
      $$('.rule-card[data-id]', body).forEach(l => l.querySelector('input').onchange = (e) => { sel[l.dataset.id] = e.target.checked; draw(); });
      $$('.rule-card[data-cp]', body).forEach(l => l.querySelector('input').onchange = (e) => { if (e.target.checked) customSel.add(l.dataset.cp); else customSel.delete(l.dataset.cp); draw(); });
      $$('#f5Mode button', body).forEach(b => b.onclick = () => { fast5.mode = b.dataset.v; draw(); });
      if (fast5.mode === 'pattern') { const ed = gridEditor(fast5.cells, 5); ed.addEventListener('change', () => { fast5.cells = ed.cells(); preview(); }); $('#f5Grid', body).appendChild(ed); $('#f5Hint', body).textContent = 'Pick exactly 5 squares.'; }
      $('#cpNew', body).onclick = async () => { const p = await customPatternDialog(null); if (p) { customs = (App.settings.customPatterns || []).concat(customs.filter(c => /^tmp_/.test(c.id))); customSel.add(p.id); draw(); } };
      preview();
    };
    const build = () => {
      const out = [];
      cat.forEach(c => { if (!sel[c.id]) return; if (c.id === 'fast5') out.push(fast5.mode === 'pattern' ? { id: 'fast5', mode: 'pattern', cells: fast5.cells } : { id: 'fast5', mode: 'any' }); else out.push({ id: c.id }); });
      customs.forEach(c => { if (customSel.has(c.id)) out.push({ id: 'custom', name: c.name, cells: c.cells }); });
      return out;
    };
    let pt = null;
    const preview = () => {
      clearTimeout(pt); pt = setTimeout(async () => {
        const box = $('#rPrev', body); if (!box) return;
        try {
          const i = await apiQuiet('rules:info', { rules: build(), round: opts.round || 1 });
          box.innerHTML = `<div class="eyebrow">Preview — what players see</div><div class="row" style="align-items:flex-start;gap:16px"><div class="rp-grids">${i.examples.slice(0, 6).map(e => patternGridHtml(e)).join('')}</div><div class="grow"><div class="display" style="font-size:22px">${esc(i.label)}</div><div class="small" style="margin-top:4px">${esc(i.rule)}</div></div></div>`;
          box.classList.remove('bad');
        } catch (e) { box.innerHTML = `<div class="badge bad">${esc(cleanErr(e))}</div>`; box.classList.add('bad'); }
      }, 120);
    };
    draw();
    const r = await modal({ title: opts.title || 'Winning rules', size: 'mid', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Use these rules', kind: 'primary', value: () => build() }] });
    if (!r) return null;
    try { await apiQuiet('rules:info', { rules: r, round: opts.round || 1 }); } catch (e) { toast(cleanErr(e), 'err', 6000); return null; }
    return r;
  }

  /** Small read-only summary of the three rounds (label + first pattern). */
  function roundsSummaryHtml(infos) {
    return `<div class="rounds-sum">${Object.keys(infos).map(Number).sort((a, b) => a - b).map(n => `<div class="rs-item"><div class="rs-pat">${patternGridHtml(infos[n].examples[0])}</div><div><b>Round ${n}</b><span>${esc(infos[n].label)}</span>${infos[n].locked ? '<em>locked — in play</em>' : ''}</div></div>`).join('')}</div>`;
  }

  /** − / + stepper for the number of rounds. */
  function roundCountHtml(n, locked) { return `<div class="row rc-step"><b>Rounds</b><button class="btn sm" data-rc="-1" ${n <= Math.max(1, locked || 1) ? 'disabled' : ''}>−</button><span class="display" style="font-size:26px;min-width:30px;text-align:center">${n}</span><button class="btn sm" data-rc="1" ${n >= 10 ? 'disabled' : ''}>＋</button><span class="muted small">The last round ends the game.</span></div>`; }
  window.roundCountHtml = roundCountHtml;
  window.ruleEditor = ruleEditor;
  window.customPatternDialog = customPatternDialog;
  window.roundsSummaryHtml = roundsSummaryHtml;
})();
