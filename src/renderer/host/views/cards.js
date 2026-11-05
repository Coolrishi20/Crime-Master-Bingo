App.register('cards', {
  async render(el) {
    this.el = el;
    const games = await api('games:list');
    if (!this.gameId || !games.find(g => g.id === this.gameId)) this.gameId = App.game ? App.game.gameId : (games[0] && games[0].id);
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Printable cards</div><h1>Bingo Cards &amp; Printing</h1><p>Two complete cards on every A4 sheet, with a dashed cutting line across the middle.</p></div>
      <label class="field">Game<select id="cGame">${games.map(g => `<option value="${g.id}" ${g.id === this.gameId ? 'selected' : ''}>${esc(g.name)} · ${esc(g.date)} (${g.cards} cards)</option>`).join('')}</select></label></div>
      ${games.length ? `<div class="cols main-side"><div><div class="panel" id="cPrint"></div>${App.settings.home && App.settings.home.shareImages ? '<div class="panel" id="cShare" style="margin-top:16px"></div>' : ''}</div><div><div class="panel" id="cSum" style="margin-bottom:16px"></div><div class="panel" id="cView"></div></div></div>` : '<div class="panel"><div class="empty">Create a game first — cards belong to a game.</div></div>'}`;
    if (!games.length) return;
    $('#cGame', el).onchange = (e) => { this.gameId = e.target.value; this.render(el); };
    this.renderPrintPanel($('#cPrint', el), this.gameId, () => this.summary());
    this.summary();
    this.viewer();
    if ($('#cShare', el)) this.sharePanel($('#cShare', el));
  },
  on_cardsImages(p) { const x = this.el && $('#shProg', this.el); if (x) x.textContent = p.done < p.total ? `Saving ${p.done + 1} of ${p.total}…` : ''; },
  /** Home play: save cards as images to send on WhatsApp (optional, Settings → Home play). */
  async sharePanel(box) {
    const s = await api('cards:summary', { id: this.gameId });
    box.innerHTML = `<h2>📤 Share cards as images</h2>
      <p class="muted small" style="margin-top:0">No printer? Save each card as a picture and send it on WhatsApp. Players mark it on paper or on their screen — the card is identical to the printed one, so BINGO checks work the same.</p>
      <div class="form-grid"><label class="field">Cards (e.g. 1-12, 20)<input type="text" id="shRange" placeholder="1-${Math.min(12, s.total || 12)}" value="1-${Math.min(12, s.total || 12)}"></label></div>
      <label class="field" style="margin-top:10px">Player names <span class="muted">(optional, one per line — the first name goes on the first card)</span><textarea id="shNames" rows="4" placeholder="Mum&#10;Rahul&#10;Nani&#10;Priya"></textarea></label>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="shGo">Save card images…</button><span class="muted small" id="shProg"></span></div>
      <div id="shRes"></div>`;
    $('#shGo', box).onclick = async () => {
      const range = $('#shRange', box).value.trim();
      if (!range) { toast('Type which cards to save, e.g. 1-12', 'err'); return; }
      const names = $('#shNames', box).value.split(/\r?\n/).map(x => x.trim());
      if (!s.locked && !await modal({ title: 'LOCK BINGO CARDS?', body: `<p><b style="color:#fff">Once these cards have been shared, their songs and arrangements cannot be changed.</b></p><p class="muted small">This keeps every shared card matching the Bingo checks. You can still add extra cards later.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: '🔒 Confirm & Lock', kind: 'primary', value: true }], dismissValue: false })) return;
      $('#shGo', box).disabled = true;
      try {
        const r = await api('cards:exportImages', { id: this.gameId, range, names, confirmLock: true });
        if (r) {
          s.locked = true;
          $('#shRes', box).innerHTML = `<div class="check-row" style="margin-top:12px"><span class="ic ok">✓</span><div class="grow"><b>${r.files} card image${r.files === 1 ? '' : 's'} saved${r.named ? ` · ${r.named} with player names` : ''}</b><div class="muted small">${esc(r.folder)}</div></div><button class="btn sm" id="shOpen">Open folder</button></div>`;
          $('#shOpen', box).onclick = () => api('shell:open', r.folder);
          this.summary();
        }
      } catch (e) { /* api() already showed the error */ }
      $('#shGo', box).disabled = false; $('#shProg', box).textContent = '';
    };
  },
  async summary() {
    const box = $('#cSum', this.el); if (!box) return;
    const s = await api('cards:summary', { id: this.gameId });
    const info = (await api('games:list')).find(g => g.id === this.gameId) || {};
    box.innerHTML = `<h2>Cards in this game ${s.locked ? '<span class="badge ok">🔒 LOCKED / ISSUED</span>' : '<span class="badge warn">DRAFT</span>'}</h2>
      ${s.locked ? `<div class="muted small" style="margin-bottom:10px">Issued ${s.lockedAt ? new Date(s.lockedAt).toLocaleString() : ''}. Song positions, card numbers and printed titles can never change — Bingo checks always use these locked cards.</div>`
        : `<div class="muted small" style="margin-bottom:10px">Draft: you can preview, regenerate cards or rebuild from an edited playlist. Cards lock automatically when you export the final PDF or print.</div>
          <div class="row" style="margin-bottom:12px"><button class="btn sm" id="cRegen" ${info.round ? 'disabled' : ''}>Regenerate all cards</button><button class="btn sm" id="cRebuild" ${info.round ? 'disabled' : ''}>Rebuild from playlist</button></div>`}
      <div class="row" style="gap:28px"><div class="stat"><span class="k">Generated</span><span class="big-num">${s.total}</span></div><div class="stat"><span class="k">Printed</span><span class="big-num">${s.printed}</span></div><div class="stat"><span class="k">Numbers left</span><span class="big-num">${s.remainingNumbers}</span></div></div>
      ${s.problems.length ? `<div class="badge bad" style="margin-top:10px">${esc(s.problems[0])}</div>` : (s.total ? '<div class="badge ok" style="margin-top:10px">✓ All cards unique · 25 different songs each</div>' : '')}
      <div style="margin-top:12px">${s.batches.map(b => `<div class="check-row"><div class="grow"><b>Batch ${b.batch}</b> · cards ${pad3(b.from)}–${pad3(b.to)}</div><span class="badge ${b.printed === b.count ? 'ok' : ''}">${b.printed}/${b.count} printed</span></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><input type="number" id="cMore" min="1" max="${s.remainingNumbers}" value="${Math.min(20, s.remainingNumbers)}" style="width:100px"><button class="btn" id="cGen" ${s.remainingNumbers ? '' : 'disabled'}>Generate more cards</button></div>
      <p class="muted tiny">New cards continue from the next unused number. Existing cards are never changed or reissued.</p>`;
    if ($('#cRegen', box)) $('#cRegen', box).onclick = async () => { if (await confirmBox('Regenerate draft cards?', 'All draft cards are replaced with new random cards. Only possible because nothing has been issued yet.', 'Regenerate')) { await api('cards:regenerate', { id: this.gameId, count: s.total }); toast('Draft cards regenerated', 'ok'); this.render(this.el); } };
    if ($('#cRebuild', box)) $('#cRebuild', box).onclick = async () => { if (await confirmBox('Rebuild from playlist?', 'The game takes a fresh snapshot of its playlist (including your edits), reshuffles the play order and regenerates the draft cards.', 'Rebuild')) { await api('games:rebuildFromPlaylist', { id: this.gameId }); toast('Game rebuilt from the playlist', 'ok'); this.render(this.el); } };
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
      <div class="row" style="gap:24px;margin-bottom:12px">${toggleHtml('ppQr', 'QR codes', cs.qr)}${toggleHtml('ppBw', 'Black & white (ink saver)', cs.bw)}${toggleHtml('ppLogo', 'Logo', cs.useLogo)}${toggleHtml('ppCut', 'Cutting guide', cs.cutLines !== false)}</div>
      <div class="field" style="margin-bottom:12px"><span class="muted small" style="font-weight:700">Squares show</span><div class="seg" id="ppShow"><button data-v="1" class="${cs.showArtist !== false ? 'on' : ''}">Song title + artist</button><button data-v="0" class="${cs.showArtist === false ? 'on' : ''}">Song title only</button></div></div>
      <div class="form-grid" style="margin-bottom:12px"><label class="field">Footer message (optional, 90 characters)<input type="text" id="ppFoot" maxlength="90" value="${esc(cs.footer || '')}" placeholder="e.g. Shout BINGO! and bring your card to the bar"></label>
        <label class="field">Song font<select id="ppFont">${[['inter', 'Modern (Inter)'], ['montserrat', 'Bold (Montserrat)'], ['classic', 'Classic (Arial)'], ['serif', 'Serif (Georgia)']].map(([v, l]) => `<option value="${v}" ${(cs.font || 'inter') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <p class="muted tiny" style="margin:-4px 0 12px">Footer and font change only how cards look. Card numbers and songs never change, even for cards already printed.</p>
      <label class="field" style="max-width:320px">Card text size: <span id="ppTsV">${Math.round(cs.textScale * 100)}%</span><input type="range" id="ppTs" min="80" max="125" step="5" value="${Math.round(cs.textScale * 100)}"></label>
      <div class="muted" id="ppInfo" style="margin:14px 0"></div>
      <div class="row"><button class="btn" id="ppPrev" title="Preview never locks the cards">🔍 Print preview</button><button class="btn" id="ppPdf">Export PDF…</button><button class="btn primary" id="ppPrint">🖨 Print…</button></div>
      <p class="muted tiny" style="margin-top:12px">A4 portrait, two cards per sheet (top &amp; bottom halves) with a dashed cut line. Print at <b>100% / Actual size</b> — do not use “fit to page” or multiple pages per sheet. Long titles shrink automatically; set a shorter “Printed title” in the Music Library if needed.</p>
      <div id="ppResult"></div>`;
    let sel = 'all'; let showArtist = cs.showArtist !== false;
    $$('#ppShow button', box).forEach(b => b.onclick = () => { showArtist = b.dataset.v === '1'; $$('#ppShow button', box).forEach(x => x.classList.toggle('on', x === b)); });
    const opts = () => ({ id: gameId, qr: $('#ppQr', box).checked, bw: $('#ppBw', box).checked, useLogo: $('#ppLogo', box).checked, cutLines: $('#ppCut', box).checked, showArtist, textScale: Number($('#ppTs', box).value) / 100, footer: $('#ppFoot', box).value, font: $('#ppFont', box).value, range: sel === 'range' ? $('#ppRange', box).value : null, onlyUnprinted: sel === 'unprinted' });
    const info = () => {
      let n = s.total; if (sel === 'unprinted') n = unprinted;
      if (sel === 'range') { try { n = (($('#ppRange', box).value || '').split(/[,\s]+/).filter(Boolean).reduce((a, p) => { const m = /^(\d+)(?:-(\d+))?$/.exec(p); if (!m) return a; const x = +m[1], y = m[2] ? +m[2] : x; return a + Math.abs(y - x) + 1; }, 0)); } catch (e) { n = 0; } }
      $('#ppInfo', box).innerHTML = `<b style="color:#fff">${n} card${n === 1 ? '' : 's'}</b> → <b style="color:#fff">${Math.ceil(n / 2)} A4 sheet${Math.ceil(n / 2) === 1 ? '' : 's'}</b>${n % 2 ? ' (last sheet: one card on the top half)' : ''}`;
    };
    $$('#ppSel button', box).forEach(b => b.onclick = () => { sel = b.dataset.v; $$('#ppSel button', box).forEach(x => x.classList.toggle('on', x === b)); $('#ppRangeRow', box).style.display = sel === 'range' ? 'block' : 'none'; info(); });
    $('#ppRange', box).oninput = info;
    $('#ppTs', box).oninput = (e) => { $('#ppTsV', box).textContent = e.target.value + '%'; };
    const saveOpts = () => { const o = opts(); api('settings:update', { cards: { qr: o.qr, bw: o.bw, useLogo: o.useLogo, textScale: o.textScale, showArtist: o.showArtist, cutLines: o.cutLines, footer: o.footer, font: o.font } }).then(st => { App.settings = st; }); };
    const busy = (on, label) => { $$('button', box).forEach(b => { b.disabled = on; }); $('#ppResult', box).innerHTML = on ? `<div class="badge pink" style="margin-top:10px">${label}</div>` : ''; };
    const done = (r, verb) => {
      if (!r) return;
      $('#ppResult', box).innerHTML = `<div class="check-row" style="margin-top:12px"><span class="ic ${r.overflow ? 'warn' : 'ok'}">${r.overflow ? '!' : '✓'}</span><div class="grow"><b>${verb}: ${r.cards} cards on ${r.sheets} A4 sheets</b><div class="muted small">${r.file ? esc(r.file) : ''}${r.overflow ? ` · ⚠ ${r.overflow} title(s) too long to print in full: ${esc((r.warnings || []).slice(0, 4).map(w => w.title).join(', '))} — set a shorter Printed title before locking` : ' · all text fits'}</div></div>${r.file ? '<button class="btn sm" id="ppOpen">Open</button><button class="btn sm" id="ppReveal">Show in folder</button>' : ''}</div>`;
      if (r.file && $('#ppOpen', box)) { $('#ppOpen', box).onclick = () => api('shell:open', r.file); $('#ppReveal', box).onclick = () => showInFolder(r.file); }
      if (after) after();
    };
    $('#ppPrev', box).onclick = async () => { saveOpts(); busy(true, 'Opening print preview…'); try { const r = await api('cards:preview', opts()); busy(false); if (r && r.warnings && r.warnings.length) toast(`${r.warnings.length} title(s) are too long to print at a readable size — see the preview`, 'err', 6000); } catch (e) { busy(false); } };
    const lockOk = async () => {
      if (s.locked) return true;
      return modal({ title: 'LOCK BINGO CARDS?', body: `<p><b style="color:#fff">Once these cards have been issued, their songs and arrangements cannot be changed. This ensures printed cards always match Bingo verification.</b></p><p class="muted small">Card numbers, the 25 songs on each card, their positions and the printed titles are fixed for this game. You can still add extra cards with unused numbers later. Music Library edits will not affect this game.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: '🔒 Confirm & Lock', kind: 'primary', value: true }], dismissValue: false });
    };
    $('#ppPdf', box).onclick = async () => { saveOpts(); if (!await lockOk()) return; busy(true, 'Creating PDF… (large print runs take a little while)'); try { const r = await api('cards:exportPdf', Object.assign(opts(), { confirmLock: true })); busy(false); done(r, 'PDF saved'); if (r && !s.locked) { s.locked = true; toast('Cards are now LOCKED / ISSUED', 'ok'); } } catch (e) { busy(false); } };
    $('#ppPrint', box).onclick = async () => { saveOpts(); if (!await lockOk()) return; busy(true, 'Preparing pages for the printer…'); try { const r = await api('cards:print', Object.assign(opts(), { confirmLock: true })); busy(false); if (r.printed) { toast(`Sent ${r.sheets} sheets to the printer — cards LOCKED`, 'ok'); s.locked = true; if (after) after(); } else toast('Printing cancelled — cards were not locked' + (r.reason && r.reason !== 'cancelled' ? ': ' + r.reason : ''), 'err'); } catch (e) { busy(false); } };
    info();
  }
});
