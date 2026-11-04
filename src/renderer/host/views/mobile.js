App.register('mobile', {
  async render(el) {
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Phone remote</div><h1>Mobile Host Connection</h1><p>Run the whole night from your phone. The laptop still plays all music and video — the phone is only a remote control.</p></div></div><div id="mPlayers"></div><div id="mBody"></div>`;
    this.pbox = $('#mPlayers', el);
    this.renderInto($('#mBody', el), false);
    this.players();
  },
  on_remote() { if (this.box && document.body.contains(this.box)) this.draw(); this.drawPlayers(); },
  on_state() { this.drawPlayers(); },

  /* ---------------- home play: phone cards for players */
  async players() {
    const box = this.pbox; if (!box) return;
    App.settings = await api('settings:get');
    if (!(App.settings.home && App.settings.home.phoneCards)) {
      box.innerHTML = `<div class="panel" style="margin-bottom:16px"><div class="row"><div class="grow"><h2 style="margin:0">📱 Phone cards for players</h2><div class="muted small">Let family and friends play on their phones — no printing. Turn it on in Settings → Home play.</div></div><button class="btn sm" id="mpOn">Turn on</button></div></div>`;
      $('#mpOn', box).onclick = async () => { App.settings = await api('settings:update', { home: { phoneCards: true } }); this.players(); };
      return;
    }
    this.join = await api('players:join');
    box.innerHTML = `<div class="panel" style="margin-bottom:16px"><div class="cols" style="grid-template-columns:230px minmax(0,1fr);gap:22px">
      <div style="text-align:center" id="mpQr"></div>
      <div><div class="row"><h2 class="grow" style="margin:0">📱 Players on their phones</h2><span id="mpOpenWrap"></span></div>
        <div class="muted small" style="margin:4px 0 10px">Players scan the code (or type the address), enter their name and get their own card. They tap songs as they hear them; pressing <b style="color:#fff">BINGO!</b> is checked instantly — real bingos freeze the claims here for you to confirm, early presses are only told “not yet” on their phone.</div>
        <div id="mpList" class="hist-list" style="max-height:300px"></div></div></div></div>`;
    this.drawPlayers();
  },
  drawPlayers() {
    const box = this.pbox; if (!box || !document.body.contains(box) || !$('#mpList', box)) return;
    const g = App.game; const j = this.join || {};
    const online = new Set((App.remote && App.remote.playersOnline) || []);
    $('#mpQr', box).innerHTML = !g ? '<div class="empty small">Load a game to let players join.</div>'
      : !j.running ? '<div class="empty small">Start the remote service (below) so phones can connect.</div>'
      : `<div class="qrbox" style="margin:0 auto 8px;max-width:200px"><img src="${j.qr}" alt="Join QR" style="width:100%"></div><div class="small" style="font-weight:800;word-break:break-all">${esc(j.url)}</div><div class="muted tiny" style="margin-top:4px">Same Wi-Fi as this laptop</div>`;
    $('#mpOpenWrap', box).innerHTML = g ? toggleHtml('mpOpen', g.playersOpen ? 'Joining open' : 'Joining closed', g.playersOpen) : '';
    const t = $('#mpOpen', box); if (t) t.onchange = (e) => App.cmd('setPlayersOpen', { open: e.target.checked });
    const pl = (g && g.players) || [];
    $('#mpList', box).innerHTML = pl.length ? pl.map(p => `<div class="check-row"><span class="dot ${online.has(p.id) ? 'on' : ''}" style="margin-top:6px" title="${online.has(p.id) ? 'Connected' : 'Not connected right now'}"></span><div class="grow"><b>${esc(p.name)}</b> <span class="muted small">· card ${p.cardLabel}</span>${p.wins.length ? ` <span class="badge ok">🏆 R${p.wins.join(', R')}</span>` : ''}<div class="muted tiny">Joined ${new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${p.calls ? ` · pressed BINGO ${p.calls}×` : ''}</div></div><button class="btn sm ghost" data-ren="${p.id}">Rename</button><button class="btn sm danger" data-kick="${p.id}">Remove</button></div>`).join('')
      : `<div class="muted small">${g ? 'Nobody has joined yet.' : ''}</div>`;
    $$('[data-ren]', box).forEach(b => b.onclick = async () => { const p = pl.find(x => x.id === b.dataset.ren); const n = await promptBox('Rename player', 'Name', p.name); if (n) App.cmd('playerRename', { playerId: p.id, name: n }); });
    $$('[data-kick]', box).forEach(b => b.onclick = async () => { const p = pl.find(x => x.id === b.dataset.kick); if (await confirmBox('Remove ' + esc(p.name) + '?', `Their phone leaves the game. Card ${p.cardLabel} stays issued and is never given to anyone else.`, 'Remove', true)) App.cmd('playerRemove', { playerId: p.id }); });
  },
  async renderInto(box, compact) { this.box = box; this.compact = compact; App.remote = await api('remote:info'); this.draw(); },
  draw() {
    const r = App.remote || {}; const box = this.box;
    box.innerHTML = `<div class="cols c2">
      <div class="panel" style="text-align:center">
        ${r.running ? `<div class="eyebrow">Scan with your phone camera</div><div class="qrbox" style="margin:14px 0"><img src="${r.qr}" alt="QR code"></div>
          <div class="muted small">or open this address in Safari / Chrome:</div><div class="display" style="font-size:24px;margin:6px 0 2px">${esc(r.qrUrl || r.url)}</div>
          ${r.secureMode ? `<div class="check-row" style="text-align:left;margin-top:10px"><span class="ic ok">🔒</span><div><b>Secure link — live QR scanning with the phone camera</b><div class="muted small">First time on each phone the browser warns that the connection isn't private (it's this laptop's own certificate). Tap <b>Advanced → Proceed</b> (Android / Chrome) or <b>Show Details → visit this website</b> (iPhone). Only needed once per phone.</div></div></div>
            <details style="text-align:left;margin-top:8px"><summary class="muted small" style="cursor:pointer">Standard link (no warning, camera takes a photo instead)</summary><div class="row" style="margin-top:8px"><img src="${r.plainQr}" style="width:120px;height:120px;background:#fff;border-radius:8px;padding:4px"><div class="small">${esc(r.url)}</div></div></details>` : (r.httpsError ? `<div class="badge warn" style="margin-top:8px">Secure link unavailable: ${esc(r.httpsError)}</div>` : '')}
          ${r.addresses && r.addresses.length > 1 ? `<div class="tiny muted">Other addresses: ${r.addresses.slice(1).map(a => esc(a.url)).join(' · ')}</div>` : ''}
          <div class="eyebrow" style="margin-top:16px">Pairing PIN</div><div class="pin">${esc(r.pin)}</div>
          <div class="row" style="justify-content:center;margin-top:8px"><button class="btn sm" id="mPin">New PIN</button><button class="btn sm danger" id="mStop">Stop remote service</button></div>`
        : `<div class="empty"><p>${r.error ? esc(r.error) : 'The remote-control service is off.'}</p><button class="btn primary" id="mStart">Start remote service</button></div>`}
      </div>
      <div class="panel"><h2>How to connect</h2>
        <ol class="muted" style="line-height:1.8;padding-left:18px;margin:0 0 14px">
          <li>Connect your phone to the <b style="color:#fff">same Wi-Fi</b> as this laptop (no internet needed — a mobile hotspot from the laptop or a travel router works too).</li>
          <li>Scan the QR code. It opens the remote and pairs automatically (or type the address, then the PIN).</li>
          <li>The phone stays paired — it reconnects by itself after locking or a Wi-Fi drop.</li>
          <li>Windows may ask to allow Anthem Square through the firewall the first time — choose <b style="color:#fff">Private networks → Allow</b>.</li></ol>
        <h2>Paired devices</h2>
        ${r.devices && r.devices.length ? r.devices.map(d => `<div class="check-row"><span class="dot ${d.online ? 'on' : ''}" style="margin-top:6px"></span><div class="grow"><b>${esc(d.name)}</b><div class="muted small">${d.online ? 'Connected now' : (d.lastSeen ? 'Last seen ' + new Date(d.lastSeen).toLocaleString() : 'Paired ' + new Date(d.pairedAt).toLocaleString())}</div></div><button class="btn sm danger" data-rev="${d.id}">Remove</button></div>`).join('') : '<div class="muted small">No phones paired yet.</div>'}
        <div class="row" style="margin-top:16px">${toggleHtml('mSecure', 'Secure link (live QR scanning on phones)', !!(App.settings.remote && App.settings.remote.secure !== false))}</div>
        ${this.compact ? '' : `<h2 style="margin-top:18px">Network port</h2><div class="row"><input type="number" id="mPort" value="${r.port || 8787}" style="width:110px"><button class="btn sm" id="mPortGo">Change port</button><span class="muted tiny">Default 8787</span></div>`}
      </div></div>`;
    const b = (id, fn) => { const x = box.querySelector(id); if (x) x.onclick = fn; };
    b('#mStart', async () => { App.remote = await api('remote:start'); this.draw(); });
    b('#mStop', async () => { if (await confirmBox('Stop the remote service?', 'Connected phones will disconnect. The laptop keeps working normally.', 'Stop', true)) { App.remote = await api('remote:stop'); this.draw(); } });
    const sec = box.querySelector('#mSecure'); if (sec) sec.onchange = async (e) => { App.remote = await api('remote:setSecure', { secure: e.target.checked }); App.settings = await api('settings:get'); this.draw(); };
    b('#mPin', async () => { App.remote = await api('remote:newPin'); this.draw(); });
    b('#mPortGo', async () => { App.remote = await api('remote:setPort', { port: Number(box.querySelector('#mPort').value) }); this.draw(); });
    $$('[data-rev]', box).forEach(x => x.onclick = async () => { if (await confirmBox('Remove this phone?', 'It will be disconnected immediately and must pair again with the PIN.', 'Remove', true)) { App.remote = await api('remote:revoke', { deviceId: x.dataset.rev }); this.draw(); } });
  }
});
