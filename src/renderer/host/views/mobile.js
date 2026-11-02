App.register('mobile', {
  async render(el) {
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Phone remote</div><h1>Mobile Host Connection</h1><p>Run the whole night from your phone. The laptop still plays all music and video — the phone is only a remote control.</p></div></div><div id="mBody"></div>`;
    this.renderInto($('#mBody', el), false);
  },
  on_remote() { if (this.box && document.body.contains(this.box)) this.draw(); },
  async renderInto(box, compact) { this.box = box; this.compact = compact; App.remote = await api('remote:info'); this.draw(); },
  draw() {
    const r = App.remote || {}; const box = this.box;
    box.innerHTML = `<div class="cols c2">
      <div class="panel" style="text-align:center">
        ${r.running ? `<div class="eyebrow">Scan with your phone camera</div><div class="qrbox" style="margin:14px 0"><img src="${r.qr}" alt="QR code"></div>
          <div class="muted small">or open this address in Safari / Chrome:</div><div class="display" style="font-size:24px;margin:6px 0 2px">${esc(r.url)}</div>
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
          <li>Windows may ask to allow Crime Master Bingo through the firewall the first time — choose <b style="color:#fff">Private networks → Allow</b>.</li></ol>
        <h2>Paired devices</h2>
        ${r.devices && r.devices.length ? r.devices.map(d => `<div class="check-row"><span class="dot ${d.online ? 'on' : ''}" style="margin-top:6px"></span><div class="grow"><b>${esc(d.name)}</b><div class="muted small">${d.online ? 'Connected now' : (d.lastSeen ? 'Last seen ' + new Date(d.lastSeen).toLocaleString() : 'Paired ' + new Date(d.pairedAt).toLocaleString())}</div></div><button class="btn sm danger" data-rev="${d.id}">Remove</button></div>`).join('') : '<div class="muted small">No phones paired yet.</div>'}
        ${this.compact ? '' : `<h2 style="margin-top:18px">Network port</h2><div class="row"><input type="number" id="mPort" value="${r.port || 8787}" style="width:110px"><button class="btn sm" id="mPortGo">Change port</button><span class="muted tiny">Default 8787</span></div>`}
      </div></div>`;
    const b = (id, fn) => { const x = box.querySelector(id); if (x) x.onclick = fn; };
    b('#mStart', async () => { App.remote = await api('remote:start'); this.draw(); });
    b('#mStop', async () => { if (await confirmBox('Stop the remote service?', 'Connected phones will disconnect. The laptop keeps working normally.', 'Stop', true)) { App.remote = await api('remote:stop'); this.draw(); } });
    b('#mPin', async () => { App.remote = await api('remote:newPin'); this.draw(); });
    b('#mPortGo', async () => { App.remote = await api('remote:setPort', { port: Number(box.querySelector('#mPort').value) }); this.draw(); });
    $$('[data-rev]', box).forEach(x => x.onclick = async () => { if (await confirmBox('Remove this phone?', 'It will be disconnected immediately and must pair again with the PIN.', 'Remove', true)) { App.remote = await api('remote:revoke', { deviceId: x.dataset.rev }); this.draw(); } });
  }
});
