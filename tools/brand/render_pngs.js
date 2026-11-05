/* Render the brand PNG sizes and the Windows .ico from the generated SVGs.
   ≤32 px uses the simplified small icon (thin grid lines would blur). */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const REPO = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const big = fs.readFileSync(path.join(REPO, 'assets/brand/anthem-square-icon.svg'), 'utf8');
  const small = fs.readFileSync(path.join(REPO, 'assets/brand/anthem-square-icon-small.svg'), 'utf8');
  const render = async (svg, size, out) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  const dir = path.join(REPO, 'assets/brand/png');
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) await render(s <= 32 ? small : big, s, path.join(dir, `anthem-square-${s}.png`));
  fs.copyFileSync(path.join(dir, 'anthem-square-256.png'), path.join(REPO, 'assets/icon.png'));
  fs.copyFileSync(path.join(dir, 'anthem-square-512.png'), path.join(REPO, 'build/icon.png'));
  await b.close();
  execFileSync('python3', ['-c', `
from PIL import Image
d='${dir}'
imgs=[Image.open(f'{d}/anthem-square-{s}.png').convert('RGBA') for s in (16,24,32,48,64,128,256)]
for out in ('${path.join(REPO, 'build/icon.ico')}','${path.join(REPO, 'assets/brand/anthem-square.ico')}'):
    imgs[-1].save(out, format='ICO', sizes=[(i.width,i.height) for i in imgs], append_images=imgs[:-1])
print('ico ok')`], { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
