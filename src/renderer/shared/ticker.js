/*
 * Continuous song-history crawler.
 *
 * Design: a stream of item nodes moves right-to-left. When the left-most node
 * has fully scrolled off it is removed (and the offset reduced by its width in
 * the same frame, so nothing visibly moves). New nodes are appended on the
 * right from a cyclic cursor over the FULL history (1..N, then 1 again).
 * Adding song N+1 simply extends the cycle — no reset, no gap, no jump —
 * and the DOM only ever holds the handful of nodes that are on screen, so it
 * stays smooth with hundreds of entries.
 */
(function (root) {
  /** Pure cyclic cursor over the history — unit-tested in Node. */
  function TickerQueue() { this.items = []; this.cursor = 0; }
  TickerQueue.prototype.setItems = function (items) {
    var old = this.items;
    var isExtension = items.length >= old.length && old.every(function (o, i) { return items[i] && items[i].n === o.n && items[i].title === o.title && items[i].artist === o.artist && !!items[i].credit === !!o.credit; });
    this.items = items.slice();
    if (!isExtension) { this.cursor = 0; return 'reset'; }
    if (this.cursor >= this.items.length) this.cursor = 0;
    return items.length === old.length ? 'same' : 'extended';
  };
  TickerQueue.prototype.next = function () {
    if (!this.items.length) return null;
    if (this.cursor >= this.items.length) this.cursor = 0;
    var it = this.items[this.cursor]; it._i = this.cursor;
    this.cursor = (this.cursor + 1) % this.items.length;
    return it;
  };

  var SEPARATORS = { diamond: '◆', bar: '|', dot: '•', star: '★', note: '♪' };

  function Ticker(viewport, opts) {
    this.vp = viewport;
    this.opts = Object.assign({ speed: 4, fontSize: 30, separator: 'diamond', paused: false, empty: 'Songs will appear here once they have played' }, opts || {});
    this.queue = new TickerQueue();
    this.track = document.createElement('div');
    this.track.className = 'tk-track';
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'tk-empty';
    this.vp.appendChild(this.track);
    this.vp.appendChild(this.emptyEl);
    this.offset = 0;
    this.trackWidth = 0;
    this.widths = [];
    this.last = 0;
    this.running = false;
    this._frame = this.frame.bind(this);
    this.applyStyle();
  }

  Ticker.prototype.pxPerSecond = function () {
    // Speed 1..10 → 40..175 px/s at 1080p; scaled with the window height so it reads the same on any TV.
    var scale = Math.max(0.5, (root.innerHeight || 1080) / 1080);
    return (25 + this.opts.speed * 15) * scale;
  };

  Ticker.prototype.applyStyle = function () {
    var scale = Math.max(0.5, (root.innerHeight || 1080) / 1080);
    this.vp.style.setProperty('--tk-font', Math.round(this.opts.fontSize * scale) + 'px');
    this.emptyEl.textContent = this.opts.empty;
  };

  Ticker.prototype.configure = function (o) {
    var rebuild = (o.fontSize != null && o.fontSize !== this.opts.fontSize) || (o.separator != null && o.separator !== this.opts.separator);
    Object.assign(this.opts, o);
    this.applyStyle();
    if (rebuild) this.rebuild();
  };

  Ticker.prototype.setItems = function (items) {
    var kind = this.queue.setItems(items || []);
    this.emptyEl.style.display = this.queue.items.length ? 'none' : 'flex';
    if (kind === 'reset') this.rebuild();
    else if (kind === 'extended') {
      // Newest entry flagged so it can be styled; nodes already on screen are untouched.
      this.latestN = items[items.length - 1].n;
      this.trimInvisible();
    }
    this.start();
  };

  /* Drop queued nodes that have not yet entered the screen, so a newly added
     song joins the loop promptly. Only off-screen nodes are removed → no jump. */
  Ticker.prototype.trimInvisible = function () {
    var vpw = this.vp.clientWidth || 1920; var x = -this.offset; var keep = 0;
    for (var i = 0; i < this.widths.length; i++) { if (x < vpw) keep = i + 1; x += this.widths[i]; }
    var nodes = this.track.children;
    while (nodes.length > keep) { this.track.removeChild(this.track.lastChild); this.widths.pop(); }
    var last = this.track.lastChild;
    this.queue.cursor = last ? (Number(last.getAttribute('data-i')) + 1) % this.queue.items.length : 0;
    this.trackWidth = this.widths.reduce(function (s, w) { return s + w; }, 0);
    this.fill();
  };

  Ticker.prototype.rebuild = function () {
    this.track.innerHTML = '';
    this.widths = []; this.trackWidth = 0; this.offset = 0;
    this.queue.cursor = 0;
    this.fill();
  };

  Ticker.prototype.makeNode = function (it) {
    var el = document.createElement('div');
    el.className = 'tk-item' + (it.n === this.latestN ? ' latest' : '');
    el.setAttribute('data-i', it._i != null ? it._i : 0);
    var num = document.createElement('span'); num.className = 'tk-num'; num.textContent = (it.n < 10 ? '0' : '') + it.n;
    var t = document.createElement('span'); t.className = 'tk-title'; t.textContent = it.title;
    var dash = document.createElement('span'); dash.className = 'tk-dash'; dash.textContent = it.credit ? '/' : '—';
    if (it.credit) {
      // Technical credits are never shown as if the video was actually played.
      el.className += ' credit';
      el.appendChild(num); num = null;
      var tc = document.createElement('span'); tc.className = 'tk-credit'; tc.textContent = 'TECHNICAL CREDIT — '; el.appendChild(tc);
    }
    var a =document.createElement('span'); a.className = 'tk-artist'; a.textContent = it.artist;
    var sep = document.createElement('span'); sep.className = 'tk-sep'; sep.textContent = SEPARATORS[this.opts.separator] || SEPARATORS.diamond;
    if (num) el.appendChild(num); el.appendChild(t); el.appendChild(dash); el.appendChild(a); el.appendChild(sep);
    return el;
  };

  Ticker.prototype.fill = function () {
    if (!this.queue.items.length) return;
    var need = (this.vp.clientWidth || 1920) + 40;
    var guard = 0;
    while (this.trackWidth - this.offset < need && guard++ < 400) {
      var it = this.queue.next();
      var node = this.makeNode(it);
      this.track.appendChild(node);
      var w = node.getBoundingClientRect().width || 200;
      this.widths.push(w);
      this.trackWidth += w;
    }
  };

  Ticker.prototype.frame = function (ts) {
    if (!this.running) return;
    var dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    if (this.queue.items.length) {
      if (!this.opts.paused) this.offset += this.pxPerSecond() * dt;
      // Recycle nodes that have completely left the screen (same frame → no visible jump)
      while (this.widths.length && this.offset >= this.widths[0]) {
        this.offset -= this.widths.shift();
        this.trackWidth -= 0; // trackWidth recalculated below
        this.track.removeChild(this.track.firstChild);
      }
      this.trackWidth = this.widths.reduce(function (s, w) { return s + w; }, 0);
      this.fill();
      this.track.style.transform = 'translate3d(' + (-this.offset).toFixed(2) + 'px,0,0)';
    }
    root.requestAnimationFrame(this._frame);
  };

  Ticker.prototype.start = function () {
    if (this.running) return;
    this.running = true; this.last = 0;
    root.requestAnimationFrame(this._frame);
  };

  Ticker.prototype.resize = function () { this.applyStyle(); this.rebuildKeepCursor(); };
  Ticker.prototype.rebuildKeepCursor = function () {
    // Re-measure existing nodes after a font change / window resize
    var nodes = Array.prototype.slice.call(this.track.children);
    this.widths = nodes.map(function (n) { return n.getBoundingClientRect().width; });
    this.trackWidth = this.widths.reduce(function (s, w) { return s + w; }, 0);
    this.fill();
  };

  var api = { Ticker: Ticker, TickerQueue: TickerQueue, SEPARATORS: SEPARATORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CMBTicker = api;
})(typeof window !== 'undefined' ? window : this);
