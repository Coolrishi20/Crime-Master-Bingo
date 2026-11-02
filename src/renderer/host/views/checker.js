/* Desktop BINGO checker — uses the same laptop verification engine as the phone. */
App.register('checker', { render() {} });

App.openChecker = async function (cardNo, opts = {}) {
  if (!App.game) return toast('Load a game first', 'err');
  if (App._checkerOpen) { if (cardNo && App._checkerRun) App._checkerRun(cardNo); return; }
  App._checkerOpen = true;
  const open = await App.cmd('openChecker');
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="check-box" style="margin-bottom:14px"><input type="text" inputmode="numeric" id="ckNo" placeholder="Card number" maxlength="3"><button class="btn primary lg" id="ckGo">CHECK</button><button class="btn lg" id="ckScan" title="Scan the QR code on the card">📷</button></div>
    <div id="ckScanBox" style="display:none;margin-bottom:12px"><video class="scan" id="ckVid" playsinline muted></video><div class="muted small" id="ckScanMsg">Hold the card's QR code up to the laptop camera…</div></div>
    <div id="ckPaused" class="muted small" style="margin-bottom:10px">${open && open.paused ? '⏸ Music paused for the check — the exact position is saved.' : ''}</div>
    <div id="ckOut"><div class="muted">Enter the number printed on the player's card (e.g. 457).</div></div>`;
  let stream = null, raf = null;
  const stopScan = () => { if (raf) cancelAnimationFrame(raf); raf = null; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; const sb = body.querySelector('#ckScanBox'); if (sb) sb.style.display = 'none'; };
  const run = async (input, isQr) => {
    const out = body.querySelector('#ckOut');
    out.innerHTML = '<div class="muted">Checking…</div>';
    const r = await App.cmd('checkClaim', isQr ? { qr: input } : { cardNo: input });
    if (!r || r.ok === false) { out.innerHTML = `<div class="verdict invalid"><div><div class="vt">CANNOT CHECK</div><div>${esc((r && (r.error || r.message)) || 'Unknown error')}</div></div></div>`; return; }
    renderResult(out, r);
  };
  App._checkerRun = (n) => { body.querySelector('#ckNo').value = n; run(n); };
  const renderResult = (out, r) => {
    const dup = r.alreadyWinner;
    const cls = dup ? 'dup' : (r.valid ? 'valid' : 'invalid');
    const title = dup ? 'ALREADY A WINNER' : (r.valid ? 'VALID BINGO!' : 'NOT VALID');
    out.innerHTML = `
      <div class="verdict ${cls}"><div class="grow"><div class="vt">${title}</div><div style="font-weight:700;margin-top:4px">Card ${r.cardLabel} — ${esc(r.headline)}</div><div class="muted small" style="margin-top:2px">${esc(r.reason)}</div></div>
        <div style="text-align:right"><div class="eyebrow">Round ${r.round}${r.roundStatus === 'ended' ? ' (ended)' : ''}</div><div class="display" style="font-size:20px">${esc(r.roundLabel)}</div></div></div>
      <div class="bcard">${r.grid.map((c, i) => `<div class="bcell ${c.winning ? 'win' : (c.played ? 'played' : '')}">${c.playedNo ? `<span class="pn">#${c.playedNo}</span>` : ''}<b>${esc(c.title)}</b><span>${esc(c.artist)}</span></div>`).join('')}</div>
      <div class="row small muted" style="margin-top:10px;gap:16px"><span><span class="badge pink">■</span> winning line</span><span><span class="badge">■</span> played</span><span>${r.grid.filter(c => c.played).length}/25 played on this card</span>${r.qualifiedAtSong ? `<span>Qualified at song #${r.qualifiedAtSong} of ${r.playedCount}</span>` : ''}${r.printed ? '' : '<span style="color:var(--amber)">⚠ This card number is not marked as printed</span>'}${r.otherRoundWins.length ? `<span>Also won round ${r.otherRoundWins.join(', ')}</span>` : ''}</div>
      <div class="row" style="margin-top:14px">${r.valid && !dup ? `<button class="btn success lg" id="ckConfirm">✓ Confirm winner</button><button class="btn danger" id="ckDismiss">Dismiss claim</button>` : (!r.valid ? '<button class="btn danger" id="ckReject">Reject claim</button>' : '')}</div>`;
    const c = out.querySelector('#ckConfirm');
    if (c) c.onclick = async () => { const x = await App.cmd('confirmClaim', { claimId: r.claimId }); if (x && x.ok) { toast(`Card ${r.cardLabel} confirmed as a Round ${r.round} winner`, 'ok', 5000); out.querySelector('.verdict .vt').textContent = 'WINNER CONFIRMED'; c.remove(); const d = out.querySelector('#ckDismiss'); if (d) d.remove(); } };
    const d = out.querySelector('#ckDismiss'); if (d) d.onclick = async () => { await App.cmd('dismissClaim', { claimId: r.claimId }); toast('Claim dismissed'); d.remove(); if (c) c.remove(); };
    const j = out.querySelector('#ckReject'); if (j) j.onclick = async () => { await App.cmd('dismissClaim', { claimId: r.claimId }); toast('Claim rejected'); j.remove(); };
  };
  body.querySelector('#ckGo').onclick = () => { const v = body.querySelector('#ckNo').value.trim(); if (v) run(v); };
  body.querySelector('#ckNo').onkeydown = (e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) run(v); } };
  const startScan = async () => {
    const sb = body.querySelector('#ckScanBox'); sb.style.display = 'block';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
      const v = body.querySelector('#ckVid'); v.srcObject = stream; await v.play();
      const cv = document.createElement('canvas'); const ctx = cv.getContext('2d', { willReadFrequently: true });
      const loop = () => {
        if (!stream) return;
        if (v.videoWidth) {
          cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, cv.width, cv.height);
          const code = window.jsQR && jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) { stopScan(); run(code.data, true); return; }
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { body.querySelector('#ckScanMsg').textContent = 'No camera available (' + e.message + '). Type the card number instead.'; }
  };
  body.querySelector('#ckScan').onclick = () => (stream ? stopScan() : startScan());
  const wasPaused = open && open.paused;
  const resume = await modal({ title: 'Check a BINGO!', size: 'wide', body,
    onMount: () => { if (cardNo) { body.querySelector('#ckNo').value = cardNo; run(String(cardNo)); } if (opts.scan) startScan(); },
    buttons: [{ label: 'Close (keep music paused)', value: false }, { label: wasPaused ? '▶ Close & resume music' : 'Close', kind: 'primary', value: true }], dismissValue: false });
  stopScan();
  App._checkerOpen = false; App._checkerRun = null;
  await App.cmd('closeChecker', { resume: !!(resume && wasPaused) });
};
