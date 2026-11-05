/* Anthem Square — live TV preview. The REAL audience page (?preview=1) rendered at 1920×1080 and
 * scaled down, fed with the settings being edited, so crawler speed/size/height, the song-title
 * overlay, the winning-pattern or checklist panel position and the rules look exactly as on the TV
 * and change the moment a field changes. Uses songs/thumbnails from the library when available. */
(function () {
  'use strict';
  const W = 1920, H = 1080;
  let sample = null;
  async function samples() {
    if (sample) return sample;
    try {
      const lib = (await apiQuiet('library:list')).songs.filter(s => s.title && s.artist && s.status === 'ok');
      sample = { songs: lib.slice(0, 14).map(s => ({ title: s.displayTitle || s.title, artist: s.artist })), bg: (lib.find(s => s.thumb) || {}).thumb || null };
    } catch (e) { sample = { songs: [], bg: null }; }
    if (sample.songs.length < 6) sample.songs = [['Dancing Queen', 'ABBA'], ['Wonderwall', 'Oasis'], ['Billie Jean', 'Michael Jackson'], ['Tum Hi Ho', 'Arijit Singh'], ['Bohemian Rhapsody', 'Queen'], ['Rolling in the Deep', 'Adele'], ['Uptown Funk', 'Mark Ronson'], ['Chaiyya Chaiyya', 'Sukhwinder Singh']].map(([title, artist]) => ({ title, artist }));
    return sample;
  }
  const infoCache = new Map();
  async function rulesView(cfg) {
    if (cfg.mode === 'checklist') {
      const key = 'c' + JSON.stringify(cfg.checklist || []);
      if (!infoCache.has(key)) infoCache.set(key, await apiQuiet('rules:checklistInfo', { items: cfg.checklist || [] }).catch(() => []));
      const items = infoCache.get(key).map((it, i) => ({ id: it.id, label: it.label, short: it.short, example: it.examples[0], done: i === 1 }));
      return { mode: 'checklist', checklist: { total: items.length, completed: Math.min(1, items.length - 1), allDone: false, items }, rounds: [], round: { number: 1, status: 'active', label: 'WINNING RULES' } };
    }
    const key = 'r' + JSON.stringify([cfg.rounds || null, cfg.roundCount || 3]);
    if (!infoCache.has(key)) infoCache.set(key, await apiQuiet('rules:roundsInfo', { rounds: cfg.rounds, count: cfg.roundCount || 3 }).catch(() => ({})));
    const info = infoCache.get(key); const r1 = info[1] || { label: 'ONE LINE', short: 'Any full row or column', examples: [CMBPatterns.examples(1)[0]] };
    return { mode: 'rounds', checklist: null, rounds: Object.keys(info).map(n => ({ n: Number(n), label: info[n].label, example: info[n].examples[0] })), round: { number: 1, status: 'active', label: r1.label, short: r1.short, examples: r1.examples } };
  }

  /** Mount a preview into `box`. Returns { update(cfg), destroy() }. cfg: { overlay, crawler, patternPosition, mode, checklist, rounds, roundCount, aspect, name } */
  function tvPreview(box, opts = {}) {
    box.classList.add('tvp');
    box.innerHTML = `<div class="tvp-frame"><iframe src="../audience/index.html?preview=1" width="${W}" height="${H}" tabindex="-1" title="TV preview"></iframe></div><div class="tvp-cap">${esc(opts.caption || 'Live TV preview — changes as you edit')}</div>`;
    const frameBox = box.querySelector('.tvp-frame'); const ifr = box.querySelector('iframe');
    const fit = () => { const w = frameBox.clientWidth || 480; const k = w / W; ifr.style.transform = `scale(${k})`; frameBox.style.height = Math.round(H * k) + 'px'; };
    const ro = new ResizeObserver(fit); ro.observe(frameBox); fit();
    let ready = false, pending = null, timer = null;
    const post = (ch, data) => { try { ifr.contentWindow.postMessage({ ch, data }, '*'); } catch (e) { /* */ } };
    const send = async (cfg) => {
      const sm = await samples(); const rv = await rulesView(cfg);
      const songs = sm.songs; const cur = songs[0];
      const state = Object.assign({
        gameName: cfg.name || 'Friday Night Anthems', logo: null,
        song: cfg.overlay && cfg.overlay.enabled === false ? null : { title: cur.title, artist: cur.artist, key: 'preview' },
        playbackStatus: 'playing',
        history: songs.slice(1, 13).map((s, i) => ({ n: i + 1, title: s.title, artist: s.artist, credit: false, round: 1 })),
        overlay: Object.assign({ enabled: true, position: 'bottom-left', titleSize: 64, artistSize: 38, opacity: 0.78, duration: 0, revealDelay: 0 }, cfg.overlay || {}),
        crawler: Object.assign({ speed: 4, fontSize: 30, height: 72, separator: 'diamond', paused: false }, cfg.crawler || {}),
        patternPosition: cfg.patternPosition || 'top-right', diagonalsCount: false, oneAway: 2, screen: { mode: 'none' }
      }, rv);
      post('app-settings', { lowResource: !!(App.settings.performance && App.settings.performance.lowResource), aspect: cfg.aspect || 'contain', slides: { enabled: false, seconds: 8, images: [] } });
      post('audience-state', state);
      if (sm.bg) post('preview-bg', fileUrl(sm.bg));
    };
    ifr.addEventListener('load', () => { ready = true; setTimeout(() => { if (pending) send(pending); }, 150); });
    return {
      update(cfg) { pending = cfg; if (!ready) return; clearTimeout(timer); timer = setTimeout(() => send(cfg), 60); },
      destroy() { ro.disconnect(); clearTimeout(timer); ifr.src = 'about:blank'; }
    };
  }
  window.tvPreview = tvPreview;
})();
