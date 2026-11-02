/* Printing QA: page counts for 1/2/3/100/500/999 cards, A4 size, card numbering,
 * QR accuracy (sampled pages rendered to images and decoded), identical reprints,
 * long / accented / mixed-language titles. Run: xvfb-run -a node test/e2e/print-counts.js <samplesDir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const OUT = path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const results = []; let failed = 0;
const ok = (c, n, d = '') => { results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; console.log(results[results.length - 1]); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-print-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  await inv('library:importPaths', [process.argv[2]]);
  for (let i = 0; i < 200; i++) { if (!(await inv('library:list')).songs.some(s => s.status === 'unchecked')) break; await sleep(400); }
  const songs = (await inv('library:list')).songs;
  const tricky = [
    ['Supercalifragilisticexpialidocious Extraordinarily Long Title (Extended Twelve Inch Club Remix Version)', 'The Very Long Named Orchestra Featuring Many Guests'],
    ['Déjà Vu (Àçcéñtéd Ëdition)', 'Beyoncé & Jay-Z'], ['Ek Pal Ka Jeena — एक पल का जीना', 'Lucky Ali'],
    ['上を向いて歩こう', '坂本九'], ["What's Up?! (Don't Stop) — #1 & 100% 'Live'", 'P!nk & Friends'], ['Ölüdeniz Çiçeği', 'Tarkan']];
  for (let i = 0; i < tricky.length; i++) await inv('library:update', { id: songs[i].id, fields: { title: tricky[i][0], artist: tricky[i][1] } });
  const pl = await inv('playlists:create', { name: 'Print QA' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Print QA Night', playlistId: pl.id, cards: 999 });
  ok(g.cards === 999, '999 unique cards generated');
  const expect = { '1': 1, '1-2': 1, '1-3': 2, '1-100': 50, '1-500': 250, '1-999': 500 };
  let first = null;
  for (const [range, pages] of Object.entries(expect)) {
    const f = path.join(OUT, `print-${range}.pdf`);
    const t = Date.now();
    const r = await inv('cards:exportPdf', { id: g.id, file: f, range, confirmLock: true });
    const info = execFileSync('pdfinfo', [f], { encoding: 'utf8' });
    const n = Number(/Pages:\s+(\d+)/.exec(info)[1]);
    ok(n === pages && /\(A4\)/.test(info), `${range.split('-').pop()} card(s) → ${pages} A4 page(s)`, `${n} pages, ${((Date.now() - t) / 1000).toFixed(1)} s, overflow ${r.overflow}${r.warnings && r.warnings.length ? ' (' + r.warnings.map(w => w.title.slice(0, 20)).join('; ') + ')' : ''}`);
    if (range === '1-999') first = f;
  }
  const txt = execFileSync('pdftotext', [first, '-'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const nums = (txt.match(/Card (\d{3}) · Batch/g) || []).map(x => Number(x.slice(5, 8)));
  ok(nums.length === 999 && nums.every((n, i) => n === i + 1), 'Every card number 001–999 printed once, in order');
  ok(/Déjà Vu/.test(txt) && /Beyoncé/.test(txt) && /Ölüdeniz/.test(txt) && /What's Up\?!/.test(txt), 'Accented characters and punctuation printed correctly');
  const legendCount = (txt.match(/No diagonal lines\./g) || []).length;
  ok(legendCount === 999 && /Round 2: Two Parallel Lines/.test(txt) && /Round 3: Full House/.test(txt), 'Winning-pattern legend on every card', legendCount + ' legends');
  // QR accuracy: render sample pages and decode with jsQR in a browser
  const br = await chromium.launch(); const page = await br.newPage();
  await page.addScriptTag({ path: require.resolve('jsqr/dist/jsQR.js') });
  const samples = [1, 2, 137, 250, 499, 500]; let qrOk = 0, qrN = 0;
  for (const pg of samples) {
    const base = path.join(OUT, `qr-p${pg}`); execFileSync('pdftoppm', ['-r', '200', '-png', '-f', String(pg), '-l', String(pg), first, base]);
    const png = fs.readdirSync(OUT).find(f => f.startsWith(`qr-p${pg}`) && f.endsWith('.png'));
    const b64 = fs.readFileSync(path.join(OUT, png)).toString('base64'); fs.unlinkSync(path.join(OUT, png));
    const codes = await page.evaluate(async (src) => {
      const img = new Image(); img.src = src; await img.decode();
      const out = [];
      for (const half of [0, 1]) { // top & bottom card; QR sits in the top-right of each half
        const c = document.createElement('canvas'); const w = img.width, h = img.height / 2;
        c.width = Math.round(w * 0.35); c.height = Math.round(h * 0.35);
        const x = c.getContext('2d'); x.drawImage(img, w * 0.65, half * h, w * 0.35, h * 0.35, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height); const r = jsQR(d.data, c.width, c.height); out.push(r ? r.data : null);
      }
      return out;
    }, 'data:image/png;base64,' + b64);
    codes.forEach((c, i) => { const no = (pg - 1) * 2 + i + 1; if (no > 999) return; qrN++; if (c === `CMB1|${g.id}|${no}`) qrOk++; });
  }
  await br.close();
  ok(qrOk === qrN, 'QR codes on printed pages decode to the right game and card', `${qrOk}/${qrN} sampled cards`);
  // reprint after a restart = identical
  const re1 = path.join(OUT, 'print-reprint-457.pdf');
  await inv('cards:exportPdf', { id: g.id, file: re1, range: '457' });
  await app.close();
  const app2 = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const h2 = await app2.firstWindow(); await h2.waitForFunction(() => window.App && window.App.settings);
  const re2 = path.join(OUT, 'print-reprint-457-after-restart.pdf');
  await h2.evaluate(([a, b]) => window.cmb.invoke(a, b), ['cards:exportPdf', { id: g.id, file: re2, range: '457', bw: true, textScale: 1.2, showArtist: false }]);
  const t1 = execFileSync('pdftotext', [re1, '-'], { encoding: 'utf8' }); const t2 = execFileSync('pdftotext', [re2, '-'], { encoding: 'utf8' });
  const titles = (t) => /Card 457 · Batch/.test(t);
  const gameFile = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  const c457 = gameFile.cards.find(c => c.no === 457);
  const squash = (x) => x.replace(/[^\u0020-\u024F]/g, '').replace(/\s+/g, ''); // Devanagari/CJK shaping isn't reliably extractable by pdftotext (verified visually)
  const labels = gameFile.lockedLabels;
  const sTitles = c457.cells.map(id => squash(labels[id].title));
  const missing = sTitles.filter(w => !squash(t1).includes(w) || !squash(t2).includes(w));
  ok(titles(t1) && titles(t2) && missing.length === 0, 'Card 457 reprinted after a restart with different visual settings has the identical 25 songs', missing.join(', '));
  await app2.close();
  fs.writeFileSync(path.join(OUT, 'print-results.txt'), results.join('\n') + `\n\n${results.length - failed} passed, ${failed} failed\n`);
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
