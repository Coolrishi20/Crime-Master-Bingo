App.register('cards', {
  async render(el) {
    this.el = el;
    const games = await api('games:list');
    if (!this.gameId || !games.find(g => g.id === this.gameId)) this.gameId = App.game ? App.game.gameId : (games[0] && games[0].id);
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Printable cards</div><h1>Bingo Cards &amp; Printing</h1><p>Two complete cards on every A4 sheet, with a dashed cutting line across the middle.</p></div>
      <label class="field">Game<select id="cGame">${games.map(g => `<option value="${g.id}" ${g.id === this.gameId ? 'selected' : ''}>${esc(g.name)} · ${esc(g.date)} (${g.cards} cards)</option>`).join('')}</select></label></div>
      ${games.length ? `<div class="cols main-side"><div class="panel" id="cPrint"></div><div><div class="panel" id="cSum" style="margin-bottom:16px"></div><div class="panel" id="cView"></div></div></div>` : '<div class="panel"><div class="empty">Create a game first — cards belong to a game.</div></div>'}`;
    if (!games.length) return;
    $('#cGame', el).onchange = (e) => { this.gameId = e.target.value; this.render(el); };
    this.renderPrintPanel($('#cPrint', el), this.gameId, () => this.summary());
    this.summary();
    this.viewer();
  },
  async summary() {
    const box = $('#cSum', this.el); if (!box) return;
    const s = await api('cards:summary', { id: this.gameId });
    box.innerHTML = `<h2>Cards in this game</h2>
      <div class="row" style="gap:28px"><div class="stat"><span class="k">Generated</span><span class="big-num">${s.total}</span></div><div class="stat"><span class="k">Printed</span><span class="big-num">${s.printed}</span></div><div class="stat"><span class="k">Numbers left</span><span class="big-num">${s.remainingNumbers}</span></div></div>
      ${s.problems.length ? `<div class="badge bad" style="margin-top:10px">${esc(s.problems[0])}</div>` : (s.total ? '<div class="badge ok" style="margin-top:10px">✓ All cards unique · 25 different songs each</div>' : '')}
      <div style="margin-top:12px">${s.batches.map(b => `<div class="check-row"><div class="grow"><b>Batch ${b.batch}</b> · cards ${pad3(b.from)}–${pad3(b.to)}</div><span class="badge ${b.printed === b.count ? 'ok' : ''}">${b.printed}/${b.count} printed</span></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><input type="number" id="cMore" min="1" max="${s.remainingNumbers}" value="${Math.min(20, s.remainingNumbers)}" style="width:100px"><button class="btn" id="cGen" ${s.remainingNumbers ? '' : 'disabled'}>Generate more cards</button></div>
      <p class="muted tiny">New cards continue from the next unused number. Existing cards are never changed or reissued.</p>`;
    $('#cGen', box).onclick = async () => {
      const n = Number($('#cMore', box).value);
      const r = await api('cards:generate', { id: this.gameId, count: n });
      toast(`${r.added} new cards: ${pad3(r.from)}–${pad3(r.to)}`, 'ok', 5000);
      this.render(this.el);
    };
  },
  viewer() {
    const box = $('#cView', this.el);
    box.innerHTML = `<h2>View a card</h2><div class="row"><input type="number" id="cvNo" min="1" max="999" placeholder="Card no." style="width:120px"><button class="btn" id="cvGo">Show</button></div><div id="cvOut" style="margin-top:12px"></div>`;
    const go = async () => {
      const no = Number($('#cvNo', box).value); if (!no) return;
      try {
        const c = await apiQuiet('cards:get', { id: this.gameId, no });
        $('#cvOut', box).innerHTML = `<div class="row" style="margin-bottom:8px"><span class="display" style="font-size:26px">CARD ${c.label}</span>${c.printed ? '<span class="badge ok">PRINTED</span>' : '<span class="badge">NOT PRINTED</span>'}</div><div class="bcard">${c.cells.map(x => `<div class="bcell" style="min-height:54px"><b style="font-size:11px">${esc(x.title)}</b><span>${esc(x.artist)}</span></div>`).join('')}</div>`;
      } catch (e) { $('#cvOut', box).innerHTML = `<div class="badge bad">${esc(cleanErr(e))}</div>`; }
    };
    $('#cvGo', box).onclick = go; $('#cvNo', box).onkeydown = e => { if (e.key === 'Enter') go(); };
  },

  /** Print panel — used here and in the Create Game wizard. */
  async renderPrintPanel(box, gameId, after) {
    if (!gameId) { box.innerHTML = '<div class="empty">No game selected.</div>'; return; }
    const s = await api('cards:summary', { id: gameId });
    const cs = App.settings.cards;
    const unprinted = s.total - s.printed;
    box.innerHTML = `<h2>Print cards</h2>
      <div class="field" style="margin-bottom:12px"><span class="muted small" style="font-weight:700">Which cards?</span>
        <div class="seg" id="ppSel"><button data-v="all" class="on">All ${s.total}</button><button data-v="unprinted">Not yet printed (${unprinted})</button><button data-v="range">Card range…</button></div></div>
      <div id="ppRangeRow" style="display:none;margin-bottom:12px"><label class="field">Card numbers (e.g. 1-50, 75, 101-120)<input type="text" id="ppRange" placeholder="1-${s.total || 100}"></label></div>
      <div class="row" style="gap:24px;margin-bottom:12px">${toggleHtml('ppQr', 'QR codes', cs.qr)}${toggleHtml('ppBw', 'Black & white (ink saver)', cs.bw)}${toggleHtml('ppLogo', 'Logo', cs.useLogo)}</div>
      <label class="field" style="max-width:320px">Card text size: <span id="ppTsV">${Math.round(cs.textScale * 100)}%</span><input type="range" id="ppTs" min="80" max="125" step="5" value="${Math.round(cs.textScale * 100)}"></label>
      <div class="muted" id="ppInfo" style="margin:14px 0"></div>
      <div class="row"><button class="btn" id="ppPrev">Print preview</button><button class="btn" id="ppPdf">Export PDF…</button><button class="btn primary" id="ppPrint">🖨 Print…</button></div>
      <p class="muted tiny" style="margin-top:12px">A4 portrait, two cards per sheet (top &amp; bottom halves) with a dashed cut line. Print at <b>100% / Actual size</b> — do not use “fit to page” or multiple pages per sheet. Long titles shrink automatically; set a shorter “Printed title” in the Music Library if needed.</p>
      <div id="ppResult"></div>`;
    let sel = 'all';
    const opts = () => ({ id: gameId, qr: $('#ppQr', box).checked, bw: $('#ppBw', box).checked, useLogo: $('#ppLogo', box).checked, textScale: Number($('#ppTs', box).value) / 100, range: sel === 'range' ? $('#ppRange', box).value : null, onlyUnprinted: sel === 'unprinted' });
    const info = () => {
      let n = s.total; if (sel === 'unprinted') n = unprinted;
      if (sel === 'range') { try { n = (($('#ppRange', box).value || '').split(/[,\s]+/).filter(Boolean).reduce((a, p) => { const m = /^(\d+)(?:-(\d+))?$/.exec(p); if (!m) return a; const x = +m[1], y = m[2] ? +m[2] : x; return a + Math.abs(y - x) + 1; }, 0)); } catch (e) { n = 0; } }
      $('#ppInfo', box).innerHTML = `<b style="color:#fff">${n} card${n === 1 ? '' : 's'}</b> → <b style="color:#fff">${Math.ceil(n / 2)} A4 sheet${Math.ceil(n / 2) === 1 ? '' : 's'}</b>${n % 2 ? ' (last sheet: one card on the top half)' : ''}`;
    };
    $$('#ppSel button', box).forEach(b => b.onclick = () => { sel = b.dataset.v; $$('#ppSel button', box).forEach(x => x.classList.toggle('on', x === b)); $('#ppRangeRow', box).style.display = sel === 'range' ? 'block' : 'none'; info(); });
    $('#ppRange', box).oninput = info;
    $('#ppTs', box).oninput = (e) => { $('#ppTsV', box).textContent = e.target.value + '%'; };
    const saveOpts = () => { const o = opts(); api('settings:update', { cards: { qr: o.qr, bw: o.bw, useLogo: o.useLogo, textScale: o.textScale } }).then(st => { App.settings = st; }); };
    const busy = (on, label) => { $$('button', box).forEach(b => { b.disabled = on; }); $('#ppResult', box).innerHTML = on ? `<div class="badge pink" style="margin-top:10px">${label}</div>` : ''; };
    const done = (r, verb) => {
      if (!r) return;
      $('#ppResult', box).innerHTML = `<div class="check-row" style="margin-top:12px"><span class="ic ${r.overflow ? 'warn' : 'ok'}">${r.overflow ? '!' : '✓'}</span><div class="grow"><b>${verb}: ${r.cards} cards on ${r.sheets} A4 sheets</b><div class="muted small">${r.file ? esc(r.file) : ''}${r.overflow ? ` · ${r.overflow} song title(s) were too long and were shortened — set a Printed title for them` : ' · all text fits'}</div></div>${r.file ? '<button class="btn sm" id="ppOpen">Open</button><button class="btn sm" id="ppShow">Show in folder</button>' : ''}</div>`;
      if (r.file && $('#ppOpen', box)) { $('#ppOpen', box).onclick = () => api('shell:open', r.file); $('#ppShow', box).onclick = () => api('shell:showItem', r.file); }
      if (after) after();
    };
    $('#ppPrev', box).onclick = async () => { saveOpts(); busy(true, 'Building preview…'); try { const r = await api('cards:exportPdf', Object.assign(opts(), { preview: true })); busy(false); done(r, 'Preview'); } catch (e) { busy(false); } };
    $('#ppPdf', box).onclick = async () => { saveOpts(); busy(true, 'Creating PDF… (large print runs take a little while)'); try { const r = await api('cards:exportPdf', opts()); busy(false); done(r, 'PDF saved'); } catch (e) { busy(false); } };
    $('#ppPrint', box).onclick = async () => { saveOpts(); busy(true, 'Preparing pages for the printer…'); try { const r = await api('cards:print', opts()); busy(false); if (r.printed) { toast(`Sent ${r.sheets} sheets to the printer`, 'ok'); if (after) after(); } else toast('Printing cancelled' + (r.reason && r.reason !== 'cancelled' ? ': ' + r.reason : ''), 'err'); } catch (e) { busy(false); } };
    info();
  }
});
