/* Desktop CLAIM FREEZE session — same laptop engine as the phone.
 * Freezing pauses the music and snapshots the eligible-song ledger; every card
 * checked in the session is verified against that exact snapshot. */
App.register('checker', { render() {} });

App.openChecker = async function (cardNo, opts = {}) {
  if (!App.game) return toast('Load a game first', 'err');
  if (App._checker) { if (cardNo) App._checker.add(String(cardNo)); return; }
  if (!App.game.round.number) return toast('Start Round 1 before checking claims', 'err');
  const fr = await App.cmd('freezeClaims');
  if (!fr || fr.ok === false) return;
  const SL = { pending: ['VALID — awaiting decision', 'warn'], confirmed: ['WINNER', 'ok'], invalid: ['NOT VALID', 'bad'], rejected: ['REJECTED', 'bad'], dismissed: ['DISMISSED', ''], duplicate: ['ALREADY WON', 'warn'] };
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="verdict dup" style="margin-bottom:14px" id="ckFrozen"></div>
    <div class="cols" style="grid-template-columns: 330px minmax(0,1fr)">
      <div>
        <div class="check-box" style="margin-bottom:10px"><input type="text" inputmode="numeric" id="ckNo" placeholder="Card no." maxlength="3"><button class="btn primary lg" id="ckGo">ADD</button><button class="btn lg" id="ckScan" title="Scan QR">📷</button></div>
        <div id="ckScanBox" style="display:none;margin-bottom:10px"><video class="scan" id="ckVid" playsinline muted></video><div class="muted small" id="ckScanMsg">Hold the card's QR code up to the laptop camera…</div></div>
        <div class="eyebrow" style="margin:6px 0">Claims in this session</div>
        <div id="ckList" class="hist-list" style="max-height:52vh"></div>
      </div>
      <div id="ckOut"><div class="empty">Enter each card number that called BINGO. Every card is checked against the same frozen list of songs.</div></div>
    </div>`;
  let selected = null, stream = null, raf = null;
  const sess = () => App.game && App.game.session;
  const drawHead = () => {
    const s = sess(); if (!s) return;
    body.querySelector('#ckFrozen').innerHTML = `<div class="grow"><div class="vt" style="font-size:26px">❄ CLAIMS FROZEN</div><div class="small" style="margin-top:4px;color:#fff">Session ${esc(s.id)} · Round ${s.round} — ${esc(s.roundLabel)} · <b>${s.snapshotCount}</b> eligible songs frozen · music paused at ${fmtTime(s.position)}</div><div class="muted tiny">Songs that finish after this moment can't affect these claims. Several winners can be confirmed.</div></div>`;
  };
  const drawList = () => {
    const s = sess(); const list = body.querySelector('#ckList'); if (!s || !list) return;
    list.innerHTML = s.claims.length ? s.claims.map(c => `<div class="hist-item ${selected === c.claimId ? 'current' : ''}" data-id="${c.claimId}" style="cursor:pointer"><span class="n" style="width:40px">${c.cardLabel}</span><div class="t"><span>${esc(c.headline)}</span></div><span class="badge ${SL[c.status][1]}">${SL[c.status][0]}</span>${c.status !== 'confirmed' ? `<button class="btn sm ghost" data-rm="${c.claimId}" title="Remove (entered by mistake)">✕</button>` : ''}</div>`).join('') : '<div class="muted small">No cards entered yet.</div>';
    $$('[data-id]', list).forEach(r => r.onclick = (e) => { if (e.target.dataset.rm) return; view(r.dataset.id); });
    $$('[data-rm]', list).forEach(b => b.onclick = async () => { if (await confirmBox('Remove this claim?', 'Use this when a card number was entered by mistake. It stays in the audit log.', 'Remove')) { await App.cmd('removeClaim', { claimId: b.dataset.rm }); if (selected === b.dataset.rm) { selected = null; body.querySelector('#ckOut').innerHTML = ''; } } });
  };
  const renderResult = (r) => {
    const out = body.querySelector('#ckOut');
    if (!r || r.ok === false) { out.innerHTML = `<div class="verdict invalid"><div><div class="vt">CANNOT CHECK</div><div>${esc((r && (r.error || r.message)) || 'Unknown error')}</div></div></div>`; return; }
    selected = r.claimId; drawList();
    const dup = r.alreadyWinner && r.status !== 'confirmed';
    const cls = r.status === 'confirmed' ? 'valid' : dup ? 'dup' : (r.valid ? 'valid' : 'invalid');
    const title = r.status === 'confirmed' ? 'WINNER CONFIRMED' : dup ? 'ALREADY A WINNER' : (r.valid ? 'VALID BINGO!' : 'NOT VALID');
    out.innerHTML = `
      ${r.duplicateEntry ? '<div class="badge warn" style="margin-bottom:8px">This card was already entered in this session — showing the same result</div>' : ''}
      <div class="verdict ${cls}"><div class="grow"><div class="vt">${title}</div><div style="font-weight:700;margin-top:4px;font-size:15px">${esc(r.explanation || ('Card ' + r.cardLabel + ' — ' + r.headline))}</div>
          ${r.completingSong ? `<div class="small" style="margin-top:6px">🎵 Completed by song <b>#${r.completingSong.n}</b>: <b>${esc(r.completingSong.title)}</b> — ${esc(r.completingSong.artist)}${r.completingSong.credit ? ' (technical credit)' : ''}</div>` : ''}
          ${r.best ? `<div class="small" style="margin-top:6px">Closest pattern: <b>${esc(r.best.description)}</b> — <b>${r.best.missing}</b> more song${r.best.missing === 1 ? '' : 's'} needed</div>` : ''}</div>
        <div style="text-align:right;min-width:170px"><div class="eyebrow">Round ${r.round} · to win</div><div class="display" style="font-size:20px">${esc(r.roundLabel)}</div><div style="width:64px;margin:6px 0 0 auto">${patternGridHtml(CMBPatterns.examples(r.round)[0])}</div></div></div>
      <div class="bcard">${r.grid.map(c => `<div class="bcell ${c.winning ? 'win' : (c.played ? 'played' : '')} ${c.inBest && !c.winning ? 'best' : ''} ${c.needed ? 'needed' : ''} ${c.completing ? 'completing' : ''}">${c.playedNo ? `<span class="pn">${c.credit ? 'TC ' : '#'}${c.playedNo}</span>` : (c.needed ? '<span class="pn need">NEEDED</span>' : '')}<b>${esc(c.title)}</b><span>${esc(c.artist)}</span></div>`).join('')}</div>
      <div class="row small muted" style="margin-top:10px;gap:14px;flex-wrap:wrap"><span><span class="lgd win"></span> winning line</span><span><span class="lgd played"></span> played (credited)</span><span><span class="lgd unplayed"></span> not played yet</span>${r.best ? '<span><span class="lgd needed"></span> still needed for the closest pattern</span>' : ''}<span>TC = technical credit</span>${r.completingSong ? '<span><span class="lgd completing"></span> winning song</span>' : ''}</div>
      <div class="row small muted" style="margin-top:6px;gap:16px"><span>${r.grid.filter(c => c.played).length}/25 on this card · checked against ${r.playedCount} frozen songs</span>${r.printed ? '' : '<span style="color:var(--amber)">⚠ card not marked as issued</span>'}${r.otherRoundWins.length ? `<span>Also won round ${r.otherRoundWins.join(', ')}</span>` : ''}</div>
      ${r.review ? `<div class="badge warn" style="margin-top:8px">${esc(r.review)}</div>` : ''}
      <div class="row" style="margin-top:14px">${r.status === 'confirmed' ? '<button class="btn" id="ckTvWin">📺 Show winner screen on TV</button>' : ''}${['invalid', 'rejected'].includes(r.status) ? '<button class="btn" id="ckTvWrong">📺 Show “Not a Bingo” on TV</button>' : ''}${r.status === 'pending' ? `<button class="btn success lg" id="ckConfirm">✓ Confirm winner</button><button class="btn danger" id="ckReject">Reject claim</button>` : (r.status === 'invalid' ? '<button class="btn danger" id="ckReject">Reject claim</button>' : '')}</div>`;
    const c = out.querySelector('#ckConfirm');
    if (c) c.onclick = async () => { const x = await App.cmd('confirmClaim', { claimId: r.claimId }); if (x && x.ok !== false) { toast(`Card ${r.cardLabel} confirmed as a Round ${r.round} winner`, 'ok', 5000); renderResult(x); } };
    const tw = out.querySelector('#ckTvWin'); if (tw) tw.onclick = () => App.cmd('showTvScreen', { claimId: r.claimId, type: 'winner' });
    const tr = out.querySelector('#ckTvWrong'); if (tr) tr.onclick = () => App.cmd('showTvScreen', { claimId: r.claimId, type: 'wrong' });
    const j = out.querySelector('#ckReject'); if (j) j.onclick = async () => { const x = await App.cmd('dismissClaim', { claimId: r.claimId }); if (x && x.ok !== false) renderResult(x); };
  };
  const view = async (claimId) => renderResult(await App.cmd('viewClaim', { claimId }));
  const add = async (input, isQr) => {
    body.querySelector('#ckOut').innerHTML = '<div class="muted">Checking…</div>';
    renderResult(await App.cmd('addClaim', isQr ? { qr: input } : { cardNo: input }));
    const i = body.querySelector('#ckNo'); i.value = ''; i.focus();
  };
  const go = () => { const v = body.querySelector('#ckNo').value.trim(); if (v) add(v); };
  body.querySelector('#ckGo').onclick = go;
  body.querySelector('#ckNo').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  const stopScan = () => { if (raf) cancelAnimationFrame(raf); raf = null; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; const sb = body.querySelector('#ckScanBox'); if (sb) sb.style.display = 'none'; };
  const startScan = async () => {
    const sb = body.querySelector('#ckScanBox'); sb.style.display = 'block';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
      const v = body.querySelector('#ckVid'); v.srcObject = stream; await v.play();
      const cv = document.createElement('canvas'); const ctx = cv.getContext('2d', { willReadFrequently: true });
      const loop = () => {
        if (!stream) return;
        if (v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0); const img = ctx.getImageData(0, 0, cv.width, cv.height); const code = window.jsQR && jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (code && code.data) { stopScan(); add(code.data, true); return; } }
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { body.querySelector('#ckScanMsg').textContent = 'No camera available (' + e.message + '). Type the card number instead.'; }
  };
  body.querySelector('#ckScan').onclick = () => (stream ? stopScan() : startScan());
  const unsub = (s) => { drawHead(); drawList(); if (!sess() && App._checker) App._checker.closeModal(); };
  App.onEvt('state', unsub);
  const closeSession = async (resume) => {
    let r = await App.cmd('closeSession', { resume });
    if (r && r.needsDecision) {
      const ok = await modal({ title: 'Undecided claims', body: `<p>${esc(r.message)}</p><p class="muted small">Pending claims are never dismissed silently.</p>`, buttons: [{ label: 'Go back and decide', value: false, kind: 'primary' }, { label: 'Dismiss them & close', value: true, kind: 'danger' }], dismissValue: false });
      if (!ok) return false;
      r = await App.cmd('closeSession', { resume, dismissPending: true });
    }
    return r && r.ok !== false;
  };
  let closeModalFn = null;
  App._checker = { add: (n) => add(n), closeModal: () => closeModalFn && closeModalFn(null) };
  const pausedNote = fr.paused ? 'Close & resume music' : 'Close session';
  await modal({ title: 'BINGO claims', size: 'wide', body,
    onMount: (b, close) => { closeModalFn = close; drawHead(); drawList(); if (cardNo) add(String(cardNo)); else body.querySelector('#ckNo').focus(); if (opts.scan) startScan(); },
    buttons: [
      { label: 'Hide (session stays frozen)', value: null },
      { label: 'Close session (keep paused)', value: 'close', onClick: () => { closeSession(false).then(ok => { if (ok) closeModalFn('closed'); }); return false; } },
      { label: '▶ ' + pausedNote, kind: 'primary', value: 'resume', onClick: () => { closeSession(true).then(ok => { if (ok) closeModalFn('closed'); }); return false; } }
    ] });
  stopScan();
  const L = App.listeners.state; const i = L.indexOf(unsub); if (i >= 0) L.splice(i, 1);
  App._checker = null;
};
