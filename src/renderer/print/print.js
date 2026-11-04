/* Crime Master Bingo — printable cards (two per A4) + interactive print preview.
 * Builds sheets from the SAVED card mappings (never regenerates anything) and fits
 * every song's text into its square: wrap → shrink → minimum readable size → warn. */
(function () {
  'use strict';
  var TITLE_MAX = 11, TITLE_MIN = 6.5, ARTIST_MAX = 7.8, ARTIST_MIN = 5.8;
  var PREVIEW = /preview=1/.test(location.search);
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pad(n) { return String(n).padStart(3, '0'); }

  var mcell = document.getElementById('mcell');
  function fits(cell) { return cell.scrollHeight <= cell.clientHeight + 0.5 && cell.scrollWidth <= cell.clientWidth + 0.5; }

  // Words must stay whole at the chosen size (only truly huge words may break).
  var probe = null;
  function longestWordFits(t, size, bold) {
    if (!probe) { probe = document.createElement('span'); probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;font-family:Inter,sans-serif'; document.body.appendChild(probe); }
    probe.style.fontWeight = bold ? 800 : 400; probe.style.fontSize = size + 'pt';
    var w = 0; t.split(/\s+/).forEach(function (x) { probe.textContent = x; w = Math.max(w, probe.getBoundingClientRect().width); });
    return w <= mcell.clientWidth - 6;
  }

  function fitSong(title, artist, scale, showArtist) {
    var t = mcell.querySelector('.t'), a = mcell.querySelector('.a');
    t.textContent = title; a.textContent = showArtist ? artist : ''; a.style.display = showArtist && artist ? '' : 'none';
    mcell.classList.remove('clamp');
    var lo = TITLE_MIN * scale, hi = TITLE_MAX * scale * (showArtist ? 1 : 1.12), best = null;
    var artistFor = function (ts) { return Math.max(ARTIST_MIN * scale, Math.min(ARTIST_MAX * scale, ts * 0.74)); };
    for (var i = 0; i < 9; i++) {
      var mid = (lo + hi) / 2;
      t.style.fontSize = mid + 'pt'; a.style.fontSize = artistFor(mid) + 'pt';
      if (fits(mcell) && longestWordFits(title, mid, true)) { best = mid; lo = mid; } else hi = mid;
    }
    if (best != null) return { t: best, a: artistFor(best), clamp: false, warn: null };
    // At the minimum size: allow long words to break; if it still doesn't fit, warn (never silently).
    t.style.fontSize = TITLE_MIN * scale + 'pt'; a.style.fontSize = ARTIST_MIN * scale + 'pt';
    if (fits(mcell)) return { t: TITLE_MIN * scale, a: ARTIST_MIN * scale, clamp: false, warn: 'word-break' };
    mcell.classList.add('clamp');
    return { t: TITLE_MIN * scale, a: ARTIST_MIN * scale, clamp: true, warn: 'too-long' };
  }

  function patternSvg(cells) {
    var s = '<svg viewBox="0 0 29 29" class="pat">';
    for (var i = 0; i < 25; i++) { var x = (i % 5) * 6, y = Math.floor(i / 5) * 6; s += '<rect x="' + x + '" y="' + y + '" width="5" height="5" rx="1" class="' + (cells[i] ? 'on' : 'off') + '"/>'; }
    return s + '</svg>';
  }

  function buildCard(job, card) {
    var c = el('div', 'card'); c.setAttribute('data-card', card.no);
    var head = el('div', 'head');
    var brand = el('div', 'brand' + (job.logo ? ' haslogo' : ''));
    if (job.logo) { var img = el('img'); img.src = job.logo; brand.appendChild(img); }
    brand.appendChild(el('div', 'l1', 'CRIME MASTER'));
    brand.appendChild(el('div', 'l2', 'BINGO'));
    head.appendChild(brand);
    var meta = el('div', 'meta');
    meta.appendChild(el('b', null, job.game.name));
    meta.appendChild(el('div', null, [job.game.date, job.game.venue].filter(Boolean).join('  ·  ')));
    var owner = job.names && job.names[card.no];
    if (owner) { var ow = el('div', 'owner'); ow.appendChild(document.createTextNode('Player: ')); ow.appendChild(el('b', null, owner)); meta.appendChild(ow); }
    else meta.appendChild(el('div', 'hint', 'Mark each song as you hear it'));
    head.appendChild(meta);
    var no = el('div', 'cardno'); no.appendChild(el('div', 'k', 'CARD No.')); no.appendChild(el('div', 'v', pad(card.no)));
    head.appendChild(no);
    if (job.qrs[card.no]) { var q = el('div', 'qr'); q.innerHTML = job.qrs[card.no]; q.setAttribute('data-expect', 'CMB1|' + job.game.id + '|' + card.no); head.appendChild(q); }
    c.appendChild(head);
    var grid = el('div', 'grid' + (job.showArtist ? '' : ' title-only'));
    card.cells.forEach(function (sid) {
      var s = job.songs[sid] || { t: '?', a: '' };
      var f = job.fit[sid];
      var cell = el('div', 'cell' + (f.clamp ? ' clamp' : '')); cell.setAttribute('data-song', sid);
      var t = el('div', 't', s.t); t.style.fontSize = f.t + 'pt';
      cell.appendChild(t);
      if (job.showArtist && s.a) { var a = el('div', 'a', s.a); a.style.fontSize = f.a + 'pt'; cell.appendChild(a); }
      if (f.warn === 'too-long') cell.setAttribute('data-warn', '1');
      grid.appendChild(cell);
    });
    c.appendChild(grid);
    var foot = el('div', 'foot');
    var CKP = job.mode === 'checklist' && job.checklist && job.checklist.length;
    var LG = CKP ? job.checklist : job.rounds;
    var legend = el('div', 'legend' + (LG.length > 3 ? ' many' : ''));
    legend.appendChild(el('div', 'lg-title', CKP ? 'WINNING RULES · ANY ORDER' : 'WINNING PATTERNS'));
    var names = { 1: 'One Line', 2: 'Two Parallel Lines', 3: 'Full House' };
    var sub = { 1: 'any row or column', 2: '2 rows or 2 columns', 3: 'all 25 songs' };
    var std = { 1: 'ONE LINE', 2: 'TWO PARALLEL LINES', 3: 'FULL HOUSE' };
    if (CKP) job.checklist.forEach(function (r) {
      var b = el('div', 'lg-round');
      b.innerHTML = patternSvg(r.pattern) + '<div><b></b><span></span></div>';
      b.querySelector('b').textContent = r.label.charAt(0) + r.label.slice(1).toLowerCase();
      b.querySelector('span').textContent = r.short || '';
      legend.appendChild(b);
    });
    else job.rounds.forEach(function (r) {
      var b = el('div', 'lg-round');
      var custom = r.label && r.label !== std[r.n];
      var title = custom ? r.label.charAt(0) + r.label.slice(1).toLowerCase() : names[r.n];
      b.innerHTML = patternSvg(r.pattern) + '<div><b></b><span></span></div>';
      b.querySelector('b').textContent = 'Round ' + r.n + ': ' + title;
      b.querySelector('span').textContent = custom ? (r.short || '') : sub[r.n];
      legend.appendChild(b);
    });
    if (!LG.some(function (r) { return r.diagonals; })) legend.appendChild(el('div', 'lg-nodiag', 'No diagonal lines.'));
    foot.appendChild(legend);
    var small = el('div', 'small');
    small.appendChild(el('div', null, CKP ? 'No rounds · win any rule in any order · one card can win several rules · shout BINGO! and show this card' : 'Same card for all ' + job.rounds.length + ' round' + (job.rounds.length === 1 ? '' : 's') + ' · songs stay marked · shout BINGO! and show this card'));
    var right = el('div'); right.innerHTML = 'Card <b>' + pad(card.no) + '</b> · Batch ' + (card.batch || 1) + ' · Game ' + job.game.id;
    small.appendChild(right);
    foot.appendChild(small);
    c.appendChild(foot);
    return c;
  }

  function build(job) {
    document.body.classList.toggle('bw', !!job.bw);
    document.body.classList.toggle('no-cut', !job.cutLines);
    var scale = Math.max(0.8, Math.min(1.25, job.textScale || 1));
    if (!job.showArtist) document.getElementById('mcell').classList.add('title-only');
    job.fit = {}; var warnings = [], minFont = 99, broken = 0;
    Object.keys(job.songs).forEach(function (sid) {
      var f = fitSong(job.songs[sid].t, job.songs[sid].a, scale, job.showArtist);
      job.fit[sid] = f; minFont = Math.min(minFont, f.t);
      if (f.warn === 'too-long') warnings.push({ songId: sid, title: job.songs[sid].t, artist: job.songs[sid].a });
      if (f.warn === 'word-break') broken++;
    });
    var pages = document.getElementById('pages');
    var frag = document.createDocumentFragment();
    for (var i = 0; i < job.cards.length; i += 2) {
      var sheet = el('div', 'sheet'); sheet.setAttribute('data-page', i / 2 + 1);
      var top = el('div', 'half top'); top.appendChild(buildCard(job, job.cards[i])); sheet.appendChild(top);
      if (job.cards[i + 1]) { var bot = el('div', 'half bottom'); bot.appendChild(buildCard(job, job.cards[i + 1])); sheet.appendChild(bot); }
      var cut = el('div', 'cut'); cut.appendChild(el('span', null, '✂  CUT HERE')); sheet.appendChild(cut);
      frag.appendChild(sheet);
    }
    pages.appendChild(frag);
    document.getElementById('measure').remove();
    // Verify every square in the real layout. Any that still overflows is shrunk in place;
    // if it can't fit at the minimum readable size it is flagged and reported by title.
    var warned = {}; warnings.forEach(function (w) { warned[w.songId] = 1; });
    pages.querySelectorAll('.cell').forEach(function (c) {
      if (c.classList.contains('clamp') || fits(c)) return;
      var t = c.querySelector('.t'), a = c.querySelector('.a'); var ts = parseFloat(t.style.fontSize), as = a ? parseFloat(a.style.fontSize) : 0;
      while (!fits(c) && ts > TITLE_MIN * scale * 0.9) { ts -= 0.25; t.style.fontSize = ts + 'pt'; if (a) { as = Math.max(ARTIST_MIN * scale * 0.9, as - 0.2); a.style.fontSize = as + 'pt'; } }
      if (!fits(c)) {
        c.classList.add('clamp'); c.setAttribute('data-warn', '1');
        var sid = c.getAttribute('data-song');
        if (!warned[sid]) { warned[sid] = 1; warnings.push({ songId: sid, title: job.songs[sid].t, artist: job.songs[sid].a }); }
      }
    });
    return { overflow: warnings.length, warnings: warnings, wordBreaks: broken, minFont: Math.round(minFont * 10) / 10, sheets: pages.children.length };
  }

  /* --------------------------------------------------------------- preview UI */
  function previewUi(job, info) {
    document.body.classList.add('preview');
    var bar = el('div', 'pv-bar');
    bar.innerHTML =
      '<div class="pv-brand"><span>CRIME MASTER</span> <b>BINGO</b> · Print preview</div>' +
      '<div class="pv-grp"><button id="pvPrev" title="Previous page">◀</button><span id="pvPage">Page 1 / ' + info.sheets + '</span><button id="pvNext" title="Next page">▶</button></div>' +
      '<div class="pv-grp"><button id="pvOut" title="Zoom out">−</button><span id="pvZoom">100%</span><button id="pvIn" title="Zoom in">+</button><button id="pvFit">Fit</button></div>' +
      '<div class="pv-grp"><input id="pvFind" inputmode="numeric" placeholder="Card #" maxlength="3"><button id="pvGo">Find</button></div>' +
      '<div class="pv-grp"><button id="pvQr">Check QR codes</button></div>' +
      '<span class="pv-grow"></span>' +
      '<div class="pv-grp"><button id="pvPrintAll" class="pri">🖨 Print all</button><input id="pvRange" placeholder="e.g. 1-50, 75"><button id="pvPrintRange">Print range</button><input id="pvRe" inputmode="numeric" placeholder="Card #" maxlength="3"><button id="pvReprint">Reprint card</button><button id="pvPdf">Export PDF</button></div>';
    var headWrap = el('div', 'pv-head'); headWrap.appendChild(bar);
    document.body.insertBefore(headWrap, document.body.firstChild);
    var status = el('div', 'pv-status');
    status.innerHTML = '<span>' + job.cards.length + ' card' + (job.cards.length === 1 ? '' : 's') + ' · ' + info.sheets + ' A4 sheet' + (info.sheets === 1 ? '' : 's') + ' · two per page</span>' +
      (job.locked ? '<span class="pv-ok">🔒 Cards locked — reprints are identical</span>' : '<span class="pv-warn">DRAFT — printing or exporting will lock these cards</span>') +
      (info.warnings.length ? '<span class="pv-bad">⚠ ' + info.warnings.length + ' title(s) too long to print in full: ' + info.warnings.slice(0, 5).map(function (w) { return w.title; }).join(', ') + (info.warnings.length > 5 ? '…' : '') + ' — set a shorter “Printed title” in the Music Library</span>' : '<span class="pv-ok">✓ All song text fits</span>') +
      '<span id="pvQrRes"></span>';
    headWrap.appendChild(status);

    var pages = document.getElementById('pages'); var zoom = 1;
    var sheets = Array.prototype.slice.call(pages.querySelectorAll('.sheet'));
    function setZoom(z) { zoom = Math.max(0.3, Math.min(2.5, z)); pages.style.zoom = zoom; document.getElementById('pvZoom').textContent = Math.round(zoom * 100) + '%'; }
    function fit() { var w = window.innerWidth - 60; setZoom(Math.min(1.4, w / (210 * 96 / 25.4))); }
    function current() { var mid = window.scrollY + window.innerHeight / 3; var n = 1; sheets.forEach(function (s, i) { if (s.getBoundingClientRect().top + window.scrollY <= mid) n = i + 1; }); return n; }
    function goPage(n) { n = Math.max(1, Math.min(sheets.length, n)); sheets[n - 1].scrollIntoView({ block: 'start' }); window.scrollBy(0, -headWrap.offsetHeight - 10); }
    function updatePage() { document.getElementById('pvPage').textContent = 'Page ' + current() + ' / ' + sheets.length; }
    window.addEventListener('scroll', updatePage);
    document.getElementById('pvPrev').onclick = function () { goPage(current() - 1); };
    document.getElementById('pvNext').onclick = function () { goPage(current() + 1); };
    document.getElementById('pvIn').onclick = function () { setZoom(zoom + 0.15); };
    document.getElementById('pvOut').onclick = function () { setZoom(zoom - 0.15); };
    document.getElementById('pvFit').onclick = fit;
    function find() {
      var n = parseInt(document.getElementById('pvFind').value, 10);
      var card = pages.querySelector('.card[data-card="' + n + '"]');
      if (!card) { flash('Card ' + (n || '?') + ' is not in this preview', true); return; }
      card.scrollIntoView({ block: 'center' });
      card.classList.remove('hl'); void card.offsetWidth; card.classList.add('hl');
    }
    document.getElementById('pvGo').onclick = find;
    document.getElementById('pvFind').onkeydown = function (e) { if (e.key === 'Enter') find(); };
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'PageDown' || e.key === 'ArrowRight') { goPage(current() + 1); e.preventDefault(); }
      if (e.key === 'PageUp' || e.key === 'ArrowLeft') { goPage(current() - 1); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') setZoom(zoom + 0.15);
      if (e.key === '-') setZoom(zoom - 0.15);
    });
    function flash(msg, bad) { var r = document.getElementById('pvQrRes'); r.className = bad ? 'pv-bad' : 'pv-ok'; r.textContent = msg; }

    // Decode every QR code on the pages and compare it with the card it's printed on
    document.getElementById('pvQr').onclick = function () {
      var qrs = Array.prototype.slice.call(pages.querySelectorAll('.qr'));
      if (!qrs.length) { flash('QR codes are switched off for this print', true); return; }
      if (!window.jsQR) { flash('QR checker not available', true); return; }
      var ok = 0, bad = []; var i = 0; var cv = document.createElement('canvas'); cv.width = cv.height = 240; var ctx = cv.getContext('2d', { willReadFrequently: true });
      (function next() {
        if (i >= qrs.length) { if (bad.length) flash('⚠ ' + bad.length + ' QR code(s) did not match: cards ' + bad.slice(0, 8).join(', '), true); else flash('✓ All ' + ok + ' QR codes scanned and match their card numbers'); return; }
        var q = qrs[i++]; var svg = q.querySelector('svg'); var expect = q.getAttribute('data-expect');
        var x = new XMLSerializer().serializeToString(svg);
        var img = new Image();
        img.onload = function () {
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 240, 240); ctx.drawImage(img, 20, 20, 200, 200);
          var d = ctx.getImageData(0, 0, 240, 240); var code = window.jsQR(d.data, 240, 240);
          if (code && code.data === expect) ok++; else bad.push(expect.split('|')[2]);
          if (i % 25 === 0) flash('Checking QR codes… ' + i + ' / ' + qrs.length);
          setTimeout(next, 0);
        };
        img.onerror = function () { bad.push(expect.split('|')[2]); setTimeout(next, 0); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(x);
      })();
    };
    window.__checkQr = function () { return new Promise(function (res) { document.getElementById('pvQr').click(); var t = setInterval(function () { var r = document.getElementById('pvQrRes').textContent; if (/match/.test(r)) { clearInterval(t); res(r); } }, 200); }); };

    // Printing / export reuse the laptop's normal print pipeline (same saved cards).
    function lockConfirm() {
      if (job.locked) return Promise.resolve(true);
      return new Promise(function (resolve) {
        var m = el('div', 'pv-modal');
        m.innerHTML = '<div class="pv-box"><h2>LOCK BINGO CARDS?</h2><p><b>Once these cards have been issued, their songs and arrangements cannot be changed. This ensures printed cards always match Bingo verification.</b></p><div class="pv-btns"><button id="pvLockNo">Cancel</button><button id="pvLockYes" class="pri">🔒 Confirm &amp; Lock</button></div></div>';
        document.body.appendChild(m);
        m.querySelector('#pvLockNo').onclick = function () { m.remove(); resolve(false); };
        m.querySelector('#pvLockYes').onclick = function () { m.remove(); resolve(true); };
      });
    }
    function act(kind, range) {
      lockConfirm().then(function (ok) {
        if (!ok) return;
        var args = Object.assign({ id: job.gameKey, confirmLock: true, range: range || null }, job.opts);
        flash(kind === 'pdf' ? 'Creating PDF…' : 'Opening the print dialog…');
        window.cmb.invoke(kind === 'pdf' ? 'cards:exportPdf' : 'cards:print', args).then(function (r) {
          if (!r) { flash('Cancelled'); return; }
          job.locked = true;
          document.querySelector('.pv-warn') && (document.querySelector('.pv-warn').outerHTML = '<span class="pv-ok">🔒 Cards locked — reprints are identical</span>');
          if (kind === 'pdf') flash('✓ PDF saved: ' + r.file);
          else flash(r.printed ? '✓ Sent ' + r.sheets + ' sheet(s) to the printer' : 'Printing cancelled', !r.printed);
        }).catch(function (e) { flash(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); });
      });
    }
    document.getElementById('pvPrintAll').onclick = function () { act('print', job.cards.map(function (c) { return c.no; }).join(',')); };
    document.getElementById('pvPrintRange').onclick = function () { var r = document.getElementById('pvRange').value.trim(); if (!r) return flash('Type a range such as 1-50, 75', true); act('print', r); };
    document.getElementById('pvReprint').onclick = function () { var n = parseInt(document.getElementById('pvRe').value, 10); if (!n) return flash('Type the card number to reprint', true); act('print', String(n)); };
    document.getElementById('pvPdf').onclick = function () { act('pdf', job.cards.map(function (c) { return c.no; }).join(',')); };
    fit(); updatePage();
  }

  window.cmb.on('print:job', function (job) {
    var fl = document.fonts ? Promise.all(['400 10pt Inter', '600 10pt Inter', '800 10pt Inter', '10pt Anton'].map(function (f) { return document.fonts.load(f, 'AaBb'); })).catch(function () {}) : Promise.resolve();
    fl.then(function () { return document.fonts ? document.fonts.ready : null; }).then(function () {
      var info = build(job);
      if (PREVIEW || job.preview) previewUi(job, info);
      if (job.images) {
        document.body.classList.add('images');
        // one card at a time, top-left, for a pixel-exact capture of that card
        window.__showCard = function (no) {
          document.querySelectorAll('.half.show').forEach(function (h) { h.classList.remove('show'); });
          var c = document.querySelector('.card[data-card="' + no + '"]');
          if (c) c.closest('.half').classList.add('show');
          window.scrollTo(0, 0);
          return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(function () { res(!!c); }, 60); }); }); });
        };
      }
      requestAnimationFrame(function () { window.cmb.send('print:ready', info); });
    });
  });
})();
