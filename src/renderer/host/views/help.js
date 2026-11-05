/* 2.6 Help & Guide: the Host Guide inside the app, searchable, offline.
 * The text is docs/USER_GUIDE.md (shipped with the app), turned into HTML here. */
(function () {
  const slug = (t) => String(t).split(' — ')[0].replace(/^\d+[a-z]?\.\s+/, '').replace(/[*`_]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  /** Small Markdown → HTML: headings, paragraphs, lists, tables, quotes, code. Enough for the guide. */
  function md(src) {
    const lines = String(src).replace(/\r/g, '').split('\n');
    const out = []; let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre>${esc(buf.join('\n'))}</pre>`); continue; }
      const h = /^(#{1,4})\s+(.*)$/.exec(l);
      if (h) { const n = h[1].length; out.push(`<h${n + 1} id="h-${slug(h[2])}" data-h="${n}">${inline(h[2])}</h${n + 1}>`); i++; continue; }
      if (/^\|/.test(l)) {
        const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const body = rows.filter((r, k) => !(k === 1 && /^[|\s:-]+$/.test(r)));
        out.push(`<div class="hp-tbl"><table><thead><tr>${cells(body[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l); const items = [];
        while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          if (/^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); else items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
      }
      if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<div class="hp-note">${inline(buf.join(' '))}</div>`); continue; }
      if (!l.trim() || /^---+$/.test(l.trim())) { i++; continue; }
      const buf = []; while (i < lines.length && lines[i].trim() && !/^(#|\||```|>|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++].trim());
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }

  /* Which part of the guide fits each screen (F1 / “?” opens it there). */
  const TOPIC = {
    start: 'first-launch', dashboard: 'before-the-night-about-15-minutes', library: 'import-your-music-videos', playlists: 'build-a-playlist',
    create: 'create-the-game', cards: 'print-the-cards', host: 'running-the-rounds', mobile: 'connect-your-phone', venuecheck: 'venue-check',
    history: 'saving-recovery-and-backups', backup: 'backup-and-restore', settings: 'settings'
  };
  App.helpFor = (view) => App.show('help', TOPIC[view] || null);

  App.register('help', {
    async render(el, topic) {
      this.el = el;
      if (!this.html) { const src = await api('help:guide'); this.html = md(src || '# Host Guide\n\nThe guide could not be loaded.'); }
      el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Help &amp; Guide</div><h1>Host Guide</h1><p>Everything in Anthem Square, step by step. Works offline. Press <b>F1</b> on any screen to jump to its part of the guide.</p></div>
          <div class="row"><input type="search" id="hpFind" placeholder="Search the guide…" style="width:280px" aria-label="Search the guide"></div></div>
        <div class="cols hp-cols"><nav class="panel hp-toc" id="hpToc" aria-label="Guide contents"></nav><article class="panel hp-body" id="hpBody">${this.html}</article></div>`;
      const body = $('#hpBody', el);
      $('#hpToc', el).innerHTML = $$('h3[data-h="2"], h4[data-h="3"]', body).map(h => `<a href="#" data-to="${h.id}" class="${h.dataset.h === '2' ? 'l2' : 'l3'}">${h.textContent.split(' — ')[0]}</a>`).join('');
      $$('#hpToc a', el).forEach(a => a.onclick = (e) => { e.preventDefault(); this.go(a.dataset.to); });
      this.sections = this.buildSections(body);
      $('#hpFind', el).addEventListener('input', (e) => this.find(e.target.value));
      if (topic) setTimeout(() => this.go('h-' + topic), 50);
    },
    go(id) { const h = this.el && $('#' + CSS.escape(id), this.el); if (!h) return; h.scrollIntoView({ block: 'start' }); h.classList.add('hp-flash'); setTimeout(() => h.classList.remove('hp-flash'), 1600); },
    /* Group the content under each heading so a search can hide whole sections. */
    buildSections(body) {
      const secs = []; let cur = null;
      Array.from(body.children).forEach(n => {
        if (/^H[2-5]$/.test(n.tagName)) { cur = { head: n, nodes: [n] }; secs.push(cur); } else if (cur) cur.nodes.push(n);
      });
      secs.forEach(s => { s.text = s.nodes.map(n => n.textContent).join(' ').toLowerCase(); s.html = s.nodes.map(n => n.innerHTML); });
      return secs;
    },
    find(q) {
      q = String(q || '').trim().toLowerCase();
      let hits = 0;
      this.sections.forEach(s => {
        s.nodes.forEach((n, k) => { n.innerHTML = s.html[k]; });
        const on = !q || s.text.includes(q);
        s.nodes.forEach(n => { n.hidden = !on; });
        if (on && q) {
          hits++;
          const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          s.nodes.forEach(n => { if (!n.querySelector('table')) n.innerHTML = n.innerHTML.replace(/(^|>)([^<]+)(?=<|$)/g, (m, a, t) => a + t.replace(re, x => `<mark>${x}</mark>`)); });
        }
      });
      let none = $('#hpNone', this.el);
      if (q && !hits) { if (!none) { none = document.createElement('div'); none.id = 'hpNone'; none.className = 'empty'; $('#hpBody', this.el).prepend(none); } none.textContent = `Nothing in the guide matches “${q}”.`; } else if (none) none.remove();
    }
  });
})();
