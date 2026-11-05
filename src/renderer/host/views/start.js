/* Anthem Square — "Get started" first-time host guide (2.4). Nine set-up steps that tick
 * themselves, a rehearsal game with practice clips (never saved to history), and the
 * "your music, your responsibility" notice. Can be skipped and reopened from the Dashboard. */
const START_HELP = {
  import: 'Click <b>Import videos</b> or drag a folder onto the Music Library. MP4 (H.264/AAC) works best; other formats are converted for you, and your original files are never changed.',
  playlist: 'Make a playlist of at least 40 songs. More songs make longer, fairer games — 75 is a good full night.',
  clips: 'Most songs need nothing: quiet intros are skipped automatically. Open any song and use the <b>Clip</b> tab to choose its best part.',
  cards: 'Create a game: choose a preset or your own rules, then generate one card per player. Card numbers never change once made.',
  print: 'Print two cards per A4 sheet at 100% size, or export a PDF. Printing locks the cards.',
  tv: 'Connect the TV with HDMI and press <b>Windows + P → Extend</b>. The TV window opens on the second screen.',
  phone: 'Scan the QR code on <b>Mobile Host Connection</b> with your phone to run the night from anywhere in the room.',
  rehearse: 'Play a practice game with test-pattern clips — try Play, Next, Return to Quiz and the TV. Nothing is saved to your history.',
  claim: 'In the rehearsal, press <b>CHECK BINGO</b> and enter card <b>001</b> to see how a claim is checked.'
};
App.register('start', {
  async render(el) {
    this.el = el;
    const st = await api('onboarding:status');
    const cur = st.steps.find(s => !s.done) || st.steps[st.steps.length - 1];
    this.sel = this.sel && st.steps.find(s => s.key === this.sel) ? this.sel : cur.key;
    const sel = st.steps.find(s => s.key === this.sel);
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Get started</div><h1>Welcome to Anthem Square</h1><p>Your first Bingo break in about 15 minutes. ${st.done} of ${st.total} done.</p></div>
        <div class="row"><button class="btn ghost" id="obSkip">${st.done === st.total ? 'Done — hide this page' : 'Skip for now'}</button></div></div>
      ${st.noticeAccepted ? '' : `<div class="banner" id="obNotice"><div class="grow"><h3>Your music, your responsibility</h3><div class="muted">Anthem Square is software only. It does not supply music or videos, and it does not provide music licences or permission to run events or give prizes. You are responsible for using media you have the rights to play in public and for any permissions your event needs.</div></div><button class="btn primary" id="obAccept">I understand</button></div>`}
      <div class="cols ob-cols">
        <div class="panel"><div class="ob-steps">${st.steps.map((s, i) => `<button class="ob-step ${s.done ? 'done' : ''} ${s.key === this.sel ? 'on' : ''}" data-k="${s.key}"><span class="n">${s.done ? '✓' : i + 1}</span>${esc(s.label)}</button>`).join('')}</div></div>
        <div class="panel"><div class="eyebrow">Step ${st.steps.indexOf(sel) + 1}${sel.done ? ' · done' : ''}</div><h2 style="margin-top:4px">${esc(sel.label)}</h2><p>${START_HELP[sel.key]}</p>
          <div class="row" id="obActs">${sel.go === 'rehearse' ? (st.rehearsal ? `<button class="btn primary" id="obHost">Go to the rehearsal</button><button class="btn" id="obEnd">End rehearsal</button>` : '<button class="btn primary" id="obReh">▶ Start rehearsal game</button>') : `<button class="btn primary" id="obGo">Open ${esc(sel.label.toLowerCase())}</button>`}
          ${['clips', 'tv'].includes(sel.key) && !sel.done ? '<button class="btn ghost" id="obMark">Mark as done</button>' : ''}</div>
          <div id="obProg" class="muted small" style="margin-top:10px"></div>
          ${sel.go === 'rehearse' ? '<p class="muted small" style="margin-top:14px">Practice clips are generated test patterns with tones — no commercial music is included with Anthem Square.</p>' : ''}</div>
      </div>`;
    $$('.ob-step', el).forEach(b => b.onclick = () => { this.sel = b.dataset.k; this.render(el); });
    if ($('#obAccept', el)) $('#obAccept', el).onclick = async () => { await api('notice:accept'); this.render(el); };
    $('#obSkip', el).onclick = async () => { await api('onboarding:set', st.done === st.total ? { done: true } : { dismissed: true }); App.show('dashboard'); };
    if ($('#obGo', el)) $('#obGo', el).onclick = () => App.show(sel.go, sel.go === 'create' ? 'new' : undefined);
    if ($('#obMark', el)) $('#obMark', el).onclick = async () => { await api('onboarding:set', { [sel.key]: true }); this.render(el); };
    if ($('#obReh', el)) $('#obReh', el).onclick = async () => {
      $('#obReh', el).disabled = true; $('#obProg', el).textContent = 'Making practice clips…';
      try { await api('rehearsal:start'); await api('audience:open', {}); App.show('host'); toast('Rehearsal started — practise freely, nothing is saved to your history', 'ok', 6000); }
      catch (e) { $('#obReh', el).disabled = false; $('#obProg', el).textContent = ''; }
    };
    if ($('#obHost', el)) $('#obHost', el).onclick = () => App.show('host');
    if ($('#obEnd', el)) $('#obEnd', el).onclick = async () => { await api('rehearsal:end'); this.render(el); };
  },
  on_rehearsalProgress(p) { const b = $('#obProg', this.el); if (b) b.textContent = `Making practice clips… ${p.done} of ${p.total}`; }
});
