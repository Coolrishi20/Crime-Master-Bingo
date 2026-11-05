/* Anthem Square — "Ready for Bingo?" (2.3): every pre-game check in one place, problems first,
 * each with the button that fixes it. Opened from the Dashboard, Host Game and Create Game. */
(function () {
  'use strict';
  const FIX = {
    media: ['Find them…', () => App.show('backup')],
    mediacheck: ['Open media check', () => mediaCheck({})],
    codecs: ['Open media check', () => mediaCheck({})],
    clips: ['Open media check', () => mediaCheck({})],
    cards: ['Cards…', () => App.show('cards')],
    printed: ['Print cards…', () => App.show('cards')],
    audience: ['Open TV window', () => api('audience:open', {})],
    tv: ['Show me how', () => modal({ title: 'Connect the TV', size: 'mid', body: '<ol><li>Connect the TV or projector with an HDMI cable.</li><li>Press <b>Windows + P</b> on the laptop and choose <b>Extend</b>.</li><li>Click <b>Check again</b>: Anthem Square puts its TV window on the second screen.</li></ol><p class="muted small">“Duplicate” shows your laptop screen to the room — use Extend.</p>' })],
    remote: ['Show QR', () => App.show('mobile')],
    audio: ['Music Library', () => App.show('library')],
    backup: ['Back up now…', () => App.show('backup')],
    lowres: ['Turn on', async () => { const s = await api('settings:get'); await api('settings:update', { performance: Object.assign({}, s.performance || {}, { lowResource: true }) }); App.settings = await api('settings:get'); toast('Low Resource Mode is on', 'ok'); }],
    decode: ['Run test', async () => { toast('Playing 5 seconds off-screen…'); await api('health:decodeTest'); }],
    youtube: null, lock: null, verify: null, overlay: ['Settings', () => App.show('settings')], crawler: ['Settings', () => App.show('settings')]
  };
  async function readyCheck() {
    const body = document.createElement('div');
    const draw = async () => {
      const r = await api('game:preflight');
      const bad = r.checks.filter(c => !c.ok && !c.warn), warn = r.checks.filter(c => !c.ok && c.warn), ok = r.checks.filter(c => c.ok);
      const row = (c, kind) => { const f = FIX[c.key]; return `<div class="check-row"><span class="ic ${kind}">${kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '×'}</span><div class="grow"><b>${esc(c.label)}</b><div class="muted small">${esc(c.detail || '')}</div></div>${f && kind !== 'ok' ? `<button class="btn sm${kind === 'bad' ? ' primary' : ''}" data-fix="${c.key}">${esc(f[0])}</button>` : ''}</div>`; };
      body.innerHTML = `<div class="row" style="margin-bottom:10px"><b>${esc(App.game ? App.game.name : 'No game loaded')}</b><span class="grow"></span><button class="btn sm" id="rcAgain">↻ Check again</button></div>
        ${bad.length ? `<div class="rc-h bad">ACTION REQUIRED · ${bad.length}</div>${bad.map(c => row(c, 'bad')).join('')}` : ''}
        ${warn.length ? `<div class="rc-h warn">WARNING · ${warn.length}</div>${warn.map(c => row(c, 'warn')).join('')}` : ''}
        <details class="rc-ok" ${!bad.length && !warn.length ? 'open' : ''}><summary><span class="rc-h ok" style="display:inline">READY · ${ok.length}</span> <span class="muted small">${ok.map(c => esc(c.label)).join(' · ')}</span></summary>${ok.map(c => row(c, 'ok')).join('')}</details>
        ${!bad.length ? '<div class="banner" style="margin-top:12px"><div class="grow"><h3>✓ Ready for Bingo</h3><div class="muted">Nothing blocks the game. Warnings are worth a look but are optional.</div></div></div>' : ''}`;
      body.querySelector('#rcAgain').onclick = draw;
      body.querySelectorAll('[data-fix]').forEach(b => b.onclick = async () => { const f = FIX[b.dataset.fix]; if (!f) return; b.disabled = true; try { const navigates = /App\.show/.test(String(f[1])); if (navigates) { closeTopModal(); await f[1](); return; } await f[1](); } finally { b.disabled = false; } draw(); });
    };
    await draw();
    await modal({ title: 'Ready for Bingo?', size: 'wide', body, buttons: [{ label: 'Close', value: true, kind: 'primary' }] });
  }
  window.readyCheck = readyCheck;
})();
