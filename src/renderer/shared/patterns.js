/* Winning-pattern mini diagrams — shared by audience screen, host UI and phone remote. */
(function (root) {
  function row(r) { return [0, 1, 2, 3, 4].map(function (c) { return r * 5 + c; }); }
  function col(c) { return [0, 1, 2, 3, 4].map(function (r) { return r * 5 + c; }); }
  function grid(on) { var g = []; for (var i = 0; i < 25; i++) g.push(on.indexOf(i) >= 0); return g; }
  var LABELS = { 1: 'ONE LINE', 2: 'TWO PARALLEL LINES', 3: 'FULL HOUSE' };
  var SHORT = { 1: 'Any full row or column', 2: 'Two rows, or two columns', 3: 'All 25 songs' };
  function examples(round) {
    if (round === 1) return [grid(row(2)), grid(col(1)), grid(row(0)), grid(col(3)), grid(row(4)), grid(col(0))];
    if (round === 2) return [grid(row(0).concat(row(3))), grid(col(1).concat(col(4))), grid(row(1).concat(row(2))), grid(col(0).concat(col(2)))];
    if (round === 3) { var all = []; for (var i = 0; i < 25; i++) all.push(i); return [grid(all)]; }
    return [grid([])];
  }
  function render(el, cells, cls) {
    el.className = 'pgrid' + (cls ? ' ' + cls : '');
    if (el.children.length !== 25) { el.innerHTML = ''; for (var i = 0; i < 25; i++) el.appendChild(document.createElement('i')); }
    for (var k = 0; k < 25; k++) el.children[k].className = cells[k] ? 'on' : '';
  }
  var api = { examples: examples, render: render, LABELS: LABELS, SHORT: SHORT, row: row, col: col };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CMBPatterns = api;
})(this);
