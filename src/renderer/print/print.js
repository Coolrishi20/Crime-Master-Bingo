/* Builds two-cards-per-A4 sheets from the saved card mappings, then fits every
 * song's text into its square (largest size that fits, never overflowing). */
(function () {
  'use strict';
  var TITLE_MAX = 10.5, TITLE_MIN = 6.2, ARTIST_MAX = 7.6, ARTIST_MIN = 5.6;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pad(n) { return String(n).padStart(3, '0'); }
  function esc(s) { return s; }

  var mcell = document.getElementById('mcell');
  function fits(cell) { return cell.scrollHeight <= cell.clientHeight + 0.5 && cell.scrollWidth <= cell.clientWidth + 0.5; }

  function fitSong(title, artist, scale) {
    var t = mcell.querySelector('.t'), a = mcell.querySelector('.a');
    t.textContent = title; a.textContent = artist;
    mcell.classList.remove('clamp');
    // Largest title size that fits (binary search), with the artist scaled alongside.
    var lo = TITLE_MIN * scale, hi = TITLE_MAX * scale, best = null;
    for (var i = 0; i < 8; i++) {
      var mid = (lo + hi) / 2;
      t.style.fontSize = mid + 'pt';
      a.style.fontSize = Math.max(ARTIST_MIN * scale, Math.min(ARTIST_MAX * scale, mid * 0.74)) + 'pt';
      if (fits(mcell) && longestWordFits(t)) { best = mid; lo = mid; } else hi = mid;
    }
    if (best == null) {
      t.style.fontSize = TITLE_MIN * scale + 'pt'; a.style.fontSize = ARTIST_MIN * scale + 'pt';
      mcell.classList.add('clamp');
      return { t: TITLE_MIN * scale, a: ARTIST_MIN * scale, clamp: true, overflow: !fits(mcell) };
    }
    return { t: best, a: Math.max(ARTIST_MIN * scale, Math.min(ARTIST_MAX * scale, best * 0.74)), clamp: false, overflow: false };
  }
  // Avoid breaking a single word across lines when a smaller size would keep it whole.
  function longestWordFits(t) {
    var words = t.textContent.split(/\s+/); var w = 0;
    var probe = document.createElement('span'); probe.style.cssText = 'position:absolute;white-space:nowrap;font-weight:800;font-size:' + t.style.fontSize;
    document.body.appendChild(probe);
    words.forEach(function (x) { probe.textContent = x; w = Math.max(w, probe.getBoundingClientRect().width); });
    probe.remove();
    return w <= t.parentNode.clientWidth - 6;
  }

  function buildCard(job, card) {
    var c = el('div', 'card');
    var head = el('div', 'head');
    var brand = el('div', 'brand' + (job.logo ? ' haslogo' : ''));
    if (job.logo) { var img = el('img'); img.src = job.logo; brand.appendChild(img); }
    brand.appendChild(el('div', 'l1', 'CRIME MASTER'));
    brand.appendChild(el('div', 'l2', 'BINGO'));
    head.appendChild(brand);
    var meta = el('div', 'meta');
    meta.appendChild(el('b', null, job.game.name));
    meta.appendChild(el('div', null, [job.game.date, job.game.venue].filter(Boolean).join('  ·  ')));
    meta.appendChild(el('div', null, 'Mark each song as you hear it'));
    head.appendChild(meta);
    var no = el('div', 'cardno'); no.appendChild(el('div', 'k', 'CARD No.')); no.appendChild(el('div', 'v', pad(card.no)));
    head.appendChild(no);
    if (job.qrs[card.no]) { var q = el('div', 'qr'); q.innerHTML = job.qrs[card.no]; head.appendChild(q); }
    c.appendChild(head);
    var grid = el('div', 'grid');
    card.cells.forEach(function (sid) {
      var s = job.songs[sid] || { t: '?', a: '' };
      var f = job.fit[sid];
      var cell = el('div', 'cell' + (f.clamp ? ' clamp' : ''));
      var t = el('div', 't', s.t); t.style.fontSize = f.t + 'pt';
      var a = el('div', 'a', s.a); a.style.fontSize = f.a + 'pt';
      cell.appendChild(t); cell.appendChild(a); grid.appendChild(cell);
    });
    c.appendChild(grid);
    var foot = el('div', 'foot');
    var rounds = el('div', 'rounds');
    var desc = { 1: 'One line — across or down', 2: 'Two parallel lines — 2 rows or 2 columns', 3: 'Full house — all 25 songs' };
    job.rounds.forEach(function (r) { var b = el('div', 'round'); b.appendChild(el('b', null, 'ROUND ' + r.n)); b.appendChild(el('span', null, desc[r.n])); rounds.appendChild(b); });
    foot.appendChild(rounds);
    var small = el('div', 'small');
    small.appendChild(el('div', null, "Diagonals don't count · Songs stay marked for all 3 rounds · Shout BINGO! and show your card number"));
    var right = el('div'); right.innerHTML = 'Card <b>' + pad(card.no) + '</b> · Game ' + job.game.id;
    small.appendChild(right);
    foot.appendChild(small);
    c.appendChild(foot);
    return c;
  }

  window.cmb.on('print:job', function (job) {
    document.body.classList.toggle('bw', !!job.bw);
    var scale = Math.max(0.8, Math.min(1.25, job.textScale || 1));
    var go = function () {
      // Fit each unique song once — every card reuses the result.
      job.fit = {}; var overflow = 0, minFont = 99;
      Object.keys(job.songs).forEach(function (sid) {
        var f = fitSong(job.songs[sid].t, job.songs[sid].a, scale);
        job.fit[sid] = f; if (f.overflow) overflow++; minFont = Math.min(minFont, f.t);
      });
      var pages = document.getElementById('pages');
      var frag = document.createDocumentFragment();
      for (var i = 0; i < job.cards.length; i += 2) {
        var sheet = el('div', 'sheet');
        var top = el('div', 'half top'); top.appendChild(buildCard(job, job.cards[i])); sheet.appendChild(top);
        if (job.cards[i + 1]) { var bot = el('div', 'half bottom'); bot.appendChild(buildCard(job, job.cards[i + 1])); sheet.appendChild(bot); }
        var cut = el('div', 'cut'); cut.appendChild(el('span', null, '✂  CUT HERE')); sheet.appendChild(cut);
        frag.appendChild(sheet);
      }
      pages.appendChild(frag);
      document.getElementById('measure').remove();
      // Verify nothing overflows in the real layout
      var cellsOver = 0;
      var cells = pages.querySelectorAll('.sheet:first-child .cell, .sheet:last-child .cell');
      cells.forEach(function (c) { if (!fits(c)) cellsOver++; });
      requestAnimationFrame(function () {
        window.cmb.send('print:ready', { overflow: overflow + cellsOver, minFont: Math.round(minFont * 10) / 10, sheets: pages.children.length });
      });
    };
    var fl = document.fonts ? Promise.all(['400 10pt Inter', '600 10pt Inter', '800 10pt Inter', '10pt Anton'].map(function (f) { return document.fonts.load(f, 'AaBb'); })).catch(function () {}) : Promise.resolve();
    fl.then(function () { return document.fonts ? document.fonts.ready : null; }).then(go);
  });
})();
